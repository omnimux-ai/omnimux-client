/**
 * Workbench 宿主适配器：与 better-sidebar / 官方外壳交互的唯一入口。
 *
 * 只接受当前 pin 的官方契约 `SidebarSnapshot = { sessionId, state }`；
 * 不做 `snap.state || snap` 之类的兼容猜测。快照结构遍历（split 树、
 * Tab 列表）与服务等待/会话判定也归这里，纯计算归 geometry/focus-state。
 */

/** @type {{
 *   betterSidebar?: object | null,
 *   sidebarRight?: object | null,
 *   layout?: object | null,
 *   sessions?: object | null,
 *   workspaces?: object | null,
 *   uiWorkspace?: object | null,
 *   getSessionNavigation?: (() => object | null | undefined) | null,
 * }} */
const deps = {
  betterSidebar: null,
  sidebarRight: null,
  layout: null,
  sessions: null,
  workspaces: null,
  uiWorkspace: null,
  getSessionNavigation: null,
}

/** @type {string | undefined} 最近一次在屏的非空会话 id（内存级缓存，供非会话页切回上下文）。 */
let lastMountedSessionId = undefined

/** @type {object | null} 当前装配层 attach 的 better-sidebar Tab store。 */
let attachedStore = null

/** Sessions whose initial sidebar snapshot was classified for default seed cleanup. */
const classifiedSeedSessions = new Set()
/** 按 workspaceId 合并并发零会话自动建会话请求，避免连点产生重复空白会话。 */
const inflightWorkspaceSessionCreates = new Map()
const SIDEBAR_LAYOUT_STORAGE_PREFIX = 'dsh-sidebar:v1:'

/**
 * 记录最近一次非空的在屏会话 id。
 * 进入插件/设置等非会话页时 `mounted` 会变为 `undefined`，此处只收非空字符串，保留原上下文。
 * @param {unknown} sessionId
 * @returns {string | undefined}
 */
export function recordMountedSessionId(sessionId) {
  if (typeof sessionId === 'string' && sessionId.trim() !== '') {
    lastMountedSessionId = sessionId
  }
  return lastMountedSessionId
}

export function getLastMountedSessionId() {
  return lastMountedSessionId
}

export function bindWorkbenchDeps(next = {}) {
  if (next.betterSidebar !== undefined) deps.betterSidebar = next.betterSidebar || null
  if (next.sidebarRight !== undefined) {
    deps.sidebarRight = next.sidebarRight || null
    if (deps.sidebarRight) recordMountedSessionId(mountedSessionId(deps.sidebarRight))
  }
  if (next.layout !== undefined) deps.layout = next.layout || null
  if (next.sessions !== undefined) deps.sessions = next.sessions || null
  if (next.workspaces !== undefined) deps.workspaces = next.workspaces || null
  if (next.uiWorkspace !== undefined) deps.uiWorkspace = next.uiWorkspace || null
  if (next.getSessionNavigation !== undefined) {
    deps.getSessionNavigation = typeof next.getSessionNavigation === 'function' ? next.getSessionNavigation : null
  }
}

export function getWorkbenchService() {
  return deps.betterSidebar || null
}

export function getWorkbenchSidebarRight() {
  return deps.sidebarRight || null
}

export function getWorkbenchLayout() {
  return deps.layout || null
}

export function getWorkbenchWorkspaces() {
  return deps.workspaces || null
}

export function getWorkbenchUiWorkspace() {
  return deps.uiWorkspace || null
}

export function getWorkbenchSessionNavigation() {
  return deps.getSessionNavigation || null
}

/**
 * 解析官方外壳 layout 句柄（`DesktopLayoutState`）：注入的服务优先，其次沿 React Fiber
 * 向上找 `memoizedProps.layout`（注入时机未到时仍能拿到同一个对象）。
 *
 * 这是「写外壳 `panels.rightbar`」的唯一入口：外壳 authored 第三轨、拖拽起点
 * `rightbarBase` 与右分隔线把手位置三者都由该字段决定（方案 D7）。拿不到句柄时
 * 必须返回 `null` 而不是伪造一个对象——协调方据此跳过，绝不猜测几何。
 * @param {Document | null | undefined} [doc]
 * @returns {object | null} 具备 `setRightbar` 的 layout 句柄
 */
