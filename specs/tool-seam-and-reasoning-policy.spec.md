# 工具直调收口、分析数据去假化与后台推理档位

## 背景

三处同根或相邻的工程债在本次一并收口。

1. **域插件绕过工具管线直调工具定义。** `omnimux-accounts`（`src/index.js:67`）、`omnimux-analytics`（`src/index.js:175` 与 `:184`）与 `omnimux-products`（`src/http-routes.js:259` 与 `:272`）都是先用 `ctx.tools.get(name)` 取到工具定义，再直接调它的 `execute(...)`。这条路径不经过 `pre-execute` 策略、`tools.guard()`、审批、`post-execute` 与 `tools/result` 审计事件，也不接收调用方 `AbortSignal`；它同时绕开了 agent 的 `tools.restrict({ deny })`，构成潜在的混淆代理越权。
2. **分析工具伪造成功态。** `analytics_query_metrics` 用空 `catch` 吞掉上游失败，再回落到 `engagementRate: 0.045`、`totalReach: 128500`、`totalFollowers: 54200`、`followerGrowth: 1850`、`postsCount: 24`；`analytics_get_summary` 整段 `headline` / `keyFindings` / `recommendations` 写死并带 `ok: true`，其中含「高于行业基准线 3.2%」这类不可证结论。网关 `GET /api/social/v1/analytics/daily-metrics` 只是把 Zernio 原始 JSON 原样透出（`controller/social.go` + `service/social/service.go` 的 `unmarshalJSONResponse`），不存在 `engagementRate` 这类归一化字段，因此上述数值在任何真实账号下都必然是编造的。
3. **后台机械环节继承最高推理档。** Hub 文本执行已经支持 `reasoningEffort`，但没有任何调用方传入；桌面默认路由是 `reasoning: max`，DeepSeek 适配器默认 `high`。推理 token 计入 `maxTokens`，而翻译（`4096` / `2048`）、结构切分（`1800`）、Schema 修复（沿用首轮 `4096`）都是小额度机械任务，思考前缀会挤掉正文，触发「模型只返回了思考过程」守卫。

## 事实与证据

- `hubtools.js` 的探测仍是 `tools.get(name)`。DSH 0.2.2-rc.5 的 `ToolsService` 公开 `executable(name, scope, toolSet)`（排除不满足 `when` 的注册），`selectExecutor()` 是 TypeScript `private`，不得调用；冻结旧壳 0.2.1-rc.3 只有 `get` + `executionMode`，因此必须双版本兼容。
- `dsh-tools` 对 `additionalProperties: false` 的工具参数会拒绝未声明字段，所以 `omnimux_text_complete` 必须显式声明 `reasoning`，否则 `omnimux-inspiration` 的旧结构切分路径会在参数校验阶段失败。
- `headless/execute.js` 的修复轮是**纯文本**请求（不重传媒体），若把首轮也降档会让模型在缺少素材的情况下补齐字段；因此只降修复轮，且首轮档位由调用方显式决定。
- DSH 官方轻量调用先例（`dsh-session-title-llm`）就是 `ctx.llm.prepareCall(config, signal, (controls, model) => ({ ...controls, reasoningEffort: model.reasoning?.efforts[0]?.id }))`；`prepareCall` 返回的 `config` 会被 `stream` 重新校验，派发时必须原样展开。
- `llm-pi-ai` 的 `modelInfo.reasoning.efforts` 会为手写 profile 补齐 `off` / `minimal` 等未声明档位，所以「适配器公布」不等于「上游接受」：必须与 `llm-pi-ai` 里显式声明的 `reasoningEfforts` 取交集，未声明的档位不下发。

## 范围

### 工具直调收口（P0）

