/**
 * 回归测试：非会话页（插件 / 设置等）点击左侧工作台入口自动切回会话并打开目标面板。
 *
 * 覆盖 DSH 0.2.2-rc.5 真实快照形态：
 * - `sidebarRight.mounted`: `ObservableSnapshot<SessionId | undefined>`
 * - `sessions.list.getSnapshot()`: `{ ids, byId, phase, projectionsBySession }`（无 `current`、无 `archivedSessionIds`）
 * - `workspaces.list.getSnapshot()`: `{ items, archivedSessionIds, pinnedSessionIds }`
 * - `uiWorkspace.openSession(sessionId)`（老壳回退 `sessions.open(sessionId)`）
 */

import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { installWorkbenchGlobal, resetWorkbenchForTests } from '../workbench.js'
import { WORKBENCH_FOCUS } from './focus-state.js'
import {
  bindWorkbenchDeps,
  currentSessionId,
  getLastMountedSessionId,
  getWorkbenchUiWorkspace,
  getWorkbenchWorkspaces,
  navigateToWorkbenchSession,
  recordMountedSessionId,
} from './host-adapter.js'
import { createTabViewportReconciler } from './tab-viewport-reconciler.js'

const DOM_GLOBALS = [
  'window',
  'document',
  'HTMLElement',
  'HTMLStyleElement',
  'HTMLButtonElement',
  'HTMLDivElement',
  'SVGElement',
  'Element',
  'Node',
  'MutationObserver',
  'Event',
  'CustomEvent',
  'getComputedStyle',
]
const previousGlobals = Object.fromEntries(DOM_GLOBALS.map((key) => [key, globalThis[key]]))
let activeDom

afterEach(() => {
  resetWorkbenchForTests(globalThis.window)
  activeDom?.window.close()
  activeDom = undefined
  for (const key of DOM_GLOBALS) {
    if (previousGlobals[key] === undefined) delete globalThis[key]
    else globalThis[key] = previousGlobals[key]
  }
})

function setupDom(body = '') {
  activeDom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { url: 'http://localhost/' })
  globalThis.window = activeDom.window
  globalThis.document = activeDom.window.document
  for (const key of DOM_GLOBALS) {
    if (key === 'window' || key === 'document') continue
    if (activeDom.window[key] !== undefined) globalThis[key] = activeDom.window[key]
  }
  return { win: activeDom.window, doc: activeDom.window.document }
}

function makeState(tabs = [], width = 780, panelOpen = true) {
  return {
    width,
    panelOpen,
    activePane: 'main',
    splits: { kind: 'leaf', id: 'main', tabs },
  }
}

/** 构造带真实订阅语义的 ObservableSnapshot。 */
function createObservable(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next) {
      value = next
      for (const listener of [...listeners]) listener()
    },
  }
}

