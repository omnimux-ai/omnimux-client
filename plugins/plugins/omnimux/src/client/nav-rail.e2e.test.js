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
      import * as React from 'react'
      import { flushSync } from 'react-dom'
      import * as ReactDOMClient from 'react-dom/client'
      import { ensureProductStageChrome } from './conversation-box.js'
      import { createExploreMoreMenuContent } from './explore-more-menu.jsx'
      import { setPinnedMoreItem } from './nav-rail-pins.js'
      import { installSidebarGlobal } from './sidebar-coordinator.js'
      import { installSidebarPanelChrome } from './sidebar-panel-chrome.js'
      import { installSidebarToggleTopbar } from './sidebar-toggle-topbar.js'
      import { installSidebarActivation } from './workbench/sidebar-activation.js'
      import { bindWorkbenchDeps } from './workbench/host-adapter.js'
      import { installNavRail } from './nav-rail.js'
      window.__NAV_RAIL_E2E = {
        React,
        flushSync,
        ReactDOMClient,
        ensureProductStageChrome,
        createExploreMoreMenuContent,
        setPinnedMoreItem,
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
  jsx: 'automatic',
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
  --dsw-alias-border-l2-darkmode-thin: rgba(255, 255, 255, 0.06);
  --dsw-alias-border-l2: rgba(255, 255, 255, 0.12);
  --dsw-alias-border-l3: rgba(255, 255, 255, 0.16);
  --dsw-alias-border-l4: rgba(255, 255, 255, 0.22);
  --dsw-alias-label-primary: #f4f5f7;
  --dsw-alias-label-secondary: #a1a6b3;
  --dsw-alias-label-tertiary: #747a87;
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
.Menu_itemWrap__e2e {
  position: relative;
}
.Menu_separator__e2e {
  height: 0.5px;
  margin: 3px 8px;
  background: var(--dsw-alias-border-l2);
}
.Menu_itemWrap__e2e:first-child > .Menu_separator__e2e:first-child {
  display: none;
}
.Menu_item__e2e {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 34px;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
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
    menu.innerHTML = '<div class="MenuSurface_material"><button type="button" role="menuitem" aria-current="page">视频剪辑</button></div>'
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
      const settingsBtn = rail.querySelector('[data-omnimux-rail-item="settings"]')
      const hDivider = rail.querySelector('.omnimux-nav-rail-bottom .omnimux-nav-rail-divider')
      const railStyle = getComputedStyle(rail)
      const railAfterStyle = getComputedStyle(rail, '::after')
      const hDividerStyle = getComputedStyle(hDivider)
      const railRectMeasure = rect(rail)
      const dividerMetrics = {
        dpr: window.devicePixelRatio || 1,
        railBorderRightWidth: railStyle.borderRightWidth,
        afterBorderRightWidth: railAfterStyle.borderRightWidth,
        afterBorderRightColor: railAfterStyle.borderRightColor,
        afterTopPx: round(parseFloat(railAfterStyle.top)),
        homeTopPx: round(rect(homeBtn).top),
        afterBottomInsetPx: round(parseFloat(railAfterStyle.bottom)),
        settingsBottomInsetPx: round(railRectMeasure.bottom - rect(settingsBtn).bottom),
        hDividerBorderTopWidth: hDividerStyle.borderTopWidth,
        hDividerHeight: hDividerStyle.height,
        hDividerBorderTopColor: hDividerStyle.borderTopColor,
      }
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
      const moreCurrentBg = getComputedStyle(popup.querySelector('[aria-current="page"]')).backgroundColor

      // 切回首页后模拟真实 SidebarRoot drawer 模态（role="dialog" + aria-modal="true" + data-shortcut-modal="sidebar"）
      window.__e2eResetHome()
      rail.querySelector('[data-omnimux-rail-item="home"]').click()
      frame.removeAttribute('data-sidebar-collapsed')
      frame.setAttribute('data-sidebar-drawer', '')
      const sidebarRoot = document.querySelector('.SidebarRoot_root__e2e')
      sidebarRoot.setAttribute('role', 'dialog')
      sidebarRoot.setAttribute('aria-modal', 'true')
      sidebarRoot.setAttribute('data-shortcut-modal', 'sidebar')
      const drawerHomeView = document.documentElement.getAttribute('data-omnimux-nav-view')
      const drawerRootLeft = rect(rootEl).left
      const drawerSidebarLeft = rect(sidebarCol).left

      // 真实业务设置模态弹出（非抽屉）时 #root 恢复全宽铺底避免模态被裁切
      frame.removeAttribute('data-sidebar-drawer')
      sidebarRoot.removeAttribute('role')
      sidebarRoot.removeAttribute('aria-modal')
      sidebarRoot.removeAttribute('data-shortcut-modal')
      const settingsDialog = document.createElement('div')
      settingsDialog.setAttribute('role', 'dialog')
      settingsDialog.setAttribute('aria-modal', 'true')
      settingsDialog.setAttribute('data-shortcut-modal', 'settings')
      rootEl.append(settingsDialog)
      const modalRootRect = rect(rootEl)
      settingsDialog.remove()

      document.documentElement.setAttribute('data-fullscreen', 'true')
      const fullscreenDivider = {
        afterTopPx: round(parseFloat(getComputedStyle(rail, '::after').top)),
        homeTopPx: round(rect(homeBtn).top),
      }
      document.documentElement.removeAttribute('data-fullscreen')

      return {
        homeExpanded,
        dividerMetrics,
        fullscreenDivider,
        projectsBusiness,
        popupRect,
        popupBg,
        moreCurrentBg,
        drawerHomeView,
        drawerRootLeft,
        drawerSidebarLeft,
        modalRootRect,
      }
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
  assert.equal(metrics.moreCurrentBg, 'rgba(255, 255, 255, 0.14)', '官方更多菜单激活子项必须呈现激活态底色')

  // 4. 窄屏抽屉与非抽屉模态验证
  assert.equal(metrics.drawerHomeView, 'home', '切回首页后固定轨视图必须回到 home')
  assert.equal(metrics.drawerRootLeft, 52, '窄屏抽屉携带 dialog+sidebar 标识时 #root 必须保持 52px 左基准')
  assert.equal(metrics.drawerSidebarLeft, 52, '窄屏抽屉次级会话栏必须从 52px 固定轨右侧滑出')
  assert.equal(metrics.modalRootRect.left, 0, '非抽屉设置模态开启时 #root 必须扩至视口全宽以防模态被裁切')
  assert.equal(metrics.modalRootRect.width, 1600)

  // 5. Token 白名单完整性确认
  assert.ok(allowlist.includes('--dsw-alias-bg-layer-2'))
  assert.ok(allowlist.includes('--dsw-alias-border-l2-darkmode-thin'))

  // 6. 分割线细度、浅色令牌与上下内缩对齐首末图标外侧验证（1x DPR 下 Chromium 自动将 0.5px 边框像素对齐为 1px）
  const expectedHairline = metrics.dividerMetrics.dpr >= 2 ? '0.5px' : '1px'
  assert.equal(metrics.dividerMetrics.railBorderRightWidth, '0px', '容器自身不得再绘满高右边框')
  assert.equal(metrics.dividerMetrics.afterBorderRightWidth, expectedHairline, '固定轨右侧分隔线应为细线边框')
  assert.equal(metrics.dividerMetrics.afterBorderRightColor, 'rgba(255, 255, 255, 0.06)', '固定轨竖向分隔线应消费柔和薄边令牌')
  assert.equal(metrics.dividerMetrics.afterTopPx, 52, 'macOS 窗口化竖线上端应内缩 52px 避让红绿灯安全区')
  assert.equal(metrics.dividerMetrics.afterTopPx, metrics.dividerMetrics.homeTopPx, '竖线上端必须对齐首枚首页按钮外顶边')
  assert.equal(metrics.dividerMetrics.afterBottomInsetPx, 12, '竖线下端应距轨底内缩 12px')
  assert.equal(metrics.dividerMetrics.afterBottomInsetPx, metrics.dividerMetrics.settingsBottomInsetPx, '竖线下端必须对齐最底部按钮外底边')
  assert.equal(metrics.dividerMetrics.hDividerBorderTopWidth, expectedHairline, '栏内横向分隔线应为细线边框')
  assert.equal(metrics.dividerMetrics.hDividerHeight, '0px', '横向分隔线不得保留 1px 实体高度')
  assert.equal(metrics.dividerMetrics.hDividerBorderTopColor, 'rgba(255, 255, 255, 0.06)', '横向分隔线应与竖向分隔线共用柔和薄边令牌')
  assert.equal(metrics.fullscreenDivider.afterTopPx, 12, '全屏模式下竖线上端应同步收敛至 12px')
  assert.equal(metrics.fullscreenDivider.afterTopPx, metrics.fullscreenDivider.homeTopPx, '全屏模式下竖线上端仍须精确对齐首页图标外顶边')
})