export function resolveWorkbenchLayoutHandle(doc = hostDocument()) {
  if (deps.layout && typeof deps.layout.setRightbar === 'function') return deps.layout
  try {
    const frame = doc?.querySelector?.('.dshDesktopFrame:has([data-sidebar-right-panel]), [class*="frame"]:has([data-sidebar-right-panel])')
      || doc?.querySelector?.('.dshDesktopFrame, [class*="frame"]')
    if (!frame) return null
    const key = Object.keys(frame).find((k) => k.startsWith('__reactFiber'))
    let node = key ? frame[key] : null
    while (node) {
      const layout = node.memoizedProps?.layout
      if (layout && typeof layout.setRightbar === 'function') return layout
      const actions = node.memoizedProps?.actions
      if (actions && typeof actions.setRightbar === 'function') return actions
      node = node.return
    }
  } catch {
    // ignore
  }
  return null
}

export function getWorkbenchSessions() {
  return deps.sessions || null
}

export function getAttachedStore() {
  return attachedStore
}

export function setAttachedStore(store) {
  attachedStore = store || null
}

export function resetWorkbenchHostAdapter() {
  deps.betterSidebar = null
  deps.sidebarRight = null
  deps.layout = null
  deps.sessions = null
  deps.workspaces = null
  deps.uiWorkspace = null
  deps.getSessionNavigation = null
  lastMountedSessionId = undefined
  attachedStore = null
  classifiedSeedSessions.clear()
  inflightWorkspaceSessionCreates.clear()
}

export function hostWindow() {
  return typeof globalThis.window !== 'undefined' ? globalThis.window : undefined
}

export function hostDocument() {
  return typeof globalThis.document !== 'undefined' ? globalThis.document : hostWindow()?.document
}

/**
 * 严格读取官方 SidebarSnapshot 的 state。没有 `.state` 就是没有状态，
 * 绝不把裸 state 对象当作快照（移除历史 `snap?.state || snap` 猜测）。
 * @param {import('../../workbench/contract.js').SidebarSnapshot | null | undefined} snapshot
 * @returns {object | null}
 */
export function snapshotState(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null
  return snapshot.state && typeof snapshot.state === 'object' ? snapshot.state : null
}

/**
 * 读取当前活跃快照：优先显式 store / 已 attach store，其次 better-sidebar 服务。
 * @param {object | null} [store]
 * @returns {import('../../workbench/contract.js').SidebarSnapshot | null}
 */
export function liveSnapshot(store = attachedStore) {
  return (typeof store?.getSnapshot === 'function' ? store.getSnapshot() : null)
    || getWorkbenchService()?.getSnapshot?.()
    || null
}

/**
 * Recursively collect split-tree tabs (does not depend on better-sidebar internals).
 * @param {object | null | undefined} node
 * @returns {Array<{ id?: string, type?: string, path?: string }>}
 */
export function collectTabs(node) {
  if (!node || typeof node !== 'object') return []
  if (node.kind === 'leaf') return Array.isArray(node.tabs) ? node.tabs : []
  if (!Array.isArray(node.children)) return []
  return node.children.flatMap(collectTabs)
}

/**
 * Empty Files seed: type=editor with no path. User-opened editors keep their path.
 * @param {{ type?: string, path?: string }} tab
 */
export function isSeedFilesTab(tab) {
  return tab?.type === 'editor' && (tab.path === undefined || tab.path === '')
}

export function listOpenTabs(state) {
  if (!state) return []
  return collectTabs(state.splits).concat(collectTabs(state.bottomSplits))
}

export function activeTabId(state) {
  if (!state) return undefined
  const activePaneId = state.activePane
  const findLeaf = (node) => {
    if (!node || typeof node !== 'object') return null
    if (node.kind === 'leaf') return node.id === activePaneId || !activePaneId ? node : null
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = findLeaf(child)
        if (found) return found
      }
    }
    return null
  }
  const leaf = findLeaf(state.splits) || findLeaf(state.bottomSplits)
  return leaf?.active ?? leaf?.tabs?.[0]?.id ?? undefined
}

