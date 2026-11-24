import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

async function bundleComponent(relativeEntry, exportName) {
  const bundle = new URL(`./.${exportName}.direct-post-186-test.mjs`, import.meta.url)
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
            export const DropdownSelect = ({ value, options = [], onChange, placeholder, disabled, 'aria-label': ariaLabel }) =>
              React.createElement(
                'select',
                { value: value || '', disabled, 'aria-label': ariaLabel, onChange: (e) => onChange?.(e.target.value) },
                React.createElement('option', { value: '' }, placeholder || ''),
                options.map((o) => React.createElement('option', { key: o.value, value: o.value, disabled: o.disabled }, o.label)),
              )
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
  for (const key of ['window', 'document', 'Node', 'HTMLElement', 'Event', 'IS_REACT_ACT_ENVIRONMENT', 'fetch']) saved[key] = globalThis[key]
  for (const key of ['window', 'document', 'Node', 'HTMLElement', 'Event']) globalThis[key] = dom.window[key]
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
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    await inspect(container, calls, dom.window)
  } finally {
    await act(async () => { root.unmount() })
    Object.assign(globalThis, saved)
    dom.window.close()
  }
}

const t = (key, vars) => {
  if (!vars) return key
  const pairs = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',')
  return `${key} ${pairs}`
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function changeSelect(selectEl, value, win) {
  const setter = Object.getOwnPropertyDescriptor(win.HTMLSelectElement.prototype, 'value').set
  setter.call(selectEl, value)
  selectEl.dispatchEvent(new win.Event('change', { bubbles: true }))
}

