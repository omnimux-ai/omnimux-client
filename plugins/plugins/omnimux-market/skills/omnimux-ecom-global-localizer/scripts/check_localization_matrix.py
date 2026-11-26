#!/usr/bin/env python3
"""Deterministic Cross-Border Localization Matrix & Voiceover Budget Validator.

Zero third-party dependencies (Python 3 stdlib only).
Checks:
  1. Per-market / per-shot spoken duration expansion vs shot duration budget
     (prevents lip-sync / timeline overflow when translating into verbose languages
     like Spanish, Portuguese, or German).
  2. Numeric spec invariance against verified `spec_table` (prevents hallucinated
     or altered specs during multilingual translation).
  3. Forbidden words & multilingual prohibited compliance claims.

Exit codes:
  0: passed (all markets within duration budget, spec-traceable, compliant)
  2: failed (one or more blocking issues found)
"""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any

# Conservative natural commercial voiceover speaking rates:
# - Word-based languages: words per second (WPS)
# - Character-based languages (zh, ja, th): characters per second (CPS)
WORD_BASED_WPS: dict[str, float] = {
    "en": 2.6,
    "en-us": 2.6,
    "en-gb": 2.5,
    "es": 2.5,
    "es-mx": 2.5,
    "es-es": 2.5,
    "pt": 2.4,
    "pt-br": 2.4,
    "fr": 2.4,
    "de": 2.1,
    "it": 2.5,
    "id": 2.4,
    "ms": 2.4,
    "vi": 2.8,
}

CHAR_BASED_CPS: dict[str, float] = {
    "zh": 4.2,
    "zh-cn": 4.2,
    "zh-tw": 4.2,
    "ja": 4.8,
    "th": 5.5,
    "ko": 4.0,
}

