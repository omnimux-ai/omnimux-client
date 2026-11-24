# OmniMux 社媒研究预设技能包（Social Media Research Preset Skills）

借鉴开源 `ScrapeCreators/social-media-research-skills`（MIT）的方法论骨架，将数据层替换为 OmniMux 原生公开社媒采集与语音转写工具，作为内置技能随 `omnimux-market` 通过 DSH 原生 `ctx.skills.registerProvider` 注册（无需预拷至 `$DSH_HOME/skills/`）。

- 结构：1 个全局数据层路由技能（`omnimux-social-data`）+ 8 个按需激活研究工作流技能（`disable-model-invocation: true`，0 Token 全局默认，支持 `/`、技能选择器或聘用专家作用域自动激活）
- 承载插件：`omnimux-market`（`provider: "omnimux-market"`, `rank: 600`）
- 平台覆盖：TikTok / Instagram / YouTube / X + TikTok Shop
- 数据边界：**仅使用公开数据**；社媒评论正文、受众人口学、Meta/Google/LinkedIn 广告库及 Pinterest/Reddit/Facebook/LinkedIn/Threads/Bluesky 明确不做，命中时如实说明缺口，不编造数据

## 目录与打包结构

源码位于 `plugins/plugins/omnimux-market/skills/`，并在 `plugins/plugins/omnimux-market/dsh.manifest.json` 的 `skills` 中声明；运行期由 `omnimux-market` 通过 `ctx.skills.registerProvider` 在 `BUNDLED_SKILL_RANK`（600）原生暴露，`dsh-desktop-next` 与 `dsh-plugin-desktop` 双壳加载一致：

```text
plugins/plugins/omnimux-market/skills/
  omnimux-social-data/              # ① 数据层：意图→工具→参数（附 references/README.md 与 TRIGGER-MATRIX.md）
  omnimux-outlier-post-finder/      # ② 找爆款（账号自身中位数基线 + lift 分档）
  omnimux-creator-teardown/         # ③ 账号拆解（定位/支柱/钩子/红线）
  omnimux-transcript-intelligence/  # ④ 转写情报（钩子/主张/金句/内容原子）
  omnimux-trend-discovery/          # ⑤ 趋势发现（基于搜索样本推断）
  omnimux-competitor-research/      # ⑥ 竞品横评（同窗口/各自 lift 对比）
  omnimux-social-listening/         # ⑦ 社媒聆听（公开讨论样本盘点）
  omnimux-product-demand/           # ⑧ 选品与需求验证（搜索 + TikTok Shop 评价 + 转写）
  omnimux-content-repurposing/      # ⑨ 内容再利用（一稿多投、保真标出处）
```

## 技能清单

| 技能 ID | 解决什么 | 触发词示例 | 主要 OmniMux 工具 |
|---|---|---|---|
| `omnimux-social-data` | 数据层路由：意图→工具→参数 | 社媒数据、采集、拉作品、查账号、取单帖、转写数据 | `omnimux_{tiktok,instagram,youtube,x}_*`、`omnimux_tiktok_shop_*`、`omnimux_social_data`、`omnimux_speech_to_text` |
| `omnimux-outlier-post-finder` | 找跑赢自身基线的爆款并解释套路 | 找爆款、爆款帖、异常高播放、swipe file | `omnimux_*_posts` + `omnimux_*_video`/`_post`/`_tweet` + `omnimux_speech_to_text` |
| `omnimux-creator-teardown` | 拆账号定位/支柱/钩子/红线 | 账号拆解、博主拆解、对标分析 | `omnimux_*_user`/`_channel` + `omnimux_*_posts` |
| `omnimux-transcript-intelligence` | 转写→钩子/claims/content atoms | 转写分析、逐字稿、钩子提取、拆口播 | 详情工具 → `omnimux_speech_to_text`（可选 `video_process`/`video_analyze`） |
| `omnimux-trend-discovery` | 赛道在起量的选题/格式（搜索推断） | 趋势、什么在火、赛道热点、找选题 | `omnimux_*_search` + 详情工具 |
| `omnimux-competitor-research` | 多竞品横向对比与差距 | 竞品对比、竞品分析、对手在做什么 | 多账号 `omnimux_*_user`/`_channel` + `omnimux_*_posts` |
| `omnimux-social-listening` | 品牌/话题公开讨论盘点 | 社媒聆听、舆情、口碑、大家怎么看 | 多平台 `omnimux_*_search` + 详情工具 |
| `omnimux-product-demand` | 选品/需求验证、痛点、卖点 | 选品、需求验证、痛点挖掘、竞品评价 | `omnimux_*_search` + `omnimux_tiktok_shop_*` + `omnimux_social_data(shop_reviews)` |
| `omnimux-content-repurposing` | 一稿多投、素材复用 | 内容再利用、把视频变文章、改写帖子 | 已有转写或帖子文案（按需回查 `omnimux-social-data`） |

## 方法论对标与边界裁决

| 参考骨架（ScrapeCreators） | OmniMux 预设技能 | 支持状态与边界 |
|---|---|---|
| `scrapecreators-api` | `omnimux-social-data` | ✅ 替换为 OmniMux 原生工具 |
| `outlier-post-finder` | `omnimux-outlier-post-finder` | ✅ 中位数基线 + lift（≥5x / 2x–5x / 1.5x–2x，样本 <10 低置信） |
| `creator-profile-teardown` | `omnimux-creator-teardown` | ✅ 实证与推断分离，无人口学 |
| `transcript-intelligence` | `omnimux-transcript-intelligence` | ✅ 详情取直链 → `omnimux_speech_to_text` |
| `trend-discovery` | `omnimux-trend-discovery` | 🟡 基于关键词搜索样本推断，非官方热榜 |
| `competitor-social-research` | `omnimux-competitor-research` | ✅ 限 TikTok / Instagram / YouTube / X |
| `social-listening-brief` | `omnimux-social-listening` | 🟡 仅公开帖文案/口播，无评论正文 |
| `product-demand-research` | `omnimux-product-demand` | 🟡 用公开搜索 + TikTok Shop 评价 + 转写替代 Reddit/评论 |
| `content-repurposing` | `omnimux-content-repurposing` | ✅ 保真改写并逐条标源 URL |
| `comment-mining` | 不纳入 | ❌ 无社媒评论正文采集 |
| `audience-research` | 不纳入 | ❌ 无受众人口学数据 |
| `ad-library-teardown` | 不纳入 | ❌ 无 Meta/Google/LinkedIn 广告库 |

## 触发机制与数据依赖

- 触发方式：各技能通过 `SKILL.md` frontmatter 的 `description` 中文/英文场景触发词自动命中；数据工具细节统一查询 `omnimux-social-data`，详见 `TRIGGER-MATRIX.md`。
- 数据依赖：除 `omnimux_x_tweet` 优先走公开嵌入外，其余云端社媒采集与 `omnimux_speech_to_text` 依赖 OmniMux 登录态或 `OMNIMUX_API_KEY`；`video_process` / `video_analyze` 依赖 `omnimux-video` 插件启用。全流程仅做公开只读采集，不写入平台、不抓取私域。