test('Chromium E2E：「更多」菜单固定按钮对齐/分隔线保留、左侧栏快捷图标一键激活与窄高不挤出底部按钮', () => {
  const metrics = runStyleDomProbe({
    name: 'nav-rail-pin-e2e',
    viewportHeight: 620,
    styles: HOST_CSS,
    html: buildE2eHtml(),
    measure: () => {
      const round = (n) => Math.round(n * 100) / 100
      const rect = (el) => {
        const r = el.getBoundingClientRect()
        return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width), height: round(r.height) }
      }
      const e2e = window.__NAV_RAIL_E2E
      const menuHost = document.createElement('div')
      menuHost.id = 'e2e-real-more-menu'
      menuHost.setAttribute('data-menu-material', 'translucent')
      menuHost.className = 'SidebarRoot_moreMenu__e2e'
      const material = document.createElement('div')
      material.className = 'MenuSurface_material'
      menuHost.append(material)
      document.body.append(menuHost)

      const StubMenuItemButton = ({ children, icon, current, separatorBefore, onSelect }) => e2e.React.createElement(
        'div',
        { className: 'Menu_itemWrap__e2e' },
        separatorBefore ? e2e.React.createElement('div', { className: 'Menu_separator__e2e', role: 'separator' }) : null,
        e2e.React.createElement(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            className: 'Menu_item__e2e',
            'aria-current': current === true ? 'page' : undefined,
            onClick: onSelect,
          },
          icon,
          e2e.React.createElement('span', null, children),
        ),
      )

      const Content = e2e.createExploreMoreMenuContent({ MenuItemButton: StubMenuItemButton })
      const reactRoot = e2e.ReactDOMClient.createRoot(material)
      e2e.flushSync(() => {
        reactRoot.render(e2e.React.createElement(Content, {
          onDismiss: () => {},
          entries: [{ id: 'schedules', label: '自动化任务', active: false }],
          onOpen: () => {},
        }))
      })

      // 验证未固定态：默认隐藏（opacity 0）且分组分隔线可见（未受 :first-child 规则误藏）
      const appsRow = material.querySelector('[data-omnimux-more-item="apps"]')
      const appsSep = appsRow.querySelector('[role="separator"]')
      const appsBtn = appsRow.querySelector('button[role="menuitem"]')
      const appsPinAnchor = appsRow.querySelector('.omnimux-explore-more-pin-anchor')
      const appsPinBtn = appsRow.querySelector('[data-omnimux-pin-toggle="apps"]')
      const appsSepDisplay = getComputedStyle(appsSep).display
      const unpinnedOpacity = getComputedStyle(appsPinAnchor).opacity
      const appsBtnRect = rect(appsBtn)
      const appsPinRect = rect(appsPinBtn)
      const pinCenterDeltaY = Math.abs((appsPinRect.top + appsPinRect.height / 2) - (appsBtnRect.top + appsBtnRect.height / 2))
      const appsPadRight = getComputedStyle(appsBtn).paddingRight

      // 点击 6 项固定（验证菜单内固定后常显 + 左侧栏「更多」下方可滚动且不挤出底部系统按钮）
      for (const pinId of ['panel:schedules', 'apps', 'image-generation', 'clip', 'publish', 'accounts']) {
        const btn = material.querySelector(`[data-omnimux-pin-toggle="${pinId}"]`)
        if (btn) btn.click()
      }
      e2e.flushSync(() => {})
      const appsPinnedOpacity = getComputedStyle(appsPinAnchor).opacity

      const pinnedSection = document.querySelector('[data-omnimux-rail-pinned-section="1"]')
      const pinnedList = document.querySelector('.omnimux-nav-rail-pinned-list')
      const updatesBtn = document.querySelector('[data-omnimux-rail-item="updates"]')
      const settingsBtn = document.querySelector('[data-omnimux-rail-item="settings"]')
      const moreBtn = document.querySelector('[data-omnimux-rail-item="more"]')
      const firstPinnedBtn = pinnedList.querySelector('[data-omnimux-rail-pinned]')

      const railMetrics = {
        sectionVisible: !pinnedSection.hidden,
        pinnedCount: pinnedList.querySelectorAll('[data-omnimux-rail-pinned]').length,
        firstPinnedRect: rect(firstPinnedBtn),
        moreRect: rect(moreBtn),
        updatesRect: rect(updatesBtn),
        settingsRect: rect(settingsBtn),
        listClientHeight: pinnedList.clientHeight,
        listScrollHeight: pinnedList.scrollHeight,
        listScrollable: pinnedList.scrollHeight > pinnedList.clientHeight,
        viewportHeight: window.innerHeight,
      }

      // 右键固定按钮，校验取消固定浮层实底且不透底
      firstPinnedBtn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
      const ctxMenu = document.getElementById('omnimux-nav-rail-pin-context-menu')
      const ctxBg = ctxMenu ? getComputedStyle(ctxMenu).backgroundColor : ''
      ctxMenu?.querySelector('.omnimux-nav-rail-pin-context-item')?.click()

      reactRoot.unmount()
      menuHost.remove()

      return {
        appsSepDisplay,
        unpinnedOpacity,
        appsPinnedOpacity,
        pinCenterDeltaY,
        appsPadRight,
        railMetrics,
        ctxBg,
        remainingAfterContextUnpin: pinnedList.querySelectorAll('[data-omnimux-rail-pinned]').length,
      }
    },
  })

  assert.equal(metrics.appsSepDisplay, 'block', '外包行后分组分隔线必须保持可见')
  assert.equal(metrics.unpinnedOpacity, '0', '未固定图钉在默认未悬停态下必须隐藏')
  assert.equal(metrics.appsPinnedOpacity, '1', '固定后即使带分隔线的行图钉也必须常显')
  assert.ok(metrics.pinCenterDeltaY <= 1, `带分隔线行的图钉中心必须与按钮垂直居中（偏差 ${metrics.pinCenterDeltaY}px）`)
  assert.equal(metrics.appsPadRight, '34px', '菜单按钮右侧必须预留 34px 防文案碰撞图钉')
  assert.equal(metrics.railMetrics.sectionVisible, true)
  assert.ok(metrics.railMetrics.pinnedCount >= 4)
  assert.equal(metrics.railMetrics.firstPinnedRect.width, 36)
  assert.equal(metrics.railMetrics.firstPinnedRect.height, 36)
  assert.ok(metrics.railMetrics.listClientHeight >= 36, '固定区在窄高视口至少保留首枚图标可视高度')
  assert.equal(metrics.railMetrics.listScrollable, true, '多固定项在窄高视口应启用固定列表内部滚动')
  assert.ok(metrics.railMetrics.firstPinnedRect.top > metrics.railMetrics.moreRect.bottom, '固定图标必须落在更多图标下方')
  assert.ok(metrics.railMetrics.settingsRect.bottom <= metrics.railMetrics.viewportHeight, '多固定项窄高视口下不得将底部设置钮挤出屏幕')
  assert.ok(metrics.railMetrics.updatesRect.top > metrics.railMetrics.firstPinnedRect.bottom)
  assert.doesNotMatch(metrics.ctxBg, /rgba\([^,]+,[^,]+,[^,]+,\s*0\)/, '右键取消固定菜单必须为实底')
  assert.equal(metrics.remainingAfterContextUnpin, metrics.railMetrics.pinnedCount - 1)
})
