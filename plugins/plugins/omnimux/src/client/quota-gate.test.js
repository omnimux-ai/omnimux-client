import test from 'node:test'
import assert from 'node:assert/strict'
import { close, getSnapshot, installQuotaGlobal, notify, resetQuotaGate } from './quota-gate.js'
import { ensureQuota, setQuotaPrecheckImpl } from './quota-precheck.js'

test('quota gate install is idempotent and opens on 402', () => {
  resetQuotaGate()
  const target = {}
  const first = installQuotaGlobal(target)
  assert.equal(first, installQuotaGlobal(target))
  assert.equal(notify({ status: 402 }, { capability: 'accounts' }), true)
  assert.equal(getSnapshot().phase, 'open')
})

test('non-quota does not open, open correlation is accepted without stacking', () => {
  resetQuotaGate()
  assert.equal(notify({ status: 500, message: 'failed' }), false)
  assert.equal(notify({ status: 402 }, { correlationId: 'same' }), true)
  const failure = getSnapshot().failure
  assert.equal(notify({ status: 402 }, { correlationId: 'same' }), true)
  assert.equal(getSnapshot().failure, failure)
})

test('close enforces a two second cooldown for all notifications', () => {
  resetQuotaGate()
  assert.equal(notify({ status: 402 }, { correlationId: 'cooldown' }), true)
  close()
  assert.equal(notify({ status: 402 }, { correlationId: 'cooldown' }), false)
  assert.equal(notify({ status: 402 }, { correlationId: 'other' }), false)
})

test('dialog deduplication preserves a verified zero and drops a contradicted positive balance', async (t) => {
  resetQuotaGate()
  t.after(resetQuotaGate)
  let balance = 0
  let reads = 0
  setQuotaPrecheckImpl({
    getStatus: async () => {
      reads++
      return { ok: true, status: 200, body: { logged_in: true, quota_usd: balance } }
    },
    notify,
  })
  await ensureQuota()
  assert.equal(getSnapshot().phase, 'open')
  await ensureQuota()
  assert.equal(reads, 1)
  balance = 1
  assert.deepEqual(await ensureQuota({ userInitiated: true }), { ok: true })
  balance = 0
  notify({ status: 402 })
  assert.deepEqual(await ensureQuota(), { ok: false, reason: 'quota' })
  assert.equal(reads, 3)
})
