# 规格：社媒账号席位状态、手动续费 UI 与结构化席位错误透传（Issue #412）

## 背景与目标

服务端网关已上线按席位计费协议（`omnimux-gateway#142` / PR `#144`）：单席位 20 积分 / 30 天、上限 20 席、无阶梯、宽限期 7 天、最长累计 90 天、同号免费重绑、跨号每周期最多免费换绑 2 次、无静默自动续费，生产默认 `billing_mode = "off"`。

本任务在 `omnimux-client` 内完成客户端全链路接入，覆盖三层：

1. **Hub 执行中枢（`plugins/plugins/omnimux`）**：
   - `GET /omnimux/accounts` 白名单透传账号 `seat` 字段（`billing_mode = "off"` 省略不返回）；
   - 新增 `GET /omnimux/accounts/seats`（白名单透传席位汇总与 `vacant_seats`）；
   - 新增 `POST /omnimux/accounts/:id/renew`（仅面向 UI，受 `assertLocalWrite(..., { rejectSameSite: true })` 同源写入保护，**严禁注册为 Agent 自动扣费工具**）；
   - 保留网关 `SOCIAL_SEAT_QUOTA`（HTTP `402` + `error: "quota-exceeded"` + `code: "SOCIAL_SEAT_QUOTA"` + `need_credits`）及 `SOCIAL_SEAT_CAP` / `SOCIAL_SEAT_EXPIRED` / `SOCIAL_SEAT_RENEW_LIMIT` / `SOCIAL_SEAT_SWAP_LIMIT`（HTTP `409`），并在工具面抛出时携带结构化尾标以便下游无损还原。
2. **发布插件宿主与 Agent 错误契约（`plugins/plugins/omnimux-publish`）**：
   - 账号白名单与可用性判定同源透传 `seat` 并拦截 `frozen` / `unactivated` 席位（结构化错误码 `SOCIAL_SEAT_EXPIRED`），明确指引用户前往「发布 → 账号」手动续费；
   - `hubtools.js` 与 `http-helpers.js` / `http-routes.js` 保留全部 `SOCIAL_SEAT_*` 结构化错误码与参数，不降级为模糊 `hub-tool-error`；
   - 更新 `PUBLISH_PROMPT`、`publish_submit` 工具说明与 `plugins/docs/contracts/plugin-agent-tools-inventory.md` 契约清单。
3. **发布插件客户端界面（`plugins/plugins/omnimux-publish/src/client/`）**：
   - 先交付高保真独立 HTML 交互演示并在真实浏览器完成亮/暗主题与宽/窄视口自查，再实施产品代码；
   - `billing_mode !== "seat"` 时零席位 UI 渲染、零额外扣费文案，与现网完全无回退；
   - `billing_mode === "seat"` 时在「账号」侧栏展示精简席位摘要条、账号行到期日/冻结倒计时与行内续费/激活入口、更多菜单续费项（达 90 天上限禁用并提示）、续费确认弹窗（新到期日预览 + 402 余额不足接入原生充值流）、解绑确认弹窗有效期说明、授权弹窗 1 行扣费/空席/上限提示，以及「新建发布」左侧渠道面板对冻结席位的置灰与「去续费」跳转。

## 假设

1. 网关在 `billing_mode === "off"` 时省略 `account.seat` 且 `GET /api/social/v1/seats` 返回 `billing_mode: "off"`，客户端以服务端契约为唯一真源，不在本地推导席位价格、上限或冻结规则。
2. `POST /omnimux/accounts/:id/renew` 仅经 UI 确认弹窗调用，且 402 `SOCIAL_SEAT_QUOTA` 响应保持 `status: 402` 与 `error: "quota-exceeded"`，从而无需修改 `dsh-ui-kit` 即可复用现有 `quotaGuard` 充值弹窗。
3. `AccountsSidebar` 挂载及每次账号刷新同步拉取 `GET /omnimux/accounts?provider=tiktok_direct&platform=tiktok` 与 `GET /omnimux/accounts/seats`，席位接口失败不影响账号列表加载，且 `billing_mode !== "seat"` 时不渲染任何席位视觉元素。
4. `omnimux-publish` Host 校验（`accounts.js` / `validate.js`）与前端渠道选择（`capabilities.js` / `AccountPanel.jsx`）共用 `shared/social-seat.js` 冻结判定，避免 UI 允许勾选但 Host 拒绝或反向漂移。

