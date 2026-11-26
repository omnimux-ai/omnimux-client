import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { en, zh } from './locales.js'
import { statusText } from './status-display.js'

function makeTranslator(dict) {
  return (key, vars = {}) => {
    const template = dict[key]
    if (typeof template !== 'string') return key
    return template.replace(/\{(\w+)\}/g, (_m, name) => (name in vars ? String(vars[name]) : `{${name}}`))
  }
}

async function bundleClientModule(relPath) {
  const entry = new URL(relPath, import.meta.url)
  const out = new URL(`./.en340-${relPath.replace(/[^a-z0-9]/gi, '_')}-${process.pid}.mjs`, import.meta.url)
  try {
    await build({
      entryPoints: [fileURLToPath(entry)],
      outfile: fileURLToPath(out),
      bundle: true,
      format: 'esm',
      platform: 'browser',
      jsx: 'automatic',
      external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
      plugins: [{
        name: 'ui-primitives-stub',
        setup(ctx) {
          ctx.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({
            path: 'primitives-stub',
            namespace: 'stub',
          }))
          ctx.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            loader: 'js',
            contents: `
              import React from 'react'
              export const Menu = () => null
              export const Modal = ({ open, children }) => (open ? React.createElement('div', { role: 'dialog' }, children) : null)
              export const Tooltip = ({ children }) => React.createElement(React.Fragment, null, children)
            `,
          }))
        },
      }],
      logLevel: 'silent',
    })
    return await import(`${out.href}?v=${Date.now()}`)
  } finally {
    await rm(fileURLToPath(out), { force: true })
  }
}

const { AssetCard } = await bundleClientModule('./views/AssetCard.jsx')
const { RecordsTable } = await bundleClientModule('./views/RecordsTable.jsx')
const { CalendarView } = await bundleClientModule('./views/CalendarView.jsx')
const { AccountPanel } = await bundleClientModule('./AccountPanel.jsx')
const { Composer } = await bundleClientModule('./Composer/index.jsx')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  const saved = {}
  for (const key of ['window', 'document', 'Node', 'HTMLElement', 'SVGElement', 'getComputedStyle', 'MutationObserver', 'ResizeObserver']) {
    saved[key] = globalThis[key]
    if (key in dom.window) globalThis[key] = dom.window[key]
  }
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  }
  return {
    container: dom.window.document.getElementById('root'),
    restore() {
      for (const [k, v] of Object.entries(saved)) globalThis[k] = v
      dom.window.close()
    },
  }
}

const REAL_RECORDS = [
  {
    id: 'rec_563fa235',
    type: 'video',
    status: 'submitted',
    title: 'OmniMux Direct Post E2E Verification',
    created_at: new Date().toISOString(),
    submitted_at: new Date().toISOString(),
    subtasks: [{ id: 'tsk_1', platform: 'tiktok', provider: 'tiktok_direct', status: 'published', post_id: '21' }],
  },
  {
    id: 'rec_f8d0de07',
    type: 'image',
    status: 'submitted',
    title: 'OmniMux Publishing Sample',
    created_at: new Date().toISOString(),
    submitted_at: new Date().toISOString(),
    subtasks: [
      { id: 'tsk_2', platform: 'tiktok', provider: 'tiktok_direct', status: 'submitted', post_id: '22' },
      { id: 'tsk_3', platform: 'tiktok', provider: 'tiktok_direct', status: 'submitted', post_id: '23' },
    ],
  },
  {
    id: 'rec_d7909e42',
    type: 'image',
    status: 'submitted',
    title: 'OmniMux Failed Sample',
    created_at: new Date().toISOString(),
    submitted_at: new Date().toISOString(),
    subtasks: [{ id: 'tsk_4', platform: 'tiktok', provider: 'tiktok_direct', status: 'failed' }],
  },
]

const noop = () => {}

