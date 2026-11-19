import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { quotaGuard } from 'dsh-ui-kit/quota-request'
import { getStatus, logout, peekStatusCache, rememberLoggedInStatus, resetStatusCache } from './api-auth.js'
import { ensureQuota, resetQuotaPrecheck, setQuotaPrecheckImpl } from './quota-precheck.js'

afterEach(() => {
  resetQuotaPrecheck()
  resetStatusCache()
})

test('0 余额拦截并只通知一次', async () => {
  let calls = 0
  let notices = 0
  setQuotaPrecheckImpl({ getStatus: async () => { calls += 1; return { ok: true, status: 200, body: { logged_in: true, quota_usd: 0 } } }, notify: () => { notices += 1 } })
  assert.deepEqual(await ensureQuota({ capability: 'x' }), { ok: false, reason: 'quota' })
  assert.deepEqual(await ensureQuota({ capability: 'x' }), { ok: false, reason: 'quota' })
  assert.equal(calls, 1)
  assert.equal(notices, 2)
})

test('正余额放行并在 TTL 内复用', async () => {
  let calls = 0
  setQuotaPrecheckImpl({ getStatus: async () => { calls += 1; return { ok: true, status: 200, body: { logged_in: true, quota_usd: 1 } } } })
  assert.deepEqual(await ensureQuota(), { ok: true })
  assert.deepEqual(await ensureQuota(), { ok: true })
  assert.equal(calls, 1)
})

test('concurrent user retries refresh a cached denial once and reuse the recovered balance', async () => {
  let balance = 0
  let reads = 0
  setQuotaPrecheckImpl({
    getStatus: async () => {
      reads += 1
      return { ok: true, status: 200, body: { logged_in: true, quota_usd: balance } }
    },
    notify: () => {},
  })
  const retry = { capability: 'publish', userInitiated: true }
  assert.deepEqual(await ensureQuota(retry), { ok: false, reason: 'quota' })
  balance = 1
  const results = await Promise.all([ensureQuota(retry), ensureQuota(retry)])
  assert.deepEqual(results, [{ ok: true }, { ok: true }])
  assert.deepEqual(await ensureQuota(retry), { ok: true })
  assert.equal(reads, 2)
})

test('5xx fail-open 且不通知', async () => {
  let notices = 0
  setQuotaPrecheckImpl({ getStatus: async () => ({ ok: false, status: 503, body: { error: 'down' } }), notify: () => { notices += 1 } })
  assert.deepEqual(await ensureQuota(), { ok: true })
  assert.equal(notices, 0)
})

test('未登录触发登录且不通知', async () => {
  let logged = 0
  let notices = 0
  setQuotaPrecheckImpl({ getStatus: async () => ({ ok: true, status: 200, body: { logged_in: false } }), ensureLogin: ({ onSuccess }) => { logged += 1; onSuccess() }, notify: () => { notices += 1 } })
  assert.deepEqual(await ensureQuota(), { ok: false, reason: 'auth' })
  assert.equal(logged, 1)
  assert.equal(notices, 0)
})

test('logout and newly observed accounts do not reuse another account’s balance', async (t) => {
  let profile = { logged_in: true, id: 'a', quota_usd: 0 }
  let verifies = 0
  let logins = 0
  let unavailable = false
  setQuotaPrecheckImpl({ ensureLogin: ({ onCancel }) => { logins++; onCancel() } })
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (unavailable) return Response.json({ error: 'unavailable' }, { status: 503 })
    if (url === '/omnimux/auth/logout') profile = { logged_in: false }
    if (url === '/omnimux/auth/status?verify=1') verifies++
    return Response.json(profile)
  })
  assert.deepEqual(await ensureQuota(), { ok: false, reason: 'quota' })
  rememberLoggedInStatus(peekStatusCache().body) // the login gate’s cached navigation path
  assert.deepEqual(await ensureQuota(), { ok: false, reason: 'quota' })
  assert.equal(verifies, 1)
  await logout()
  assert.deepEqual(await ensureQuota(), { ok: false, reason: 'auth' })
  assert.equal(logins, 1)
  profile = { logged_in: true, id: 'b', quota_usd: 5 }
  rememberLoggedInStatus(profile)
  assert.deepEqual(await ensureQuota(), { ok: true })
  unavailable = true
  await getStatus()
  unavailable = false
  profile = { logged_in: true, id: 'c', quota_usd: 0 }
  await getStatus() // separate account-status read observes a different signed-in user
  assert.deepEqual(await ensureQuota(), { ok: false, reason: 'quota' })
  assert.equal(verifies, 4)
})

test('a late empty balance cannot show a warning or replace the newly signed-in account’s positive balance', async () => {
  const oldStatus = Promise.withResolvers()
  const started = Promise.withResolvers()
  let reads = 0
  let notices = 0
  setQuotaPrecheckImpl({
    getStatus: async () => {
      if (++reads > 1) return { ok: true, body: { logged_in: true, quota_usd: 5 } }
      started.resolve()
      return oldStatus.promise
    },
    notify: () => { notices++ },
  })
  rememberLoggedInStatus({ id: 'a' })
  const oldCheck = ensureQuota()
  await started.promise
  rememberLoggedInStatus({ id: 'b' })
  assert.deepEqual(await ensureQuota(), { ok: true })
  oldStatus.resolve({ ok: true, body: { logged_in: true, quota_usd: 0 } })
  assert.deepEqual(await oldCheck, { ok: false, reason: 'auth' })
  assert.deepEqual(await ensureQuota(), { ok: true })
  assert.equal(notices, 0)
  assert.equal(reads, 2)
})

test('an old verification cannot resume a write or overwrite the next account’s pending verification', async (t) => {
  const first = Promise.withResolvers()
  const second = Promise.withResolvers()
  const firstStarted = Promise.withResolvers()
  const secondStarted = Promise.withResolvers()
  let reads = 0
  t.mock.method(globalThis, 'fetch', (path) => {
    assert.equal(path, '/omnimux/auth/status?verify=1')
    reads++
    if (reads === 1) { firstStarted.resolve(); return first.promise }
    secondStarted.resolve()
    return second.promise
  })
  const oldWindow = globalThis.window
  globalThis.window = { __omnimuxQuota: { ensureQuota } }
  t.after(() => { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow })
  let writes = 0
  const write = quotaGuard(async () => { writes++; return { ok: true, status: 200 } }, { userInitiated: true })
  rememberLoggedInStatus({ id: 'a' })
  const oldWrite = write()
  await firstStarted.promise
  rememberLoggedInStatus({ id: 'b' })
  const newCheck = ensureQuota()
  first.resolve(Response.json({ logged_in: true, id: 'a', quota_usd: 10 }))
  assert.equal((await oldWrite).status, 401)
  assert.equal(writes, 0)
  await secondStarted.promise
  const concurrent = ensureQuota()
  second.resolve(Response.json({ logged_in: true, id: 'b', quota_usd: 0 }))
  for (const result of await Promise.all([newCheck, concurrent, ensureQuota()])) {
    assert.deepEqual(result, { ok: false, reason: 'quota' })
  }
  assert.equal(reads, 2)
})
