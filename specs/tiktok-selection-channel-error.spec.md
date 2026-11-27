# 修复社媒数据通道不可用时的客户端错误提示

## 背景与现象

线上在「TikTok 跟爆选品」等社媒数据采集能力中，当网关侧返回通道不可用错误（`CHANNEL_UNAVAILABLE` / HTTP 503 或业务信封无可用渠道）时，客户端沿用通用模型错误文案「该模型当前不可用，请换一个试试」，导致用户误以为需要切换 AI 对话模型，而未能获知是社媒数据源通道暂不可用或可先导入 CSV/JSON 快照。

## 假设

1. `plugins/plugins/omnimux/src/errors/channel-classifier.js` 的 `SAFE_CHANNEL_MESSAGE` 服务于 AI 对话与生成模型场景，需保持不变。在非对话的社媒数据根源模块 `plugins/plugins/omnimux/src/official/social-data.js` 导出 `SOCIAL_DATA_CHANNEL_UNAVAILABLE_MESSAGE = '社媒数据通道暂不可用，请稍后重试'`，并在 `fetchSocialData` 捕获 `client.withSk` 抛出的 `CHANNEL_UNAVAILABLE` 错误以及 `pickSocialPayload` 处理 `failure.kind === 'channel-unavailable'` 时统一改抛该文案（保留 `code: 'CHANNEL_UNAVAILABLE'`、`status: error.status || 503` 与 `retryable: true`），同时保持 `X-Omnimux-Group: social-data-tikhub`、模型目录与 `AbortError`/`needs-omnimux`/`quota-exceeded` 原样透传，即可从根源消除所有 `socialData` 调用方的误导提示。
2. 在 `plugins/plugins/omnimux-tiktok-selection/src/datasource.js` 中，新增局部格式化函数识别 `err?.code === 'CHANNEL_UNAVAILABLE'`：`queryRank` 与 `searchProducts` 抛出 `SelectionError('upstream-failed', '实时选品数据源暂不可用，请稍后重试或先导入 CSV/JSON 快照')`，`getProductDetail` 的详情、参考视频与评价三个降级 `warnings` 返回 `'实时选品数据源暂不可用，请稍后重试'`，即可保留 `needs-omnimux` 等现有错误语义并给出清晰的操作引导。
3. 兄弟路径 `omnimux-products/src/tiktok-shop-import.js` 与 `omnimux-inspiration` 直接消费 `socialData` 错误或显式映射 `CHANNEL_UNAVAILABLE`，无需额外修改即可受益于根源修复。

## 证伪方式

- 在 `plugins/plugins/omnimux/src/official/social-data.test.js` 增加 `CHANNEL_UNAVAILABLE` 回归测试，覆盖 `client.withSk` 返回 503 与 `pickSocialPayload` 信封两条路径，断言抛出 `OmnimuxError`、文案为 `SOCIAL_DATA_CHANNEL_UNAVAILABLE_MESSAGE` 且不含 `'该模型当前不可用'`，并验证 `needs-omnimux`、`quota-exceeded` 与 `AbortError` 保持原样。
- 在 `plugins/plugins/omnimux-tiktok-selection/src/store-and-datasource.test.js` 增加回归测试，验证 `socialData.fetch` 抛出 `CHANNEL_UNAVAILABLE` 时 `queryRank`、`searchProducts` 与 `getProductDetail` 返回预期选品提示，同时保留 `needs-omnimux` 与 `quota-exceeded` 原有行为。
- 临时将 `social-data.js` 与 `datasource.js` 的核心修改回退至基线并重跑上述两个测试文件，确认新增用例均真实断言失败；恢复修改后完成全量插件构建、单测与仓库门禁校验。

## 验收标准

- 不改动任何 `.jsx` UI 布局，不改动 `SOCIAL_DATA_GROUP`（`social-data-tikhub`）及模型目录，不改动 `channel-classifier.js`。
- 所有目标单测、全插件构建、`bundle-lock.mjs`、`workspace-check.mjs --check` 及 `verify-fix-regression-test.mjs` 门禁均全部通过。
