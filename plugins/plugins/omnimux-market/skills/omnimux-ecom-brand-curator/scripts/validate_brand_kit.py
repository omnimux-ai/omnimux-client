#!/usr/bin/env python3
"""Deterministic Brand & Product Kit validator for OmniMux Brand Curator.

Zero third-party dependencies (Python 3 stdlib only).
Exit codes:
  0: pass (ready to write to OmniMux Products / Assets)
  2: fail or needs_input (missing mandatory truth fields or invalid schema)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
BANNED_CLAIMS_RE = re.compile(
    r"(100%\s*(?:effective|guaranteed|cure|safe)|best\s+in\s+the\s+world|miracle\s+cure|"
    r"绝对有效|全网第一|顶级唯一|根治|永不失效|百分百防封|garantido\s+100%|cura\s+definitiva)",
    re.IGNORECASE,
)
NUMERIC_UNIT_RE = re.compile(r"\d+(?:[.,]\d+)?\s*(?:mm|cm|m|ml|l|g|kg|oz|lb|w|v|mah|wh|h|hr|hrs|min|s|pcs|pack|%|°c|°f|hz|db|lm|k)\b", re.IGNORECASE)


def normalize_hex(color: str) -> str | None:
    raw = str(color or "").strip()
    if not HEX_RE.match(raw):
        return None
    if len(raw) == 4:
        return "#" + "".join(ch * 2 for ch in raw[1:]).upper()
    return raw.upper()


def validate_brand_kit(data: dict[str, Any]) -> dict[str, Any]:
    issues: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    missing_fields: list[str] = []

    product_name = str(data.get("product_name") or "").strip()
    if not product_name:
        missing_fields.append("product_name")
        issues.append({"code": "missing_product_name", "severity": "error", "message": "缺少商品名称（product_name）"})

    category = str(data.get("category") or "").strip()
    if not category:
        missing_fields.append("category")
        issues.append({"code": "missing_category", "severity": "error", "message": "缺少商品类目（category）"})

    core_usp = str(data.get("core_selling_point") or "").strip()
    if not core_usp:
        missing_fields.append("core_selling_point")
        warnings.append({"code": "missing_core_usp", "severity": "warning", "message": "尚未收敛唯一核心卖点（core_selling_point），建议与定价专家或用户确认"})
    elif BANNED_CLAIMS_RE.search(core_usp):
        issues.append({"code": "banned_claim_in_usp", "severity": "error", "message": "核心卖点包含违禁绝对化或医疗/保证类表述"})

    raw_markets = data.get("target_markets")
    target_markets = [str(m).strip().upper() for m in raw_markets if str(m).strip()] if isinstance(raw_markets, list) else []
    if not target_markets:
        missing_fields.append("target_markets")
        issues.append({"code": "missing_target_markets", "severity": "error", "message": "缺少目标国家/站点（target_markets）"})

    raw_specs = data.get("spec_table")
    spec_table: dict[str, str] = {}
    if isinstance(raw_specs, dict):
        for k, v in raw_specs.items():
            key = str(k).strip()
            val = str(v).strip()
            if not key or not val:
                continue
            if BANNED_CLAIMS_RE.search(val):
                issues.append({"code": "banned_claim_in_spec", "severity": "error", "message": f"参数 {key} 包含违规绝对化/功效表述"})
            spec_table[key] = val

    if len(spec_table) < 3:
        missing_fields.append("spec_table(>=3)")
        issues.append({
            "code": "insufficient_specs",
            "severity": "error",
            "message": f"已核实参数表（spec_table）仅有 {len(spec_table)} 项，至少需要 3 项实测规格（如尺寸/容量/材质/重量）",
        })

    measured_spec_count = sum(1 for v in spec_table.values() if NUMERIC_UNIT_RE.search(v))
    if spec_table and measured_spec_count == 0:
        warnings.append({
            "code": "no_numeric_unit_specs",
            "severity": "warning",
            "message": "spec_table 缺少带明确计量单位的数值规格（如 500ml、304不锈钢、120g），建议补充以供下游参数溯源校验",
        })

    raw_palette = data.get("brand_palette")
    normalized_palette: list[str] = []
    if isinstance(raw_palette, list):
        for idx, c in enumerate(raw_palette):
            norm = normalize_hex(str(c))
            if norm is None:
                issues.append({
                    "code": "invalid_palette_hex",
                    "severity": "error",
                    "message": f"brand_palette[{idx}]='{c}' 不是合法 HEX 色值（需 #RGB 或 #RRGGBB）",
                })
            elif norm not in normalized_palette:
                normalized_palette.append(norm)
    else:
        warnings.append({"code": "missing_brand_palette", "severity": "warning", "message": "未提供品牌主色（brand_palette），下游视觉专家将按实拍图自然色温处理"})

    raw_forbidden = data.get("forbidden_words")
    forbidden_words: list[str] = []
    if isinstance(raw_forbidden, list):
        seen_fw: set[str] = set()
        for w in raw_forbidden:
            cleaned = str(w).strip()
            if cleaned and cleaned.lower() not in seen_fw:
                seen_fw.add(cleaned.lower())
                forbidden_words.append(cleaned)
    if not forbidden_words:
        warnings.append({"code": "empty_forbidden_words", "severity": "warning", "message": "禁用词清单（forbidden_words）为空，建议至少补充竞品品牌名与类目高危词"})

    raw_anchors = data.get("anchor_assets")
    anchors = raw_anchors if isinstance(raw_anchors, dict) else {}
    hero_photo = str(anchors.get("hero_photo") or "").strip()
    angle_photos = [str(p).strip() for p in anchors.get("angle_photos", []) if str(p).strip()] if isinstance(anchors.get("angle_photos"), list) else []
    if not hero_photo:
        missing_fields.append("anchor_assets.hero_photo")
        warnings.append({"code": "missing_hero_photo", "severity": "warning", "message": "缺少商品主锚点实拍图（anchor_assets.hero_photo），下游视觉/视频将无法锁定外观"})

    # Deterministic readiness score (0..100)
    score = 0
    if product_name:
        score += 15
    if category:
        score += 10
    if target_markets:
        score += 10
    if core_usp and not BANNED_CLAIMS_RE.search(core_usp):
        score += 15
    if len(spec_table) >= 3:
        score += 20
    elif len(spec_table) > 0:
        score += 8
    if measured_spec_count >= 1:
        score += 5
    if normalized_palette:
        score += 5
    if forbidden_words:
        score += 10
    if hero_photo:
        score += 10

    has_errors = len(issues) > 0
    if has_errors:
        status = "fail"
    elif missing_fields:
        status = "needs_input"
    else:
        status = "pass"

    return {
        "status": status,
        "passed": status == "pass",
        "score": score,
        "missing_fields": missing_fields,
        "metrics": {
            "spec_count": len(spec_table),
            "measured_spec_count": measured_spec_count,
            "palette_count": len(normalized_palette),
            "forbidden_word_count": len(forbidden_words),
            "angle_photo_count": len(angle_photos),
        },
        "issues": issues,
        "warnings": warnings,
        "normalized_kit": {
            "product_name": product_name,
            "category": category,
            "core_selling_point": core_usp,
            "target_markets": target_markets,
            "spec_table": spec_table,
            "brand_palette": normalized_palette,
            "forbidden_words": forbidden_words,
            "anchor_assets": {
                "hero_photo": hero_photo,
                "angle_photos": angle_photos,
            },
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate OmniMux Brand & Product Kit JSON before saving to Products/Assets.")
    parser.add_argument("--input", required=True, help="Path to brand kit JSON file")
    parser.add_argument("--format", choices=["json", "text"], default="json")
    args = parser.parse_args(argv)

    raw = Path(args.input).read_text(encoding="utf-8")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("Input JSON root must be an object")

    result = validate_brand_kit(payload)
    if args.format == "json":
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"Status: {result['status']} (score {result['score']}/100)")
        for issue in result["issues"]:
            print(f"[ERROR] {issue['code']}: {issue['message']}")
        for warn in result["warnings"]:
            print(f"[WARN]  {warn['code']}: {warn['message']}")
    return 0 if result["passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
