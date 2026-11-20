import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createAuthDispatcher } from './http-routes.js'
import { createIdentity } from './identity.js'
import { createPendingStore } from './pending.js'
import { createTokenStore } from './store.js'

const siteBaseUrl = 'https://example.invalid'
const credential = id => `fixture-identity-${id}`
const self = id => Response.json({ success: true, data: { id, username: `account-${id}` } })

function setup(t, opts = {}) {
  const homeDir = mkdtempSync(join(tmpdir(), 'omnimux-identity-transition-'))
  t.after(() => rmSync(homeDir, { recursive: true, force: true }))
  const createStore = () => createTokenStore({ homeDir, configDir: join(homeDir, 'config'), env: {}, ...opts })
  return { store: createStore(), createStore }
}

for (const [outcome, reply] of [['successful', self(1)], ['unauthorized', new Response(null, { status: 401 })]]) {
  test(`a ${outcome} old verification does not update a replaced account or expiry`, async t => {
    const { store, createStore } = setup(t)
    await store.set(credential(1), { userId: '1' })
    store.writeProfileCache({ id: 1 })
    const started = Promise.withResolvers()
    const response = Promise.withResolvers()
    const identity = createIdentity({ store, siteBaseUrl, fetcher: () => {
      started.resolve()
      return response.promise
    } })
    const verifying = identity.load({ verify: true })
    await started.promise
    const otherProcess = createStore()
    await otherProcess.set(credential(2), { userId: '2' })
    otherProcess.writeProfileCache({ id: 2 })
    response.resolve(reply)
    const result = await verifying
    assert.equal(result.body.id, 2)
    assert.equal(result.body.verified, null)
    assert.equal(store.readProfileCache().id, 2)
    assert.equal(store.readConfig().user_id, '2')
    assert.equal(store.isExpired(), false)
    assert.equal(identity.getSnapshot().id, 2)
  })
}

test('a late device poll profile cannot replace the account signed in after logout', async t => {
  const { store } = setup(t)
  const pending = createPendingStore()
  const flow = id => pending.save({ deviceCode: String(id), expiresAt: Date.now() + 30_000, intervalMs: 5000, siteBaseUrl })
  const started = Promise.withResolvers()
  const response = Promise.withResolvers()
  const identity = createIdentity({ store, siteBaseUrl })
  const dispatcher = createAuthDispatcher({ store, pending, siteBaseUrl, identity, fetcher: async (url, init) => {
    if (String(url).endsWith('/device/token')) {
      const id = Number(JSON.parse(init.body).device_code)
      return Response.json({ success: true, data: { access_token: credential(id), user_id: id } })
    }
    if (init.headers.Authorization === `Bearer ${credential(1)}`) {
      started.resolve()
      return response.promise
    }
    return self(2)
  } })
  const poll = flowId => dispatcher.dispatch({ method: 'POST', url: '/omnimux/auth/poll', body: { flow_id: flowId } })
  const old = poll(flow(1))
  await started.promise
  await dispatcher.dispatch({ method: 'POST', url: '/omnimux/auth/logout' })
  assert.equal((await poll(flow(2))).body.id, 2)
  response.resolve(self(1))
  const stale = await old
  assert.equal(stale.status, 410)
  assert.equal(stale.body.kind, 'expired')
  assert.equal(store.readProfileCache().id, 2)
  assert.equal(store.readConfig().user_id, '2')
  assert.equal(identity.getSnapshot().id, 2)
})

test('logout invalidates a poll still waiting for device token exchange', async t => {
  const { store } = setup(t)
  const pending = createPendingStore()
  const flowId = pending.save({ deviceCode: '1', expiresAt: Date.now() + 30_000, intervalMs: 5000, siteBaseUrl })
  const started = Promise.withResolvers()
  const response = Promise.withResolvers()
  const dispatcher = createAuthDispatcher({ store, pending, siteBaseUrl, fetcher: () => {
    started.resolve()
    return response.promise
  } })
  const old = dispatcher.dispatch({ method: 'POST', url: '/omnimux/auth/poll', body: { flow_id: flowId } })
  await started.promise
  await dispatcher.dispatch({ method: 'POST', url: '/omnimux/auth/logout' })
  response.resolve(Response.json({ success: true, data: { access_token: credential(1), user_id: 1 } }))
  assert.equal((await old).status, 410)
  assert.equal((await store.describe()).configured, false)
  assert.equal(store.readProfileCache(), null)
})

test('a new login waits for the prior logout to finish removing its profile', async t => {
  const cleanupStarted = Promise.withResolvers()
  const cleanup = Promise.withResolvers()
  const { store } = setup(t, { credentials: { unset: () => {
    cleanupStarted.resolve()
    return cleanup.promise
  } } })
  const pending = createPendingStore()
  const identity = createIdentity({ store, siteBaseUrl })
  await store.set(credential(1), { userId: '1' })
  store.writeProfileCache({ id: 1 })
  const exchanged = Promise.withResolvers()
  const dispatcher = createAuthDispatcher({ store, pending, siteBaseUrl, identity, fetcher: async url => {
    if (String(url).endsWith('/device/token')) {
      exchanged.resolve()
      return Response.json({ success: true, data: { access_token: credential(2), user_id: 2 } })
    }
    return self(2)
  } })
  const logout = dispatcher.dispatch({ method: 'POST', url: '/omnimux/auth/logout' })
  await cleanupStarted.promise
  const flowId = pending.save({ deviceCode: '2', expiresAt: Date.now() + 30_000, intervalMs: 5000, siteBaseUrl })
  const login = dispatcher.dispatch({ method: 'POST', url: '/omnimux/auth/poll', body: { flow_id: flowId } })
  await exchanged.promise
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await store.describe()).configured, false)
  cleanup.resolve()
  assert.equal((await logout).status, 200)
  assert.equal((await login).body.id, 2)
  assert.equal(identity.getSnapshot().id, 2)
})

test('the explicit environment identity does not prevent storing a completed device sign-in', async t => {
  const { store } = setup(t, { env: { OMNIMUX_ACCESS_TOKEN: credential(1) } })
  const pending = createPendingStore()
  const flowId = pending.save({ deviceCode: '2', expiresAt: Date.now() + 30_000, intervalMs: 5000, siteBaseUrl })
  const dispatcher = createAuthDispatcher({ store, pending, siteBaseUrl, fetcher: async url => String(url).endsWith('/device/token')
    ? Response.json({ success: true, data: { access_token: credential(2), user_id: 2 } })
    : self(2) })
  const login = await dispatcher.dispatch({ method: 'POST', url: '/omnimux/auth/poll', body: { flow_id: flowId } })
  assert.equal(login.status, 200)
  assert.equal((await store.describe()).source, 'env')
  assert.equal(store.readConfig().user_id, '2')
  assert.equal(store.readProfileCache(), null)
})
