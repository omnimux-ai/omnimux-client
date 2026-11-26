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
        export { InspirationContextMenu } from './src/client/InspirationContextMenu.jsx'
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
    } finally {
      await act(async () => root.unmount())
      globalThis.window = prevWin
      globalThis.document = prevDoc
      globalThis.IS_REACT_ACT_ENVIRONMENT = prevAct
      for (const k of DOM_GLOBALS) globalThis[k] = prevGlobals[k]
      dom.window.close()
    }
  })

  after(() => {})
})
