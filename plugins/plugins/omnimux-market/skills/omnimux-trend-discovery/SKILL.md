---
name: omnimux-trend-discovery
description: "在一个细分赛道里找正在起量的选题、格式与钩子（基于关键词搜索与近期高互动作品），产出趋势 brief、证据表和可做角度。用于 TikTok、Instagram、YouTube、X。触发：趋势、在起量、什么在火、赛道热点、trend discovery、最近流行什么、找选题方向。注意：无平台官方热榜/热度接口，结论基于搜索样本推断。"
---

# Trend Discovery（OmniMux 原生版）

## Overview
在给定赛道里找「正在被讨论、且有高互动作品」的选题/格式/钩子，产出可执行趋势 brief。数据层用 `omnimux-social-data`。

## When to Use
- 用户问「这个赛道最近什么在火 / 有什么选题」
- 想找可跟的格式、钩子、话题
- 需要一个带证据的趋势 brief

## Data Sources
- 关键词搜索：`omnimux_tiktok_search` / `omnimux_instagram_search` / `omnimux_youtube_search` / `omnimux_x_search`（TikTok 赛道洞察也可按需补充 `omnimux_social_data(platform="tiktok", capability="creator_search_insights"|"creator_search_videos", query=<关键词>)`，拿到 `query_id_str` 后再查 `omnimux_social_data(platform="tiktok", capability="creator_search_trend", id=<query_id_str>)`）
- 排序与佐证：对候选拉 `omnimux_tiktok_video` / `omnimux_instagram_post` / `omnimux_youtube_video` / `omnimux_x_tweet` 取指标
- 可选：抓 1–3 个头部账号近期 `omnimux_*_posts` 看发布频率

## Workflow
1. **定赛道与词表**：主词 + 3–5 个近义/长尾词。
2. **多词搜索**：每词取前若干条，记录作者、指标、发布时间、`url`。
3. **判「起量」还是「常青」**：看近期作品占比 + 互动集中度；区分「一直稳」与「最近突然多」。
4. **抽格式与钩子**：把高互动作品按格式归类（口播/对比/开箱/教程/剧情…），记钩子句式。
5. **产证据表 + 可做角度**：每个趋势给 2–3 条代表帖（带 URL）+ 可落地选题。

## Output Format
```markdown
# 趋势 Brief：{赛道}
## 值得行动的 3 个趋势
1. 趋势 — 证据(代表帖URL/指标) — 为什么现在 — 可做角度
## 声音/话题/格式
| 类型 | 内容 | 证据 | 备注 |
## 可研究/可跟进的代表帖
- [链接](url)
## 内容建议
1. ...
## 说明
- 公开数据 only；基于关键词搜索样本推断，非平台官方热榜；样本量、置信度与时间窗已标注
```

## Pitfalls
- **没有官方趋势/热度数据**：明确写「基于搜索样本推断」，不要把推断说成官方热榜。
- 别把单个爆款当趋势——至少 2–3 条独立作品佐证。
- 记录搜索时间窗与样本量，趋势有时效。
- 保留来源 URL，不跨平台混算热度。