test('AC-01/03/04/06/07/08/09: full Direct Post video compliance lifecycle (no default privacy, unchecked interactions, independent dual commercial checkboxes, SELF_ONLY reset, dynamic links, Scheme A publish consent)', async () => {
  const updatePayloads = []
  let submittedId = ''
  await withDom(
    (url, init) => {
      if (url.includes('/capabilities')) return jsonResponse({ platforms: { tiktok: { media_types: ['image', 'video'], max_images: 35 } } })
      if (url.includes('/omnimux/accounts')) {
        return jsonResponse({
          accounts: [
            { id: 'direct-1', platform: 'tiktok', provider: 'tiktok_direct', display_name: 'Alice', username: 'alice_tt', status: 'active', capabilities: { upload_draft: true, publish_direct: true } },
          ],
        })
      }
      if (url.includes('/records/detail?id=rec-video')) {
        return jsonResponse({
          record: { id: 'rec-video', type: 'video', title: 'Demo', description: 'Caption', topics: [], media_ids: ['v1'], account_ids: ['direct-1'], settings: {} },
          media: [{ id: 'v1', kind: 'video', filename: 'clip.mp4', content_type: 'video/mp4', duration_sec: 45 }],
        })
      }
      if (url.includes('creator-info')) {
        return jsonResponse({
          data: {
            creator_nickname: 'Alice Official',
            privacy_level_options: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
            max_video_post_duration_sec: 600,
            comment_disabled: false,
            duet_disabled: true,
            stitch_disabled: false,
          },
        })
      }
      if (url.includes('/drafts/update')) {
        updatePayloads.push(JSON.parse(init.body))
        return jsonResponse({ record: { id: 'rec-video' } })
      }
      if (url.includes('/records/submit')) {
        return jsonResponse({ started: true, record_id: 'rec-video' })
      }
      return jsonResponse({ ok: true })
    },
    () => React.createElement(Composer, { t, draftId: 'rec-video', onBack() {}, onSubmitted(id) { submittedId = id }, onSaved() {} }),
    async (container, _calls, win) => {
      // Creator strip shows nickname and max duration
      assert.match(container.querySelector('[data-testid="creator-nickname"]').textContent, /Alice Official/)
      assert.match(container.querySelector('[data-testid="creator-max-duration"]').textContent, /10m \(600s\)/)

      // AC-01: Privacy level starts empty (no auto-fill to allowed[0]) and Publish button is disabled
      const privacySelect = container.querySelector('select[aria-label="form.options.privacy"]')
      assert.equal(privacySelect.value, '')
      const submitBtn = container.querySelector('[data-testid="composer-submit-btn"]')
      assert.equal(submitBtn.disabled, true)
      assert.match(container.querySelector('[data-testid="submit-disabled-tooltip"]').textContent, /privacy-level-required/)

      // AC-03 & AC-04: All interactions default unchecked (false); Duet is disabled by account
      const commentBtn = container.querySelector('[data-interaction="allow_comment"]')
      const duetBtn = container.querySelector('[data-interaction="allow_duet"]')
      const stitchBtn = container.querySelector('[data-interaction="allow_stitch"]')
      assert.equal(commentBtn.getAttribute('aria-pressed'), 'false')
      assert.equal(duetBtn.getAttribute('aria-pressed'), 'false')
      assert.equal(duetBtn.disabled, true)
      assert.equal(stitchBtn.getAttribute('aria-pressed'), 'false')
      assert.equal(stitchBtn.disabled, false)

      // AC-09: Default compliance declaration has Music Usage Confirmation only (no Branded Policy yet)
      assert.ok(container.querySelector('[data-testid="music-usage-link"]'))
      assert.equal(container.querySelector('[data-testid="branded-policy-link"]'), null)

      // Select SELF_ONLY first -> Publish becomes enabled
      await act(async () => { changeSelect(privacySelect, 'SELF_ONLY', win) })
      assert.equal(privacySelect.value, 'SELF_ONLY')
      assert.equal(submitBtn.disabled, false)

      // AC-06: Toggle commercial disclosure ON with no sub-options -> Publish disabled + tooltip reason
      await act(async () => { container.querySelector('[data-testid="commercial-toggle"]').click() })
      assert.equal(submitBtn.disabled, true)
      assert.match(container.querySelector('[data-testid="submit-disabled-tooltip"]').textContent, /commercial-brand-required/)

      // AC-07: Check Your Brand -> Promotional content preview, Publish enabled
      await act(async () => { container.querySelector('[data-testid="commercial-your-brand"]').click() })
      assert.match(container.querySelector('[data-testid="commercial-label-preview"]').textContent, /promotional/)
      assert.equal(submitBtn.disabled, false)

      // AC-07 & AC-08: Also check Branded Content (independent dual selection!) while SELF_ONLY is selected
      // -> Your Brand stays checked, SELF_ONLY is immediately cleared to '', privacy-reset-notice shown,
      //    label switches to Paid partnership, compliance switches to dual links, SELF_ONLY option disabled!
      await act(async () => { container.querySelector('[data-testid="commercial-branded-content"]').click() })
      assert.equal(container.querySelector('[data-testid="commercial-your-brand"]').getAttribute('aria-pressed'), 'true')
      assert.equal(container.querySelector('[data-testid="commercial-branded-content"]').getAttribute('aria-pressed'), 'true')
      assert.equal(privacySelect.value, '')
      assert.ok(container.querySelector('[data-testid="privacy-reset-notice"]'))
      assert.match(container.querySelector('[data-testid="commercial-label-preview"]').textContent, /paid/)
      assert.ok(container.querySelector('[data-testid="branded-policy-link"]'))
      assert.ok(container.querySelector('[data-testid="music-usage-link"]'))
      const selfOption = [...privacySelect.querySelectorAll('option')].find((o) => o.value === 'SELF_ONLY')
      assert.equal(selfOption.disabled, true)
      assert.equal(submitBtn.disabled, true)

      // Select PUBLIC_TO_EVERYONE + toggle AI disclosure -> Save Draft does NOT set music_usage_confirmed
      await act(async () => { changeSelect(privacySelect, 'PUBLIC_TO_EVERYONE', win) })
      await act(async () => { container.querySelector('[data-testid="direct-aigc-toggle"]').click() })
      assert.equal(submitBtn.disabled, false)
      const saveDraftBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'form.saveDraft')
      await act(async () => { saveDraftBtn.click() })
      assert.equal(updatePayloads[0].patch.settings.tiktok_options.music_usage_confirmed, false)
      assert.equal(updatePayloads[0].patch.settings.is_aigc, true)

      // Click Publish -> Scheme A injects music_usage_confirmed: true and submits!
      await act(async () => { submitBtn.click() })
      assert.equal(updatePayloads[1].patch.settings.tiktok_options.music_usage_confirmed, true)
      assert.equal(updatePayloads[1].patch.settings.tiktok_options.your_brand, true)
      assert.equal(updatePayloads[1].patch.settings.tiktok_options.branded_content, true)
      assert.equal(submittedId, 'rec-video')
    },
  )
})

