# 对齐全部 8 个社媒分析工具与看板聚合的网关参数契约

## 背景

PR #271（`specs/tool-seam-and-reasoning-policy.spec.md`）在为 `omnimux-analytics` 引入只读接缝 `omnimuxAnalytics` 时保留了一项既有债：Hub 注册给 Agent 的 `omnimux_analytics_*` 工具仍沿用 Zernio 原生驼峰字段，与 OmniMux 网关真实契约不一致。

逐一核对公开网关仓 `omnimux-ai/omnimux-gateway`（`controller/social.go` 与 `service/social/service.go`）后，确认**全部 8 个分析端点与看板聚合管道 `cloudPipeline.js` 均存在契约漂移**：

| 网关端点 | 网关真实入参（`controller/social.go`） | 客户端原状（`mount.js` / `analytics.js` / `cloudPipeline.js`） | 实际故障 |
| --- | --- | --- | --- |
| `GET /api/social/v1/analytics/daily-metrics` | query: `fromDate`, `toDate`, `platform`, `timezone`, `account_ids`（逗号分隔正整数 int64） | 工具声明 `accountIds`, `profileId`（禁额外键）且缺 `timezone`；`buildCloudQuery` 仅发 `accountIds`/`accountId` | 按账号筛选静默失效，被网关放宽为全账号聚合；传 `account_ids` 被 Schema 拒绝 |
| `GET /api/social/v1/analytics/best-time-to-post` | query: `platform`, `timezone`, `account_id`（正整数 int64） | 工具声明 `accountId`, `profileId` 且缺 `timezone`；`cloudPipeline` 发 `accountIds`/`accountId`/`fromDate`/`toDate`/`days` | 按账号筛选静默失效；非法 ID 被 `strconv.ParseInt` 吞为 0 放宽为全账号 |
| `GET /api/social/v1/analytics/posting-frequency` | query: `platform` | 工具声明 `profileId`；`cloudPipeline` 透传全量 `cloud` | 暴露并透传服务端租户自解析的无效 `profileId` 及未支持键 |
| `GET /api/social/v1/analytics/content-decay` | query: `platform` | 工具声明 `profileId`；`cloudPipeline` 透传全量 `cloud` | 同上 |
| `GET /api/social/v1/accounts/follower-stats` | query: `days`（正整数）, `account_ids`（逗号分隔正整数 int64） | 工具声明 `accountIds`, `profileId`；`cloudPipeline` 仅发 `accountIds`/`accountId` 及日期键 | 按账号筛选静默失效 |
| `GET /api/social/v1/analytics/posts` | query: `post_id`, `platform`, `sortBy`, `sortOrder`, `page`, `limit` | 工具声明 `postId`；`cloudPipeline` 混传 `fromDate`/`toDate`/`days`/`accountIds`/`accountId` | 单帖查询参数名错位失效；看板混传无效窗口与账号过滤键 |
| `POST /api/social/v1/analytics/sync-external-posts` | JSON body: `account_id`（必填正整数 int64）, `url`（可选字符串） | 工具与 `aggregateSync` 发送字符串 `accountId` | 真实网关固定绑定 `int64` 键 `account_id`，旧请求恒返 HTTP 400 `account_id is required` |
| `GET /api/social/v1/inbox-analytics/{volume,response-time,heatmap,source-breakdown}` | `volume`/`response-time`/`source-breakdown`: `platform`, `fromDate`, `toDate`；`heatmap`: `platform`, `timezone` | 工具声明 `profileId`, `accountId`，缺少 `platform` 与 `timezone`；单测把 `fromDate` 传给 `heatmap` | 无法按 `platform` 过滤或为 `heatmap` 指定 `timezone`，反而暴露网关忽略的 `profileId`/`accountId` |

## 假设

