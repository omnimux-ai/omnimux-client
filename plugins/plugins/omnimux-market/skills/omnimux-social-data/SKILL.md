---
name: omnimux-social-data
description: "OmniMux 社媒公开数据采集路由层。把「查账号/拉作品/取单帖/搜索/看商品/转写」等意图映射到对应的 OmniMux 采集工具与参数，是各研究工作流技能共用的数据层。用于 TikTok、Instagram、YouTube、X、TikTok Shop 的公开数据抓取。触发：社媒数据、采集、拉作品、查账号、取单帖、社媒搜索、TikTok Shop、转写数据。不提供评论正文、受众人口学、广告库或 Pinterest 采集，也不用于登录私域数据或平台写入。"
---

# OmniMux 社媒数据采集路由层

本 Skill 只回答一件事：**要拿什么数据、用哪个 OmniMux 工具、传什么参数、能拿到什么**。不下研究结论、不写报告——那是上层工作流技能（`omnimux-outlier-post-finder` / `omnimux-creator-teardown` / `omnimux-transcript-intelligence` / `omnimux-trend-discovery` / `omnimux-competitor-research` / `omnimux-social-listening` / `omnimux-product-demand` / `omnimux-content-repurposing`）的职责。完整技能索引与触发矩阵见 `references/README.md` 与 `references/TRIGGER-MATRIX.md`。

**核心纪律**
- 工具名与参数以**当前实时工具 schema 为准**，本文件是路由索引不是参数全集；调用前先核对实时工具入参说明。
- 优先直接把 `url` 传给详情类工具（最稳）；只有 `url` 缺失时才用 handle / id。
- 保留原始字段与 `source URL`；未知字段留 `null`，**不臆造、不拿点赞反推播放**。
- 公开数据 only：不做平台写入，不承诺登录私域/私信内容。

## 一、能力覆盖与硬边界

| 能力 | 支持平台 | 现役工具 |
|---|---|---|
| 账号资料 | TikTok / Instagram / YouTube / X | `omnimux_tiktok_user` / `omnimux_instagram_user` / `omnimux_youtube_channel` / `omnimux_x_user` |
| 作品列表 | TikTok / Instagram / YouTube / X | `omnimux_tiktok_posts` / `omnimux_instagram_posts` / `omnimux_youtube_posts` / `omnimux_x_posts` |
| 单帖/单视频详情 | TikTok / Instagram / YouTube / X | `omnimux_tiktok_video` / `omnimux_instagram_post` / `omnimux_youtube_video` / `omnimux_x_tweet` |
| 关键词搜索 | TikTok / Instagram / YouTube / X | `omnimux_tiktok_search` / `omnimux_instagram_search` / `omnimux_youtube_search` / `omnimux_x_search` |
| 商品与评价 | TikTok Shop | `omnimux_tiktok_shop_search` / `omnimux_tiktok_shop_product` / `omnimux_social_data`（`shop_reviews` / `shop_reviews_v2`） |
| 视频转写与画面理解 | TikTok / Instagram / YouTube / X（转写先取直链；画面理解需本地文件） | `omnimux_speech_to_text`；若环境已启用 `omnimux-video`，可用 `video_process`（支持直链/本地）与 `video_analyze`（仅本地文件/`@inspiration/`） |
| 自有已连接账号分析 | 已连接账号（仅在分析工具启用时） | `omnimux_analytics_daily_metrics` / `omnimux_analytics_posts` / `omnimux_analytics_follower_stats` / `omnimux_analytics_best_time` / `omnimux_analytics_frequency` / `omnimux_analytics_content_decay` / `omnimux_analytics_sync_external` / `omnimux_analytics_inbox` / `analytics_query_metrics` |
| 本地已监控对标缓存（可选） | 已录入灵感库的对标账号 | `inspiration_rival_accounts` / `inspiration_rival_posts` / `inspiration_rival_post` / `inspiration_rival_refresh` |

**不做 / 无数据（必须诚实告知，不编造）**：
- 社媒评论正文（仅能拿到「评论数」聚合指标，无法抓取逐条评论正文；TikTok Shop 商品评价除外）；
- 受众人口学画像（年龄、性别、地域分布等）；
- 广告库（Meta / Google / LinkedIn Ad Library）；
- 当前无内置公开数据采集工具的平台：Pinterest、Reddit、Facebook、LinkedIn、Threads、Bluesky、Twitch、Snapchat、Truth Social。

## 二、意图 → 工具路由

