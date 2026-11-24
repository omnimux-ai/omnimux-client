---
name: omnimux-creator-teardown
disable-model-invocation: true
description: "输入一个博主/品牌主页链接，拆解其定位、内容支柱、爆款帖、可抄的钩子与格式、以及不该抄的红线，产出拆解报告与对我们的测试建议。用于 TikTok、Instagram、YouTube、X。触发：账号拆解、博主拆解、主页拆解、creator teardown、对标账号分析、这个账号怎么做起来的。"
---

# Creator Profile Teardown（OmniMux 原生版）

## Overview
拆一个账号「为什么成立、靠什么持续涨、哪些能抄哪些不能抄」。数据层用 `omnimux-social-data`。

## When to Use
- 用户给主页链接要「拆一下这个号」
- 做对标账号的定位与内容策略分析
- 想提炼可复用的选题/格式/钩子

不用于：受众人口学画像（年龄/性别/地域分布无数据）、评论区情感深挖（无评论正文数据），遇到此类请求必须先明确告知数据缺口。

## Data Sources
1. 账号资料：`omnimux_tiktok_user` / `omnimux_instagram_user` / `omnimux_youtube_channel` / `omnimux_x_user`
2. 作品流：`omnimux_tiktok_posts` / `omnimux_instagram_posts` / `omnimux_youtube_posts` / `omnimux_x_posts`（拉近 30–50 条）
3. 代表作详情：`omnimux_tiktok_video` / `omnimux_instagram_post` / `omnimux_youtube_video` / `omnimux_x_tweet`；需解释口播时用 `omnimux_speech_to_text`

## Workflow
1. **定位**：从 bio、置顶、高频主题判断这个号卖什么、给谁、什么调性。
2. **内容支柱聚类**：把近期作品按主题/格式聚类，算各支柱占比。
3. **找 outlier**：用中位数基线算 lift，标出真正跑量的代表作（见 `omnimux-outlier-post-finder` 方法，样本 <10 标低置信）。
4. **抽钩子与格式**：逐条取前 3 秒钩子、结构、视觉手法（原话保留）。
5. **划红线**：区分「它能抄但你不该抄」（人设、地域、擦边、未证实 claims）。
6. **给测试建议**：把可复制元素转成 3–5 个可执行测试。

## Output Format
```markdown
# 账号拆解：{handle}
## 定位
一句话定位 / 目标人群 / 变现方式(实证 vs 推断分开)
## 内容支柱
| 支柱 | 占比 | 代表帖 |
## 爆款 Outlier
| 帖子 | 指标 | Lift | 原因 |
## 可抄的钩子与格式
- "..."
## 不要抄的
- ...
## 对我们的测试建议
1. ...
## 说明
- 公开数据 only；推断项已标注；无受众人口学与评论正文数据
```

## Pitfalls
- 变现方式/收入只能「实证 vs 推断」分开写，别把猜测当事实。
- 样本太少（<10）时明确标注低置信，不外推。
- 保留原话，不美化改写钩子；每条代表作保留来源 URL。
- 不臆造受众年龄、性别、收入等人口学画像。
