/**
 * Workbench Sidebar Controller.
 * Coordinates sidebar lifecycle, stage overlay release, session toasts,
 * and workbench tab operations.
 */

import {
  currentSessionId,
  getAttachedStore,
  getWorkbenchLayout,
  getWorkbenchService,
  getWorkbenchSessions,
  getWorkbenchWorkspaces,
  hasMountedSessionFeed,
  hostDocument,
  hostWindow,
  isSeedFilesTab,
  listOpenTabs,
  liveSnapshot,
  mountedSessionId,
  navigateToWorkbenchSession,
  resolveTargetSessionForWorkbench,
  tabIsOpen,
  waitForBetterSidebar,
  waitForMountedSession,
  waitForSidebarSession,
  waitForTab,
  waitMs,
} from './host-adapter.js'
import {
  WORKBENCH_FOCUS,
  isWorkbenchTab,
  loadSessionFocusMap,
  resolveDefaultFocus,
  resolveWorkbenchTabTitle,
} from './focus-state.js'
import { notifyWorkbenchChange } from './event-bus.js'
import { isRailRowActive, requestRailActivationSync } from './sidebar-activation.js'
import { setWorkbenchFocus } from './split-layout.js'
import {
  enterHostRightSidebarFullscreen,
  findHostFullscreenEnterButton,
  isHostRightSidebarFullscreen,
} from './host-fullscreen.js'

export const WORKBENCH_GLOBAL_KEY = '__omnimuxWorkbench'

export {
  WORKBENCH_LEFT_RAIL_SYNC_DEBOUNCE_MS,
  WORKBENCH_LEFT_RAIL_SETTLE_MS,
  installWorkbenchLeftRailObserver,
  uninstallWorkbenchLeftRailObserver,
  syncWorkbenchGuiWidth,
} from './rail-sync.js'

const EMPTY_BOX = Object.freeze({ top: 0, left: 0, width: 0, height: 0 })
const TOAST_ID = 'omnimux-workbench-needs-session'
const SEAT_UNMOUNTED_RE = /no session surface is mounted/i
const HOST_SHELL_PROBE_SELECTOR = '[data-sidebar-right-panel], [data-sidebar-right-session], .dshDesktopFrame, [class*="frame"]'
const CHOOSER_SELECTORS = [
  'button[aria-label="Add workspace"]',
  'button[aria-label="添加工作区"]',
  'button[aria-label="Choose workspace"]',
  'button[aria-label="选择工作区"]',
  'input[aria-label="Choose workspace"]',
  'input[aria-label="选择工作区"]',
]

function releaseStageGlobal(win, current) {
  try {
    const stage = win ? win.__omnimuxStage : null
    if (stage && typeof stage.release === 'function') {
      stage.release(current)
    }
  } catch {
    // ignore
  }
}

function clearStageDataset(dataset, current) {
  if (dataset && dataset.dshProductStage === current) {
    try {
      delete dataset.dshProductStage
    } catch {
      // ignore
    }
  }
}

function dispatchStageEvent(win) {
  try {
    if (win && typeof win.dispatchEvent === 'function') {
      win.dispatchEvent(new CustomEvent('dsh-product-stage', { detail: { id: null } }))
    }
  } catch {
    // ignore
  }
}

/**
 * Library overlays claim data-dsh-product-stage, which hides the
 * better-sidebar panel. Opening a workbench tab must drop that claim.
 */
export function releaseCurrentProductStage() {
  const win = hostWindow()
  const doc = hostDocument()
  const root = doc ? doc.documentElement : null
  const dataset = root ? root.dataset : null
  const current = dataset ? dataset.dshProductStage : null
  if (!current) return false

  releaseStageGlobal(win, current)
  clearStageDataset(dataset, current)
  dispatchStageEvent(win)
  return true
}

function tryFocusElement(el) {
  try {
    if (typeof el.focus === 'function') {
      el.focus({ preventScroll: false })
    }
    if (typeof el.scrollIntoView === 'function') {
      const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
      el.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' })
    }
  } catch {
    // ignore
  }
}

function focusWorkspaceChooser(doc) {
  for (const selector of CHOOSER_SELECTORS) {
    const el = doc.querySelector(selector)
    if (el) {
      tryFocusElement(el)
      return
    }
  }
}

