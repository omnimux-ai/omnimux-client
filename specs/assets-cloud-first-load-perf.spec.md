# 资产中心「公共 → 全部」首次加载性能优化规格

- 关联 Issue：`#324`
- 任务：`perf-assets-first-load`
- 日期：`2026-11-26`
- 基线：`b79e801b`（`origin/main`）
- 范围：`plugins/plugins/omnimux-assets`（客户端单行流渲染、采样与缓存、Host 目录加载、静态缓存头、前端打包压缩及缩略图/视频首帧脚本）。不涉及私钥/私有运维脚本，不直接上传 R2 对象。

## 背景与实测证据

资产中心「公共 → 全部」单行流页面首次打开耗时较长。通过对源码、6,382 条随包目录及公网 CDN（`assets.omnimux.ai`）的实测，定位到 5 层叠加瓶颈：

1. **离屏分类行与 20 路无封面 MP4 并发风暴**：`CloudAssetsView` 一次性挂载全部 6 个 `CloudCategoryRow`（144 张卡片），而第 4 行「素材」位于首屏下方 ~1200px，其中 694/855（81.2%）为无封面视频，挂载后立即触发约 20 路 `video.load()` 并发拉取 11MB 级 MP4 并解码首帧；同时 Chromium `img loading="lazy"` 1250–2500px 预加载边距会触发 40–60 张横/纵向离屏图片并发，与首屏 14 张可见卡片争抢同一条 HTTP/2 连接（实测全量并发总流量 15.42 MB / 6.26 s）。
2. **元数据串行瀑布与冗余请求**：切入「公共」共发出 21 次本地 HTTP 请求（3–4 轮串行），包含行布局下完全未使用的 `all/page-0000.json`；每行采样忽略 `manifest.json` 已有页数，固定先拉 `page-0` 再串行拉两页；缺少 `preconnect`（冷 TLS 握手 220–580 ms）；`manifest` 加载期间无骨架屏闪白/闪黑。
3. **全量随机抽样击穿缓存**：每次冷启动都在全库 6,382 条中跨页随机抽样，叠加 CDN 边缘 TTL 仅 `max-age=14400`，导致近 100% 命中 `cf-cache-status: MISS` 且本地磁盘缓存无法跨重启复用（同 14 张首屏图：冷 MISS 3.50 s vs 热 HIT 1.75 s）。
4. **Host 同步阻塞与包体过大**：`cloud.getManifest()` 首次同步读取解析 4.3 MB `index.json`；`lib/client.js` 未启用 `minify` 体积达 2.18 MB。
5. **缩略图覆盖不足**：全库仅 108/6,382（1.7%）有 WebP 缩略图，`build-cover-thumbnails.mjs` 仅转码 `.png`，遗漏 329 条角色 JPG（206–481 KB）、千余条超 200 KB 场景/道具 JPG 及 694 条无封面钩子视频。

## 假设

1. **网络并发隔离假设**：将首屏以下分类行（第 3–6 行）改为视口邻域按需加载、将单行横向初始渲染收敛为首屏+缓冲张数（10 张）、消除非悬停态空闲 `<video>` 挂载并对无封面 `bareClip` 施加视口与并发上限（≤ 3 路）后，首屏冷加载的并发媒体请求数可从 50–70 路降至 14–20 路，离屏 MP4 请求数降至 0，首屏可见卡片加载不再被离屏流量饥饿阻塞。
2. **元数据并行与热池缓存假设**：跳过行布局下无用的 `all/page-0000.json`、利用 `manifest.pages` 将每行采样从 3–4 轮串行压成 1 轮并行、前置注入 `assets.omnimux.ai` 的 `preconnect` 并在首次加载使用保留多子类多样性的有界热池确定性抽样后，首次进入「公共 → 全部」的元数据请求数与冷建连延迟显著下降，二次重开可直接命中 CDN 边缘或本地磁盘缓存。
3. **Host 与构建减负假设**：将 `cloud-catalog.js` 的 `manifest` 读取与 4.3 MB `index.json` 索引解析解耦（`getManifest()` 不触发读 `index.json`，索引按需加载或后台异步预热），并在 `build-client.mjs` 开启 `minify: true` 后，Host 首次清单响应不再阻塞主线程且 `lib/client.js` 体积下降 ≥ 35%，同时不破坏任何现有插件加载、自愈、工具与 UI 契约。
4. **缩略图脚本扩展假设**：扩展 `build-cover-thumbnails.mjs` 支持 `--max-bytes` 字节阈值筛选、覆盖角色全量 JPG 封面，以及通过 `ffmpeg` 对无封面视频提取首帧 WebP poster，可在不破坏现有 `.png` 确定性构建契约的前提下，为后续运维补齐 98.3% 缺失缩略图提供标准产出。

