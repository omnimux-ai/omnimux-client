---
name: omnimux-product-demand
disable-model-invocation: true
description: "从社媒公开内容验证选品与需求：找痛点、异议、替代方案、购买意向语言，产出需求信号、痛点清单、卖点角度与选品建议。用于 TikTok、Instagram、YouTube、X 与 TikTok Shop（商品/评价）。触发：选品、需求验证、痛点、痛点挖掘、product demand、这个产品有没有需求、卖点提炼、竞品评价。注意：无 Reddit、无评论正文，用搜索+商品评价+转写替代。"
---

# Product Demand Research（OmniMux 原生版）

## Overview
用公开社媒内容验证「某产品/品类有没有需求、痛点在哪、用户怎么表达」，并转成卖点与选品建议。数据层用 `omnimux-social-data`。

## When to Use
- 选品/需求验证
- 提炼痛点、异议、卖点角度
- 看某品类用户语言与替代方案

## Data Sources
- 需求信号：`omnimux_tiktok_search` / `omnimux_instagram_search` / `omnimux_youtube_search` / `omnimux_x_search`（问题式/痛点式词）
- 商品与评价：`omnimux_tiktok_shop_search(query, region)`、`omnimux_tiktok_shop_product`、`omnimux_social_data(platform="tiktok", capability="shop_reviews"|"shop_reviews_v2", url|id, region)` —— **这是本技能可用的最接近 VOC 的来源**
- 产品讲解/口播痛点：`omnimux_speech_to_text`
- 边界：**无 Reddit、无社媒评论正文**——涉及这两类的需求先说明数据缺口

## Workflow
1. **定义品类与人群**：目标品、人群、市场/地区。
2. **多源取证**：搜索痛点/疑问词 + 拉相关商品评价 + 取高互动讲解视频转写。
3. **抽信号**：痛点、异议、替代方案/凑合做法、购买意向语言、使用场景（逐字保留）。
4. **判强度**：区分「单条偶发」与「重复出现的模式」，标证据数与置信度。
5. **转卖点**：把痛点/异议映射成卖点角度与 objection-handling 说法。
6. **给选品建议**：值得做/存疑 + 理由 + 下一步验证。

## Output Format
```markdown
# 需求与选品报告：{品类}
## 结论
值得做/存疑 + 一句话理由（含置信度）
## 需求信号
- "..."
## 痛点
| 痛点 | 证据(评价/帖URL) | 频次 |
## 异议与门槛
- 异议 — 证据 — 回应角度
## 现有替代方案
## 卖点角度建议
1. ...
## 选品 / 验证建议
1. ...
## 说明
- 公开数据 only；基于搜索样本 + TikTok Shop 评价 + 转写推断；无 Reddit/社媒评论正文
```

## Pitfalls
- 不把单条评价/点赞当「需求」——要重复模式。
- 评价来源标注「TikTok Shop」，别扩大到全市场。
- 缺 Reddit/社媒评论正文时诚实说明，不编 VOC。
- 卖点不得含未证实功效或对比 claim。