function createToastElement(doc) {
  const existing = doc.getElementById(TOAST_ID)
  if (existing) existing.remove()
  const toast = doc.createElement('div')
  toast.id = TOAST_ID
  toast.setAttribute('role', 'status')
  toast.textContent = '请先添加工作区，再打开此面板'
  toast.style.cssText = [
    'position:fixed',
    'left:50%',
    'bottom:28px',
    'transform:translateX(-50%)',
    'z-index:100000',
    'max-width:min(420px,90vw)',
    'padding:10px 14px',
    'border-radius:10px',
    'font:var(--dsw-font-s-14, 13px/18px system-ui)',
    'color:var(--dsw-alias-label-primary, #f8fafc)',
    'background:var(--dsw-alias-bg-elevated, #1c1c1f)',
    'border:1px solid var(--dsw-alias-border-l1, #334155)',
    'box-shadow:var(--dsw-shadow-lv2, 0 8px 24px rgba(0,0,0,.35))',
    'pointer-events:none',
  ].join(';')
  return toast
}

let toastTimer = null

function clearToastTimer() {
  if (toastTimer == null) return
  const win = hostWindow()
  if (win && typeof win.clearTimeout === 'function') {
    win.clearTimeout(toastTimer)
  } else {
    clearTimeout(toastTimer)
  }
  toastTimer = null
}

function scheduleToastDismissal(win, toast) {
  clearToastTimer()
  if (win && typeof win.setTimeout === 'function') {
    toastTimer = win.setTimeout(() => {
      try {
        toast.remove()
      } catch {
        // ignore
      }
      toastTimer = null
    }, 3200)
  }
}

/**
 * Surface a short cue when a workbench tab is opened without an active session.
 * @param {Document} [doc]
 * @returns {boolean}
 */
export function nudgeWorkbenchNeedsSession(doc = hostWindow()?.document) {
  if (!doc || typeof doc.createElement !== 'function') return false
  focusWorkspaceChooser(doc)
  const toast = createToastElement(doc)
  try {
    if (doc.body) {
      doc.body.appendChild(toast)
    }
    scheduleToastDismissal(hostWindow(), toast)
  } catch {
    return false
  }
  return true
}

function closeDetails() {
  try {
    const layout = getWorkbenchLayout()
    if (typeof layout?.closeDetails === 'function') {
      layout.closeDetails()
    }
  } catch {
    // layout may be an unwired Proxy
  }
}

function resolveTargetFocusMode(sessionId, tabId) {
  const map = loadSessionFocusMap(sessionId)
  const record = map[tabId]
  if (record?.explicit === true && (record.mode === WORKBENCH_FOCUS.gui || record.mode === WORKBENCH_FOCUS.split)) {
    return record.mode
  }
  return resolveDefaultFocus(tabId)
}

function resolveTabScope(sessionId, cwd, ready) {
  if (!ready) return undefined
  const scope = { sessionId }
  if (cwd) scope.cwd = cwd
  return scope
}

function resolveTabPayload(service, tabId, titleOpt, pathOpt) {
  let titleResolver = undefined
  if (service && typeof service.getTab === 'function') {
    titleResolver = (id) => service.getTab(id)
  }
  const title = resolveWorkbenchTabTitle(tabId, titleOpt, titleResolver)
  const payload = { type: tabId, id: tabId, title }
  if (typeof pathOpt === 'string' && pathOpt && pathOpt !== tabId) {
    payload.path = pathOpt
  }
  return payload
}

let openRequestSeq = 0

/** 测试专用：重置并发打开请求序号与 Toast 定时器。 */
export function resetSidebarControllerForTests() {
  openRequestSeq = 0
  clearToastTimer()
}

/**
 * 调用 `service.openTab` 并在 React 尚未完成新会话右侧栏 seat 采纳的瞬态窗口做受限短重试。
 * 仅对宿主明确的 `no session surface is mounted` 瞬态错重试，其他业务/契约错误原样抛出。
 */
async function openTabWithSeatRetry(service, payload, openScope, { timeoutMs = 4000, canRetry = () => true } = {}) {
  const deadline = Date.now() + Math.max(0, timeoutMs)
  while (true) {
    try {
      return await service.openTab(payload, openScope)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '')
      if (!SEAT_UNMOUNTED_RE.test(message)) throw error
      if (Date.now() >= deadline || !canRetry()) {
        console.warn('[omnimux-workbench] openTab timed out waiting for mounted session surface', error)
        return false
      }
      await waitMs(50)
      if (!canRetry()) return false
    }
  }
}