## 证伪方式

以下任一可观测结果出现，即证明对应假设不成立，必须修正实现：

1. 真实浏览器打开「公共 → 全部」首屏时，Network 面板仍出现 `all/page-0000.json`、第 3–6 行分片请求，或出现任意离屏 `material/hook` MP4 请求。
2. 自动化回归测试回退核心修复后未失败（双向证伪失败），或以下任一验证命令退出码非 0：
   - `corepack pnpm --dir plugins run build:all`
   - `corepack pnpm --filter omnimux-assets test`
   - `corepack pnpm --dir plugins run verify:stages`
   - `node --test plugins/scripts/verify-anti-slop.test.mjs`
3. 调用 `cloud.getManifest()` 时，`index.json` 仍被同步读取（通过缺失 `index.json` 仅保留 `manifest.json` 的单测直接证伪）。
4. 开启 `minify: true` 后 `lib/client.js` 体积未降至 1.5 MB 以下，或 `verify-plugin-load` 失败。
5. 亮/暗双主题、窄屏布局、横向翻页箭头、向下滚动至素材/声音行、悬停播放视频/音频或点击「查看全部」出现回归或布局错位。

## 验收标准

- [ ] 高保真交互演示 `ui-demo/assets-cloud-first-load-perf-demo.html` 完整展示优化前后对比（亮/暗主题、窄屏切换、网络请求瀑布与首屏出图对比）并通过实机检查。
- [ ] `公共 → 全部` 初始加载时：`all/page-0000.json` 不再发出；仅前 2 行（`character`、`scene`）立即拉取分片；第 3–6 行（`prop`、`material`、`style`、`audio`）在进入视口邻域前只展示标题与定高骨架，不发分片与媒体请求。
- [ ] 单行初始仅渲染前 10 张卡片（含 7 张可见 + 缓冲），点击右翻页箭头或横向滚动后无缝展开至全部 24 张；第 1 行前 7 张可见封面设置 `loading="eager"`、`fetchPriority="high"`、`decoding="async"`。
- [ ] 有封面的视频卡在非悬停态不挂载 `<video>`；无封面 `bareClip` 视频卡通过视口门控与并发队列（上限 3 路）加载首帧，滚动进入「素材」行或「素材 → 钩子」分类后仍正常显示真实首帧与真实宽高比。
- [ ] `manifest` 加载期间展示首屏 2 行骨架占位，不再空白闪屏；`AssetsStage` 可见时注入 `assets.omnimux.ai` 的 `preconnect` 并在空闲时预热 `manifest.json`。
- [ ] `fetchCategoryRandomSample` 与 `fetchScopesRandomSample` 支持传入已知 `totalPages` 并行拉取，并支持有界热池多样化确定性抽样（保留多子类混排；显式刷新与「查看全部」覆盖全量目录）。
- [ ] Host `cloud-catalog.js` 解耦 `manifest` 与 `index` 加载（`getManifest()` 不阻塞读取 4.3 MB `index.json`），保持物化窗口读空可自愈语义；`http-routes.js` 为静态目录分片与清单返回 `Cache-Control: private, max-age=3600`。
- [ ] `scripts/build-client.mjs` 开启 `minify: true`，`lib/client.js` 体积由 ~2.18 MB 降至 ≤ 1.40 MB；`bundle.lock.json` 按主干重算并通过 `workspace:check`。
- [ ] `scripts/build-cover-thumbnails.mjs` 支持 `--max-bytes` / `--include-categories` / `--video-posters`（`ffmpeg` 首帧提取），附完整单测。
- [ ] 全部自动化单测、E2E 几何测试与真实浏览器实测证据齐备并通过。

## 旧测试契约变更说明

- `plugins/plugins/omnimux-assets/src/client/CloudCategoryRow.test.js`：原源码正则锁定 `fetchCategoryRandomSample(catId, cloudPage, normalizeCloudAsset, 24)` 的四参固定拼写；升级后额外传递 `manifest` 页数与热池/并发配置对象，保留全部行为契约（缓存复用、声音双 scope 过滤与 24 张满员、保存三元组透传）并新增并发与懒加载行为测试。
- `plugins/plugins/omnimux-assets/src/client/CloudAssetsView.test.js`：原源码正则锁定 `<CloudTileMedia asset={asset} broken={broken} onBroken={handleBroken} hovering={hovering} />` 与无条件 `showClip` 挂载；升级后 `CloudTileMedia` 接受 `priority` 属性且有封面视频仅在悬停态挂载 `<video>`（无封面 `bareClip` 仍在进入视口后挂载并受并发门控），相应更新源码断言并补强真实 DOM 行为断言。
