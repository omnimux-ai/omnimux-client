# 未连接浏览器扩展时隐藏幽灵工具与诱导性提示（Issue #200）

## 假设

- DSH Host 的 `ctx.tools.register()` 返回精确的 disposer，并在注册/释放时触发 `tools/change`，因此工具表可在运行时按连接态增删，不需要重启或重载插件。
- 支持代际 `@deepseek-ai/dsh-system-prompt` 的 `PromptSection.text` 接受 `(context) => string` 提供器，并在每次 assembly 时求值；0.2.1-rc.3 与 0.2.2-rc.5 的公开类型均如此。
- `BridgeServer` 是单连接桥：`promote()` 建立唯一活动连接，`replaceConnection()` 在断开/替换时清空 `current`；连接态变化可从这两个入口同步广播。
- 未连接扩展时，任何 `browser_*` 工具调用都只会得到 `bridge-closed`，因此不注册工具、不注入提示不会损失已连接态能力。

## 方案

采用方案 A：`BridgeServer` 新增 `onConnectionChange(listener)` 订阅；`createBrowserToolRegistrar()` 在连接态注册全部 15 个 `browser_*` 工具，在断开态释放并清空；`tool:bridge-browser` 系统提示的 `text` 改为按 `server.hasConnection()` 求值的提供器，未连接时返回空字符串。连接替换（新扩展替换旧扩展）不产生断开告警，避免工具短暂消失；重连后重新注册同一套工具。

## 证伪方式

- 将 `browserBridgePrompt()` 改为始终返回连接态文案：三态单测的「未连接提示必须为空」与 composition 的「未连接提示为空」必须真实失败。
- 将 `createBrowserToolRegistrar.sync(false)` 改为不释放工具：三态单测的「断开后 15 个工具全部释放」与 composition 的「断开后工具不可见」必须真实失败。
- 恢复上述修复后，`tests/tool-visibility.test.ts`、`tests/server.spec.ts`、`tests/composition.spec.ts` 与 `omnimux-browser` 全量测试必须全绿；连接后 `browser_snapshot` / `browser_click` / `browser_navigate` 可见，断开后不可见。

## 验收

- `corepack pnpm --dir plugins --filter omnimux-browser test` 通过。
- `corepack pnpm --dir plugins run verify:tools` 与 `test:agent-tools` 通过。
- `node scripts/bundle-lock.mjs --check`、`node scripts/workspace-check.mjs --check`、`verify-plugin-load.mjs`、`verify-fix-regression-test.mjs . origin/main`、`verify-test-standard-declarations.mjs . origin/main`、`gitleaks`、`git diff --check` 通过。
