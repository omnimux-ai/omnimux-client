import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import { runStyleDomProbe } from '../../../../scripts/test-fixtures/style-dom-probe.mjs'

/**
 * 真实 Chromium 端到端回归：52px 固定左侧导航轨 + 首页专属 Agent 会话栏。
 *
 * 打包真实生产模块（nav-rail.js / sidebar-coordinator.js / sidebar-panel-chrome.js /
 * sidebar-toggle-topbar.js / conversation-box.js / workbench/sidebar-activation.js）
 * 在真实 headless Chromium 中验证坐标几何、双主题色阶、macOS 交通灯避让、
 * 业务全屏独占、实底弹出菜单、模态框不被裁切与窄屏抽屉定位。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const ALLOWLIST_PATH = join(HERE, '../../../../scripts/dsw-token-allowlist.json')
const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')).source.tokens

const RUNTIME_BUNDLE = esbuild.buildSync({
  absWorkingDir: HERE,
  stdin: {
    contents: `
      import { ensureProductStageChrome } from './conversation-box.js'
      import { installSidebarGlobal } from './sidebar-coordinator.js'
      import { installSidebarPanelChrome } from './sidebar-panel-chrome.js'
      import { installSidebarToggleTopbar } from './sidebar-toggle-topbar.js'
      import { installSidebarActivation } from './workbench/sidebar-activation.js'
      import { bindWorkbenchDeps } from './workbench/host-adapter.js'
      import { installNavRail } from './nav-rail.js'
      window.__NAV_RAIL_E2E = {
        ensureProductStageChrome,
        installSidebarGlobal,
        installSidebarPanelChrome,
        installSidebarToggleTopbar,
        installSidebarActivation,
        bindWorkbenchDeps,
        installNavRail,
      }
    `,
    resolveDir: HERE,
    loader: 'js',
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'silent',
}).outputFiles[0].text

const HOST_CSS = `
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow-x: hidden;
  background: #141519;
  color: #f4f5f7;
  font-family: system-ui, -apple-system, sans-serif;
}
:root {
  --dsw-specific-sidebar-fill: #1b1c20;
  --dsw-alias-bg-base: #141519;
  --dsw-alias-bg-layer-1: #1b1c20;
  --dsw-alias-bg-layer-2: #24252a;
  --dsw-alias-bg-mask-1: rgba(0, 0, 0, 0.52);
  --dsw-alias-button-elevated-fill: rgba(255, 255, 255, 0.06);
  --dsw-alias-interactive-bg-hover: rgba(255, 255, 255, 0.08);
  --dsw-alias-interactive-bg-active: rgba(255, 255, 255, 0.14);
  --dsw-alias-border-l1: rgba(255, 255, 255, 0.06);
  --dsw-alias-border-l2: rgba(255, 255, 255, 0.12);
  --dsw-alias-border-l3: rgba(255, 255, 255, 0.16);
  --dsw-alias-border-l4: rgba(255, 255, 255, 0.22);
  --dsw-alias-label-primary: #f4f5f7;
  --dsw-alias-label-secondary: #a1a6b3;
  --dsw-alias-tooltip-bg: #24252a;
  --dsw-alias-tooltip-label: #f4f5f7;
  --dsw-alias-state-warn-primary: #f59e0b;
  --dsw-alias-state-business-primary: #3b82f6;
  --dsw-alias-brand-primary: #f4f5f7;
  --dsw-focus-ring-color: #f4f5f7;
  --dsw-focus-ring-width: 2px;
  --dsw-radius-sm: 8px;
  --dsw-radius-md: 12px;
  --dsw-shadow-lv2: 0 10px 28px rgba(0, 0, 0, 0.45);
  --ds-transition-duration-slow: 0ms;
  --ds-ease-in-out: ease;
  --dsh-sidebar-inline-padding: 8px;
}
#root {
  height: 100%;
}
.AppFrame_frame__e2e {
  position: relative;
  display: grid;
  grid-template-columns: 264px minmax(0, 1fr) 0px;
  grid-template-rows: minmax(0, 1fr) auto;
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
}
.AppFrame_frame__e2e[data-sidebar-collapsed] {
  grid-template-columns: 56px minmax(0, 1fr) 0px;
}
.AppFrame_frame__e2e[data-sidebar-drawer] .AppFrame_sidebarCol__e2e {
  position: absolute;
  inset: 0 auto 0 0;
  width: 264px;
  z-index: 71;
  background: var(--dsw-specific-sidebar-fill);
}
.AppFrame_sidebarCol__e2e {
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
  height: 100%;
  background: var(--dsw-specific-sidebar-fill);
  border-right: 0.5px solid var(--dsw-alias-border-l3);
}
.SidebarRoot_root__e2e {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 6px 8px;
  box-sizing: border-box;
}
.SidebarRoot_topStrip__e2e {
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
.SidebarRoot_logoRow__e2e {
  height: 44px;
  display: flex;
  align-items: center;
  padding-left: 8px;
}
.SidebarRoot_newSessionRow__e2e {
  margin-bottom: 8px;
}
.SidebarRoot_newSession__e2e {
  width: 100%;
  height: 36px;
}
.SidebarRoot_scrollArea__e2e {
  flex: 1;
  min-height: 0;
  display: grid;
}
.SidebarRoot_panelList__e2e {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.SidebarRoot_panelRow__e2e {
  height: 32px;
}
.SidebarRoot_footArea__e2e {
  padding: 8px 0;
}
.AppFrame_centerCol__e2e {
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  height: 100%;
}
[data-sidebar-right-panel] {
  display: none;
}
[data-sidebar-right-panel][data-sidebar-right-open] {
  display: block;
}
[data-dockkit-strip] {
  height: 40px;
  display: flex;
  align-items: center;
}
.SidebarRoot_moreMenu__e2e {
  background: var(--dsw-menu-surface-fill, rgba(40, 40, 40, 0.5));
  width: 248px;
}
.SidebarRoot_moreMenu__e2e .MenuSurface_material {
  background: var(--dsw-menu-surface-fill);
  padding: 8px;
}
`

function buildE2eHtml() {
  return `
<script>document.documentElement.setAttribute('data-platform', 'darwin')</script>
<div id="root" data-slot="root">
  <div class="AppFrame_frame__e2e">
    <div class="AppFrame_sidebarCol__e2e" data-pane="sidebar">
      <div class="SidebarRoot_root__e2e">
        <div class="SidebarRoot_topStrip__e2e">
          <button type="button" class="toggle_e2e" aria-label="收起侧边栏">T</button>
        </div>
        <div class="SidebarRoot_logoRow__e2e">OmniMux</div>
        <div class="SidebarRoot_newSessionRow__e2e">
          <button type="button" class="SidebarRoot_newSession__e2e" aria-label="新对话">新对话</button>
        </div>
        <div class="SidebarRoot_scrollArea__e2e">
          <nav class="SidebarRoot_panelList__e2e" aria-label="面板">
            <div class="SidebarRoot_panelEntry__e2e" data-entry="plugins">
              <button type="button" class="SidebarRoot_panelRow__e2e" aria-label="插件">插件</button>
            </div>
            <span class="SidebarRoot_moreAnchor__e2e">
              <button type="button" class="SidebarRoot_panelRow__e2e" id="e2e-official-more" aria-label="更多" aria-haspopup="menu" aria-expanded="false">更多</button>
            </span>
          </nav>
          <div class="SidebarRoot_regionArea__e2e" role="tree" aria-label="Sessions">
            <div role="treeitem" id="e2e-session-1" aria-selected="true">爆款短剧脚本复刻</div>
          </div>
        </div>
        <div class="SidebarRoot_footArea__e2e">
          <div data-slot="sidebar.footer.action">
            <button type="button" data-next-update-pill aria-label="有新版本可用">更新</button>
          </div>
          <div data-slot="sidebar.settings">
            <button type="button" id="e2e-settings-btn"><span data-slot="settings.trigger">设置</span></button>
          </div>
        </div>
      </div>
    </div>
    <div class="AppFrame_centerCol__e2e" data-slot="conversation"></div>
    <div data-sidebar-right-panel="push" id="e2e-right-panel">
      <div data-dockkit-strip id="e2e-tab-strip"><span>项目</span></div>
    </div>
  </div>
</div>
<script>${RUNTIME_BUNDLE}</script>
<script>
(() => {
  const frame = document.querySelector('.AppFrame_frame__e2e')
  const toggleBtn = document.querySelector('.toggle_e2e')
  const rightPanel = document.getElementById('e2e-right-panel')
  let rightActive = null
  const fakeSidebarRight = {
    isExpanded: () => rightActive !== null,
    active: () => (rightActive ? { id: rightActive, kind: rightActive } : null),
  }

  toggleBtn.addEventListener('click', () => {
    const next = !frame.hasAttribute('data-sidebar-collapsed')
    if (next) frame.setAttribute('data-sidebar-collapsed', '')
    else frame.removeAttribute('data-sidebar-collapsed')
    toggleBtn.setAttribute('aria-label', next ? '展开侧边栏' : '收起侧边栏')
  })

  const e2e = window.__NAV_RAIL_E2E
  e2e.ensureProductStageChrome()
  e2e.bindWorkbenchDeps({ sidebarRight: fakeSidebarRight })
  e2e.installSidebarActivation({ document, deps: { sidebarRight: fakeSidebarRight }, notify: () => {} })
  const sidebarApi = e2e.installSidebarGlobal()
  const wfBtn = document.createElement('button')
  wfBtn.type = 'button'
  wfBtn.textContent = '项目'
  wfBtn.addEventListener('click', () => {
    rightActive = 'omnimux-workflow:library'
    rightPanel.setAttribute('data-sidebar-right-panel', 'fullscreen')
    rightPanel.setAttribute('data-sidebar-right-open', 'true')
    document.getElementById('e2e-session-1').setAttribute('aria-selected', 'false')
  })
  sidebarApi.register({ id: 'omnimux-workflow-entry', rank: 4, create: () => wfBtn })

  e2e.installSidebarPanelChrome(document)
  e2e.installNavRail(document)
  e2e.installSidebarToggleTopbar(document)

  window.__e2eResetHome = () => {
    rightActive = null
    rightPanel.setAttribute('data-sidebar-right-panel', 'push')
    rightPanel.removeAttribute('data-sidebar-right-open')
    document.getElementById('e2e-session-1').setAttribute('aria-selected', 'true')
  }

  const officialMore = document.getElementById('e2e-official-more')
  officialMore.addEventListener('click', () => {
    const existing = document.getElementById('e2e-more-popup')
    if (existing) {
      existing.remove()
      officialMore.setAttribute('aria-expanded', 'false')
      return
    }
    officialMore.setAttribute('aria-expanded', 'true')
    const menu = document.createElement('div')
    menu.id = 'e2e-more-popup'
    menu.setAttribute('data-menu-material', 'translucent')
    menu.className = 'SidebarRoot_moreMenu__e2e'
    menu.innerHTML = '<div class="MenuSurface_material">视频剪辑</div>'
    document.body.append(menu)
  })
})()
</script>`
}

test('Chromium E2E：固定导航轨 52px 布局、避让红绿灯、业务全屏、更多实底弹出与抽屉模式全绿', () => {
  const metrics = runStyleDomProbe({
    name: 'nav-rail-e2e',
    viewportHeight: 820,
    styles: HOST_CSS,
    html: buildE2eHtml(),
    measure: () => {
      const round = (n) => Math.round(n * 100) / 100
      const rect = (el) => {
        const r = el.getBoundingClientRect()
        return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width), height: round(r.height) }
      }
      const rail = document.getElementById('omnimux-nav-rail')
      const rootEl = document.getElementById('root')
      const frame = document.querySelector('.AppFrame_frame__e2e')
      const sidebarCol = document.querySelector('.AppFrame_sidebarCol__e2e')
      const panelList = document.querySelector('nav.SidebarRoot_panelList__e2e')
      const footArea = document.querySelector('.SidebarRoot_footArea__e2e')
      const homeBtn = rail.querySelector('[data-omnimux-rail-item="home"]')
      const topbarToggle = document.querySelector('[data-omnimux-sidebar-toggle-topbar="1"]')

      const homeExpanded = {
        railRect: rect(rail),
        rootRect: rect(rootEl),
        frameRect: rect(frame),
        sidebarWidth: rect(sidebarCol).width,
        homeBtnTop: rect(homeBtn).top,
        panelListHeight: rect(panelList).height,
        footAreaHeight: rect(footArea).height,
        topbarToggleLeft: rect(topbarToggle).left,
        overflowPx: document.documentElement.scrollWidth - window.innerWidth,
        hasUpdateDot: rail.querySelector('[data-omnimux-rail-item="updates"]').getAttribute('data-has-update'),
      }

      // 切换至「项目」全屏业务页
      rail.querySelector('[data-omnimux-rail-item="projects"]').click()
      const rightPanel = document.getElementById('e2e-right-panel')
      const tabStrip = document.getElementById('e2e-tab-strip')
      const projectsBusiness = {
        viewAttr: document.documentElement.getAttribute('data-omnimux-nav-view'),
        sidebarWidth: rect(sidebarCol).width,
        topbarToggleDisplay: getComputedStyle(topbarToggle).display,
        rightPanelRect: rect(rightPanel),
        tabStripPadLeft: getComputedStyle(tabStrip).paddingLeft,
        overflowPx: document.documentElement.scrollWidth - window.innerWidth,
      }

      // 打开「更多」浮层
      rail.querySelector('[data-omnimux-rail-item="more"]').click()
      const popup = document.getElementById('e2e-more-popup')
      const popupMaterial = popup.querySelector('.MenuSurface_material')
      const popupRect = rect(popup)
      const popupBg = getComputedStyle(popupMaterial).backgroundColor

      // 切回首页后模拟 drawer 模式下的次级栏定位（必须从 52px 右侧滑出）
      window.__e2eResetHome()
      rail.querySelector('[data-omnimux-rail-item="home"]').click()
      frame.removeAttribute('data-sidebar-collapsed')
      frame.setAttribute('data-sidebar-drawer', '')
      const drawerHomeView = document.documentElement.getAttribute('data-omnimux-nav-view')
      const drawerSidebarLeft = rect(sidebarCol).left

      return { homeExpanded, projectsBusiness, popupRect, popupBg, drawerHomeView, drawerSidebarLeft }
    },
  })

  // 1. 首页展开态验证
  assert.equal(metrics.homeExpanded.railRect.left, 0)
  assert.equal(metrics.homeExpanded.railRect.width, 52)
  assert.equal(metrics.homeExpanded.rootRect.left, 52)
  assert.equal(metrics.homeExpanded.frameRect.width, 1548)
  assert.equal(metrics.homeExpanded.sidebarWidth, 264)
  assert.ok(metrics.homeExpanded.homeBtnTop >= 52, `首页图标必须避让红绿灯 48px 安全区，实测 ${metrics.homeExpanded.homeBtnTop}`)
  assert.equal(metrics.homeExpanded.panelListHeight, 0, '次级栏官方 panelList 必须完全隐藏')
  assert.equal(metrics.homeExpanded.footAreaHeight, 0, '次级栏底部区域必须完全清空隐藏')
  assert.equal(metrics.homeExpanded.topbarToggleLeft, 84, '顶栏折叠钮必须在 macOS 红绿灯右侧 84px')
  assert.equal(metrics.homeExpanded.overflowPx, 0, '严禁产生横向溢出')
  assert.equal(metrics.homeExpanded.hasUpdateDot, 'true')

  // 2. 业务全屏页验证
  assert.equal(metrics.projectsBusiness.viewAttr, 'business')
  assert.equal(metrics.projectsBusiness.sidebarWidth, 0, '切入业务页后次级会话栏必须收起归零')
  assert.equal(metrics.projectsBusiness.topbarToggleDisplay, 'none', '业务页必须隐藏顶栏折叠钮')
  assert.equal(metrics.projectsBusiness.rightPanelRect.left, 52, '全屏业务页必须紧贴 52px 固定轨右侧，不得覆盖固定轨')
  assert.equal(metrics.projectsBusiness.rightPanelRect.width, 1548, '全屏业务页宽度必须占满 100vw - 52px')
  assert.equal(metrics.projectsBusiness.tabStripPadLeft, '34px', 'macOS 业务页顶栏必须精确避让绿灯')
  assert.equal(metrics.projectsBusiness.overflowPx, 0)

  // 3. 更多浮层定位与材质验证
  assert.equal(metrics.popupRect.left, 60, '更多浮层必须紧贴 52px 固定轨右侧（52 + 8 = 60px）')
  assert.doesNotMatch(metrics.popupBg, /rgba\([^,]+,[^,]+,[^,]+,\s*0\)/, '更多菜单背景必须实底不透明')

  // 4. 窄屏抽屉验证
  assert.equal(metrics.drawerHomeView, 'home', '切回首页后固定轨视图必须回到 home')
  assert.equal(metrics.drawerSidebarLeft, 52, '窄屏抽屉次级会话栏必须从 52px 固定轨右侧滑出')

  // 5. Token 白名单完整性确认
  assert.ok(allowlist.includes('--dsw-alias-bg-layer-2'))
})
