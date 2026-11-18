# Spec: #77 运行方式原生单页（插件侧）

- 任务：`issue-77-native-runtime`
- 日期：2026-11-17
- 基线：`origin/main`（`27699f2`）
- 风险：R2（首启运行方式；只改 `plugins/plugins/omnimux`，app patch / host 由桌面端同步）

## 目标

1. 首启不再挂载任何官方 onboarding 页面（welcome / credit / purpose / process），只显示一页原生 `OnboardingSurface` 的「运行方式」。
2. 新增 `NativeRuntimeSetup`，注册 `onboarding.desktop.runtime`（id `omnimux-native-runtime`），使用 host 的 `renderSurface`，不新增 `createPortal`。
3. 三种路径：官方登录（未登录/已登录）、本地 Agent（扫描/选择/测试/空态）、自带 Key（表单/校验/保存）；失败/取消停留本页可重试；成功后写对应配置与 `runtimeMode`，页面返回 null 直接进入工作区。
4. 老用户 `hasAnyChannelChoice(settings)` 为真时直接返回 null；`暂时跳过` 只本地 dismiss，不写 `runtimeMode`，下次启动再出现。
5. 删除旧 `RuntimeGuideGate.jsx` 与 `shell.overlay` 注册；`RuntimeModeSection` 设置页保留。复用 `AgentPanel` / `TextKeyPanel`，不复制错误/校验映射。
6. 不新增解释性文案；禁用只灰态，无 tooltip/说明句/badge；全部复用既有 `runtime.*` locale key。

## 非目标

- 不改官方 DSH submodule、网关、登录 device-flow、模型目录契约。
- 不改 `dsh-plugin-desktop` Desktop setup wizard（由桌面端同步 app patch / host）。
- 不新增 onboarding progress schema，不写 `runtimeChoice`。

## 验收（AC）

- [ ] AC-1：全新实例首启只挂载 `[data-desktop-onboarding-surface]`，无 `[data-omnimux-runtime-guide]`；无 `data-desktop-onboarding="welcome|credit|purpose|process"`。
- [ ] AC-2：页面只有运行方式三卡 + 选中详情；无步骤进度、无上一步/下一步。
- [ ] AC-3：官方未登录 `登录 OmniMux`、已登录 `继续（已登录）`；成功写 `runtimeMode='official'` 并卸载本页。
- [ ] AC-4：Agent 已安装/未安装/空态；测试中禁用无持续旋转；成功写 `runtimeAgentId` + `runtimeMode='agent'`。
- [ ] AC-5：Key 表单校验/保存；成功写 `runtimeMode='key'`；API Key 只存在组件内存，不写 progress/日志/error。
- [ ] AC-6：任一路径失败/取消停留本页可重试，无第二层、无空白。
- [ ] AC-7：老用户任一渠道已配置 → 不显示本页；全新/清空 settings → 显示。
- [ ] AC-8：`暂时跳过` 不写 `runtimeMode`，本次进入工作区，下次启动重现。
- [ ] AC-9：首启期间无 topbar toggle / new-session 多余按钮（沿用 #75 topbar 修复）。
- [ ] AC-10：无新增用户可见解释性文案；视觉使用原生 `OnboardingSurface` / `dsh-ui-kit` 语义 token。
- [ ] AC-11：1280×840 与 1024×720 截图 + DOM rect；窄屏无溢出。
- [ ] AC-12：双向证伪——恢复旧 `RuntimeGuideGate` 全屏 → AC-1 红；恢复官方 onboarding 渲染 → AC-1 红；回退已配置跳过 → AC-7 红；回退 `runtimeMode` 写入 → AC-3/4/5 红。
- [ ] AC-13：回归 #47 会话标题、多模态输入、工作区布局、设置页运行方式编辑、Desktop setup wizard。

## 测试计划