/**
 * 切回会话后刚展开右栏时，等待宿主全屏按钮完成当前帧渲染；无宿主框架 DOM（如离线单测）时立即返回。
 */
async function waitForFullscreenEnterControl(doc, maxWaitMs, isStillCurrent) {
  if (!doc || typeof doc.querySelector !== 'function' || typeof doc.querySelectorAll !== 'function' || maxWaitMs <= 0) {
    return false
  }
  if (!isStillCurrent()) return false
  const hasFullscreenOrControl = () => {
    try {
      return Boolean(isHostRightSidebarFullscreen(doc) || findHostFullscreenEnterButton(doc))
    } catch (error) {
      console.debug('[omnimux-workbench] fullscreen control probe failed', error)
      return false
    }
  }
  if (hasFullscreenOrControl()) return true
  let hasHostShell = false
  try {
    hasHostShell = Boolean(doc.querySelector(HOST_SHELL_PROBE_SELECTOR))
  } catch (error) {
    console.debug('[omnimux-workbench] host shell probe failed', error)
    return false
  }
  if (!hasHostShell) return false
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    if (!isStillCurrent()) return false
    await waitMs(30)
    if (!isStillCurrent()) return false
    if (hasFullscreenOrControl()) return true
  }
  return isStillCurrent() && hasFullscreenOrControl()
}

/**
 * Open a workbench tab in the right panel. Never claims a product stage.
 * @param {{ tabId?: string, id?: string, title?: string, path?: string,
 *   meta?: object, extra?: object, sessionId?: string, cwd?: string,
 *   timeoutMs?: number, preserveLayout?: boolean, focus?: string }} [opts]
 * @returns {Promise<boolean>}
 */
