import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createAccountCatalog } from './account-view.js'

const siteBaseUrl = 'https://catalog.example.test'

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'catalog-view-test-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  let account = ''
  let tokenReads = 0
  const select = (id) => { account = id }
  return {
    select,
    tokenReads: () => tokenReads,
    home,
    bundledDir: join(home, 'no-bundled'),
    url: `${siteBaseUrl}/api/pricing`,
    siteBaseUrl,
    remote: true,
    identity: { getSnapshot: () => ({ logged_in: Boolean(account), id: account }) },
    store: { resolve: async () => { tokenReads++; return 'fixture-session' } },
    ttlSeconds: 600,
    timeoutMs: 5000,
  }
}

function pricing(name) {
  const group = `group-${name}`
  return {
    success: true,
    group_ratio: { [group]: 1 },
    usable_group: { [group]: group },
    data: [{ model_name: `model-${name}`, enable_groups: [group] }],
  }
}

test('member refresh never publishes a reply from the previous account', async (t) => {
  const setup = fixture(t)
  let releaseOld
  let startedOld
  const oldStarted = new Promise((resolve) => { startedOld = resolve })
  const catalog = createAccountCatalog({
    ...setup,
    fetchImpl: async (_url, options) => {
      const account = options.headers['New-Api-User']
      if (account === 'first') {
        assert.equal(options.redirect, 'error')
        assert.equal(options.cache, 'no-store')
        assert.equal(options.headers.Authorization, 'Bearer fixture-session')
        startedOld()
        return new Promise((resolve) => { releaseOld = resolve })
      }
      return Response.json(pricing(account || 'public'))
    },
  })

  setup.select('first')
  const old = catalog.refreshOnce(true)
  await oldStarted
  setup.select('second')
  await catalog.refreshOnce(true)
  assert.deepEqual(catalog.resolve().snapshot.models.map((m) => m.id), ['model-second'])
  releaseOld(Response.json(pricing('first')))
  assert.equal((await old).reason, 'account-changed')
  assert.deepEqual(catalog.resolve().snapshot.models.map((m) => m.id), ['model-second'])

  setup.select('')
  await catalog.refreshOnce(true)
  assert.deepEqual(catalog.resolve().snapshot.models.map((m) => m.id), ['model-public'])
})

test('authenticated catalog accepts an explicit empty response after permission revocation', async (t) => {
  const setup = fixture(t)
  let data = pricing('member')
  const catalog = createAccountCatalog({ ...setup, fetchImpl: async () => Response.json(data) })
  setup.select('member')
  assert.equal((await catalog.refreshOnce(true)).changed, true)
  data = { success: true, data: [], usable_group: {}, group_ratio: {} }
  assert.equal((await catalog.refreshOnce(true)).changed, true)
  assert.deepEqual(catalog.resolve().snapshot.models, [])
})

test('custom pricing paths never get account credentials', async (t) => {
  const setup = fixture(t)
  setup.select('member')
  const catalog = createAccountCatalog({
    ...setup,
    url: `${siteBaseUrl}/custom-pricing`,
    fetchImpl: async (_url, options) => {
      assert.deepEqual(options.headers, { accept: 'application/json' })
      return Response.json(pricing('public'))
    },
  })
  assert.equal((await catalog.refreshOnce(true)).changed, true)
  assert.equal(setup.tokenReads(), 0)
})

test('a denied member directory stays closed across restarts until an authorized reply', async (t) => {
  const setup = fixture(t)
  setup.select('member')
  let status = 200
  const deps = { ...setup, fetchImpl: async () => Response.json(pricing('member'), { status }) }
  let catalog = createAccountCatalog(deps)
  await catalog.refreshOnce(true)
  assert.equal(catalog.resolve().snapshot.models.length, 1)
  status = 403
  await catalog.refreshOnce(true)
  assert.deepEqual(catalog.resolve().snapshot.models, [])
  catalog = createAccountCatalog(deps)
  assert.deepEqual(catalog.resolve().snapshot.models, [])
  status = 500
  await catalog.refreshOnce(true)
  catalog = createAccountCatalog(deps)
  assert.deepEqual(catalog.resolve().snapshot.models, [])
  status = 200
  await catalog.refreshOnce(true)
  assert.deepEqual(catalog.resolve().snapshot.models.map(m => m.id), ['model-member'])
})
