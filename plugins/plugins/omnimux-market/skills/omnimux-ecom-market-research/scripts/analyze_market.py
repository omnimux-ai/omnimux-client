#!/usr/bin/env python3
"""Deterministic cross-border market CSV/JSON analyzer.

Pure Python 3 stdlib — zero third-party dependencies required.
Handles Brazilian/EU decimals (R$ 1.299,90), US numbers ($49.99),
Chinese units (1.5万 / 3.2千), Portuguese/English suffixes (10mil+ / 5k+),
computes market capacity, CR3/CR10/HHI, price quantiles, and detects
unsmoothed price-band troughs between active neighbor bands.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import statistics
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


CURRENCY_PREFIX_RE = re.compile(r"^(?:R\$|US\$|MX\$|S\$|RM|PHP|THB|VND|IDR|BRL|USD|EUR|GBP|\$|€|£|¥|￥)\s*", re.IGNORECASE)


def parse_number(raw: Any) -> float | None:
    """Parse messy multi-locale e-commerce numbers into a float."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return None if (math.isnan(raw) or math.isinf(raw)) else float(raw)

    text = str(raw).strip()
    if not text or text.lower() in {"-", "--", "n/a", "na", "null", "none"}:
        return None

    # Handle price ranges like "29,90 - 49,90" or "$10 ~ $20" by taking midpoint
    range_parts = re.split(r"\s*[-–~]\s*", text)
    if len(range_parts) == 2 and range_parts[0] and range_parts[1]:
        left = parse_number(range_parts[0])
        right = parse_number(range_parts[1])
        if left is not None and right is not None:
            return (left + right) / 2.0

    text = CURRENCY_PREFIX_RE.sub("", text).strip()
    text = text.rstrip("+").strip()

    multiplier = 1.0
    lower = text.lower()
    if lower.endswith("万"):
        multiplier = 10_000.0
        text = text[:-1].strip()
    elif lower.endswith("千"):
        multiplier = 1_000.0
        text = text[:-1].strip()
    elif lower.endswith("mil"):
        multiplier = 1_000.0
        text = text[:-3].strip()
    elif lower.endswith("k"):
        multiplier = 1_000.0
        text = text[:-1].strip()
    elif lower.endswith("m"):
        multiplier = 1_000_000.0
        text = text[:-1].strip()

    text = CURRENCY_PREFIX_RE.sub("", text).strip()
    text = text.replace(" ", "").replace("\u00a0", "")
    # Strip trailing non-numeric symbols (like % or unit tags if attached)
    text = re.sub(r"[^0-9,.\-]", "", text)
    if not text or text in {"-", ".", ","}:
        return None

    has_comma = "," in text
    has_dot = "." in text

    if has_comma and has_dot:
        # Whichever separator appears last is the decimal separator.
        if text.rfind(",") > text.rfind("."):
            # Brazilian / European: 1.299,90
            text = text.replace(".", "").replace(",", ".")
        else:
            # US / UK: 1,299.90
            text = text.replace(",", "")
    elif has_comma:
        parts = text.split(",")
        if len(parts) == 2 and len(parts[1]) in {1, 2}:
            # Likely decimal comma: 49,90 or 1,5
            text = f"{parts[0]}.{parts[1]}"
        elif len(parts) >= 2 and all(len(p) == 3 for p in parts[1:]):
            # Thousands grouping: 1,200 or 1,200,000
            text = "".join(parts)
        else:
            text = text.replace(",", ".")
    elif has_dot:
        parts = text.split(".")
        # Brazilian integer thousands like "1.250" or "12.500" (when multiple dots or 3 trailing digits & leading >= 1)
        if len(parts) > 2 and all(len(p) == 3 for p in parts[1:]):
            text = "".join(parts)
        elif len(parts) == 2 and len(parts[1]) == 3 and parts[0].isdigit() and int(parts[0]) >= 1 and multiplier == 1.0:
            # Heuristic: 3 digits after dot without multiplier (e.g. 1.250 in BR exports)
            # Keep decimal if leading is 0 (0.125)
            text = "".join(parts)

    try:
        val = float(text) * multiplier
        return None if (math.isnan(val) or math.isinf(val)) else val
    except ValueError:
        return None


