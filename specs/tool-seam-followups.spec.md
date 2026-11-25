# 工具接缝与分析推理档位的评审回归修复

## 背景

PR #271 落地了「工具定义直调收口 + 分析假数据去除 + 语义推理档位」。独立评审在合并后提出 13 项缺陷，本任务修复其中影响正确性与契约一致性的部分。

## 修复清单

1. **`hubtools.js` 探测回退**：DSH 0.2.2-rc.5 的 `tools.executable(name)` 在不带 `scope`/`toolSet` 时会拒绝带 `when` 条件的注册，而 `ctx.tools.execute` 仍能派发。`resolveToolDefinition` 现在在 `executable()` 返回空时回退 `tools.get()`，避免把条件注册误报为「hub 未装载」。
2. **分析端点参数分源**：`dailyMetrics` 接受 `fromDate`/`toDate`/`platform`/`account_ids`，而 `/analytics/posts` 只接受 `platform`、分页与排序。此前后者收到日期与账号键（网关静默忽略），却与前者共用 `query`，导致「按窗口统计」的表述失真。现在 `queries.daily` 与 `queries.posts` 分别构造，并在 `warnings` 里明确「posts 不支持时间窗与账号过滤，返回默认首页 20 条」。
3. **`includeTopPosts: false` 不再请求 posts**：`queryMetrics` 新增 `includePosts` 选项，日报式摘要不会因为 posts 源不可用而变成 `partial` 或直接失败。
4. **载荷空值与 `success:false` 判定为错误**：`readSource` 把 `null`/`undefined` 载荷与上游 `{ success: false }` 信封记为逐源错误，不再返回 `ok:true` 的空成功。
5. **账号过滤收紧为正整数**：`0`、负数、超 `Number.MAX_SAFE_INTEGER` 的 ID 会让网关静默丢弃过滤条件；现在统一抛 `analytics-invalid-account-id`。
6. **时间窗改为含首尾的 N 天**：`fromDate` 取 `toDate - (N-1)` 天，避免 `7d` 实际覆盖 8 个日期。
7. **推理档位不再取「适配器最小档」兜底**：`selectAdapterEffort` 只接受 `llm-pi-ai` 明确声明且适配器同时公布的档位；未声明就不下发，符合契约「交集为空即保持路由默认」。
8. **媒体请求拒绝降档**：`executeOmnimuxText` 对 `references.length > 0` 且 `reasoning: 'minimal'` 的请求抛 `omnimux-invalid-request`，防止图片/视频/音频/文档分析被降档后由纯文本修复轮补字段。
9. **headless 档位上报语义澄清**：修复轮固定 `minimal`，其生效档位会写入结果、任务快照与 `hubEvents`（即使调用方未显式传 `reasoning`）；未解析到档位时省略字段。契约文本已同步。
10. **边界门禁识别面扩大**：`findToolDefinitionInvokes` 现在覆盖动态工具名、跨行赋值、`?.` 可选调用、解构 `{ execute }`、旧 `ctx.get('tools')` 席位与多参数 `executable()`；同时把接收者收紧为精确的 `tools`/`toolsService`/`toolRegistry`/`toolsRegistry`/`ctx.tools`/`this.tools`，不再误伤 `myTools` 之类无关对象。
11. **工具描述回到上下文预算内**：`analytics_query_metrics` 与 `analytics_get_summary` 的描述与参数文案压缩到 995 字符，恢复预算基线，同时保留「原样透出、不归一化、不编造」的语义。

## 不在本次范围

- 当次 PR 不迁移 `omnimux-inspiration/src/index.js` 与 `rival/rival-remote.js` 中经本地 `getTool` 包装的间接直调（已由 [#275](https://github.com/omnimux-ai/omnimux-client/issues/275) 完成迁移）。
- 不改网关 `/api/social/v1/analytics/posts` 的参数契约。

## 验证

- `node --test plugins/plugins/omnimux-analytics/src/*.test.js`（57 项）
- `node --test plugins/plugins/omnimux-publish/src/*.test.js`（190 项）
- `node --test plugins/plugins/omnimux/src/text/*.test.js plugins/plugins/omnimux/src/headless/*.test.js`（185 项）
- `node --test --test-name-pattern="verify-plugin-boundaries" plugins/scripts/verify-ci-gates.test.mjs`
- `node plugins/scripts/verify-plugin-boundaries.mjs`
- `node plugins/scripts/test-agent-tools.mjs --budget`（`omnimux-analytics` 995/995 通过；`omnimux-clip` 与缺构建产物的插件为本机存量问题）

## 旧标准变更

- `plugins/plugins/omnimux-analytics/src/tools.test.js` :: `omnimux-analytics tools read the hub seam and never fabricate data`
  - 原断言：`queries.daily` 与 `queries.posts` 共用一个 `query`，且只校验日期形状与两次调用。
  - 变更理由：两个上游端点的参数契约不同，共用 query 会把日期/账号参数发给不支持的 posts 端点并让「按窗口」表述失真；预算内还需要新增 `warnings` 契约。
  - 新期望证据：`queries.daily` 只含 `fromDate`/`toDate`/`platform`，`queries.posts` 只含 `limit`/`platform`；`30d` 的起止相差 29 天；`warnings` 明确 posts 不受时间窗/账号过滤。
- `plugins/plugins/omnimux-analytics/src/tools.test.js` :: `omnimux-analytics fails loudly when both sources fail, the seam is missing, or the account filter is unusable`
  - 原断言：仅拒绝 `acc_1` 这类非数字 ID。
  - 变更理由：网关会把 `0`、负数与超范围数字静默丢弃，从而放宽为全账号查询。
  - 新期望证据：`acc_1`、`0`、`12,0`、`-3`、`99999999999999999999` 全部抛 `analytics-invalid-account-id`，且不产生任何上游调用。
- `plugins/plugins/omnimux/src/text/reasoning-policy.test.js` :: `uses the least advertised level when the provider declares none`
  - 原断言：未声明 `reasoningEfforts` 时仍取适配器公布的最小档（`off`）并上报。
  - 变更理由：pi-ai 会为手写 profile 合成 `off`/`minimal`，取它等于向下游承诺未声明的档位；契约要求交集为空即保持路由默认。
  - 新期望证据：同一场景不再下发 `reasoningEffort`，结果字段为 `null`（新用例名 `sends nothing when the provider declares no level`）。
