import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

async function bundleComponent(relativeEntry, exportName) {
  const bundle = new URL(`./.${exportName}.draft-mode-test.mjs`, import.meta.url)
  await build({
    entryPoints: [fileURLToPath(new URL(relativeEntry, import.meta.url))],
    outfile: fileURLToPath(bundle),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
    plugins: [{
      name: 'ui-mocks',
      setup(ctx) {
        ctx.onResolve({ filter: /^(dsh-ui-kit|@deepseek-ai\/dsh-client-ui-primitives)$/ }, () => ({
          path: 'dsh-ui-kit-mock',
          namespace: 'mock',
        }))
        ctx.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
          loader: 'jsx',
          contents: `
            import React from 'react'
            const Icon = () => React.createElement('span', { 'aria-hidden': 'true' })
            export const IconCheckOutline16 = Icon
            export const IconChevronDownOutline14 = Icon
            export const IconChevronLeftOutline14 = Icon
            export const IconChevronUpOutline14 = Icon
            export const IconPaperclipOutline16 = Icon
            export const IconPlayOutline16 = Icon
            export const IconPlusOutline16 = Icon
            export const IconTrashOutline16 = Icon
            export const IconRefreshOutline16 = Icon
            export const Button = ({ children, leadingIcon, loading, variant, size, ...rest }) =>
              React.createElement('button', { type: rest.type || 'button', ...rest }, children)
            export const InputField = ({ label, value, onChange, placeholder }) =>
              React.createElement('label', null, label, React.createElement('input', { value, onChange, placeholder }))
            export const DropdownSelect = ({ value, options = [], onChange, 'aria-label': ariaLabel }) =>
              React.createElement('select', { value, 'aria-label': ariaLabel, onChange: (e) => onChange?.(e.target.value) },
                options.map((o) => React.createElement('option', { key: o.value, value: o.value }, o.label)))
            export const Toolbar = ({ children }) => React.createElement('div', null, children)
          `,
        }))
      },
    }],
    logLevel: 'silent',
  })
  const mod = await import(bundle.href)
  await rm(fileURLToPath(bundle))
  return mod[exportName]
}

const Composer = await bundleComponent('./Composer/index.jsx', 'Composer')
const RecordDetail = await bundleComponent('./RecordDetail.jsx', 'RecordDetail')