export async function openWorkbench(opts = {}) {
  const tabId = typeof opts.tabId === 'string' ? opts.tabId : ''
  if (!tabId) return false
  const reqSeq = ++openRequestSeq
  const sessions = getWorkbenchSessions()
  const initialSession = currentSessionId(sessions)
  const stage = hostDocument()?.documentElement?.dataset?.dshProductStage
  const layout = getWorkbenchLayout()
  const contextMatches = (expectedSession) => {
    if (openRequestSeq !== reqSeq) return false
    if (getWorkbenchSessions() !== sessions) return false
    if (getWorkbenchLayout() !== layout) return false
    if (hostDocument()?.documentElement?.dataset?.dshProductStage !== stage) return false
    if (expectedSession !== undefined) {
      return currentSessionId(sessions) === expectedSession
    }
    return true
  }

  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 4000
  const service = await waitForBetterSidebar(timeoutMs)
  if (!service || typeof service.openTab !== 'function') return false
  if (!await waitForTab(service, tabId, timeoutMs)) return false

  if (!contextMatches(initialSession) || getWorkbenchService() !== service) return false

  const resolved = await resolveTargetSessionForWorkbench({
    sessions,
    workspaces: getWorkbenchWorkspaces(),
    explicitId: opts.sessionId,
  })
  if (!contextMatches(initialSession) || getWorkbenchService() !== service) return false

  const sessionId = resolved.sessionId
  if (!sessionId) {
    if (resolved.source === 'no-workspace') {
      nudgeWorkbenchNeedsSession()
    }
    return false
  }

  // 非会话页异步创建会话期间，若用户已手动切入另一会话，则放弃本次自动切回。
  const liveBeforeNav = currentSessionId(sessions)
  if (initialSession === undefined && liveBeforeNav && liveBeforeNav !== sessionId) return false

  const win = hostWindow()
  const reconciler = win?.__omnimuxTabViewport
  let programmaticActive = false
  const beginProgrammatic = () => {
    if (programmaticActive) return
    programmaticActive = true
    reconciler?.beginProgrammatic?.()
  }
  const endProgrammatic = () => {
    if (!programmaticActive) return
    programmaticActive = false
    reconciler?.endProgrammatic?.()
  }

  try {
    const needsNavNow = resolved.needsNavigation && (!hasMountedSessionFeed() || mountedSessionId() !== sessionId)
    if (needsNavNow) {
      // 切回会话并立即展开面板：标记程序化过渡，避免调和器把回退会话误判为用户点击会话而收起右栏。
      beginProgrammatic()
      if (!navigateToWorkbenchSession(sessionId, sessions)) return false
      const mounted = await waitForMountedSession(sessionId, timeoutMs, {
        shouldContinue: () => openRequestSeq === reqSeq && getWorkbenchService() === service,
      })
      if (!mounted || !contextMatches(hasMountedSessionFeed() ? sessionId : undefined) || getWorkbenchService() !== service) {
        return false
      }
    }

    const ready = await waitForSidebarSession(service, sessionId, timeoutMs)
    const expectedAfterReady = resolved.needsNavigation
      ? (hasMountedSessionFeed() || currentSessionId(sessions) !== undefined ? sessionId : undefined)
      : (resolved.source === 'current' ? sessionId : initialSession)
    if (!ready || !contextMatches(expectedAfterReady) || getWorkbenchService() !== service) return false

    const openScope = resolveTabScope(sessionId, opts.cwd, ready)
    const seedIds = new Set(listOpenTabs(service.getSnapshot?.()?.state)
      .filter((tab) => isSeedFilesTab(tab) && tab.id).map((tab) => tab.id))

    const payload = resolveTabPayload(service, tabId, opts.title, opts.path)
    if (typeof opts.id === 'string' && opts.id) payload.id = opts.id
    if (opts.meta && typeof opts.meta === 'object') payload.meta = opts.meta
    if (opts.extra && typeof opts.extra === 'object') payload.extra = opts.extra
    if (opts.view && typeof opts.view === 'object') {
      payload.view = opts.view
      payload.meta = { ...payload.meta, ...opts.view }
    }
    // A provider may have unloaded while session/registration readiness was awaited.
    if (getWorkbenchService() !== service || !contextMatches(expectedAfterReady)) return false
    const opened = await openTabWithSeatRetry(service, payload, openScope, {
      timeoutMs,
      canRetry: () => getWorkbenchService() === service && contextMatches(expectedAfterReady),
    })
    if (opened === false) return false
    if (getWorkbenchService() !== service || !contextMatches(expectedAfterReady)
      || service.getSnapshot?.()?.sessionId !== sessionId) return false

    // Commit only after the same provider has opened in the captured session.
    if (payload.meta && typeof service.updateTab === 'function') {
      try {
        service.updateTab(payload.id || tabId, { meta: payload.meta })
      } catch (error) {
        console.debug('[omnimux-workbench] updateTab after open failed', error)
      }
    }
    const targetWsId = opts.view?.extra?.workspaceId || opts.view?.workspaceId || opts.view?.canvasWorkspaceId || opts.meta?.canvasWorkspaceId
    if (targetWsId && typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('omnimux:active-canvas-changed', {
          detail: { workspaceId: targetWsId, sessionId },
        }))
      } catch (error) {
        console.debug('[omnimux-workbench] active-canvas-changed dispatch failed', error)
      }
    }
    for (const tab of listOpenTabs(service.getSnapshot?.()?.state)) {
      if (seedIds.has(tab.id) && tab.id !== payload.id && isSeedFilesTab(tab)) {
        try {
          service.closeTab?.(tab.id, openScope)
        } catch (error) {
          console.debug('[omnimux-workbench] seed tab close failed', error)
        }
      }
    }
    closeDetails()
    releaseCurrentProductStage()

    if (opts.preserveLayout) {
      requestRailActivationSync()
      notifyWorkbenchChange()
      return true
    }

    const canApplyPostCommitLayout = () => (
      openRequestSeq === reqSeq
      && getWorkbenchService() === service
      && getWorkbenchSessions() === sessions
      && getWorkbenchLayout() === layout
      && !hostDocument()?.documentElement?.dataset?.dshProductStage
      && (expectedAfterReady === undefined || currentSessionId(sessions) === expectedAfterReady)
    )
    const targetMode = opts.focus || resolveTargetFocusMode(sessionId, tabId)
    setWorkbenchFocus(targetMode, getAttachedStore(), {}, tabId, { persistUserIntent: false })
    if (targetMode === WORKBENCH_FOCUS.gui) {
      beginProgrammatic()
      const doc = hostDocument()
      if (resolved.needsNavigation && timeoutMs > 0) {
        await waitForFullscreenEnterControl(doc, Math.min(timeoutMs, 1000), canApplyPostCommitLayout)
        if (!canApplyPostCommitLayout()) return false
      }
      try {
        enterHostRightSidebarFullscreen(doc)
      } catch (error) {
        console.debug('[omnimux-workbench] enterHostRightSidebarFullscreen fallback:', error instanceof Error ? error.message : String(error))
      }
    }
    requestRailActivationSync()
    notifyWorkbenchChange()
    return true
  } finally {
    endProgrammatic()
  }
}

