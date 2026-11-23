/**
 * Route B regression guard (DP-003 retired + DP-004 aligned to 0.2.2-rc.5).
 *
 * Since DSH 0.2.2-rc.5, AppFrame publishes `--dsh-frame-leading-clearance`
 * (160px windowed macOS, 84px fullscreen macOS) and ConversationRoot applies:
 *
 *   .header   { padding: 10px 28px 0 20px; }
 *   .titleRow { padding-inline-start: max(0px, calc(var(--dsh-frame-leading-clearance, 0px) - 20px)); }
 *
 * Route B retires DP-003's `!important` padding override in `conversation-box.js`
 * so the official clearance takes effect directly (`20 + 140 = 160px` windowed,
 * `20 + 64 = 84px` fullscreen), while DP-004 (`sidebar-toggle-topbar.js`) keeps
 * its collapsed two-button cluster right edge inside both clearances
 * (`84 + 32 + 8 + 32 = 156 <= 160px` windowed; `8 + 32 + 8 + 32 = 80 <= 84px`
 * fullscreen).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { JSDOM } from 'jsdom'

import { PRODUCT_STAGE_CHROME } from './conversation-box.js'
import {
  TOPBAR_TOGGLE_SIZE_PX,
  TOPBAR_TOGGLE_TOP_PX,
  computeChromeLayout,
} from './sidebar-toggle-topbar.js'

const WIDTHS = [980, 1280, 1800]
const STATES = ['expanded', 'collapsed', 'hidden', 'fullscreen']

const OFFICIAL_022_CSS = `
  .uPhUma_header { height: 50.5px; padding: 10px 28px 0 20px; box-sizing: border-box; }
  .uPhUma_titleRow { height: 30px; padding-inline-start: 0; }
  .uPhUma_titleCluster { width: 260.5px; height: 28px; }
`

function officialClearancePx(state) {
  if (state === 'expanded') return 0
  if (state === 'fullscreen') return 84
  return 160
}

function buildFixture({ state, width, css = PRODUCT_STAGE_CHROME }) {
  const htmlAttrs = ['data-omnimux-sidebar-toggle-topbar', 'data-platform="darwin"']
  if (state !== 'expanded') htmlAttrs.push('data-omnimux-left-collapsed')
  if (state === 'fullscreen') htmlAttrs.push('data-fullscreen')
  const frameAttr = state === 'expanded' ? '' : ' data-sidebar-collapsed="true"'
  const clearance = officialClearancePx(state)
  const titleRowPad = Math.max(0, clearance - 20)
  const dom = new JSDOM(`<!doctype html><html ${htmlAttrs.join(' ')}><body data-dsh-desktop-mode="extended" data-dsh-desktop-platform="darwin">
    <div class="dshDesktopFrame"${frameAttr} style="width:${width}px;--dsh-frame-leading-clearance:${clearance}px">
      <div class="sidebarCol_x" style="width:${state === 'expanded' ? 280 : 0}px"></div>
      <div data-slot="conversation.header" style="display: contents">
        <header class="uPhUma_header">
          <div class="uPhUma_titleRow" style="padding-inline-start:${titleRowPad}px">
            <div class="uPhUma_titleCluster">会话标题</div>
          </div>
          <div data-slot="conversation.session.header" style="display: contents"></div>
        </header>
      </div>
    </div>
    <button data-omnimux-sidebar-toggle-topbar="1"></button>
    <button data-omnimux-topbar-new-session="1"></button>
  </body></html>`, { url: 'http://127.0.0.1/' })
  const doc = dom.window.document
  const sidebarCol = doc.querySelector('.sidebarCol_x')
  if (sidebarCol && state === 'expanded') {
    Object.defineProperty(sidebarCol, 'offsetWidth', { value: 280, configurable: true })
  }
  const style = doc.createElement('style')
  style.textContent = `${OFFICIAL_022_CSS}\n${css}`
  doc.head.append(style)
  return { dom, doc }
}

function readLength(value, fallback) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function layout({ dom, doc }, state) {
  const header = doc.querySelector('.uPhUma_header')
  const titleRow = doc.querySelector('.uPhUma_titleRow')
  const headerStyle = dom.window.getComputedStyle(header)
  const rowStyle = dom.window.getComputedStyle(titleRow)
  const chrome = computeChromeLayout(doc)
  const headerLeft = state === 'expanded' ? 280 : 0
  const paddingLeft = readLength(headerStyle.paddingLeft, 20)
  const paddingTop = readLength(headerStyle.paddingTop, 10)
  const rowPaddingStart = readLength(rowStyle.paddingInlineStart, 0)
  const titleCluster = {
    x: headerLeft + paddingLeft + rowPaddingStart,
    y: paddingTop,
    width: 260.5,
    height: 28,
  }
  const openSidebar = {
    x: chrome.toggleLeft,
    y: TOPBAR_TOGGLE_TOP_PX,
    width: TOPBAR_TOGGLE_SIZE_PX,
    height: TOPBAR_TOGGLE_SIZE_PX,
  }
  const newSession = chrome.newSessionLeft == null
    ? null
    : {
        x: chrome.newSessionLeft,
        y: TOPBAR_TOGGLE_TOP_PX,
        width: TOPBAR_TOGGLE_SIZE_PX,
        height: TOPBAR_TOGGLE_SIZE_PX,
      }
  return {
    chrome,
    headerPaddingLeft: headerStyle.paddingLeft,
    headerPaddingTop: headerStyle.paddingTop,
    rowPaddingStart,
    titleCluster,
    openSidebar,
    newSession,
  }
}

function intersects(a, b) {
  if (!a || !b) return false
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

describe('Route B conversation header clearance (DP-003 retired + DP-004 aligned)', () => {
  it('retires DP-003 !important padding override from PRODUCT_STAGE_CHROME', () => {
    assert.doesNotMatch(PRODUCT_STAGE_CHROME, /desktop-patch:DP-003/)
    assert.doesNotMatch(
      PRODUCT_STAGE_CHROME,
      /data-omnimux-left-collapsed\]\s*\[data-slot="conversation\.header"\]/,
    )
  })

  for (const width of WIDTHS) {
    for (const state of STATES) {
      it(`${state} @ ${width}px lets official clearance align with DP-004 controls without overlap`, () => {
        const fixture = buildFixture({ state, width })
        try {
          const { doc } = fixture
          assert.ok(
            doc.querySelector('[data-slot="conversation.header"] > header > [data-slot="conversation.session.header"]'),
            'fixture must mirror the real nested slot structure',
          )
          const result = layout(fixture, state)
          assert.equal(result.headerPaddingLeft, '20px', 'DP-003 must not override official 20px header padding-left')
          assert.equal(result.headerPaddingTop, '10px', 'DP-003 must not override official 10px header padding-top')
          if (state === 'expanded') {
            assert.equal(result.rowPaddingStart, 0)
            assert.equal(result.titleCluster.x, 300)
            assert.equal(result.newSession, null)
          } else if (state === 'fullscreen') {
            assert.equal(result.rowPaddingStart, 64, 'fullscreen official clearance is 84 - 20 = 64px')
            assert.equal(result.titleCluster.x, 84)
            assert.equal(result.openSidebar.x, 8)
            assert.equal(result.newSession.x, 48)
            assert.ok(
              result.newSession.x + result.newSession.width <= result.titleCluster.x,
              'collapsed fullscreen button cluster right edge (80px) must fit inside 84px official clearance',
            )
          } else {
            assert.equal(result.rowPaddingStart, 140, 'windowed official clearance is 160 - 20 = 140px')
            assert.equal(result.titleCluster.x, 160)
            assert.equal(result.openSidebar.x, 84)
            assert.equal(result.newSession.x, 124)
            assert.ok(
              result.newSession.x + result.newSession.width <= result.titleCluster.x,
              'collapsed windowed button cluster right edge (156px) must fit inside 160px official clearance',
            )
          }
          assert.equal(intersects(result.titleCluster, result.openSidebar), false, 'titleCluster must not intersect open-sidebar button')
          assert.equal(intersects(result.titleCluster, result.newSession), false, 'titleCluster must not intersect new-session button')
          assert.ok(result.titleCluster.x + result.titleCluster.width <= width, 'titleCluster must fit inside the window')
        } finally {
          fixture.dom.window.close()
        }
      })
    }
  }

  it('proves keeping the 84px traffic-light inset in fullscreen would collide with official 84px clearance', () => {
    const titleCluster = { x: 84, y: 10, width: 260.5, height: 28 }
    const staleOpenSidebar = { x: 84, y: TOPBAR_TOGGLE_TOP_PX, width: TOPBAR_TOGGLE_SIZE_PX, height: TOPBAR_TOGGLE_SIZE_PX }
    const staleNewSession = { x: 124, y: TOPBAR_TOGGLE_TOP_PX, width: TOPBAR_TOGGLE_SIZE_PX, height: TOPBAR_TOGGLE_SIZE_PX }
    assert.equal(intersects(titleCluster, staleOpenSidebar), true)
    assert.equal(intersects(titleCluster, staleNewSession), true)
  })
})
