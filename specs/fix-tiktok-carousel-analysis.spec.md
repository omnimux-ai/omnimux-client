# Fix TikTok Carousel (`/photo/`) Extraction, `image_post_info` Parsing, and Cloud-Catalog Direct Localization

Issue: #454

## 背景与问题
在「灵感社区 -> 爆款趋势」中选中一条云端 TikTok 轮播图条目（`is_local: false`，`source_url` 形如 `https://www.tiktok.com/@<user>/photo/<aweme_id>`）并点击「开始分析」时，前端会先调用 `ensureLocalInspiration` -> `POST /omnimux/inspiration/local/import-url` 将云端条目转为本地灵感记录，随后触发：
`OmniMux 云端社媒解析失败: [omnimux-invalid-request] url, id, or query is required for tiktok/video (maps to aweme_id)`

## 范围
1. **Hub (`plugins/plugins/omnimux`)**：
   - `extractTikTokAwemeId` 支持 `/video/<id>`、`/photo/<id>`、`/v/<id>`、`/player/v1/<id>` 及 `?share_item_id=<id>`，拒绝主页/非作品链接。
   - `client.js` `withPatRaw` 透传 `signal`；`inspiration.js` 新增并导出 `normalizeCloudMediaKey` 与 `createInspirationCatalogApi`（`getItem` / `fetchMedia`）；`mount.js` 通过 `ctx.provide('inspirationCatalog', ...)` 暴露给下游领域插件。
   - `trending-source.js` 指纹提取同步兼容 `/photo/<id>`；更新 `dsh.manifest.json`。
2. **Inspiration (`plugins/plugins/omnimux-inspiration`)**：
   - `url-normalizer.js` 的 `getCanonicalItemKey` 识别 TikTok `/photo/<id>`、`/video/<id>`（含无 `@` 路径）、`/player/v1/<id>` 与 `?share_item_id=<id>`，并保持域边界校验。
   - `downloader.js` 抽出 `saveMediaResponse` 与 `downloadMedia` 复用流式落盘、字节上限、魔数嗅探与超时清理。
   - `http-handlers.js`：
     - `socialPayloadLayers` 补充 `data.aweme_detail` 与顶层 `aweme_list[0]`；
     - `parseSocialMeta` 解析 TikTok `image_post_info.images[]` 图集、优先选择可渲染非 HEIC 图、在图文贴中抑制 BGM `video.play_addr` 误判为视频，并支持 `statistics` 字段；
     - `runImport` / `parseImportBody` 在收到合法 `cloud_id` 且 Hub `inspirationCatalog` 可用时，先通过可信 Hub seam 读取云端权威条目与受控媒体流直接落盘，保留 `401 needs-omnimux` 鉴权提示与异常回退 `fetchSocialMeta`。
   - `scraper-fallback.js` 支持 `tikwm` 图集 `payload.images` 且不把轮播 BGM 当作视频。
   - `client/api.js` 的 `ensureLocalInspiration` 为云端条目附带 `cloud_id`，`TIKTOK_VIDEO_RE` 同步支持 `/photo/<id>` 与无 `@` 路径。

## 假设
- 云端 TikTok 轮播图在点击「开始分析」失败的直接触发点，是 `ensureLocalInspiration` 只传 `source_url` 走 `import-url` 重抓，而 Hub `extractTikTokAwemeId` 仅匹配 `/video/` 导致 `/photo/<id>` 解析出空 `aweme_id` 直接抛 `omnimux-invalid-request`；同时即使传入了正确 ID，下游 `parseSocialMeta` 与 `resolveTikTok` 也缺少对 `image_post_info` / `images`、HEIC 规避和 BGM 抑制的支持，且云端已托管的轮播素材本可通过 Hub `inspirationCatalog` 直接落盘而不依赖外站二次抓取。

## 证伪方式
- 若修改后 `extractTikTokAwemeId('https://www.tiktok.com/@kateestills/photo/7548000000000000001')` 仍返回空串、`parseSocialMeta` 对含 `.heic`+`.jpeg` 的 `image_post_info` 与 BGM `play_addr` 仍抽出视频或选出 `.heic` 导致导入失败、或 `import-url` 在传入 `cloud_id` 时仍绕过 `inspirationCatalog` 去调用 `socialFetcher` 报错，即证明假设或实现有误。
- 可执行验证命令：`corepack pnpm --dir plugins --filter omnimux test`、`corepack pnpm --dir plugins --filter omnimux-inspiration test`、`node --import ./plugins/plugins/omnimux-inspiration/scripts/deny-network.mjs --test plugins/plugins/omnimux-inspiration/src/client/tiktok-carousel-analysis.e2e.test.js`。

## 旧标准变更

- `plugins/plugins/omnimux/src/host/apply.test.js` :: `registers all 55 tools and every provided seam by default`
  - 原断言：`provided` 数组包含原有 25 个接缝，未含 `inspirationCatalog`。
  - 必须改的理由：`mountOfficial` 新增提供只读 `inspirationCatalog` seam（供领域插件本地化云端目录条目与受控媒体流），全量 seam 白名单断言需同步包含 `'inspirationCatalog'`。
  - 新期望证据：默认挂载断言包含 `'inspirationCatalog'` 且 55 个工具断言完整保留。
- `plugins/plugins/omnimux/src/host/apply.test.js` :: `disables all gated capabilities when gate.enabled is false`
  - 原断言：`provided` 数组包含原有 16 个接缝。
  - 必须改的理由：`inspirationCatalog` 与 `inspirationShare` 同属 `official.mount` 生命周期下的只读能力，随 `gate.enabled: false` 用例白名单同步纳入 `'inspirationCatalog'`。
  - 新期望证据：能力总开关关闭时断言包含 `'inspirationCatalog'`，仅保留 5 个本地工具，测试通过。
- `plugins/plugins/omnimux/src/host/apply.test.js` :: `fine-grained disables media, text models, and official tools via gate`
  - 原断言：`provided` 数组包含原有 24 个接缝。
  - 必须改的理由：细粒度禁用视频生成与 `omnimux_social_data` 时，只读目录接缝 `inspirationCatalog` 仍随官方能力挂载，白名单同步纳入 `'inspirationCatalog'`。
  - 新期望证据：细粒度门控断言包含 `'inspirationCatalog'`，并继续断言被禁用工具缺失与模型过滤，测试通过。

## 新用户基线
- 仅依赖官方登录认证与标准 Hub 网关/插件服务（`socialData` / `inspirationCatalog` / `headlessSkill`）；不引入任何开发机路径、本地端口、开发档位或静默假数据回退；未登录时透传 `401 needs-omnimux` 由 `authGuard` 引导登录。
