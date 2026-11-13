import test from 'node:test'
import assert from 'node:assert/strict'
import { close, getSnapshot, installQuotaGlobal, notify, resetQuotaGate } from './quota-gate.js'

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
