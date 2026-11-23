#!/usr/bin/env python3
"""Deterministic shoppable video script duration, 3s hook, compliance & SRT exporter.

Pure Python 3 stdlib. Zero third-party dependencies.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


SPEAKING_RATES: dict[str, tuple[str, float]] = {
    "en": ("words", 2.5),
    "pt": ("words", 2.4),
    "pt-br": ("words", 2.4),
    "es": ("words", 2.4),
    "zh": ("chars", 4.2),
    "zh-cn": ("chars", 4.2),
}

WEAK_HOOK_PATTERNS = [
    r"^(?:hi|hello|hey)\s+(?:everyone|guys|folks)\b",
    r"^(?:大家好|哈喽大家|今天给大家推荐|今天来介绍一下)",
    r"^(?:ol[aá]\s+pessoal|oi\s+gente)",
]

BANNED_PATTERNS = [
    r"(?<![0-9])100%(?!\w)",
    r"(?:^|\s)#1\b",
    r"\b(?:miracle|cure[sd]?|guaranteed viral|ban[- ]?proof)\b",
    r"(?:\bgarantido\s*100%(?!\w)|\bmilagroso\b|\bcura\s+definitiva\b)",
    r"(?:全网第一|根治|包治|保证爆款|保证出单|防封号|100%有效)",
]

NUMERIC_UNIT_RE = re.compile(
    r"(?<![a-zA-Z0-9])(\d+(?:[.,]\d+)?)\s*(ml|l|mah|wh|w|kw|v|a|g|kg|oz|lb|mm|cm|m|in|hz|db|lm|h|hr|hrs|hour|hours|min|mins|pcs|gb|tb|mp|fps|°c|℃)\b",
    re.IGNORECASE,
)


def _normalize_num(token: str) -> str:
    val = token.replace(",", ".")
    try:
        f = float(val)
        return str(int(f)) if f.is_integer() else f"{f:g}"
    except ValueError:
        return val.lower()


def _extract_spec_numbers(spec_table: Any) -> set[str]:
    nums: set[str] = set()
    if isinstance(spec_table, dict):
        vals = list(spec_table.values())
    elif isinstance(spec_table, list):
        vals = spec_table
    else:
        vals = [spec_table] if spec_table else []
    for v in vals:
        s = json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else str(v)
        for m in re.finditer(r"\d+(?:[.,]\d+)?", s):
            nums.add(_normalize_num(m.group(0)))
    return nums


def count_spoken_units(text: str, lang: str) -> tuple[int, float]:
    unit_kind, rate = SPEAKING_RATES.get(lang.lower(), ("words", 2.5))
    cleaned = text.strip()
    if not cleaned:
        return 0, 0.0
    if unit_kind == "chars":
        # Count CJK chars + alphanumeric words
        cjk = len(re.findall(r"[\u4e00-\u9fff]", cleaned))
        latin_words = len(re.findall(r"[A-Za-z0-9]+(?:[.,][0-9]+)?", cleaned))
        units = cjk + latin_words
    else:
        units = len(re.findall(r"[A-Za-zÀ-ÿ0-9]+(?:'[A-Za-z]+)?", cleaned))
    return units, round(units / rate, 2)


def _format_srt_time(seconds: float) -> str:
    ms_total = max(0, int(round(seconds * 1000)))
    hrs, rem = divmod(ms_total, 3_600_000)
    mins, rem = divmod(rem, 60_000)
    secs, ms = divmod(rem, 1000)
    return f"{hrs:02d}:{mins:02d}:{secs:02d},{ms:03d}"


def build_srt(scenes: list[dict[str, Any]]) -> str:
    blocks: list[str] = []
    idx = 1
    for sc in scenes:
        text = str(sc.get("voiceover") or sc.get("on_screen_text") or "").strip()
        if not text:
            continue
        start = float(sc.get("start", 0.0))
        end = float(sc.get("end", start + 2.0))
        blocks.append(f"{idx}\n{_format_srt_time(start)} --> {_format_srt_time(end)}\n{text}")
        idx += 1
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def validate_video_script(payload: dict[str, Any]) -> dict[str, Any]:
    target_sec = float(payload.get("target_duration_sec") or 30.0)
    lang = str(payload.get("language") or "en").strip().lower()
    scenes = payload.get("scenes") or []
    forbidden_words = [str(w).strip() for w in (payload.get("forbidden_words") or []) if str(w).strip()]
    spec_table = payload.get("spec_table") or {}
    allowed_nums = _extract_spec_numbers(spec_table)

    if not isinstance(scenes, list) or not scenes:
        raise ValueError("Video script must include a non-empty `scenes` list")

    issues: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    scene_reports: list[dict[str, Any]] = []

    total_units = 0
    total_est_sec = 0.0
    max_end = 0.0

    # Check 3-second hook on first scene
    first = scenes[0]
    first_start = float(first.get("start", 0.0))
    first_end = float(first.get("end", 3.0))
    first_vo = str(first.get("voiceover") or "").strip()
    if first_start > 0.5 or first_end > 4.5:
        warnings.append({"code": "hook_window_wide", "scene": 1, "message": f"Opening hook spans {first_start}s-{first_end}s; recommended 0-3s"})
    if not first_vo and not str(first.get("on_screen_text") or "").strip():
        issues.append({"code": "missing_3s_hook", "scene": 1, "message": "Opening 0-3s scene lacks voiceover or on-screen hook"})
    for pat in WEAK_HOOK_PATTERNS:
        if re.search(pat, first_vo, re.IGNORECASE):
            issues.append({"code": "weak_generic_hook", "scene": 1, "message": f"Opening line uses generic slow intro: '{first_vo[:40]}'"})

    for i, sc in enumerate(scenes, start=1):
        start = float(sc.get("start", 0.0))
        end = float(sc.get("end", 0.0))
        slot = max(0.0, end - start)
        max_end = max(max_end, end)
        vo = str(sc.get("voiceover") or "").strip()
        ost = str(sc.get("on_screen_text") or "").strip()
        units, est_sec = count_spoken_units(vo, lang)
        total_units += units
        total_est_sec += est_sec

        if end <= start:
            issues.append({"code": "invalid_scene_timing", "scene": i, "message": f"Scene {i} end ({end}s) <= start ({start}s)"})
        elif slot > 0 and est_sec > slot * 1.25 + 0.4:
            issues.append({
                "code": "scene_voiceover_overflow",
                "scene": i,
                "slot_sec": round(slot, 2),
                "estimated_sec": est_sec,
                "message": f"Scene {i} voiceover (~{est_sec}s) overflows its {slot:.1f}s slot",
            })

        combined = f"{vo} {ost}".strip()
        for pat in BANNED_PATTERNS:
            m = re.search(pat, combined, re.IGNORECASE)
            if m:
                issues.append({"code": "banned_compliance_term", "scene": i, "match": m.group(0), "message": f"Disallowed term '{m.group(0)}' in scene {i}"})
        for fw in forbidden_words:
            if fw.lower() in combined.lower():
                issues.append({"code": "forbidden_word_hit", "scene": i, "word": fw, "message": f"Forbidden word '{fw}' in scene {i}"})
        if spec_table:
            for m in NUMERIC_UNIT_RE.finditer(combined):
                num_norm = _normalize_num(m.group(1))
                if num_norm not in allowed_nums:
                    issues.append({
                        "code": "unverified_numeric_spec",
                        "scene": i,
                        "claim": m.group(0).strip(),
                        "message": f"Numeric claim '{m.group(0).strip()}' in scene {i} not traceable to spec_table",
                    })

        scene_reports.append({
            "scene": i,
            "start": start,
            "end": end,
            "slot_sec": round(slot, 2),
            "spoken_units": units,
            "estimated_sec": est_sec,
        })

    if total_est_sec > target_sec * 1.15:
        issues.append({
            "code": "script_over_duration",
            "target_sec": target_sec,
            "estimated_sec": round(total_est_sec, 2),
            "message": f"Total estimated voiceover ({total_est_sec:.1f}s) exceeds target {target_sec:.0f}s (+15% cap)",
        })
    elif total_est_sec < target_sec * 0.55:
        warnings.append({
            "code": "script_under_filled",
            "target_sec": target_sec,
            "estimated_sec": round(total_est_sec, 2),
            "message": f"Estimated voiceover ({total_est_sec:.1f}s) is light for a {target_sec:.0f}s spot",
        })

    return {
        "language": lang,
        "target_duration_sec": target_sec,
        "timeline_end_sec": round(max_end, 2),
        "total_spoken_units": total_units,
        "estimated_voiceover_sec": round(total_est_sec, 2),
        "passed": len(issues) == 0,
        "scene_reports": scene_reports,
        "issues": issues,
        "warnings": warnings,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate video script hook/duration/compliance and optionally export SRT.")
    parser.add_argument("--input", required=True, help="Path to video script JSON")
    parser.add_argument("--srt", default=None, help="Optional path to export .srt subtitle file")
    parser.add_argument("--format", choices=["json", "markdown"], default="json")
    args = parser.parse_args(argv)

    payload = json.loads(Path(args.input).read_text(encoding="utf-8-sig"))
    res = validate_video_script(payload)
    if args.srt:
        srt_path = Path(args.srt)
        srt_path.parent.mkdir(parents=True, exist_ok=True)
        srt_path.write_text(build_srt(payload.get("scenes") or []), encoding="utf-8")
        res["srt_exported"] = str(srt_path)

    if args.format == "markdown":
        status = "PASS" if res["passed"] else "FAIL"
        lines = [
            f"# 短视频脚本校验：{status}（{res['language']} · 目标 {res['target_duration_sec']}s）",
            f"- 预估口播时长：**{res['estimated_voiceover_sec']}s**（时间轴总长 {res['timeline_end_sec']}s）",
        ]
        for iss in res["issues"]:
            lines.append(f"- [FAIL] `{iss['code']}`: {iss['message']}")
        for w in res["warnings"]:
            lines.append(f"- [WARN] `{w['code']}`: {w['message']}")
        print("\n".join(lines))
    else:
        print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0 if res["passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
