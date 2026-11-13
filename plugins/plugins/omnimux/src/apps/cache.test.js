import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isRefreshDue } from './cache.js'

describe('isRefreshDue', () => {
  it('is due when meta is missing', () => {
    assert.equal(isRefreshDue(undefined, 21600), true)
    assert.equal(isRefreshDue({ status: 'network' }, 21600), true)
  })

  it('honors TTL after a failed fetch', () => {
    const fetched = Date.parse('2026-08-17T00:00:00Z')
    assert.equal(isRefreshDue({
      status: 'network',
      fetched_at: '2026-08-17T00:00:00Z',
    }, 21600, fetched + 1000), false)
    assert.equal(isRefreshDue({
      status: 'invalid',
      fetched_at: '2026-08-17T00:00:00Z',
    }, 21600, fetched + 21600 * 1000), true)
  })

  it('is due after the TTL window', () => {
    const fetched = Date.parse('2026-08-17T00:00:00Z')
    assert.equal(isRefreshDue({
      status: 'ok',
      fetched_at: '2026-08-17T00:00:00Z',
    }, 21600, fetched + 21600 * 1000), true)
    assert.equal(isRefreshDue({
      status: 'ok',
      fetched_at: '2026-08-17T00:00:00Z',
    }, 21600, fetched + 1000), false)
  })
})
