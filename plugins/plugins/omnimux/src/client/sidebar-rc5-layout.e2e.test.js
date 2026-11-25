import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import { runStyleDomProbe } from '../../../../scripts/test-fixtures/style-dom-probe.mjs'

/**
 * 真实 Chromium 端到端回归：DSH 0.2.2-rc.5 左侧栏展开态对齐与结构挂载。
 *
 * 直接打包并执行生产模块 `sidebar-coordinator.js` 与 `sidebar-panel-chrome.js`，
 * 配合 0.2.2-rc.5 `SidebarRoot.module.css` 真实几何规则与 `dsh-ui-kit`
 * `.omnimux-sidebar-nav-entry` 真实样式，验证三类缺陷不再复发：
 *   1. 「新对话」(.newSessionRow) 与首条自定义行「项目」顶距为 12px（非 0px 贴边）；
 *   2. 「更多」按钮绘制区左右与上方行齐边、图标左边界对齐（无 3px 双重缩进）；
 *   3. 自定义行之间及「灵感社区」与「更多」间距均为 2px，外层 `.panelEntry` 彻底隐藏；
 *   4. 窄栏（220px）、滚动区滚出及收起态（data-sidebar-collapsed）保持契约。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const CREATE_SIDEBAR_ENTRY_PATH = join(HERE, '../../../../packages/dsh-ui-kit/src/stage/createSidebarEntry.ts')

function readSidebarEntryStyles() {
  const source = readFileSync(CREATE_SIDEBAR_ENTRY_PATH, 'utf8')
  const match = source.match(/const SIDEBAR_ENTRY_COMMON_STYLES = `([\s\S]*?)`/)
  assert.ok(match, '必须能从 dsh-ui-kit/src/stage/createSidebarEntry.ts 读取真实 .omnimux-sidebar-nav-entry 样式')
  return match[1]
}

const RUNTIME_BUNDLE = esbuild.buildSync({
  absWorkingDir: HERE,
  stdin: {
    contents: `
      import { installSidebarGlobal } from './sidebar-coordinator.js'
      import { installSidebarPanelChrome } from './sidebar-panel-chrome.js'
      window.__RC5_RUNTIME = { installSidebarGlobal, installSidebarPanelChrome }
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

const SIDEBAR_ENTRY_CSS = readSidebarEntryStyles()

/**
 * 精确镜像 DSH 0.2.2-rc.5 `SidebarRoot.module.css` 与 `Menu.module.css` 关键布局声明。
 * 开头显式还原宿主默认 `content-box`，避免 `style-dom-probe.mjs` 全局 reset 掩盖漏设 `border-box`。
 */