def detect_column(headers: list[str], candidates: list[str]) -> str | None:
    lowered = {h.strip().lower(): h for h in headers}
    for cand in candidates:
        if cand in lowered:
            return lowered[cand]
    for h in headers:
        hl = h.strip().lower()
        for cand in candidates:
            if cand in hl:
                return h
    return None


def load_rows(path: Path) -> list[dict[str, Any]]:
    raw_bytes = path.read_bytes()
    text = None
    for enc in ("utf-8-sig", "utf-8", "gb18030", "latin-1"):
        try:
            text = raw_bytes.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise ValueError(f"Unable to decode input file: {path}")

    if path.suffix.lower() == ".json":
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return [r for r in parsed if isinstance(r, dict)]
        if isinstance(parsed, dict) and isinstance(parsed.get("items"), list):
            return [r for r in parsed["items"] if isinstance(r, dict)]
        raise ValueError("JSON input must be a list of product objects or {items: [...]}")

    # Sniff delimiter (, vs ; vs \t)
    first_line = text.splitlines()[0] if text.splitlines() else ""
    delimiter = ";" if first_line.count(";") > first_line.count(",") else ("\t" if first_line.count("\t") > first_line.count(",") else ",")
    reader = csv.DictReader(text.splitlines(), delimiter=delimiter)
    return [dict(row) for row in reader if any(str(v or "").strip() for v in row.values())]


