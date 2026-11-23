# 随包目录与定价快照刷新及未入账任务查单兼容

工单 [#58](https://github.com/omnimux-ai/omnimux-client/issues/58)。基于公开接口 `https://omnimux.ai/api/pricing`（`ModelPricingGroups` v1 平衡性价比口径）刷新 `plugins/plugins/omnimux/src/catalog/cloud/bundled/pricing.json`，并保护未入账历史任务 `taskId` 在查单恢复 `GET` 时不注入模型默认分组头 `X-Omnimux-Group`。

## 假设

- 公开定价接口 `/api/pricing` 是客户端在售模型、线路成员（`enable_groups`）、默认线路（`default_group`）、展示排序（`group_order`）、计费字段与能力契约的唯一权威来源；本地 `MODEL_CHANNEL_GROUPS` 仅补充展示标签、徽章与兼容约束。
- 生产 `ModelPricingGroups` v1 生效后，16 个在售模型均携带非空 `default_group` 与 `group_order`：
  - `gpt-image-2.5`：`default_group="default"`，`group_order=["default","gpt-image-2.5-economy"]`（`nanobanana-economy` 已下架）。
  - `seedance-2-5`：`default_group="seedance-2-5-720p"`，`group_order=["seedance-2-5-720p","seedance-2-5-480p","seedance-2-5-720p-pro","seedance-2-5-480p-pro"]`（旧 `desktop-480p` / `desktop-720p` 已下架）。
  - `wan-3.0`：`default_group="wan-3.0-720p"`，`group_order=["wan-3.0-720p","wan-3.0-1080p","wan-3.0-standard","wan-3.0-prime"]`。
  - `minimax-h3-video`：`default_group="default"`，`group_order=["default","auto","minimax-h3-video-fast","minimax-h3-video-pro","minimax-h3-video-creative","minimax-h3-video-first-last-frame","minimax-h3-video-digital-human","minimax-h3-video-short-drama","minimax-h3-video-short-drama-av"]`。
  - `indextts-2`：`default_group="default"`，`group_order=["default","auto"]`。
- 当媒体请求处于查单/收取阶段（`isCollect = Boolean(request?.taskRef || request?.taskId)`）且调用方未显式传入分组时，`resolveMediaRoute` 不得将目录发布的 `defaultGroup` 注入 `GET` 查单请求头，否则跨组历史任务会触发上游 `403`。

## 验收标准

1. `plugins/plugins/omnimux/src/catalog/cloud/bundled/pricing.json` 由官方 `catalog-snapshot.mjs` 从 `https://omnimux.ai/api/pricing` 全量生成，16 个在售模型零丢失，上述 5 个核心模型的 `defaultGroup`、`groupOrder` 与目录投影结果逐项精确一致。
2. `omnimux` 与 `omnimux-workflow` 目录/路由/画布受影响单测全部对齐新快照与默认分组语义，不弱化核心契约校验，且 `verify:model-contracts`、`workspace:check`、`bundle:lock:check`、`test:gates` 与 `verify-test-standard-declarations` 全绿。
3. 未入账的裸 `taskId` 查单恢复请求（无显式 `group`/`allowedGroups`）发出的 `GET` 不带 `X-Omnimux-Group`；当模型明确发布 `defaultGroup` 时，新提交请求仍正常锁定默认线路，而查单请求在隔离 `DSH_HOME` 下通过 403 回归守卫。
4. 在隔离 Chromium 页面中基于真实构建目录渲染线路选择与价目展示，核对 5 个核心模型的默认标记、展示顺序与价格显示一致。

## 证伪方式

- 核对 `pricing.json` 及 `projectChannelGroups` 输出：若上述 5 模型任一 `defaultGroup` 或 `groupOrder` 与生产 v1 映射不符，或出现已下架分组（`desktop-480p`、`desktop-720p`、`nanobanana-economy`），则验收失败。
- 移除 `route.js` 的 `!isCollect` 守卫后重跑 `task-collect-lifecycle.test.mjs`，未入账 `taskId` 恢复 `GET` 会错误携带默认 `X-Omnimux-Group` 并导致测试红灯。
- 运行 `verify:model-contracts`、`bundle:lock:check`、`workspace:check`、`verify-test-standard-declarations` 与相关单测，任一项非零退出即视为未通过。

## 旧标准变更

- `plugins/plugins/omnimux/src/catalog/gateway-contract.test.js` :: `Muse ordered reference slots keep the gateway minimum through catalog and submission`
- `plugins/plugins/omnimux/src/catalog/generation-fingerprint.test.js` :: `buildModelCatalog preserves semantic channel candidate order`
- `plugins/plugins/omnimux/src/catalog/pricing-calculator.test.js` :: `generates natural language billing descriptions for Agent perception`
- `plugins/plugins/omnimux/src/catalog/pricing-calculator.test.js` :: `marks expression-billed lines as uncomparable instead of guessing`
- `plugins/plugins/omnimux/src/catalog/pricing-calculator.test.js` :: `takes channel group discount or multiplier ratios into account`
- `plugins/plugins/omnimux/src/catalog/serving/channel-groups.test.js` :: `exports OFFICIAL_CHANNEL_IDS dynamically containing all declared official channel and wireGroup ids as read-only array`
- `plugins/plugins/omnimux/src/catalog/serving/channel-groups.test.js` :: `filters by allowedGroups when provided`
- `plugins/plugins/omnimux/src/catalog/serving/channel-groups.test.js` :: `keeps price and resolution constraints for the bundled seedance-2-5 lines`
- `plugins/plugins/omnimux/src/catalog/serving/channel-groups.test.js` :: `matches official channel group case-insensitively with lowercasing`
- `plugins/plugins/omnimux/src/catalog/serving/channel-groups.test.js` :: `orders the explicit-group tail by the requested strategy`
- `plugins/plugins/omnimux/src/catalog/serving/channel-groups.test.js` :: `restricts the explicit-group failover tail to the allowed pool`
- `plugins/plugins/omnimux/src/catalog/serving/channel-groups.test.js` :: `retires the old pro/cheap lines and fails closed on a pinned dead line`
- `plugins/plugins/omnimux/src/catalog/serving/channel-groups.test.js` :: `returns defined channel groups for seedance-2-0`
- `plugins/plugins/omnimux/src/catalog/serving/channel-groups.test.js` :: `sorts by cost_first (lowest points estimate first)`
- `plugins/plugins/omnimux/src/catalog/serving/channel-groups.test.js` :: `sorts by stability_first (highest 24h stability first; unpublished SLA ranks last)`
- `plugins/plugins/omnimux/src/media/candidate-intent-constraints.test.js` :: `3312: each explicit tier sends the exact bare wire model and its own group header with unchanged resolution through synthetic HTTP`
- `plugins/plugins/omnimux/src/media/candidate-intent-constraints.test.js` :: `3312: the default 720p tier keeps a legal submission with the original logical intent and accepted task record`
- `plugins/plugins/omnimux/src/media/candidate-intent-constraints.test.js` :: `3312: the delisted H3 series exposes no channel groups while the listed multi-line model resolves legal heads`
- `plugins/plugins/omnimux/src/media/candidate-intent-constraints.test.js` :: `3312: the explicitly selected 480p economy tier stays usable with its own fixed resolution`
- `plugins/plugins/omnimux/src/media/execute-fallback.test.js` :: `video failover refuses a resolution-incompatible tier instead of silently switching`
- `plugins/plugins/omnimux/src/media/mount-session-model.test.js` :: `does not disturb the other request fields`
- `plugins/plugins/omnimux/src/media/route.test.js` :: `defaults to the OmniMux openai-media video row`
- `plugins/plugins/omnimux/src/media/route.test.js` :: `pins the seedance-2-5 line by the requested resolution before the default tier`
- `plugins/plugins/omnimux/src/media/route.test.js` :: `resolves channel candidates by cost_first and stability_first strategy`
- `plugins/plugins/omnimux/src/media/routing-boundary.test.js` :: `locks a single explicit line and preserves allowed strategy, wire models and verified BYOK`
- `plugins/plugins/omnimux/src/media/routing-boundary.test.js` :: `rejects conflicting inline and field groups while accepting aliases of the same line`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/channelGroups.test.mjs` :: `reads the model lines out of the catalog rows the shared surfaces already hold`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/channelGroups.test.mjs` :: `resolves exactly the lines the hub directory publishes for a model`
- `plugins/plugins/omnimux-workflow/src/canvas/editor/components/MaterialNode/ConfigPanel/channelGroups.test.mjs` :: `resolves the full spec of the lines the node routes to`
- `plugins/plugins/omnimux-workflow/src/shared/generationPolicy.hub.test.mjs` :: `catalog hydration preserves saved models, operations, results and original edge data for all outputs (#3312)`
- `plugins/plugins/omnimux-workflow/src/shared/generationPolicy.hub.test.mjs` :: `operation recommendations cannot impersonate a model preference or override an explicit operation (#3312)`

原断言均绑定旧随包快照（刷新前 16 个模型无 `default_group` / `group_order`，`seedance-2-5` 仍挂旧 `desktop-480p` / `desktop-720p`，`gpt-image-2.5` 含已下架 `nanobanana-economy` 且单价 `0.3`，`muse-video` 参考图上限为 2，`muse-image` 无 `image_to_image` 槽）。网关刷新为 `ModelPricingGroups` v1 后，旧快照中的已下架线路与旧单价不再存在，且全部 16 个模型发布明确 `defaultGroup` 与 `groupOrder`。

新期望完整保留所有排序、计费、容量、边界拒绝与默认锁定校验：目录与路由单测改为对照刷新后的在售分组（`seedance-2-5-720p` / `seedance-2-5-480p` / `seedance-2-5-720p-pro` / `seedance-2-5-480p-pro`、`gpt-image-2.5` `default` / `gpt-image-2.5-economy`、`wan-3.0` 4 线与 `minimax-h3-video` 9 线）及最新组价与 `muse-video` 2–10 参考图上限，并补充退役旧线路 fail-closed 断言；画布单测在验证已发布默认线路自动钉选与固定参数（如 `gpt-image-2.5` `1K`/`n=1`、`seedance-2-5` `720p`）的同时，仍通过剥离 `default` 的夹具保留无默认线路返回 `{}` 的回归检验。
