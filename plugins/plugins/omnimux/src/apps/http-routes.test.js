import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createAppsDispatcher } from './http-routes.js'
import { parseCatalog } from './parse.js'
import { createAppsStore } from './store.js'
import { createTabsStore } from './tabs.js'

function emptyCatalog() {
  return parseCatalog({
    schema: 1,
    generated_at: '2026-08-17T00:00:00Z',
    min_hub: '0.1.0',
    apps: [],
  })
}

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'omnimux-apps-http-'))
}

describe('apps dispatcher', () => {
  it('serves the bundled empty catalog', async () => {
    const dispatcher = createAppsDispatcher({
      env: { DSH_HOME: tempHome() },
      store: createAppsStore({
        home: tempHome(),
        profile: 'omnimux',
        apps: { remote: false, catalogUrl: '', ttlSeconds: 21600, timeoutMs: 5000 },
        siteBaseUrl: 'https://omnimux.ai',
        loadBundled: emptyCatalog,
      }),
    })
    const result = await dispatcher.dispatch({ method: 'GET', url: '/omnimux/apps' })
    assert.equal(result.status, 200)
    assert.equal(result.body.source, 'bundled')
    assert.equal(result.body.refresh, 'idle')
    assert.deepEqual(result.body.apps, [])
  })

  it('returns 500 when the bundled catalog cannot be loaded', async () => {
    const dispatcher = createAppsDispatcher({
      env: { DSH_HOME: tempHome() },
      store: createAppsStore({
        home: tempHome(),
        profile: 'omnimux',
        apps: { remote: false, catalogUrl: '', ttlSeconds: 21600, timeoutMs: 5000 },
        siteBaseUrl: 'https://omnimux.ai',
        loadBundled() {
          throw new Error('bundled apps catalog is missing')
        },
      }),
    })
    const result = await dispatcher.dispatch({ method: 'GET', url: '/omnimux/apps' })
    assert.equal(result.status, 500)
    assert.match(result.body.error, /missing/)
  })

  it('does not list unmarked profile plugins', async () => {
    const dispatcher = createAppsDispatcher({
      env: { DSH_HOME: '/tmp/not-a-profile' },
      store: createAppsStore({
        home: '/tmp/not-a-profile',
        profile: 'omnimux',
        apps: { remote: false, catalogUrl: '', ttlSeconds: 21600, timeoutMs: 5000 },
        siteBaseUrl: 'https://omnimux.ai',
        loadBundled: emptyCatalog,
      }),
    })
    const result = await dispatcher.dispatch({ method: 'GET', url: '/omnimux/apps' })
    assert.equal(result.status, 200)
    assert.ok(!JSON.stringify(result.body).includes('dsh-cron-parse'))
  })

  it('does not fetch when remote is off', async () => {
    let calls = 0
    const dispatcher = createAppsDispatcher({
      env: { DSH_HOME: tempHome() },
      store: createAppsStore({
        home: tempHome(),
        profile: 'omnimux',
        apps: { remote: false, catalogUrl: '', ttlSeconds: 21600, timeoutMs: 5000 },
        siteBaseUrl: 'https://omnimux.ai',
        loadBundled: emptyCatalog,
        fetcher: async () => {
          calls += 1
          throw new Error('network should stay quiet')
        },
      }),
    })
    await dispatcher.dispatch({ method: 'GET', url: '/omnimux/apps' })
    await dispatcher.dispatch({ method: 'POST', url: '/omnimux/apps/refresh' })
    assert.equal(calls, 0)
  })

  it('refuses a cross-origin refresh', async () => {
    const dispatcher = createAppsDispatcher({
      env: { DSH_HOME: tempHome() },
      store: createAppsStore({
        home: tempHome(),
        profile: 'omnimux',
        apps: { remote: false, catalogUrl: '', ttlSeconds: 21600, timeoutMs: 5000 },
        siteBaseUrl: 'https://omnimux.ai',
        loadBundled: emptyCatalog,
      }),
    })
    const result = await dispatcher.dispatch({
      method: 'POST',
      url: '/omnimux/apps/refresh',
      origin: 'https://evil.example',
    })
    assert.equal(result.status, 403)
  })
})

/**
 * Duck-typed apps store whose shelf holds one installed accounts row plus one
 * available row, so tabs view filtering is observable without disk fixtures.
 */
function fakeAppsStore(state = 'installed') {
  return {
    view() {
      return {
        schema: 1,
        source: 'bundled',
        stale: false,
        fetched_at: null,
        refresh: 'idle',
        error: null,
        apps: [
          {
            id: 'accounts',
            title: '账号',
            summary: '',
            kind: 'official',
            capabilities: [],
            client: true,
            spec: { source: 'npm', name: 'omnimux-accounts', version: '0.1.0' },
            state,
            install_spec: 'omnimux-accounts@0.1.0',
          },
          {
            id: 'other-app',
            title: '其他',
            summary: '',
            kind: 'official',
            capabilities: [],
            client: true,
            spec: { source: 'npm', name: 'dsh-other-app', version: '0.1.0' },
            state: 'available',
            install_spec: 'dsh-other-app@0.1.0',
          },
        ],
      }
    },
    maybeRefresh() {},
    async refreshOnce() {
      return this.view()
    },
  }
}