export function tabIsOpen(state, tabId) {
  if (!tabId) return false
  return listOpenTabs(state).some((tab) => tab.id === tabId || tab.type === tabId)
}

/**
 * 当前在屏会话：rc.3 的合法读面是官方 `ctx.sidebarRight.mounted`
 * （`ObservableSnapshot<SessionId | undefined>`，由 ui-sidebar-right 在
 * 「中间栏显示对话」时写入）。
 *
 * 它比 sessions 列表更准：`mounted` 表示**此刻真正在屏**的会话，而列表的
 * `current` 只是「选中」。
 * @returns {string | undefined}
 */
export function mountedSessionId(sidebarRight = deps.sidebarRight) {
  try {
    const id = sidebarRight?.mounted?.getSnapshot?.()
    return typeof id === 'string' && id ? id : undefined
  } catch {
    // Cordis Proxy may throw on unread services.
    return undefined
  }
}

/**
 * 解析当前会话 id。
 *
 * 顺序：`sidebarRight.mounted`（在屏）→ `sessions.list` 的 `current`（选中）。
 * 两者都是官方契约字段；读不到就返回 `undefined`，绝不拿列表首项冒充当前会话。
 *
 * Issue #3800 背景：侧栏支持包 0.19.1 只读 `current`，而 rc.3 运行时在该字段
 * 留空时它的会话槽位永远为空，`openTab` 于是直接返回、一级入口点击全废。
 * 本仓自己解析会话时必须先认 `mounted`，不能沿用单一 `current` 读法。
 * @param {object | null} [sessions]
 * @returns {string | undefined}
 */
export function currentSessionId(sessions = deps.sessions) {
  const mounted = mountedSessionId()
  if (mounted) return mounted
  try {
    const snap = sessions?.list?.getSnapshot?.()
    const selected = snap?.current
    if (typeof selected === 'string' && selected) return selected
  } catch {
    // Cordis Proxy may throw on unread services.
  }
  return undefined
}

export async function ensureSessionId(sessions, explicitId) {
  if (explicitId) return String(explicitId)
  return currentSessionId(sessions)
}

/**
 * 当前宿主是否提供 `sidebarRight.mounted` 读面（Next/rc.3+ 为 true，老壳/无此服务测试为 false）。
 * @param {object | null | undefined} [sidebarRight]
 * @returns {boolean}
 */
export function hasMountedSessionFeed(sidebarRight = deps.sidebarRight) {
  try {
    return typeof sidebarRight?.mounted?.getSnapshot === 'function'
  } catch (error) {
    console.debug('[omnimux-workbench] sidebarRight.mounted availability check failed', error)
    return false
  }
}

/**
 * 解析主区会话导航接缝：优先 `uiWorkspace.openSession`（显式注入 → 懒 `ctx.get('uiWorkspace')`），
 * 老壳回退 `sessions.open`。
 * @param {object | null | undefined} [sessions]
 * @returns {{ openSession: (id: string) => unknown } | { open: (id: string) => unknown } | null}
 */
export function resolveWorkbenchSessionNavigation(sessions = deps.sessions) {
  if (deps.uiWorkspace && typeof deps.uiWorkspace.openSession === 'function') {
    return deps.uiWorkspace
  }
  if (typeof deps.getSessionNavigation === 'function') {
    try {
      const lazy = deps.getSessionNavigation()
      if (lazy && typeof lazy.openSession === 'function') return lazy
    } catch (error) {
      console.debug('[omnimux-workbench] lazy uiWorkspace lookup failed', error)
    }
  }
  if (sessions && typeof sessions.open === 'function') {
    return { open: (id) => sessions.open(id) }
  }
  return null
}

/**
 * 将主区从插件/设置等非会话页切回目标会话视图。
 * @param {string | undefined} sessionId
 * @param {object | null | undefined} [sessions]
 * @returns {boolean}
 */