function createHostHarness({
  initialMounted = undefined,
  sessionIds = [],
  sessionsById = {},
  sessionArchivedIds = undefined,
  workspaces = [],
  workspaceArchivedIds = [],
  onOpenSession = null,
  legacySessionsOpen = null,
  onCreateSession = null,
  onOpenTab = null,
  domBody = '',
} = {}) {
  const { win, doc } = setupDom(domBody)
  const api = installWorkbenchGlobal(win)
  const mounted = createObservable(initialMounted)
  const sidebarRight = { mounted }
  let sidebarSnapshot = { sessionId: initialMounted, state: initialMounted ? makeState([]) : undefined }
  const openedTabs = []
  const navigated = []
  const createdRequests = []

  const betterSidebar = {
    getTab: (id) => ({ id }),
    getSnapshot: () => sidebarSnapshot,
    subscribeState: () => () => {},
    openTab(seed, scope) {
      if (onOpenTab) {
        const res = onOpenTab({ seed, scope, setSidebarSnapshot: (next) => { sidebarSnapshot = next } })
        if (res !== undefined) return res
      }
      openedTabs.push({ seed, scope })
      sidebarSnapshot = {
        sessionId: scope?.sessionId ?? sidebarSnapshot.sessionId,
        state: makeState([{ id: seed.id, type: seed.type }]),
      }
      return true
    },
    closeTab() {},
  }

  const sessions = {
    list: {
      getSnapshot: () => ({
        ids: sessionIds,
        byId: sessionsById,
        phase: 'ready',
        projectionsBySession: {},
        ...(sessionArchivedIds !== undefined ? { archivedSessionIds: sessionArchivedIds } : {}),
      }),
      subscribe: () => () => {},
    },
    ...(onCreateSession
      ? {
          async create(opts) {
            createdRequests.push(opts)
            return onCreateSession(opts)
          },
        }
      : {}),
    ...(legacySessionsOpen
      ? {
          open(id) {
            navigated.push({ via: 'sessions.open', sessionId: id })
            legacySessionsOpen(id, {
              setMounted: (next) => mounted.set(next),
              setSidebarSnapshot: (next) => { sidebarSnapshot = next },
            })
          },
        }
      : {}),
  }

  const workspacesService = {
    list: {
      getSnapshot: () => ({
        items: workspaces,
        archivedSessionIds: workspaceArchivedIds,
        pinnedSessionIds: [],
        state: 'idle',
        phase: 'ready',
        error: null,
      }),
      subscribe: () => () => {},
    },
  }

  const uiWorkspace = legacySessionsOpen
    ? null
    : {
        openSession(id) {
          navigated.push({ via: 'uiWorkspace.openSession', sessionId: id })
          if (onOpenSession) {
            onOpenSession(id, {
              setMounted: (next) => mounted.set(next),
              setSidebarSnapshot: (next) => { sidebarSnapshot = next },
            })
          } else {
            setTimeout(() => {
              mounted.set(id)
              sidebarSnapshot = { sessionId: id, state: makeState([]) }
            }, 10)
          }
        },
      }

  api.bind({
    betterSidebar,
    sidebarRight: legacySessionsOpen ? null : sidebarRight,
    sessions,
    workspaces: workspacesService,
    ...(uiWorkspace ? { uiWorkspace } : {}),
  })

  return {
    win,
    doc,
    api,
    mounted,
    openedTabs,
    navigated,
    createdRequests,
    setSidebarSnapshot(next) {
      sidebarSnapshot = next
    },
  }
}

test('非会话页存在 lastMountedSessionId：优先切回原会话并全屏打开目标面板，且切回前 currentSessionId 保持 undefined', async () => {
  let fullscreenClicks = 0
  const env = createHostHarness({
    initialMounted: 's-origin',
    sessionIds: ['s-origin', 's-newer'],
    sessionsById: {
      's-origin': { id: 's-origin', updatedAt: 1000, blank: false },
      's-newer': { id: 's-newer', updatedAt: 9000, blank: false },
    },
    workspaces: [{ workspaceId: 'ws-1', path: '/work/a', sessionIds: ['s-origin', 's-newer'] }],
    domBody: '<div class="dshDesktopFrame"><div data-sidebar-right-panel="push" data-sidebar-right-open><button data-sidebar-right-mode="fullscreen"></button></div></div>',
  })

  const fsBtn = env.doc.querySelector('button[data-sidebar-right-mode="fullscreen"]')
  fsBtn.addEventListener('click', () => {
    fullscreenClicks += 1
    env.doc.querySelector('[data-sidebar-right-panel]').setAttribute('data-sidebar-right-panel', 'fullscreen')
  })

  // 模拟从会话 s-origin 切入「插件」页：mounted 变为 undefined，但 lastMountedSessionId 仍保留。
  assert.equal(getLastMountedSessionId(), 's-origin')
  env.mounted.set(undefined)
  env.setSidebarSnapshot({ sessionId: undefined, state: undefined })

  // 硬性契约（Issue #3800）：切回前 currentSessionId() 仍严格返回 undefined。
  assert.equal(currentSessionId(), undefined)

  const ok = await env.api.open({ tabId: 'omnimux-workflow:library', title: '项目', timeoutMs: 500 })
  assert.equal(ok, true)
  assert.deepEqual(env.navigated, [{ via: 'uiWorkspace.openSession', sessionId: 's-origin' }])
  assert.equal(env.openedTabs.length, 1)
  assert.equal(env.openedTabs[0].seed.type, 'omnimux-workflow:library')
  assert.deepEqual(env.openedTabs[0].scope, { sessionId: 's-origin' })
  assert.equal(fullscreenClicks, 1)
  assert.equal(env.doc.getElementById('omnimux-workbench-needs-session'), null)
  assert.equal(currentSessionId(), 's-origin')
})

