# Spec: muse-video 首帧/文生提交映射到 openai_video 契约

- 任务：`issue-89-muse-video-mapping`
- 日期：2026-11-18
- 基线：`origin/main` `5a76534`
- 风险：R1（视频提交请求体；只改客户端 SubmitGuard 映射与测试，不改网关/上游行为）

## 背景

画布提交 `muse-video` 时，`videoGenerate` 通用映射把 `aspectRatio` 写入像素尺寸字段 `size`，首帧写入 `image_with_roles`。网关的 `openai_video` 契约要求首帧走 `image`、画幅走 `aspect_ratio`；`size:"adaptive"` 命中用量枚举校验并返回 400 `plugin_usage_invalid`，任务创建前即失败。`text_to_video` 的 `size:"16:9"` 同样触发。

## 范围

只改 `plugins/plugins/omnimux/src/catalog/contract/submit-guard/map.js`：

1. `muse-video` 的 `first_frame`：`image` 承载原始首帧 URL，`aspect_ratio` 提交合同值（`adaptive`），`duration` 原样保留；不出现 `image_with_roles` / `size`。
2. `muse-video` 的 `text_to_video`：`aspect_ratio` 承载画幅（16:9 / 9:16 / 1:1）；不出现 `size`。
3. `muse-video` 提交与轮询统一走 `videos`：`POST /v1/videos`、`GET /v1/videos/:task_id`；其他视频模型保持 `video/generations`。
4. `muse-video` 判定使用精确模型 id，不用宽泛 family，避免误伤其他渠道形状的模型。
5. 其他视频模型的既有 `image_with_roles` / `size` 映射与旧 `video/generations` 路径保持不变；旧在途任务按持久化 `taskPath` 继续轮询旧路径。

## 非目标

- 不放宽网关的用量枚举校验，不改网关代码。
- 不发起真实付费视频生成；验证只用本地模拟上游。
- 不改其他视频模型的映射、提示词、UI 或模型目录。

## 验收

- [ ] 首帧：真实客户端媒体入口调用 `POST /v1/videos`，请求体包含原始首帧 `image`、`duration:10`、`aspect_ratio:"adaptive"`，不含 `size` / `image_with_roles`；模拟网关返回 task ID 并收到原始首帧 URL。
- [ ] 文生：`POST /v1/videos` 请求体使用 `aspect_ratio:"16:9"`（或 9:16 / 1:1），不含 `size`；模拟网关返回 task ID。
- [ ] 轮询：`GET /v1/videos/:task_id` 返回 completed 与可读 `video_url`；旧在途任务的 `video/generations` 轮询保持兼容。
- [ ] 无 group 头的常规路径与显式 group 路由都实际覆盖；不把 `X-Omnimux-Group: pool` 固定进客户端或默认测试。
- [ ] 模拟网关保留非法 `size` 枚举校验：`size:"adaptive"` 仍返回 400 `plugin_usage_invalid`。
- [ ] `seedance-2-5` 首帧/文生与 `wan-3.0` 文生请求体逐字段回归不变；其他视频模型路径仍为 `video/generations`。
- [ ] 单测覆盖最终请求体逐字段断言与 fetch 级 method/path/headers/body。

## 验证命令

- `corepack pnpm --filter omnimux test`
- `corepack pnpm --dir plugins run build:all`
- `corepack pnpm --dir plugins run check:boundaries`
- `corepack pnpm --dir plugins run verify:plugin-load`
- `corepack pnpm --dir plugins run verify:product-baseline`
- `corepack pnpm verify:model-contracts`
- `node scripts/workspace-check.mjs --check`
- `node scripts/bundle-lock.mjs --check`
- `git diff --check`
