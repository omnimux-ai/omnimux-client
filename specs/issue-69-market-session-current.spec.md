# Spec: #69 market session-create rc.3 当前会话读口

- 任务：`issue-69-market-session-current`
- 日期：2026-11-17
- 基线：`origin/main`（`367a1fda`）
- 风险：R1（专家/技能市场的新会话与当前会话判定；只改 `plugins/plugins/omnimux-market`）

## 背景

`plugins/plugins/omnimux-market/src/client/session-create.js` 仍有多处读取 `sessions.list.getSnapshot().current`；rc.3 的 `SessionListState` 只有 `{ ids, byId, phase, projectionsBySession }`，没有 `current`。结果是：

- `createReadySkillSession` 的 `origin` / `expected` 恒空，取消检测失效；
- `resolvedOfficialTarget` 恒返回 null，官方新会话点击链路超时，随后落入 `sessions.create` 兜底；
- `resolveFallbackWorkspaceId`、`createSkillSession` 的会话 A 保护、轮询中的当前会话判断、`currentPlazaSessionId` 都失真。

## 目标

1. 新增市场片段内的合法当前会话读口（`window.__omnimuxWorkbench.getSnapshot().sessionId` → `getCurrentSessionId()` → `window.__omnimuxAttachments.getActiveSessionId()`），过滤 `default` / `__none__` 等 sentinel。
2. `resolvedOfficialTarget` 用 `byId[sessionId].blank === true`，并支持 `ids` 中新增 blank 的列表 diff（不依赖 workbench 投影先更新）。
3. 清理 `session-create.js` 中全部 `sessions.list...current` 生产读取，含 `createReadySkillSession`、`resolveFallbackWorkspaceId`、`createSkillSession`、`currentPlazaSessionId`。
4. 测试改用 rc.3 `SessionListState` 形状（无 `current`），覆盖「无 current 仍能点击/创建」与「新 blank 的 ids diff」。

## 非目标

- 不改市场其它业务逻辑、不改官方 DSH 源码、不改网关契约。
- 不引入跨插件 import（market 的 `session-create.js` 是 `concat-client.mjs` 拼接片段，复制同语义 helper，避免加载顺序耦合）。
- 不复用 / 不混入 #68 的灵感插件改动。

## 验收（AC）

- [ ] AC-1：`session-create.js` 源码无 `sessions.list.getSnapshot().current` 读取；合法读口按上述顺序解析。
- [ ] AC-2：`resolvedOfficialTarget` 在 rc.3 形状下能通过 `byId[sessionId].blank` 或 `ids` 新增 blank 返回 `{ ok:true, sessionId }`。
- [ ] AC-3：`createReadySkillSession` 的 origin/expected/cancel 检查在无 `current` 的 store 下仍工作。
- [ ] AC-3b：`createReadySkillSession` 的导航先走 `plazaUiWorkspace.openSession(sessionId)`（`uiWorkspace` 接缝；Next/rc.3 壳里 `sessions.open` 不切主会话），无 `uiWorkspace` 才回落 `sessions.open`；有界等待 `marketCurrentSessionId() === sessionId`（默认 3s），等不到返回 `session-navigation-unavailable`。切到目标会话后调用 `workbench.open({ tabId: 'omnimux-market:plaza', sessionId, title })`、`setFocus('split')`、`setConversationCollapsed(false, { sessionId })`；`session-create-ready.test.js` 断言导航调用、切换顺序与三者参数。
- [ ] AC-4：`createSkillSession` 的会话 A 保护与 `currentPlazaSessionId` 在无 `current` 下仍工作。
- [ ] AC-5：`pnpm --filter omnimux-market test` 与 typecheck、build、build:all、boundaries/stages/plugin-load 全部通过（除基线已有失败）。

## 旧标准变更

- `plugins/plugins/omnimux-market/src/client/session-create-ready.test.js` :: `ready flow installs once, attaches nonempty body to B, writes once without reading stale draft, preserves A`
  原断言：`h.calls` 末项为 `['open', 'b']`（`sessions.open` 触发导航）。
  必须改：ready 路径改走 `uiWorkspace.openSession`；有 uiWorkspace 时不再调用 `sessions.open`，原断言不再成立。
  新期望证据：`uiCalls = [['openSession', 'b']]`、`h.calls` 不含 `open`、`workbench.open` 在会话切到 b 后才调用；`session-create-ready.test.js` 16/16 全绿。

- `plugins/plugins/omnimux-market/src/client/session-create-ready.test.js` :: `switch away while target input is mounting never writes or reopens target`
  原断言：`h.calls` 中 `open` 次数为 1。
  必须改：导航由 `uiWorkspace.openSession` 发起，`sessions.open` 不再被调用。
  新期望证据：`uiCalls.length === 1` 且会话最终停在 c、writes 为 0；同一用例 16/16 全绿。


- `plugins/plugins/omnimux-market/src/client/session-create-ready.test.js` :: `no current session can create through the same public service`
  原断言：`setup` 的 `sessions.list.getSnapshot()` 以 `{ current, byId }` 模拟官方 store，`h.move('')` 依赖 `list.current`；rc.3 无 `current`。
  必须改：`getSnapshot` 改为 `{ ids, byId, phase, projectionsBySession }`，当前会话由 `window.__omnimuxWorkbench.getSnapshot().sessionId` 模拟；用例名保持。
  新期望证据：`session-create-ready.test.js` 全绿；回退 `currentSessionId()` 为 `snapshot.current` 时该用例红。

- `plugins/plugins/omnimux-market/src/client/skill-workshop-ui.test.js` :: `session create triggers official new-session button click via DOM matching newSession / aria / text or collapsed menu`
  原断言：`mockSessions.list.getSnapshot()` 返回 `{ current, byId }`，点击只用 `current` 变化判定。
  必须改：mock 改为 rc.3 `{ ids, byId, phase, projectionsBySession }`；点击只追加新 blank 到 `ids`，workbench snapshot 故意保持旧值，证明 `ids` diff 能解析。
  新期望证据：该用例全绿；回退 `resolvedOfficialTarget` 为 `snapshot.current` 时用例红。

- `plugins/plugins/omnimux-market/src/client/skill-workshop-ui.test.js` :: `session create inherits workspaceId from current session, workspaces service, or session list fallback`
  原断言：4 个 fixture 通过 `sessions.list.getSnapshot().current` 提供当前会话，再调用 `resolveFallbackWorkspaceId(sessions, workspaces)`；rc.3 无 `current`。
  必须改：fixture 改为 rc.3 形状，调用显式传入测试当前 id `resolveFallbackWorkspaceId(sessions, workspaces, currentId)`，覆盖同一组四个分支（current / items / recent / history）。
  新期望证据：该用例全绿；不改显式 id 时依赖 host 读口，生产代码不再回读 `current`。
