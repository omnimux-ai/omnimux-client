#!/usr/bin/env python3
"""Deterministic cross-border SKU unit-economics & coupon headroom calculator.

Pure Python 3 stdlib. Zero third-party dependencies.
Computes fixed landed cost, percentage deductions (commission, payment, promo,
tax, returns, ad reserve), net profit, net margin, break-even price, target-margin
minimum price, and safe coupon discount headroom.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any


VALID_ROLES = {"traffic_hook", "core_profit", "bundle_upsell", "anchor_high"}


def _to_float(val: Any, default: float = 0.0) -> float:
    if val is None or val == "":
        return default
    return float(val)


def calculate_sku(item: dict[str, Any]) -> dict[str, Any]:
    sku = str(item.get("sku") or "SKU-1").strip()
    role = str(item.get("role") or "core_profit").strip()
    price = _to_float(item.get("price"))
    if price <= 0:
        raise ValueError(f"{sku}: price must be > 0, got {price}")

    cogs = _to_float(item.get("cogs"))
    first_mile = _to_float(item.get("first_mile"))
    shipping = _to_float(item.get("shipping"))
    fixed_platform_fee = _to_float(item.get("fixed_platform_fee"))
    packaging = _to_float(item.get("packaging"))
    fixed_cost = cogs + first_mile + shipping + fixed_platform_fee + packaging

    commission_pct = _to_float(item.get("commission_pct"))
    payment_pct = _to_float(item.get("payment_pct"))
    promo_fee_pct = _to_float(item.get("promo_fee_pct"))
    tax_pct = _to_float(item.get("tax_pct"))
    return_pct = _to_float(item.get("return_pct"))
    ad_pct = _to_float(item.get("ad_pct"))
    target_margin_pct = _to_float(item.get("target_margin_pct"), 15.0)

    total_pct = commission_pct + payment_pct + promo_fee_pct + tax_pct + return_pct + ad_pct
    if total_pct >= 100.0:
        raise ValueError(f"{sku}: combined percentage deductions ({total_pct:.2f}%) must be < 100%")

    rate_before_ads = (commission_pct + payment_pct + promo_fee_pct + tax_pct + return_pct) / 100.0
    total_rate = total_pct / 100.0
    target_rate = target_margin_pct / 100.0

    variable_deductions = price * total_rate
    net_profit = price - fixed_cost - variable_deductions
    net_margin = net_profit / price

    # Contribution before ad spend (used by ads diagnosis for break-even ROAS)
    pre_ad_profit = price * (1.0 - rate_before_ads) - fixed_cost
    pre_ad_margin = pre_ad_profit / price
    break_even_roas = (1.0 / pre_ad_margin) if pre_ad_margin > 0 else None

    break_even_price = fixed_cost / (1.0 - total_rate)

    if total_rate + target_rate < 1.0:
        min_price_for_target = fixed_cost / (1.0 - total_rate - target_rate)
        coupon_headroom_amount = max(0.0, price - min_price_for_target)
        coupon_headroom_pct = (coupon_headroom_amount / price) * 100.0
    else:
        min_price_for_target = None
        coupon_headroom_amount = 0.0
        coupon_headroom_pct = 0.0

    warnings: list[str] = []
    if role not in VALID_ROLES:
        warnings.append(f"unrecognized_role:{role}")
    if net_profit < 0:
        warnings.append("selling_below_break_even")
    elif net_margin * 100.0 < target_margin_pct:
        warnings.append("below_target_margin")
    if coupon_headroom_pct < 5.0 and role in {"core_profit", "anchor_high"}:
        warnings.append("low_coupon_headroom")

    return {
        "sku": sku,
        "role": role,
        "price": round(price, 2),
        "fixed_cost": round(fixed_cost, 2),
        "total_deduction_pct": round(total_pct, 2),
        "variable_deductions": round(variable_deductions, 2),
        "net_profit": round(net_profit, 2),
        "net_margin_pct": round(net_margin * 100.0, 2),
        "pre_ad_margin_pct": round(pre_ad_margin * 100.0, 2),
        "break_even_roas": round(break_even_roas, 2) if break_even_roas is not None else None,
        "break_even_price": round(break_even_price, 2),
        "target_margin_pct": round(target_margin_pct, 2),
        "min_price_for_target_margin": round(min_price_for_target, 2) if min_price_for_target is not None else None,
        "coupon_headroom_amount": round(coupon_headroom_amount, 2),
        "coupon_headroom_pct": round(coupon_headroom_pct, 2),
        "status": "healthy" if not warnings else ("loss" if net_profit < 0 else "tight"),
        "warnings": warnings,
    }


def load_batch(path: Path) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8-sig")
    if path.suffix.lower() == ".json":
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict) and isinstance(parsed.get("skus"), list):
            return parsed["skus"]
        raise ValueError("JSON input must be a list of SKUs or {skus: [...]}")
    reader = csv.DictReader(text.splitlines())
    return [dict(row) for row in reader if any(str(v or "").strip() for v in row.values())]


def format_markdown(results: list[dict[str, Any]]) -> str:
    lines = [
        "# SKU 单元经济与定价核算表（脚本实算）",
        "",
        "| SKU | 角色 | 售价 | 固定成本 | 费率合计 | 净利 | 净利率 | 盈亏价 | 盈亏ROAS | 安全券余量 | 状态 |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for r in results:
        roas = f"{r['break_even_roas']:.2f}" if r["break_even_roas"] is not None else "N/A"
        lines.append(
            f"| {r['sku']} | {r['role']} | {r['price']:.2f} | {r['fixed_cost']:.2f} | "
            f"{r['total_deduction_pct']:.1f}% | {r['net_profit']:.2f} | {r['net_margin_pct']:.1f}% | "
            f"{r['break_even_price']:.2f} | {roas} | {r['coupon_headroom_amount']:.2f} ({r['coupon_headroom_pct']:.1f}%) | {r['status']} |"
        )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Deterministic cross-border SKU pricing & margin calculator.")
    parser.add_argument("--input", default=None, help="Optional JSON/CSV batch input file")
    parser.add_argument("--sku", default="SKU-1")
    parser.add_argument("--role", default="core_profit")
    parser.add_argument("--price", type=float, default=None)
    parser.add_argument("--cogs", type=float, default=0.0)
    parser.add_argument("--first-mile", type=float, default=0.0)
    parser.add_argument("--shipping", type=float, default=0.0)
    parser.add_argument("--fixed-platform-fee", type=float, default=0.0)
    parser.add_argument("--packaging", type=float, default=0.0)
    parser.add_argument("--commission-pct", type=float, default=0.0)
    parser.add_argument("--payment-pct", type=float, default=0.0)
    parser.add_argument("--promo-fee-pct", type=float, default=0.0)
    parser.add_argument("--tax-pct", type=float, default=0.0)
    parser.add_argument("--return-pct", type=float, default=0.0)
    parser.add_argument("--ad-pct", type=float, default=0.0)
    parser.add_argument("--target-margin-pct", type=float, default=15.0)
    parser.add_argument("--format", choices=["json", "markdown"], default="json")
    args = parser.parse_args(argv)

    if args.input:
        items = load_batch(Path(args.input))
    else:
        if args.price is None:
            parser.error("Either --input or --price is required")
        items = [{
            "sku": args.sku,
            "role": args.role,
            "price": args.price,
            "cogs": args.cogs,
            "first_mile": args.first_mile,
            "shipping": args.shipping,
            "fixed_platform_fee": args.fixed_platform_fee,
            "packaging": args.packaging,
            "commission_pct": args.commission_pct,
            "payment_pct": args.payment_pct,
            "promo_fee_pct": args.promo_fee_pct,
            "tax_pct": args.tax_pct,
            "return_pct": args.return_pct,
            "ad_pct": args.ad_pct,
            "target_margin_pct": args.target_margin_pct,
        }]

    results = [calculate_sku(it) for it in items]
    if args.format == "markdown":
        print(format_markdown(results))
    else:
        payload = results[0] if (not args.input and len(results) == 1) else {"skus": results}
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
