import './../../tests/fixtures/dom-bootstrap.mjs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { zh } from './locales.js'
import { DOM_RENDER_LOADERS } from '../../tests/fixtures/dom-render-build.mjs'
import { uiKitShimPlugin } from '../../tests/fixtures/ui-kit-shim-plugin.mjs'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const zhMap = new Map(Object.entries(zh))
const t = (key) => zhMap.get(key) || key

async function loadInspirationUiModules() {
  const result = await build({
    absWorkingDir: join(here, '../..'),
    stdin: {
      contents: `
        export { InspirationDetailSidebar } from './src/client/InspirationDetailSidebar.jsx'
        export { InspirationPreviewModal } from './src/client/InspirationPreviewModal.jsx'
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
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
    plugins: [uiKitShimPlugin],
  })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, mod, mod.exports)
  return mod.exports
}

describe('cloud-to-local creation handoff in docked sidebar and modal (#401)', () => {
  it('completes cloud-to-local creation handoff in one click when body reference is unchanged and isolates loading spinner to clicked button', async () => {
    const { InspirationDetailSidebar } = await loadInspirationUiModules()
    const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { url: 'http://localhost:3000' })
    const prev = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
    globalThis.window = dom.window
    globalThis.document = dom.window.document
    globalThis.IS_REACT_ACT_ENVIRONMENT = true

    let currentRow = {
      id: 'trend-tiktok-758365',
      is_local: false,
      source_platform: 'tiktok',
      source_url: 'https://www.tiktok.com/@thatgirlevia/video/7583655185608707350?utm_source=trend',
      title: 'When you search your boyfriend name',
      content: 'She thought he was perfect... then she typed his name.',
      cover_key: '/omnimux/inspiration/media/cloud-cover.jpg',
      media_items: [{ type: 'video', url: '/omnimux/inspiration/media/cloud-video.mp4', duration: 15 }],
    }
    const promotedRow = {
      id: 'insp_tiktok_local_1',
      is_local: true,
      source_platform: 'tiktok',
      source_url: 'https://www.tiktok.com/@thatgirlevia/video/7583655185608707350',
      title: currentRow.title,
      content: currentRow.content,
      cover_url: '/omnimux/inspiration/local/media/covers/c.jpg',
      media_items: [{ type: 'video', url: '/omnimux/inspiration/local/media/videos/local.mp4', duration: 15 }],
    }

    let releaseImport
    const importStarted = new Promise((resolve) => {
      globalThis.__signalImportStart = resolve
    })
    const calls = []
    const replicatedRows = []
    globalThis.fetch = async (url, init = {}) => {
      const text = String(url)
      if (text.includes('/omnimux/analysis/service')) {
        return { ok: true, status: 200, json: async () => ({ channel: 'official', configured: true, imageToolConfigured: true, revision: 1 }) }
      }
      if (text.endsWith('/omnimux/inspiration/local/import-url') && init.method === 'POST') {
        calls.push('import-url')
        globalThis.__signalImportStart?.()
        await new Promise((resolve) => { releaseImport = resolve })
        return { ok: true, status: 200, json: async () => ({ data: promotedRow }) }
      }
      if (text.endsWith(`/omnimux/inspiration/local/${promotedRow.id}/creation-reference`) && init.method === 'POST') {
        const body = JSON.parse(init.body)
        calls.push({ kind: 'creation-reference', draft: body.draft })
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              ...promotedRow,
              creation_draft: body.draft,
              creation_reference: {
                id: '8a6f0f70-4c9e-4c4b-9e6d-2b1a23f49e11',
                text: body.draft.text,
                basis: body.draft.basis,
                reference_count: body.draft.references.length,
              },
            },
          }),
        }
      }
      if (text.endsWith(`/omnimux/inspiration/local/${promotedRow.id}`)) {
        return { ok: true, status: 200, json: async () => ({ data: promotedRow }) }
      }
      return { ok: true, status: 200, json: async () => ({ data: currentRow }) }
    }

    const container = dom.window.document.getElementById('host')
    const root = createRoot(container)
    let closedCount = 0
    const renderSidebar = () => {
      root.render(React.createElement(InspirationDetailSidebar, {
        key: 'stable-cloud-post',
        row: currentRow,
        t,
        onClose: () => { closedCount += 1 },
        onItemUpdated: (next) => {
          currentRow = next
          renderSidebar()
        },
        onReplicate: async (preparedRow) => {
          replicatedRows.push(preparedRow)
          return { ok: true }
        },
      }))
    }

    try {
      await act(async () => {
        renderSidebar()
        await new Promise((r) => setTimeout(r, 10))
      })

      const bodyBtn = container.querySelector('.omnimux-post-original [aria-pressed]')
      assert.ok(bodyBtn, 'body reference toggle must exist')
      await act(async () => { bodyBtn.click() })

      const createBtn = [...container.querySelectorAll('button')].find((n) => n.textContent.trim() === t('post.create'))
      assert.ok(createBtn, '用于创作 button must enable after selecting 帖子正文')
      await act(async () => { createBtn.click() })

      const drawer = dom.window.document.querySelector('.omnimux-post-creation-drawer')
      assert.ok(drawer, '整理创作参考 drawer must open')
      const saveDraftBtn = [...drawer.querySelectorAll('button')].find((n) => n.textContent.trim() === t('post.saveDraft'))
      const useInChatBtn = [...drawer.querySelectorAll('button')].find((n) => n.textContent.trim() === t('post.useInChat'))
      assert.ok(saveDraftBtn && useInChatBtn)

      await act(async () => {
        useInChatBtn.click()
        await importStarted
      })

      assert.equal(useInChatBtn.getAttribute('aria-busy'), 'true', 'clicked 带入新会话 button must show loading spinner')
      assert.equal(saveDraftBtn.getAttribute('aria-busy'), null, 'unclicked 保存草稿 button must NOT show loading spinner')
      assert.equal(saveDraftBtn.disabled, true, 'both buttons remain disabled while save is in flight')

      await act(async () => {
        releaseImport?.()
        await new Promise((r) => setTimeout(r, 40))
      })

      assert.equal(calls[0], 'import-url')
      assert.equal(calls[1]?.kind, 'creation-reference', 'creation-reference must proceed immediately without savedReview abort')
      assert.deepEqual(calls[1].draft.references, [{ kind: 'body' }])
      assert.equal(dom.window.document.querySelector('[role="alert"]'), null, 'no savedReview error alert should be raised')
      assert.equal(replicatedRows.length, 1, 'handoff must complete in one click')
      assert.equal(replicatedRows[0].id, promotedRow.id)
      assert.equal(currentRow.is_local, true)
      assert.equal(closedCount, 1)
    } finally {
      delete globalThis.__signalImportStart
      await act(async () => { root.unmount() })
      dom.window.close()
      globalThis.window = prev.window
      globalThis.document = prev.document
      globalThis.fetch = prev.fetch
      globalThis.IS_REACT_ACT_ENVIRONMENT = prev.act
    }
  })

  it('requires confirmation when body genuinely changes on cloud promotion but keeps selected references intact', async () => {
    const { InspirationDetailSidebar } = await loadInspirationUiModules()
    const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { url: 'http://localhost:3000' })
    const prev = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
    globalThis.window = dom.window
    globalThis.document = dom.window.document
    globalThis.IS_REACT_ACT_ENVIRONMENT = true

    let currentRow = {
      id: 'trend-cloud-changed',
      is_local: false,
      source_platform: 'tiktok',
      source_url: 'https://www.tiktok.com/@creator/video/7583655185608707351',
      title: 'Changed post',
      content: 'Original catalog caption',
      media_items: [],
    }
    const promotedRow = {
      ...currentRow,
      id: 'insp_local_changed',
      is_local: true,
      content: 'Updated full post caption fetched from origin',
    }

    let importCalls = 0
    let prepareCalls = 0
    const replicatedRows = []
    globalThis.fetch = async (url, init = {}) => {
      const text = String(url)
      if (text.includes('/omnimux/analysis/service')) {
        return { ok: true, status: 200, json: async () => ({ channel: 'official', configured: true, imageToolConfigured: true, revision: 1 }) }
      }
      if (text.endsWith('/omnimux/inspiration/local/import-url') && init.method === 'POST') {
        importCalls += 1
        return { ok: true, status: 200, json: async () => ({ data: promotedRow }) }
      }
      if (text.endsWith(`/omnimux/inspiration/local/${promotedRow.id}/creation-reference`) && init.method === 'POST') {
        prepareCalls += 1
        const body = JSON.parse(init.body)
        return { ok: true, status: 200, json: async () => ({ data: { ...promotedRow, creation_draft: body.draft, creation_reference: { id: '3f1c7a24-7d4b-4b02-b8b2-0c3d4992f320', text: body.draft.text, basis: body.draft.basis } } }) }
      }
      if (text.endsWith(`/omnimux/inspiration/local/${promotedRow.id}`)) {
        return { ok: true, status: 200, json: async () => ({ data: promotedRow }) }
      }
      return { ok: true, status: 200, json: async () => ({ data: currentRow }) }
    }

    const container = dom.window.document.getElementById('host')
    const root = createRoot(container)
    const renderSidebar = () => {
      root.render(React.createElement(InspirationDetailSidebar, {
        key: 'stable-changed-post',
        row: currentRow,
        t,
        onClose: () => {},
        onItemUpdated: (next) => {
          currentRow = next
          renderSidebar()
        },
        onReplicate: async (preparedRow) => {
          replicatedRows.push(preparedRow)
          return { ok: true }
        },
      }))
    }

    try {
      await act(async () => {
        renderSidebar()
        await new Promise((r) => setTimeout(r, 10))
      })
      await act(async () => {
        container.querySelector('.omnimux-post-original [aria-pressed]').click()
      })
      await act(async () => {
        [...container.querySelectorAll('button')].find((n) => n.textContent.trim() === t('post.create')).click()
      })

      const drawer = () => dom.window.document.querySelector('.omnimux-post-creation-drawer')
      const clickUseInChat = () => [...drawer().querySelectorAll('button')].find((n) => n.textContent.trim() === t('post.useInChat')).click()

      await act(async () => {
        clickUseInChat()
        await new Promise((r) => setTimeout(r, 30))
      })

      assert.equal(importCalls, 1)
      assert.equal(prepareCalls, 0, 'body change must still pause once for user confirmation')
      assert.equal(drawer().querySelector('[role="alert"]').textContent, t('post.savedReview'))
      assert.equal(currentRow.id, promotedRow.id, 'item must promote cleanly to local even when pausing for review')
      assert.ok(drawer().querySelector('.omnimux-post-draft-reference'), 'selected body reference must stay checked instead of being wiped')

      await act(async () => {
        clickUseInChat()
        await new Promise((r) => setTimeout(r, 30))
      })

      assert.equal(importCalls, 1, 'second click uses promoted local item without re-importing')
      assert.equal(prepareCalls, 1)
      assert.equal(replicatedRows.length, 1)
    } finally {
      await act(async () => { root.unmount() })
      dom.window.close()
      globalThis.window = prev.window
      globalThis.document = prev.document
      globalThis.fetch = prev.fetch
      globalThis.IS_REACT_ACT_ENVIRONMENT = prev.act
    }
  })

  it('completes modal preview cloud-to-local handoff with canonical URL normalization and manual prose preservation', async () => {
    const { InspirationPreviewModal } = await loadInspirationUiModules()
    const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { url: 'http://localhost:3000' })
    const prev = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
    globalThis.window = dom.window
    globalThis.document = dom.window.document
    globalThis.IS_REACT_ACT_ENVIRONMENT = true

    let currentRow = {
      id: '2789',
      is_local: false,
      title: '云端爆款短视频',
      content: '爆款视频正文文案',
      source_url: 'https://www.tiktok.com/@creator/video/7583655185608709999?utm_source=trend',
      source_platform: 'tiktok',
      media_items: [{ type: 'video', url: '/omnimux/inspiration/media/cloud.mp4', duration: 15 }],
    }
    const promotedRow = {
      ...currentRow,
      id: 'insp_local_modal_1',
      is_local: true,
      source_url: 'https://www.tiktok.com/@other_alias/video/7583655185608709999',
      media_items: [{ type: 'video', url: '/omnimux/inspiration/local/media/videos/local.mp4', duration: 15 }],
    }

    const receipts = []
    let closedCount = 0
    globalThis.fetch = async (url, init = {}) => {
      const path = String(url)
      if (path.includes('/omnimux/analysis/service')) {
        return { ok: true, status: 200, json: async () => ({ channel: 'official', configured: true, imageToolConfigured: true, revision: 1 }) }
      }
      if (path.endsWith('/omnimux/inspiration/local/import-url') && init.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ data: promotedRow }) }
      }
      if (path.endsWith(`/omnimux/inspiration/local/${promotedRow.id}/creation-reference`) && init.method === 'POST') {
        const body = JSON.parse(init.body)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              ...promotedRow,
              creation_draft: body.draft,
              creation_reference: {
                id: 'c8f11e54-6140-4781-9f36-74913f64f111',
                text: body.draft.text,
                basis: body.draft.basis,
                reference_count: body.draft.references.length,
              },
            },
          }),
        }
      }
      if (path.endsWith(`/omnimux/inspiration/local/${promotedRow.id}`)) {
        return { ok: true, status: 200, json: async () => ({ data: promotedRow }) }
      }
      return { ok: true, status: 200, json: async () => ({ data: currentRow }) }
    }

    const container = dom.window.document.getElementById('host')
    const root = createRoot(container)
    const renderModal = () => {
      root.render(React.createElement(InspirationPreviewModal, {
        key: 'modal-cloud-stable',
        row: currentRow,
        t,
        onClose: () => { closedCount += 1 },
        onItemUpdated: (next) => {
          currentRow = next
          renderModal()
        },
        onReplicate: async (preparedRow) => {
          receipts.push(preparedRow)
          return { ok: true }
        },
      }))
    }

    try {
      await act(async () => {
        renderModal()
        await new Promise((r) => setTimeout(r, 15))
      })
      await act(async () => {
        dom.window.document.querySelector('.omnimux-post-original [aria-pressed]').click()
      })
      await act(async () => {
        [...dom.window.document.querySelectorAll('button')].find((n) => n.textContent.trim() === t('post.create')).click()
      })

      const drawer = () => dom.window.document.querySelector('.omnimux-post-creation-drawer')
      const field = drawer().querySelectorAll('textarea')[1]
      await act(async () => {
        field.value = '只按这条手工文案创作脚本'
        field._valueTracker?.setValue?.('')
        field.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      })
      await act(async () => {
        [...drawer().querySelectorAll('button')].find((n) => n.textContent.trim() === t('post.useInChat')).click()
        await new Promise((r) => setTimeout(r, 35))
      })

      assert.equal(drawer(), null, 'drawer closes after successful modal cloud-to-local handoff')
      assert.equal(receipts.length, 1)
      assert.equal(receipts[0].id, promotedRow.id)
      assert.equal(receipts[0].creation_reference.text, '只按这条手工文案创作脚本')
      assert.equal(closedCount, 1)
    } finally {
      await act(async () => { root.unmount() })
      dom.window.close()
      globalThis.window = prev.window
      globalThis.document = prev.document
      globalThis.fetch = prev.fetch
      globalThis.IS_REACT_ACT_ENVIRONMENT = prev.act
    }
  })
})