describe('Issue #340: English locale renders zero hardcoded Chinese in Publish views', () => {
  it('AssetCard renders English status badges and channel count without CJK', async () => {
    const { container, restore } = setupDom()
    const root = createRoot(container)
    const tEn = makeTranslator(en)
    try {
      await act(async () => {
        root.render(React.createElement(
          'div',
          null,
          REAL_RECORDS.map((record) => React.createElement(AssetCard, {
            key: record.id,
            t: tEn,
            record,
            isSelected: false,
            isBatchMode: false,
            onToggleSelect: noop,
            onOpen: noop,
            onEdit: noop,
            onDelete: noop,
            onRetry: noop,
          })),
        ))
      })
      const text = container.textContent || ''
      assert.doesNotMatch(text, /[\u4e00-\u9fff]/, `English AssetCard must not leak CJK: ${text}`)
      assert.ok(text.includes('Published'), 'renders Published')
      assert.ok(text.includes('Publishing'), 'renders Publishing')
      assert.ok(text.includes('Failed'), 'renders Failed')
      assert.ok(text.includes('1 channel'), 'renders singular 1 channel')
      assert.ok(text.includes('2 channels'), 'renders plural 2 channels')
    } finally {
      await act(async () => { root.unmount() })
      restore()
    }
  })

  it('RecordsTable renders English status badges without CJK', async () => {
    const { container, restore } = setupDom()
    const root = createRoot(container)
    const tEn = makeTranslator(en)
    try {
      await act(async () => {
        root.render(React.createElement(RecordsTable, {
          t: tEn,
          records: REAL_RECORDS,
          selectedIds: new Set(),
          onToggleSelect: noop,
          onToggleAll: noop,
          onView: noop,
          onEdit: noop,
          onDelete: noop,
          onRetry: noop,
          sortField: 'date',
          sortOrder: 'desc',
          onSort: noop,
        }))
      })
      const text = container.textContent || ''
      assert.doesNotMatch(text, /[\u4e00-\u9fff]/, `English RecordsTable must not leak CJK: ${text}`)
      assert.ok(text.includes('Published'))
      assert.ok(text.includes('Publishing'))
      assert.ok(text.includes('Failed'))
    } finally {
      await act(async () => { root.unmount() })
      restore()
    }
  })

  it('CalendarView renders English month, week controls, status tooltip and overflow without CJK', async () => {
    const { container, restore } = setupDom()
    const root = createRoot(container)
    const tEn = makeTranslator(en)
    try {
      await act(async () => {
        root.render(React.createElement(CalendarView, {
          t: tEn,
          records: REAL_RECORDS,
          onOpen: noop,
        }))
      })
      const text = container.textContent || ''
      assert.doesNotMatch(text, /[\u4e00-\u9fff]/, `English CalendarView must not leak CJK: ${text}`)
      assert.ok(text.includes('Sun') && text.includes('Mon'))
      assert.ok(text.includes('+1 more'))
      const pills = [...container.querySelectorAll('.omnimux-publish-cal-pill')]
      assert.ok(pills.length > 0)
      assert.doesNotMatch(pills[0].getAttribute('title') || '', /[\u4e00-\u9fff]/)
      assert.ok((pills[0].getAttribute('title') || '').includes('Published'))
    } finally {
      await act(async () => { root.unmount() })
      restore()
    }
  })

  it('AccountPanel uses singular English label for 1 selected account and plural for 2', async () => {
    const { container, restore } = setupDom()
    const originalFetch = globalThis.fetch
    const tEn = makeTranslator(en)
    globalThis.fetch = async () => new Response(JSON.stringify({
      accounts: [
        { id: '2', platform: 'tiktok', provider: 'tiktok_direct', display_name: 'GeminiX', status: 'active', capabilities: { upload_draft: true, publish_direct: true } },
        { id: '3', platform: 'tiktok', provider: 'tiktok_direct', display_name: 'GeminiX', status: 'active', capabilities: { upload_draft: true, publish_direct: false } },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(React.createElement(AccountPanel, { t: tEn, selectedIds: ['2'], onChange: noop }))
      })
      await act(async () => { await Promise.resolve() })
      assert.ok((container.textContent || '').includes('1 account selected'))

      await act(async () => {
        root.render(React.createElement(AccountPanel, { t: tEn, selectedIds: ['2', '3'], onChange: noop }))
      })
      assert.ok((container.textContent || '').includes('2 accounts selected'))
    } finally {
      await act(async () => { root.unmount() })
      globalThis.fetch = originalFetch
      restore()
    }
  })

  it('Composer renders "No video yet" for empty video preview and "No image yet" for empty image preview', async () => {
    const { container, restore } = setupDom()
    const originalFetch = globalThis.fetch
    const tEn = makeTranslator(en)
    globalThis.fetch = async (url) => {
      const s = String(url)
      if (s.includes('/accounts')) return new Response(JSON.stringify({ accounts: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (s.includes('/capabilities')) return new Response(JSON.stringify({ platforms: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(React.createElement(Composer, { t: tEn, onBack: noop, onSaved: noop, onSubmitted: noop }))
      })
      await act(async () => { await Promise.resolve() })
      // Click Video type card
      const videoBtn = [...container.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Video'))
      assert.ok(videoBtn, 'Video type selector exists')
      await act(async () => { videoBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
      await act(async () => { await Promise.resolve() })
      assert.ok((container.textContent || '').includes('No video yet'), 'video preview uses No video yet')
      assert.equal((container.textContent || '').includes('No image yet'), false, 'video preview must not say No image yet')

      // Mount a fresh Composer and pick Image Post to verify empty image preview keeps "No image yet"
      await act(async () => {
        root.render(React.createElement(Composer, { key: 'image-composer', t: tEn, onBack: noop, onSaved: noop, onSubmitted: noop }))
      })
      await act(async () => { await Promise.resolve() })
      const imageBtn = [...container.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Image Post'))
      assert.ok(imageBtn, 'Image Post type selector exists')
      await act(async () => { imageBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
      await act(async () => { await Promise.resolve() })
      assert.ok((container.textContent || '').includes('No image yet'), 'image preview keeps No image yet')
    } finally {
      await act(async () => { root.unmount() })
      globalThis.fetch = originalFetch
      restore()
    }
  })

  it('statusText(status, t) returns localized labels in English and Chinese with safe fallback', () => {
    const tEn = makeTranslator(en)
    const tZh = makeTranslator(zh)
    assert.equal(statusText('draft', tEn), 'Draft')
    assert.equal(statusText('publishing', tEn), 'Publishing')
    assert.equal(statusText('reviewing', tEn), 'In Review')
    assert.equal(statusText('sent_to_inbox', tEn), 'Sent to Inbox Draft')
    assert.equal(statusText('published', tEn), 'Published')
    assert.equal(statusText('partial_failed', tEn), 'Partial Failure')
    assert.equal(statusText('failed', tEn), 'Failed')
    assert.equal(statusText('published', tZh), '已发布')
    assert.equal(statusText('published', (key) => key), '已发布')
    assert.equal(statusText('published'), '已发布')
  })

  it('locales expose symmetric zh/en keys for video preview empty state and channels', () => {
    assert.equal(en['form.preview.emptyVideo'], 'No video yet')
    assert.equal(zh['form.preview.emptyVideo'], '还没有视频')
    assert.equal(en['records.channels.one'], '{count} channel')
    assert.equal(en['records.channels'], '{count} channels')
    assert.equal(zh['records.channels.one'], '{count} 渠道')
    assert.equal(zh['records.channels'], '{count} 渠道')
  })
})