test('无 lastMountedSessionId 时按 updatedAt 降序选最近未归档会话（跳过 workspaces.list 归档与非 ids 成员）', async () => {
  const env = createHostHarness({
    initialMounted: undefined,
    sessionIds: ['s-archived', 's-older', 's-recent'],
    sessionsById: {
      's-archived': { id: 's-archived', updatedAt: 9999 },
      's-detached-subagent': { id: 's-detached-subagent', updatedAt: 8888 },
      's-older': { id: 's-older', updatedAt: 2000 },
      's-recent': { id: 's-recent', updatedAt: 5000 },
    },
    workspaceArchivedIds: ['s-archived'],
    workspaces: [{ workspaceId: 'ws-1', path: '/work/a', sessionIds: ['s-older', 's-recent'] }],
  })

  // 若记忆中的 lastMountedSessionId 已被归档，也必须跳过而回落到 s-recent。
  recordMountedSessionId('s-archived')
  assert.equal(currentSessionId(), undefined)

  const ok = await env.api.open({ tabId: 'omnimux-assets:library', title: '资产库', timeoutMs: 500 })
  assert.equal(ok, true)
  assert.deepEqual(env.navigated, [{ via: 'uiWorkspace.openSession', sessionId: 's-recent' }])
  assert.equal(env.openedTabs.length, 1)
  assert.equal(env.openedTabs[0].seed.type, 'omnimux-assets:library')
  assert.deepEqual(env.openedTabs[0].scope, { sessionId: 's-recent' })
})

test('老壳缺少 uiWorkspace 时回退 sessions.open 并成功打开目标面板', async () => {
  const env = createHostHarness({
    initialMounted: undefined,
    sessionIds: ['s-legacy-1', 's-legacy-2'],
    sessionsById: {
      's-legacy-1': { id: 's-legacy-1', updatedAt: 100 },
      's-legacy-2': { id: 's-legacy-2', updatedAt: 400 },
    },
    legacySessionsOpen(id, { setSidebarSnapshot }) {
      setTimeout(() => {
        setSidebarSnapshot({ sessionId: id, state: makeState([]) })
      }, 10)
    },
  })

  const ok = await env.api.open({ tabId: 'omnimux-inspiration:library', title: '灵感社区', timeoutMs: 500 })
  assert.equal(ok, true)
  assert.deepEqual(env.navigated, [{ via: 'sessions.open', sessionId: 's-legacy-2' }])
  assert.equal(env.openedTabs.length, 1)
  assert.deepEqual(env.openedTabs[0].scope, { sessionId: 's-legacy-2' })
})

test('有工作区但零会话时自动 sessions.create({ workspaceId }) 并切回打开目标面板', async () => {
  const env = createHostHarness({
    initialMounted: undefined,
    sessionIds: [],
    sessionsById: {},
    workspaces: [{ workspaceId: 'ws-alpha', path: '/work/alpha', sessionIds: [] }],
    onCreateSession: async () => 's-created-alpha',
  })

  const ok = await env.api.open({ tabId: 'omnimux-workflow:library', title: '项目', timeoutMs: 500 })
  assert.equal(ok, true)
  assert.deepEqual(env.createdRequests, [{ workspaceId: 'ws-alpha' }])
  assert.deepEqual(env.navigated, [{ via: 'uiWorkspace.openSession', sessionId: 's-created-alpha' }])
  assert.equal(env.openedTabs.length, 1)
  assert.deepEqual(env.openedTabs[0].scope, { sessionId: 's-created-alpha' })
  assert.equal(env.doc.getElementById('omnimux-workbench-needs-session'), null)
})

test('真正零工作区且零会话时弹出引导 Toast、聚焦添加工作区入口并返回 false', async () => {
  const env = createHostHarness({
    initialMounted: undefined,
    sessionIds: [],
    sessionsById: {},
    workspaces: [],
    onCreateSession: async () => 'should-not-create',
    domBody: '<button id="add-ws" aria-label="添加工作区">添加工作区</button>',
  })

  const ok = await env.api.open({ tabId: 'omnimux-workflow:library', title: '项目', timeoutMs: 200 })
  assert.equal(ok, false)
  assert.deepEqual(env.createdRequests, [])
  assert.deepEqual(env.navigated, [])
  assert.equal(env.openedTabs.length, 0)

  const toast = env.doc.getElementById('omnimux-workbench-needs-session')
  assert.ok(toast, '零工作区空状态必须弹出引导 Toast')
  assert.equal(toast.textContent, '请先添加工作区，再打开此面板')
  assert.equal(env.doc.activeElement?.id, 'add-ws')
})