test('AC-05 & Decision #2 Scheme A: Photo post omits Duet/Stitch from DOM and Sandbox SELF_ONLY disables Branded Content', async () => {
  await withDom(
    (url) => {
      if (url.includes('/capabilities')) return jsonResponse({ platforms: { tiktok: { media_types: ['image', 'video'], max_images: 35 } } })
      if (url.includes('/omnimux/accounts')) {
        return jsonResponse({
          accounts: [
            { id: 'sandbox-1', platform: 'tiktok', provider: 'tiktok_direct', display_name: 'Sandbox', status: 'active', capabilities: { upload_draft: true, publish_direct: true } },
          ],
        })
      }
      if (url.includes('/records/detail?id=rec-photo')) {
        return jsonResponse({
          record: { id: 'rec-photo', type: 'image', title: 'Photos', description: 'Desc', topics: [], media_ids: ['p1'], account_ids: ['sandbox-1'], settings: {} },
          media: [{ id: 'p1', kind: 'image', filename: 'a.jpg', content_type: 'image/jpeg' }],
        })
      }
      if (url.includes('creator-info')) {
        return jsonResponse({
          data: { creator_nickname: 'Sandbox Creator', privacy_level_options: ['SELF_ONLY'], max_video_post_duration_sec: 600 },
        })
      }
      return jsonResponse({ ok: true })
    },
    () => React.createElement(Composer, { t, draftId: 'rec-photo', onBack() {}, onSubmitted() {}, onSaved() {} }),
    async (container) => {
      // Photo DOM must contain Comment ONLY; Duet and Stitch completely absent
      assert.ok(container.querySelector('[data-interaction="allow_comment"]'))
      assert.equal(container.querySelector('[data-interaction="allow_duet"]'), null)
      assert.equal(container.querySelector('[data-interaction="allow_stitch"]'), null)

      // Open Commercial Disclosure -> Branded Content is disabled in Sandbox SELF_ONLY mode
      await act(async () => { container.querySelector('[data-testid="commercial-toggle"]').click() })
      const brandedBtn = container.querySelector('[data-testid="commercial-branded-content"]')
      assert.equal(brandedBtn.disabled, true)
      assert.ok(container.querySelector('[data-testid="branded-sandbox-disabled-hint"]'))
    },
  )
})

