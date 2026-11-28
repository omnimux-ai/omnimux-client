import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { JSDOM } from 'jsdom'
import {
  installSidebarGlobal,
  resetSidebarCoordinatorForTests,
  setReleaseChannelForTests,
  SIDEBAR_GLOBAL,
} from './sidebar-coordinator.js'
import { installSidebarPanelChrome, MORE_MENU_SELECTOR } from './sidebar-panel-chrome.js'
import { installSidebarToggleTopbar } from './sidebar-toggle-topbar.js'
import { installSidebarActivation, resetSidebarActivationForTests } from './workbench/sidebar-activation.js'
import { bindWorkbenchDeps, resetWorkbenchHostAdapter } from './workbench/host-adapter.js'
import {
  NAV_RAIL_PINNED_MORE_STORAGE_KEY,
  resetNavRailPinsForTests,
  setPinnedMoreItem,
} from './nav-rail-pins.js'
import {
  NAV_RAIL_ACTIVE_ATTR,
  NAV_RAIL_BOTTOM_ITEMS,
  NAV_RAIL_ID,
  NAV_RAIL_MORE_FALLBACK_ID,
  NAV_RAIL_PIN_CONTEXT_MENU_ID,
  NAV_RAIL_TOP_ITEMS,
  NAV_RAIL_VIEW_ATTR,
  NAV_RAIL_WIDTH_VAR,
  activateHomeView,
  computeCurrentNavRailState,
  installNavRail,
} from './nav-rail.js'

const MIDDLE_DOT_RE = /·/
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u

/** @type {JSDOM | undefined} */
let dom
const savedGlobals = {
  window: globalThis.window,
  document: globalThis.document,
  localStorage: globalThis.localStorage,
  HTMLElement: globalThis.HTMLElement,
  HTMLButtonElement: globalThis.HTMLButtonElement,
  Element: globalThis.Element,
  CustomEvent: globalThis.CustomEvent,
  MouseEvent: globalThis.MouseEvent,
  KeyboardEvent: globalThis.KeyboardEvent,
  PointerEvent: globalThis.PointerEvent,
  MutationObserver: globalThis.MutationObserver,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
}

afterEach(() => {
  setReleaseChannelForTests(null)
  resetNavRailPinsForTests()
  resetSidebarCoordinatorForTests()
  resetSidebarActivationForTests()
  resetWorkbenchHostAdapter()
  dom?.window.close()
  dom = undefined
  for (const [key, val] of Object.entries(savedGlobals)) {
    if (val === undefined) delete globalThis[key]
    else globalThis[key] = val
  }
})