export function closeWorkbenchPanel() {
  return setWorkbenchFocus(WORKBENCH_FOCUS.chat)
}

/**
 * 已下架的工作台 Tab 类型：这些页面不再有任何插件注册，留在快照里只会渲染
 * 「插件未加载」占位页（specs/products-into-assets.spec.md AC-305；specs/retire-forms-social-harvest.spec.md）。
 */
const RETIRED_WORKBENCH_TAB_TYPES = Object.freeze([
  'omnimux-products:library',
  'omnimux-forms:tasks',
  'omnimux-social-harvest:library',
])

/**
 * 一次性收编残留的下架 Tab（已合并或下线归档的插件页）。
 *
 * 约束：幂等（同一会话只扫一遍，且关闭动作本身可重复执行）、不阻塞（不 await 任何
 * 异步结果）、失败不影响主流程（只 console.warn，绝不吞掉原因）。
 * 只关闭 type 恰好等于下架类型的 Tab，不按 id 前缀或黑名单猜测。
 *
 * 幂等按会话记而不是整个服务记一次：better-sidebar 服务跨会话复用，先物化的会话
 * 可能没有旧 Tab，若那时就打上全局标记，切到仍带旧 Tab 的会话就会漏扫。
 *
 * @param {object | null | undefined} service better-sidebar 服务
 * @returns {number} 本次关闭的 Tab 数
 */
export function sweepRetiredWorkbenchTabs(service) {
  if (!service || typeof service.getSnapshot !== 'function' || typeof service.closeTab !== 'function') return 0

  let snapshot
  try {
    snapshot = service.getSnapshot()
  } catch (error) {
    console.warn('[omnimux-workbench] 读取快照以收编下架 Tab 失败:', error)
    return 0
  }
  // 快照尚未物化：等下一次状态变更，不要提前打标记，否则真出现时反而漏扫。
  if (!snapshot?.state) return 0

  const sessionKey = typeof snapshot.sessionId === 'string' && snapshot.sessionId ? snapshot.sessionId : ''
  if (!(service.__omnimuxRetiredTabsSweptSessions instanceof Set)) {
    service.__omnimuxRetiredTabsSweptSessions = new Set()
  }
  const swept = service.__omnimuxRetiredTabsSweptSessions
  if (swept.has(sessionKey)) return 0

  const scope = sessionKey ? { sessionId: sessionKey } : undefined
  let closed = 0
  let failed = 0
  for (const tab of listOpenTabs(snapshot.state)) {
    if (!RETIRED_WORKBENCH_TAB_TYPES.includes(tab?.type)) continue
    try {
      const result = service.closeTab(tab.id, scope)
      if (result && typeof result.catch === 'function') {
        result.catch((error) => {
          console.warn('[omnimux-workbench] 关闭下架 Tab 的异步结果失败:', error)
        })
      }
      closed += 1
    } catch (error) {
      failed += 1
      console.warn('[omnimux-workbench] 关闭下架 Tab 失败:', error)
    }
  }
  // 只有「本次确实关掉了残留」才封盘。快照可能先于旧 Tab 恢复完成（首次物化时
  // 还没有），那一刻若就记下「已扫过」，之后同一会话补回的旧 Tab 就永远不再扫。
  // 关闭失败同理不封盘，让下一次状态变更继续尝试。
  if (closed > 0 && failed === 0) swept.add(sessionKey)
  if (closed > 0) notifyWorkbenchChange()
  return closed
}