const HOST_RC5_SIDEBAR_CSS = `
:where([class*="sidebarCol"], [class*="sidebarCol"] *) {
  box-sizing: content-box;
}
:root {
  --dsw-specific-sidebar-fill: #1b1c20;
  --dsw-alias-bg-base: #17181c;
  --dsw-alias-bg-layer-2: #25262b;
  --dsw-alias-button-elevated-fill: rgba(255, 255, 255, 0.06);
  --dsw-alias-border-l3: rgba(255, 255, 255, 0.14);
  --dsw-alias-label-primary: #f2f3f5;
  --dsw-alias-label-caption: #7c808c;
  --dsw-alias-interactive-bg-hover: rgba(255, 255, 255, 0.07);
  --dsw-alias-interactive-bg-active: rgba(255, 255, 255, 0.12);
  --dsw-radius-md: 12px;
  --dsw-radius-sm: 8px;
  --dsw-font-s-14: 14px/20px system-ui, sans-serif;
}
.AppFrame_frame__rc5 {
  display: flex;
  height: var(--qa-frame-height, 640px);
}
.AppFrame_sidebarCol__rc5 {
  flex: none;
  height: 100%;
}
.SidebarRoot_root__rc5 {
  --dsh-sidebar-inline-padding: 8px;
  --dsh-sidebar-row-padding: 12px;
  --dsh-sidebar-label-gap: 6px;
  --dsh-sidebar-paint-inset: 3px;
  display: flex;
  flex-direction: column;
  height: 100%;
  width: var(--qa-sidebar-width, 280px);
  padding: 6px var(--dsh-sidebar-inline-padding);
  box-sizing: border-box;
  background: var(--dsw-specific-sidebar-fill);
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
}
.SidebarRoot_root__rc5.SidebarRoot_collapsed__rc5 {
  width: 56px;
  padding: 18px 10px 6px;
}
.SidebarRoot_logoRow__rc5 {
  flex: none;
  display: flex;
  align-items: center;
  height: 60px;
  padding: 8px 0 8px 8px;
  box-sizing: border-box;
}
.SidebarRoot_newSessionRow__rc5 {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 calc(var(--dsh-sidebar-paint-inset) + 1px);
}
.SidebarRoot_newSession__rc5 {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 38px;
  padding: 8px 12px;
  margin: 0;
  box-sizing: border-box;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-button-elevated-fill);
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
}
.SidebarRoot_scrollRegion__rc5 {
  margin-top: 4px;
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.SidebarRoot_scrollArea__rc5 {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 4px minmax(0, 1fr) calc(var(--dsh-sidebar-inline-padding) - 2px);
  grid-template-rows: 8px max-content 2px max-content;
  align-content: start;
  margin-left: -4px;
  margin-right: calc(2px - var(--dsh-sidebar-inline-padding));
  overflow-x: hidden;
  overflow-y: auto;
}
.SidebarRoot_scrollArea__rc5::before,
.SidebarRoot_scrollArea__rc5::after {
  content: '';
  grid-column: 2;
  pointer-events: none;
}
.SidebarRoot_scrollArea__rc5::before { grid-row: 1; }
.SidebarRoot_scrollArea__rc5::after { grid-row: 3; }
.SidebarRoot_collapsed__rc5 .SidebarRoot_scrollRegion__rc5 { margin-top: 0; }
.SidebarRoot_collapsed__rc5 .SidebarRoot_scrollArea__rc5 {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  overflow: visible;
}
.SidebarRoot_collapsed__rc5 .SidebarRoot_scrollArea__rc5::before,
.SidebarRoot_collapsed__rc5 .SidebarRoot_scrollArea__rc5::after {
  display: none;
}
.SidebarRoot_panelList__rc5 {
  grid-column: 2;
  grid-row: 2;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
}
.SidebarRoot_collapsed__rc5 .SidebarRoot_panelList__rc5 {
  gap: 12px;
  margin-bottom: 12px;
}
.SidebarRoot_panelEntry__rc5 {
  position: relative;
  display: flex;
  border-inline: var(--dsh-sidebar-paint-inset) solid transparent;
  border-radius: var(--dsw-radius-md);
  background-clip: padding-box;
}
.SidebarRoot_panelEntryWide__rc5 > *:first-child { flex: 1; min-width: 0; }
.SidebarRoot_panelEntryWide__rc5 .SidebarRoot_panelRow__rc5 {
  width: 100%;
  margin: 0;
  border-inline: 0;
  padding-right: 38px;
  background: transparent;
}
.SidebarRoot_panelUnpin__rc5 {
  position: absolute;
  right: 0;
  top: 2px;
  width: 28px;
  height: 28px;
  border: 0;
}
.Menu_root__rc5 { position: relative; display: inline-flex; }
.SidebarRoot_moreAnchor__rc5 { display: flex; flex-direction: column; }
.SidebarRoot_panelRow__rc5 {
  display: flex;
  align-items: center;
  gap: var(--dsh-sidebar-label-gap);
  margin: 0;
  min-height: 32px;
  padding: 5px calc(var(--dsh-sidebar-row-padding) - var(--dsh-sidebar-paint-inset));
  box-sizing: border-box;
  border: none;
  border-inline: var(--dsh-sidebar-paint-inset) solid transparent;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  background-clip: padding-box;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  line-height: 22px;
  text-align: left;
  cursor: pointer;
}
.SidebarRoot_collapsed__rc5 .SidebarRoot_panelRow__rc5 {
  width: 36px;
  height: 36px;
  justify-content: center;
  margin: 0;
  border-inline: 0;
  background-clip: border-box;
  padding: 0;
}
.SidebarRoot_panelGlyph__rc5 {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.SidebarRoot_panelTitle__rc5 {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.SidebarRoot_regionArea__rc5 {
  grid-column: 2;
  grid-row: 4;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.qa-session-item {
  height: 32px;
  display: flex;
  align-items: center;
  padding: 0 12px;
}
`

const ICON_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2"/></svg>'

