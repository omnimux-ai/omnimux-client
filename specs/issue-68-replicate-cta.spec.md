# Spec: #68 「立即复刻」点击无响应（rc.3 SessionListState 无 current）

- 任务：`issue-68-replicate-cta`
- 日期：2026-11-17
- 基线：`origin/main`（`ba017fb`）
- 风险：R1（客户端附件/会话读取，只改 `plugins/plugins/omnimux-inspiration`）

## 背景

rc.3 的官方 `SessionListState` 契约是 `{ ids, byId, phase, projectionsBySession }`，没有 `current`。`new-session-click.js` 读 `sessions.list.getSnapshot().current`（旧行 168、209），导致：

- `beforeId` 恒空、`hasOfficialCurrent=false`；
- `resolvedOfficialTarget()` 恒返回 null，即使官方「新会话」按钮已触发 `POST /api/session/create 200`；
- `clickOfficialNewSession()` 1.5s 超时返回 `{ ok:false, error:'newSessionFailed' }`；
- `oneClickReplicate()` 在打开新会话步骤直接 return，附件/预填从未执行。

次要问题：失败状态只写入页面底部的 `#omnimux-inspiration-cta-status`（实测 rect.top=2089.7、视口高 994），完全在视口外且 2 秒后清除，用户看到「无任何响应」。

## 目标

1. `new-session-click.js` 改用宿主合法当前会话读口：`window.__omnimuxWorkbench.getSnapshot().sessionId` → `getCurrentSessionId()` → `window.__omnimuxAttachments.getActiveSessionId()`；不再读 `sessions.list.current`。
2. `resolvedOfficialTarget()` 用 `byId[sessionId].blank === true` 判定；并支持 `ids` 列表 diff 识别新增 blank 会话（不依赖单一读数口）。
3. 抽出共用 helper `attachInspirationToCurrentSession(row, io)`：解析合法当前会话（`io.sessionId` 可覆盖），复用 `buildInspirationPayload` + `__omnimuxAttachments.addAttachment`；`立即复刻` 使用它，后续「用 Agent 分析」共用，不做两套。
4. 失败提示走既有 `.omnimux-inspiration-toast`（`position: fixed; top: 24px`，视口内）或卡片内联；`#omnimux-inspiration-cta-status` 保留给读屏，不作为唯一视觉反馈。
5. `findSingleWorkspaceNewSessionButton` / `matchesOfficialNewSession` regex 补「新建对话 / 新对话」。

## 非目标

- 不改「立即复刻」当前产品语义（仍是官方新会话 + 附件 + 预填），不改成 current-session 覆盖用户草稿。
- 不改 `omnimux-market` 同类问题（#69 另单）。
- 不改宿主 `SessionListState` 契约或官方 DSH 源码。
- 不新增解释性文案；不新增 tooltip/副标题/badge。

## 验收（AC）

- [ ] AC-1：`new-session-click.js` 源码不再出现 `sessions.list.current` / `snapshot?.current`；合法读口按 workbench snapshot → getCurrentSessionId → attachments 顺序解析。
- [ ] AC-2：rc.3 形状 `{ ids, byId, phase, projectionsBySession }`（无 `current`）下，官方新会话创建后 `clickOfficialNewSession()` 返回 `{ ok:true, sessionId, reusedBlank:false }`；same-id blank 复用返回 `reusedBlank:true`。
- [ ] AC-3：`attachInspirationToCurrentSession()` 在无 `sessions.list.current`、仅 workbench/attachments 读口时仍能成功 attach 到当前会话；`io.sessionId` 显式覆盖可用。
- [ ] AC-4：`oneClickReplicate()` 正常路径通过该 helper 完成附件写入；失败状态同步到既有 toast（`.omnimux-inspiration-toast`），元素 fixed 在视口内。
- [ ] AC-5：`findSingleWorkspaceNewSessionButton` 能识别「在…中新建对话 / 新对话」。
- [ ] AC-6：回归：`replicate-to-chat.test.js` 既有成功/失败/预填/回滚用例全绿；`impression-cta` / 收藏 / 详情弹窗相关套件全绿。

## 测试

- `new-session-click.test.js`：全部 mock 改为 rc.3 `SessionListState` 形状（`ids/byId/phase/projectionsBySession`，禁止 `current`），覆盖无 current attach、新 blank 列表 diff、same-id blank 复用、异步选择。
- `attach-to-current-session.test.js`：覆盖 workbench snapshot 读口、`getCurrentSessionId()`、`__omnimuxAttachments.getActiveSessionId()`、无会话失败、duplicate、quota。
- `replicate-to-chat.test.js`：新增「无 `sessions.list.current` 场景仍成功 attach」用例；正常路径断言 helper 被使用。
- toast：`replicate-cta-toast.test.js` 断言 `InspirationSection` 将非 replicating 的 ctaStatus 交给既有 `showToast`，且 `.omnimux-inspiration-toast` CSS 为 fixed 视口内定位。

## 旧标准变更

- `plugins/plugins/omnimux-inspiration/src/client/new-session-click.test.js` :: `clickOfficialNewSession official lifecycle resolution`
  原断言：`makeSessions` 以 `{ current: 'old', byId }` 模拟官方 store，并用 describe 名 `clickOfficialNewSession official lifecycle resolution` 汇总旧 `current` 语义；rc.3 真实契约没有 `current`，这些 mock 让生产必挂的单测全绿。
  必须改：`makeSessions` 改为 `{ ids, byId, phase, projectionsBySession }`，当前会话由 `window.__omnimuxWorkbench.getSnapshot().sessionId` / `__omnimuxAttachments.getActiveSessionId()` 模拟；describe 改为 `clickOfficialNewSession official lifecycle resolution (rc.3 shape)`，所有旧 `current` 断言改为合法读口。
  新期望证据：rc.3 形状下 `new-session-click.test.js` 全绿；把 `resolveCurrentSessionId` 回退为 `snapshot.current` 时用例红（F1 实测 `20 tests / 13 pass / 7 fail`）。
- `plugins/plugins/omnimux-inspiration/src/client/replicate-to-chat.test.js` :: `makeIo` 原本没有当前会话读口，正常路径只测新会话；新增 helper 后正常路径需覆盖「无 current 的 rc.3 store + workbench 当前会话」。
  - 新期望证据：该套件全绿；回退 helper 读口为 `sessions.list.current` 时「无 current 场景仍成功 attach」用例红。