test('mounted 刚切换后首次 openTab 抛 no session surface is mounted 瞬态错时自动重试并成功打开', async () => {
  let attempts = 0
  const env = createHostHarness({
    initialMounted: undefined,
    sessionIds: ['s-cold'],
    sessionsById: { 's-cold': { id: 's-cold', updatedAt: 500 } },
    workspaces: [{ workspaceId: 'ws-1', path: '/work/a', sessionIds: ['s-cold'] }],
    onOpenSession(id, { setMounted, setSidebarSnapshot }) {
      // 模拟 DSH ui-sidebar-right：mounted 同步切换早于 React seat 采纳。
      setMounted(id)
      setSidebarSnapshot({ sessionId: id, state: makeState([]) })
    },
    onOpenTab({ seed, scope, setSidebarSnapshot }) {
      attempts += 1
      if (attempts <= 2) {
        throw new Error('sidebarRight: no session surface is mounted')
      }
      setSidebarSnapshot({ sessionId: scope.sessionId, state: makeState([{ id: seed.id, type: seed.type }]) })
      return undefined
    },
  })

  const ok = await env.api.open({ tabId: 'omnimux-assets:library', title: '资产库', timeoutMs: 500 })
  assert.equal(ok, true)
  assert.equal(attempts, 3)
  assert.equal(env.openedTabs.length, 1)
  assert.equal(env.openedTabs[0].seed.type, 'omnimux-assets:library')
})

test('并发连点两个入口（项目 → 资产库）时仅最后一次生效，旧请求自动退出无串台', async () => {
  const pendingMounts = []
  const env = createHostHarness({
    initialMounted: undefined,
    sessionIds: ['s-1'],
    sessionsById: { 's-1': { id: 's-1', updatedAt: 1000 } },
    workspaces: [{ workspaceId: 'ws-1', path: '/work/a', sessionIds: ['s-1'] }],
    onOpenSession(id, { setMounted, setSidebarSnapshot }) {
      pendingMounts.push(() => {
        setMounted(id)
        setSidebarSnapshot({ sessionId: id, state: makeState([]) })
      })
    },
  })

  const first = env.api.open({ tabId: 'omnimux-workflow:library', title: '项目', timeoutMs: 500 })
  // 等待第一个请求进入 waitForMountedSession 挂起态
  await new Promise((resolve) => setTimeout(resolve, 15))
  const second = env.api.open({ tabId: 'omnimux-assets:library', title: '资产库', timeoutMs: 500 })
  await new Promise((resolve) => setTimeout(resolve, 15))

  // 释放会话挂载，两个挂起的请求同时唤醒
  for (const flush of pendingMounts) flush()

  const [firstOk, secondOk] = await Promise.all([first, second])
  assert.equal(firstOk, false, '被取代的旧点击必须静默退出')
  assert.equal(secondOk, true, '最后一次点击必须成功打开')
  assert.equal(env.openedTabs.length, 1)
  assert.equal(env.openedTabs[0].seed.type, 'omnimux-assets:library')
})

test('程序化切回不同会话时 tab-viewport-reconciler 不误关刚打开的面板', () => {
  const { doc } = setupDom('<div data-sidebar-right-panel="fullscreen" data-sidebar-right-open></div>')
  const closes = []
  let session = 's-a'
  const reconciler = createTabViewportReconciler({
    getDoc: () => doc,
    getSessionId: () => session,
    getTabId: () => 'omnimux-assets:library',
    isFullscreen: () => true,
    loadSessionThreeColumn: () => false,
    closePanel: () => { closes.push(session) },
    setFocus: () => {},
  })

  reconciler.sync()
  assert.deepEqual(closes, [])

  reconciler.beginProgrammatic()
  session = 's-b'
  reconciler.sync()
  reconciler.endProgrammatic()
  reconciler.sync()

  assert.deepEqual(closes, [], '程序化切会话打开工作台面板期间不得误关面板')
})

