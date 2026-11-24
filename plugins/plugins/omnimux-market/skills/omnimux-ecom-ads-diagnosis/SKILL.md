---
name: omnimux-ecom-ads-diagnosis
disable-model-invocation: true
description: "跨境电商广告诊断与定向回流优化：根据广告导出报表与毛利率，脚本核算盈亏线 ROAS、最大可承受 CPC 与五层转化漏斗（曝光→CTR→加购→CVR→ROAS），精准隔离转化瓶颈而非盲目换主图，输出 P0/P1/P2 人工审批动作清单与定向回流指令。触发：广告诊断、ROAS分析、CPC测算、投流优化、ACOS优化、广告复盘、ads diagnosis。"
---

# Cross-Border Ads Funnel Diagnosis & Targeted Creative Feedback

## Overview
用确定性脚本将广告导出表（Shopee Ads / Amazon PPC / TikTok Ads / Meta Ads）与商品广告前毛利率结合，算出盈亏平衡 ROAS 与最大可承受 CPC，按五层漏斗逐层查病因，防止「转化率问题却去改主图」的常见误诊，输出 P0/P1/P2 审批清单及定向回流单。

## When to Use
- 投放 7–14 天后广告亏损或 ROAS 停滞，需要定位究竟是「曝光 / 点击 / 加购 / 转化 / 出价」哪一层出了问题；
- 需要精确知道盈亏平衡 ROAS、最大可承受 CPC 与减损止血顺序；
- 需要给下游文案/主图/视频专家派发「只改症状节点」的回流工单。

## Workflow
1. **核实广告前毛利率**：优先读取 `omnimux-ecom-pricing-strategy` 算出的 `pre_ad_margin_pct`（未含广告费前的净边际贡献率），严禁拿含广告后的净利率直接倒算盈亏 ROAS。
2. **运行漏斗诊断脚本**：执行 `scripts/diagnose_ads.py`，算出每个广告组/活动的实际 CTR、ATC 率、CVR、CPC、CPA、ROAS、盈亏线 ROAS 与最大可承受 CPC。
3. **五层漏斗精准定因**：
   - 曝光极低 → 出价/匹配/预算受限（`low_impressions`）；
   - CTR 低 → 首图 / 标题前 35 字 / 价格带不匹配（回流 `ecom-visual-studio` / `ecom-listing-copy`）；
   - CTR 正常或偏高但加购/CVR 低 → **明确判定为商详转化、价格/运费门槛、或评论信任瓶颈，而非主图点击瓶颈**（回流 `ecom-listing-copy` / `ecom-review-voc` / `ecom-product-strategy`）；
   - CVR 健康但 ROAS 低于盈亏线 → CPC 过高或 AOV 偏低（调整出价上限或推组合装）。
4. **输出分级审批清单与定向回流单**：按 P0（立即止血）/ P1（结构优化）/ P2（放量扩词）分级，交给用户审批执行。

## Deterministic Scripts
```bash
python3 skills/omnimux-ecom-ads-diagnosis/scripts/diagnose_ads.py \
  --input <ads_report.csv> \
  --price 79.9 \
  --pre-ad-margin-pct 32 \
  --platform shopee \
  --format json
```

## Compliance & Boundaries
- **严禁代操作广告后台**：不自动调出价、不自动关停计划、不绕过卖家中心授权；所有调优以人工可审批清单输出；
- 样本量过小（如点击 `< 30` 或曝光 `< 500`）时必须标记 `insufficient_data`，不匆忙判死刑；
- 定向回流仅修改诊断指向的具体字段或单张素材，非症状环节保持冻结不动。

## Output Format
```markdown
# 广告漏斗诊断与调优清单（{平台}）
## 1. 盈亏基线（脚本实算）
- 广告前毛利率 / 盈亏平衡 ROAS / 目标 ROAS / 最大可承受 CPC
## 2. 活动级五层漏斗诊断表
| 计划/广告组 | 曝光 | CTR | 加购率 | CVR | CPC | ROAS | 瓶颈判定 | 优先级 |
## 3. P0 / P1 / P2 人工审批动作清单（不代改后台）
## 4. 定向回流工单（仅改症状环节）
```
