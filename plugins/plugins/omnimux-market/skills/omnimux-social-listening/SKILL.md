---
name: omnimux-social-listening
disable-model-invocation: true
description: "就某个品牌/话题/品类，检索社媒上『大家在说什么』，多源汇总主题、代表帖与情绪倾向（谨慎），产出聆听 brief 与引用。用于 TikTok、Instagram、YouTube、X。触发：社媒聆听、舆情、大家怎么看、口碑、social listening、这个话题讨论度、品牌被怎么讨论。注意：仅基于公开样本，不代表全平台舆情。"
---

# Social Listening Brief（OmniMux 原生版）

## Overview
围绕一个品牌/话题/品类，跨平台检索公开讨论，汇总主题、代表帖、情绪倾向（谨慎）与可行动建议。数据层用 `omnimux-social-data`。

## When to Use
- 品牌/话题的口碑与讨论盘点
- 了解某品类下的用户关注点
- 为内容或运营提供「外部声音」依据

## Data Sources
- 多平台搜索：`omnimux_tiktok_search` / `omnimux_instagram_search` / `omnimux_youtube_search` / `omnimux_x_search`（主词 + 长尾/品牌词）
- 代表帖详情：`omnimux_tiktok_video` / `omnimux_instagram_post` / `omnimux_youtube_video` / `omnimux_x_tweet`；需口播观点用 `omnimux_speech_to_text`
- 边界说明：**无评论正文采集**，情绪只能从帖子文案/口播/标题判断，样本有限，须在报告中明示

## Workflow
1. **定范围**：对象、平台子集、语言、时间窗。
2. **多词多平台检索**：记录作者、文案/标题、指标、日期、`url`。
3. **主题聚类**：合并同类讨论，按频次与强度排序，每主题留逐字引用。
4. **情绪倾向（谨慎）**：仅基于样本帖文案/口播标注「偏正/偏负/中性/争议」，标样本量与置信度。
5. **给行动建议**：内容切入、可能的异议、监测重点。

## Output Format
```markdown
# 社媒聆听 Brief：{对象}
## 执行摘要
- 范围/样本量/置信度/方法 / 3 条关键发现
## 主要主题
| 主题 | 频次 | 情绪(样本) | 代表帖URL | 逐字引用 |
## 值得关注的声音
- "..."
## 风险 / 机会
## 建议行动
1. ...
## 说明
- 公开数据 only；基于搜索样本推断，不代表全平台；无评论正文，情绪仅基于帖子文案/口播
```

## Pitfalls
- **不是全平台舆情**：明确写样本范围与平台偏差。
- 不从一条帖子推「市场情绪」。
- 情绪判断要标「基于样本」，别伪装成统计结论。
- 引用逐字、带 URL；不编造评论区发言。
