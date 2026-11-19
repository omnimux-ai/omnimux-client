import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import fixture from './mock/dashboard-fixture.json' with { type: 'json' }
import { FILTER_DEBOUNCE_MS } from './defaults.js'

const bundle = build({
  stdin: {
    contents: `import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { AnalyticsStage } from './AnalyticsStage.jsx'
      import { analyticsStore } from './store.js'
      const root = createRoot(document.getElementById('root'))
      window.showStage = visible => root.render(<AnalyticsStage t={key => key} visible={visible} />)
      window.store = analyticsStore`,
    resolveDir: dirname(fileURLToPath(import.meta.url)),
    loader: 'jsx',
  },
  bundle: true, write: false, outfile: 'analytics-stage-test.js', format: 'iife', platform: 'browser',
  jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' },
})

async function openStage(t, { quota, auth, fetch }) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', runScripts: 'dangerously' })
  t.after(() => dom.window.close())
  const { window } = dom
  window.structuredClone = structuredClone
  window.__omnimuxQuota = quota
  window.__omnimuxAuth = auth
  window.fetch = fetch
  const script = window.document.createElement('script')
  script.textContent = (await bundle).outputFiles.find(file => file.path.endsWith('.js')).text
  window.document.body.appendChild(script)
  window.showStage(true)
  return window
}

async function waitFor(condition) {
  for (let n = 0; n < 100 && !condition(); n++) await delay(10)
  assert.ok(condition(), 'the dashboard did not reach the expected state')
}

test('only the store reloads a changed dashboard filter and reopening refreshes once', async (t) => {
  let checks = 0
  const page = await openStage(t, {
    quota: { ensureQuota: () => { checks++; return { ok: false, reason: 'quota' } } },
    fetch: () => assert.fail('a denied read reached the Host'),
  })
  await waitFor(() => checks === 1 && page.store.getSnapshot().phase === 'empty')
  page.store.setQuery({ platform: 'tiktok' })
  await delay(FILTER_DEBOUNCE_MS + 75)
  assert.equal(checks, 2)
  page.showStage(false)
  await waitFor(() => page.document.querySelector('[data-visible="false"]'))
  page.showStage(true)
  await waitFor(() => checks === 3)
})

test('logout clears the visible account and a late response cannot replace the next account', async (t) => {
  let identity = { loggedIn: true, id: 1, username: 'A' }
  const observers = new Set()
  let pendingLogin = null
  const auth = {
    getIdentitySnapshot: () => identity,
    subscribeIdentity(fn) { observers.add(fn); return () => observers.delete(fn) },
    ensureLogin(intent) { pendingLogin = intent },
  }
  function publish(next) {
    identity = next
    for (const notify of observers) notify()
  }
  const held = Promise.withResolvers()
  let hold = false
  const reads = []
  const page = await openStage(t, {
    quota: { ensureQuota: () => ({ ok: true }) }, auth,
    fetch: async () => {
      const owner = identity.username
      reads.push(owner)
      if (hold && owner === 'A') await held.promise
      const payload = structuredClone(fixture)
      payload.topPosts = [{ ...fixture.topPosts[0], title: owner + ' account post' }]
      return Response.json(payload)
    },
  })
  const text = () => page.document.body.textContent
  await waitFor(() => text().includes('A account post'))
  hold = true
  const oldRead = page.store.refresh()
  await waitFor(() => reads.length === 8)
  publish({ loggedIn: false, id: null, username: null })
  await waitFor(() => page.document.querySelector('[data-code="unauthorized"]') && !text().includes('A account post'))
  assert.equal(page.store.cache.size, 0)
  assert.equal(page.store.getSnapshot().snapshot, null)
  page.document.querySelector('[data-code="unauthorized"] button').click()
  assert.equal(pendingLogin.kind, 'explicit')
  pendingLogin.onCancel?.()
  await delay(0)
  assert.equal(reads.length, 8)
  publish({ loggedIn: true, id: 2, username: 'B' })
  await waitFor(() => text().includes('B account post'))
  held.resolve()
  await oldRead
  assert.equal(page.store.getSnapshot().snapshot.topPosts[0].title, 'B account post')
  publish(identity)
  await delay(0)
  assert.deepEqual(reads.filter(owner => owner === 'B'), ['B', 'B', 'B', 'B'])
  publish({ loggedIn: true, id: 3, username: 'C' })
  await waitFor(() => text().includes('C account post'))
  assert.equal(text().includes('B account post'), false)
  assert.deepEqual(reads.filter(owner => owner === 'C'), ['C', 'C', 'C', 'C'])
})