WORD_RE = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ0-9]+(?:['’-][A-Za-zÀ-ÖØ-öø-ÿ0-9]+)*")
NON_SPACE_CHAR_RE = re.compile(r"[^\s\.,!?;:，。！？；：、\"'()（）\[\]【】\-—]")
MEASURED_NUM_RE = re.compile(
    r"(?<![A-Za-z0-9_])(\d+(?:[.,]\d+)?)\s*(?:(%)|(mm|cm|m|ml|l|g|kg|oz|lb|w|v|mah|wh|h|hr|hrs|hours?|min|mins?|days?|pcs|pack)(?![A-Za-z0-9_]))",
    re.IGNORECASE,
)
UNIT_ALIASES: dict[str, str] = {
    "hr": "h",
    "hrs": "h",
    "hour": "h",
    "hours": "h",
    "mins": "min",
    "days": "day",
}
BANNED_CLAIMS_RE = re.compile(
    r"(100%\s*(?:effective|guaranteed|cure|safe)|miracle\s+cure|clinically\s+proven\s+cure|"
    r"garantido\s+100%|cura\s+definitiva|garantizado\s+100%|100%\s*wirksam|"
    r"绝对有效|根治|全网第一|百分百防封|永久有效)",
    re.IGNORECASE,
)


def canonicalize_measured(raw_num: str, raw_unit: str) -> str:
    num = raw_num.replace(",", ".")
    try:
        parsed = float(num)
        num_str = str(int(parsed)) if parsed.is_integer() else f"{parsed:g}"
    except ValueError:
        num_str = num
    unit = UNIT_ALIASES.get(raw_unit.lower(), raw_unit.lower())
    return f"{num_str}{unit}"


def estimate_speech_seconds(text: str, lang: str) -> tuple[float, int, str]:
    norm_lang = str(lang or "en").strip().lower()
    base_lang = norm_lang.split("-")[0]
    if norm_lang in CHAR_BASED_CPS or base_lang in CHAR_BASED_CPS:
        cps = CHAR_BASED_CPS.get(norm_lang, CHAR_BASED_CPS.get(base_lang, 4.2))
        units = len(NON_SPACE_CHAR_RE.findall(text))
        return round(units / cps, 2), units, "chars"
    wps = WORD_BASED_WPS.get(norm_lang, WORD_BASED_WPS.get(base_lang, 2.5))
    units = len(WORD_RE.findall(text))
    return round(units / wps, 2), units, "words"


def extract_spec_tokens(spec_table: dict[str, Any]) -> set[str]:
    tokens: set[str] = set()
    for val in spec_table.values():
        if val is None:
            continue
        s = str(val)
        for m in MEASURED_NUM_RE.finditer(s):
            unit = m.group(2) or m.group(3)
            if unit:
                tokens.add(canonicalize_measured(m.group(1), unit))
    return tokens


def check_localization_matrix(data: dict[str, Any]) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    market_reports: list[dict[str, Any]] = []

    spec_table = data.get("spec_table") if isinstance(data.get("spec_table"), dict) else {}
    allowed_specs = extract_spec_tokens(spec_table)
    # Allow explicit benign non-spec numbers (e.g., "3s" or "100%") if caller declares them
    extra_allowed = data.get("allowed_numeric_claims")
    if isinstance(extra_allowed, list):
        for item in extra_allowed:
            if item is None:
                continue
            s = str(item).strip()
            matched = False
            for m in MEASURED_NUM_RE.finditer(s):
                unit = m.group(2) or m.group(3)
                if unit:
                    allowed_specs.add(canonicalize_measured(m.group(1), unit))
                    matched = True
            if not matched and s:
                allowed_specs.add(s.lower().replace(",", "."))

    forbidden_words = [
        str(w).strip() for w in (data.get("forbidden_words") or []) if w is not None and str(w).strip()
    ]

    markets = data.get("markets")
    if not isinstance(markets, list) or len(markets) == 0:
        issues.append({"code": "missing_markets", "message": "缺少目标市场列表（markets）"})
        return {"passed": False, "issues": issues, "warnings": warnings, "markets": []}

    for market in markets:
        if not isinstance(market, dict):
            continue
        code = str(market.get("market") or market.get("code") or "UNKNOWN").strip()
        lang = str(market.get("lang") or "en").strip()
        shots = market.get("shots") if isinstance(market.get("shots"), list) else []
        if not shots:
            issues.append({"code": "empty_market_shots", "market": code, "message": f"市场 {code}（{lang}）缺少分镜列表"})
            continue

        total_budget = 0.0
        total_est = 0.0
        shot_reports: list[dict[str, Any]] = []
        market_forbidden = forbidden_words + [
            str(w).strip() for w in (market.get("local_forbidden_words") or []) if w is not None and str(w).strip()
        ]

        for idx, shot in enumerate(shots, start=1):
            if not isinstance(shot, dict):
                continue
            shot_id = str(shot.get("shot_id") or f"S{idx}")
            try:
                budget = float(shot.get("duration_sec") or 0)
            except (TypeError, ValueError):
                budget = 0.0
            voiceover = str(shot.get("voiceover") or "").strip()
            subtitle = str(shot.get("subtitle") or "").strip()
            combined_text = f"{voiceover} {subtitle}".strip()

            if not math.isfinite(budget) or budget <= 0:
                issues.append({
                    "code": "invalid_shot_duration",
                    "market": code,
                    "shot_id": shot_id,
                    "message": f"{code}/{shot_id} 镜头预算时长必须大于 0 且为有限数值",
                })
                continue

            est_sec, count, unit_kind = estimate_speech_seconds(voiceover, lang)
            ratio = round(est_sec / budget, 3) if budget > 0 else 0.0
            total_budget += budget
            total_est += est_sec

            if ratio > 1.0:
                issues.append({
                    "code": "voiceover_overflow",
                    "market": code,
                    "shot_id": shot_id,
                    "message": f"{code}({lang})/{shot_id} 口播预计 {est_sec}s 超出镜头预算 {budget}s（占用 {round(ratio * 100)}%），请精简台词避免对口型溢出",
                })
            elif ratio > 0.9:
                warnings.append({
                    "code": "voiceover_tight_budget",
                    "market": code,
                    "shot_id": shot_id,
                    "message": f"{code}({lang})/{shot_id} 口播占用 {round(ratio * 100)}% 预算（{est_sec}s/{budget}s），建议留出 10% 停顿呼吸感",
                })

            if BANNED_CLAIMS_RE.search(combined_text):
                issues.append({
                    "code": "banned_compliance_term",
                    "market": code,
                    "shot_id": shot_id,
                    "message": f"{code}({lang})/{shot_id} 命中平台违禁绝对化/保证类表述",
                })

            lower_text = combined_text.lower()
            for fw in market_forbidden:
                if fw.lower() in lower_text:
                    issues.append({
                        "code": "forbidden_word_hit",
                        "market": code,
                        "shot_id": shot_id,
                        "message": f"{code}({lang})/{shot_id} 命中禁用词「{fw}」",
                    })

            if spec_table:
                for m in MEASURED_NUM_RE.finditer(combined_text):
                    unit = m.group(2) or m.group(3)
                    if not unit:
                        continue
                    token = canonicalize_measured(m.group(1), unit)
                    if token not in allowed_specs:
                        issues.append({
                            "code": "unverified_numeric_spec",
                            "market": code,
                            "shot_id": shot_id,
                            "message": f"{code}({lang})/{shot_id} 出现未在 spec_table 核实的数字规格「{m.group(0)}」",
                        })

            shot_reports.append({
                "shot_id": shot_id,
                "duration_sec": budget,
                "estimated_voiceover_sec": est_sec,
                "occupancy_ratio": ratio,
                "token_count": count,
                "token_unit": unit_kind,
            })

        market_reports.append({
            "market": code,
            "lang": lang,
            "total_budget_sec": round(total_budget, 2),
            "total_estimated_sec": round(total_est, 2),
            "overall_ratio": round(total_est / total_budget, 3) if total_budget > 0 else 0.0,
            "shots": shot_reports,
        })

    return {
        "passed": len(issues) == 0,
        "issue_count": len(issues),
        "warning_count": len(warnings),
        "issues": issues,
        "warnings": warnings,
        "markets": market_reports,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate cross-border multilingual localization matrix.")
    parser.add_argument("--input", required=True, help="Path to localization plan JSON file")
    parser.add_argument("--format", choices=["json", "text"], default="json")
    args = parser.parse_args(argv)

    raw = Path(args.input).read_text(encoding="utf-8")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("Input JSON root must be an object")

    result = check_localization_matrix(payload)
    if args.format == "json":
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"Passed: {result['passed']} (issues={result['issue_count']}, warnings={result['warning_count']})")
        for issue in result["issues"]:
            print(f"[ERROR] {issue['code']}: {issue['message']}")
        for warn in result["warnings"]:
            print(f"[WARN]  {warn['code']}: {warn['message']}")
    return 0 if result["passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