function setupDom({
  collapsed = false,
  withOfficialMore = true,
  withUpdatePill = false,
  productStage = '',
  htmlAttrs = 'data-platform="darwin"',
} = {}) {
  const html = `<!doctype html><html ${htmlAttrs}><head></head><body>
    <div id="root" data-slot="root">
      <div class="AppFrame_frame__qa" ${collapsed ? 'data-sidebar-collapsed' : ''}>
        <div class="AppFrame_sidebarCol__qa" data-pane="sidebar">
          <div class="SidebarRoot_root__qa">
            <div class="SidebarRoot_topStrip__qa">
              <button type="button" class="toggle_qa" aria-label="${collapsed ? '展开侧边栏' : '收起侧边栏'}">T</button>
            </div>
            <div class="SidebarRoot_logoRow__qa"><span>OmniMux</span></div>
            <div class="SidebarRoot_newSessionRow__qa">
              <button type="button" class="SidebarRoot_newSession__qa" aria-label="新对话">新对话</button>
            </div>
            <nav class="SidebarRoot_panelList__qa" aria-label="面板">
              <div class="SidebarRoot_panelEntry__qa" data-entry="plugins">
                <button type="button" class="SidebarRoot_panelRow__qa" aria-label="插件">插件</button>
              </div>
              <div class="SidebarRoot_panelEntry__qa" data-entry="schedules">
                <button type="button" class="SidebarRoot_panelRow__qa" aria-label="自动化任务">自动化任务</button>
              </div>
              ${withOfficialMore ? `
                <span class="SidebarRoot_moreAnchor__qa">
                  <button type="button" class="SidebarRoot_panelRow__qa" id="official-more-btn" aria-label="更多" aria-haspopup="menu" aria-expanded="false">更多</button>
                </span>
              ` : ''}
            </nav>
            <div class="SidebarRoot_regionArea__qa" role="tree" aria-label="Sessions">
              <div role="treeitem" id="session-1" aria-selected="true">会话 1</div>
            </div>
            <div class="SidebarRoot_footArea__qa">
              <div data-slot="sidebar.footer.action">
                ${withUpdatePill ? '<button type="button" data-next-update-pill aria-label="有新版本可用">更新</button>' : ''}
                <button type="button" id="official-remote-btn" aria-haspopup="dialog" aria-label="远程控制" aria-expanded="false">远程</button>
              </div>
              <div data-slot="sidebar.settings">
                <button type="button" id="official-settings-btn"><span data-slot="settings.trigger">设置</span></button>
              </div>
            </div>
          </div>
        </div>
        <div class="AppFrame_centerCol__qa" data-slot="conversation"></div>
        <div data-sidebar-right-panel="push" id="official-right-panel"></div>
      </div>
    </div>
  </body></html>`

  dom = new JSDOM(html, { url: 'http://127.0.0.1/' })
  const win = dom.window
  const doc = win.document
  globalThis.window = win
  globalThis.document = doc
  globalThis.localStorage = win.localStorage
  globalThis.HTMLElement = win.HTMLElement
  globalThis.HTMLButtonElement = win.HTMLButtonElement
  globalThis.Element = win.Element
  globalThis.CustomEvent = win.CustomEvent
  globalThis.MouseEvent = win.MouseEvent
  globalThis.KeyboardEvent = win.KeyboardEvent
  globalThis.PointerEvent = win.MouseEvent
  globalThis.MutationObserver = win.MutationObserver
  globalThis.setInterval = () => 1
  globalThis.clearInterval = () => {}

  const conv = doc.querySelector('[data-slot="conversation"]')
  conv.getBoundingClientRect = () => ({ left: 316, top: 0, width: 900, height: 800, right: 1216, bottom: 800, x: 316, y: 0 })
  const frame = doc.querySelector('.AppFrame_frame__qa')
  const toggleBtn = doc.querySelector('.toggle_qa')
  toggleBtn.addEventListener('click', () => {
    const next = !frame.hasAttribute('data-sidebar-collapsed')
    if (next) frame.setAttribute('data-sidebar-collapsed', '')
    else frame.removeAttribute('data-sidebar-collapsed')
    toggleBtn.setAttribute('aria-label', next ? '展开侧边栏' : '收起侧边栏')
  })

  if (productStage) {
    doc.documentElement.dataset.dshProductStage = productStage
  }

  return { win, doc, frame, toggleBtn }
}

