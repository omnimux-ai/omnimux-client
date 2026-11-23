---
name: omnimux-outlier-post-finder
description: "找某个账号/品牌在社媒上跑赢其自身基线的爆款帖，解释可复制的套路，产出 outlier 表、可抄钩子与选题建议。用于 TikTok、Instagram、YouTube、X 的作品表现分析。触发：找爆款、爆款帖、异常高播放、top posts、swipe file、对标账号爆款、为什么这条火。"
---

# Outlier Post Finder（OmniMux 原生版）

## Overview
找出「对该账号而言异常能打」的帖子，而不是全站播放最高的帖子。用账号自身基线判断异常值，再解释可复制的模式。数据层用 `omnimux-social-data`。

## When to Use
- 用户要「找爆款 / top posts / best reels / 最火的视频」
- 想理解某账号最近为什么跑量
- 做对标账号的 swipe file（可抄钩子清单）
- 需要把对手的高表现内容总结成可执行套路

不用于：纯数据查询（直接用 `omnimux-social-data`）、需要评论正文的分析（无评论正文采集数据，须直接告知缺口）。

## Data Sources
1. 作品流：`omnimux_tiktok_posts` / `omnimux_instagram_posts` / `omnimux_youtube_posts` / `omnimux_x_posts`（拉近 30–50 条，越多基线越稳）
2. 详情富化：对应 `omnimux_tiktok_video` / `omnimux_instagram_post` / `omnimux_youtube_video` / `omnimux_x_tweet`
3. 需要时：`omnimux_speech_to_text` 拿转写解释钩子

## Workflow
1. **确认范围**：平台、账号（handle/url）、时间或条数窗口、是否要转写。
2. **拉取作品**：每账号尽量 ≥20 条（最好 30–50）；保留每条 `url` 与原始指标。
3. **归一化指标**：先保留原始值，再合成 engagement。视频优先用播放；文字优先用 likes + replies + reposts。
4. **算基线**：用**中位数**（非均值）算每账号、每平台基线；混格式时按格式分开（reel vs 图文、短视频 vs 长视频）。
5. **打分**：`view_lift = 该帖播放 / 中位播放`，`engagement_lift` 同理。
   - Huge：≥5x｜Strong：2x–5x｜Mild：1.5x–2x；样本 <10 标「低置信」。
6. **富化赢家**：对 top 拉详情/转写，找钩子、题材、格式、情绪、时效、可信度、争议点。
7. **产出**：按下方模板。

## Output Format
```markdown
# 爆款 Outlier 报告：{账号}
## 概览
- 样本：n 条 / 平台 / 窗口
- 基线：中位 {主指标} = {值}；置信度 高/中/低
## 最大 Outlier
| 排名 | 帖子 | 平台 | 日期 | 主指标 | Lift | 可能原因 |
## 可复制模式
1. 模式 — 证据与例子
## 可抄钩子（逐字）
- "..."
## 基于爆款的选题建议
1. ...
## 说明
- 公开数据 only；小样本为方向性判断
```

## Pitfalls
- 别拿大号高播放和小号比——一律用各自 lift。
- 别把多平台指标混进一个基线；分开算。
- 样本 <10 别下强结论，必须标注「低置信」。
- 不编转写/金句，没有就只引用可见文案。
- 尊重用户要求的时间窗口，别拿很久前的旧爆款充数。