function buildFixtureHtml({ sidebarWidth = 280, frameHeight = 640, collapsed = false, sessionCount = 4 } = {}) {
  const wide = !collapsed
  const sessions = Array.from({ length: sessionCount }, (_, idx) => `<div class="qa-session-item">会话 ${idx + 1}</div>`).join('')
  return `
<div class="AppFrame_frame__rc5" ${collapsed ? 'data-sidebar-collapsed="true"' : ''} style="--qa-sidebar-width:${sidebarWidth}px;--qa-frame-height:${frameHeight}px;">
  <div class="AppFrame_sidebarCol__rc5">
    <div data-slot="sidebar" style="display:contents;">
      <div class="SidebarRoot_root__rc5 ${collapsed ? 'SidebarRoot_collapsed__rc5' : ''}">
        <div class="SidebarRoot_logoRow__rc5"><span>OmniMux</span></div>
        <div class="SidebarRoot_newSessionRow__rc5">
          <div data-slot="sidebar.session.action" style="display:contents;">
            <button type="button" class="SidebarRoot_newSession__rc5" aria-label="新对话">新对话</button>
          </div>
        </div>
        <div class="SidebarRoot_scrollRegion__rc5">
          <div class="SidebarRoot_scrollArea__rc5" data-sidebar-scrollport="">
            <nav class="SidebarRoot_panelList__rc5" aria-label="面板">
              <div class="SidebarRoot_panelEntry__rc5${wide ? ' SidebarRoot_panelEntryWide__rc5' : ''}" data-qa-entry="plugins">
                <button type="button" class="SidebarRoot_panelRow__rc5" aria-label="插件">
                  <span class="SidebarRoot_panelGlyph__rc5">${ICON_SVG}</span>
                  ${wide ? '<span class="SidebarRoot_panelTitle__rc5">插件</span>' : ''}
                </button>
              </div>
              <div class="SidebarRoot_panelEntry__rc5${wide ? ' SidebarRoot_panelEntryWide__rc5' : ''}" data-qa-entry="schedules">
                <button type="button" class="SidebarRoot_panelRow__rc5" aria-label="自动化任务">
                  <span class="SidebarRoot_panelGlyph__rc5">${ICON_SVG}</span>
                  ${wide ? '<span class="SidebarRoot_panelTitle__rc5">自动化任务</span>' : ''}
                </button>
                ${wide ? '<button type="button" class="SidebarRoot_panelUnpin__rc5" data-qa-unpin="schedules" aria-label="取消固定">x</button>' : ''}
              </div>
              <span class="Menu_root__rc5 SidebarRoot_moreAnchor__rc5">
                <button type="button" class="SidebarRoot_panelRow__rc5" data-qa-row="more" aria-label="更多" aria-haspopup="menu" aria-expanded="false">
                  <span class="SidebarRoot_panelGlyph__rc5">${ICON_SVG}</span>
                  ${wide ? '<span class="SidebarRoot_panelTitle__rc5">更多</span>' : ''}
                </button>
              </span>
            </nav>
            <div class="SidebarRoot_regionArea__rc5">${sessions}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
<script>${RUNTIME_BUNDLE}</script>
<script>
(() => {
  const { installSidebarGlobal, installSidebarPanelChrome } = window.__RC5_RUNTIME
  installSidebarPanelChrome(document)
  const api = installSidebarGlobal()
  const entries = [
    { id: 'omnimux-workflow-entry', rank: 4, label: '项目', key: 'workflow' },
    { id: 'omnimux-market-entry', rank: 4.1, label: '技能/专家', key: 'market' },
    { id: 'omnimux-assets-entry', rank: 6, label: '资产库', key: 'assets' },
    { id: 'omnimux-inspiration-entry', rank: 7, label: '灵感社区', key: 'inspiration' },
  ]
  for (const item of entries) {
    api.register({
      id: item.id,
      rank: item.rank,
      styles: ${JSON.stringify(SIDEBAR_ENTRY_CSS)},
      styleId: 'omnimux-sidebar-nav-entry-styles',
      create: () => {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'omnimux-sidebar-nav-entry'
        btn.dataset.qaCustom = item.key
        if (item.key === 'workflow') btn.dataset.active = 'true'
        btn.innerHTML = '<span class="omnimux-sidebar-nav-entry-icon">' + ${JSON.stringify(ICON_SVG)} + '</span><span class="omnimux-sidebar-nav-entry-label">' + item.label + '</span>'
        return btn
      },
    })
  }
  api.place()
})()
</script>`
}

