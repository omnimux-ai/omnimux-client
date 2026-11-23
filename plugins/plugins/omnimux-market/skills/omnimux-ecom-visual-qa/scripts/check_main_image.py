#!/usr/bin/env python3
"""Deterministic e-commerce main image pixel compliance checker & auto-fixer.

Supports Pillow (fast path for PNG/JPEG/WebP, available in DSH bundled Python)
AND includes a complete pure-Python-stdlib PNG decoder/encoder + JPEG dimension
fallback so zero external pip installs are required for PNG checks and --fix.
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
import zlib
from pathlib import Path
from typing import Any

try:
    from PIL import Image  # type: ignore
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


PLATFORM_RULES: dict[str, dict[str, Any]] = {
    "shopee": {
        "min_size": 800,
        "require_square": True,
        "require_white_bg": False,
        "white_threshold": 240,
        "min_white_border_ratio": 0.70,
        "occupancy_min": 0.45,
        "occupancy_max": 0.92,
        "fix_size": 1000,
    },
    "amazon": {
        "min_size": 1000,
        "require_square": True,
        "require_white_bg": True,
        "white_threshold": 245,
        "min_white_border_ratio": 0.90,
        "occupancy_min": 0.65,
        "occupancy_max": 0.92,
        "fix_size": 1200,
    },
    "tiktok_shop": {
        "min_size": 600,
        "require_square": False,
        "require_white_bg": False,
        "white_threshold": 240,
        "min_white_border_ratio": 0.60,
        "occupancy_min": 0.40,
        "occupancy_max": 0.95,
        "fix_size": 1000,
    },
    "mercado_livre": {
        "min_size": 1200,
        "require_square": True,
        "require_white_bg": True,
        "white_threshold": 245,
        "min_white_border_ratio": 0.90,
        "occupancy_min": 0.60,
        "occupancy_max": 0.92,
        "fix_size": 1200,
    },
}


# ── Pure-stdlib PNG reader/writer (8-bit RGB/RGBA/Grayscale, non-interlaced) ──

def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def _read_png_rgb(path: Path) -> tuple[int, int, bytearray]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Not a valid PNG file")
    pos = 8
    width = height = bit_depth = color_type = interlace = 0
    idat_chunks: list[bytes] = []
    while pos + 8 <= len(data):
        length, ctype = struct.unpack(">I4s", data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            width, height, bit_depth, color_type, _comp, _filt, interlace = struct.unpack(">IIBBBBB", chunk)
        elif ctype == b"IDAT":
            idat_chunks.append(chunk)
        elif ctype == b"IEND":
            break

    if bit_depth != 8 or interlace != 0 or color_type not in (0, 2, 6):
        raise ValueError(f"Pure-stdlib PNG fallback supports 8-bit non-interlaced Gray/RGB/RGBA (got depth={bit_depth}, type={color_type})")

    bpp = {0: 1, 2: 3, 6: 4}[color_type]
    stride = width * bpp
    raw = zlib.decompress(b"".join(idat_chunks))
    recon = bytearray(height * stride)
    in_pos = 0
    for y in range(height):
        filt = raw[in_pos]
        in_pos += 1
        row_start = y * stride
        prev_start = (y - 1) * stride
        for i in range(stride):
            x = raw[in_pos]
            in_pos += 1
            a = recon[row_start + i - bpp] if i >= bpp else 0
            b = recon[prev_start + i] if y > 0 else 0
            c = recon[prev_start + i - bpp] if (y > 0 and i >= bpp) else 0
            if filt == 0:
                val = x
            elif filt == 1:
                val = (x + a) & 0xFF
            elif filt == 2:
                val = (x + b) & 0xFF
            elif filt == 3:
                val = (x + ((a + b) >> 1)) & 0xFF
            elif filt == 4:
                val = (x + _paeth(a, b, c)) & 0xFF
            else:
                raise ValueError(f"Unsupported PNG filter type {filt}")
            recon[row_start + i] = val

    # Composite onto white RGB buffer
    rgb = bytearray(width * height * 3)
    out = 0
    for idx in range(0, len(recon), bpp):
        if color_type == 0:
            v = recon[idx]
            rgb[out:out + 3] = bytes((v, v, v))
        elif color_type == 2:
            rgb[out:out + 3] = recon[idx:idx + 3]
        else:
            r, g, b, a = recon[idx], recon[idx + 1], recon[idx + 2], recon[idx + 3]
            inv = 255 - a
            rgb[out] = (r * a + 255 * inv) // 255
            rgb[out + 1] = (g * a + 255 * inv) // 255
            rgb[out + 2] = (b * a + 255 * inv) // 255
        out += 3
    return width, height, rgb


def _write_png_rgb(path: Path, width: int, height: int, rgb: bytes | bytearray) -> None:
    def chunk(ctype: bytes, payload: bytes) -> bytes:
        crc = zlib.crc32(ctype + payload) & 0xFFFFFFFF
        return struct.pack(">I", len(payload)) + ctype + payload + struct.pack(">I", crc)

    raw_rows = bytearray()
    stride = width * 3
    for y in range(height):
        raw_rows.append(0)  # Filter None
        raw_rows.extend(rgb[y * stride:(y + 1) * stride])

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw_rows), level=6)) + chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def _read_jpeg_dimensions(path: Path) -> tuple[int, int] | None:
    data = path.read_bytes()
    if not data.startswith(b"\xff\xd8"):
        return None
    i = 2
    while i + 4 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            return w, h
        length = struct.unpack(">H", data[i + 2:i + 4])[0]
        i += 2 + length
    return None


def _load_rgb_pixels(path: Path) -> tuple[int, int, bytes | None, str]:
    if HAS_PIL:
        with Image.open(path) as im:
            if im.mode in ("RGBA", "LA") or ("transparency" in im.info):
                bg = Image.new("RGB", im.size, (255, 255, 255))
                rgba = im.convert("RGBA")
                bg.paste(rgba, mask=rgba.split()[3])
                rgb_im = bg
            else:
                rgb_im = im.convert("RGB")
            return rgb_im.width, rgb_im.height, rgb_im.tobytes(), "pillow"

    head = path.read_bytes()[:8]
    if head == b"\x89PNG\r\n\x1a\n":
        w, h, rgb = _read_png_rgb(path)
        return w, h, bytes(rgb), "stdlib-png"
    dims = _read_jpeg_dimensions(path)
    if dims:
        return dims[0], dims[1], None, "stdlib-jpeg-header-only"
    raise ValueError("Unsupported image format without Pillow; use bundled Python with Pillow for JPEG/WebP pixel checks")


def _analyze_pixels(width: int, height: int, rgb: bytes, white_threshold: int) -> dict[str, Any]:
    # Sample step keeps analysis fast even on 4000x4000 images
    step = max(1, min(width, height) // 300)
    border_white = 0
    border_total = 0

    def is_white(x: int, y: int) -> bool:
        idx = (y * width + x) * 3
        return rgb[idx] >= white_threshold and rgb[idx + 1] >= white_threshold and rgb[idx + 2] >= white_threshold

    border_band = max(1, min(width, height) // 40)
    for x in range(0, width, step):
        for y in (0, min(height - 1, border_band), max(0, height - 1 - border_band), height - 1):
            border_total += 1
            if is_white(x, y):
                border_white += 1
    for y in range(0, height, step):
        for x in (0, min(width - 1, border_band), max(0, width - 1 - border_band), width - 1):
            border_total += 1
            if is_white(x, y):
                border_white += 1

    min_x, min_y = width, height
    max_x, max_y = -1, -1
    non_white_count = 0
    sampled_total = 0
    for y in range(0, height, step):
        for x in range(0, width, step):
            sampled_total += 1
            if not is_white(x, y):
                non_white_count += 1
                if x < min_x:
                    min_x = x
                if x > max_x:
                    max_x = x
                if y < min_y:
                    min_y = y
                if y > max_y:
                    max_y = y

    border_ratio = border_white / border_total if border_total else 0.0
    if max_x >= min_x and max_y >= min_y:
        bbox_w = max_x - min_x + 1
        bbox_h = max_y - min_y + 1
        # Standard marketplace occupancy metric: max(bbox_w / width, bbox_h / height)
        occupancy_linear = max(bbox_w / width, bbox_h / height)
        occupancy_area = (bbox_w * bbox_h) / (width * height)
        bbox = [min_x, min_y, max_x, max_y]
    else:
        occupancy_linear = 0.0
        occupancy_area = 0.0
        bbox = None

    return {
        "white_border_ratio": round(border_ratio, 4),
        "subject_occupancy_linear": round(occupancy_linear, 4),
        "subject_occupancy_area": round(occupancy_area, 4),
        "subject_bbox": bbox,
        "non_white_pixel_ratio": round(non_white_count / sampled_total, 4) if sampled_total else 0.0,
    }


def _resize_rgb_nearest(rgb: bytes, src_w: int, src_h: int, dst_w: int, dst_h: int) -> bytearray:
    out = bytearray(dst_w * dst_h * 3)
    for y in range(dst_h):
        sy = min(src_h - 1, int(y * src_h / dst_h))
        for x in range(dst_w):
            sx = min(src_w - 1, int(x * src_w / dst_w))
            s_idx = (sy * src_w + sx) * 3
            d_idx = (y * dst_w + x) * 3
            out[d_idx:d_idx + 3] = rgb[s_idx:s_idx + 3]
    return out


def fix_main_image(
    src_path: Path,
    dst_path: Path,
    *,
    target_size: int = 1200,
    target_occupancy: float = 0.82,
    white_threshold: int = 245,
) -> dict[str, Any]:
    if HAS_PIL:
        with Image.open(src_path) as im:
            if im.mode in ("RGBA", "LA") or ("transparency" in im.info):
                bg = Image.new("RGB", im.size, (255, 255, 255))
                rgba = im.convert("RGBA")
                bg.paste(rgba, mask=rgba.split()[3])
                rgb_im = bg
            else:
                rgb_im = im.convert("RGB")
            w, h = rgb_im.size
            metrics = _analyze_pixels(w, h, rgb_im.tobytes(), white_threshold)
            bbox = metrics["subject_bbox"]
            cropped = rgb_im.crop((bbox[0], bbox[1], bbox[2] + 1, bbox[3] + 1)) if bbox else rgb_im
            cw, ch = cropped.size
            max_side = max(1, int(round(target_size * target_occupancy)))
            scale = max_side / max(cw, ch)
            nw, nh = max(1, int(round(cw * scale))), max(1, int(round(ch * scale)))
            resized = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", (target_size, target_size), (255, 255, 255))
            canvas.paste(resized, ((target_size - nw) // 2, (target_size - nh) // 2))
            dst_path.parent.mkdir(parents=True, exist_ok=True)
            canvas.save(dst_path)
            return {"output": str(dst_path), "width": target_size, "height": target_size, "backend": "pillow"}

    w, h, rgb, backend = _load_rgb_pixels(src_path)
    if rgb is None:
        raise RuntimeError("--fix on JPEG/WebP requires Pillow (bundled Python); PNG works with pure stdlib")
    metrics = _analyze_pixels(w, h, rgb, white_threshold)
    bbox = metrics["subject_bbox"] or [0, 0, w - 1, h - 1]
    x0, y0, x1, y1 = bbox
    cw, ch = x1 - x0 + 1, y1 - y0 + 1
    cropped = bytearray(cw * ch * 3)
    for row in range(ch):
        src_start = ((y0 + row) * w + x0) * 3
        dst_start = row * cw * 3
        cropped[dst_start:dst_start + cw * 3] = rgb[src_start:src_start + cw * 3]

    max_side = max(1, int(round(target_size * target_occupancy)))
    scale = max_side / max(cw, ch)
    nw, nh = max(1, int(round(cw * scale))), max(1, int(round(ch * scale)))
    resized = _resize_rgb_nearest(bytes(cropped), cw, ch, nw, nh)

    canvas = bytearray(b"\xff" * (target_size * target_size * 3))
    ox = (target_size - nw) // 2
    oy = (target_size - nh) // 2
    for row in range(nh):
        dst_start = ((oy + row) * target_size + ox) * 3
        src_start = row * nw * 3
        canvas[dst_start:dst_start + nw * 3] = resized[src_start:src_start + nw * 3]

    _write_png_rgb(dst_path, target_size, target_size, canvas)
    return {"output": str(dst_path), "width": target_size, "height": target_size, "backend": backend}


def check_main_image(path: Path, platform: str = "amazon") -> dict[str, Any]:
    plat = platform.lower().strip()
    if plat not in PLATFORM_RULES:
        raise ValueError(f"Unsupported platform '{platform}'. Choose from: {', '.join(sorted(PLATFORM_RULES))}")
    rules = PLATFORM_RULES[plat]

    width, height, rgb, backend = _load_rgb_pixels(path)
    aspect_ratio = round(width / height, 4) if height else 0.0
    issues: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    if min(width, height) < rules["min_size"]:
        issues.append({
            "code": "resolution_too_low",
            "actual": f"{width}x{height}",
            "min_size": rules["min_size"],
            "message": f"Resolution {width}x{height} is below {plat} minimum {rules['min_size']}px",
        })

    if rules["require_square"] and abs(width - height) > max(2, int(max(width, height) * 0.02)):
        issues.append({
            "code": "aspect_not_square",
            "actual": f"{width}x{height}",
            "aspect_ratio": aspect_ratio,
            "message": f"{plat} main image requires 1:1 square aspect ratio (got {width}x{height})",
        })

    pixel_metrics: dict[str, Any] | None = None
    if rgb is not None:
        pixel_metrics = _analyze_pixels(width, height, rgb, rules["white_threshold"])
        if rules["require_white_bg"] and pixel_metrics["white_border_ratio"] < rules["min_white_border_ratio"]:
            issues.append({
                "code": "background_not_pure_white",
                "white_border_ratio": pixel_metrics["white_border_ratio"],
                "required": rules["min_white_border_ratio"],
                "message": f"Border white ratio {pixel_metrics['white_border_ratio']*100:.1f}% < required {rules['min_white_border_ratio']*100:.0f}%",
            })
        occ = pixel_metrics["subject_occupancy_linear"]
        if occ < rules["occupancy_min"]:
            issues.append({
                "code": "subject_too_small",
                "actual": occ,
                "min": rules["occupancy_min"],
                "message": f"Subject linear occupancy {occ*100:.1f}% < minimum {rules['occupancy_min']*100:.0f}%",
            })
        elif occ > rules["occupancy_max"]:
            warnings.append({
                "code": "subject_too_crowded",
                "actual": occ,
                "max": rules["occupancy_max"],
                "message": f"Subject linear occupancy {occ*100:.1f}% > recommended max {rules['occupancy_max']*100:.0f}%",
            })
    else:
        warnings.append({
            "code": "pixel_inspection_skipped_no_pillow",
            "message": "Pillow not installed in this Python interpreter; only JPEG dimensions checked.",
        })

    return {
        "file": str(path),
        "platform": plat,
        "backend": backend,
        "width": width,
        "height": height,
        "aspect_ratio": aspect_ratio,
        "passed": len(issues) == 0,
        "metrics": pixel_metrics,
        "issues": issues,
        "warnings": warnings,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="E-commerce main image pixel compliance checker & auto-fixer.")
    parser.add_argument("--input", required=True, help="Path to image file")
    parser.add_argument("--platform", default="amazon", choices=sorted(PLATFORM_RULES.keys()))
    parser.add_argument("--fix", action="store_true", help="Pad/center image onto compliant white square canvas")
    parser.add_argument("--output", default=None, help="Output path when --fix is enabled")
    parser.add_argument("--format", choices=["json", "markdown"], default="json")
    args = parser.parse_args(argv)

    src = Path(args.input)
    report = check_main_image(src, platform=args.platform)
    if args.fix:
        rules = PLATFORM_RULES[args.platform]
        out_path = Path(args.output) if args.output else src.with_name(f"{src.stem}_fixed.png")
        fixed_info = fix_main_image(src, out_path, target_size=rules["fix_size"], white_threshold=rules["white_threshold"])
        report["fixed"] = fixed_info
        report["post_fix_check"] = check_main_image(out_path, platform=args.platform)

    if args.format == "markdown":
        status = "PASS" if report["passed"] else "FAIL"
        lines = [
            f"# 主图像素合规检查：{status}（{report['platform']}）",
            f"- 尺寸：{report['width']}×{report['height']}（比例 {report['aspect_ratio']}，引擎 `{report['backend']}`）",
        ]
        if report["metrics"]:
            m = report["metrics"]
            lines.append(f"- 白底边距率：{m['white_border_ratio']*100:.1f}% · 主体占比：{m['subject_occupancy_linear']*100:.1f}%")
        for iss in report["issues"]:
            lines.append(f"- [FAIL] `{iss['code']}`: {iss['message']}")
        for w in report["warnings"]:
            lines.append(f"- [WARN] `{w['code']}`: {w['message']}")
        print("\n".join(lines))
    else:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    final_ok = report["post_fix_check"]["passed"] if "post_fix_check" in report else report["passed"]
    return 0 if final_ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
