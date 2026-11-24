---
name: omnimux-competitor-research
disable-model-invocation: true
description: "横向对比 2–5 个竞品账号在社媒上的内容策略与有效打法，产出竞品 brief、内容支柱对比、差距机会与建议测试。用于 TikTok、Instagram、YouTube、X。触发：竞品对比、竞品分析、横向对比几个品牌、competitor research、对手都在做什么、找差异化机会。"
---

# Competitor Social Research（OmniMux 原生版）

## Overview
把多个竞品放在同一窗口、同一口径下横向比，找出它们各自在做什么、什么有效、市场里缺什么。数据层用 `omnimux-social-data`。

## When to Use
- 用户给 2–5 个竞品账号要横向对比
- 想找内容差距与差异化机会
- 为内容策略提供竞品依据

不用于：广告投放素材拆解（无 Meta/Google/LinkedIn 广告库数据）、受众人口学对比（无受众画像数据），遇到此类请求必须先明确告知数据缺口。

## Data Sources
- 每账号资料：`omnimux_tiktok_user` / `omnimux_instagram_user` / `omnimux_youtube_channel` / `omnimux_x_user`
- 每账号作品流：`omnimux_tiktok_posts` / `omnimux_instagram_posts` / `omnimux_youtube_posts` / `omnimux_x_posts`（统一时间窗/条数）
- 代表作详情：`omnimux_tiktok_video` / `omnimux_instagram_post` / `omnimux_youtube_video` / `omnimux_x_tweet`
- 需要口播策略：`omnimux_speech_to_text`

## Workflow
1. **统一口径**：固定平台、时间窗、每账号条数（如近 30 条）。
2. **逐账号拆**：内容支柱占比 + 各账号 outlier（按各自中位数基线算 lift，样本 <10 标低置信）。
3. **横向找模式**：共同在做什么、谁在某支柱更强、格式/钩子的差异。
4. **找差距机会**：没人做/做得差但有需求的方向。
5. **给建议测试**：3–5 个可执行测试，标注依据与来源 URL。

## Output Format
```markdown
# 竞品对比 Brief
## 执行摘要
- 样本(账号数/平台/窗口/置信度) / 关键结论
## 竞品快照
| 账号 | 定位 | 粉丝 | 主支柱 | 代表爆款 |
## 各自在做什么有效
- {账号}: ...
## 跨竞品共同模式
1. ...
## 差距与机会
1. ...
## 建议内容测试
1. ...
## 说明
- 公开数据 only；各账号独立中位数基线，跨平台不混算
```

## Pitfalls
- 粉丝量不同要**用 lift 比，不用绝对播放**。
- 不把不同平台指标混进一个对比基线。
- 样本不足（<10）要标置信度。
- 结论必须有代表帖 URL 支撑。
