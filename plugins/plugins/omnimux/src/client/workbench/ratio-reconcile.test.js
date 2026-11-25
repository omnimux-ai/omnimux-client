/**
 * 面板宽度协调与把手对齐（Issue #2608 · T04 / 方案 D7-S1′）。
 *
 * 外壳的 `panels.rightbar` 一个字段同时决定三件事：authored 第三轨、拖拽起点
 * （`setRightbar(base − dx)` 是 delta 模型）、右分隔把手位置（`left = viewport − rightbar`）。
 * 因此插件必须维持 `panels.rightbar ≡ 可见舞台 − 比例中栏宽`，否则会出现两种可见缺陷：
 * 缩放后把手与真实列边界错位、缩放后第一次拖拽首帧跳变。
 *
 * 本文件锁住四条边界：写什么值、什么时候绝不写、拿不到外壳句柄时不写、以及
 * 「健康宽度」兜底不得与比例协调写抢同一根轨道。
 */

import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { JSDOM } from 'jsdom'

import {
  ensureHealthySplitWidth,
} from './tab-viewport-reconciler.js'
import { focusRecordForTab } from './focus-state.js'
import { WORKBENCH_FOCUS } from '../../workbench/contract.js'
import {
  bindWorkbenchDeps,
  resetWorkbenchHostAdapter,
  setAttachedStore,
} from './host-adapter.js'
import {
  reconcileRightbarFromRatio,
  resetWorkbenchWidthMemory,
  resetSplitReconciliationForTests,
} from './split-layout.js'
import { installRightbarStateMirror } from './rightbar-state-mirror.js'
import {
  installSidebarToggleTopbar,
  setTopbarGeometryHook,
} from '../sidebar-toggle-topbar.js'
import {
  resetConversationCollapseForTests,
} from '../conversation-collapse.js'
import { resetWorkspaceLayoutStoreForTests, writeChatRatio } from './workspace-layout-store.js'

const RAIL_PX = 280
const RATIO = 0.3
const SESSION_ID = 's-2608'
const TAB_ID = 'omnimux-workflow:canvas'

/** @type {{ window: unknown, document: unknown, HTMLElement: unknown }} */
const previous = {
  window: globalThis.window,
  document: globalThis.document,
  HTMLElement: globalThis.HTMLElement,
}

/**
 * 外壳 layout 句柄的最小替身：只保留协调写真正用到的读面与写面。
 * `setRightbar` 记录调用参数，便于断言「写了几次、写了多少、用哪个视口夹紧」。
 */
function createShellLayout({ rightbar = null, rightbarShown = true, rightbarTrack = true, rightbarFullscreen = false } = {}) {
  const state = { rightbar, rightbarShown, rightbarTrack, rightbarFullscreen }
  return {
    calls: [],
    getSnapshot: () => ({ ...state }),
    setRightbar(width, viewport) {
      this.calls.push({ width, viewport })
      state.rightbar = Math.round(width)
    },
  }
}

function makeState({ panelOpen = true, width = 1148 } = {}) {
  return {
    panelOpen,
    width,
    activePane: 'pane-1',
    splits: { kind: 'split', children: [{ kind: 'leaf', id: 'pane-1', active: TAB_ID, tabs: [{ id: TAB_ID, type: TAB_ID }] }] },
  }
}