- 根因假设：客户端 `omnimux` Hub 的分析传输层（`analytics.js`）、官方工具注册（`mount.js`）与看板聚合层（`analytics/cloudPipeline.js`）最初按 Zernio 上游直连字段编写，未随 OmniMux 网关的租户隔离层（服务端自行注入 `profileId`，本地正整数账号 ID 使用 `account_ids`/`account_id`，帖子查询使用 `post_id`）收敛，且传输层无白名单校验与正整数校验，导致错误键名或非法 ID 在网关侧被静默忽略或返回 400。
- 设计假设：在 `analytics.js` 这一单一真源层对全部 8 个端点强制执行网关参数白名单、正整数账号/分页校验及 `sync-external-posts` 的 `account_id` 数值序列化，再同步对齐 `mount.js` 工具 Schema、`cloudPipeline.js` 按端点分源构造参数、`http-routes.js` 400 错误映射与 `dsh.manifest.json` 接缝声明，可消除工具面、接缝面、原始透传路由与看板聚合四条路径的契约漂移，且保持 `omnimux` 工具字符预算不高于冻结基线（38971 字符）。

## 证伪方式

- 若回退本次对 `analytics.js`、`mount.js` 与 `cloudPipeline.js` 的修复，新增回归测试必须立即断言失败：例如 `omnimux_analytics_daily_metrics` / `omnimux_analytics_follower_stats` / `omnimux_analytics_best_time` / `omnimux_analytics_posts` / `omnimux_analytics_sync_external` / `omnimux_analytics_inbox` 的 Schema 与请求 URL/Body 不匹配网关真源，或 `analytics.js` 未拒绝 `accountIds`/`accountId`/`postId`/`profileId` 及 `0`/负数/非数字账号 ID，或 `cloudPipeline.js` 继续向 `daily-metrics` 发 `accountIds`、向 `posts` 发日期/账号键、向 `sync-external-posts` 发字符串 `accountId`。
- 若工具 Schema 改动导致 `test-agent-tools.mjs` 的 Layer 1–4 校验或 `--budget` 超出 `omnimux` 基线，或破坏 `omnimux-analytics` 现有单测与边界门禁，说明改动引入回归，必须修正后重验。
- 可执行验证命令：
  - `node --test plugins/plugins/omnimux/src/official/analytics.test.js plugins/plugins/omnimux/src/official/analytics-aggregate.test.js plugins/plugins/omnimux/src/official/mount.test.js plugins/plugins/omnimux/src/official/http-routes.test.js`
  - `node --test plugins/plugins/omnimux-analytics/src/*.test.js`
  - `corepack pnpm --dir plugins run build:all`
  - `corepack pnpm --dir plugins run test:agent-tools` 与 `node plugins/scripts/test-agent-tools.mjs --budget`
  - `node plugins/scripts/verify-plugin-boundaries.mjs`、`node plugins/scripts/verify-plugin-agent-tools.mjs --base origin/main --head HEAD`、`node plugins/scripts/verify-test-standard-declarations.mjs . origin/main`、`node plugins/scripts/verify-fix-regression-test.mjs . origin/main --pr-title "fix(omnimux): align analytics tools and dashboard pipeline with gateway contract"`、`node scripts/workspace-check.mjs --check`

## 范围

- `plugins/plugins/omnimux/src/official/analytics.js`：为全部 8 个分析端点实施网关参数白名单与显式拒错（拒绝未知或旧驼峰键如 `accountIds`、`accountId`、`postId`、`profileId`），校验 `account_ids`/`account_id`/`days`/`page`/`limit` 为正安全整数（避免网关静默丢弃），将 `sync-external-posts` 的 `account_id` 转为正整数 JSON number 线值，按 `inbox-analytics` 子能力区分允许字段（`heatmap` 仅允许 `platform`/`timezone`，其余三项仅允许 `platform`/`fromDate`/`toDate`）。
- `plugins/plugins/omnimux/src/official/mount.js`：对齐全部 8 个 `omnimux_analytics_*` 工具的参数 Schema，同步 `omnimuxAnalytics` 接缝注释。
- `plugins/plugins/omnimux/src/official/analytics/cloudPipeline.js`：`buildCloudQuery` 改产出 `account_ids` 与 `account_id`（不再产出 `accountIds`/`accountId`）；各 `aggregate*` 按每个端点真实支持的查询键分源构造参数；`aggregateSync` 改传 `account_id`；`settleCloud` 透传 400 类客户端参数错误不再静默吞掉。
- `plugins/plugins/omnimux/src/official/http-routes.js`：`mapOfficialError` 将 `analytics-invalid-account-id`、`analytics-invalid-query`、`analytics-invalid-capability` 映射为 HTTP 400。
- `plugins/plugins/omnimux/dsh.manifest.json`：更新 `omnimuxAnalytics` 接缝的 `interfaceDoc`。
- 对应单测补充与 `bundle.lock.json` 刷新。