test('installHubChrome 通过可选 inject 与懒 ctx.get 绑定 workspaces/uiWorkspace 并记录 mounted 会话', async () => {
  setupDom('')
  const { installHubChrome } = await import('../chrome.js')
  const { resetSidebarCoordinatorForTests } = await import('../sidebar-coordinator.js')
  const mounted = createObservable('s-initial')
  const navigated = []
  const uiWorkspaceSvc = { openSession: (id) => navigated.push(id) }
  const workspacesSvc = {
    list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1' }], archivedSessionIds: [] }), subscribe: () => () => {} },
  }
  const sessionsSvc = {
    list: {
      getSnapshot: () => ({ ids: ['s-initial'], byId: { 's-initial': { id: 's-initial', updatedAt: 1 } } }),
      subscribe: () => () => {},
    },
  }
  const disposers = []
  const services = new Map([
    ['layout', {}],
    ['sessions', sessionsSvc],
    ['workspaces', workspacesSvc],
    ['uiWorkspace', uiWorkspaceSvc],
    ['sidebarRight', { mounted }],
  ])

  const strictCtx = new Proxy({
    locale: { register: () => () => {}, bind: () => (k) => k },
    effect(fn) {
      const clean = fn()
      if (typeof clean === 'function') disposers.push(clean)
      return () => clean?.()
    },
    get(name) {
      return services.get(name)
    },
    inject(names, callback) {
      const inner = {
        effect: (fn) => {
          const clean = fn()
          if (typeof clean === 'function') disposers.push(clean)
          return () => clean?.()
        },
        get: (name) => services.get(name),
      }
      for (const name of names) inner[name] = services.get(name)
      callback(inner)
      return { dispose() {} }
    },
  }, {
    get(target, prop) {
      if (
        prop === 'workspaces'
        || prop === 'uiWorkspace'
        || prop === 'layout'
        || prop === 'sessions'
        || prop === 'betterSidebar'
        || prop === 'sidebarRight'
      ) {
        throw new Error(`cannot get property "${String(prop)}" without inject`)
      }
      return target[prop]
    },
  })

  try {
    installHubChrome(strictCtx)
    assert.equal(getLastMountedSessionId(), 's-initial')
    assert.equal(getWorkbenchWorkspaces(), workspacesSvc)
    assert.equal(getWorkbenchUiWorkspace(), uiWorkspaceSvc)

    // 切入新会话后离开到非会话页：记忆应停在最新非空会话 s-second，且可通过 uiWorkspace 导航
    mounted.set('s-second')
    mounted.set(undefined)
    assert.equal(getLastMountedSessionId(), 's-second')
    assert.equal(currentSessionId(), undefined)
    assert.equal(navigateToWorkbenchSession('s-second'), true)
    assert.deepEqual(navigated, ['s-second'])

    // 即使 deps.uiWorkspace 尚未由 inject 绑定，也应通过懒 ctx.get('uiWorkspace') 完成导航
    bindWorkbenchDeps({ uiWorkspace: null })
    assert.equal(navigateToWorkbenchSession('s-lazy'), true)
    assert.deepEqual(navigated, ['s-second', 's-lazy'])
  } finally {
    for (const dispose of disposers.reverse()) dispose()
    resetSidebarCoordinatorForTests()
    bindWorkbenchDeps({ sidebarRight: null })
  }
  assert.equal(getWorkbenchWorkspaces(), null)
  assert.equal(getWorkbenchUiWorkspace(), null)
  assert.equal(WORKBENCH_FOCUS.gui, 'gui')
})

test('切回会话展开面板后全屏按钮延迟挂载时等待其渲染并触发官方全屏', async () => {
  let fullscreenClicks = 0
  const env = createHostHarness({
    initialMounted: undefined,
    sessionIds: ['s-delayed-fs'],
    sessionsById: { 's-delayed-fs': { id: 's-delayed-fs', updatedAt: 1000 } },
    workspaces: [{ workspaceId: 'ws-1', path: '/work/a', sessionIds: ['s-delayed-fs'] }],
    domBody: '<div class="dshDesktopFrame"></div>',
    onOpenTab({ seed, scope, setSidebarSnapshot }) {
      setSidebarSnapshot({ sessionId: scope.sessionId, state: makeState([{ id: seed.id, type: seed.type }]) })
      // 模拟 React 在 openTab 下一帧渲染出右栏面板与全屏按钮
      setTimeout(() => {
        const frame = env.doc.querySelector('.dshDesktopFrame')
        if (!frame) return
        const panel = env.doc.createElement('div')
        panel.setAttribute('data-sidebar-right-panel', 'push')
        panel.setAttribute('data-sidebar-right-open', '')
        const btn = env.doc.createElement('button')
        btn.setAttribute('data-sidebar-right-mode', 'fullscreen')
        btn.addEventListener('click', () => {
          fullscreenClicks += 1
          panel.setAttribute('data-sidebar-right-panel', 'fullscreen')
        })
        panel.appendChild(btn)
        frame.appendChild(panel)
      }, 25)
      return undefined
    },
  })

  const ok = await env.api.open({ tabId: 'omnimux-inspiration:library', title: '灵感社区', timeoutMs: 500 })
  assert.equal(ok, true)
  assert.equal(fullscreenClicks, 1, '应等待右栏全屏按钮渲染完成并点击进入官方全屏')
})