test('AC-10/11/13: over-duration video alert, can_post:false fail-closed retry with force=1, and multi-direct account intersection', async () => {
  let attempt = 0
  await withDom(
    (url) => {
      if (url.includes('/capabilities')) return jsonResponse({ platforms: { tiktok: { media_types: ['image', 'video'], max_images: 35 } } })
      if (url.includes('/omnimux/accounts')) {
        return jsonResponse({
          accounts: [
            { id: 'd1', platform: 'tiktok', provider: 'tiktok_direct', display_name: 'Alice', status: 'active', capabilities: { upload_draft: true, publish_direct: true } },
            { id: 'd2', platform: 'tiktok', provider: 'tiktok_direct', display_name: 'Bob', status: 'active', capabilities: { upload_draft: true, publish_direct: true } },
          ],
        })
      }
      if (url.includes('/records/detail?id=rec-multi')) {
        return jsonResponse({
          record: { id: 'rec-multi', type: 'video', title: 'Multi', description: 'Body', topics: [], media_ids: ['v-long'], account_ids: ['d1', 'd2'], settings: {} },
          media: [{ id: 'v-long', kind: 'video', filename: 'long.mp4', content_type: 'video/mp4', duration_sec: 210 }],
        })
      }
      if (url.includes('creator-info') && url.includes('id=d1')) {
        attempt += 1
        if (attempt === 1) {
          return jsonResponse({ data: { creator_nickname: 'Alice', can_post: false, privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], max_video_post_duration_sec: 600 } })
        }
        return jsonResponse({ data: { creator_nickname: 'Alice', can_post: true, privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], max_video_post_duration_sec: 600, duet_disabled: true } })
      }
      if (url.includes('creator-info') && url.includes('id=d2')) {
        return jsonResponse({ data: { creator_nickname: 'Bob', can_post: true, privacy_level_options: ['PUBLIC_TO_EVERYONE'], max_video_post_duration_sec: 180, stitch_disabled: true } })
      }
      return jsonResponse({ ok: true })
    },
    () => React.createElement(Composer, { t, draftId: 'rec-multi', onBack() {}, onSubmitted() {}, onSaved() {} }),
    async (container, calls) => {
      // Initial load: d1 has can_post:false -> fail-closed blocked banner with retry button
      assert.ok(container.querySelector('[data-testid="creator-blocked-banner"]'))
      assert.equal(container.querySelector('[data-testid="composer-submit-btn"]').disabled, true)

      // Click Retry -> sends force=1 for both direct accounts and recovers
      await act(async () => { container.querySelector('[data-testid="creator-info-retry"]').click() })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
      assert.ok(calls.some((c) => c.url.includes('creator-info') && c.url.includes('force=1')))
      assert.equal(container.querySelector('[data-testid="creator-blocked-banner"]'), null)

      // Intersection privacy = ['PUBLIC_TO_EVERYONE'], min duration = 180s (3m), disabled union = Duet + Stitch
      const opts = [...container.querySelectorAll('select[aria-label="form.options.privacy"] option')]
        .map((o) => o.value)
        .filter(Boolean)
      assert.deepEqual(opts, ['PUBLIC_TO_EVERYONE'])
      assert.match(container.querySelector('[data-testid="creator-max-duration"]').textContent, /3m \(180s\)/)
      assert.equal(container.querySelector('[data-interaction="allow_duet"]').disabled, true)
      assert.equal(container.querySelector('[data-interaction="allow_stitch"]').disabled, true)

      // 210s video > 180s min duration -> video-duration-exceeded-alert + badge + disabled submit
      assert.ok(container.querySelector('[data-testid="video-duration-exceeded-alert"]'))
      assert.ok(container.querySelector('[data-testid="video-duration-exceeded-badge"]'))
      assert.equal(container.querySelector('[data-testid="composer-submit-btn"]').disabled, true)
    },
  )
})

test('AC-12: RecordDetail renders direct-processing-notice for Direct Post and keeps it isolated from inbox draft notice', async () => {
  // 1. Direct post subtask -> shows direct-processing-notice, no inbox-draft-notice
  await withDom(
    (url) => {
      if (url.includes('/records/detail')) {
        return jsonResponse({
          record: {
            id: 'rec-direct-1',
            title: 'Live Video',
            settings: { publish_mode: 'direct', tiktok_options: { privacy_level: 'PUBLIC_TO_EVERYONE', music_usage_confirmed: true } },
            subtasks: [{ id: 'tsk-1', platform: 'tiktok', provider: 'tiktok_direct', account_id: 'd1', publish_mode: 'direct', status: 'submitted', post_id: 'v_pub_1' }],
          },
        })
      }
      return jsonResponse({ ok: true })
    },
    () => React.createElement(RecordDetail, { t, recordId: 'rec-direct-1', onBack() {}, onChanged() {} }),
    (container) => {
      assert.ok(container.querySelector('[data-testid="direct-processing-notice"]'))
      assert.equal(container.querySelector('[data-testid="inbox-draft-notice"]'), null)
    },
  )

  // 2. Inbox draft subtask -> shows inbox-draft-notice, NO direct-processing-notice
  await withDom(
    (url) => {
      if (url.includes('/records/detail')) {
        return jsonResponse({
          record: {
            id: 'rec-inbox-1',
            title: 'Inbox Draft',
            settings: { publish_mode: 'draft' },
            subtasks: [{ id: 'tsk-2', platform: 'tiktok', provider: 'tiktok_direct', account_id: 'b1', publish_mode: 'draft', status: 'sent_to_inbox', raw_status: 'SEND_TO_USER_INBOX', post_id: 'v_in_1' }],
          },
        })
      }
      return jsonResponse({ ok: true })
    },
    () => React.createElement(RecordDetail, { t, recordId: 'rec-inbox-1', onBack() {}, onChanged() {} }),
    (container) => {
      assert.ok(container.querySelector('[data-testid="inbox-draft-notice"]'))
      assert.equal(container.querySelector('[data-testid="direct-processing-notice"]'), null)
    },
  )
})
