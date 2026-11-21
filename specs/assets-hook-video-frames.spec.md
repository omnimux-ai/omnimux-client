# 资产中心 · 钩子分类无封面视频卡片修复

- 任务：`fix-assets-hook-video-frames`
- 日期：2026-11-21
- 基线：`25a36f2ed06e5dd9181902d2d697907962d2af52`（origin/main）
- 范围：`plugins/plugins/omnimux-assets` 云端素材卡片与测试；不改变 catalog 构建输入、HTTP 路由或工具契约。

## 背景与数据源

资产中心 → 公共 → 素材 → 钩子分类的卡片只有标题。`cloud-catalog/material/hook` 的清单与分页正常，但 `page-0000.json` 首屏 24 条全部 `cover_url=""` 且没有 `thumb_url`；其中 23 条是带 MP4 `media_url` 的视频，1 条为纯描述行。全量 705 条中仅 2 条有 `cover_url`（`Epic Fail`、`Product Dodge`），696 条 `video`、9 条 `other`（其 `media_url` 实测 `Content-Type: video/mp4`），703 条没有任何封面。问题不是分页或过滤，而是源数据没有 poster；客户端既不能把 MP4 塞进 `<img>`，也不能把空封面当图片请求。

## 目标与方案

无封面视频以 `<video>` 首帧作为卡片正面，并按视频自身宽高比撑开缩略图容器。`preload="metadata"` 读到元数据后 seek 到 0.001s 解码首帧，并把真实宽高比写入既有 `coverRatioCache`，供瀑布流估算。无封面的非图片行不再请求注定 404 的 `which=cover`；有封面的图片/视频路径保持不变。

## 验收标准

- [ ] 钩子分类首屏 24 条中，所有带 `media_url` 的卡片显示真实视频首帧，卡片不再塌成标题行。
- [ ] 无封面视频卡缩略图高度 > 200px（260px 列宽下按 9:16 约 458px），视频处于文档流且铺满缩略图。
- [ ] 有封面行仍优先使用 thumbnail/cover，不改变既有图片路径。
- [ ] `corepack pnpm --dir plugins run build:all`、`omnimux-assets` 单测与 `test:worktree-web assets` 通过。
- [ ] 亮/暗主题与窄屏演示可见；修改前后演示为 `ui-demo/assets-hook-video-frames-demo.html`。

## 旧标准变更

- `plugins/plugins/omnimux-assets/src/client/CloudAssetsView.test.js` :: `binds the pointer surface on the card and hands it down to the tile`
  原断言要求 `element.currentTime = 0` 且 effect 依赖 `[hovering]`；现在裸片段需要停在已解码的首帧，改为 `bareClip ? BARE_CLIP_FIRST_FRAME_SECONDS : 0`，依赖 `[hovering, bareClip]`。新期望证据：源码断言匹配新的 pause/currentTime 分支，播放/暂停行为仍由同一 effect 驱动。
- `plugins/plugins/omnimux-assets/src/client/CloudAssetsView.test.js` :: `gives a poster-less clip the face of the tile and only then loads it`
  原断言只检查 `.omnimux-assets-cloud-preview--bare { opacity: 1 }`；现在还需锁定文档流（`position: static`）、`onLoadedMetadata` 首帧 seek 与 `BARE_CLIP_FIRST_FRAME_SECONDS`，否则「可见」规则会在父容器 0 高时失效。新期望证据：`cloud-bare-video-card.e2e.test.js` 的几何断言 + `cloud-bare-video-card.behavior.test.js` 的元数据事件断言。