function measureLayout({ sidebarWidth = 280, frameHeight = 640, collapsed = false, sessionCount = 4 } = {}) {
  return runStyleDomProbe({
    name: 'sidebar-rc5-layout',
    viewportHeight: Math.max(700, frameHeight + 80),
    styles: HOST_RC5_SIDEBAR_CSS,
    html: buildFixtureHtml({ sidebarWidth, frameHeight, collapsed, sessionCount }),
    measure: () => {
      const round = (n) => Math.round(n * 100) / 100
      const rect = (el) => {
        const r = el.getBoundingClientRect()
        return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width), height: round(r.height) }
      }
      const newSessionRow = document.querySelector('.SidebarRoot_newSessionRow__rc5')
      const panelList = document.querySelector('nav[class*="panelList"]')
      const workflow = document.querySelector('[data-qa-custom="workflow"]')
      const market = document.querySelector('[data-qa-custom="market"]')
      const assets = document.querySelector('[data-qa-custom="assets"]')
      const inspiration = document.querySelector('[data-qa-custom="inspiration"]')
      const more = document.querySelector('[data-qa-row="more"]')
      const moreCs = getComputedStyle(more)
      const borderL = Number.parseFloat(moreCs.borderLeftWidth) || 0
      const borderR = Number.parseFloat(moreCs.borderRightWidth) || 0
      const moreRect = rect(more)
      const morePaint = {
        left: round(moreRect.left + borderL),
        right: round(moreRect.right - borderR),
        width: round(moreRect.width - borderL - borderR),
        top: moreRect.top,
        bottom: moreRect.bottom,
        height: moreRect.height,
      }
      const workflowRect = rect(workflow)
      const marketRect = rect(market)
      const assetsRect = rect(assets)
      const inspirationRect = rect(inspiration)
      const newSessionRect = rect(newSessionRow)
      const workflowIcon = rect(workflow.querySelector('.omnimux-sidebar-nav-entry-icon'))
      const moreGlyph = rect(more.querySelector('[class*="panelGlyph"]'))
      const officialEntries = [...document.querySelectorAll('[data-qa-entry]')].map((el) => ({
        name: el.dataset.qaEntry,
        display: getComputedStyle(el).display,
        height: rect(el).height,
      }))
      const unpinEl = document.querySelector('[data-qa-unpin="schedules"]')
      const unpinRect = unpinEl ? rect(unpinEl) : { height: 0 }
      const scrollArea = document.querySelector('.SidebarRoot_scrollArea__rc5')
      const beforeScroll = {
        workflowTop: workflowRect.top,
        moreTop: moreRect.top,
        scrollHeight: scrollArea.scrollHeight,
        clientHeight: scrollArea.clientHeight,
      }
      let afterScroll = null
      if (scrollArea.scrollHeight > scrollArea.clientHeight) {
        scrollArea.scrollTop = 60
        afterScroll = {
          scrollTop: scrollArea.scrollTop,
          workflowTop: rect(workflow).top,
          moreTop: rect(more).top,
        }
      }
      return {
        allInPanelList: [workflow, market, assets, inspiration].every((el) => el.parentElement === panelList),
        newSessionRect,
        workflowRect,
        marketRect,
        assetsRect,
        inspirationRect,
        moreRect,
        morePaint,
        moreStyle: {
          borderLeftWidth: moreCs.borderLeftWidth,
          borderRightWidth: moreCs.borderRightWidth,
          paddingLeft: moreCs.paddingLeft,
          marginLeft: moreCs.marginLeft,
          borderRadius: moreCs.borderRadius,
          fontSize: moreCs.fontSize,
          lineHeight: moreCs.lineHeight,
        },
        workflowIcon,
        moreGlyph,
        officialEntries,
        unpinHeight: unpinRect.height,
        beforeScroll,
        afterScroll,
      }
    },
  })
}