## 不做

- 不修改网关仓 `omnimux-ai/omnimux-gateway` 的接口行为，也不更改分析模块当前 `provider: 'zernio'` 的账号数据源（网关侧全部分析端点当前仍经 Zernio 租户提供）。
- 不修改 `omnimux-analytics` 前端 UI 组件及样式（UI 与 Host 之间的 `profileId` 筛选接口保持不变，由 Host `cloudPipeline.js` 负责向网关字段转换）。
- 不调整 `omnimux-analytics` 处于 `alpha` 档位的发布状态。

## 旧标准变更

- `plugins/plugins/omnimux/src/official/analytics.test.js` :: `calls syncExternalPosts with POST body`
  - 原断言：调用 `syncExternalPosts(client, { accountId: 'acc-1', url: 'https://tiktok.com/video/123' })`，断言发送体为 `{ accountId: 'acc-1', url: 'https://tiktok.com/video/123' }`。
  - 变更理由：网关 `POST /api/social/v1/analytics/sync-external-posts` 仅绑定 JSON 字段 `account_id`（`int64 > 0`），旧用例锁定的驼峰字符串键 `accountId: 'acc-1'` 在真实网关必定返回 HTTP 400。
  - 新期望证据：传入 `{ account_id: '12', url: 'https://tiktok.com/video/123' }`，断言发送体为 `{ account_id: 12, url: 'https://tiktok.com/video/123' }`（`account_id` 为正整数），并新增拒绝 `accountId`、缺失或非法 `account_id` 的断言。
- `plugins/plugins/omnimux/src/official/analytics.test.js` :: `calls getInboxAnalytics for various capabilities`
  - 原断言：调用 `getInboxAnalytics(client, 'heatmap', { fromDate: '2026-08-01' })` 并断言请求路径为 `/api/social/v1/inbox-analytics/heatmap?fromDate=2026-08-01`。
  - 变更理由：网关 `GET /api/social/v1/inbox-analytics/heatmap` 只读取 `platform` 与 `timezone`，不接受 `fromDate`/`toDate`；原用例锁定了会被网关静默忽略的参数组合。
  - 新期望证据：分别验证 `heatmap` 透传 `platform`/`timezone`、`volume` 透传 `platform`/`fromDate`/`toDate`，并新增断言校验 `heatmap` 拒绝 `fromDate` 与 `toDate`、未知子能力报错。
- `plugins/plugins/omnimux/src/official/analytics-aggregate.test.js` :: `expands 30d into fromDate/toDate and forwards a concrete account id`
  - 原断言：调用 `buildCloudQuery({ timeRange: '30d', profileId: 'acc_tt_01', platform: 'tiktok' }, now)` 并断言 `cloud.accountIds === 'acc_tt_01'`。
  - 变更理由：网关分析端点仅接受正整数本地账号 ID 与蛇形键 `account_ids`/`account_id`，原用例锁定了已被网关静默忽略的 `accountIds` 与非数字夹具。
  - 新期望证据：传入 `profileId: '42'`，断言 `cloud.account_ids === '42'`、`cloud.account_id === '42'` 且不含 `accountIds`/`accountId`，同时新增聚合回归用例验证 `overview`/`insights`/`followers`/`posts` 各自只发送对应网关支持的查询键。
- `plugins/plugins/omnimux/src/official/analytics-aggregate.test.js` :: `stamps incremental sync timestamps in aggregateSync`
  - 原断言：调用 `aggregateSync(client, { profileId: 'acc_01' }, { now: 1700000000000 })`，未校验发送给网关的请求体键名和数值类型。
  - 变更理由：网关 `sync-external-posts` 强绑定正整数 `account_id`，非数字 `'acc_01'` 与旧键 `accountId` 均无法通过网关校验。
  - 新期望证据：传入 `profileId: '42'`，断言 `client.withPat` 收到的请求体精确为 `{ account_id: 42 }`（`typeof === 'number'`），并新增用例断言缺失或非正整数账号 ID 抛 `analytics-invalid-account-id`。