- `plugins/plugins/omnimux/src/official/mount.js`：新增 `omnimuxAccounts`（`list`）与 `omnimuxAnalytics`（`dailyMetrics` / `posts`）两处只读接缝，复用既有 `listAccounts` / `getDailyMetrics` / `getPostAnalytics`。
- `plugins/plugins/omnimux/src/reader/mount.js`：新增 `pageFetch` 接缝，与 `omnimux_page_fetch` 共用同一个 `fetchPage` 调用与能力门控。
- `plugins/plugins/omnimux-accounts/src/index.js`：改消费 `omnimuxAccounts`，缺失时报 `needs-hub: install the OmniMux execution hub`。
- `plugins/plugins/omnimux-analytics/src/index.js`：改消费 `omnimuxAnalytics`；删除全部硬编码指标与写死报告；单源失败返回 `ok:false, partial:true` 与逐源 `errors`，双源失败抛 `analytics-source-failed`，接缝缺失抛 `needs-hub`，非数字 `accountId` 抛 `analytics-invalid-account-id`（上游会静默丢弃该过滤条件，不能假装成功）。
- `plugins/plugins/omnimux-products/src/http-routes.js`：`pageFetch` / `socialData` 改消费 `pageFetch` 与 `socialData` 接缝，删除不再使用的 `toolRegistry`。
- `plugins/plugins/omnimux-publish/src/hubtools.js`：探测改为 `tools.executable` 优先、`tools.get` 回退；执行仍是 `ctx.tools.execute` 批次契约。
- `plugins/scripts/verify-plugin-boundaries.mjs`：新增第 5 条门禁，禁止非 Hub 插件对 `ctx.tools.get` / `ctx.tools.executable` 取得的定义直接调 `execute`；`plugins/scripts/verify-ci-gates.test.mjs` 补命中、放行与 Hub 豁免三组断言。

### 推理档位（P1）

- `plugins/plugins/omnimux/src/text/execute.js`：新增 `reasoning: 'inherit' | 'minimal'`（缺省 `inherit`，非法值抛 `omnimux-invalid-request`）；`resolveDeclaredReasoning` 只读 `llm-pi-ai` 声明的 `reasoningEfforts`；stream 轨改用 `llm.prepareCall` + `selectAdapterEffort`（声明档位优先，无声明时取最小公布档位，交集为空则不下发）；chat 轨把声明的线值写入 `reasoning_effort`；仅在显式请求时于结果带 `reasoningEffort`。
- `plugins/plugins/omnimux/src/text/chat.js`：接受并透传 `reasoningEffort`。
- `plugins/plugins/omnimux/src/text/mount.js`：工具参数声明 `reasoning` 枚举并透传。
- `plugins/plugins/omnimux/src/headless/execute.js`：透传调用方 `reasoning`；修复轮固定 `minimal`；`reasoningEffort` 写入结果。
- `plugins/plugins/omnimux/src/headless/queue.js`：任务快照与 `omnimux:headless-skill` 事件带出 `reasoningEffort`。
- `plugins/plugins/omnimux-inspiration/src/scoped-analysis.js`（正文翻译、脚本翻译）与 `src/structure-script.js`（旧结构切分）：显式 `reasoning: 'minimal'`。
- `plugins/docs/contracts/headless-skill-execution.md`、`plugins/docs/contracts/plugin-agent-tools-inventory.md` 与相关 `dsh.manifest.json`：同步请求/结果/事件字段、接缝清单与分析工具行为描述。

## 假设

- 官方能力正常挂载时 `pageFetch`、`omnimuxAccounts`、`omnimuxAnalytics` 三处接缝可用；能力未挂载或被 gate 关闭时不提供空实现，消费方报明确错误。
- 上游分析载荷字段由 Zernio 决定，本仓不做字段归一化，因此不承诺 `engagementRate` 等派生指标；工具只透出原始载荷与数据源可用性。
- `minimal` 只服务后台一次性调用，不改变前台会话的模型选择与推理档位。

## 不做