describe('apps dispatcher tabs endpoints', () => {
  function tabsDispatcher(state = 'installed') {
    const home = tempHome()
    return {
      home,
      dispatcher: createAppsDispatcher({
        env: { DSH_HOME: home },
        store: fakeAppsStore(state),
        tabsStore: createTabsStore({ home, now: () => Date.parse('2026-08-20T07:00:00Z') }),
      }),
    }
  }

  it('serves an empty view before any open', async () => {
    const { dispatcher } = tabsDispatcher()
    const result = await dispatcher.dispatch({ method: 'GET', url: '/omnimux/apps/tabs' })
    assert.equal(result.status, 200)
    assert.deepEqual(result.body, { schema: 1, tabs: [] })
  })

  it('upserts a tab on open and filters uninstalled rows from the view', async () => {
    const { dispatcher, home } = tabsDispatcher()
    const created = await dispatcher.dispatch({ method: 'POST', url: '/omnimux/apps/tabs/accounts' })
    assert.equal(created.status, 200)
    assert.deepEqual(created.body.tabs, [
      { id: 'accounts', title: '账号', pinned: false, lastOpenedAt: '2026-08-20T07:00:00.000Z' },
    ])
    // The row is persisted even though the other catalog row stays available.
    assert.equal(createTabsStore({ home, now: () => 0 }).list().tabs.length, 1)

    const hidden = tabsDispatcher('available').dispatcher
    const vacant = await hidden.dispatch({ method: 'POST', url: '/omnimux/apps/tabs/other-app' })
    assert.equal(vacant.status, 200)
    assert.deepEqual(vacant.body.tabs, [])
  })

  it('rejects invalid ids and unknown catalog ids', async () => {
    const { dispatcher } = tabsDispatcher()
    const badId = await dispatcher.dispatch({ method: 'POST', url: '/omnimux/apps/tabs/X!' })
    assert.equal(badId.status, 400)
    const unknown = await dispatcher.dispatch({ method: 'POST', url: '/omnimux/apps/tabs/ghost-app' })
    assert.equal(unknown.status, 404)
  })

  it('patches pin and top, and rejects bad bodies or missing rows', async () => {
    const { dispatcher } = tabsDispatcher()
    await dispatcher.dispatch({ method: 'POST', url: '/omnimux/apps/tabs/accounts' })
    const pinned = await dispatcher.dispatch({
      method: 'PATCH',
      url: '/omnimux/apps/tabs/accounts',
      body: { pinned: true },
    })
    assert.equal(pinned.status, 200)
    assert.equal(pinned.body.tabs[0].pinned, true)
    const topped = await dispatcher.dispatch({
      method: 'PATCH',
      url: '/omnimux/apps/tabs/accounts',
      body: { order: 'top' },
    })
    assert.equal(topped.status, 200)
    const badBody = await dispatcher.dispatch({
      method: 'PATCH',
      url: '/omnimux/apps/tabs/accounts',
      body: { pinned: 'yes' },
    })
    assert.equal(badBody.status, 400)
    const both = await dispatcher.dispatch({
      method: 'PATCH',
      url: '/omnimux/apps/tabs/accounts',
      body: { pinned: true, order: 'top' },
    })
    assert.equal(both.status, 400)
    const missing = await dispatcher.dispatch({
      method: 'PATCH',
      url: '/omnimux/apps/tabs/other-app',
      body: { pinned: true },
    })
    assert.equal(missing.status, 404)
  })

  it('deletes a tab and 404s on the second delete', async () => {
    const { dispatcher } = tabsDispatcher()
    await dispatcher.dispatch({ method: 'POST', url: '/omnimux/apps/tabs/accounts' })
    const removed = await dispatcher.dispatch({ method: 'DELETE', url: '/omnimux/apps/tabs/accounts' })
    assert.equal(removed.status, 200)
    assert.deepEqual(removed.body.tabs, [])
    const again = await dispatcher.dispatch({ method: 'DELETE', url: '/omnimux/apps/tabs/accounts' })
    assert.equal(again.status, 404)
  })

  it('refuses cross-origin tab writes', async () => {
    const { dispatcher } = tabsDispatcher()
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const result = await dispatcher.dispatch({
        method,
        url: '/omnimux/apps/tabs/accounts',
        body: method === 'PATCH' ? { pinned: true } : undefined,
        origin: 'https://evil.example',
      })
      assert.equal(result.status, 403, method)
    }
  })

  it('treats a corrupt tabs.json as an empty table', async () => {
    const { dispatcher, home } = tabsDispatcher()
    mkdirSync(join(home, 'omnimux', 'apps'), { recursive: true })
    writeFileSync(join(home, 'omnimux', 'apps', 'tabs.json'), '{not json', { mode: 0o600 })
    const result = await dispatcher.dispatch({ method: 'GET', url: '/omnimux/apps/tabs' })
    assert.equal(result.status, 200)
    assert.deepEqual(result.body, { schema: 1, tabs: [] })
  })
})
