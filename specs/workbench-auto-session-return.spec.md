# 规格：非会话页点击左侧工作台入口自动切回会话并打开目标面板

## 背景与目标

当用户停留在「插件」「设置」等非对话页面时，宿主卸载了中间对话区与右侧栏（`sidebarRight.mounted` 为 `undefined`，Next/rc.3+ 壳下 `sessions.list.current` 恒为 `undefined`）。此时点击左侧边栏的一级工作台入口（如「项目」「资产库」「灵感社区」「技能/专家」及「更多」菜单入口），`openWorkbench()` 会读取空会话并弹出「请先选择工作区并新建会话，再打开此面板」Toast 阻止打开，即便左侧工作区列表中已有多个工作区与历史会话。

本次修复在不改变 `currentSessionId()` 既有纯读契约（Issue #3800）的前提下：
1. 在 `omnimux` 客户端工作台宿主适配层绑定可选服务 `uiWorkspace`（及 `ctx.get('uiWorkspace')` 懒解析）与 `workspaces`，并在内存级记录最近一次非空的在屏会话 `lastMountedSessionId`。
2. 在 `openWorkbench()` 遇到当前会话为空时，按优先级解析目标会话：`lastMountedSessionId`（存活且未归档）→ `sessions.list.byId` 未归档会话按 `updatedAt` 降序首项 → 有工作区零会话时自动 `sessions.create({ workspaceId })` → 仅真正零工作区时弹 Toast「请先添加工作区，再打开此面板」并聚焦工作区添加入口。
3. 当目标会话未在屏时，自动调用 `uiWorkspace.openSession(targetSessionId)`（老壳回退 `sessions.open`），等待 `sidebarRight.mounted` 与 `betterSidebar` 快照对齐，并对 React 提交前可能出现的 `sidebarRight: no session surface is mounted` 瞬态错做受限短重试，随后打开目标 Tab 并按默认策略进入右侧全屏。
4. 用递增请求序号 `openRequestSeq` 结合分阶段预期会话校验修复 `openWorkbench()` 并发连点竞态，既不误杀主动发起的 `undefined → targetSessionId` 路由切回，又保留既有「外部切会话不误提交旧导航」与「连点只认最后一次」安全保证。

## 假设

1. **非会话页会话读空根因**：在「插件 / 设置」等全局面板页，`sidebarRight.mounted` 为 `undefined` 且 `sessions.list.current` 恒为 `undefined`，`openWorkbench()` 直接走 `ensureSessionId() → currentSessionId()` 读空并触发 `nudgeWorkbenchNeedsSession()`，从未尝试恢复最近在屏会话或切回会话主区。
2. **归档集与 seat 挂载契约**：在 DSH `0.2.2-rc.5` 中，`archivedSessionIds` 位于 `workspaces.list.getSnapshot().archivedSessionIds`（而非仅在 `sessions.list`），且 `uiWorkspace.openSession()` 同步更新 `sidebarRight.mounted` 早于 React 采纳该会话的右栏 store；合并读取两处归档集并对 `no session surface is mounted` 做受限短重试即可消除冷切换失败。
3. **并发守卫根因**：原 `contextIsCurrent()` 静态比对 `currentSessionId(sessions) === initialSession` 会把主动从 `undefined` 切回 `targetSessionId` 的合法导航判为上下文失效，改为递增请求序号 + 分阶段预期会话校验后可同时支持路由切回、并发连点覆盖和外部会话切换中止。

## 证伪方式

- **可观测证伪条件**：若回退 `host-adapter.js` 与 `sidebar-controller.js` 的目标会话解析、自动路由切回与请求序号守卫，以下任意场景将断言失败：
  1. 在 `mounted = undefined`、`list.current = undefined` 且存在 `lastMountedSessionId` / 历史会话 / 空会话工作区时，`openWorkbench()` 返回 `false` 且不调用 `uiWorkspace.openSession()` 或 `sessions.create()`；
  2. 并发连续点击「项目」→「资产库」时，旧请求仍向 `service.openTab` 写入或覆盖新请求；
  3. 仅在 `workspaces.list.archivedSessionIds` 标记归档时，误选已归档会话；
  4. `mounted` 切换后首次 `openTab` 抛 `sidebarRight: no session surface is mounted` 时直接失败而非重试打开。
- **验证命令**：
  ```bash
  node --test \
    plugins/plugins/omnimux/src/client/workbench/session-source.test.js \
    plugins/plugins/omnimux/src/client/workbench/non-session-open.test.js \
    plugins/plugins/omnimux/src/client/workbench.test.js \
    plugins/plugins/omnimux/src/client/workbench/tab-viewport-reconciler.test.js \
    plugins/plugins/omnimux/src/client/chrome-inject.test.js
  ```

## 验收项

1. `currentSessionId()` 契约不变：`session-source.test.js` 全绿，非会话页下仍严格返回 `undefined`。
2. 覆盖 5 类核心场景及归档过滤、seat 瞬态重试、调和器程序化切会话保护的回归测试 `non-session-open.test.js` 双向证伪通过。
3. `build:all`、`omnimux` 全量单测、`check:boundaries`、`verify:plugin-load`、`test:plugin-load`、`verify:stages`、`verify:silent-catch`、`lint:i18n`、`verify-fix-regression-test`、`verify-test-standard-declarations`、`bundle.lock.json` 与 `workspace-check` 全绿。
4. 真实客户端/浏览器路径验证：从会话进入插件/设置页后点击左侧「项目」「资产库」「灵感社区」一次直达全屏面板，返回对话停留在原会话上下文且左侧高亮唯一。

## 旧标准变更

以下既有测试断言因需求明确要求「仅在真正零工作区空状态提示，并优化引导文案为『请先添加工作区，再打开此面板』」而同步更新匹配正则（并由新增 `non-session-open.test.js` 加强验证完整文案与工作区添加入口聚焦）：

- `plugins/plugins/omnimux/src/client/workbench.test.js` :: `missing session leaves the old stage and details intact while showing a cue`
