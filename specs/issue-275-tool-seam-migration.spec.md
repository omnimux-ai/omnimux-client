# inspiration / rival 工具接缝迁移

## 背景

`omnimux-inspiration` 仍通过本地 `getTool()` / `resolveTool()` 包装读取 `ctx.tools` 注册表，再对工具定义直接调用 `execute()`。这条路径绕过 Host 的 pre-execute 策略、审批与结果审计，且静态门禁无法可靠识别间接包装；`verify-plugin-boundaries.mjs` 第 5 条规则因此保留了一条「已知局限」说明。

## 迁移清单

1. **`socialData` 改消费 Hub 接缝**：`createSocialFetcher({ resolveSocialData })` 在请求时取 `ctx.get('socialData')`，调用 `seam.fetch({ platform, capability, url }, { signal })`。接缝缺省时保持「云接缝 → public fallback resolver → 可诊断错误」的既有顺序，不静默成功。
2. **`textComplete` 改消费 Hub 接缝**：`textComplete.execute(args, exec)` 保留为插件内部适配层，实际调用 `ctx.get('textComplete').execute({ ...args, signal: exec.signal })`；Hub 接缝是单请求对象签名，signal 在请求内传递。接缝缺省时显式抛「omnimux_text_complete 未就绪」。
3. **`video_analyze` 走 `ctx.tools.execute` 批次派发**：`omnimux-video` 没有 `videoAnalyze` 接缝，按 `omnimux-publish/src/hubtools.js` 已验证的 0.2.2 批次契约新增本地 `src/hub-tools.js`：`{ calls: [{ type: 'tool-call', id, name, arguments }], signal }`，按 `callId` 解出 `ToolExecutionResult` 并返回 `value`；同时保留冻结 0.2.1 壳的单调用回退。模块不读取工具定义，也不跨插件 import `omnimux-publish` 的私有实现。
4. **`rival-remote` 改注入 `resolveSocialData`**：`createRivalRemote({ resolveSocialData })` 在 `createCycle()` 时解析 `socialData` 接缝；缺省或没有 `fetch` 时抛既有 `RivalRemoteError(CLOUD_ERROR, TOOL_MISSING_MESSAGE)`。`toolName` 与 `createCycle` / `LIMIT_CALLS_PER_ACCOUNT_CYCLE` 成本守卫语义不变。
5. **删除 `getTool` 包装**：`index.js` 不再读取工具定义；`verify-plugin-boundaries.mjs` 第 5 条规则删除已失效的「Known limitation」说明，规则本身不放宽、不新增 allowlist。

## 边界

- 主改动：`plugins/plugins/omnimux-inspiration/**`
- 次改动：`plugins/scripts/verify-plugin-boundaries.mjs`（仅删除失效说明）
- 不触碰 `plugins/packages/dsh-ui-kit/**`、`plugins/plugins/omnimux/**`、`plugins/plugins/omnimux-publish/**`、`plugins/plugins/omnimux-video/**`、`app/**`
- 无 UI 变更，浏览器视觉验收不适用

## 验证

- `pnpm --dir plugins --filter omnimux-inspiration test`：全量单测通过，0 fail / 0 skipped
- `node plugins/scripts/verify-plugin-boundaries.mjs`：全仓通过（#275 分支实测 5251 个源文件 = 基线 5249 + 本任务新增 `hub-tools.js`、`hub-tools.test.js`；该计数随主干新增源文件增长，不是恒定基线）
- `node plugins/scripts/verify-dsw-tokens.mjs`：18 包 / 450 上游 Token / 651 存量 / `dsh-ui-kit 0`
- `pnpm --dir plugins run test:gates`、`build:all`、`bundle-lock --check`、`workspace:check`、`plugins:verify`
- `git diff --check`、`gitleaks`

## 回归测试

- `hub-tools.test.js`：批次派发契约（单 call、按 `callId` 解包、signal 透传）、`textComplete` 单请求对象与 signal、`video_analyze` 批次缺省、`UNKNOWN_TOOL` 映射、0.2.1 单调用回退。
- `social-import.test.js`：`socialData` 接缝缺省时依次尝试 fallback 并抛出可诊断的「未就绪」错误。
- 既有 rival/cancellation/apply 用例全部迁移到接缝 mock，断言语义不变。