## 证伪方式

以下任一可观测结果即证伪上述假设：

1. **Hub 路由与错误透传证伪**：运行 `corepack pnpm --dir plugins --filter omnimux test` 时，若 `GET /omnimux/accounts` 丢失 `seat` 或在 `off` 态伪造 `seat`、`POST /omnimux/accounts/:id/renew` 绕过跨站拦截或被错误注册进 `ctx.tools`（注册数偏离 42）、`402 SOCIAL_SEAT_QUOTA` 丢失 `error: "quota-exceeded"` / `need_credits` 或 `409 SOCIAL_SEAT_*` 退化为 `502`，则假设不成立。
2. **Publish 宿主与前后端同源证伪**：运行 `corepack pnpm --dir plugins --filter omnimux-publish test` 及新增端到端测试 `plugins/plugins/omnimux-publish/tests/e2e/publish-seat-billing-412.e2e.test.mjs` 时，若冻结席位未被 `accountAvailability` / `validateForSubmit` / `accountUsable` 一致以 `SOCIAL_SEAT_EXPIRED` 拦截，或 `hubtools.js` 将 `SOCIAL_SEAT_*` 吞成 `hub-tool-error`，则假设不成立。
3. **UI 与门禁证伪**：运行 `node plugins/scripts/verify-dsw-tokens.mjs`、`corepack pnpm --dir plugins run verify:tools`、`corepack pnpm --dir plugins run build:all`、`node scripts/workspace-check.mjs --check` 以及真实浏览器 Worktree QA 时，若出现未定义 `--dsw-*` Token、`billing_mode = "off"` 泄露席位 UI、宽/窄视口水平溢出、控制台报错、中文界面含中点 `·` 或续费确认弹窗未正确计算 +30 天与刷新双接口，则假设不成立。

## 研究与对标

- 行业市场定价调研（11 个竞品、3 大类，涵盖 Buffer / Hootsuite / Sprout Social / Later / Metricool / Late-Zernio / Ayrshare / Upload-Post 等）结论：按席位固定 20 积分（\$2）/ 30 天、无阶梯、同号免费重绑与有限跨号换绑、手动续费无静默扣款，最匹配创作者与矩阵用户的透明成本预期。
- 对标本仓既有实现模式：
  - `omnimux` Hub 账号白名单与同源写入保护沿用 `public-account.js`、`avatarIdFromPath` 与 `assertLocalWrite`；
  - `omnimux-publish` 结构化错误透传沿用 Issue `#186` 的 `SOCIAL_TIKTOK_*` 尾标与 `errorPayload()` 模式；
  - `omnimux-publish` UI 交互与样式沿用 `dsh-ui-kit`（`Button`、`ConfirmModal`、`ModalDialog`、`quotaGuard`）与纯 `--dsw-alias-*` 语义 Token。

## 契约与实现边界

- 本任务严格仅修改 `omnimux-client` 仓库，不跨仓修改 `omnimux-gateway`；不改动生产网关 `billing_mode = "off"` 配置。
- `POST /omnimux/accounts/:id/renew` 与 `GET /omnimux/accounts/seats` 归属 UI-Only 路由（不在 `omnimux` Hub 注册续费 Agent 工具），在 `plugins/docs/contracts/plugin-agent-tools-inventory.md` 显式登记为 `UI-Only` 豁免项。

## 旧标准变更

- `plugins/plugins/omnimux-publish/src/client/AccountsSidebar.disconnect.test.js` :: `cancels without DELETE, then deletes the selected same-name account and refreshes GET`
  - 原断言：`assert.equal(calls.filter((call) => call.method === 'GET').length, 2)`，假设 `AccountsSidebar` 每次刷新仅发送 1 个 GET 请求（`/omnimux/accounts`）。
  - 变更理由：接入社媒账号席位状态后，`AccountsSidebar` 每次加载/刷新同步发起 `GET /omnimux/accounts?provider=tiktok_direct&platform=tiktok` 与 `GET /omnimux/accounts/seats` 两个 GET 请求以获取最新席位余额与 `billing_mode`。
  - 新期望证据：分别断言账号列表 GET（`/omnimux/accounts?`）恰好调用 2 次、席位摘要 GET（`/omnimux/accounts/seats`）恰好调用 2 次，且取消时不发 DELETE、确认后精准发送 1 次 DELETE。
