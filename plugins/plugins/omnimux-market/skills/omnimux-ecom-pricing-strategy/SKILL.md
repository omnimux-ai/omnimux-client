---
name: omnimux-ecom-pricing-strategy
disable-model-invocation: true
description: "跨境电商产品定位、SKU 角色矩阵与含税单元经济定价：脚本精算采购/头程/佣金/免运/税费/广告预留下的净利率、盈亏平衡价与优惠券余量，收敛唯一核心卖点并沉淀进 OmniMux 商品库。触发：定价策略、毛利测算、盈亏价、SKU矩阵、产品定位、核心卖点、pricing strategy、coupon headroom。"
---

# Cross-Border Product Positioning & Unit-Economics Pricing

## Overview
将市场机会收敛为可执行的产品定位与定价方案：先锁定「唯一核心卖点（`core_selling_point`）+ 禁用词清单（`forbidden_words`）+ 参数真源（`spec_table`）」，再通过 Python 脚本精算含税单元经济（净利率、盈亏价、发券余量），最后沉淀到 OmniMux 商品库（`products_*`）作为全链路唯一真源。

## When to Use
- 新品上架前测算定价、含税净利率、盈亏平衡价与优惠券安全余量；
- 规划多变体 SKU 四角色（引流款 / 利润核心款 / 组合加购款 / 价格锚点款）；
- 需要为下游 Listing 文案、主图、短视频锁定 `core_selling_point`、`spec_table` 与 `forbidden_words`。

## OmniMux Tools Integration
- 读取或更新商品真源：`products_list` / `products_get` / `products_create` / `products_update`（以当前会话 Tool Registry 实际已注册的 `products_*` 工具为准，写库前先请用户确认关键参数）。

## Workflow
1. **收集真实成本与费率**：采购价、头程物流、本地仓配/尾程固定费、平台佣金率、活动/免运率、支付手续费率、税率、退货损耗率、广告 TACOS 预留（参考 `omnimux-ecom-platform-rules`）。
2. **运行定价脚本**：调用 `scripts/calc_pricing.py` 计算每个 SKU 的净利、净利率、盈亏平衡价、目标毛利对应最低售价与最大安全发券折扣（严禁心算）。
3. **收敛唯一核心卖点**：从痛点与产品真参数中只选 **1 个** 主打核心卖点，其余作为次级支撑，明确写出 `forbidden_words`。
4. **SKU 四角色校验**：确保引流款不击穿盈亏线、核心利润款有足够广告与发券余量。
5. **沉淀商品库**：用户确认后写入商品库，将 `spec_table`、`core_selling_point` 与 `forbidden_words` 冻结传递给下游环节。

## Deterministic Scripts
```bash
# 单 SKU 快速核算
python3 skills/omnimux-ecom-pricing-strategy/scripts/calc_pricing.py \
  --price 79.9 --cogs 22 --shipping 8 --commission-pct 20 \
  --payment-pct 2 --tax-pct 6 --return-pct 3 --ad-pct 12 \
  --target-margin-pct 15 --format json

# 批量 SKU 矩阵核算（JSON 数组或 CSV）
python3 skills/omnimux-ecom-pricing-strategy/scripts/calc_pricing.py \
  --input <skus.json> --format markdown
```

## Compliance & Boundaries
- 所有成本若为估算值必须标明「假设」，不伪装成已核实财务数据；
- 严禁通过虚假抬高划线原价制造违规划价折扣；
- 费率合计 `>= 100%` 时脚本直接报错阻断，不得强行输出负数或虚高售价。

## Output Format
```markdown
# 产品定位与定价方案：{产品名 / 站点}
## 1. 定位冻结契约（同步下游真源）
- core_selling_point：...
- forbidden_words：[...]
- spec_table：{...}
## 2. SKU 单元经济核算表（脚本实算）
| SKU | 角色 | 售价 | 固定成本 | 费率合计 | 净利 | 净利率 | 盈亏价 | 最大发券余量 |
## 3. 风险项与商品库同步确认
```