export function navigateToWorkbenchSession(sessionId, sessions = deps.sessions) {
  const id = typeof sessionId === 'string' ? sessionId.trim() : ''
  if (!id) return false
  const navigation = resolveWorkbenchSessionNavigation(sessions)
  if (!navigation) {
    console.warn('[omnimux-workbench] session navigation unavailable for', id)
    return false
  }
  try {
    if (typeof navigation.openSession === 'function') navigation.openSession(id)
    else navigation.open(id)
    return true
  } catch (error) {
    console.warn('[omnimux-workbench] session navigation failed for', id, error)
    return false
  }
}

/**
 * 合并读取已归档会话 id：DSH 0.2.x 权威归档集在 `workspaces.list.archivedSessionIds`，
 * 同时兼容旧契约/测试桩里放在 `sessions.list.archivedSessionIds` 的写法。
 */
function readArchivedSessionIds(sessions, workspaces) {
  const archived = new Set()
  const collect = (raw) => {
    if (!Array.isArray(raw)) return
    for (const id of raw) {
      if (typeof id === 'string' && id) archived.add(id)
    }
  }
  try {
    collect(workspaces?.list?.getSnapshot?.()?.archivedSessionIds)
  } catch (error) {
    console.debug('[omnimux-workbench] workspaces archivedSessionIds read failed', error)
  }
  try {
    collect(sessions?.list?.getSnapshot?.()?.archivedSessionIds)
  } catch (error) {
    console.debug('[omnimux-workbench] sessions archivedSessionIds read failed', error)
  }
  return archived
}

function readSessionListSnapshot(sessions) {
  try {
    return sessions?.list?.getSnapshot?.() ?? null
  } catch (error) {
    console.debug('[omnimux-workbench] sessions.list snapshot read failed', error)
    return null
  }
}

function readWorkspaceItems(workspaces) {
  try {
    const items = workspaces?.list?.getSnapshot?.()?.items
    return Array.isArray(items) ? items : []
  } catch (error) {
    console.debug('[omnimux-workbench] workspaces.list snapshot read failed', error)
    return []
  }
}

function isLiveUnarchivedSession(id, sessionSnap, archived) {
  if (typeof id !== 'string' || !id || archived.has(id)) return false
  const byId = sessionSnap?.byId
  if (!byId || typeof byId !== 'object' || !Object.prototype.hasOwnProperty.call(byId, id) || !byId[id]) {
    return false
  }
  // DSH 0.2.x 中 byId 可能含 detached subagent 回退行；提供 ids 时以宿主列表成员为准。
  if (Array.isArray(sessionSnap.ids)) {
    return sessionSnap.ids.includes(id)
  }
  return true
}

/**
 * 为工作台打开动作解析目标会话（不修改 `currentSessionId()` 的纯读契约）：
 * 0. 显式 `explicitId` 或当前已有在屏/选中会话；
 * 1. 最近一次在屏会话 `lastMountedSessionId`（仍存活且未归档）；
 * 2. `sessions.list.byId` 中未归档会话按 `updatedAt` 降序首项；
 * 3. 有工作区但零可用会话：自动在首个工作区调用 `sessions.create({ workspaceId })`；
 * 4. 真正零工作区且零可用会话：返回 `{ sessionId: undefined, source: 'no-workspace', needsNavigation: false }`。
 *
 * @param {{ sessions?: object | null, workspaces?: object | null, explicitId?: string }} [options]
 * @returns {Promise<{ sessionId: string | undefined, source: string, needsNavigation: boolean }>}
 */
