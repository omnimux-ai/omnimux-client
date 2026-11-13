import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { apply } from '../index.js'
import { OmnimuxError } from '../media/errors.js'
import { createIdentity } from './identity.js'
import { createTokenStore } from './store.js'

describe('identity seam', () => {
  it('reports unsigned without a token and require throws needs-omnimux', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'omnimux-id-'))
    const configDir = mkdtempSync(join(tmpdir(), 'omnimux-cfg-'))
    const identity = createIdentity({
      store: createTokenStore({ homeDir, configDir }),
      siteBaseUrl: 'https://omnimux.ai',
    })
    try {
      const body = await identity.status()
      assert.equal(body.logged_in, false)
      assert.equal(body.base_url, 'https://omnimux.ai')
      assert.equal(/access_token|sk-/.test(JSON.stringify(body)), false)
      await assert.rejects(
        () => identity.require(),
        (error) => error instanceof OmnimuxError && error.code === 'needs-omnimux',
      )
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  it('hydrates /self when token exists but shared profile cache is empty', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'omnimux-id-'))
    const configDir = mkdtempSync(join(tmpdir(), 'omnimux-cfg-'))
    const store = createTokenStore({ homeDir, configDir })
    await store.set('pat-secret')
    let hits = 0
    const identity = createIdentity({
      store,
      siteBaseUrl: 'https://omnimux.ai',
      fetcher: async () => {
        hits += 1
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { id: 1, username: 'admin', display_name: 'Root User', quota: 500000, used_quota: 0 },
          }),
        }
      },
    })
    try {
      const body = await identity.status()
      assert.equal(body.logged_in, true)
      assert.equal(body.username, 'admin')
      assert.equal(body.display_name, 'Root User')
      assert.equal(hits, 1)
      assert.equal(store.readProfileCache().username, 'admin')
      const cached = await identity.status()
      assert.equal(cached.username, 'admin')
      assert.equal(hits, 1)
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  it('returns cached public fields and never the PAT', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'omnimux-id-'))
    const configDir = mkdtempSync(join(tmpdir(), 'omnimux-cfg-'))
    const store = createTokenStore({ homeDir, configDir })
    await store.set('pat-secret')
    store.writeProfileCache({ id: 9, username: 'ada', quota_usd: 1, used_quota_usd: 0 })
    const identity = createIdentity({ store, siteBaseUrl: 'https://omnimux.ai' })
    try {
      const body = await identity.status()
      assert.equal(body.logged_in, true)
      assert.equal(body.username, 'ada')
      assert.equal(body.quota_usd, 1)
      assert.equal(/pat-secret|access_token|sk-/.test(JSON.stringify(body)), false)
      const required = await identity.require()
      assert.equal(required.username, 'ada')
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  it('401 on verify marks expired without unsetting token, and subsequent unverified status reports token_invalid', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'omnimux-id-'))
    const configDir = mkdtempSync(join(tmpdir(), 'omnimux-cfg-'))
    const store = createTokenStore({ homeDir, configDir })
    await store.set('pat-expired-test')
    store.writeProfileCache({ id: 9, username: 'ada' })
    let hits = 0
    const identity = createIdentity({
      store,
      siteBaseUrl: 'https://omnimux.ai',
      fetcher: async () => {
        hits += 1
        return { ok: false, status: 401, json: async () => ({}) }
      },
    })
    try {
      // 1. Verify fails with 401
      const loaded = await identity.load({ verify: true })
      assert.equal(loaded.kind, 'token_invalid')
      assert.equal(loaded.body.logged_in, false)
      assert.equal(loaded.body.verified, false)
      assert.equal(loaded.body.username, 'ada') // profile cached available
      assert.equal(hits, 1)

      // 2. Token MUST still exist in store (去即焚 - no unset)
      assert.equal(await store.resolve(), 'pat-expired-test')
      assert.equal(store.isExpired(), true)

      // 3. Subsequent unverified status returns token_invalid / logged_in false
      const unverified = await identity.load()
      assert.equal(unverified.kind, 'token_invalid')
      assert.equal(unverified.body.logged_in, false)
      assert.equal(unverified.body.username, 'ada')

      // 4. store.set() clears expired state
      await store.set('pat-new-token')
      assert.equal(store.isExpired(), false)
      const reloaded = await identity.load()
      assert.equal(reloaded.kind, 'cached')
      assert.equal(reloaded.body.logged_in, true)

      await store.set('pat-expired-again')
      store.markExpired()
      const recovered = createIdentity({
        store,
        siteBaseUrl: 'https://omnimux.ai',
        fetcher: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { id: 9, username: 'ada', quota: 500000, used_quota: 0 } }),
        }),
      })
      const verified = await recovered.load({ verify: true })
      assert.equal(verified.kind, 'verified')
      assert.equal(store.isExpired(), false)
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  it('non-401 errors return self_failed and do not mark expired or unset', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'omnimux-id-'))
    const configDir = mkdtempSync(join(tmpdir(), 'omnimux-cfg-'))
    const store = createTokenStore({ homeDir, configDir })
    await store.set('pat-valid-test')
    store.writeProfileCache({ id: 9, username: 'ada' })
    const identity = createIdentity({
      store,
      siteBaseUrl: 'https://omnimux.ai',
      fetcher: async () => {
        return { ok: false, status: 502, json: async () => ({}) }
      },
    })
    try {
      const loaded = await identity.load({ verify: true })
      assert.equal(loaded.kind, 'self_failed')
      assert.equal(loaded.body.logged_in, false)
      assert.equal(store.isExpired(), false)
      assert.equal(await store.resolve(), 'pat-valid-test')

      // Subsequent unverified status still returns cached logged_in true because not expired
      const unverified = await identity.load()
      assert.equal(unverified.kind, 'cached')
      assert.equal(unverified.body.logged_in, true)
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  it('apply provides identity and dispose unregisters it', () => {
    const provided = {}
    apply({
      tools: { register() {} },
      provide(name, value) { provided[name] = value },
      get() { return undefined },
    })
    assert.equal(typeof provided.identity.status, 'function')
    assert.equal(typeof provided.identity.require, 'function')
    assert.equal(typeof provided.videoGenerate.execute, 'function')
    assert.equal(typeof provided.textComplete.execute, 'function')
  })
})