- 当次 PR 不迁移 `omnimux-inspiration`（`getTool` 包装的 `socialData` / `video_analyze` / `text_complete`）与 `rival/rival-remote.js` 的间接直调：本地 `getTool` 包装不在静态规则可达范围（已由 [#275](https://github.com/omnimux-ai/omnimux-client/issues/275) 完成迁移）。
- 不改网关 `omnimux_analytics_daily_metrics` / `omnimux_analytics_posts` 工具参数名（`accountIds` / `profileId` 与网关 `account_ids` 的既有不一致），接缝直接使用网关契约的参数名。
- 不给 `chat.js` 复刻 pi-ai 全量协议方言，只消费已声明的 `reasoningEfforts` 映射。

## 验证

- `node --test plugins/plugins/omnimux-accounts/src/*.test.js`
- `node --test plugins/plugins/omnimux-analytics/src/*.test.js`
- `node --test plugins/plugins/omnimux-products/src/*.test.js`
- `node --test plugins/plugins/omnimux-publish/src/*.test.js`
- `node --test plugins/plugins/omnimux/src/text/*.test.js plugins/plugins/omnimux/src/headless/*.test.js`
- `node --test plugins/plugins/omnimux-inspiration/src/*.test.js`
- `node plugins/scripts/verify-plugin-boundaries.mjs`
- `node --test plugins/scripts/verify-ci-gates.test.mjs`
- `node plugins/scripts/verify-test-standard-declarations.mjs . origin/main`
- `node plugins/scripts/verify-plugin-agent-tools.mjs --base origin/main --head HEAD`
- `node plugins/scripts/doc-lint.mjs --base origin/main --head HEAD`

实网复核：在 `omnimux:gemini-3.8-flash` 下对比 `inherit` 与 `minimal` 的翻译耗时与输出，确认 `reasoning_effort` 实际下发且网关返回 200。

## 旧标准变更

- `plugins/plugins/omnimux/src/host/apply.test.js` :: `registers all 55 tools and 22 seams by default`
  - 原断言：默认挂载时 `ctx.provide` 恰好提供 22 个接缝，顺序以 `identity` 开头、`mediaResolver` 结尾。
  - 变更理由：新增 `pageFetch`、`omnimuxAccounts`、`omnimuxAnalytics` 三处只读接缝，接缝总数与顺序随之上移；旧名字里的数字已不成立，故改成不含计数的名字，避免下次增删再接缝时再次改名。
  - 新期望证据：同一用例按新顺序断言 25 个接缝，`pageFetch` / `omnimuxAccounts` / `omnimuxAnalytics` 位于 `x` 与 `decisions` 之间；`gate.enabled: false` 与 `official.mount: false` 两条用例的接缝清单保持原样，证明新接缝仍受能力门控。
- `plugins/plugins/omnimux/src/host/apply.test.js` :: `fine-grained disables media, text models, and official tools via gate`
  - 原断言：在细粒度 gate 下，`ctx.provide` 的接缝清单以 `mediaResolver` 结尾，且不含新增接缝。
  - 变更理由：新增的三处只读接缝在细粒度门控下同样存在（`omnimux_social_data` 关闭不影响账号与分析接缝），清单必须随之更新，否则用例会锁死旧接缝面。
  - 新期望证据：同一用例断言 25 个接缝且包含 `pageFetch` / `omnimuxAccounts` / `omnimuxAnalytics`；同时新增用例证明 `pageFetch` 在 `omnimux_page_fetch` 关闭时完全不提供、`socialData.fetch` 逐次调用仍抛 `capability-disabled`、`omnimuxAnalytics` 只发布已启用的能力。
- `plugins/plugins/omnimux-analytics/src/tools.test.js` :: `omnimux-analytics tools registration and execution`
  - 原断言：`analytics_query_metrics` 返回 `metrics.engagementRate === 0.052`、`totalReach === 250000`、`postsCount === 42`，`analytics_get_summary` 返回写死的 `summary.keyFindings` 与 `bestPost.title`；两个 hub 工具由 `ctx.tools.get(name).execute(...)` 的 mock 提供。
  - 变更理由：这些数值来自实现内的硬编码兜底与空 `catch`，上游网关并不返回 `engagementRate` 一类归一化字段，该用例实际锁定的是伪造成功态；同时直调工具定义绕过工具管线。
  - 新期望证据：`analytics_query_metrics` 原样透出 `data.daily` / `data.posts`，单源失败给出 `ok:false, partial:true` 与逐源 `errors`，双源失败抛 `analytics-source-failed`，接缝缺失抛 `needs-hub`，非数字 `accountId` 抛 `analytics-invalid-account-id`；`analytics_get_summary` 不再返回 `summary` 字段，并断言响应中不含「行业基准」。