export async function resolveTargetSessionForWorkbench({
  sessions = deps.sessions,
  workspaces = deps.workspaces,
  explicitId = undefined,
} = {}) {
  const mountedFeed = hasMountedSessionFeed()
  const currentMounted = mountedFeed ? mountedSessionId() : undefined

  if (explicitId) {
    const id = String(explicitId)
    return {
      sessionId: id,
      source: 'explicit',
      needsNavigation: mountedFeed ? currentMounted !== id : false,
    }
  }

  const current = currentSessionId(sessions)
  if (current) {
    return {
      sessionId: current,
      source: 'current',
      needsNavigation: mountedFeed ? currentMounted !== current : false,
    }
  }

  const sessionSnap = readSessionListSnapshot(sessions)
  const archived = readArchivedSessionIds(sessions, workspaces)

  if (isLiveUnarchivedSession(lastMountedSessionId, sessionSnap, archived)) {
    return {
      sessionId: lastMountedSessionId,
      source: 'last-mounted',
      needsNavigation: true,
    }
  }

  const byId = sessionSnap?.byId && typeof sessionSnap.byId === 'object' ? sessionSnap.byId : null
  if (byId) {
    const candidateIds = Array.isArray(sessionSnap.ids) ? sessionSnap.ids : Object.keys(byId)
    const live = candidateIds
      .filter((id) => isLiveUnarchivedSession(id, sessionSnap, archived) && byId[id]?.origin !== 'subagent')
      .sort((a, b) => (Number(byId[b]?.updatedAt) || 0) - (Number(byId[a]?.updatedAt) || 0))
    if (live[0]) {
      return {
        sessionId: live[0],
        source: 'recent-active',
        needsNavigation: true,
      }
    }
  }

  const workspaceItems = readWorkspaceItems(workspaces)
  const targetWorkspace = workspaceItems.find(
    (item) => item && typeof item.workspaceId === 'string' && item.workspaceId.trim() !== '',
  )
  if (targetWorkspace) {
    if (typeof sessions?.create !== 'function') {
      return { sessionId: undefined, source: 'create-failed', needsNavigation: false }
    }
    const workspaceId = targetWorkspace.workspaceId
    let pending = inflightWorkspaceSessionCreates.get(workspaceId)
    if (!pending) {
      pending = Promise.resolve()
        .then(() => sessions.create({ workspaceId }))
        .finally(() => {
          if (inflightWorkspaceSessionCreates.get(workspaceId) === pending) {
            inflightWorkspaceSessionCreates.delete(workspaceId)
          }
        })
      inflightWorkspaceSessionCreates.set(workspaceId, pending)
    }
    try {
      const created = await pending
      if (typeof created === 'string' && created.trim() !== '') {
        return {
          sessionId: created.trim(),
          source: 'created',
          needsNavigation: true,
        }
      }
      console.warn('[omnimux-workbench] sessions.create returned empty session id', created)
      return { sessionId: undefined, source: 'create-failed', needsNavigation: false }
    } catch (error) {
      console.warn('[omnimux-workbench] auto-creating session for workbench failed', error)
      return { sessionId: undefined, source: 'create-failed', needsNavigation: false }
    }
  }

  return { sessionId: undefined, source: 'no-workspace', needsNavigation: false }
}

/**
 * 等待官方 `sidebarRight.mounted` 变为目标会话（老壳无此读面时直接放行，交由 `waitForSidebarSession` 校验）。
 * @param {string} sessionId
 * @param {number} [timeoutMs]
 * @param {{ sidebarRight?: object | null, shouldContinue?: () => boolean }} [options]
 * @returns {Promise<boolean>}
 */
export async function waitForMountedSession(sessionId, timeoutMs = 4000, options = {}) {
  const sidebarRight = options && Object.prototype.hasOwnProperty.call(options, 'sidebarRight')
    ? options.sidebarRight
    : deps.sidebarRight
  const shouldContinue = typeof options?.shouldContinue === 'function' ? options.shouldContinue : () => true
  if (!sessionId || !shouldContinue()) return false
  let mounted = null
  try {
    mounted = sidebarRight?.mounted ?? null
  } catch (error) {
    console.debug('[omnimux-workbench] sidebarRight.mounted read failed', error)
    return true
  }
  if (!mounted || typeof mounted.getSnapshot !== 'function') return true
  if (mountedSessionId(sidebarRight) === sessionId) return true
  if (timeoutMs <= 0) return false
  const started = Date.now()
  return new Promise((resolve) => {
    let settled = false
    let unsubscribe
    let poll
    let timer
    const finish = (value) => {
      if (settled) return
      settled = true
      if (typeof unsubscribe === 'function') {
        try {
          unsubscribe()
        } catch (error) {
          console.debug('[omnimux-workbench] mounted unsubscribe failed', error)
        }
      }
      if (poll !== undefined) clearInterval(poll)
      if (timer !== undefined) clearTimeout(timer)
      resolve(value)
    }
    if (typeof mounted.subscribe === 'function') {
      try {
        unsubscribe = mounted.subscribe(() => {
          if (!shouldContinue()) finish(false)
          else if (mountedSessionId(sidebarRight) === sessionId) finish(true)
        })
        if (settled && typeof unsubscribe === 'function') {
          try {
            unsubscribe()
          } catch (error) {
            console.debug('[omnimux-workbench] sync mounted unsubscribe failed', error)
          }
          unsubscribe = undefined
        }
      } catch (error) {
        console.debug('[omnimux-workbench] mounted subscribe failed, falling back to poll', error)
      }
    }
    if (settled) return
    poll = setInterval(() => {
      if (!shouldContinue()) finish(false)
      else if (mountedSessionId(sidebarRight) === sessionId) finish(true)
      else if (Date.now() - started >= timeoutMs) finish(false)
    }, 50)
    timer = setTimeout(() => {
      finish(shouldContinue() && mountedSessionId(sidebarRight) === sessionId)
    }, timeoutMs)
  })
}

