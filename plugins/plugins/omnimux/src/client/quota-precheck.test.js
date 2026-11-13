import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { ensureQuota, resetQuotaPrecheck, setQuotaPrecheckImpl } from './quota-precheck.js'

afterEach(() => resetQuotaPrecheck())

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