### 账号资料
| 平台 | 工具 | 主参数 |
|---|---|---|
| TikTok | `omnimux_tiktok_user` | `url` / `unique_id` |
| Instagram | `omnimux_instagram_user` | `url` / `username` |
| YouTube | `omnimux_youtube_channel` | `url` / `channel_id` |
| X | `omnimux_x_user` | `url` / `screen_name` |

### 作品 / 内容流
| 平台 | 工具 | 主参数与分页 |
|---|---|---|
| TikTok | `omnimux_tiktok_posts` | `url` / `unique_id`，分页参数 `cursor` |
| Instagram | `omnimux_instagram_posts` | `url` / `username`（当前工具 schema 无翻页游标参数，以实时 schema 为准） |
| YouTube | `omnimux_youtube_posts` | `url` / `channel_id`，分页参数 `continuation_token` |
| X | `omnimux_x_posts` | `url` / `screen_name`，分页参数 `cursor` |

### 单帖 / 单视频详情（含媒体直链，转写前先取这个）
| 平台 | 工具 | 主参数 |
|---|---|---|
| TikTok | `omnimux_tiktok_video` | `url` / `aweme_id` |
| Instagram | `omnimux_instagram_post` | `url` / `media_id` |
| YouTube | `omnimux_youtube_video` | `url` / `video_id` |
| X | `omnimux_x_tweet` | `url` / `tweet_id`（优先读取 X 公开嵌入数据，不可用时回退云端） |

### 搜索与聚合入口
- 平台直调搜索：`omnimux_tiktok_search(query)`、`omnimux_instagram_search(query)`、`omnimux_youtube_search(query)`、`omnimux_x_search(query)`。
- 统一聚合入口：`omnimux_social_data(platform, capability, url?, id?, query?, region?, author_id?)`，其中 `platform` ∈ `tiktok | instagram | youtube | x`，`capability` 覆盖 `video | user | post | posts | tweet | search` 以及 TikTok Shop / Creator 扩展能力（如 `shop_reviews`、`shop_reviews_v2`、`shop_categories`、`shop_category_products`、`shop_seller_products`；关键词查 `creator_search_insights` / `creator_search_videos` 传 `query`，拿到 `query_id_str` 后再查 `creator_search_trend` / `creator_search_detail` 传 `id`）。

### TikTok Shop
- 商品搜索：`omnimux_tiktok_shop_search(query, region?)`（`region` 默认 `SG`，支持 `US` / `GB` / `ID` / `MY` / `TH` / `VN` / `PH` 等两位国家码）。
- 商品详情：`omnimux_tiktok_shop_product(url|product_id, region?)`。
- 商品评价：`omnimux_social_data(platform="tiktok", capability="shop_reviews"|"shop_reviews_v2", url|id, region?)`。

### 转写与视频理解
1. 先用单帖/单视频详情工具拿视频或音频直链（多数 `omnimux_tiktok_video` / `omnimux_instagram_post` / `omnimux_youtube_video` / `omnimux_x_tweet` 响应含媒体直链）。
2. 调用 `omnimux_speech_to_text(audio=<直链或本地绝对路径>, language?, response_format?)` 获取逐字稿（需要时间戳时传 `response_format="srt"` 或 `"vtt"`）。
3. 若长视频需先抽音轨或需画面/分镜理解，且当前会话已挂载 `omnimux-video` 插件：先用 `video_process`（支持 `http(s)` 直链与本地路径，如抽音轨或 `video_inline_analysis_prepare` 生成本地视频文件）；`video_analyze` **不接受 `http(s)` 直链**，须传本地绝对路径、`data:video/` URI 或 `@inspiration/` 引用；未挂载 `omnimux-video` 时明确说明并基于转写与文案继续。

## 三、参数与合规约定
- `region`：2 位国家码，用于 TikTok Shop 站点/区域，不等于按地区过滤社媒内容。
- 分页：返回下一页游标（`cursor` / `continuation_token`）时再继续翻页；游标为空或工具不支持分页时即停，并如实记录实际样本量。
- 凭据：除 `omnimux_x_tweet` 优先读取公开嵌入外，其余云端能力依赖 OmniMux 登录或 `OMNIMUX_API_KEY`；缺失时引导走应用安全登录/配置入口，不在聊天里索取密钥。
- 响应体积大时只提取研究所需字段，但**原始指标数值不改写、不估算**。

## 四、交付给上层技能的最小字段集
- 账号：`handle, name, followers, bio, url`
- 帖子：`id, url, posted_at, caption/title, views/plays, likes, comments(count), shares, saves, media_url`
- 商品：`id, title, price, rating, review_count, url`
- 转写：`text, language, source_url`
