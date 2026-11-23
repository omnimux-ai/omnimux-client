# 触发词矩阵（TRIGGER-MATRIX）

用户话术 → 命中技能 → 主要 OmniMux 工具。技能匹配靠各 `SKILL.md` frontmatter 的 `description`；本表用于路由核对与触发验收。

| # | 用户可能这样说 | 命中技能 | 主要 OmniMux 工具 |
|---|---|---|---|
| 1 | 「找一下 XX 最近哪条爆了 / 帮我做个爆款 swipe file / 为什么这条播放这么高」 | `omnimux-outlier-post-finder` | `omnimux_*_posts` + `omnimux_*_video`/`_post`/`_tweet`（可选 `omnimux_speech_to_text`） |
| 2 | 「拆一下这个账号 / 这个博主怎么做起来的 / 对标分析 @xxx」 | `omnimux-creator-teardown` | `omnimux_*_user`/`_channel` + `omnimux_*_posts` |
| 3 | 「分析这几条视频的转写 / 提炼钩子和金句 / 拆口播」 | `omnimux-transcript-intelligence` | 详情工具 → `omnimux_speech_to_text`（可选 `video_process` / `video_analyze`） |
| 4 | 「这个赛道最近什么在火 / 找点选题方向 / 趋势」 | `omnimux-trend-discovery` | `omnimux_*_search` + 详情工具 |
| 5 | 「横向对比这几个竞品 / 对手都在做什么 / 找差异化」 | `omnimux-competitor-research` | 多账号 `omnimux_*_user`/`_channel` + `omnimux_*_posts` |
| 6 | 「大家怎么评价这个品牌 / 这个话题讨论度 / 舆情口碑」 | `omnimux-social-listening` | 多平台 `omnimux_*_search` + 详情工具 |
| 7 | 「帮我验证这个品有没有需求 / 痛点在哪 / 提炼卖点」 | `omnimux-product-demand` | `omnimux_*_search` + `omnimux_tiktok_shop_*` + `omnimux_social_data(shop_reviews)` + `omnimux_speech_to_text` |
| 8 | 「把这条视频改成 X thread / 一稿多投 / 素材复用」 | `omnimux-content-repurposing` | 已有转写/帖子文本（不额外抓新数据） |
| 9 | 「查一下这个账号资料 / 拉最近作品 / 取这条帖数据」 | `omnimux-social-data` | 对应 `omnimux_*_user`/`_channel` / `omnimux_*_posts` / `omnimux_*_video`/`_post`/`_tweet` |

## 冲突消解（多技能可命中时）
- 同时提到「对比 + 多个账号」 → `omnimux-competitor-research` 优先，内部复用 outlier/teardown 方法。
- 「账号拆解 + 最终要出内容」 → `omnimux-creator-teardown` 先拆，再交 `omnimux-content-repurposing` 或创作技能。
- 任何技能需要确认工具名、入参或能力边界时 → 统一查 `omnimux-social-data`。

## 明确不触发（数据缺口，直接说明而非硬做）
- 「挖这条视频的评论 / 分析评论区」 → 无社媒评论正文采集，只能给评论数指标（TikTok Shop 商品评价除外）。
- 「看这个账号的受众画像 / 年龄性别」 → 无受众人口学数据。
- 「拆竞品的 Meta / Google / LinkedIn 广告」 → 无广告库采集能力。
- 「抓 Reddit / Facebook / LinkedIn / Threads / Bluesky / Pinterest 帖子」 → 当前无内置公开数据采集工具，不编造样本。
