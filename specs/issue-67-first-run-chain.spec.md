# Spec: #67 首启引导期顶栏按钮修复（topbar-only）

- 任务：`issue-67-first-run-chain`
- 日期：2026-11-17
- 基线：`origin/main`（`27699f2`）
- 风险：R2（桌面首启引导期顶栏；只改 omnimux client 片段，不改官方 DSH 子模块）

## 目标

1. `plugins/plugins/omnimux/src/client/sidebar-toggle-topbar.js`：`findTopbarAnchor()` 删除 `doc.body || doc.documentElement` fallback；无 workbench tabBar 返回 null 不注入。
2. 引导态（存在 `[data-omnimux-runtime-guide]` / `[data-desktop-onboarding-surface]` / `#root[inert]`）移除注入的 toggle 与 new-session，引导结束后恢复。
3. 不新增解释性文案；`aria-label` 等可访问名称保留。

## 非目标

- 不改 `app/patches/dsh-client-ui-settings-account@0.2.1-rc.3.patch`、`app/yarn.lock`、`bundle.lock.json`、`RuntimeGuideGate.jsx`、`runtime-guide-skip.test.js`。
- 不处理原生 onboarding 用途步、两套引导叠加；由 #77（运行方式单页）承接。
- 不改欢迎文案、额度显示条件、`dsh-desktop-next` Next 壳、官方 DSH 子模块。

## 验收（AC）

- [ ] AC-1：首启任意引导层下无 `button[data-omnimux-sidebar-toggle-topbar]` / `button[data-omnimux-topbar-new-session]`；引导结束后恢复。
- [ ] AC-2：`findTopbarAnchor()` 无 workbench tabBar 时返回 null，绝不注入 body。
- [ ] AC-3：回归 #47 会话标题、多模态输入、工作区布局不受影响。
- [ ] AC-4：真实 Dev 首启验收：独立 userData / appId，1280×840@2x 截图 + DOM rect/状态/pid/port/window bounds；不重启用户实例、不创建付费任务、不碰 Prod。

## 测试

- `sidebar-toggle-topbar.test.js`：新增无 tabBar fallback、引导态隐藏/恢复、upstream surface + inert root 用例。
- 触及 plugins 后按仓规跑 `corepack pnpm --dir plugins run build:all` 及相关门禁。

## 旧标准变更

（本次只新增测试与新增断言，未放宽或删除既有断言 —— 无。）
