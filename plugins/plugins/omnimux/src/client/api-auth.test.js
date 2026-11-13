import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  getStatus,
  getStatusCached,
  invalidateStatusCache,
  logout,
  peekStatusCache,
  rememberLoggedInStatus,
  resetStatusCache,
} from './api-auth.js'

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
  }
}

/**
 * @param {(path: string, opts: any, n: number) => any | Promise<any>} handler
 */
function mockFetch(handler) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (path, opts) => {
    calls.push({ path, opts })
    return handler(path, opts, calls.length)
  }
  return {
    calls,
    restore() { globalThis.fetch = original },
  }
}

describe('api-auth session status cache', () => {
  /** @type {{ calls: any[], restore: () => void } | undefined} */
  let mocked

  beforeEach(() => {
    resetStatusCache()
  })

  afterEach(() => {
    mocked?.restore()
    mocked = undefined
    resetStatusCache()
  })

  it('peekStatusCache is null until a result is remembered', () => {
    assert.equal(peekStatusCache(), null)
  })

  it('rememberLoggedInStatus writes a positive peek without HTTP', () => {
    rememberLoggedInStatus({ username: 'ada' })
    const peeked = peekStatusCache()
    assert.equal(peeked?.ok, true)
    assert.equal(peeked?.body.logged_in, true)
    assert.equal(peeked?.body.username, 'ada')
  })

  it('getStatusCached peeks a hit as Promise.resolve (0 HTTP)', async () => {
    rememberLoggedInStatus({ logged_in: true, username: 'ada' })
    mocked = mockFetch(() => { throw new Error('must not HTTP on peek hit') })
    const result = await getStatusCached()
    assert.equal(result.body.username, 'ada')
    assert.equal(mocked.calls.length, 0)
  })

  it('getStatusCached miss issues one HTTP and remembers logged_in:true', async () => {
    mocked = mockFetch(() => jsonResponse({ logged_in: true, username: 'ada' }))
    const result = await getStatusCached()
    assert.equal(result.body.logged_in, true)
    assert.equal(mocked.calls.length, 1)
    assert.equal(mocked.calls[0].path, '/omnimux/auth/status')
    assert.equal(peekStatusCache()?.body.username, 'ada')
  })

  it('getStatusCached miss writes a negative cache on logged_in:false', async () => {
    mocked = mockFetch(() => jsonResponse({ logged_in: false }, { ok: true, status: 200 }))
    const result = await getStatusCached()
    assert.equal(result.body.logged_in, false)
    assert.equal(peekStatusCache()?.body.logged_in, false)
    const again = await getStatusCached()
    assert.equal(again.body.logged_in, false)
    assert.equal(mocked.calls.length, 1, 'negative cache is reused')
  })

  it('getStatusCached coalesces concurrent misses into one inflight HTTP', async () => {
    let release
    const pending = new Promise((resolve) => { release = resolve })
    mocked = mockFetch(async () => {
      await pending
      return jsonResponse({ logged_in: true, username: 'ada' })
    })
    const a = getStatusCached()
    const b = getStatusCached()
    release()
    const [ra, rb] = await Promise.all([a, b])
    assert.equal(ra.body.username, 'ada')
    assert.equal(rb.body.username, 'ada')
    assert.equal(mocked.calls.length, 1)
  })

  it('getStatus always hits HTTP even when a peek exists, then remembers', async () => {
    rememberLoggedInStatus({ logged_in: true, username: 'stale' })
    mocked = mockFetch((path) => {
      assert.match(String(path), /verify=1/)
      return jsonResponse({ logged_in: true, username: 'fresh' })
    })
    const result = await getStatus(true)
    assert.equal(result.body.username, 'fresh')
    assert.equal(peekStatusCache()?.body.username, 'fresh')
    assert.equal(mocked.calls.length, 1)
  })

  it('getStatus(*) with logged_in:false writes a negative cache', async () => {
    rememberLoggedInStatus({ logged_in: true, username: 'ada' })
    mocked = mockFetch(() => jsonResponse({ logged_in: false }))
    await getStatus(false)
    assert.equal(peekStatusCache()?.body.logged_in, false)
  })

  it('verify / network failure does not remember login and drops a positive cache', async () => {
    rememberLoggedInStatus({ logged_in: true, username: 'ada' })
    mocked = mockFetch(() => { throw new Error('net down') })
    await assert.rejects(() => getStatus(true), /net down/)
    assert.equal(peekStatusCache(), null)
  })

  it('ok:false without logged_in does not write a positive cache', async () => {
    rememberLoggedInStatus({ logged_in: true, username: 'ada' })
    mocked = mockFetch(() => jsonResponse({ error: 'boom' }, { ok: false, status: 500 }))
    await getStatus(false)
    assert.equal(peekStatusCache(), null)
  })

  it('invalidateStatusCache drops peek and discards inflight writes', async () => {
    let release
    const pending = new Promise((resolve) => { release = resolve })
    mocked = mockFetch(async () => {
      await pending
      return jsonResponse({ logged_in: true, username: 'late' })
    })
    const inflight = getStatusCached()
    invalidateStatusCache()
    assert.equal(peekStatusCache(), null)
    release()
    await inflight
    assert.equal(peekStatusCache(), null, 'stale inflight must not rewrite after invalidate')
  })

  it('logout invalidates the cache before the request leaves', async () => {
    rememberLoggedInStatus({ logged_in: true, username: 'ada' })
    let peekedDuringFetch = 'unset'
    mocked = mockFetch(() => {
      peekedDuringFetch = peekStatusCache()
      return jsonResponse({ ok: true })
    })
    const pending = logout()
    assert.equal(peekStatusCache(), null, 'invalidate is synchronous, before await')
    await pending
    assert.equal(peekedDuringFetch, null)
    assert.equal(mocked.calls[0].path, '/omnimux/auth/logout')
  })

  it('resetStatusCache is the test-only alias of invalidate', () => {
    rememberLoggedInStatus({ logged_in: true })
    resetStatusCache()
    assert.equal(peekStatusCache(), null)
  })
})
