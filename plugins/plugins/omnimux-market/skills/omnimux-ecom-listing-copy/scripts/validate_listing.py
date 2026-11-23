#!/usr/bin/env python3
"""Deterministic Listing length, compliance ban-word, and spec provenance validator.

Pure Python 3 stdlib. Zero third-party dependencies.
Validates platform title limits, absolute/prohibited multilingual terms,
custom forbidden_words, and traces every numeric+unit spec claim in the copy
back to the canonical `spec_table`.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


PLATFORM_LIMITS: dict[str, dict[str, Any]] = {
    "shopee": {"title_max_chars": 120, "title_min_chars": 20, "disallow_promo_in_title": True},
    "amazon": {"title_max_chars": 200, "title_min_chars": 30, "disallow_promo_in_title": True},
    "tiktok_shop": {"title_max_chars": 255, "title_min_chars": 25, "disallow_promo_in_title": True},
    "mercado_livre": {"title_max_chars": 60, "title_min_chars": 15, "disallow_promo_in_title": True},
}

BUILTIN_BANNED_PATTERNS: list[tuple[str, str]] = [
    (r"(?<![0-9])100%(?!\w)", "absolute_claim:100%"),
    (r"(?:^|\s)#1\b", "absolute_claim:#1"),
    (r"\b(?:best in the world|miracle|cure[sd]?|guaranteed viral|ban[- ]?proof)\b", "prohibited_claim_en"),
    (r"(?:\bgarantido\s*100%(?!\w)|\b100%\s*garantido\b|\bmilagroso\b|\bcura\s+definitiva\b|\bo\s+melhor\s+do\s+mundo\b)", "prohibited_claim_pt_es"),
    (r"(?:全网第一|绝对有效|永久不坏|根治|包治|保证爆款|保证出单|防封号|100%有效)", "prohibited_claim_zh"),
]

PROMO_TITLE_PATTERNS: list[str] = [
    r"\bfree shipping\b",
    r"\bfrete gratis\b",
    r"\bfrete grátis\b",
    r"\benvio gratis\b",
    r"\benvío gratis\b",
    r"\bhot sale\b",
    r"\bpromo(?:cao|ção|cion|ción)?\b",
    r"(?:包邮|限时特价|亏本清仓|秒杀)",
]

# Match numeric claims with common physical / technical units
NUMERIC_UNIT_RE = re.compile(
    r"(?<![a-zA-Z0-9])(\d+(?:[.,]\d+)?)\s*(ml|l|mah|wh|w|kw|v|a|mah|g|kg|mg|oz|lb|mm|cm|m|in|inch|inches|ft|hz|khz|db|lm|lux|k|h|hr|hrs|hour|hours|min|mins|s|sec|pcs|pack|gb|tb|mb|mp|fps|°c|℃|℉)\b",
    re.IGNORECASE,
)


def _normalize_num(token: str) -> str:
    val = token.replace(",", ".")
    try:
        f = float(val)
        return str(int(f)) if f.is_integer() else f"{f:g}"
    except ValueError:
        return val.lower()


def extract_spec_numbers(spec_table: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(spec_table, dict):
        values = list(spec_table.values())
    elif isinstance(spec_table, list):
        values = spec_table
    elif isinstance(spec_table, str):
        values = [spec_table]
    else:
        values = []

    for val in values:
        text = json.dumps(val, ensure_ascii=False) if isinstance(val, (dict, list)) else str(val)
        for m in re.finditer(r"\d+(?:[.,]\d+)?", text):
            found.add(_normalize_num(m.group(0)))
    return found


def validate_listing(payload: dict[str, Any], platform: str = "shopee") -> dict[str, Any]:
    plat = platform.lower().strip()
    if plat not in PLATFORM_LIMITS:
        raise ValueError(f"Unsupported platform '{platform}'. Choose from: {', '.join(sorted(PLATFORM_LIMITS))}")
    rules = PLATFORM_LIMITS[plat]

    title = str(payload.get("title") or "").strip()
    bullets = payload.get("bullets") or []
    if not isinstance(bullets, list):
        bullets = [str(bullets)]
    bullets_str = [str(b).strip() for b in bullets if str(b).strip()]
    description = str(payload.get("description") or "").strip()
    forbidden_words = [str(w).strip() for w in (payload.get("forbidden_words") or []) if str(w).strip()]
    spec_table = payload.get("spec_table") or {}

    issues: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    # 1. Title length checks
    title_len = len(title)
    if not title:
        issues.append({"code": "title_missing", "field": "title", "message": "Title is empty"})
    else:
        if title_len > rules["title_max_chars"]:
            issues.append({
                "code": "title_too_long",
                "field": "title",
                "actual": title_len,
                "limit": rules["title_max_chars"],
                "message": f"Title length {title_len} exceeds {plat} max {rules['title_max_chars']}",
            })
        elif title_len < rules["title_min_chars"]:
            warnings.append({
                "code": "title_short",
                "field": "title",
                "actual": title_len,
                "recommended_min": rules["title_min_chars"],
                "message": f"Title length {title_len} is shorter than recommended min {rules['title_min_chars']}",
            })

        letters = [ch for ch in title if ch.isalpha()]
        if len(letters) >= 12 and sum(1 for ch in letters if ch.isupper()) / len(letters) > 0.7:
            issues.append({"code": "title_excessive_caps", "field": "title", "message": "Title uses excessive ALL-CAPS"})

        if rules["disallow_promo_in_title"]:
            for pat in PROMO_TITLE_PATTERNS:
                if re.search(pat, title, re.IGNORECASE):
                    issues.append({
                        "code": "title_promotional_spam",
                        "field": "title",
                        "pattern": pat,
                        "message": f"Title contains disallowed promotional wording matching {pat}",
                    })

    # 2. Compliance banned terms & custom forbidden_words across all copy fields
    sections = [("title", title)] + [(f"bullet[{i}]", b) for i, b in enumerate(bullets_str)] + [("description", description)]
    for field_name, text in sections:
        if not text:
            continue
        for pat, tag in BUILTIN_BANNED_PATTERNS:
            for m in re.finditer(pat, text, re.IGNORECASE):
                issues.append({
                    "code": "banned_compliance_term",
                    "field": field_name,
                    "tag": tag,
                    "match": m.group(0),
                    "message": f"Disallowed claim '{m.group(0)}' in {field_name}",
                })
        lowered_text = text.lower()
        for fw in forbidden_words:
            if fw.lower() in lowered_text:
                issues.append({
                    "code": "forbidden_word_hit",
                    "field": field_name,
                    "word": fw,
                    "message": f"Forbidden word '{fw}' found in {field_name}",
                })

    # 3. Numeric spec provenance check against spec_table
    allowed_numbers = extract_spec_numbers(spec_table)
    unverified_specs: list[dict[str, str]] = []
    if spec_table:
        for field_name, text in sections:
            for m in NUMERIC_UNIT_RE.finditer(text):
                num_norm = _normalize_num(m.group(1))
                claim = m.group(0).strip()
                if num_norm not in allowed_numbers:
                    unverified_specs.append({"field": field_name, "claim": claim, "number": num_norm})
                    issues.append({
                        "code": "unverified_numeric_spec",
                        "field": field_name,
                        "claim": claim,
                        "message": f"Numeric claim '{claim}' in {field_name} is not traceable to spec_table",
                    })
    else:
        warnings.append({"code": "missing_spec_table", "field": "spec_table", "message": "No spec_table supplied; numeric provenance check skipped"})

    return {
        "platform": plat,
        "passed": len(issues) == 0,
        "title_length": title_len,
        "title_max_chars": rules["title_max_chars"],
        "bullet_count": len(bullets_str),
        "description_length": len(description),
        "issue_count": len(issues),
        "warning_count": len(warnings),
        "unverified_specs": unverified_specs,
        "issues": issues,
        "warnings": warnings,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate cross-border e-commerce Listing compliance & spec provenance.")
    parser.add_argument("--input", required=True, help="Path to listing JSON file")
    parser.add_argument("--platform", default="shopee", choices=sorted(PLATFORM_LIMITS.keys()))
    parser.add_argument("--format", choices=["json", "markdown"], default="json")
    args = parser.parse_args(argv)

    payload = json.loads(Path(args.input).read_text(encoding="utf-8-sig"))
    res = validate_listing(payload, platform=args.platform)
    if args.format == "markdown":
        status = "PASS" if res["passed"] else "FAIL"
        lines = [
            f"# Listing 合规校验：{status}（{res['platform']}）",
            f"- 标题长度：{res['title_length']} / {res['title_max_chars']}",
            f"- 阻断问题：{res['issue_count']} 项，提醒：{res['warning_count']} 项",
        ]
        for iss in res["issues"]:
            lines.append(f"- [FAIL] `{iss['code']}` ({iss['field']}): {iss['message']}")
        for w in res["warnings"]:
            lines.append(f"- [WARN] `{w['code']}` ({w['field']}): {w['message']}")
        print("\n".join(lines))
    else:
        print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0 if res["passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