test('展开态 280px：顶距 12px、更多左右齐边与图标对齐、灵感社区到更多 2px 且外层 panelEntry 隐藏', () => {
  const m = measureLayout({ sidebarWidth: 280 })
  assert.equal(m.allInPanelList, true, '所有自定义常驻行必须挂在 nav.panelList 内')

  // 1. 「新对话」与「项目」间距严格为宿主 12px（4px scrollRegion + 8px scrollArea::before）
  assert.equal(
    Math.round(m.workflowRect.top - m.newSessionRect.bottom),
    12,
    `新对话到项目间距应为 12px，实际 ${m.workflowRect.top - m.newSessionRect.bottom}px`,
  )

  // 2. 「更多」按钮无 3px 双重缩进：绘制框与「新对话」和「项目」完全齐边，图标左边界一致
  assert.equal(m.moreStyle.borderLeftWidth, '0px', '展开态 .panelRow border-left 必须清零')
  assert.equal(m.moreStyle.borderRightWidth, '0px', '展开态 .panelRow border-right 必须清零')
  assert.ok(
    Math.abs(m.morePaint.left - m.workflowRect.left) <= 0.5,
    `更多绘制左边界(${m.morePaint.left})应与项目(${m.workflowRect.left})对齐`,
  )
  assert.ok(
    Math.abs(m.morePaint.right - m.workflowRect.right) <= 0.5,
    `更多绘制右边界(${m.morePaint.right})应与项目(${m.workflowRect.right})对齐`,
  )
  assert.ok(
    Math.abs(m.morePaint.left - m.newSessionRect.left) <= 0.5,
    `更多绘制左边界(${m.morePaint.left})应与新对话(${m.newSessionRect.left})对齐`,
  )
  assert.ok(
    Math.abs(m.morePaint.right - m.newSessionRect.right) <= 0.5,
    `更多绘制右边界(${m.morePaint.right})应与新对话(${m.newSessionRect.right})对齐`,
  )
  assert.ok(
    Math.abs(m.moreGlyph.left - m.workflowIcon.left) <= 0.5,
    `更多图标左边界(${m.moreGlyph.left})应与项目图标(${m.workflowIcon.left})对齐`,
  )
  assert.equal(m.morePaint.height, 32, '更多行高应为 32px')
  assert.equal(m.moreStyle.borderRadius, '8px', '更多圆角应为 8px')

  // 3. 行间连续 2px，无 16px 断层，外层 panelEntry 与内部 panelUnpin 均彻底隐藏
  assert.equal(Math.round(m.marketRect.top - m.workflowRect.bottom), 2, '项目到技能/专家应为 2px')
  assert.equal(Math.round(m.assetsRect.top - m.marketRect.bottom), 2, '技能/专家到资产库应为 2px')
  assert.equal(Math.round(m.inspirationRect.top - m.assetsRect.bottom), 2, '资产库到灵感社区应为 2px')
  assert.equal(
    Math.round(m.moreRect.top - m.inspirationRect.bottom),
    2,
    `灵感社区到更多应为 2px，实际 ${m.moreRect.top - m.inspirationRect.bottom}px`,
  )
  for (const entry of m.officialEntries) {
    assert.equal(entry.display, 'none', `外层 panelEntry(${entry.name}) 必须 display:none`)
    assert.equal(entry.height, 0, `外层 panelEntry(${entry.name}) 高度必须为 0`)
  }
  assert.equal(m.unpinHeight, 0, '被折叠官方面板内的 panelUnpin 按钮不得残留可见高度')
})

test('窄栏 220px（drawer）：顶距、齐边与 2px 连续间距一致', () => {
  const m = measureLayout({ sidebarWidth: 220 })
  assert.equal(Math.round(m.workflowRect.top - m.newSessionRect.bottom), 12)
  assert.ok(Math.abs(m.morePaint.left - m.workflowRect.left) <= 0.5)
  assert.ok(Math.abs(m.morePaint.right - m.workflowRect.right) <= 0.5)
  assert.ok(Math.abs(m.moreGlyph.left - m.workflowIcon.left) <= 0.5)
  assert.equal(Math.round(m.moreRect.top - m.inspirationRect.bottom), 2)
})

test('滚动交接：侧栏高度受限时自定义行随 .panelList 与「更多」一起滚出', () => {
  const m = measureLayout({ sidebarWidth: 280, frameHeight: 340, sessionCount: 16 })
  assert.ok(m.afterScroll !== null && m.afterScroll.scrollTop > 0, 'scrollArea 必须产生可滚动溢出')
  const wfDelta = Math.round(m.beforeScroll.workflowTop - m.afterScroll.workflowTop)
  const moreDelta = Math.round(m.beforeScroll.moreTop - m.afterScroll.moreTop)
  assert.equal(wfDelta, Math.round(m.afterScroll.scrollTop), '项目行必须随 scrollArea 同步向上滚出')
  assert.equal(moreDelta, wfDelta, '项目行与更多行必须以相同位移共同滚动')
})

test('收起态轨道：外层 panelEntry 保持隐藏，展开态度量规则不污染 36x36 更多按钮', () => {
  const m = measureLayout({ sidebarWidth: 280, collapsed: true })
  for (const entry of m.officialEntries) {
    assert.equal(entry.display, 'none', `收起态 panelEntry(${entry.name}) 仍必须 display:none`)
  }
  assert.equal(m.moreRect.width, 36, '收起态更多按钮必须保持 36px 宽')
  assert.equal(m.moreRect.height, 36, '收起态更多按钮必须保持 36px 高')
  assert.equal(m.moreStyle.paddingLeft, '0px', '收起态更多按钮不得套用展开态 8px padding')
  assert.equal(m.moreStyle.marginLeft, '0px', '收起态更多按钮不得套用展开态 4px margin')
})
