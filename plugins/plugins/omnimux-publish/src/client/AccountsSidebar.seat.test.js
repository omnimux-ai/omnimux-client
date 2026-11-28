import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { en as EN_LOCALES } from './locales.js'

const sourceUrl = new URL('./AccountsSidebar.jsx', import.meta.url)
const mocksUrl = new URL('./AccountsSidebar.disconnect.test-mocks.jsx', import.meta.url)
const bundleUrl = new URL('./.AccountsSidebar.seat.test.bundle.mjs', import.meta.url)

await build({
  entryPoints: [fileURLToPath(sourceUrl)],
  outfile: fileURLToPath(bundleUrl),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  plugins: [{
    name: 'component-mocks',
    setup(buildContext) {
      buildContext.onResolve({ filter: /^(dsh-ui-kit|@deepseek-ai\/dsh-client-ui-primitives)$/ }, () => ({ path: fileURLToPath(mocksUrl) }))
    },
  }],
  logLevel: 'silent',
})
const { AccountsSidebar } = await import(`${bundleUrl.href}?test=${Date.now()}`)
await rm(fileURLToPath(bundleUrl), { force: true })

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function t(key, vars = {}) {
  const template = Object.hasOwn(EN_LOCALES, key) ? EN_LOCALES[key] : key
  return String(template).replace(/\{(\w+)\}/g, (_m, name) => (Object.hasOwn(vars, name) ? String(vars[name]) : `{${name}}`))
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function deferred() {
  /** @type {(value: Response) => void} */
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  const previous = {}
  for (const key of ['window', 'document', 'Node', 'HTMLElement', 'getComputedStyle', 'MutationObserver']) {
    previous[key] = globalThis[key]
    globalThis[key] = dom.window[key]
  }
  return {
    container: dom.window.document.getElementById('root'),
    restore() {
      for (const [key, value] of Object.entries(previous)) globalThis[key] = value
      dom.window.close()
    },
  }
}

async function flush() {
  await act(async () => { await Promise.resolve() })
}

async function click(element) {
  await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
}

function buttonByText(container, text) {
  return [...container.ownerDocument.querySelectorAll('button')].find((button) => button.textContent?.trim() === text)
}

describe('AccountsSidebar seat billing interactions (#412)', () => {
  it('renders zero seat UI when billing_mode is off', async () => {
    const { container, restore } = setupDom()
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (path) => {
      if (String(path) === '/omnimux/accounts/seats') {
        return response({ billing_mode: 'off', seats_purchased: 0, seats_occupied: 0, seats_vacant: 0, seats_cap: 20, vacant_seats: [] })
      }
      return response({
        accounts: [{ id: '1', platform: 'tiktok', provider: 'tiktok_direct', display_name: 'OffAcct', status: 'active' }],
      })
    }
    const root = createRoot(container)
    try {
      await act(async () => { root.render(React.createElement(AccountsSidebar, { t })) })
      await flush()
      assert.equal(container.querySelector('[data-testid="seat-summary"]'), null)
      assert.equal(container.querySelector('.omnimux-publish-accounts-seat-subrow'), null)
      const more = container.querySelector('button[aria-label="More actions for OffAcct"]')
      assert.ok(more)
      await click(more)
      const menuLabels = [...container.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim())
      assert.deepEqual(menuLabels, ['Disconnect'])
    } finally {
      await act(async () => { root.unmount() })
      globalThis.fetch = originalFetch
      restore()
    }
  })

  it('supports manual seat renewal with sync lock, 402 quota notify/retry, disabled 90d limit item, and cap-blocked authorize', async () => {
    const { container, restore } = setupDom()
    const originalFetch = globalThis.fetch
    const quotaEvents = []
    window.__omnimuxQuota = {
      notify(payload, ctx) { quotaEvents.push({ payload, ctx }) },
    }
    const pendingRenew = deferred()
    let renewCalls = 0
    let seatCapMode = false
    const futureExpiry = new Date(Date.now() + 75 * 86400_000).toISOString()
    const graceUntil = new Date(Date.now() + 5 * 86400_000).toISOString()
    const renewedExpiry = new Date(Date.now() + 30 * 86400_000).toISOString()
    let frozenRenewed = false

    globalThis.fetch = async (path, init = {}) => {
      const url = String(path)
      if (url.endsWith('/renew?provider=tiktok_direct') && init.method === 'POST') {
        renewCalls += 1
        if (renewCalls === 1) return pendingRenew.promise
        frozenRenewed = true
        return response({
          account_id: '2',
          seat: { id: 12, status: 'active', expires_at: renewedExpiry, can_renew: true, price_credits: 20 },
        })
      }
      if (url === '/omnimux/accounts/seats') {
        return response({
          billing_mode: 'seat',
          seats_purchased: seatCapMode ? 20 : 3,
          seats_occupied: seatCapMode ? 20 : 2,
          seats_vacant: seatCapMode ? 0 : 1,
          seats_cap: 20,
          seat_price_credits: 20,
          max_validity_days: 90,
          vacant_seats: seatCapMode ? [] : [{ id: 14, expires_at: renewedExpiry, swaps_remaining: 2, same_account_only: false }],
        })
      }
      return response({
        accounts: [
          {
            id: '1',
            platform: 'tiktok',
            provider: 'tiktok_direct',
            display_name: 'CappedAcct',
            username: 'capped',
            status: 'active',
            seat: {
              id: 11,
              status: 'active',
              expires_at: futureExpiry,
              swaps_remaining: 2,
              can_renew: false,
              renew_blocked_reason: 'SOCIAL_SEAT_RENEW_LIMIT',
              price_credits: 20,
            },
          },
          {
            id: '2',
            platform: 'tiktok',
            provider: 'tiktok_direct',
            display_name: 'FrozenAcct',
            username: 'frozen',
            status: 'active',
            seat: frozenRenewed
              ? { id: 12, status: 'active', expires_at: renewedExpiry, swaps_remaining: 2, can_renew: true, price_credits: 20 }
              : { id: 12, status: 'frozen', expires_at: '2026-11-20T00:00:00Z', grace_until: graceUntil, swaps_remaining: 2, can_renew: true, price_credits: 20 },
          },
        ],
      })
    }

    const root = createRoot(container)
    try {
      await act(async () => { root.render(React.createElement(AccountsSidebar, { t })) })
      await flush()

      assert.ok(container.querySelector('[data-testid="seat-summary"]')?.textContent?.includes('Seats 3/20'))
      assert.ok(container.querySelector('[data-testid="seat-summary"]')?.textContent?.includes('1 open'))
      assert.ok(container.textContent.includes('Seat Frozen'))

      const moreCapped = container.querySelector('button[aria-label="More actions for CappedAcct"]')
      assert.ok(moreCapped)
      await click(moreCapped)
      const menuItems = [...container.querySelectorAll('[role="menuitem"]')]
      const limitItem = menuItems.find((el) => el.textContent?.includes('90-day validity limit reached'))
      assert.ok(limitItem, '90-day limit menu item is rendered')
      assert.equal(limitItem.disabled, true)

      await click(menuItems.find((el) => el.textContent?.trim() === 'Disconnect'))
      assert.ok(container.textContent.includes('2 cross-account swap(s) remaining'))
      await click(buttonByText(container, 'Cancel'))

      const renewBtn = buttonByText(container, 'Renew 20 cr')
      assert.ok(renewBtn, 'inline renew button rendered for frozen seat')
      await click(renewBtn)
      assert.ok(container.textContent.includes('Renew Account Seat'))
      assert.ok(container.textContent.includes('20 credits (30 days)'))

      const confirmBtn = buttonByText(container, 'Renew (20 credits)')
      assert.ok(confirmBtn)
      await act(async () => {
        confirmBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
        confirmBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      })
      assert.equal(renewCalls, 1)
      pendingRenew.resolve(response({ error: 'quota-exceeded', code: 'SOCIAL_SEAT_QUOTA', need_credits: 20 }, 402))
      await flush()
      assert.equal(quotaEvents.length, 1)
      assert.equal(quotaEvents[0].payload.status, 402)
      assert.ok(container.textContent.includes('Insufficient credits (20 required)'))

      seatCapMode = true
      await click(buttonByText(container, 'Retry'))
      await flush()
      assert.equal(renewCalls, 2)
      assert.equal(container.querySelector('[role="dialog"]'), null)
      assert.equal(container.textContent.includes('Seat Frozen'), false)
      assert.ok(container.querySelector('[data-testid="seat-summary"]')?.textContent?.includes('Cap reached'))

      await click(buttonByText(container, 'Add Account'))
      const notice = container.querySelector('[data-testid="authorize-seat-notice"]')
      assert.ok(notice?.textContent?.includes('Seat limit reached (20/20)'))
      const authGo = buttonByText(container, 'Authorize')
      assert.ok(authGo)
      assert.equal(authGo.disabled, true)
    } finally {
      await act(async () => { root.unmount() })
      globalThis.fetch = originalFetch
      restore()
    }
  })
})