- `NativeRuntimeSetup.test.js`：slot 注册、老用户判定、官方登录文案/`ensureLogin`、Agent/TextKeyPanel 复用、skip 不写 `runtimeMode`、保存成功返回 null。
- `NativeRuntimeSetup.behavior.test.mjs`：真实 jsdom + React 渲染，覆盖老用户跳过、官方未登录/已登录、Agent 扫描/选择/测试/空态、Key 校验/保存、失败停留、skip 不写 `runtimeMode`、保存成功返回 null。
- `runtime-guide-view.test.js`：`hasAnyChannelChoice` / `describeRuntimeGuide`。
- `settings-placement.test.js`：旧 shell.overlay 注册不存在，新 child slot 注册存在。
- `text-key-panel.test.js`：key 面板仍只配置 text，且由 NativeRuntimeSetup 挂载。
- `corepack pnpm --filter omnimux test`、`corepack pnpm --dir plugins run build:all`、`build:client`、相关浏览器/DOM 验收。

## 旧标准变更

- `plugins/plugins/omnimux/src/client/runtime-guide-login-state.test.js` :: `first-run guide login state`
- `plugins/plugins/omnimux/src/client/runtime-guide-login-state.test.js` :: `reads the auth gate and continues without re-opening login`
- `plugins/plugins/omnimux/src/client/runtime-guide-login-state.test.js` :: `ships the signed-in continue label in both languages`
  - 原断言：读取已删除的 `RuntimeGuideGate.jsx`，校验旧登录态路径。
  - 必须改的理由：#77 删除 `RuntimeGuideGate`，改由原生 `NativeRuntimeSetup` 承担登录态。
  - 新期望证据：`NativeRuntimeSetup.test.js` 的「provides official signed-out and signed-in actions through the auth gate」覆盖同一标签与 `ensureLogin` 路径。
- `plugins/plugins/omnimux/src/client/runtime-guide-skip.test.js` :: `first-run skip button`
- `plugins/plugins/omnimux/src/client/runtime-guide-skip.test.js` :: `hides the guide as soon as the official write is confirmed`
- `plugins/plugins/omnimux/src/client/runtime-guide-skip.test.js` :: `makes the whole skip row clickable`
  - 原断言：旧 `RuntimeGuideGate` 的 skip 按钮源码与样式。
  - 必须改的理由：#77 删除旧全屏 guide，skip 改为 `NativeRuntimeSetup` 的本地 dismissed。
  - 新期望证据：`NativeRuntimeSetup.test.js` 的「skip is local only and never writes runtimeMode」。
- `plugins/plugins/omnimux/src/client/settings-placement.test.js` :: `mounts the first-run runtime guide on the session overlay`
  - 原断言：`index.js` 注册 `omnimux-runtime-guide` 到 `shell.overlay`。
  - 必须改的理由：#77 改为注册 `onboarding.desktop.runtime`，旧 `shell.overlay` 注册必须消失。
  - 新期望证据：同文件新用例「registers the native runtime setup on the onboarding child slot」，断言新 slot/id 且不再有旧 guide。
- `plugins/plugins/omnimux/tests/e2e/runtime-guide-choice.e2e.test.mjs` :: `已有选择的安装永远不再出现`
- `plugins/plugins/omnimux/tests/e2e/runtime-guide-choice.e2e.test.mjs` :: `未选过运行方式时出现三选一`
- `plugins/plugins/omnimux/tests/e2e/runtime-guide-choice.e2e.test.mjs` :: `选「自己的密钥」出表单，测试通过后写入运行方式并关闭`
- `plugins/plugins/omnimux/tests/e2e/runtime-guide-choice.e2e.test.mjs` :: `首次运行引导（Issue #2557）`
  - 原断言：旧 `RuntimeGuideGate` 的渲染与 key 流程。
  - 必须改的理由：组件已删除；旧 e2e 的 DOM/交互契约不再适用。
  - 新期望证据：`NativeRuntimeSetup.test.js` 覆盖 slot、老用户跳过、官方/Agent/Key 复用与 skip；真实 Dev 验收由独立实例执行。