test('并发连点搭配真实调和器：旧请求退出不提前解除程序化锁，且立即退订过期的 mounted 监听', async () => {
  let activeMountedListeners = 0
  const mountedListeners = new Set()
  let mountedVal = undefined
  let resolveFirstSubscribed
  const firstSubscribed = new Promise((r) => { resolveFirstSubscribed = r })
  let resolveSecondSubscribed
  const secondSubscribed = new Promise((r) => { resolveSecondSubscribed = r })
  let totalSubscribes = 0
  const mounted = {
    getSnapshot: () => mountedVal,
    subscribe(fn) {
      activeMountedListeners += 1
      totalSubscribes += 1
      mountedListeners.add(fn)
      if (totalSubscribes === 1) resolveFirstSubscribed()
      if (totalSubscribes === 2) resolveSecondSubscribed()
      return () => {
        if (mountedListeners.delete(fn)) activeMountedListeners -= 1
      }
    },
    set(next) {
      mountedVal = next
      for (const fn of [...mountedListeners]) fn()
    },
  }

  let closedByReconciler = 0
  const explicitWrites = []
  const persistedCollapsed = []
  let setSidebarSnapRef = null

  const env = createHostHarness({
    initialMounted: undefined,
    sessionIds: ['s-lock'],
    sessionsById: { 's-lock': { id: 's-lock', updatedAt: 1000 } },
    workspaces: [{ workspaceId: 'ws-1', path: '/work/a', sessionIds: ['s-lock'] }],
    domBody: '<div class="dshDesktopFrame"></div>',
    onOpenSession(_targetId, { setSidebarSnapshot }) {
      // 保留句柄，待两条请求都进入 waitForMountedSession 后再同步触发挂载，确保两个请求同时持有程序化锁
      setSidebarSnapRef = setSidebarSnapshot
    },
    onOpenTab({ seed, scope, setSidebarSnapshot }) {
      setSidebarSnapshot({ sessionId: scope.sessionId, state: makeState([{ id: seed.id, type: seed.type }]) })
      // 模拟延迟 120ms（超过 PROGRAMMATIC_LOCK_MS = 80ms）后宿主才渲染出全屏按钮
      setTimeout(() => {
        const frame = env.doc.querySelector('.dshDesktopFrame')
        if (!frame) return
        const panel = env.doc.createElement('div')
        panel.setAttribute('data-sidebar-right-panel', 'push')
        panel.setAttribute('data-sidebar-right-open', '')
        const btn = env.doc.createElement('button')
        btn.setAttribute('data-sidebar-right-mode', 'fullscreen')
        btn.addEventListener('click', () => {
          panel.setAttribute('data-sidebar-right-panel', 'fullscreen')
          reconciler.sync()
        })
        panel.appendChild(btn)
        frame.appendChild(panel)
        reconciler.sync()
      }, 120)
      return undefined
    },
  })
  // 换用可计数订阅器的 mounted 读面
  bindWorkbenchDeps({ sidebarRight: { mounted } })

  const reconciler = createTabViewportReconciler({
    getDoc: () => env.doc,
    getSessionId: () => mounted.getSnapshot(),
    getTabId: () => 'omnimux-assets:library',
    closePanel: () => { closedByReconciler += 1 },
    persistFocus: (_sid, _tabId, val) => explicitWrites.push(val),
    persistConversationCollapsed: (collapsed) => persistedCollapsed.push(collapsed),
    loadSessionThreeColumn: () => false,
  })
  env.win.__omnimuxTabViewport = reconciler
  // 先在旧会话 s-prev 观测过一次，验证切到 s-lock 期间不会被调和器误关
  mounted.set('s-prev')
  const prevPanel = env.doc.createElement('div')
  prevPanel.setAttribute('data-sidebar-right-panel', 'push')
  prevPanel.setAttribute('data-sidebar-right-open', '')
  env.doc.body.appendChild(prevPanel)
  reconciler.sync()
  prevPanel.remove()
  mounted.set(undefined)
  reconciler.sync()

  // 1. 发起第一个请求并确认其已真正进入 beginProgrammatic + waitForMountedSession
  const first = env.api.open({ tabId: 'omnimux-workflow:library', title: '项目', timeoutMs: 1000 })
  await firstSubscribed
  assert.equal(activeMountedListeners, 1, '第一个请求必须已订阅 mounted 等待切会话')

  // 2. 在第一个请求等待 mounted 期间发起第二个请求，令两者并发持有程序化锁
  const second = env.api.open({ tabId: 'omnimux-assets:library', title: '资产库', timeoutMs: 1000 })
  await secondSubscribed
  assert.equal(totalSubscribes, 2, '第二个请求也应进入 waitForMountedSession')

  // 3. 此时才完成会话挂载：first 会因 seq 过期先退出并执行 finally { endProgrammatic() }，
  //    但 second 仍处于 120ms (> 80ms) 全屏等待窗口内，programmaticDepth 必须保住程序化锁
  mounted.set('s-lock')
  setSidebarSnapRef?.({ sessionId: 's-lock', state: makeState([]) })

  const [firstOk, secondOk] = await Promise.all([first, second])

  assert.equal(firstOk, false, '被抢占的旧请求应退出')
  assert.equal(secondOk, true, '后一次连点请求应成功')
  assert.equal(closedByReconciler, 0, '旧请求结束不得提前解开程序化锁导致调和器误关面板')
  assert.equal(explicitWrites.length, 0, '程序化进入全屏不得被误记为用户手势 explicit=true')
  assert.equal(persistedCollapsed.length, 0, '程序化进入全屏不得写入用户折叠偏好')
  assert.equal(activeMountedListeners, 0, '过期与完成的 waitForMountedSession 监听均应完全释放')
  reconciler.reset()
})

