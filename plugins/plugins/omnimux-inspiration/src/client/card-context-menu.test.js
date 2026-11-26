import './../../tests/fixtures/dom-bootstrap.mjs'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { buildCardMenuEntries } from './card-actions.js'
import { toInspirationCardRow } from './inspiration-card.js'
import { zh } from './locales.js'
import { DOM_RENDER_LOADERS } from '../../tests/fixtures/dom-render-build.mjs'
import { uiKitShimPlugin } from '../../tests/fixtures/ui-kit-shim-plugin.mjs'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const zhMap = new Map(Object.entries(zh))
const t = (key) => zhMap.get(key) || key

async function loadBundle() {
  const result = await build({
    absWorkingDir: join(here, '../..'),
    stdin: {
      contents: `
        export { InspirationCard } from './src/client/InspirationCard.jsx'
        export { InspirationCardMenu } from './src/client/InspirationCardMenu.jsx'
        export { InspirationContextMenu } from './src/client/InspirationContextMenu.jsx'
        export { InspirationDetailSidebar } from './src/client/InspirationDetailSidebar.jsx'
      `,
      resolveDir: join(here, '../..'),
      loader: 'jsx',
    },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    loader: DOM_RENDER_LOADERS,
    external: ['react', 'react-dom', 'react-dom/client'],
    plugins: [uiKitShimPlugin],
  })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, mod, mod.exports)
  return mod.exports
}

