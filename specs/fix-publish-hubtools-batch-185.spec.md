# 规格：修复 omnimux-publish hubtools 与 DSH 0.2.2-rc.5 ToolsService.execute 批次契约不兼容（Issue #185）

## 1. 背景与根因

1. **P0 运行期阻断缺陷**：主壳 `dsh-desktop-next` 升级至 DSH `0.2.2-rc.5` 后，`ToolsService.execute` 契约由旧单调用 `execute(ToolExecutionInput): Promise<ToolExecutionResult>` 升级为批次调用 `execute(ToolBatchInput): Promise<ToolBatchResult>`：
   - 入参：`{ calls: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(args ?? {}) }], signal, ...(agent !== undefined ? { agent } : {}) }`
   - 出参：`{ results: [{ callId, result: ToolExecutionResult }], additionalContexts, concluded }`
   - `plugins/plugins/omnimux-publish/src/hubtools.js` 仍按旧单调用格式传参，导致 `executeToolBatch` 因 `input.calls` 为 `undefined` 直接抛 `ToolBatchExecutionError`（实机触发 `POST /omnimux/publish/drafts` 必现 HTTP `502`：`tool omnimux_accounts_list threw: Tool batch execution failed`）。
   - 既有单测（`hubtools.test.js` / `submit.test.js` / `index.test.js` / `http-routes.test.js` / `r1-r2.test.js`）均手写旧单调用假桩，导致假阳性漏检。
2. **暗色主题头像对比度缺陷**：`plugins/plugins/omnimux-publish/src/client/styles.js` 中 `.omnimux-publish-preview-avatar` 与 `.omnimux-publish-accounts-avatar` 使用了宿主不存在的 `--dsw-alias-label-inverse`（恒回退 `#ffffff`），且在暗色模式下 `--dsw-alias-brand-primary` 解析为浅底（`--dsw-static-neutral-bluish-50` / `oklch(0.922 0 0)`），造成浅底白字不可读。

## 2. 改造方案

1. **批次契约主通道 + 旧壳精准兼容**：
   - `plugins/plugins/omnimux-publish/src/hubtools.js` 保留完整 `ctx.tools.execute(...)` 策略/审批管线（透传 `agent` 与 `signal`），绝不绕过直调 `tool.execute(...)`。
   - 默认按 DSH `0.2.2-rc.5` 批次契约发包并从 `batch.results` 按 `callId`（或唯一条目）解出 `ToolExecutionResult`；对畸形/空批次结果显式抛 `PublishError('hub-tool-error', ...)`。
   - 仅当精准检测到冻结旧壳 `0.2.1-rc.3` 特征（`typeof tools.executionMode === 'function' && typeof tools.setExecutor !== 'function'`）时回退单调用格式。
   - 管线取消结果（`ABORTED` / `ABORTED_BEFORE_DISPATCH`）归一为标准 `AbortError`，与 `submit.js` 及 `putBytes` 一致；`UNKNOWN_TOOL` 按合并文本与结构化错误码双路映射 `needs-hub`。
2. **真实 `@deepseek-ai/dsh-tools` (`0.2.2-rc.5`) 集成回归**：
   - 新增 `plugins/plugins/omnimux-publish/src/hubtools-runtime.test.js`，装配真实 `Context`（`@deepseek-ai/cordis`）+ `ToolRuntime`（`ToolsService`）+ `ToolExecutionPipeline` + `executeToolBatch`，覆盖 5 个 hub 工具、`POST /omnimux/publish/drafts` 与 `GET /omnimux/publish/creator-info` 端到端 HTTP 路由、6 类错误透传、`signal` 取消、`tools.guard()` 策略拦截与 `agent` 透传。
   - 同步将既有 5 个单测文件的 `mockTools` 升级为严格校验 DSH `0.2.2-rc.5` 批次契约，另保留显式 `0.2.1-rc.3` 兼容单测。
3. **暗色/亮色双主题头像对比度修复**：
   - `.omnimux-publish-preview-avatar` 与 `.omnimux-publish-accounts-avatar` 统一使用官方语义配对 Token：`background: var(--dsw-alias-brand-primary)` + `color: var(--dsw-alias-label-primary-foreground)`（在 DSH 亮/暗主题中均提供 >14:1 WCAG AAA 对比度），移除未定义 Token `--dsw-alias-label-inverse` / `--dsw-alias-platform-tiktok` 与裸色回退。

## 旧标准变更

- `plugins/plugins/omnimux-publish/src/hubtools.test.js` :: `maps structured quota-exceeded tool errors without any UI global`
  - 原断言：内联假桩 `tools.execute()` 返回旧 DSH `0.2.1-rc.3` 单调用裸对象 `{ content, isError, error }`，断言 `channel.getPost('p1')` 映射为 `PublishError('quota-exceeded')`。
  - 变更理由：DSH `0.2.2-rc.5` 中 `ToolsService.execute` 契约已升级为批次返回 `{ results: [{ callId, result }], additionalContexts, concluded }`，极简 mock 默认走批次契约，旧单调用裸对象已属非法返回。
  - 新期望证据：保持全部业务断言不变，将内联假桩返回值升级为合法 `ToolBatchResult` 包裹结构，并新增独立测试验证畸形非批次返回显式抛 `hub-tool-error`、以及真实 `ToolRuntime` 管线下 `quota-exceeded` 透传。
