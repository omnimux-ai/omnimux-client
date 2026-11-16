/**
 * DP-003 regression guard — collapsed-rail conversation header padding.
 *
 * The advanced `dsh-plugin-desktop` shell renders:
 *
 *   [data-slot="conversation.header"]        (display: contents wrapper)
 *     > header.uPhUma_header
 *         > [data-slot="conversation.session.header"]  (inner anchor)
 *
 * The old patch treated `conversation.session.header` as an ancestor of
 * <header>, so none of its selectors matched. This suite uses the real slot
 * structure, asserts the CSS rule reaches the real <header>, and checks the
 * resulting titleCluster rect never intersects either topbar control across
 * expanded / collapsed / hidden / fullscreen at 980 / 1280 / 1800 widths.
 *
 * jsdom has no layout engine: the small `layout()` model below derives the
 * rects from the computed padding and the same fixed topbar geometry that
 * `sidebar-toggle-topbar.js` writes into CSS variables. The geometry inputs
 * (open button 84×4 32×32, new-session 124×4 32×32, titleCluster width 260.5)
 * are the measured values from the real Dev app (2026-11-16).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { JSDOM } from 'jsdom'

import { PRODUCT_STAGE_CHROME } from './conversation-box.js'

const WIDTHS = [980, 1280, 1800]
const STATES = ['expanded', 'collapsed', 'hidden', 'fullscreen']

const BASE_CSS = `
  .uPhUma_header { height: 50.5px; padding: 0 12px 0 20px; box-sizing: border-box; }
  .uPhUma_titleRow { height: 30px; padding-inline-start: 0; }
  .uPhUma_titleCluster { width: 260.5px; height: 28px; }
`

/** The DP-003 rule exactly as it shipped before the #47 fix. */
const REVERTED_CSS = `
html[data-omnimux-sidebar-toggle-topbar][data-omnimux-left-collapsed] [data-slot="conversation.session.header"] header,
html[data-omnimux-sidebar-toggle-topbar][data-omnimux-left-collapsed] [data-slot="conversation.session.header"] > header,
html[data-omnimux-sidebar-toggle-topbar][data-omnimux-left-collapsed] [data-slot="conversation"] > header{
  padding-left:var(--omnimux-topbar-toggle-end)!important;
  padding-top:var(--omnimux-topbar-toggle-top,4px)!important;
  box-sizing:border-box;
}
`

function buildFixture({ state, width, css = PRODUCT_STAGE_CHROME }) {
  const htmlAttrs = ['data-omnimux-sidebar-toggle-topbar']
  if (state !== 'expanded') htmlAttrs.push('data-omnimux-left-collapsed')
  if (state === 'fullscreen') htmlAttrs.push('data-fullscreen')
  const frameAttr = state === 'expanded' ? '' : ' data-sidebar-collapsed="true"'
  const dom = new JSDOM(`<!doctype html><html ${htmlAttrs.join(' ')} style="--omnimux-topbar-toggle-left:84px;--omnimux-topbar-toggle-size:32px;--omnimux-topbar-toggle-gap:8px;--omnimux-topbar-toggle-top:4px;--omnimux-topbar-toggle-end:164px;--omnimux-topbar-new-session-left:124px"><body>
    <div class="dshDesktopFrame"${frameAttr} style="width:${width}px">
      <div data-slot="conversation.header" style="display: contents">
        <header class="uPhUma_header">
          <div class="uPhUma_titleRow">
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
  const style = doc.createElement('style')
  style.textContent = `${BASE_CSS}\n${css}`
  doc.head.append(style)
  return { dom, doc }
}

function readLength(doc, value, fallback) {
  if (!value) return fallback
  const variable = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(String(value).trim())
  if (variable) {
    const resolved = doc.documentElement.style.getPropertyValue(variable[1]).trim()
    if (resolved) return Number.parseFloat(resolved)
    const tail = variable[2] ? Number.parseFloat(variable[2]) : Number.NaN
    return Number.isFinite(tail) ? tail : fallback
  }
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function layout({ dom, doc }, state) {
  const header = doc.querySelector('.uPhUma_header')
  const titleRow = doc.querySelector('.uPhUma_titleRow')
  const headerStyle = dom.window.getComputedStyle(header)
  const rowStyle = dom.window.getComputedStyle(titleRow)
  const headerLeft = state === 'expanded' ? 280 : 0
  const paddingLeft = readLength(doc, headerStyle.paddingLeft, 20)
  const paddingTop = readLength(doc, headerStyle.paddingTop, 0)
  const rowPaddingStart = readLength(doc, rowStyle.paddingInlineStart, 0)
  const titleCluster = {
    x: headerLeft + paddingLeft + rowPaddingStart,
    y: 4 + paddingTop,
    width: 260.5,
    height: 28,
  }
  const openSidebar = { x: 84, y: 4, width: 32, height: 32 }
  const newSession = { x: 124, y: 4, width: 32, height: 32 }
  return {
    headerPaddingLeft: headerStyle.paddingLeft,
    headerPaddingTop: headerStyle.paddingTop,
    titleCluster,
    openSidebar,
    newSession,
  }
}

function intersects(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

describe('DP-003 conversation header padding (real advanced-shell slot DOM)', () => {
  for (const width of WIDTHS) {
    for (const state of STATES) {
      it(`${state} @ ${width}px keeps the title clear of both topbar controls`, () => {
        const fixture = buildFixture({ state, width })
        try {
          const { doc } = fixture
          assert.ok(
            doc.querySelector('[data-slot="conversation.header"] > header > [data-slot="conversation.session.header"]'),
            'fixture must mirror the real nested slot structure',
          )
          const result = layout(fixture, state)
          if (state === 'expanded') {
            assert.equal(result.headerPaddingLeft, '20px', 'expanded rail keeps the official 20px header padding')
            assert.equal(result.titleCluster.x, 300)
          } else {
            assert.match(
              result.headerPaddingLeft,
              /^var\(--omnimux-topbar-toggle-end,\s*164px\)$/,
              'collapsed/hidden/fullscreen rule must reach the real header',
            )
            assert.match(result.headerPaddingTop, /^var\(--omnimux-topbar-toggle-top,\s*4px\)$/)
            assert.equal(result.titleCluster.x, 164)
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

  it('reverting the selector to the legacy dead form makes the guard go red', () => {
    const fixture = buildFixture({ state: 'collapsed', width: 1280, css: REVERTED_CSS })
    try {
      const result = layout(fixture, 'collapsed')
      assert.equal(result.headerPaddingLeft, '20px', 'legacy selector leaves the header at its official 20px padding')
      assert.equal(intersects(result.titleCluster, result.openSidebar), true, 'legacy selector must reproduce the overlap')
      assert.equal(intersects(result.titleCluster, result.newSession), true, 'legacy selector must reproduce the second overlap')
    } finally {
      fixture.dom.window.close()
    }
  })
})
