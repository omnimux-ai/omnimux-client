---
name: omnimux-transcript-intelligence
disable-model-invocation: true
description: "把社媒视频的转写拆成 hook/setup/claim/evidence/payoff/CTA，抽取钩子、金句、claims 与可复用内容原子，并跨多条转写聚类模式。用于 TikTok、Instagram、YouTube、X 视频的转写分析。触发：转写分析、逐字稿、钩子提取、content atoms、这条视频讲了什么、拆口播。"
---

# Transcript Intelligence（OmniMux 原生版）

## Overview
从公开视频的转写里提炼信号：钩子、主张、故事、异议、CTA、可独立成篇的内容原子。数据层用 `omnimux-social-data`。

## When to Use
- 用户给视频/账号要「拆这条/这几条视频讲了什么」
- 提取钩子、金句、claim、CTA
- 把转写变成帖子/脚本/选题
- 对比多个创作者对同一话题的说法

## Data Sources
1. 单帖/视频详情：`omnimux_tiktok_video` / `omnimux_instagram_post` / `omnimux_youtube_video` / `omnimux_x_tweet` 取视频直链（多数响应含 media url）
2. 语音转写：`omnimux_speech_to_text(audio=直链或本地路径, language?, response_format?)` 得逐字稿（需时间戳可传 `response_format="srt"` 或 `"vtt"`）；若已启用 `omnimux-video`，长视频可先用 `video_process`（支持直链或本地路径）抽音轨
3. 画面/结构理解（可选）：若已启用 `omnimux-video`，须先落地为本地文件（如用 `video_process` 的 `video_inline_analysis_prepare`）或使用 `@inspiration/` 引用，再调 `video_analyze` 补充镜头与画面拆解（`video_analyze` 不接受 `http(s)` 直链）
4. 按账号选片：先用对应平台 `omnimux_tiktok_posts` / `omnimux_instagram_posts` / `omnimux_youtube_posts` / `omnimux_x_posts` 选片，再逐条取转写

## Workflow
1. **收 URL/选片**：有 URL 直接取详情与转写；给账号则先拉作品流选相关视频。
2. **取转写**：保留时间戳（若有）与 `source_url`；转写不可得就明确说明并退回标题/文案，不伪造逐字稿。
3. **分段**：hook / setup / claim / evidence / payoff / CTA。
4. **抽取**：逐字钩子、主张与反转、故事、框架、回应过的异议、情绪词、金句、可独立成篇的 content atoms。
5. **跨条综合**：按话题聚类、数频次、抽重复出现的钩子公式、标最强例证（带 URL）。

## Output Format
```markdown
# 转写情报报告
## 摘要
- 主题 / 最强钩子 / 最佳可复用点子
## 逐条笔记
### [标题或URL](url)
- 钩子："..."
- 核心主张：...
- 最佳金句："..."
- CTA：...
- 内容原子：1) ...
## 跨条模式
| 模式 | 证据 | 例证URL |
## 钩子 Swipe File
- "..."
## 再利用建议
- LinkedIn / X thread / 短视频脚本 / newsletter
## 说明
- 公开数据 only；转写来源与近似处已标注
```

## Pitfalls
- 不要只看标题就总结——用户要转写分析就先取转写。
- 原话优于改写；钩子和金句必须逐字。
- AI 转写可能有误，可疑处标「近似」。
- 每条引用都能追到 URL，不混来源。