test('等待全屏按钮期间用户切走会话或退回非会话页时中止全屏进入', async () => {
  let fullscreenClicks = 0
  const env = createHostHarness({
    initialMounted: undefined,
    sessionIds: ['s-a', 's-b'],
    sessionsById: {
      's-a': { id: 's-a', updatedAt: 2000 },
      's-b': { id: 's-b', updatedAt: 1000 },
    },
    workspaces: [{ workspaceId: 'ws-1', path: '/work/a', sessionIds: ['s-a', 's-b'] }],
    domBody: '<div class="dshDesktopFrame"></div>',
    onOpenTab({ seed, scope, setSidebarSnapshot }) {
      setSidebarSnapshot({ sessionId: scope.sessionId, state: makeState([{ id: seed.id, type: seed.type }]) })
      // 模拟等待全屏按钮期间用户突然切到了 s-b（不触发 openRequestSeq 递增）
      setTimeout(() => {
        env.mounted.set('s-b')
        const frame = env.doc.querySelector('.dshDesktopFrame')
        if (!frame) return
        const panel = env.doc.createElement('div')
        panel.setAttribute('data-sidebar-right-panel', 'push')
        panel.setAttribute('data-sidebar-right-open', '')
        const btn = env.doc.createElement('button')
        btn.setAttribute('data-sidebar-right-mode', 'fullscreen')
        btn.addEventListener('click', () => { fullscreenClicks += 1 })
        panel.appendChild(btn)
        frame.appendChild(panel)
      }, 20)
      return undefined
    },
  })

  const ok = await env.api.open({ tabId: 'omnimux-workflow:library', title: '项目', timeoutMs: 400 })
  assert.equal(ok, false, '等待全屏控件期间外部切走会话必须中止提交')
  assert.equal(fullscreenClicks, 0, '不得劫持新会话的官方全屏按钮')

  // 同样验证切回非会话页（mounted -> undefined）也会中止全屏进入
  env.mounted.set(undefined)
  env.doc.querySelector('.dshDesktopFrame').innerHTML = ''
  let leaveClicks = 0
  const env2 = createHostHarness({
    initialMounted: undefined,
    sessionIds: ['s-leave'],
    sessionsById: { 's-leave': { id: 's-leave', updatedAt: 2000 } },
    workspaces: [{ workspaceId: 'ws-1', path: '/work/a', sessionIds: ['s-leave'] }],
    domBody: '<div class="dshDesktopFrame"></div>',
    onOpenTab({ seed, scope, setSidebarSnapshot }) {
      setSidebarSnapshot({ sessionId: scope.sessionId, state: makeState([{ id: seed.id, type: seed.type }]) })
      setTimeout(() => {
        env2.mounted.set(undefined)
        const frame = env2.doc.querySelector('.dshDesktopFrame')
        if (!frame) return
        const panel = env2.doc.createElement('div')
        panel.setAttribute('data-sidebar-right-panel', 'push')
        panel.setAttribute('data-sidebar-right-open', '')
        const btn = env2.doc.createElement('button')
        btn.setAttribute('data-sidebar-right-mode', 'fullscreen')
        btn.addEventListener('click', () => { leaveClicks += 1 })
        panel.appendChild(btn)
        frame.appendChild(panel)
      }, 20)
      return undefined
    },
  })

  const ok2 = await env2.api.open({ tabId: 'omnimux-assets:library', title: '资产库', timeoutMs: 400 })
  assert.equal(ok2, false, '等待全屏控件期间退回非会话页必须中止提交')
  assert.equal(leaveClicks, 0, '退回非会话页后不得再触发全屏按钮')
})

