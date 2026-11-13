import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HttpError,
  clearHttpJsonCache,
  configureHttpJsonCache,
  fetchBytes,
  fetchJson,
  httpJsonCacheSize,
  resetHttpNow,
  setHttpNow,
} from '../http.js'

const opts = { timeoutMs: 200, userAgent: 'skillhub-test' }

test('fetchJson TTL memo hits same URL without a second network call', async () => {
  clearHttpJsonCache()
  configureHttpJsonCache({ ttlMs: 90_000 })
  let now = 1_000
  setHttpNow(() => now)
  let calls = 0
  const orig = globalThis.fetch
  globalThis.fetch = async () => {
    calls += 1
    return new Response(JSON.stringify({ n: calls }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const a = await fetchJson<{ n: number }>('https://example.test/memo', opts)
    const b = await fetchJson<{ n: number }>('https://example.test/memo', opts)
    assert.equal(a.n, 1)
    assert.equal(b.n, 1)
    assert.equal(calls, 1)
    assert.equal(httpJsonCacheSize(), 1)
    now += 91_000
    const c = await fetchJson<{ n: number }>('https://example.test/memo', opts)
    assert.equal(c.n, 2)
    assert.equal(calls, 2)
    const d = await fetchJson<{ n: number }>('https://example.test/memo', { ...opts, refresh: true })
    assert.equal(d.n, 3)
    assert.equal(calls, 3)
  } finally {
    globalThis.fetch = orig
    resetHttpNow()
    clearHttpJsonCache()
    configureHttpJsonCache({ ttlMs: 90_000 })
  }
})

test('fetchJson returns parsed JSON and sends UA', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://example.test/api')
    const headers = init?.headers as Record<string, string>
    assert.equal(headers['user-agent'], 'skillhub-test')
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    assert.deepEqual(await fetchJson('https://example.test/api', opts), { ok: true })
  } finally {
    globalThis.fetch = orig
  }
})

test('fetchBytes returns body and content type', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = async () => new Response(Buffer.from('PK\x03\x04'), {
    status: 200,
    headers: { 'content-type': 'application/zip' },
  })
  try {
    const { body, contentType } = await fetchBytes('https://example.test/file.zip', opts)
    assert.equal(body.subarray(0, 2).toString(), 'PK')
    assert.match(contentType, /zip/)
  } finally {
    globalThis.fetch = orig
  }
})

test('HTTP 404 becomes HttpError with status', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = async () => new Response('nope', { status: 404 })
  try {
    await assert.rejects(() => fetchJson('https://example.test/missing', opts), (err: unknown) => {
      assert.ok(err instanceof HttpError)
      assert.equal(err.status, 404)
      assert.match(err.message, /HTTP 404/)
      return true
    })
  } finally {
    globalThis.fetch = orig
  }
})

test('aborted fetch is reported as timeout', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = async (_input, init) => {
    const signal = init?.signal
    await new Promise<void>((_, reject) => {
      signal?.addEventListener('abort', () => {
        const err = new Error('aborted')
        err.name = 'AbortError'
        reject(err)
      })
    })
    throw new Error('unreachable')
  }
  try {
    await assert.rejects(
      () => fetchJson('https://example.test/slow', { timeoutMs: 20, userAgent: 't' }),
      /timeout 20ms/,
    )
  } finally {
    globalThis.fetch = orig
  }
})

test('network failure is wrapped in HttpError', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('ECONNREFUSED')
  }
  try {
    await assert.rejects(() => fetchJson('https://example.test/down', opts), (err: unknown) => {
      assert.ok(err instanceof HttpError)
      assert.match(err.message, /ECONNREFUSED/)
      return true
    })
  } finally {
    globalThis.fetch = orig
  }
})