function setupWindow(viewportPx) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div class="dshDesktopFrame">
      <aside class="dshDesktopSidebarSurface"></aside>
      <main class="dshDesktopConversationSurface"></main>
    </div>
  </body></html>`, {
    url: 'http://127.0.0.1/',
  })
  Object.defineProperty(dom.window, 'innerWidth', { value: viewportPx, configurable: true, writable: true })
  // jsdom 不做布局，实测宽度恒为 0；左栏轨道必须能被量到，否则几何退化成「视口 = 舞台」。
  const sidebarColumn = dom.window.document.querySelector('.dshDesktopSidebarSurface')
  sidebarColumn.getBoundingClientRect = () => ({ width: RAIL_PX, height: 800, top: 0, left: 0, right: RAIL_PX, bottom: 800 })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.HTMLElement = dom.window.HTMLElement
  return dom
}

beforeEach(() => {
  resetWorkbenchHostAdapter()
  resetWorkbenchWidthMemory()
  resetSplitReconciliationForTests()
  resetConversationCollapseForTests()
  resetWorkspaceLayoutStoreForTests()
})

afterEach(() => {
  resetWorkbenchHostAdapter()
  resetWorkbenchWidthMemory()
  resetSplitReconciliationForTests()
  resetConversationCollapseForTests()
  resetWorkspaceLayoutStoreForTests()
  if (previous.window === undefined) delete globalThis.window
  else globalThis.window = previous.window
  if (previous.document === undefined) delete globalThis.document
  else globalThis.document = previous.document
  if (previous.HTMLElement === undefined) delete globalThis.HTMLElement
  else globalThis.HTMLElement = previous.HTMLElement
})

describe('T04 面板宽度协调（D7-S1′）', () => {
  it('writes the physical remainder of the visible stage into the shell panel width', () => {
    setupWindow(1920)
    const layout = createShellLayout()
    bindWorkbenchDeps({ layout })
    focusRecordForTab(SESSION_ID, TAB_ID).mode = WORKBENCH_FOCUS.split

    const verdict = reconcileRightbarFromRatio(makeState(), {
      sessionId: SESSION_ID,
      officialSidebarWidth: RAIL_PX,
      chatRatio: RATIO,
    })

    assert.equal(verdict, 'written')
    assert.equal(layout.calls.length, 1)
    // 1920 − 280（舞台 1640）× 30% = 492 中栏 → 右栏拿 1640 − 492 = 1148。
    assert.equal(layout.calls[0].width, 1148)
    assert.equal(layout.calls[0].viewport, 1920, '夹紧视口必须与外壳同口径（frame 实测宽，退化时取窗口宽）')
  })

  it('is idempotent: a second reconcile with the same geometry writes nothing', () => {
    setupWindow(1920)
    const layout = createShellLayout()
    bindWorkbenchDeps({ layout })
    focusRecordForTab(SESSION_ID, TAB_ID).mode = WORKBENCH_FOCUS.split
    const env = { sessionId: SESSION_ID, officialSidebarWidth: RAIL_PX, chatRatio: RATIO }

    assert.equal(reconcileRightbarFromRatio(makeState(), env), 'written')
    assert.equal(reconcileRightbarFromRatio(makeState(), env), 'consistent')
    assert.equal(layout.calls.length, 1, '几何不变时不得重复写外壳面板宽（与 frame 观察者形成自激）')
  })

  it('follows the viewport on resize, keeping the three columns summing to the viewport', () => {
    const dom = setupWindow(1920)
    const layout = createShellLayout()
    bindWorkbenchDeps({ layout })
    focusRecordForTab(SESSION_ID, TAB_ID).mode = WORKBENCH_FOCUS.split
    const env = { sessionId: SESSION_ID, officialSidebarWidth: RAIL_PX, chatRatio: RATIO }

    reconcileRightbarFromRatio(makeState(), env)
    assert.equal(layout.calls.at(-1).width, 1148)

    // 1920 → 2560：中栏 492 → 684，右栏 1148 → 1596，三栏之和 = 视口。
    Object.defineProperty(dom.window, 'innerWidth', { value: 2560, configurable: true, writable: true })
    assert.equal(reconcileRightbarFromRatio(makeState(), env), 'written')
    assert.equal(layout.calls.at(-1).width, 1596)
    assert.equal(RAIL_PX + 684 + 1596, 2560, '任一时刻三栏之和必须等于视口')

    // 2560 → 1440：中栏被 360px 下限夹住，右栏拿物理余量 1160 − 360 = 800。
    Object.defineProperty(dom.window, 'innerWidth', { value: 1440, configurable: true, writable: true })
    assert.equal(reconcileRightbarFromRatio(makeState(), env), 'written')
    assert.equal(layout.calls.at(-1).width, 800)
    assert.equal(RAIL_PX + 360 + 800, 1440, '小屏同样不得留下黑边死区')
  })

  it('leaves the shell panel width equal to the real column boundary, so a drag right after a resize starts without a jump', () => {
    const dom = setupWindow(1920)
    const layout = createShellLayout()
    bindWorkbenchDeps({ layout })
    focusRecordForTab(SESSION_ID, TAB_ID).mode = WORKBENCH_FOCUS.split
    const env = { sessionId: SESSION_ID, officialSidebarWidth: RAIL_PX, chatRatio: RATIO }

    Object.defineProperty(dom.window, 'innerWidth', { value: 2560, configurable: true, writable: true })
    reconcileRightbarFromRatio(makeState(), env)

    // 外壳拖拽以 `panels.rightbar` 为起点（delta 模型）：起点必须就是真实列边界。
    const snapshot = layout.getSnapshot()
    const conversationPx = 684
    assert.equal(
      snapshot.rightbar,
      2560 - RAIL_PX - conversationPx,
      '缩放后立即拖拽时，外壳起点必须等于「视口 − 左栏 − 中栏」，否则首帧跳变',
    )
  })

  it('never writes while the shell splitter is being dragged', () => {
    const dom = setupWindow(1920)
    dom.window.document.body.setAttribute('data-dsh-sidebar-dragging', '')
    const layout = createShellLayout()
    bindWorkbenchDeps({ layout })
    focusRecordForTab(SESSION_ID, TAB_ID).mode = WORKBENCH_FOCUS.split

    assert.equal(
      reconcileRightbarFromRatio(makeState(), { sessionId: SESSION_ID, officialSidebarWidth: RAIL_PX, chatRatio: RATIO }),
      'skipped',
    )
    assert.equal(layout.calls.length, 0, '拖拽期外壳 authored 几何是权威，代写面板宽会与指针抢同一根轨道')
  })

  it('skips the single-column states that are not ratio-driven (D6)', () => {
    setupWindow(1920)
    const layout = createShellLayout()
    bindWorkbenchDeps({ layout })
    focusRecordForTab(SESSION_ID, TAB_ID).mode = WORKBENCH_FOCUS.split
    const env = { sessionId: SESSION_ID, officialSidebarWidth: RAIL_PX, chatRatio: RATIO }

    assert.equal(reconcileRightbarFromRatio(makeState({ panelOpen: false }), env), 'skipped', '面板收起时不写')

    const guiLayout = createShellLayout()
    bindWorkbenchDeps({ layout: guiLayout })
    focusRecordForTab(SESSION_ID, TAB_ID).mode = WORKBENCH_FOCUS.gui
    assert.equal(reconcileRightbarFromRatio(makeState(), env), 'skipped', 'gui 全屏单栏态不比例化')
    assert.equal(guiLayout.calls.length, 0)

    // 右栏处于全屏（overlay）时也不写：那时面板不占网格轨道。
    bindWorkbenchDeps({ layout: createShellLayout({ rightbarFullscreen: true }) })
    focusRecordForTab(SESSION_ID, TAB_ID).mode = WORKBENCH_FOCUS.split
    assert.equal(reconcileRightbarFromRatio(makeState(), env), 'skipped')
  })

  it('skips when the shell layout handle is unavailable instead of guessing geometry', () => {
    setupWindow(1920)
    bindWorkbenchDeps({ layout: null })
    focusRecordForTab(SESSION_ID, TAB_ID).mode = WORKBENCH_FOCUS.split

    assert.equal(
      reconcileRightbarFromRatio(makeState(), { sessionId: SESSION_ID, officialSidebarWidth: RAIL_PX, chatRatio: RATIO }),
      'skipped',
    )
  })

  it('never writes while the shell divider is being dragged (INV-16)', () => {
    const dom = setupWindow(1920)
    const layout = createShellLayout()
    bindWorkbenchDeps({ layout })
    focusRecordForTab(SESSION_ID, TAB_ID).mode = WORKBENCH_FOCUS.split

    // 外壳右分隔线拖拽把 `[data-dragging]` 打在 frame / 手柄上，而不是工作台面板上：
    // 只看 `isWorkbenchPanelDragging`（面板级）会漏判，于是拖拽进行中仍写面板宽、与指针抢轨道。
    dom.window.document.querySelector('.dshDesktopFrame').setAttribute('data-dragging', '')

    assert.equal(
      reconcileRightbarFromRatio(makeState(), { sessionId: SESSION_ID, officialSidebarWidth: RAIL_PX, chatRatio: RATIO }),
      'skipped',
      '外壳拖拽期绝不写 panels.rightbar（INV-16）',
    )
    assert.equal(layout.calls.length, 0)
  })

  it('reads the persisted ratio so the panel matches the published conversation column', () => {
    const dom = setupWindow(1920)
    writeChatRatio(0.5)
    const layout = createShellLayout()
    bindWorkbenchDeps({ layout })
    focusRecordForTab(SESSION_ID, TAB_ID).mode = WORKBENCH_FOCUS.split

    // 不注入 chatRatio：协调写必须与顶栏走同一个持久化真源，否则两侧算的是两个比例。
    assert.equal(reconcileRightbarFromRatio(makeState(), { sessionId: SESSION_ID, officialSidebarWidth: RAIL_PX }), 'written')
    assert.equal(layout.calls.at(-1).width, 1640 - 820, '舞台 1640 × 50% = 820 中栏 → 右栏 820')
    assert.ok(dom.window.localStorage.getItem('omnimux.conversationRatio'))
  })

  it('keeps the legacy healthy-width fallback from fighting the ratio writer', () => {
    setupWindow(1920)
    const layout = createShellLayout({ rightbar: 300 })
    bindWorkbenchDeps({ layout })
    // 生产路径里状态来自已 attach 的 tab store；健康宽度兜底同样读它。
    setAttachedStore({ getSnapshot: () => ({ sessionId: SESSION_ID, state: makeState() }) })
    focusRecordForTab(SESSION_ID, TAB_ID).mode = WORKBENCH_FOCUS.split
    writeChatRatio(RATIO)

    ensureHealthySplitWidth(globalThis.document)

    assert.equal(layout.calls.length, 1, '健康宽度兜底不得在比例权威适用时另写一次')
    assert.equal(layout.calls[0].width, 1148, '写进去的必须是比例余量，而不是视口 45% 的健康宽度')
  })

  it('falls back to the healthy width only when no ratio authority applies', () => {
    setupWindow(1920)
    const layout = createShellLayout({ rightbar: 300, rightbarShown: false })
    bindWorkbenchDeps({ layout })
    setAttachedStore({ getSnapshot: () => ({ sessionId: SESSION_ID, state: makeState() }) })
    focusRecordForTab(SESSION_ID, TAB_ID).mode = WORKBENCH_FOCUS.split

    ensureHealthySplitWidth(globalThis.document)

    // 面板未展开：比例权威不适用，此时才允许走「健康宽度」兜底（视口 45% 且不低于 500）。
    assert.equal(layout.calls.length, 1)
    assert.equal(layout.calls[0].width, Math.max(500, Math.round(1920 * 0.45)))
  })
})

function setupNextShellWindow(viewportPx) {
  const dom = setupWindow(viewportPx)
  dom.window.document.documentElement.setAttribute('data-platform', 'darwin')
  dom.window.document.body.innerHTML = `
    <div class="vcssFG_frame">
      <div class="vcssFG_sidebarCol"></div>
      <div class="vcssFG_centerCol"></div>
      <div class="vcssFG_rightbarCol" data-rightbar-col="true">
        <div class="Ng7Ira_panel" data-sidebar-right-panel="push" data-sidebar-right-open="true"></div>
      </div>
    </div>`
  const frame = dom.window.document.querySelector('.vcssFG_frame')
  frame.getBoundingClientRect = () => ({ width: viewportPx, height: 1080, top: 0, left: 0, right: viewportPx, bottom: 1080 })
  const sidebarColumn = dom.window.document.querySelector('.vcssFG_sidebarCol')
  sidebarColumn.getBoundingClientRect = () => ({ width: RAIL_PX, height: 1080, top: 0, left: 0, right: RAIL_PX, bottom: 1080 })
  return dom
}

describe('Next 壳（DSH 0.2.2-rc.5 + DP-007）面板宽度协调与 Fiber 兜底', () => {
  it('reconciles 1728px Next shell default 45% seed (778px) to target 1014px via DP-007 1-arg setRightbar', () => {
    setupNextShellWindow(1728)
    const calls = []
    const state = {
      sidebar: 280,
      viewportWidth: 1728,
      narrowExpanded: false,
      rightbar: 778,
      rightbarAuthored: false,
      rightbarShown: true,
      rightbarTrack: true,
      rightbarFullscreen: false,
      rightbarInstant: false,
    }
    const nextLayout = {
      getSnapshot: () => ({ ...state }),
      setRightbar(px) {
        calls.push(px)
        state.rightbar = Math.round(px)
        state.rightbarAuthored = true
      },
    }
    bindWorkbenchDeps({ layout: nextLayout })
    focusRecordForTab(SESSION_ID, TAB_ID).mode = WORKBENCH_FOCUS.split

    const verdict = reconcileRightbarFromRatio(makeState({ width: 778 }), {
      sessionId: SESSION_ID,
      officialSidebarWidth: RAIL_PX,
      chatRatio: RATIO,
    })

    // 1728 - 280 = 1448 -> chat 434 -> target rightbar 1014 (eliminates 236px dead zone & handle drift).
    assert.equal(verdict, 'written')
    assert.deepEqual(calls, [1014])
    assert.equal(nextLayout.getSnapshot().rightbar, 1014)
    assert.equal(reconcileRightbarFromRatio(makeState({ width: 1014 }), {
      sessionId: SESSION_ID,
      officialSidebarWidth: RAIL_PX,
      chatRatio: RATIO,
    }), 'consistent')
  })

  it('resolves Next AppFrame memoizedProps.actions.setRightbar via React Fiber fallback when deps.layout is null', () => {
    const dom = setupNextShellWindow(1728)
    const frame = dom.window.document.querySelector('.vcssFG_frame')
    const actionCalls = []
    const actions = {
      setRightbar(px) {
        actionCalls.push(px)
      },
    }
    frame.__reactFiber$next = {
      memoizedProps: {},
      return: {
        memoizedProps: { actions },
        return: null,
      },
    }
    bindWorkbenchDeps({ layout: null })
    focusRecordForTab(SESSION_ID, TAB_ID).mode = WORKBENCH_FOCUS.split

    const verdict = reconcileRightbarFromRatio(makeState({ width: 778 }), {
      sessionId: SESSION_ID,
      officialSidebarWidth: RAIL_PX,
      chatRatio: RATIO,
    })
    assert.equal(verdict, 'written')
    assert.deepEqual(actionCalls, [1014])
    // Second call with identical target must stay deduped because actions reference is stable.
    assert.equal(reconcileRightbarFromRatio(makeState({ width: 1014 }), {
      sessionId: SESSION_ID,
      officialSidebarWidth: RAIL_PX,
      chatRatio: RATIO,
    }), 'consistent')
    assert.equal(actionCalls.length, 1)
  })

  it('ensureHealthySplitWidth reaches Fiber fallback on Next AppFrame DOM without .dshDesktopFrame', () => {
    const dom = setupNextShellWindow(1728)
    const frame = dom.window.document.querySelector('.vcssFG_frame')
    const calls = []
    const handle = {
      getSnapshot: () => ({ rightbar: 300, rightbarShown: false }),
      setRightbar(px) {
        calls.push(px)
      },
    }
    frame.__reactFiber$next = {
      memoizedProps: { layout: handle },
      return: null,
    }
    bindWorkbenchDeps({ layout: null })
    setAttachedStore({ getSnapshot: () => ({ sessionId: SESSION_ID, state: makeState() }) })
    focusRecordForTab(SESSION_ID, TAB_ID).mode = WORKBENCH_FOCUS.split

    ensureHealthySplitWidth(dom.window.document)
    assert.deepEqual(calls, [Math.max(500, Math.round(1728 * 0.45))])
  })

  it('installRightbarStateMirror fires onStateChange and reconciles with state=undefined even when betterSidebar is unattached', async () => {
    const dom = setupNextShellWindow(1728)
    const panel = dom.window.document.querySelector('.Ng7Ira_panel')
    panel.removeAttribute('data-sidebar-right-open')
    const state = {
      sidebar: 280,
      viewportWidth: 1728,
      narrowExpanded: false,
      rightbar: 778,
      rightbarAuthored: false,
      rightbarShown: false,
      rightbarTrack: false,
      rightbarFullscreen: false,
      rightbarInstant: false,
    }
    const calls = []
    setAttachedStore(null)
    bindWorkbenchDeps({
      layout: {
        getSnapshot: () => ({ ...state }),
        setRightbar(px) {
          calls.push(px)
          state.rightbar = Math.round(px)
          state.rightbarAuthored = true
        },
      },
    })

    const stop = installRightbarStateMirror(dom.window.document, {
      onStateChange: (mirrorState, targetDoc) => {
        if (mirrorState.open && !mirrorState.fullscreen) {
          reconcileRightbarFromRatio(undefined, {
            doc: targetDoc,
            officialSidebarWidth: RAIL_PX,
            chatRatio: RATIO,
          })
        }
      },
    })
    try {
      assert.deepEqual(calls, [], 'closed panel must not reconcile')
      assert.equal(
        reconcileRightbarFromRatio(undefined, { doc: dom.window.document, officialSidebarWidth: RAIL_PX, chatRatio: RATIO }),
        'skipped',
        'state=undefined must still skip while rightbar is closed',
      )
      state.rightbarShown = true
      state.rightbarTrack = true
      panel.setAttribute('data-sidebar-right-open', 'true')
      await new Promise((r) => setTimeout(r, 20))
      assert.deepEqual(calls, [1014], 'opening native Next panel must reconcile rightbar to 1014px without betterSidebar attached')
    } finally {
      stop()
    }
  })

  it('retries rightbar reconcile once stale store viewportWidth catches up after a window-grow race', () => {
    const dom = setupNextShellWindow(1920)
    const storeState = {
      sidebar: 280,
      viewportWidth: 1200,
      narrowExpanded: false,
      rightbar: 540,
      rightbarAuthored: false,
      rightbarShown: true,
      rightbarTrack: true,
      rightbarFullscreen: false,
      rightbarInstant: false,
    }
    const writes = []
    bindWorkbenchDeps({
      layout: {
        getSnapshot: () => ({ ...storeState }),
        // Simulate a 1-arg store that clamps against its own stale viewportWidth until ResizeObserver commits 1920.
        setRightbar(px) {
          writes.push(px)
          storeState.rightbar = Math.min(Math.round(storeState.viewportWidth * 0.7), Math.max(300, Math.round(px)))
        },
      },
    })
    setAttachedStore(null)

    const env = { doc: dom.window.document, officialSidebarWidth: RAIL_PX, chatRatio: RATIO }
    // First call during window.resize before ResizeObserver: store clamps 1148 to 840 (1200 * 0.7).
    assert.equal(reconcileRightbarFromRatio(undefined, env), 'written')
    assert.equal(storeState.rightbar, 840)
    // Once ResizeObserver commits viewportWidth = 1920, reconcile must NOT stay stuck on stale dedup cache.
    storeState.viewportWidth = 1920
    assert.equal(reconcileRightbarFromRatio(undefined, env), 'written')
    assert.equal(storeState.rightbar, 1148)
    assert.deepEqual(writes, [1148, 1148])
    assert.equal(reconcileRightbarFromRatio(undefined, env), 'consistent')
  })

  it('installRightbarStateMirror cleanup cancels pending scheduled callback so onStateChange does not fire after dispose', async () => {
    const dom = setupNextShellWindow(1728)
    const panel = dom.window.document.querySelector('.Ng7Ira_panel')
    panel.removeAttribute('data-sidebar-right-open')
    const events = []
    const stop = installRightbarStateMirror(dom.window.document, {
      onStateChange: (mirrorState) => {
        events.push(mirrorState.open)
      },
    })
    assert.deepEqual(events, [false], 'initial sync emits closed state once')
    panel.setAttribute('data-sidebar-right-open', 'true')
    stop()
    await new Promise((r) => setTimeout(r, 20))
    assert.deepEqual(events, [false], 'disposed mirror must not deliver scheduled callback after stop()')
  })

  it('reconciles rightbar handle width when left rail collapses/expands via topbar geometry hook', async () => {
    const dom = setupNextShellWindow(1728)
    const frame = dom.window.document.querySelector('.vcssFG_frame')
    const sidebarCol = dom.window.document.querySelector('.vcssFG_sidebarCol')
    const topStrip = dom.window.document.createElement('div')
    topStrip.className = 'vcssFG_topStrip'
    topStrip.getBoundingClientRect = () => ({ width: 280, height: 40, top: 0, left: 0, right: 280, bottom: 40 })
    sidebarCol.appendChild(topStrip)
    sidebarCol.getBoundingClientRect = () => ({
      width: frame.hasAttribute('data-sidebar-collapsed') ? 0 : RAIL_PX,
      height: 1080,
      top: 0,
      left: 0,
      right: frame.hasAttribute('data-sidebar-collapsed') ? 0 : RAIL_PX,
      bottom: 1080,
    })
    writeChatRatio(0.41022)
    const storeState = {
      sidebar: 280,
      viewportWidth: 1728,
      narrowExpanded: false,
      rightbar: 854,
      rightbarAuthored: true,
      rightbarShown: true,
      rightbarTrack: true,
      rightbarFullscreen: false,
      rightbarInstant: false,
    }
    const calls = []
    setAttachedStore(null)
    bindWorkbenchDeps({
      layout: {
        getSnapshot: () => ({ ...storeState }),
        setRightbar(px) {
          calls.push(px)
          storeState.rightbar = Math.round(px)
        },
      },
    })

    const unsubTopbar = installSidebarToggleTopbar(dom.window.document)
    setTopbarGeometryHook((targetDoc) => { reconcileRightbarFromRatio(undefined, { doc: targetDoc }) })
    try {
      frame.setAttribute('data-sidebar-collapsed', 'true')
      await new Promise((r) => setTimeout(r, 30))
      assert.equal(storeState.rightbar, 1134, 'left rail collapse must expand rightbar target by 280px so handle stays aligned')

      frame.removeAttribute('data-sidebar-collapsed')
      await new Promise((r) => setTimeout(r, 30))
      assert.equal(storeState.rightbar, 854, 'left rail re-expand must restore expanded rightbar target')
      assert.equal(calls.length, 2)
    } finally {
      setTopbarGeometryHook(null)
      unsubTopbar()
    }
  })
})
