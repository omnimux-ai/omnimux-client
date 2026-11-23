---
name: omnimux-ecom-market-research
description: "跨境电商类目市场分析与竞品选品调研：清洗巴西/美式/中文万单位导出 CSV/JSON，脚本确定性计算月容量、CR3/CR10/HHI 集中度与不平滑价格带波谷，结合 OmniMux 社媒数据与对标工具产出可验证选品结论。触发：市场分析、选品分析、类目分析、价格带、CR10、竞争格局、竞品调研、market research。"
---

# Cross-Border Market Research & Category Analysis

## Overview
将类目导出数据（Shopee / Amazon / TikTok Shop / Mercado Livre CSV/JSON）与公开社媒需求信号结合，通过确定性 Python 脚本完成全部清洗与算术统计，输出可进入性结论、价格带机会与竞品拆解，杜绝模型心算误差。

## When to Use
- 拿到类目商品排行导出表（CSV/JSON），需要评估市场容量、垄断度（CR3/CR10/HHI）与价格带切入机会；
- 需要结合社媒公开讨论与 TikTok Shop 商品评价做需求佐证；
- 需要为下一步「产品定位与定价策略」准备量化市场基线。

## Data Sources & OmniMux Tools
- **类目导出表**：本地 CSV / JSON（经 `scripts/analyze_market.py` 确定性处理，不心算）。
- **社媒需求与竞品补充**：按需加载 `omnimux-product-demand` / `omnimux-competitor-research`，调用 `omnimux_tiktok_shop_search`、`omnimux_social_data`、`inspiration_rival_*`（仅限公开数据，无数据缺口须如实声明）。

## Workflow
1. **核对字段与币种**：确认输入文件路径、目标站点/平台（参考 `omnimux-ecom-platform-rules`）、价格与月销字段。
2. **运行确定性脚本**：执行本 Skill 下的 `scripts/analyze_market.py`，拿到月销量/月 GMV、价格分位数、CR3/CR10/HHI 与不平滑价格带波谷。
3. **竞争格局解读**：
   - `CR10 < 40%`：高度分散，新品易切入；
   - `40% <= CR10 < 65%`：中度集中，需靠差异化卖点或价格带空白切入；
   - `CR10 >= 65%`：头部垄断，谨慎进入或寻找细分场景。
4. **价格带空白验证**：检查脚本输出的波谷区间（相邻高活跃区间之间的低供给带），交叉核对是否真的存在买家需求而非无效价位。
5. **交接下游契约**：总结目标价格带、TOP 竞品共性痛点与差异化切入方向，供「定价专家」直接承接。

## Deterministic Scripts
```bash
python3 skills/omnimux-ecom-market-research/scripts/analyze_market.py \
  --input <market.csv> \
  --bins 8 \
  --format json
```
- 兼容巴西/欧洲小数（`R$ 1.299,90`）、美式数字（`$49.99`、`1,234`）、中文单位（`1.5万`、`3.2千`）与加号后缀（`10mil+`、`5k+`）。
- 支持显式列指定：`--price-col`、`--sales-col`、`--revenue-col`、`--brand-col`、`--shop-col`。

## Compliance & Boundaries
- 严禁心算汇总指标或篡改脚本输出数字；
- 样本量不足（如有效记录 `< 15` 条）必须标明「低置信度样本」，不得外推全站容量；
- 社媒补充数据严守「公开数据 only」，缺口不编造。

## Output Format
```markdown
# 市场与竞品分析报告：{类目 / 站点}
## 1. 可进入性结论
- 结论：建议进入 / 谨慎验证 / 不建议进入（附样本数与置信度）
## 2. 核心量化指标（脚本实算）
| 指标 | 数值 | 解读 |
## 3. 价格带分布与波谷机会
## 4. TOP 竞品格局与差异化切口
## 5. 下游交接契约（传产品定位与定价）
- 目标定价区间 / 参考竞品痛点 / 需核实假设
```