def quantile(sorted_vals: list[float], q: float) -> float:
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    pos = (len(sorted_vals) - 1) * q
    lo = math.floor(pos)
    hi = math.ceil(pos)
    if lo == hi:
        return sorted_vals[lo]
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def analyze_market(
    rows: list[dict[str, Any]],
    *,
    price_col: str | None = None,
    sales_col: str | None = None,
    revenue_col: str | None = None,
    brand_col: str | None = None,
    bins: int = 8,
) -> dict[str, Any]:
    if not rows:
        raise ValueError("Input contains no product rows")

    headers = list(rows[0].keys())
    p_col = price_col or detect_column(headers, ["price", "preco", "preço", "售价", "价格", "unit_price", "sale_price"])
    s_col = sales_col or detect_column(headers, ["monthly_sales", "sales", "sold", "vendas", "月销量", "销量", "units"])
    r_col = revenue_col or detect_column(headers, ["monthly_revenue", "revenue", "gmv", "faturamento", "月销售额", "销售额"])
    b_col = brand_col or detect_column(headers, ["brand", "shop", "seller", "loja", "store", "品牌", "店铺", "title", "name"])

    if not p_col:
        raise ValueError(f"Could not detect price column from headers: {headers}")
    if not s_col and not r_col:
        raise ValueError(f"Could not detect sales or revenue column from headers: {headers}")

    records: list[dict[str, Any]] = []
    skipped = 0
    for idx, row in enumerate(rows):
        price = parse_number(row.get(p_col))
        sales = parse_number(row.get(s_col)) if s_col else None
        revenue = parse_number(row.get(r_col)) if r_col else None

        if price is None or price <= 0:
            skipped += 1
            continue
        if revenue is None and sales is not None and sales >= 0:
            revenue = price * sales
        elif sales is None and revenue is not None and revenue >= 0:
            sales = revenue / price

        if sales is None or revenue is None or sales < 0 or revenue < 0:
            skipped += 1
            continue

        entity = str(row.get(b_col) or f"item-{idx + 1}").strip() if b_col else f"item-{idx + 1}"
        records.append({
            "entity": entity or f"item-{idx + 1}",
            "price": price,
            "sales": sales,
            "revenue": revenue,
        })

    if not records:
        raise ValueError("No valid rows remained after numeric cleaning")

    total_units = sum(r["sales"] for r in records)
    total_gmv = sum(r["revenue"] for r in records)
    prices = sorted(r["price"] for r in records)

    # Concentration by entity (brand/shop/listing) using GMV share
    entity_gmv: dict[str, float] = defaultdict(float)
    entity_units: dict[str, float] = defaultdict(float)
    for r in records:
        entity_gmv[r["entity"]] += r["revenue"]
        entity_units[r["entity"]] += r["sales"]

    ranked_entities = sorted(entity_gmv.items(), key=lambda kv: kv[1], reverse=True)
    shares = [(gmv / total_gmv) if total_gmv > 0 else 0.0 for _, gmv in ranked_entities]
    cr3 = sum(shares[:3])
    cr10 = sum(shares[:10])
    hhi = sum((s * 100.0) ** 2 for s in shares)

    # Unsmoothed price-band histogram & trough detection
    min_p = prices[0]
    max_p = prices[-1]
    effective_bins = max(3, min(bins, len(records)))
    price_bands: list[dict[str, Any]] = []
    troughs: list[dict[str, Any]] = []

    if max_p > min_p:
        width = (max_p - min_p) / effective_bins
        for i in range(effective_bins):
            lo = min_p + i * width
            hi = min_p + (i + 1) * width
            bucket = [
                r for r in records
                if (lo <= r["price"] < hi) or (i == effective_bins - 1 and lo <= r["price"] <= hi)
            ]
            b_gmv = sum(r["revenue"] for r in bucket)
            b_units = sum(r["sales"] for r in bucket)
            price_bands.append({
                "band": f"{lo:.2f}-{hi:.2f}",
                "min": round(lo, 2),
                "max": round(hi, 2),
                "listing_count": len(bucket),
                "units": round(b_units, 2),
                "gmv": round(b_gmv, 2),
                "gmv_share": round((b_gmv / total_gmv) if total_gmv > 0 else 0.0, 4),
            })

        # Unsmoothed trough: a band with noticeably lower supply/GMV than both nearest active left & right shoulders
        for i in range(1, len(price_bands) - 1):
            cur_b = price_bands[i]
            left_active = next((price_bands[j] for j in range(i - 1, -1, -1) if price_bands[j]["listing_count"] > cur_b["listing_count"]), None)
            right_active = next((price_bands[j] for j in range(i + 1, len(price_bands)) if price_bands[j]["listing_count"] > cur_b["listing_count"]), None)
            if left_active is None or right_active is None:
                continue
            neighbor_avg_gmv = (left_active["gmv"] + right_active["gmv"]) / 2.0
            if cur_b["gmv"] < neighbor_avg_gmv * 0.5:
                troughs.append({
                    "band": cur_b["band"],
                    "listing_count": cur_b["listing_count"],
                    "gmv": cur_b["gmv"],
                    "neighbor_avg_gmv": round(neighbor_avg_gmv, 2),
                    "reason": "unsmoothed_supply_trough_between_active_bands",
                })
    else:
        price_bands.append({
            "band": f"{min_p:.2f}-{max_p:.2f}",
            "min": round(min_p, 2),
            "max": round(max_p, 2),
            "listing_count": len(records),
            "units": round(total_units, 2),
            "gmv": round(total_gmv, 2),
            "gmv_share": 1.0,
        })

    if cr10 < 0.40:
        structure = "fragmented_easy_entry"
    elif cr10 < 0.65:
        structure = "moderately_concentrated_differentiation_needed"
    else:
        structure = "highly_concentrated_high_barrier"

    confidence = "low_sample" if len(records) < 15 else "standard"
    verdict = "cautious_validate"
    if confidence == "standard" and cr10 < 0.55 and total_gmv > 0:
        verdict = "recommended_entry"
    elif cr10 >= 0.75:
        verdict = "not_recommended_monopoly"

    return {
        "detected_columns": {"price": p_col, "sales": s_col, "revenue": r_col, "entity": b_col},
        "sample_size": len(records),
        "skipped_rows": skipped,
        "confidence": confidence,
        "market_capacity": {
            "total_monthly_units": round(total_units, 2),
            "total_monthly_gmv": round(total_gmv, 2),
            "avg_price": round(statistics.mean(prices), 2),
            "weighted_avg_price": round((total_gmv / total_units) if total_units > 0 else 0.0, 2),
        },
        "price_quantiles": {
            "min": round(prices[0], 2),
            "p10": round(quantile(prices, 0.10), 2),
            "p25": round(quantile(prices, 0.25), 2),
            "p50": round(quantile(prices, 0.50), 2),
            "p75": round(quantile(prices, 0.75), 2),
            "p90": round(quantile(prices, 0.90), 2),
            "max": round(prices[-1], 2),
        },
        "concentration": {
            "unique_entities": len(ranked_entities),
            "cr3": round(cr3, 4),
            "cr10": round(cr10, 4),
            "hhi": round(hhi, 1),
            "structure": structure,
            "top_entities": [
                {"entity": name, "gmv": round(gmv, 2), "share": round((gmv / total_gmv) if total_gmv > 0 else 0.0, 4)}
                for name, gmv in ranked_entities[:10]
            ],
        },
        "price_bands": price_bands,
        "price_troughs": troughs,
        "verdict": verdict,
    }