export function closeWorkbenchTab(tabId) {
  if (!tabId) return false
  const service = getWorkbenchService()
  if (!service || typeof service.closeTab !== 'function') return false
  const snapshot = liveSnapshot()
  const sessionId = snapshot?.sessionId
  const scope = sessionId ? { sessionId } : undefined
  try {
    service.closeTab(tabId, scope)
  } catch {
    return false
  }
  const afterSnap = liveSnapshot()
  const remaining = listOpenTabs(afterSnap?.state).filter((t) => isWorkbenchTab(t.id || t.type))
  if (remaining.length === 0) {
    closeWorkbenchPanel()
  }
  notifyWorkbenchChange()
  return true
}

export function isWorkbenchOpen(tabId) {
  const service = getWorkbenchService()
  const attached = getAttachedStore()
  let snapshot = null
  if (typeof attached?.getSnapshot === 'function') {
    snapshot = attached.getSnapshot()
  } else if (typeof service?.getSnapshot === 'function') {
    snapshot = service.getSnapshot()
  }
  return tabIsOpen(snapshot?.state, tabId)
}

/**
 * 行的激活读数：唯一真源是统一仲裁裁决（会话记录优先，其次官方右栏聚焦页签）。
 *
 * 不再读 better-sidebar 快照：右栏已交还官方 `ctx.sidebarRight`，那份镜像上的
 * `panelOpen` / `splits` 在本宿主上已不存在，谓词因此恒为 false（点击插件项不高亮的根因）。
 * @param {string} tabId
 * @returns {boolean}
 */
export function isWorkbenchActive(tabId) {
  if (!tabId) return false
  return isRailRowActive(tabId)
}

function getWorkbenchApi() {
  const win = hostWindow()
  if (win && WORKBENCH_GLOBAL_KEY in win) {
    return win[WORKBENCH_GLOBAL_KEY]
  }
  return undefined
}

function resolveStoreTitle(options, tabId) {
  const title = options.title
  if (typeof title === 'function') return title()
  return title || tabId
}

/**
 * 行的读面：与 `isWorkbenchActive` 同源，都是仲裁裁决的投影。
 *
 * 契约约束（docs/contracts/sidebar-extra-entries.md）：高亮 MUST 跟随**聚焦**的页签，
 * 不是 Tab 是否存在。历史上的 `isOpen` 回退会把「存在但未聚焦」判成 active，
 * 是双高亮的唯一可复现路径，已删除。
 */
function readSidebarSnapshot(tabId) {
  if (!tabId) return false
  return isRailRowActive(tabId)
}

function closeSidebarStore(tabId) {
  const api = getWorkbenchApi()
  if (api && typeof api.closeTab === 'function') {
    api.closeTab(tabId)
    return
  }
  if (api && typeof api.closePanel === 'function') {
    api.closePanel()
  }
}

function pollApiSubscription(listener) {
  let unsub = () => {}
  const started = Date.now()
  const timer = setInterval(() => {
    const next = getWorkbenchApi()
    if (next && typeof next.subscribe === 'function') {
      clearInterval(timer)
      unsub = next.subscribe(listener)
      return
    }
    if (Date.now() - started > 8000) {
      clearInterval(timer)
    }
  }, 50)
  return () => {
    clearInterval(timer)
    unsub()
  }
}

function subscribeSidebarStore(listener) {
  if (typeof listener !== 'function') return () => {}
  const api = getWorkbenchApi()
  if (api && typeof api.subscribe === 'function') {
    return api.subscribe(listener)
  }
  return pollApiSubscription(listener)
}

function openSidebarStore(options, tabId, path) {
  const api = getWorkbenchApi()
  if (api && typeof api.open === 'function') {
    const title = resolveStoreTitle(options, tabId)
    // 左侧一级入口：进页面意图，默认右侧全屏（Issue #2516）
    void api.open({ tabId, title, ...(path ? { path } : {}) })
  }
}

export function createWorkbenchSidebarStore(options) {
  const tabId = options.tabId
  const path = options.path && options.path !== tabId ? options.path : undefined

  return {
    getSnapshot: () => readSidebarSnapshot(tabId),
    subscribe: (listener) => subscribeSidebarStore(listener),
    open: () => openSidebarStore(options, tabId, path),
    close: () => closeSidebarStore(tabId),
    set(next) {
      if (next) this.open()
      else this.close()
    },
    readBox: () => EMPTY_BOX,
  }
}
