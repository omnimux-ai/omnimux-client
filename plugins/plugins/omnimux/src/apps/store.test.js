import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { parseCatalog } from './parse.js'
import { createAppsStore } from './store.js'

const bundled = parseCatalog({
  schema: 1,
  generated_at: '2026-08-17T00:00:00Z',
  min_hub: '0.1.0',
  apps: [
    {
      id: 'accounts',
      title: '账号',
      summary: '查看并连接已绑定的社媒账号',
      kind: 'official',
      listed: true,
      capabilities: ['identity'],
      client: true,
      spec: { source: 'npm', name: 'omnimux-accounts', version: '0.1.0' },
    },
  ],
})

function newerRemote(overrides = {}) {
  return {
    schema: 1,
    generated_at: '2026-08-18T00:00:00Z',
    min_hub: '0.1.0',
    apps: [
      {
        id: 'accounts',
        title: '账号',
        summary: '查看并连接已绑定的社媒账号',
        kind: 'official',
        listed: false,
        capabilities: ['identity'],
        client: true,
        spec: { source: 'npm', name: 'omnimux-accounts', version: '0.1.0' },
      },
    ],
    ...overrides,
  }
}

function storeDeps(overrides = {}) {
  const home = overrides.home ?? mkdtempSync(join(tmpdir(), 'omnimux-apps-store-'))
  return {
    home,
    profile: 'omnimux',
    apps: { remote: true, catalogUrl: '', ttlSeconds: 21600, timeoutMs: 50 },
    siteBaseUrl: 'https://omnimux.ai',
    hubVersion: '0.1.0',
    loadBundled: () => bundled,
    ...overrides,
  }
}

describe('apps store', () => {
  it('writes a newer remote catalog and hides an unpublished row', async () => {
    const deps = storeDeps({
      fetcher: async () => ({
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(newerRemote()),
      }),
    })
    const store = createAppsStore(deps)
    const view = await store.refreshOnce(true)
    assert.equal(view.source, 'remote')
    assert.deepEqual(view.apps, [])
    assert.equal(existsSync(join(deps.home, 'omnimux', 'apps', 'catalog.json')), true)
  })

  it('keeps the previous view after a 5xx and records the error', async () => {
    const deps = storeDeps({
      fetcher: async () => ({
        status: 503,
        headers: { get: () => null },
        text: async () => 'down',
      }),
    })
    const store = createAppsStore(deps)
    const view = await store.refreshOnce(true)
    assert.equal(view.source, 'bundled')
    assert.equal(view.refresh, 'failed')
    assert.match(view.error, /503/)
    assert.equal(view.apps[0].id, 'accounts')
  })

  it('rejects a remote that needs a newer hub without replacing the floor', async () => {
    const deps = storeDeps({
      fetcher: async () => ({
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(newerRemote({ min_hub: '9.0.0' })),
      }),
    })
    const store = createAppsStore(deps)
    const view = await store.refreshOnce(true)
    assert.equal(view.source, 'bundled')
    assert.equal(view.refresh, 'failed')
    assert.equal(view.apps[0].id, 'accounts')
  })

  it('updates fetched_at on 304 without changing the body', async () => {
    const home = mkdtempSync(join(tmpdir(), 'omnimux-apps-304-'))
    const cacheDir = join(home, 'omnimux', 'apps')
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(join(cacheDir, 'catalog.json'), JSON.stringify({
      schema: 1,
      generated_at: '2026-08-18T00:00:00Z',
      min_hub: '0.1.0',
      apps: [],
    }))
    writeFileSync(join(cacheDir, 'meta.json'), JSON.stringify({
      status: 'ok',
      fetched_at: '2026-08-18T00:00:00Z',
      etag: 'W/"abc"',
    }))
    const store = createAppsStore(storeDeps({
      home,
      now: () => Date.parse('2026-08-18T01:00:00Z'),
      fetcher: async () => ({
        status: 304,
        headers: { get: () => null },
        text: async () => '',
      }),
    }))
    const view = await store.refreshOnce(true)
    assert.equal(view.source, 'cache')
    assert.equal(view.fetched_at, '2026-08-18T01:00:00.000Z')
    assert.deepEqual(view.apps, [])
  })

  it('joins overlapping refreshes into one GET', async () => {
    let calls = 0
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const deps = storeDeps({
      fetcher: async () => {
        calls += 1
        await gate
        return {
          status: 200,
          headers: { get: () => null },
          text: async () => JSON.stringify(newerRemote()),
        }
      },
    })
    const store = createAppsStore(deps)
    const first = store.refreshOnce(true)
    const second = store.refreshOnce(true)
    release()
    await Promise.all([first, second])
    assert.equal(calls, 1)
  })

  it('deletes a disk catalog older than the bundled floor', () => {
    const home = mkdtempSync(join(tmpdir(), 'omnimux-apps-floor-'))
    const older = {
      schema: 1,
      generated_at: '2026-08-01T00:00:00Z',
      min_hub: '0.1.0',
      apps: [],
    }
    const cacheDir = join(home, 'omnimux', 'apps')
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(join(cacheDir, 'catalog.json'), JSON.stringify(older))
    writeFileSync(join(cacheDir, 'meta.json'), JSON.stringify({
      status: 'ok',
      fetched_at: '2026-08-01T00:00:00Z',
      etag: '"old"',
    }))
    const store = createAppsStore(storeDeps({
      home,
      apps: { remote: false, catalogUrl: '', ttlSeconds: 21600, timeoutMs: 50 },
    }))
    const view = store.view()
    assert.equal(view.source, 'bundled')
    assert.equal(existsSync(join(cacheDir, 'catalog.json')), false)
    const meta = JSON.parse(readFileSync(join(cacheDir, 'meta.json'), 'utf8'))
    assert.equal(meta.etag, null)
  })
})