def format_markdown(res: dict[str, Any]) -> str:
    cap = res["market_capacity"]
    q = res["price_quantiles"]
    c = res["concentration"]
    lines = [
        "# 市场分析量化结果（脚本实算）",
        "",
        f"- 有效样本：**{res['sample_size']}** 条（跳过无效行 {res['skipped_rows']} 条，置信度：`{res['confidence']}`）",
        f"- 综合判定：**{res['verdict']}**（市场结构：`{c['structure']}`）",
        "",
        "## 市场容量与集中度",
        "| 指标 | 数值 |",
        "|---|---|",
        f"| 月总销量 | {cap['total_monthly_units']:,.2f} |",
        f"| 月总 GMV | {cap['total_monthly_gmv']:,.2f} |",
        f"| 均价 / 加权均价 | {cap['avg_price']:.2f} / {cap['weighted_avg_price']:.2f} |",
        f"| 价格分位 (P25 / P50 / P75) | {q['p25']:.2f} / {q['p50']:.2f} / {q['p75']:.2f} |",
        f"| CR3 / CR10 / HHI | {c['cr3']*100:.1f}% / {c['cr10']*100:.1f}% / {c['hhi']:.1f} |",
        "",
        "## 价格带分布",
        "| 价格区间 | 商品数 | 销量 | GMV | GMV占比 |",
        "|---|---:|---:|---:|---:|",
    ]
    for b in res["price_bands"]:
        lines.append(f"| {b['band']} | {b['listing_count']} | {b['units']:,.0f} | {b['gmv']:,.2f} | {b['gmv_share']*100:.1f}% |")
    if res["price_troughs"]:
        lines.append("")
        lines.append("## 检测到的不平滑价格带波谷")
        for t in res["price_troughs"]:
            lines.append(f"- **{t['band']}**：当前仅 {t['listing_count']} 个商品（GMV {t['gmv']:,.2f}，相邻区间均值 {t['neighbor_avg_gmv']:,.2f}）")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Deterministic cross-border market CSV/JSON analyzer.")
    parser.add_argument("--input", required=True, help="Path to CSV or JSON product export")
    parser.add_argument("--price-col", default=None, help="Explicit price column name")
    parser.add_argument("--sales-col", default=None, help="Explicit monthly sales column name")
    parser.add_argument("--revenue-col", default=None, help="Explicit monthly revenue/GMV column name")
    parser.add_argument("--brand-col", default=None, help="Explicit brand/shop entity column name")
    parser.add_argument("--bins", type=int, default=8, help="Number of price bands (default: 8)")
    parser.add_argument("--format", choices=["json", "markdown"], default="json")
    args = parser.parse_args(argv)

    rows = load_rows(Path(args.input))
    result = analyze_market(
        rows,
        price_col=args.price_col,
        sales_col=args.sales_col,
        revenue_col=args.revenue_col,
        brand_col=args.brand_col,
        bins=args.bins,
    )
    if args.format == "markdown":
        print(format_markdown(result))
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
