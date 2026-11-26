# 规格：订阅账号原生 OAuth（路线 1）+ 本地 CLI 凭据复用（路线 2）融合

## 背景与问题

用户在首次引导（`NativeRuntimeSetup`）或设置页（`RuntimeModeSection`）选择 Codex CLI 登录后，旧链路仅在 `omnimux` 设置中写入 `runtimeAgentId` 与 `scenarioBindings.text = { channel: 'agent' }`，从未将订阅凭据或路由写入 DSH 的 `ctx.credentials` 与 `settings('llm-pi-ai')`，导致主对话输入栏仍显示「暂无可用模型」。同类根因也存在于首次引导的 BYOK 文本配置（`TextKeyPanel` → `PUT /omnimux/byok/config`）。

## 架构方案

直接编排 DSH `0.2.2-rc.5` 内置挂载的 `ctx.authorization`、`ctx.credentials`、`settings('llm-pi-ai')`、`ctx.llm` 与 `ctx.agentDefaultModel`，零新增第三方依赖、不修改 `app/deepseek-harness/`：

1. **路线 2（受控单向拉取本地 CLI 凭据）**：只读白名单校验本地官方 CLI 凭据文件（Codex `$CODEX_HOME/auth.json` / `~/.codex/auth.json`、Kimi `~/.kimi-code/credentials/*.json`、Claude `~/.claude/.credentials.json`），将合法 OAuth grant 写入 `ctx.credentials.modifyRecord('llm-pi-ai/<providerId>', ...)`，永不回写用户 CLI 文件，绝不静默调用 macOS Keychain。
2. **路线 1（应用内原生 OAuth）**：通过 Host 状态机桥接 `ctx.authorization.begin({ key: 'llm-pi-ai/<providerId>', method: 'oauth' })`，支持浏览器 PKCE（含回调 URL 粘贴兜底）与设备码 / 复制授权码模式；无需本机安装 CLI 即可登录。
3. **动态路由激活与对账**：凭据落盘确认后原子写入 `settings('llm-pi-ai').providers[routeId]`（Codex 默认 `transport: 'sse'` 规避 15 秒 WebSocket 超时），通过 `agentDefaultModel.saveSelection` 自动绑定可用默认模型；断开连接或外部删除凭据时清理无 `apiKeyEnv` 的订阅路由，防止僵尸模型残留。
4. **同根因兄弟路径修复**：
   - BYOK 文本配置同步至 `settings('llm-pi-ai').providers['byok-' + provider]`，避免与 `anthropic` / `openai` 路由冲突。
   - `agents/auth.js` 复用 `resolveBinPath` + `extraBinDirs`，修复 GUI 进程 `PATH` 缺失误判 `unknown`。
   - `catalog/session-models.js` 合并 `ctx.llm` 实时目录路由。
   - `text/execute.js` 在订阅路由活跃时优先走 `ctx.llm.stream`，不强制依赖本机 CLI 二进制。

## 验收标准

- 本机已登录 Codex CLI（含文件凭据）时，点击接入后无需重开浏览器，输入栏立即出现 Codex 模型列表。
- 未安装本地 CLI 或 CLI 凭据位于钥匙串时，可发起原生 OAuth（浏览器 / 设备码），授权后输入栏立即可用。
- 断开连接后凭据与无 `apiKeyEnv` 订阅路由同步清理，输入栏不再展示失效模型。
- BYOK `TextKeyPanel` 保存文本配置后输入栏立即出现对应 `byok-*` 模型。
- 全量新增单测与回归测试双向证伪通过，插件门禁（`build:all`、`omnimux test`、`check:boundaries`、`verify:dsw-tokens`、`lint:i18n`、`verify:silent-catch`）全绿。

## 旧标准变更

- `plugins/plugins/omnimux/src/auth/http-routes.test.js` :: `apply mounts auth routes when webServer arrives through inject`
  - 原断言要求注册的 HTTP 路径集合只包含原有路由；本次新增 Route 1 + Route 2 订阅认证 6 个端点（`/omnimux/agents/import-auth`、`/omnimux/agents/oauth/start`、`/omnimux/agents/oauth/status`、`/omnimux/agents/oauth/submit`、`/omnimux/agents/oauth/cancel`、`/omnimux/agents/disconnect`），故将精确集合断言同步更新为包含全部新增端点，既有路由断言未删减。
- `plugins/plugins/omnimux/src/catalog/session-models.test.js` :: `falls back to the base layer when the user layer is absent`
  - 原断言校验展示标签使用中点分隔符（`Provider · Model`）；按 UI 文案规范移除中点分隔符改为括号格式（`Model (Provider)`），新期望同步校验 `id` 与新标签格式 `Gemini 4 (OmniMux)`。
- `plugins/plugins/omnimux/src/catalog/session-models.test.js` :: `flattens every provider model list into provider:modelId entries`
  - 原断言校验标签格式 `Provider · Model`；按 UI 文案规范改为 `Model (Provider)`，保持全部 `provider:modelId` 扁平化映射断言不变并同步更新标签期望。
- `plugins/plugins/omnimux/src/catalog/session-models.test.js` :: `keeps base models when the user entry only overlays other fields`
  - 原断言校验标签格式 `Provider · Model`；按 UI 文案规范改为 `Model (Provider)`，保留用户层覆盖合并语义断言并同步更新标签期望。