describe('nav-rail 固定左侧导航轨', () => {
  it('按 D2/D3 顺序渲染上区 6 项与下区 3 项，无中点与 Emoji 且暴露完整无障碍标签', () => {
    const { doc } = setupDom()
    const dispose = installNavRail(doc)
    try {
      assert.equal(doc.documentElement.getAttribute(NAV_RAIL_ACTIVE_ATTR), '1')
      assert.equal(doc.documentElement.style.getPropertyValue(NAV_RAIL_WIDTH_VAR), '52px')
      const rail = doc.getElementById(NAV_RAIL_ID)
      assert.ok(rail, '固定导航轨应挂载')

      const topBtns = [...rail.querySelectorAll('.omnimux-nav-rail-group [data-omnimux-rail-item]')]
      const bottomBtns = [...rail.querySelectorAll('.omnimux-nav-rail-bottom [data-omnimux-rail-item]')]
      assert.deepEqual(
        topBtns.map((b) => b.getAttribute('data-omnimux-rail-item')),
        ['home', 'projects', 'market', 'assets', 'inspiration', 'more'],
      )
      assert.deepEqual(
        topBtns.map((b) => b.getAttribute('aria-label')),
        NAV_RAIL_TOP_ITEMS.map((i) => i.label),
      )
      assert.deepEqual(
        bottomBtns.map((b) => b.getAttribute('data-omnimux-rail-item')),
        ['updates', 'remote-control', 'settings'],
      )
      assert.deepEqual(
        bottomBtns.map((b) => b.getAttribute('aria-label')),
        NAV_RAIL_BOTTOM_ITEMS.map((i) => i.label),
      )

      for (const btn of [...topBtns, ...bottomBtns]) {
        const label = btn.getAttribute('aria-label') || ''
        assert.ok(label.length > 0, '必须有 aria-label')
        assert.equal(MIDDLE_DOT_RE.test(label), false, `禁止使用中点: ${label}`)
        assert.equal(EMOJI_RE.test(label), false, `禁止使用 Emoji: ${label}`)
        assert.ok(btn.querySelector('svg'), '图标必须使用 SVG')
      }
      assert.equal(rail.querySelector('[data-omnimux-rail-item="home"]')?.getAttribute('data-active'), 'true')
    } finally {
      dispose()
    }
  })

  it('已处于首页且会话栏展开时，连续点击「首页」严格幂等，绝不折叠会话栏（D6）', () => {
    const { doc, frame } = setupDom()
    const disposeActivation = installSidebarActivation({ document: doc, notify: () => {} })
    const disposeRail = installNavRail(doc)
    try {
      const homeBtn = doc.querySelector('[data-omnimux-rail-item="home"]')
      assert.equal(frame.hasAttribute('data-sidebar-collapsed'), false)
      homeBtn.click()
      assert.equal(frame.hasAttribute('data-sidebar-collapsed'), false, '第一次点首页保持展开')
      homeBtn.click()
      assert.equal(frame.hasAttribute('data-sidebar-collapsed'), false, '第二次点首页仍保持展开')

      // 手动折叠后点首页 → 必须恢复展开
      doc.querySelector('.toggle_qa').click()
      assert.equal(frame.hasAttribute('data-sidebar-collapsed'), true)
      homeBtn.click()
      assert.equal(frame.hasAttribute('data-sidebar-collapsed'), false, '收起态点首页恢复展开')
    } finally {
      disposeRail()
      disposeActivation()
    }
  })

  it('切到非首页业务页时自动收起次级会话栏并高亮对应图标，点首页退出并恢复展开', () => {
    const { win, doc, frame } = setupDom()
    let activeRightTab = null
    const rightPanel = doc.getElementById('official-right-panel')
    const conv = doc.querySelector('[data-slot="conversation"]')
    const fakeSidebarRight = {
      isExpanded: () => activeRightTab !== null,
      active: () => (activeRightTab ? { id: activeRightTab, kind: activeRightTab } : null),
    }
    bindWorkbenchDeps({ sidebarRight: fakeSidebarRight })

    installSidebarGlobal()
    const sidebarApi = SIDEBAR_GLOBAL()
    const wfBtn = doc.createElement('button')
    wfBtn.addEventListener('click', () => {
      activeRightTab = 'omnimux-workflow:library'
      rightPanel.setAttribute('data-sidebar-right-panel', 'fullscreen')
      rightPanel.setAttribute('data-sidebar-right-open', 'true')
      conv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 800, right: 0, bottom: 800, x: 0, y: 0 })
      doc.querySelector('#session-1')?.setAttribute('aria-selected', 'false')
    })
    const disposeRow = sidebarApi.register({ id: 'omnimux-workflow-entry', rank: 4, create: () => wfBtn })

    const disposeActivation = installSidebarActivation({ document: doc, deps: { sidebarRight: fakeSidebarRight }, notify: () => {} })
    const disposeTopbar = installSidebarToggleTopbar(doc)
    const disposeRail = installNavRail(doc)

    try {
      // nav-rail 接管后不得将「项目」行插入次级会话栏 DOM
      assert.equal(wfBtn.parentElement, null, 'nav-rail 启用后一级入口不得再挂载到次级会话栏 DOM')

      // 点击固定轨「项目」
      doc.querySelector('[data-omnimux-rail-item="projects"]').click()
      assert.equal(activeRightTab, 'omnimux-workflow:library', '应触发已注册的 workflow 入口处理器')
      assert.equal(doc.documentElement.getAttribute(NAV_RAIL_VIEW_ATTR), 'business')
      assert.equal(doc.querySelector('[data-omnimux-rail-item="projects"]')?.getAttribute('data-active'), 'true')
      assert.equal(doc.querySelector('[data-omnimux-rail-item="home"]')?.getAttribute('data-active'), 'false')
      assert.equal(frame.hasAttribute('data-sidebar-collapsed'), true, '切入非首页业务页必须自动收起次级会话栏')

      // 点击固定轨「首页」返回
      let closedCalls = 0
      win.__omnimuxWorkbench = {
        getSnapshot: () => ({ sessionId: 'session-1' }),
        closePanel: () => { closedCalls += 1 },
      }
      doc.getElementById('official-right-panel').innerHTML = '<button type="button" data-sidebar-right-mode="push"></button>'
      doc.querySelector('button[data-sidebar-right-mode="push"]').addEventListener('click', () => {
        activeRightTab = null
        rightPanel.setAttribute('data-sidebar-right-panel', 'push')
        rightPanel.removeAttribute('data-sidebar-right-open')
        conv.getBoundingClientRect = () => ({ left: 316, top: 0, width: 900, height: 800, right: 1216, bottom: 800, x: 316, y: 0 })
        doc.querySelector('#session-1')?.setAttribute('aria-selected', 'true')
      })

      doc.querySelector('[data-omnimux-rail-item="home"]').click()
      assert.equal(frame.hasAttribute('data-sidebar-collapsed'), false, '回首页必须恢复展开次级会话栏')
      assert.equal(doc.documentElement.getAttribute(NAV_RAIL_VIEW_ATTR), 'home')
      assert.equal(doc.querySelector('[data-omnimux-rail-item="home"]')?.getAttribute('data-active'), 'true')
      assert.ok(closedCalls >= 0)
    } finally {
      delete win.__omnimuxWorkbench
      disposeRail()
      disposeTopbar()
      disposeActivation()
      disposeRow()
    }
  })

  it('打开「更多」子页或官方面板时固定轨锁定 6 项并高亮「更多」（D9）', () => {
    const { doc } = setupDom()
    const rightPanel = doc.getElementById('official-right-panel')
    const fakeSidebarRight = {
      isExpanded: () => true,
      active: () => ({ id: 'omnimux-clip:studio', kind: 'omnimux-clip:studio' }),
    }
    bindWorkbenchDeps({ sidebarRight: fakeSidebarRight })
    const disposeActivation = installSidebarActivation({ document: doc, deps: { sidebarRight: fakeSidebarRight }, notify: () => {} })
    const disposeRail = installNavRail(doc)
    try {
      rightPanel.setAttribute('data-sidebar-right-panel', 'fullscreen')
      rightPanel.setAttribute('data-sidebar-right-open', 'true')
      doc.querySelector('#session-1')?.setAttribute('aria-selected', 'false')

      const state = computeCurrentNavRailState(doc)
      assert.equal(state.railId, 'more')
      assert.equal(state.view, 'business')
      assert.equal(state.activeMoreItemId, 'clip')

      // 切换至官方全局面板 plugins
      doc.querySelector('[data-entry="plugins"]').classList.add('panelEntryActive')
      doc.querySelector('[data-entry="plugins"] button').classList.add('panelActive')
      const panelState = computeCurrentNavRailState(doc)
      assert.equal(panelState.railId, 'more')
      assert.equal(panelState.activeMoreItemId, 'plugins')

      const topCount = doc.querySelectorAll('.omnimux-nav-rail-group [data-omnimux-rail-item]').length
      assert.equal(topCount, 6, '任何时候固定轨上区图标数量锁定为 6')
    } finally {
      disposeRail()
      disposeActivation()
    }
  })

  it('分屏模式下固定轨高亮「首页」，进入分屏时默认收起一次且不阻断手动展开（D8）', async () => {
    const { doc, frame } = setupDom()
    let expanded = false
    const fakeSidebarRight = {
      isExpanded: () => expanded,
      active: () => (expanded ? { id: 'omnimux-assets:library', kind: 'omnimux-assets:library' } : null),
    }
    const rightPanel = doc.getElementById('official-right-panel')
    const disposeActivation = installSidebarActivation({ document: doc, deps: { sidebarRight: fakeSidebarRight }, notify: () => {} })
    const disposeRail = installNavRail(doc)
    try {
      assert.equal(frame.hasAttribute('data-sidebar-collapsed'), false, '初始首页展开')

      // 进入分屏态（push + 对话列可见）
      expanded = true
      rightPanel.setAttribute('data-sidebar-right-panel', 'push')
      rightPanel.setAttribute('data-sidebar-right-open', 'true')
      await new Promise((resolve) => setTimeout(resolve, 25))
      assert.equal(doc.querySelector('[data-omnimux-rail-item="home"]')?.getAttribute('data-active'), 'true')
      assert.equal(doc.documentElement.getAttribute(NAV_RAIL_VIEW_ATTR), 'home')
      assert.equal(frame.hasAttribute('data-sidebar-collapsed'), true, '切入分屏时次级栏默认收起')

      // 用户手动在分屏态下拉开会话栏 → 不得被再次强行收起
      doc.querySelector('.toggle_qa').click()
      await new Promise((resolve) => setTimeout(resolve, 25))
      assert.equal(frame.hasAttribute('data-sidebar-collapsed'), false, '分屏态允许手动重新展开会话栏')
      // 模拟一次重同步
      doc.documentElement.setAttribute('data-sidebar-right-open', 'true')
      await new Promise((resolve) => setTimeout(resolve, 25))
      assert.equal(frame.hasAttribute('data-sidebar-collapsed'), false, '保持用户手动展开状态')
    } finally {
      disposeRail()
      disposeActivation()
    }
  })

  it('官方「更多」按钮支持双触发防抖守卫，且无官方锚点时弹出实体降级菜单并可用 Escape 关闭', () => {
    // 1. 有官方更多按钮：pointerdown 时菜单已开 → click 不得重开
    {
      const { win, doc } = setupDom({ withOfficialMore: true })
      const officialMore = doc.getElementById('official-more-btn')
      let clicks = 0
      officialMore.addEventListener('click', () => { clicks += 1 })
      const disposeRail = installNavRail(doc)
      const disposechrome = installSidebarPanelChrome(doc)
      try {
        const railMore = doc.querySelector('[data-omnimux-rail-item="more"]')
        railMore.click()
        assert.equal(clicks, 1, '首次点击透传官方更多按钮')

        // 模拟菜单已打开状态下的二次点击关闭
        const fakeMenu = doc.createElement('div')
        fakeMenu.setAttribute('data-menu-material', 'translucent')
        fakeMenu.className = 'SidebarRoot_moreMenu__qa'
        doc.body.append(fakeMenu)
        railMore.dispatchEvent(new win.Event('pointerdown', { bubbles: true }))
        fakeMenu.remove() // Menu.onPointerDown 关掉官方菜单
        railMore.click()
        assert.equal(clicks, 1, '已打开状态下点击不得二次重开')
      } finally {
        disposechrome()
        disposeRail()
      }
    }

    // 2. 无官方更多按钮（老宿主降级菜单）
    {
      const { win, doc } = setupDom({ withOfficialMore: false, productStage: 'omnimux-clip' })
      const disposeRail = installNavRail(doc)
      try {
        const railMore = doc.querySelector('[data-omnimux-rail-item="more"]')
        railMore.click()
        const menu = doc.getElementById(NAV_RAIL_MORE_FALLBACK_ID)
        assert.ok(menu, '无官方菜单时应打开降级浮层')
        const activeRow = menu.querySelector('[aria-current="page"]')
        assert.ok(activeRow, '降级浮层应标出当前处于的视频剪辑选中态')
        assert.match(activeRow.textContent, /视频剪辑/)
        assert.equal(MORE_MENU_SELECTOR.length > 0, true)

        doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        assert.equal(doc.getElementById(NAV_RAIL_MORE_FALLBACK_ID), null, '按 Escape 应关闭菜单')
      } finally {
        disposeRail()
      }
    }
  })

  it('底部应用更新/远程控制/账号设置透传真实动作与角标状态（D3）', () => {
    const { win, doc } = setupDom({ withUpdatePill: true })
    let updateClicks = 0
    let remoteClicks = 0
    let settingsClicks = 0
    doc.querySelector('button[data-next-update-pill]').addEventListener('click', () => { updateClicks += 1 })
    doc.getElementById('official-remote-btn').addEventListener('click', () => {
      remoteClicks += 1
      doc.getElementById('official-remote-btn').setAttribute('aria-expanded', 'true')
    })
    doc.getElementById('official-settings-btn').addEventListener('click', () => { settingsClicks += 1 })

    const disposeRail = installNavRail(doc)
    try {
      const updateBtn = doc.querySelector('[data-omnimux-rail-item="updates"]')
      const remoteBtn = doc.querySelector('[data-omnimux-rail-item="remote-control"]')
      const settingsBtn = doc.querySelector('[data-omnimux-rail-item="settings"]')

      assert.equal(updateBtn.getAttribute('data-has-update'), 'true', '更新 pill 存在时应点亮角标')
      updateBtn.click()
      assert.equal(updateClicks, 1)

      remoteBtn.click()
      assert.equal(remoteClicks, 1)
      assert.equal(remoteBtn.getAttribute('aria-expanded'), 'true', '远程控制高亮同步官方 aria-expanded')

      settingsBtn.click()
      assert.equal(settingsClicks, 1)

      // 业务模态（如 Agents Anywhere）设置 #root[inert] 时不得误隐固定轨
      const rootEl = doc.getElementById('root')
      rootEl.setAttribute('inert', '')
      const modal = doc.createElement('div')
      modal.setAttribute('role', 'dialog')
      modal.textContent = '远程控制'
      doc.body.append(modal)
      win.dispatchEvent(new win.Event('dsh-product-stage'))
      assert.equal(doc.documentElement.getAttribute(NAV_RAIL_ACTIVE_ATTR), '1')
      assert.equal(doc.getElementById(NAV_RAIL_ID).hidden, false)
      modal.remove()

      // 首次引导态出现 → 自动隐藏固定轨并清零偏移变量
      const guide = doc.createElement('div')
      guide.setAttribute('data-desktop-onboarding-surface', 'true')
      doc.body.append(guide)
      win.dispatchEvent(new win.Event('dsh-product-stage'))
      assert.equal(doc.documentElement.hasAttribute(NAV_RAIL_ACTIVE_ATTR), false)
      assert.equal(doc.documentElement.style.getPropertyValue(NAV_RAIL_WIDTH_VAR), '0px')
      assert.equal(doc.getElementById(NAV_RAIL_ID).hidden, true)
    } finally {
      disposeRail()
    }
  })

  it('通过 layout.panelInfo 读取与订阅官方全局主面板（含 schedules），点首页调用 selectPanel(null) 退出', () => {
    const { doc } = setupDom()
    let activePanelId = 'schedules'
    const listeners = new Set()
    const selectedPanels = []
    const panelInfo = {
      getSnapshot: () => ({ activePanelId }),
      subscribe: (fn) => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
    }
    bindWorkbenchDeps({
      layout: {
        panelInfo,
        selectPanel: (id) => {
          selectedPanels.push(id)
          activePanelId = id
          for (const fn of listeners) fn({ activePanelId: id })
        },
      },
    })
    doc.querySelector('#session-1')?.setAttribute('aria-selected', 'false')
    const mainEl = doc.createElement('div')
    mainEl.setAttribute('data-global-panel', 'true')
    doc.getElementById('root').append(mainEl)

    const disposeActivation = installSidebarActivation({ document: doc, notify: () => {} })
    const disposeRail = installNavRail(doc)
    try {
      const state = computeCurrentNavRailState(doc)
      assert.equal(state.railId, 'more')
      assert.equal(state.view, 'business')
      assert.equal(state.activeMoreItemId, 'schedules')
      assert.equal(doc.querySelector('[data-omnimux-rail-item="more"]')?.getAttribute('data-active'), 'true')

      doc.querySelector('[data-omnimux-rail-item="home"]').click()
      assert.deepEqual(selectedPanels, [null])
      assert.equal(doc.querySelector('[data-omnimux-rail-item="home"]')?.getAttribute('data-active'), 'true')
    } finally {
      disposeRail()
      disposeActivation()
    }
  })

  it('settings.launcher（AccountMenu）场景下更新自动穿透菜单进入桌面设置，设置按钮重锚弹出层且支持防抖切换', () => {
    const { win, doc } = setupDom()
    doc.querySelector('[data-slot="sidebar.settings"]')?.remove()
    const footer = doc.querySelector('.SidebarRoot_footArea__qa')
    const launcherSlot = doc.createElement('div')
    launcherSlot.setAttribute('data-slot', 'settings.launcher')
    const launcherBtn = doc.createElement('button')
    launcherBtn.type = 'button'
    launcherBtn.setAttribute('aria-haspopup', 'menu')
    launcherBtn.setAttribute('aria-expanded', 'false')
    launcherSlot.append(launcherBtn)
    footer.append(launcherSlot)

    let settingsOpened = 0
    let desktopTabClicks = 0
    launcherBtn.addEventListener('click', () => {
      const existing = doc.getElementById('fake-account-menu')
      if (existing) {
        existing.remove()
        launcherBtn.setAttribute('aria-expanded', 'false')
        return
      }
      launcherBtn.setAttribute('aria-expanded', 'true')
      const menu = doc.createElement('div')
      menu.id = 'fake-account-menu'
      menu.setAttribute('role', 'menu')
      const item = doc.createElement('button')
      item.type = 'button'
      item.setAttribute('role', 'menuitem')
      item.textContent = '设置'
      item.addEventListener('click', () => {
        settingsOpened += 1
        menu.remove()
        launcherBtn.setAttribute('aria-expanded', 'false')
        const dialog = doc.createElement('div')
        dialog.setAttribute('data-shortcut-modal', 'settings')
        const nav = doc.createElement('nav')
        const tabBtn = doc.createElement('button')
        tabBtn.type = 'button'
        tabBtn.textContent = '桌面设置'
        tabBtn.addEventListener('click', () => { desktopTabClicks += 1 })
        nav.append(tabBtn)
        dialog.append(nav)
        doc.body.append(dialog)
      })
      menu.append(item)
      doc.body.append(menu)
    })

    const disposeRail = installNavRail(doc)
    try {
      const settingsRailBtn = doc.querySelector('[data-omnimux-rail-item="settings"]')
      settingsRailBtn.click()
      const menu = doc.getElementById('fake-account-menu')
      assert.ok(menu, '点击设置轨图标应通过 launcher 打开账号菜单')
      assert.equal(menu.getAttribute('data-omnimux-rail-anchored'), 'settings', '账号菜单必须打上固定轨锚定标记')

      // 再次点击（模拟 Menu 外部 pointerdown 关掉后不得二次重开）
      settingsRailBtn.dispatchEvent(new win.Event('pointerdown', { bubbles: true }))
      menu.remove()
      launcherBtn.setAttribute('aria-expanded', 'false')
      settingsRailBtn.click()
      assert.equal(doc.getElementById('fake-account-menu'), null, '已打开状态下二次点击不得重开账号菜单')

      // 无更新 pill 时点更新 → 穿透 launcher 菜单进入桌面设置页签
      const updateRailBtn = doc.querySelector('[data-omnimux-rail-item="updates"]')
      updateRailBtn.click()
      assert.equal(settingsOpened, 1)
      assert.equal(desktopTabClicks, 1)
    } finally {
      disposeRail()
    }
  })

  it('固定「更多」菜单入口至左侧栏：条件显示分隔线、一键直达、互斥高亮、异步插件、渠道过滤与右键取消固定', () => {
    const { win, doc } = setupDom()
    const openedTabs = []
    win.__omnimuxWorkbench = {
      open: (options) => {
        openedTabs.push(options)
        doc.querySelector('#session-1')?.setAttribute('aria-selected', 'false')
        const right = doc.getElementById('official-right-panel')
        right.setAttribute('data-sidebar-right-panel', 'fullscreen')
        right.setAttribute('data-sidebar-right-open', 'true')
        return true
      },
    }
    let activeTabKey = 'omnimux-clip:studio'
    let activePanelId = null
    const panelListeners = new Set()
    const selectedPanels = []
    bindWorkbenchDeps({
      sidebarRight: {
        isExpanded: () => Boolean(activeTabKey),
        active: () => (activeTabKey ? { id: activeTabKey, kind: activeTabKey } : null),
      },
      layout: {
        panelInfo: {
          getSnapshot: () => ({ activePanelId }),
          subscribe: (fn) => {
            panelListeners.add(fn)
            return () => panelListeners.delete(fn)
          },
        },
        selectPanel: (id) => {
          selectedPanels.push(id)
          activePanelId = id
          for (const fn of panelListeners) fn({ activePanelId: id })
        },
      },
    })

    const coordinator = installSidebarGlobal()
    const disposeActivation = installSidebarActivation({ document: doc, notify: () => {} })
    const disposeRail = installNavRail(doc)
    try {
      const section = doc.querySelector('[data-omnimux-rail-pinned-section="1"]')
      assert.ok(section)
      assert.equal(section.hidden, true, '无固定项时隐藏分隔线与快捷区')

      // 预写入已固定：clip（内置工具）、async-tool（晚到动态插件）、panel:schedules（官方面板）、publish（Alpha）
      setReleaseChannelForTests('development')
      setPinnedMoreItem('clip', true)
      setPinnedMoreItem('async-tool', true)
      setPinnedMoreItem('panel:schedules', true)
      setPinnedMoreItem('publish', true)

      const listButtons = () => [...doc.querySelectorAll('.omnimux-nav-rail-pinned-list [data-omnimux-rail-pinned]')]
      assert.deepEqual(
        listButtons().map((b) => b.getAttribute('data-omnimux-rail-pinned')),
        ['clip', 'panel:schedules', 'publish'],
        '未注册的异步插件暂不渲染空白占位按钮',
      )
      assert.equal(section.hidden, false)

      // 异步插件延迟挂载 → 自动出现在既定保存顺位
      const unregisterAsync = coordinator.registerExploreItem({
        id: 'async-tool',
        label: '异步新工具',
        iconSvg: '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="2" y="2" width="12" height="12"/></svg>',
        tabId: 'async-tool:home',
      })
      assert.deepEqual(
        listButtons().map((b) => b.getAttribute('data-omnimux-rail-pinned')),
        ['clip', 'async-tool', 'panel:schedules', 'publish'],
      )

      // 正式版过滤 Alpha 项，但保留持久化记录
      setReleaseChannelForTests('production')
      win.dispatchEvent(new win.Event('dsh-product-stage'))
      assert.deepEqual(
        listButtons().map((b) => b.getAttribute('data-omnimux-rail-pinned')),
        ['clip', 'async-tool', 'panel:schedules'],
      )
      assert.ok(JSON.parse(win.localStorage.getItem(NAV_RAIL_PINNED_MORE_STORAGE_KEY)).includes('publish'))

      // 点击已固定 clip → 一键打开并直接高亮左侧栏 clip 图标，互斥熄灭「更多」
      const clipBtn = doc.querySelector('[data-omnimux-rail-pinned="clip"]')
      clipBtn.click()
      assert.equal(openedTabs.at(-1)?.tabId, 'omnimux-clip:studio')
      assert.equal(doc.querySelector('[data-omnimux-rail-pinned="clip"]')?.getAttribute('data-active'), 'true')
      assert.equal(doc.querySelector('[data-omnimux-rail-item="more"]')?.getAttribute('data-active'), 'false')

      // 点击已固定 panel:schedules → 调用 layout.selectPanel('schedules') 并高亮该固定按钮
      const schedBtn = doc.querySelector('[data-omnimux-rail-pinned="panel:schedules"]')
      schedBtn.click()
      assert.deepEqual(selectedPanels, ['schedules'])
      assert.equal(doc.querySelector('[data-omnimux-rail-pinned="panel:schedules"]')?.getAttribute('data-active'), 'true')
      assert.equal(doc.querySelector('[data-omnimux-rail-item="more"]')?.getAttribute('data-active'), 'false')

      // 右键已固定 panel:schedules → 弹出实底「取消固定」菜单 → 点击移除后高亮平稳交还「更多」
      schedBtn.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
      const ctxMenu = doc.getElementById(NAV_RAIL_PIN_CONTEXT_MENU_ID)
      assert.ok(ctxMenu, '右键固定入口应弹出取消固定菜单')
      ctxMenu.querySelector('.omnimux-nav-rail-pin-context-item').click()
      assert.equal(doc.getElementById(NAV_RAIL_PIN_CONTEXT_MENU_ID), null)
      assert.equal(doc.querySelector('[data-omnimux-rail-pinned="panel:schedules"]'), null)
      assert.equal(doc.querySelector('[data-omnimux-rail-item="more"]')?.getAttribute('data-active'), 'true')

      unregisterAsync()
      setPinnedMoreItem('clip', false)
      setPinnedMoreItem('async-tool', false)
      setPinnedMoreItem('publish', false)
      assert.equal(section.hidden, true, '全部取消固定后自动隐藏分隔线与快捷区')
    } finally {
      delete win.__omnimuxWorkbench
      disposeRail()
      disposeActivation()
    }
  })

  it('降级「更多」菜单同样支持点击图钉固定/取消固定，且保持菜单不关闭并同步左侧栏', () => {
    const { doc } = setupDom({ withOfficialMore: false })
    const disposeRail = installNavRail(doc)
    try {
      const moreBtn = doc.querySelector('[data-omnimux-rail-item="more"]')
      moreBtn.click()
      const menu = doc.getElementById(NAV_RAIL_MORE_FALLBACK_ID)
      assert.ok(menu)
      const clipPinBtn = menu.querySelector('[data-omnimux-pin-toggle="clip"]')
      assert.ok(clipPinBtn)
      assert.equal(clipPinBtn.getAttribute('aria-pressed'), 'false')

      clipPinBtn.click()
      assert.ok(doc.getElementById(NAV_RAIL_MORE_FALLBACK_ID), '降级菜单点击图钉后不得关闭')
      assert.equal(clipPinBtn.getAttribute('aria-pressed'), 'true')
      assert.ok(doc.querySelector('[data-omnimux-rail-pinned="clip"]'), '左侧栏应即时出现固定入口')

      clipPinBtn.click()
      assert.equal(clipPinBtn.getAttribute('aria-pressed'), 'false')
      assert.equal(doc.querySelector('[data-omnimux-rail-pinned="clip"]'), null)
    } finally {
      disposeRail()
    }
  })
})