describe('InspirationCard & InspirationContextMenu DOM contract', () => {
  it('renders 6 archetypes, toggles favorite without opening card detail, and opens matching context/overflow menus', async () => {
    const { InspirationCard, InspirationContextMenu } = await loadBundle()
    const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', {
      url: 'http://localhost:3000',
      pretendToBeVisual: true,
    })
    const DOM_GLOBALS = ['HTMLButtonElement', 'HTMLElement', 'Element', 'Node', 'HTMLIFrameElement', 'MutationObserver']
    const prevGlobals = Object.fromEntries(DOM_GLOBALS.map((k) => [k, globalThis[k]]))
    const prevWin = globalThis.window
    const prevDoc = globalThis.document
    const prevAct = globalThis.IS_REACT_ACT_ENVIRONMENT
    globalThis.window = dom.window
    globalThis.document = dom.window.document
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    for (const k of DOM_GLOBALS) globalThis[k] = dom.window[k]

    const root = createRoot(dom.window.document.getElementById('host'))
    const calls = { select: 0, fav: 0, ctx: 0, replicate: 0, addCol: 0, del: 0 }

    const row = {
      id: 'insp_art_test',
      is_local: true,
      is_favorite: false,
      source_platform: 'x',
      type: 'link',
      content_shape: 'article',
      title: 'Deep Work Routine',
      excerpt: 'Spend 1 hour building before checking feeds.',
      cover_url: 'https://cdn.example/cover.png',
      author: { name: 'Dan Koe', handle: 'thedankoe' },
      stats: { likes: 5700, shares: 750 },
      velocity: { multiplier: 1.46, top_percent: 4 },
      source_url: 'https://x.com/thedankoe/status/1',
    }
    const descriptor = toInspirationCardRow(row, t)
    const menu = buildCardMenuEntries({
      t,
      local: true,
      inCollection: false,
      sourceUrl: row.source_url,
      isFavorite: row.is_favorite,
      itemId: row.id,
      collections: [{ id: 'c1', title: '写作收藏', item_ids: [] }],
      onToggleFavorite: () => { calls.fav += 1 },
      onShare() {},
      onOpenDetail() {},
      onOpenSidebar() {},
      onAddToConversation() {},
      onAiDeconstruct() {},
      onReplicate: () => { calls.replicate += 1 },
      onOpenOriginal() {},
      onCopyLink() {},
      onAddToCollection: () => { calls.addCol += 1 },
      onCreateCollection() {},
      onDelete: () => { calls.del += 1 },
    })

    function Harness() {
      const [ctxOpen, setCtxOpen] = React.useState(false)
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(InspirationCard, {
          descriptor,
          t,
          menuEntries: menu.entries,
          onMenuSelect: (id) => menu.run(id),
          onSelect: () => { calls.select += 1 },
          onToggleSelect() {},
          onToggleFavorite: () => { calls.fav += 1 },
          onReplicate: () => { calls.replicate += 1 },
          onOpenContextMenu: (e) => {
            e.preventDefault()
            calls.ctx += 1
            setCtxOpen(true)
          },
        }),
        React.createElement(InspirationContextMenu, {
          open: ctxOpen,
          point: { x: 120, y: 140 },
          entries: menu.entries,
          onSelect: (id) => menu.run(id),
          onClose: () => setCtxOpen(false),
        }),
      )
    }

    try {
      await act(async () => {
        root.render(React.createElement(Harness))
      })
      const doc = dom.window.document
      const article = doc.querySelector('article')
      assert.equal(article?.getAttribute('data-archetype'), 'article')
      assert.equal(article?.getAttribute('data-inspiration-id'), 'insp_art_test')

      // Favorite click must not trigger card onSelect
      const favBtn = doc.querySelector('.omx-card-fav')
      assert.ok(favBtn)
      await act(async () => {
        favBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      assert.equal(calls.fav, 1)
      assert.equal(calls.select, 0)

      // Context menu opens unified menu entries
      await act(async () => {
        article.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 140 }))
      })
      assert.equal(calls.ctx, 1)
      const menuEl = doc.querySelector('.omx-card-context-menu')
      assert.ok(menuEl, 'portaled context menu should mount')
      const items = [...doc.querySelectorAll('[role="menuitem"]')].map((n) => n.textContent?.trim())
      assert.ok(items.includes('删除'))
      assert.ok(items.includes('AI 解构灵感'))

      // Hover CTA Replicate click triggers onReplicate without opening detail
      const repBtn = doc.querySelector('.omx-card-act-btn.is-primary')
      assert.ok(repBtn)
      await act(async () => {
        repBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      assert.equal(calls.replicate, 1)
      assert.equal(calls.select, 0)

      // Failed media-less row collapses cleanly without media stage
      const failedRow = {
        id: 'insp_fail_compact',
        is_local: true,
        source_platform: 'instagram',
        type: 'video',
        import_status: 'failed',
        import_error: '素材下载超时',
      }
      await act(async () => {
        root.render(React.createElement(InspirationCard, {
          descriptor: toInspirationCardRow(failedRow, t),
          t,
          menuEntries: [],
        }))
      })
      const failArticle = doc.querySelector('article')
      assert.equal(failArticle?.getAttribute('data-archetype'), 'social-post')
      assert.ok(doc.querySelector('.omx-card-failure.is-failed'))

      // Pinned favorite + failure badge sets multi-badge top-right clearance attribute
      await act(async () => {
        root.render(React.createElement(InspirationCard, {
          descriptor: toInspirationCardRow({ ...failedRow, is_favorite: true }, t),
          t,
          menuEntries: [],
          onToggleFavorite() {},
        }))
      })
      const multiPinned = doc.querySelector('article')
      assert.equal(multiPinned?.getAttribute('data-pinned-tr'), 'true')
      assert.equal(multiPinned?.getAttribute('data-pinned-tr-multi'), 'true')
    } finally {
      await act(async () => root.unmount())
      globalThis.window = prevWin
      globalThis.document = prevDoc
      globalThis.IS_REACT_ACT_ENVIRONMENT = prevAct
      for (const k of DOM_GLOBALS) globalThis[k] = prevGlobals[k]
      dom.window.close()
    }
  })

  it('builds replicate menu disabled when replicateBusy is true', () => {
    const busyMenu = buildCardMenuEntries({
      t,
      local: true,
      replicateBusy: true,
      onReplicate() {},
    })
    const repEntry = busyMenu.entries.find((e) => e.id === 'replicate')
    assert.equal(repEntry?.disabled, true)
  })

  it('keeps ContextMenu mounted with autoFocus and keeps overflow menu keyboard nav unblocked + Escape sidebar-safe', async () => {
    const { InspirationCardMenu, InspirationContextMenu, InspirationDetailSidebar } = await loadBundle()
    const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', {
      url: 'http://localhost:3000',
      pretendToBeVisual: true,
    })
    const prevGlobals = {
      HTMLButtonElement: globalThis.HTMLButtonElement,
      HTMLElement: globalThis.HTMLElement,
      Element: globalThis.Element,
      Node: globalThis.Node,
      HTMLIFrameElement: globalThis.HTMLIFrameElement,
      MutationObserver: globalThis.MutationObserver,
      window: globalThis.window,
      document: globalThis.document,
      IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
      fetch: globalThis.fetch,
    }
    globalThis.window = dom.window
    globalThis.document = dom.window.document
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.HTMLButtonElement = dom.window.HTMLButtonElement
    globalThis.HTMLElement = dom.window.HTMLElement
    globalThis.Element = dom.window.Element
    globalThis.Node = dom.window.Node
    globalThis.HTMLIFrameElement = dom.window.HTMLIFrameElement
    globalThis.MutationObserver = dom.window.MutationObserver
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { id: 'side_1', is_local: true, content: 'demo' } }),
    })

    const root = createRoot(dom.window.document.getElementById('host'))
    const doc = dom.window.document
    let sidebarCloses = 0
    let parentKeyDownCount = 0

    const sampleMenu = buildCardMenuEntries({
      t,
      local: true,
      onOpenDetail() {},
      onReplicate() {},
    })

    function KeyboardHarness({ disabled = false, ctxOpen = false }) {
      return React.createElement(
        'div',
        {
          onKeyDown: (e) => {
            if (e.key === 'ArrowDown' || e.key === 'Escape') parentKeyDownCount += 1
          },
        },
        React.createElement(InspirationCardMenu, {
          t,
          disabled,
          entries: sampleMenu.entries,
          onSelect: () => {},
        }),
        React.createElement(InspirationContextMenu, {
          open: ctxOpen,
          point: { x: 80, y: 80 },
          entries: sampleMenu.entries,
          onSelect: () => {},
          onClose: () => {},
        }),
        React.createElement(InspirationDetailSidebar, {
          row: {
            id: 'side_1',
            is_local: true,
            source_platform: 'x',
            type: 'link',
            content: 'Sidebar escape test post',
            source_url: 'https://x.com/test/status/1',
          },
          t,
          onClose: () => { sidebarCloses += 1 },
        }),
      )
    }

    try {
      // 1) ContextMenu closed initially keeps Menu root span mounted
      await act(async () => {
        root.render(React.createElement(KeyboardHarness, { disabled: false, ctxOpen: false }))
      })
      assert.ok(doc.querySelector('.omx-card-context-menu-root'), 'closed ContextMenu should keep Menu mounted for cleanup/focus')

      // 2) Open overflow menu -> ArrowDown & Escape propagate through wrapper; Escape dismisses menu WITHOUT closing sidebar
      const trigger = doc.querySelector('.omx-card-more-trigger')
      assert.ok(trigger)
      await act(async () => {
        trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      assert.equal(trigger.getAttribute('aria-expanded'), 'true')
      const openMenu = doc.querySelector('.omx-card-context-menu')
      assert.ok(openMenu)

      // Pressing Escape while [role="menu"] is open must NOT close InspirationDetailSidebar
      await act(async () => {
        doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      })
      assert.equal(sidebarCloses, 0, 'Escape while [role="menu"] is open must not close docked sidebar')

      // Opening context menu applies autoFocus inside menu
      await act(async () => {
        root.render(React.createElement(KeyboardHarness, { disabled: false, ctxOpen: true }))
      })
      await new Promise((r) => setTimeout(r, 20))
      const menuItems = [...doc.querySelectorAll('.omx-card-context-menu [role="menuitem"]')]
      assert.ok(menuItems.length > 0)
      assert.equal(doc.activeElement, menuItems[0], 'autoFocus on ContextMenu should focus the first menu item')

      // ArrowDown inside portaled Menu (triggered by overflow trigger) must reach document without wrapper stopPropagation
      const overflowTrigger = doc.querySelector('.omx-card-more-trigger')
      await act(async () => {
        root.render(React.createElement(KeyboardHarness, { disabled: false, ctxOpen: false }))
      })
      await act(async () => {
        overflowTrigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      const overflowFirstItem = doc.querySelector('.omx-card-context-menu [role="menuitem"]')
      assert.ok(overflowFirstItem)
      const countBefore = parentKeyDownCount
      await act(async () => {
        overflowFirstItem.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
      })
      assert.equal(parentKeyDownCount, countBefore + 1, 'InspirationCardMenu wrapper must not stop ArrowDown propagation')

      // Flipping disabled=true resets expanded state cleanly
      await act(async () => {
        root.render(React.createElement(KeyboardHarness, { disabled: true, ctxOpen: false }))
      })
      assert.equal(trigger.getAttribute('aria-expanded'), 'false')
      assert.equal(doc.querySelector('.omx-card-context-menu'), null)

      // When no [role="menu"] is open: prevented Escape is ignored, normal Escape closes docked sidebar
      const preventedEsc = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      preventedEsc.preventDefault()
      await act(async () => {
        dom.window.dispatchEvent(preventedEsc)
      })
      assert.equal(sidebarCloses, 0)
      await act(async () => {
        dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      })
      assert.equal(sidebarCloses, 1)
    } finally {
      await act(async () => root.unmount())
      globalThis.window = prevGlobals.window
      globalThis.document = prevGlobals.document
      globalThis.IS_REACT_ACT_ENVIRONMENT = prevGlobals.IS_REACT_ACT_ENVIRONMENT
      globalThis.HTMLButtonElement = prevGlobals.HTMLButtonElement
      globalThis.HTMLElement = prevGlobals.HTMLElement
      globalThis.Element = prevGlobals.Element
      globalThis.Node = prevGlobals.Node
      globalThis.HTMLIFrameElement = prevGlobals.HTMLIFrameElement
      globalThis.MutationObserver = prevGlobals.MutationObserver
      globalThis.fetch = prevGlobals.fetch
      dom.window.close()
    }
  })

  after(() => {})
})