export function waitMs(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

export async function waitForBetterSidebar(timeoutMs = 4000) {
  const first = getWorkbenchService()
  if (first && typeof first.openTab === 'function') return first
  if (timeoutMs <= 0) return first
  const started = Date.now()
  while (Date.now() - started <= timeoutMs) {
    const service = getWorkbenchService()
    if (service && typeof service.openTab === 'function') return service
    await waitMs(50)
  }
  return getWorkbenchService()
}

export async function waitForSidebarSession(service, sessionId, timeoutMs = 4000) {
  if (!service || !sessionId || typeof service.getSnapshot !== 'function') return false
  if (service.getSnapshot()?.sessionId === sessionId) return true
  if (timeoutMs <= 0) return false
  const started = Date.now()
  while (Date.now() - started <= timeoutMs) {
    if (service.getSnapshot()?.sessionId === sessionId) return true
    await waitMs(50)
  }
  return service.getSnapshot()?.sessionId === sessionId
}

export async function waitForTab(service, tabId, timeoutMs = 4000) {
  if (!service || typeof service.getTab !== 'function') return Boolean(service)
  if (service.getTab(tabId)) return true
  if (timeoutMs <= 0) return false
  const started = Date.now()
  while (Date.now() - started <= timeoutMs) {
    if (service.getTab(tabId)) return true
    await waitMs(50)
  }
  return Boolean(service.getTab(tabId))
}

export function closeSeedFiles(service, openScope) {
  const state = service.getSnapshot?.()?.state
  if (!state || typeof service.closeTab !== 'function') return
  const tabs = listOpenTabs(state)
  for (const tab of tabs) {
    if (isSeedFilesTab(tab) && tab.id) {
      try { service.closeTab(tab.id, openScope) } catch { /* ignore */ }
    }
  }
}

/**
 * Classify one session exactly once when its first sidebar snapshot arrives.
 * A reliable absent storage key identifies better-sidebar's factory state;
 * closing its path-less editor leaves the pane empty so PaneEmptyCards renders.
 */
export function clearInitialFilesSeed(service) {
  if (!service || typeof service.getSnapshot !== 'function' || typeof service.closeTab !== 'function') return false
  let snapshot
  try {
    snapshot = service.getSnapshot()
  } catch {
    return false
  }
  const sessionId = snapshot?.sessionId
  const state = snapshotState(snapshot)
  if (!sessionId || !state || classifiedSeedSessions.has(sessionId)) return false

  let hasPersistedLayout
  try {
    const storage = hostWindow()?.localStorage
    if (!storage || typeof storage.getItem !== 'function') return false
    hasPersistedLayout = storage.getItem(SIDEBAR_LAYOUT_STORAGE_PREFIX + sessionId) !== null
  } catch {
    return false
  }

  classifiedSeedSessions.add(sessionId)
  if (hasPersistedLayout) return false
  const seed = listOpenTabs(state).find((tab) => isSeedFilesTab(tab) && tab.id)
  if (!seed) return false
  try {
    service.closeTab(seed.id, { sessionId })
    return true
  } catch {
    return false
  }
}
