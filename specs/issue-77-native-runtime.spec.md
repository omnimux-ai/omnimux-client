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
- `runtime-guide-view.test.js`：`hasAnyChannelChoice` / `describeRuntimeGuide`。
- `settings-placement.test.js`：旧 shell.overlay 注册不存在，新 child slot 注册存在。
- `text-key-panel.test.js`：key 面板仍只配置 text，且由 NativeRuntimeSetup 挂载。
- `corepack pnpm --filter omnimux test`、`corepack pnpm --dir plugins run build:all`、`build:client`、相关浏览器/DOM 验收。

## 旧标准变更

（本次新增测试与替换旧 guide 测试；未放宽既有断言 —— 无。）
