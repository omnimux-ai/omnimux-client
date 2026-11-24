---
name: omnimux-ecom-review-voc
disable-model-invocation: true
description: "跨境电商评论 VOC 挖掘、8 类差评归因与合规售后话术：脚本统计差评 8 类归因并保证总条数守恒、测算可通过改文案/补图修复的误解型差评占比、提取好评卖点排行，输出可直接粘贴的商详防误解补丁与多语合规回复话术。触发：评论分析、差评归因、VOC分析、售后话术、误解型差评、买家评价、review voc。"
---

# Cross-Border Review VOC, 8-Cause Attribution & Compliant Replies

## Overview
将买家评论导出表（或 TikTok Shop 公开评价样本）交给确定性脚本，对中差评（1–3 星）做严格 8 类归因与总条数守恒校验，精准隔离出**可通过改详情页文案或补一张提示图立即修复的「误解型差评」**，并输出防误解补丁与零违规多语售后回复话术。

## When to Use
- 店铺或竞品积累了一批买家评论（CSV/JSON），需要查清差评主因与好评核心卖点；
- 需要定量判断差评中有多少比例能靠「改商详/补尺寸图/放包装提示卡」低成本解决；
- 需要生成符合平台政策的 EN / PT-BR / ES / 中文差评回复模板。

## Data Sources & OmniMux Tools
- **评论导出表**：本地 CSV / JSON（经 `scripts/analyze_reviews.py` 确定性统计）；
- **公开评价补充**：如需拉取 TikTok Shop 公开商品评价，可调用 `omnimux_social_data(platform="tiktok", capability="shop_reviews", ...)` 并明确标注来源为 TikTok Shop 公开样本（无 Reddit 或社媒评论正文时诚实声明缺口）。

## Workflow
1. **运行 VOC 归因脚本**：执行 `scripts/analyze_reviews.py`，校验 `sum(8类差评) == total_negative`，拿到每类差评占比、**可修复误解型占比（`fixable_misunderstanding_rate`）** 与好评高频卖点词。
2. **输出定向防误解补丁**：
   - `size_mismatch` → 商详补实测尺寸对照图 + 参照物对比（回流 `ecom-visual-studio`）；
   - `usage_misunderstanding` / `compatibility_issue` → 商详第 6 段补「3 步正确用法 & 不适用场景清单」+ 包装插页提示卡（回流 `ecom-listing-copy`）；
   - `expectation_gap` → 删除夸张形容词，改用真实场景实拍图；
   - `quality_defect` / `shipping_damage` / `missing_parts` → 输出供应链/打包质检改进单（不靠文案掩盖真品质缺陷）。
3. **撰写多语合规售后回复**：共情确认 → 给出具体解决路径（换货/补发/指引）→ 引导联系站内客服，绝不诱导删评或返现改评。

## Deterministic Scripts
```bash
python3 skills/omnimux-ecom-review-voc/scripts/analyze_reviews.py \
  --input <reviews.csv> \
  --format json
```

## Compliance & Boundaries
- **严禁诱导修改/删除差评、严禁现金/优惠券换好评、严禁站外引流联系方式**；
- 必须确保 8 类差评合计数与实际差评总数完全相等，不得漏算或重复归类；
- 评论数据缺口诚实声明，绝不编造虚假用户原话。

## Output Format
```markdown
# 评论 VOC 与防误解修复报告：{产品名}
## 1. 样本与可修复误解型占比（脚本实算，总条数守恒）
## 2. 8 类差评归因表（类别 / 条数 / 占比 / 可否文案或视觉修复 / 代表原话）
## 3. 好评高频核心卖点排行
## 4. 可直接粘贴的商详防误解补丁 & 视觉补图需求
## 5. 合规多语售后回复话术模板
```
