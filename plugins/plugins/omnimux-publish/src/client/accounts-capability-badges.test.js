import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { accountCapabilityBadge } from './account-sidebar-view.js'

const mocksUrl = new URL('./AccountsSidebar.disconnect.test-mocks.jsx', import.meta.url)

async function bundleComponent(relPath) {
  const out = new URL(`./.cap341-${relPath.replace(/[^a-z0-9]/gi, '_')}-${process.pid}.mjs`, import.meta.url)
  try {
    await build({
      entryPoints: [fileURLToPath(new URL(relPath, import.meta.url))],
      outfile: fileURLToPath(out),
      bundle: true,
      format: 'esm',
      platform: 'browser',
      jsx: 'automatic',
      external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
      plugins: [{
        name: 'ui-mocks',
        setup(ctx) {
          ctx.onResolve({ filter: /^(dsh-ui-kit|@deepseek-ai\/dsh-client-ui-primitives)$/ }, () => ({
            path: fileURLToPath(mocksUrl),
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

const { AccountsSidebar } = await bundleComponent('./AccountsSidebar.jsx')
const { RecordDetail } = await bundleComponent('./RecordDetail.jsx')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const LABELS = {
  'acct.title': 'Accounts',
  'acct.add': 'Add Account',
  'acct.searchPlaceholder': 'Search accounts…',
  'acct.loading': 'Loading…',
  'acct.empty': 'Empty',
  'acct.panel.title': 'TikTok Authorization',
  'acct.panel.body': 'Panel body',
  'acct.status.connected': 'Connected',
  'acct.status.expired': 'Expired',
  'acct.status.error': 'Error',
  'acct.agentOff': 'Agent off',
  'acct.disconnect': 'Disconnect',
  'acct.disconnectTitle': 'Disconnect account',
  'acct.retry': 'Retry',
  'auth.cancel': 'Cancel',
  'accounts.cap.draft': 'Inbox draft',
  'accounts.cap.direct': 'Direct post',
  'accounts.cap.noScope': 'No publish scope',
  'platform.tiktok': 'TikTok',
  'task.published': 'Published',
  close: 'Close',
}

function makeT() {
  return (key, vars = {}) => {
    if (key === 'acct.more') return `More actions for ${String(vars.name ?? '')}`
    if (key === 'acct.disconnectConfirm') return `Disconnect ${String(vars.name ?? '')}?`
    return LABELS[key] ?? key
  }
}

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  const saved = {}
  for (const key of ['window', 'document', 'Node', 'HTMLElement', 'getComputedStyle', 'MutationObserver']) {
    saved[key] = globalThis[key]
    globalThis[key] = dom.window[key]
  }
  return {
    container: dom.window.document.getElementById('root'),
    restore() {
      for (const [k, v] of Object.entries(saved)) globalThis[k] = v
      dom.window.close()
    },
  }
}

describe('Issue #341: AccountsSidebar capability badges and RecordDetail account names', () => {
  it('accountCapabilityBadge maps Direct post, Inbox draft, No publish scope, and legacy rows', () => {
    const t = makeT()
    assert.deepEqual(
      accountCapabilityBadge(t, { capabilities: { upload_draft: true, publish_direct: true } }),
      { label: 'Direct post', tone: 'direct' },
    )
    assert.deepEqual(
      accountCapabilityBadge(t, { capabilities: { upload_draft: true, publish_direct: false } }),
      { label: 'Inbox draft', tone: 'draft' },
    )
    assert.deepEqual(
      accountCapabilityBadge(t, { capabilities: { upload_draft: false, publish_direct: false } }),
      { label: 'No publish scope', tone: 'warn' },
    )
    assert.equal(accountCapabilityBadge(t, { id: 'legacy' }), null)
  })

  it('AccountsSidebar renders capability badges to distinguish same-name accounts (including handleless rows)', async () => {
    const { container, restore } = setupDom()
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(JSON.stringify({
      accounts: [
        { id: '3', platform: 'tiktok', provider: 'tiktok_direct', display_name: 'GeminiX', username: 'GeminiX', status: 'active', capabilities: { upload_draft: true, publish_direct: false } },
        { id: '2', platform: 'tiktok', provider: 'tiktok_direct', display_name: 'GeminiX', username: 'GeminiX', status: 'active', capabilities: { upload_draft: true, publish_direct: true } },
        { id: '4', platform: 'tiktok', provider: 'tiktok_direct', display_name: 'NoHandle', status: 'active', capabilities: { upload_draft: false, publish_direct: false } },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    const root = createRoot(container)
    try {
      await act(async () => { root.render(React.createElement(AccountsSidebar, { t: makeT() })) })
      await act(async () => { await Promise.resolve() })
      const items = [...container.querySelectorAll('.omnimux-publish-accounts-item')]
      assert.equal(items.length, 3)
      assert.equal(items[0].querySelector('.omnimux-publish-cap-badge.draft')?.textContent, 'Inbox draft')
      assert.equal(items[1].querySelector('.omnimux-publish-cap-badge.direct')?.textContent, 'Direct post')
      assert.equal(items[2].querySelector('.omnimux-publish-cap-badge.warn')?.textContent, 'No publish scope')
    } finally {
      await act(async () => { root.unmount() })
      globalThis.fetch = originalFetch
      restore()
    }
  })

  it('RecordDetail resolves official subtask account_id to display name, isolates colliding non-official rows, and falls back safely', async () => {
    const { container, restore } = setupDom()
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (url) => {
      if (String(url).includes('/omnimux/accounts')) {
        return new Response(JSON.stringify({
          accounts: [
            { id: '2', platform: 'tiktok', provider: 'tiktok_direct', display_name: 'GeminiX', username: 'geminix56', status: 'active' },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        record: {
          id: 'rec_563fa235',
          title: 'Direct Post Video',
          subtasks: [
            { id: 'tsk_official', account_id: '2', platform: 'tiktok', provider: 'tiktok_direct', status: 'published', post_id: '21' },
            { id: 'tsk_missing', account_id: '99', platform: 'tiktok', provider: 'tiktok_direct', status: 'published', post_id: '22' },
            { id: 'tsk_zernio', account_id: '2', platform: 'tiktok', provider: 'zernio', status: 'failed', post_id: 'z1' },
          ],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(React.createElement(RecordDetail, { t: makeT(), recordId: 'rec_563fa235', onBack() {}, onChanged() {} }))
      })
      await act(async () => { await Promise.resolve() })
      const rows = [...container.querySelectorAll('.omnimux-publish-task-row')]
      assert.equal(rows.length, 3)
      // 1. Official subtask resolves to display_name
      assert.ok((rows[0].textContent || '').includes('GeminiX'), `expected GeminiX, got: ${rows[0].textContent}`)
      assert.equal((rows[0].textContent || '').includes('·'), false, 'must not render middle dot separator')
      // 2. Disconnected/unknown official account falls back to raw account_id
      assert.ok((rows[1].textContent || '').includes('99'), `expected fallback 99, got: ${rows[1].textContent}`)
      // 3. Colliding non-official (zernio) subtask with account_id='2' must NOT receive official GeminiX name
      assert.equal((rows[2].textContent || '').includes('GeminiX'), false, `non-official row leaked official display name: ${rows[2].textContent}`)
      assert.ok((rows[2].textContent || '').includes('2'), `non-official row must keep raw id 2: ${rows[2].textContent}`)
    } finally {
      await act(async () => { root.unmount() })
      globalThis.fetch = originalFetch
      restore()
    }
  })

  it('RecordDetail keeps raw account_id when /omnimux/accounts fails or rejects', async () => {
    const { container, restore } = setupDom()
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (url) => {
      if (String(url).includes('/omnimux/accounts')) {
        return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        record: {
          id: 'rec_fail_acct',
          title: 'Fallback Video',
          subtasks: [
            { id: 'tsk_1', account_id: '2', platform: 'tiktok', provider: 'tiktok_direct', status: 'published', post_id: '21' },
          ],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(React.createElement(RecordDetail, { t: makeT(), recordId: 'rec_fail_acct', onBack() {}, onChanged() {} }))
      })
      await act(async () => { await Promise.resolve() })
      const row = container.querySelector('.omnimux-publish-task-row')
      assert.ok(row)
      assert.ok((row.textContent || '').includes('2'))
    } finally {
      await act(async () => { root.unmount() })
      globalThis.fetch = originalFetch
      restore()
    }
  })
})
