#!/usr/bin/env python3
"""Deterministic 5-layer cross-border ad funnel diagnostician.

Pure Python 3 stdlib. Zero third-party dependencies.
Computes break-even ROAS, target ROAS, max sustainable CPC, and diagnoses
Impressions -> CTR -> ATC -> CVR -> ROAS bottlenecks without misattributing
conversion problems to main-image CTR issues.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any


PLATFORM_BENCHMARKS: dict[str, dict[str, float]] = {
    "shopee": {"min_ctr": 0.015, "min_atc": 0.08, "min_cvr": 0.025},
    "amazon": {"min_ctr": 0.004, "min_atc": 0.08, "min_cvr": 0.08},
    "tiktok_shop": {"min_ctr": 0.012, "min_atc": 0.06, "min_cvr": 0.02},
    "mercado_livre": {"min_ctr": 0.010, "min_atc": 0.07, "min_cvr": 0.03},
}


def _f(row: dict[str, Any], *keys: str, default: float = 0.0) -> float:
    lowered = {k.strip().lower(): v for k, v in row.items()}
    for k in keys:
        if k in lowered and str(lowered[k]).strip() != "":
            s = str(lowered[k]).strip().replace(",", "").replace("%", "").replace("$", "").replace("R$", "")
            try:
                return float(s)
            except ValueError:
                continue
    return default


def load_campaigns(path: Path) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8-sig")
    if path.suffix.lower() == ".json":
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict) and isinstance(parsed.get("campaigns"), list):
            return parsed["campaigns"]
        raise ValueError("JSON input must be a list of campaigns or {campaigns: [...]}")
    first = text.splitlines()[0] if text.splitlines() else ""
    delim = ";" if first.count(";") > first.count(",") else ","
    return [dict(r) for r in csv.DictReader(text.splitlines(), delimiter=delim) if any(str(v or "").strip() for v in r.values())]


def diagnose_campaign(
    row: dict[str, Any],
    *,
    price: float,
    pre_ad_margin_pct: float,
    target_profit_pct: float = 10.0,
    platform: str = "shopee",
) -> dict[str, Any]:
    plat = platform.lower().strip()
    if plat not in PLATFORM_BENCHMARKS:
        raise ValueError(f"Unsupported platform '{platform}'")
    bench = PLATFORM_BENCHMARKS[plat]

    if pre_ad_margin_pct <= 0 or pre_ad_margin_pct >= 100:
        raise ValueError(f"pre_ad_margin_pct must be between 0 and 100, got {pre_ad_margin_pct}")

    pre_ad_margin = pre_ad_margin_pct / 100.0
    break_even_roas = 1.0 / pre_ad_margin
    net_ad_budget_ratio = max(0.02, pre_ad_margin - (target_profit_pct / 100.0))
    target_roas = 1.0 / net_ad_budget_ratio

    name = str(row.get("campaign") or row.get("name") or row.get("ad_group") or "Campaign").strip()
    impressions = _f(row, "impressions", "impr", "曝光", "曝光量")
    clicks = _f(row, "clicks", "点击", "点击量")
    atc = _f(row, "atc", "add_to_cart", "加购", "加购数", default=-1.0)
    orders = _f(row, "orders", "conversions", "订单", "转化数")
    spend = _f(row, "spend", "cost", "花费", "广告花费")
    revenue = _f(row, "revenue", "gmv", "sales", "销售额", "广告销售额")
    if revenue <= 0 and orders > 0 and price > 0:
        revenue = orders * price

    ctr = (clicks / impressions) if impressions > 0 else 0.0
    atc_rate = (atc / clicks) if (clicks > 0 and atc >= 0) else None
    cvr = (orders / clicks) if clicks > 0 else 0.0
    cpc = (spend / clicks) if clicks > 0 else 0.0
    cpa = (spend / orders) if orders > 0 else None
    roas = (revenue / spend) if spend > 0 else 0.0
    aov = (revenue / orders) if orders > 0 else price
    max_cpc = aov * cvr * pre_ad_margin if cvr > 0 else (price * bench["min_cvr"] * pre_ad_margin)

    # 5-layer bottleneck isolation (strict order: data sufficiency -> impressions -> CTR -> ATC/CVR -> CPC/ROAS)
    if impressions < 500 and clicks < 30:
        bottleneck = "insufficient_data"
        priority = "P2"
        route_to = None
        action = "样本量不足（曝光<500 且点击<30），保持观察或小幅提价拿够测试样本，暂不改素材。"
        not_to_touch = ["main_image", "listing_copy", "video_script"]
    elif impressions < 500:
        bottleneck = "low_impressions"
        priority = "P1"
        route_to = "ecom-listing-copy"
        action = "曝光不足：复核关键词相关度、出价竞争力与预算上限；确认标题核心词覆盖。"
        not_to_touch = ["detail_body", "pricing"]
    elif ctr < bench["min_ctr"]:
        bottleneck = "ctr_bottleneck"
        priority = "P0" if spend > 0 and roas < break_even_roas else "P1"
        route_to = "ecom-visual-studio"
        action = f"点击率瓶颈（CTR {ctr*100:.2f}% < 基准 {bench['min_ctr']*100:.2f}%）：定向优化首图主体清晰度、标题前 35 字与搜索词匹配，或短视频前 3 秒 Hook。"
        not_to_touch = ["detail_page_lower_sections", "after_sales_copy"]
    elif cvr < bench["min_cvr"]:
        # High/healthy CTR + low CVR => NEVER blame main image CTR; isolate Listing/Price/Trust!
        if atc_rate is not None and atc_rate >= bench["min_atc"]:
            bottleneck = "checkout_or_price_bottleneck"
            route_to = "ecom-product-strategy"
            action = f"高加购低成交（CTR {ctr*100:.2f}% 正常、加购率 {atc_rate*100:.1f}% 正常，但 CVR 仅 {cvr*100:.2f}%）：排查运费/优惠券门槛、SKU 缺货或结账心理价差，切勿盲目更换主图。"
        else:
            bottleneck = "cvr_listing_trust_bottleneck"
            route_to = "ecom-listing-copy"
            action = f"转化率瓶颈而非点击率瓶颈（CTR {ctr*100:.2f}% 达标，但 CVR {cvr*100:.2f}% < 基准 {bench['min_cvr']*100:.2f}%）：定向修复详情页核心卖点承接、规格防误解说明、评价信任与价格锚点；保持现有高点击首图不动。"
        priority = "P0" if roas < break_even_roas else "P1"
        not_to_touch = ["main_image_thumbnail"]
    elif roas < break_even_roas:
        bottleneck = "cpc_bid_overpay"
        priority = "P0"
        route_to = "ecom-product-strategy"
        action = f"CTR 与 CVR 均健康，但 CPC ({cpc:.2f}) 高于最大可承受 CPC ({max_cpc:.2f}) 导致 ROAS ({roas:.2f}) < 盈亏线 ({break_even_roas:.2f})：审批下调出价/否词，或通过组合装拉高 AOV。"
        not_to_touch = ["main_image_thumbnail", "listing_copy"]
    elif roas < target_roas:
        bottleneck = "profitable_below_target"
        priority = "P1"
        route_to = None
        action = f"已过盈亏线（ROAS {roas:.2f} >= {break_even_roas:.2f}），但低于目标 ROAS ({target_roas:.2f})：精细否掉低效长尾词并分层控价。"
        not_to_touch = ["main_image_thumbnail"]
    else:
        bottleneck = "healthy_scale_candidate"
        priority = "P2"
        route_to = "ecom-video-director"
        action = f"健康盈利（ROAS {roas:.2f} >= 目标 {target_roas:.2f}）：审批阶梯扩预算（单次 <=20%）并复制高转化创意变体。"
        not_to_touch = []

    return {
        "campaign": name,
        "metrics": {
            "impressions": int(impressions),
            "clicks": int(clicks),
            "atc": int(atc) if atc >= 0 else None,
            "orders": int(orders),
            "spend": round(spend, 2),
            "revenue": round(revenue, 2),
            "ctr_pct": round(ctr * 100.0, 2),
            "atc_rate_pct": round(atc_rate * 100.0, 2) if atc_rate is not None else None,
            "cvr_pct": round(cvr * 100.0, 2),
            "cpc": round(cpc, 2),
            "max_sustainable_cpc": round(max_cpc, 2),
            "cpa": round(cpa, 2) if cpa is not None else None,
            "roas": round(roas, 2),
            "break_even_roas": round(break_even_roas, 2),
            "target_roas": round(target_roas, 2),
        },
        "diagnosis": {
            "bottleneck": bottleneck,
            "priority": priority,
            "route_to_expert": route_to,
            "approval_action": action,
            "do_not_touch": not_to_touch,
            "auto_mutate_console": False,
        },
    }


def diagnose_report(
    campaigns: list[dict[str, Any]],
    *,
    price: float,
    pre_ad_margin_pct: float,
    target_profit_pct: float = 10.0,
    platform: str = "shopee",
) -> dict[str, Any]:
    results = [
        diagnose_campaign(
            c,
            price=price,
            pre_ad_margin_pct=pre_ad_margin_pct,
            target_profit_pct=target_profit_pct,
            platform=platform,
        )
        for c in campaigns
    ]
    total_spend = sum(r["metrics"]["spend"] for r in results)
    total_rev = sum(r["metrics"]["revenue"] for r in results)
    blended_roas = round(total_rev / total_spend, 2) if total_spend > 0 else 0.0
    break_even_roas = round(100.0 / pre_ad_margin_pct, 2)
    return {
        "platform": platform,
        "summary": {
            "campaign_count": len(results),
            "total_spend": round(total_spend, 2),
            "total_revenue": round(total_rev, 2),
            "blended_roas": blended_roas,
            "break_even_roas": break_even_roas,
            "p0_count": sum(1 for r in results if r["diagnosis"]["priority"] == "P0"),
            "p1_count": sum(1 for r in results if r["diagnosis"]["priority"] == "P1"),
            "p2_count": sum(1 for r in results if r["diagnosis"]["priority"] == "P2"),
        },
        "campaigns": results,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="5-layer cross-border ad funnel diagnostician.")
    parser.add_argument("--input", required=True, help="Campaign CSV or JSON path")
    parser.add_argument("--price", type=float, required=True, help="Product selling price")
    parser.add_argument("--pre-ad-margin-pct", type=float, required=True, help="Pre-ad contribution margin (percent)")
    parser.add_argument("--target-profit-pct", type=float, default=10.0, help="Target net profit after ads (percent)")
    parser.add_argument("--platform", default="shopee", choices=sorted(PLATFORM_BENCHMARKS.keys()))
    parser.add_argument("--format", choices=["json", "markdown"], default="json")
    args = parser.parse_args(argv)

    campaigns = load_campaigns(Path(args.input))
    report = diagnose_report(
        campaigns,
        price=args.price,
        pre_ad_margin_pct=args.pre_ad_margin_pct,
        target_profit_pct=args.target_profit_pct,
        platform=args.platform,
    )
    if args.format == "markdown":
        s = report["summary"]
        lines = [
            f"# 广告五层漏斗诊断（{report['platform']}）",
            f"- 汇总花费：{s['total_spend']:.2f} · 汇总销售额：{s['total_revenue']:.2f} · 综合 ROAS：**{s['blended_roas']:.2f}**（盈亏线 **{s['break_even_roas']:.2f}**）",
            "",
            "| 计划 | CTR | CVR | CPC / 上限 | ROAS | 瓶颈判定 | 优先级 | 回流专家 |",
            "|---|---:|---:|---:|---:|---|---|---|",
        ]
        for c in report["campaigns"]:
            m = c["metrics"]
            d = c["diagnosis"]
            lines.append(
                f"| {c['campaign']} | {m['ctr_pct']:.2f}% | {m['cvr_pct']:.2f}% | "
                f"{m['cpc']:.2f}/{m['max_sustainable_cpc']:.2f} | {m['roas']:.2f} | "
                f"{d['bottleneck']} | {d['priority']} | {d['route_to_expert'] or '-'} |"
            )
        print("\n".join(lines))
    else:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