test('recent-active 兜底跳过 DSH 0.2.2-rc.5 中列在 ids 内的持久化 subagent 会话', async () => {
  const env = createHostHarness({
    initialMounted: undefined,
    sessionIds: ['s-subagent-newest', 's-user-normal'],
    sessionsById: {
      's-subagent-newest': { id: 's-subagent-newest', updatedAt: 9999, origin: 'subagent' },
      's-user-normal': { id: 's-user-normal', updatedAt: 1000, origin: 'user' },
    },
    workspaces: [{ workspaceId: 'ws-1', path: '/work/a', sessionIds: ['s-user-normal'] }],
  })

  const ok = await env.api.open({ tabId: 'omnimux-workflow:library', title: '项目', timeoutMs: 500 })
  assert.equal(ok, true)
  assert.deepEqual(
    env.navigated,
    [{ via: 'uiWorkspace.openSession', sessionId: 's-user-normal' }],
    '不得导航进隐藏的 subagent 子会话',
  )
})

test('零会话工作区并发连点只创建一条会话；有工作区但缺 sessions.create 时不误弹添加工作区提示', async () => {
  let createCalls = 0
  let resolveEnteredCreate
  const enteredCreate = new Promise((r) => { resolveEnteredCreate = r })
  let releaseCreate
  const createGate = new Promise((r) => { releaseCreate = r })
  const env = createHostHarness({
    initialMounted: undefined,
    sessionIds: [],
    sessionsById: {},
    workspaces: [{ workspaceId: 'ws-zero', path: '/work/zero', sessionIds: [] }],
    onCreateSession: async (args) => {
      createCalls += 1
      resolveEnteredCreate()
      await createGate
      return `s-coalesced-${args.workspaceId}`
    },
  })

  // 先让 r1 真正进入 sessions.create 在途状态，再发起 r2，才能真实校验同 workspaceId 合并
  const r1Promise = env.api.open({ tabId: 'omnimux-workflow:library', title: '项目', timeoutMs: 500 })
  await enteredCreate
  const r2Promise = env.api.open({ tabId: 'omnimux-assets:library', title: '资产库', timeoutMs: 500 })
  // 等待 r2 走到 resolveTargetSessionForWorkbench 并复用同一在途 Promise
  await new Promise((r) => setTimeout(r, 10))
  releaseCreate()

  const [r1, r2] = await Promise.all([r1Promise, r2Promise])
  assert.equal(createCalls, 1, '并发连点应合并为单次 sessions.create 调用')
  assert.equal(r1, false)
  assert.equal(r2, true)
  assert.equal(env.openedTabs.at(-1)?.seed?.id, 'omnimux-assets:library')

  // 有工作区但宿主未提供 sessions.create（createHostHarness 默认不挂 create）：不得误弹「请先添加工作区」Toast
  const envNoCreate = createHostHarness({
    initialMounted: undefined,
    sessionIds: [],
    sessionsById: {},
    workspaces: [{ workspaceId: 'ws-has', path: '/work/has', sessionIds: [] }],
  })
  const okNoCreate = await envNoCreate.api.open({ tabId: 'omnimux-workflow:library', title: '项目', timeoutMs: 200 })
  assert.equal(okNoCreate, false)
  assert.equal(envNoCreate.doc.getElementById('omnimux-workbench-needs-session'), null, '已有工作区时不得误弹添加工作区提示')
})
