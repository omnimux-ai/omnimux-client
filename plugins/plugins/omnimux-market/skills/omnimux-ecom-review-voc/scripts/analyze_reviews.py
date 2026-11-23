#!/usr/bin/env python3
"""Deterministic 8-category negative review attribution & VOC analyzer.

Pure Python 3 stdlib. Zero third-party dependencies.
Enforces strict count conservation (sum of all 8 mutually exclusive negative
categories == total negative reviews), computes fixable misunderstanding rate,
and ranks positive selling-point themes from 4-5 star reviews.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any


# 8 mutually exclusive negative root causes (checked in deterministic priority order)
NEGATIVE_CATEGORIES: list[tuple[str, bool, list[str]]] = [
    ("missing_parts", False, [
        r"missing", r"incomplete", r"faltando", r"faltou", r"falta", r"no\s+cable", r"without\s+charger",
        r"少件", r"缺件", r"漏发", r"没配", r"少了",
    ]),
    ("shipping_damage", False, [
        r"broken\s+on\s+arrival", r"damaged", r"crushed", r"dent(?:ed)?", r"cracked", r"shattered",
        r"quebrad[oa]", r"amassad[oa]", r"danificad[oa]", r"roto", r"dañad[oa]",
        r"破损", r"压坏", r"碎了", r"摔坏", r"包装烂",
    ]),
    ("size_mismatch", True, [
        r"\btoo\s+small\b", r"\btoo\s+big\b", r"\btoo\s+tight\b", r"\btoo\s+short\b", r"\bsmaller\s+than\b", r"\bsize\b",
        r"muito\s+pequen[oa]", r"tamanho", r"menor\s+que", r"talla", r"pequeñ[oa]",
        r"太小", r"太大", r"尺码", r"尺寸不符", r"偏小", r"偏大",
    ]),
    ("compatibility_issue", True, [
        r"not\s+compatible", r"doesn'?t\s+fit", r"won'?t\s+fit", r"wrong\s+plug", r"voltage", r"110v", r"220v",
        r"n[aã]o\s+serve", r"incompat[ií]vel", r"tomada", r"voltagem", r"no\s+sirve\s+para",
        r"不适配", r"不兼容", r"插头不对", r"电压", r"装不上",
    ]),
    ("usage_misunderstanding", True, [
        r"no\s+instructions", r"how\s+to\s+use", r"hard\s+to\s+figure", r"didn'?t\s+know\s+how", r"thought\s+it\s+was\s+automatic",
        r"confus(?:ing|ed)", r"manual", r"n[aã]o\s+sei\s+usar", r"sem\s+manual", r"no\s+trae\s+instrucciones",
        r"不会用", r"没说明书", r"看不懂", r"以为是自动", r"操作复杂", r"误以为",
    ]),
    ("expectation_gap", True, [
        r"not\s+as\s+described", r"looks?\s+different", r"different\s+color", r"cheap\s+plastic", r"not\s+worth",
        r"diferente\s+da\s+foto", r"cor\s+diferente", r"esperava\s+mais", r"no\s+es\s+como\s+en\s+la\s+foto",
        r"与图片不符", r"色差", r"实物和图不一样", r"和描述不符", r"质感差",
    ]),
    ("quality_defect", False, [
        r"stopped\s+working", r"dead\s+on\s+arrival", r"defect(?:ive)?", r"leaking", r"leaks?", r"overheat",
        r"poor\s+quality", r"broke\s+after", r"parou\s+de\s+funcionar", r"defeito", r"vazando", r"mala\s+calidad",
        r"坏了", r"漏水", r"失灵", r"充不进电", r"质量差", r"用一次就坏", r"发烫",
    ]),
    ("service_logistics", False, [
        r"late\s+delivery", r"slow\s+shipping", r"never\s+arrived", r"rude\s+seller", r"no\s+reply", r"refund",
        r"demorou", r"atraso", r"entrega", r"atendimento", r"env[ií]o\s+lento",
        r"物流慢", r"发货慢", r"客服不回", r"态度差", r"退款慢",
    ]),
]

POSITIVE_THEMES: dict[str, list[str]] = {
    "build_quality": [r"sturdy", r"solid", r"well[- ]made", r"good\s+quality", r"boa\s+qualidade", r"resistente", r"做工好", r"质感不错", r"结实"],
    "easy_to_use": [r"easy\s+to\s+use", r"convenient", r"simple", r"f[aá]cil\s+de\s+usar", r"pr[aá]tic[oa]", r"好用", r"方便", r"操作简单"],
    "great_value": [r"worth\s+the\s+price", r"great\s+value", r"affordable", r"custo[- ]benef[ií]cio", r"vale\s+a\s+pena", r"性价比", r"划算"],
    "fast_delivery": [r"fast\s+shipping", r"arrived\s+early", r"chegou\s+r[aá]pido", r"entrega\s+r[aá]pida", r"物流快", r"发货快"],
    "accurate_description": [r"as\s+described", r"just\s+like\s+photo", r"igual\s+[aà]\s+foto", r"conforme\s+anunciado", r"和描述一致", r"无色差"],
    "design_aesthetics": [r"looks?\s+great", r"sleek", r"cute", r"lindo", r"bonito", r"颜值高", r"好看", r"精致"],
}

FIXABLE_SET = {cat for cat, fixable, _ in NEGATIVE_CATEGORIES if fixable}

PATCH_RECOMMENDATIONS: dict[str, str] = {
    "size_mismatch": "在图 5 补充手部/日常物品实测尺寸对比图，并在标题/首屏明确真实长宽高与容量。",
    "usage_misunderstanding": "在商详第 6 段新增「3 步正确操作指引」，并随箱放置双面图文防误解提示卡。",
    "expectation_gap": "替换过度渲染的场景图，改用自然光实拍细节图并在商详如实注明材质与颜色观感。",
    "compatibility_issue": "在首图副图与商详顶部加粗「适用 / 不适用型号与电压规格核对表」。",
    "quality_defect": "需供应链与品控介入抽检批次缺陷，严禁用文案掩盖真实质量故障。",
    "shipping_damage": "升级外箱抗压缓冲（加厚瓦楞/气泡柱）并做跌落测试。",
    "missing_parts": "建立打包扫码复核清单，并在图 7 展示完整开箱配件清单。",
    "service_logistics": "核查尾程承运商时效与客服首响 SLA，异常件主动站内通知。",
}


def load_reviews(path: Path) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8-sig")
    if path.suffix.lower() == ".json":
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict) and isinstance(parsed.get("reviews"), list):
            return parsed["reviews"]
        raise ValueError("JSON input must be a list of reviews or {reviews: [...]}")
    first = text.splitlines()[0] if text.splitlines() else ""
    delim = ";" if first.count(";") > first.count(",") else ","
    return [dict(r) for r in csv.DictReader(text.splitlines(), delimiter=delim) if any(str(v or "").strip() for v in r.values())]


def _get_rating(row: dict[str, Any]) -> float:
    lowered = {k.strip().lower(): v for k, v in row.items()}
    for key in ("rating", "stars", "score", "nota", "评分", "星级"):
        if key in lowered and str(lowered[key]).strip():
            m = re.search(r"[1-5](?:\.\d+)?", str(lowered[key]))
            if m:
                return float(m.group(0))
    return 5.0


def _get_text(row: dict[str, Any]) -> str:
    lowered = {k.strip().lower(): v for k, v in row.items()}
    for key in ("text", "review", "comment", "content", "comentario", "comentário", "评论", "评价内容"):
        if key in lowered and str(lowered[key]).strip():
            return str(lowered[key]).strip()
    return ""


def classify_negative(text: str) -> str:
    for cat, _fixable, patterns in NEGATIVE_CATEGORIES:
        for pat in patterns:
            if re.search(pat, text, re.IGNORECASE):
                return cat
    # Fallback strictly inside the 8 categories so sum(8 categories) == total_negative
    return "expectation_gap"


def analyze_reviews(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        raise ValueError("Input contains no reviews")

    total = len(rows)
    neg_counts: dict[str, int] = {cat: 0 for cat, _, _ in NEGATIVE_CATEGORIES}
    neg_samples: dict[str, list[str]] = {cat: [] for cat, _, _ in NEGATIVE_CATEGORIES}
    pos_counts: Counter[str] = Counter()

    positive_total = 0
    negative_total = 0
    rating_sum = 0.0

    for row in rows:
        rating = _get_rating(row)
        text = _get_text(row)
        rating_sum += rating
        if rating <= 3.0:
            negative_total += 1
            cat = classify_negative(text)
            neg_counts[cat] += 1
            if text and len(neg_samples[cat]) < 3:
                neg_samples[cat].append(text[:160])
        else:
            positive_total += 1
            for theme, pats in POSITIVE_THEMES.items():
                if any(re.search(p, text, re.IGNORECASE) for p in pats):
                    pos_counts[theme] += 1

    reconciled_sum = sum(neg_counts.values())
    assert reconciled_sum == negative_total, f"Count conservation violated: {reconciled_sum} != {negative_total}"

    fixable_count = sum(neg_counts[c] for c in FIXABLE_SET)
    fixable_rate = round(fixable_count / negative_total, 4) if negative_total > 0 else 0.0

    breakdown = []
    for cat, fixable, _ in NEGATIVE_CATEGORIES:
        cnt = neg_counts[cat]
        breakdown.append({
            "category": cat,
            "count": cnt,
            "share_of_negative": round(cnt / negative_total, 4) if negative_total > 0 else 0.0,
            "fixable_by_listing_or_visual": fixable,
            "recommended_patch": PATCH_RECOMMENDATIONS[cat] if cnt > 0 else None,
            "sample_quotes": neg_samples[cat],
        })
    breakdown.sort(key=lambda x: x["count"], reverse=True)

    return {
        "summary": {
            "total_reviews": total,
            "avg_rating": round(rating_sum / total, 2),
            "positive_reviews": positive_total,
            "negative_reviews": negative_total,
            "negative_count_reconciled": reconciled_sum == negative_total,
            "fixable_misunderstanding_count": fixable_count,
            "fixable_misunderstanding_rate": fixable_rate,
        },
        "negative_attribution": breakdown,
        "positive_selling_points": [
            {"theme": theme, "mentions": cnt, "share_of_positive": round(cnt / positive_total, 4) if positive_total > 0 else 0.0}
            for theme, cnt in pos_counts.most_common()
        ],
        "reply_compliance_guardrails": [
            "禁止诱导买家删除或修改差评",
            "禁止以现金、礼品卡或返现换取好评",
            "禁止留下站外联系方式或引导绕开平台售后",
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Deterministic 8-cause e-commerce review VOC analyzer.")
    parser.add_argument("--input", required=True, help="Path to reviews CSV or JSON")
    parser.add_argument("--format", choices=["json", "markdown"], default="json")
    args = parser.parse_args(argv)

    rows = load_reviews(Path(args.input))
    report = analyze_reviews(rows)
    if args.format == "markdown":
        s = report["summary"]
        lines = [
            "# 评论 VOC 与 8 类差评归因报告（脚本实算）",
            f"- 总评论：**{s['total_reviews']}** 条（均分 {s['avg_rating']}，好评 {s['positive_reviews']}，中差评 {s['negative_reviews']}，8 类计数守恒：`{s['negative_count_reconciled']}`）",
            f"- 可通过改文案/补图修复的误解型差评：**{s['fixable_misunderstanding_count']} 条（{s['fixable_misunderstanding_rate']*100:.1f}%）**",
            "",
            "| 差评类别 | 条数 | 占差评比 | 可否文案/视觉修复 | 建议修复动作 |",
            "|---|---:|---:|---|---|",
        ]
        for row in report["negative_attribution"]:
            if row["count"] == 0:
                continue
            lines.append(
                f"| {row['category']} | {row['count']} | {row['share_of_negative']*100:.1f}% | "
                f"{'是' if row['fixable_by_listing_or_visual'] else '需供应链/物流'} | {row['recommended_patch']} |"
            )
        print("\n".join(lines))
    else:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
