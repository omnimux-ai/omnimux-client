# 规格：omnimux-accounts 迁至 tiktok_direct 与 TikTok video.upload 草稿模式适配（Issue #185）

## 1. 背景与目标

生产网关已退役 Zernio 聚合来源并上线 TikTok 官方直连 `video.upload` 草稿上传与图文轮播草稿（`MEDIA_UPLOAD`）能力，账号列表返回 `capabilities: { upload_draft, publish_direct }`，任务状态新增 `sent_to_inbox` / `SEND_TO_USER_INBOX`。本规格覆盖客户端全链路适配：

1. **`omnimux-accounts` 迁至 `tiktok_direct`**：移除服务端与前端 4 处 `provider: 'zernio'` 硬编码，支持平台收敛为 `['tiktok']`（其余渠道标示为即将上线），同步透传账号 `capabilities`。
2. **双层透传 `capabilities`**：`omnimux` hub 与 `omnimux-publish` 白名单安全透传 `upload_draft` / `publish_direct` 及可选服务端媒体数量上限（`max_media_items` / `max_images`），旧响应缺失该字段时省略键并安全降级。
3. **`omnimux-publish` 草稿模式与收件箱送达态**：
   - 关闭无效的 `tiktok.supports_schedule`，新增独立聚合/展示态 `sent_to_inbox`（「已送达草稿箱」），避免滞留「发布中」同时保留手动「同步平台状态」；
   - `draft_only` 账号零 `creator-info` 请求，隐藏 Direct Post 表单，视频剥离直发选项，图文仅允许 JPEG/WebP、禁混发并透传 `title` / `description` / `photo_cover_index` / `is_aigc`；
   - 图文轮播按 1–35 张（TikTok 图文草稿协议上限）校验并清晰展示该区间；托管网关默认 35 张，服务端经能力下发更小上限时按服务端上限动态收敛展示与拦截，被拒收时完整透传服务端原始报错。

## 旧标准变更

- `plugins/plugins/omnimux-accounts/src/client/api.test.js` :: `fixes every account operation to Zernio and filters same-name foreign rows`
  - 原断言：断言 `omnimux-accounts` 前端接口固定请求 `provider=zernio` 并过滤掉 `tiktok_direct` 账号。
  - 变更理由：网关已退役 Zernio 来源（返回 `410 provider-retired`），按 Issue #185 方案 A 将 `omnimux-accounts` 全量迁移至官方直连 `tiktok_direct`。
  - 新期望证据：用例更新为 `fixes every account operation to tiktok_direct and filters same-name foreign rows`，断言所有接口固定携带 `provider=tiktok_direct`、过滤 `zernio` 与缺失来源行，并保留 `capabilities`。

- `plugins/plugins/omnimux-accounts/src/tools.test.js` :: `omnimux-accounts tools lifecycle`
  - 原断言：断言 `accounts_list` 与 `accounts_update_group` 调用 `provider: 'zernio'` 并以 `account does not belong to Zernio` 拒收非 Zernio 账号。
  - 变更理由：网关已退役 Zernio，工具层必须改为 `provider: 'tiktok_direct'` 并移除过时 Zernio 错误文案。
  - 新期望证据：断言调用 `provider: 'tiktok_direct'`、过滤 `zernio` 账号、拒收非 `tiktok_direct` 账号且透传 `capabilities`。

- `plugins/plugins/omnimux-accounts/tests/e2e/connect-modal-flow.spec.js` :: `renders 3-column grid for primary supported platforms without single-item blank`
  - 原断言：断言 `SUPPORTED_PLATFORMS` 包含 `['tiktok', 'instagram', 'youtube']`。
  - 变更理由：迁至 `tiktok_direct` 官方直连后，仅 TikTok 已接入，保留未接入渠道会导致直连授权请求直接返回 `400 invalid-provider`。
  - 新期望证据：断言 `SUPPORTED_PLATFORMS` 收敛为 `['tiktok']`。

- `plugins/plugins/omnimux-accounts/tests/e2e/connect-modal-flow.spec.js` :: `renders dedicated coming channels strip for secondary channels`
  - 原断言：断言 `COMING_PLATFORMS` 仅为 `['x', 'facebook']`。
  - 变更理由：未在官方直连开放的 `instagram` 与 `youtube` 随迁移移入即将上线列表。
  - 新期望证据：断言 `COMING_PLATFORMS` 为 `['instagram', 'youtube', 'x', 'facebook']`。

- `plugins/plugins/omnimux-accounts/tests/e2e/connect-modal-flow.spec.js` :: `provides bilingual strings for coming channels hint and platform descriptions`
  - 原断言：断言中英 `connect.comingChannels` 仅列出 `X` 与 `Facebook`。
  - 变更理由：同步反映 `Instagram`、`YouTube` 迁入即将上线渠道的真实能力边界。
  - 新期望证据：断言中英 `connect.comingChannels` 包含 `Instagram`、`YouTube`、`X`、`Facebook`，且所有平台描述完整。

- `plugins/plugins/omnimux-publish/src/config.test.js` :: `maps every value into a task status`
  - 原断言：断言 `BUILTIN_STATUS_MAP` 所有值仅落在四态 `submitted` / `reviewing` / `published` / `failed`。
  - 变更理由：TikTok `video.upload` 草稿上传完成时返回 `SEND_TO_USER_INBOX` / `sent_to_inbox`，需映射到独立任务状态 `sent_to_inbox` 而非滞留进行中态。
  - 新期望证据：断言 `BUILTIN_STATUS_MAP` 合法值扩展为五态（含 `sent_to_inbox`），并验证 `sent_to_inbox` / `send_to_user_inbox` 正确映射及 `BUILTIN_PLATFORMS.tiktok.supports_schedule === false`。

- `plugins/plugins/omnimux-publish/src/shared/record-status.test.js` :: `always produces one of the five aggregate states without mutating input`
  - 原断言：断言聚合状态集合仅含五态（不含 `sent_to_inbox`）。
  - 变更理由：新增 `sent_to_inbox` 独立聚合态以准确表达「已送达 TikTok 收件箱草稿」并停止无效轮询。
  - 新期望证据：用例更新为 `always produces one of the six aggregate states without mutating input`，断言聚合状态落在六态集合且覆盖 `sent_to_inbox` 组合推导。

- `plugins/plugins/omnimux-publish/src/shared/record-status.test.js` :: `counts array and dictionary inputs identically and ignores non-object entries`
  - 原断言：`calculateSubtaskSummary` 返回结构仅含 `total` / `published` / `failed` / `inFlight` / `reviewing` / `submitted`。
  - 变更理由：子任务摘要新增 `sentToInbox` 计数以支持 `sent_to_inbox` 与 `partial_failed` 聚合判定。
  - 新期望证据：断言 `calculateSubtaskSummary` 包含 `sentToInbox` 计数并准确统计 `sent_to_inbox` 子任务。

- `plugins/plugins/omnimux-publish/src/client/status-display.test.js` :: `STATUS_LABEL 六态完整且无死角`
  - 原断言：断言展示态中文单真源字典仅有 6 态。
  - 变更理由：新增 `sent_to_inbox` 独立展示态，中文单真源定案为「已送达草稿箱」。
  - 新期望证据：用例更新为 `STATUS_LABEL 七态完整且无死角`，断言 7 个展示态（含 `sent_to_inbox: '已送达草稿箱'`）完整覆盖无遗漏。