async function withDom(fetchHandler, renderEl, inspect) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const saved = {}
  for (const key of ['window', 'document', 'Node', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT', 'fetch']) saved[key] = globalThis[key]
  for (const key of ['window', 'document', 'Node', 'HTMLElement']) globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return fetchHandler(String(url), init)
  }
  const container = dom.window.document.getElementById('root')
  const root = createRoot(container)
  try {
    await act(async () => { root.render(renderEl()) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    await inspect(container, calls)
  } finally {
    await act(async () => { root.unmount() })
    Object.assign(globalThis, saved)
    dom.window.close()
  }
}

const t = (key) => key

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

test('draft_only account skips creator-info, hides Direct Post options, and shows inbox draft banner', async () => {
  await withDom(
    (url) => {
      if (url.includes('/capabilities')) return jsonResponse({ platforms: { tiktok: { media_types: ['image', 'video'], max_images: 35 } } })
      if (url.includes('/omnimux/accounts')) {
        return jsonResponse({
          accounts: [
            { id: 'draft-1', platform: 'tiktok', provider: 'tiktok_direct', display_name: 'Draft Creator', status: 'active', capabilities: { upload_draft: true, publish_direct: false } },
          ],
        })
      }
      if (url.includes('/records/detail?id=rec-1')) {
        return jsonResponse({
          record: { id: 'rec-1', type: 'video', title: 'Clip', description: 'Desc', topics: [], media_ids: [], account_ids: ['draft-1'], settings: {} },
          media: [],
        })
      }
      return jsonResponse({ ok: true })
    },
    () => React.createElement(Composer, { t, draftId: 'rec-1', onBack() {}, onSubmitted() {}, onSaved() {} }),
    (container, calls) => {
      assert.ok(container.querySelector('[data-testid="draft-mode-banner"]'))
      assert.equal(container.querySelector('[data-testid="direct-post-options"]'), null)
      assert.ok(container.textContent.includes('form.draftSubmit'))
      assert.equal(calls.filter((c) => c.url.includes('creator-info')).length, 0)
    },
  )
})

test('publish_direct account fetches creator-info and renders Direct Post options', async () => {
  await withDom(
    (url) => {
      if (url.includes('/capabilities')) return jsonResponse({ platforms: { tiktok: { media_types: ['image', 'video'], max_images: 35 } } })
      if (url.includes('/omnimux/accounts')) {
        return jsonResponse({
          accounts: [
            { id: 'direct-1', platform: 'tiktok', provider: 'tiktok_direct', display_name: 'Direct Creator', status: 'active', capabilities: { upload_draft: true, publish_direct: true } },
          ],
        })
      }
      if (url.includes('/records/detail?id=rec-2')) {
        return jsonResponse({
          record: { id: 'rec-2', type: 'video', title: 'Direct', description: 'Desc', topics: [], media_ids: [], account_ids: ['direct-1'], settings: {} },
          media: [],
        })
      }
      if (url.includes('creator-info')) {
        return jsonResponse({ data: { privacy_level_options: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'], comment_disabled: false } })
      }
      return jsonResponse({ ok: true })
    },
    () => React.createElement(Composer, { t, draftId: 'rec-2', onBack() {}, onSubmitted() {}, onSaved() {} }),
    (container, calls) => {
      assert.equal(container.querySelector('[data-testid="draft-mode-banner"]'), null)
      assert.ok(container.querySelector('[data-testid="direct-post-options"]'))
      assert.equal(calls.filter((c) => c.url.includes('creator-info')).length, 1)
    },
  )
})

test('legacy_unknown account defaults to collapsed without creator-info until expanded', async () => {
  await withDom(
    (url) => {
      if (url.includes('/capabilities')) return jsonResponse({ platforms: { tiktok: { media_types: ['image', 'video'], max_images: 35 } } })
      if (url.includes('/omnimux/accounts')) {
        return jsonResponse({
          accounts: [
            { id: 'legacy-1', platform: 'tiktok', provider: 'tiktok_direct', display_name: 'Legacy Creator', status: 'active' },
          ],
        })
      }
      if (url.includes('/records/detail?id=rec-3')) {
        return jsonResponse({
          record: { id: 'rec-3', type: 'video', title: 'Legacy', description: 'Desc', topics: [], media_ids: [], account_ids: ['legacy-1'], settings: {} },
          media: [],
        })
      }
      if (url.includes('creator-info')) {
        return jsonResponse({ data: { privacy_level_options: ['SELF_ONLY'] } })
      }
      return jsonResponse({ ok: true })
    },
    () => React.createElement(Composer, { t, draftId: 'rec-3', onBack() {}, onSubmitted() {}, onSaved() {} }),
    async (container, calls) => {
      assert.ok(container.querySelector('[data-testid="legacy-fallback-banner"]'))
      assert.equal(container.querySelector('[data-testid="direct-post-options"]'), null)
      assert.equal(calls.filter((c) => c.url.includes('creator-info')).length, 0)
      const expandBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'form.legacyBanner.expand')
      assert.ok(expandBtn)
      await act(async () => { expandBtn.click() })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
      assert.ok(container.querySelector('[data-testid="direct-post-options"]'))
      assert.equal(calls.filter((c) => c.url.includes('creator-info')).length, 1)
    },
  )
})

test('no_publish_scope account renders scope-missing banner, reconnect button, and disables submit', async () => {
  let managed = 0
  await withDom(
    (url) => {
      if (url.includes('/capabilities')) return jsonResponse({ platforms: { tiktok: { media_types: ['image', 'video'], max_images: 35 } } })
      if (url.includes('/omnimux/accounts')) {
        return jsonResponse({
          accounts: [
            { id: 'noscope-1', platform: 'tiktok', provider: 'tiktok_direct', display_name: 'NoScope', status: 'active', capabilities: { upload_draft: false, publish_direct: false } },
          ],
        })
      }
      if (url.includes('/records/detail?id=rec-4')) {
        return jsonResponse({
          record: { id: 'rec-4', type: 'video', title: 'Blocked', description: 'Desc', topics: [], media_ids: [], account_ids: ['noscope-1'], settings: {} },
          media: [],
        })
      }
      return jsonResponse({ ok: true })
    },
    () => React.createElement(Composer, { t, draftId: 'rec-4', onBack() {}, onManageAccounts: () => { managed += 1 }, onSubmitted() {}, onSaved() {} }),
    async (container) => {
      const banner = container.querySelector('[data-testid="scope-missing-banner"]')
      assert.ok(banner)
      const submitBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'form.submit')
      assert.ok(submitBtn)
      assert.equal(submitBtn.disabled, true)
      const reconnectBtn = [...banner.querySelectorAll('button')].find((b) => b.textContent === 'form.scopeMissing.action')
      assert.ok(reconnectBtn)
      await act(async () => { reconnectBtn.click() })
      assert.equal(managed, 1)
    },
  )
})

test('RecordDetail shows inbox guide, suppresses private notice, and enables manual refresh for sent_to_inbox', async () => {
  await withDom(
    (url) => {
      if (url.includes('/refresh')) {
        return jsonResponse({
          record: {
            id: 'rec-inbox',
            title: 'Inbox Clip',
            subtasks: [{ id: 't1', account_id: 'draft-1', platform: 'tiktok', provider: 'tiktok_direct', publish_mode: 'draft', status: 'published', post_id: 'tt_99', raw_status: 'PUBLISH_COMPLETE' }],
          },
          sync_errors: [],
        })
      }
      return jsonResponse({
        record: {
          id: 'rec-inbox',
          title: 'Inbox Clip',
          subtasks: [{ id: 't1', account_id: 'draft-1', platform: 'tiktok', provider: 'tiktok_direct', publish_mode: 'draft', status: 'sent_to_inbox', post_id: 'tt_99', raw_status: 'SEND_TO_USER_INBOX' }],
        },
      })
    },
    () => React.createElement(RecordDetail, { t, recordId: 'rec-inbox', onBack() {}, onChanged() {} }),
    async (container, calls) => {
      assert.ok(container.querySelector('[data-testid="inbox-draft-notice"]'))
      assert.ok(!container.textContent.includes('detail.privateNotice'))
      const refreshBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'detail.refresh')
      assert.ok(refreshBtn)
      assert.equal(refreshBtn.disabled, false)
      await act(async () => { refreshBtn.click() })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
      assert.ok(calls.some((c) => c.url.includes('/records/refresh')))
    },
  )
})

test('RecordDetail does not flash private notice for in-flight submitted draft upload subtask', async () => {
  await withDom(
    () => jsonResponse({
      record: {
        id: 'rec-submitted-draft',
        title: 'Uploading Draft',
        settings: { publish_mode: 'draft' },
        subtasks: [{ id: 't1', account_id: 'draft-1', platform: 'tiktok', provider: 'tiktok_direct', publish_mode: 'draft', status: 'submitted', post_id: 'tt_100' }],
      },
    }),
    () => React.createElement(RecordDetail, { t, recordId: 'rec-submitted-draft', onBack() {}, onChanged() {} }),
    (container) => {
      assert.ok(!container.textContent.includes('detail.privateNotice'))
      assert.equal(container.querySelector('[data-testid="inbox-draft-notice"]'), null)
    },
  )
})

test('RecordDetail surfaces exact gateway media-limit error message on retry failure without swallowing it', async () => {
  const serverMessage = 'invalid media: too many media_items: max 10'
  await withDom(
    (url) => {
      if (url.includes('/tasks/retry')) {
        return jsonResponse({ error: 'hub-tool-error', message: serverMessage }, 502)
      }
      return jsonResponse({
        record: {
          id: 'rec-over-limit',
          title: 'Too Many Photos',
          subtasks: [{ id: 't-fail', account_id: 'draft-1', platform: 'tiktok', provider: 'tiktok_direct', publish_mode: 'draft', status: 'failed', error: serverMessage }],
        },
      })
    },
    () => React.createElement(RecordDetail, { t, recordId: 'rec-over-limit', onBack() {}, onChanged() {} }),
    async (container) => {
      const retryBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'task.retry')
      assert.ok(retryBtn)
      await act(async () => { retryBtn.click() })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
      const alert = container.querySelector('[role="alert"]')
      assert.ok(alert)
      assert.match(alert.textContent || '', /too many media_items: max 10/)
      assert.doesNotMatch(alert.textContent || '', /35/)
    },
  )
})
