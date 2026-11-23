---
name: omnimux-content-repurposing
description: "把社媒视频、转写与帖子变成可复用内容资产：LinkedIn 帖、X 长推/thread、短视频脚本、newsletter/博客提纲。用于已采集到转写或帖子文本的场景。触发：内容再利用、一稿多投、把视频变文章、转写改写成帖子、content repurposing、复用素材。注意：不改事实、逐条标注出处。"
---

# Content Repurposing（OmniMux 原生版）

## Overview
把一条已有素材（视频转写/帖子）拆成多个平台的原生内容，保持事实不变、语言贴合各平台语法。素材获取走 `omnimux-transcript-intelligence` 或直接帖子文本。

## When to Use
- 把一条视频/一篇帖子扩展成多平台内容
- 需要 X thread、LinkedIn、短视频脚本、newsletter 提纲
- 复用已研究过的高表现内容

## Data Sources
- 转写：`omnimux-transcript-intelligence` 的产出（或现场用 `omnimux_speech_to_text`）
- 帖子/文案：`omnimux_tiktok_video` / `omnimux_instagram_post` / `omnimux_youtube_video` / `omnimux_x_tweet` 的 caption/title
- 不额外抓新数据即可使用；需要补充事实再回 `omnimux-social-data`

## Workflow
1. **定素材与目标平台**：原文 + 要产出哪几种。
2. **抽内容原子**：把素材拆成可独立成立的钩子、结论、例子、金句、CTA（逐字保留来源）。
3. **按平台重写**：X thread（钩子+分点+收尾 CTA）、LinkedIn（故事+洞见）、短视频脚本（钩子+节奏+结尾）、newsletter（标题+分段+要点）。
4. **保真校对**：事实、数字、否定、条件与原文一致；不新增未证实内容。
5. **标出处**：每个产出注明源自哪条 URL。

## Output Format
```markdown
# 内容再利用：{源素材}
## 源素材
- URL / 类型 / 一句话主题
## 内容原子
1. ...
## 各平台产出
### X Thread
### LinkedIn 帖
### 短视频脚本
### Newsletter / 博客提纲
## 说明
- 公开数据 only；事实未改写；出处：{url}
```

## Pitfalls
- 不改事实与数字；不新增原文没有的 claim。
- 不同平台用不同语法，别把长文直接粘到 X。
- 每条产出标源 URL。
- 文风按目标语言/账号人格，去 AI 腔。
