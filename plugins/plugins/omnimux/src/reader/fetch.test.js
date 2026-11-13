import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { OmnimuxError } from '../media/errors.js'
import { resolveReaderBaseUrl } from './client.js'
import { clipPageContent, fetchPage, normalizePageUrl } from './fetch.js'

describe('normalizePageUrl', () => {
  it('accepts http(s) and rejects everything else', () => {
    assert.equal(normalizePageUrl('https://example.com/a'), 'https://example.com/a')
    assert.equal(normalizePageUrl('http://example.com'), 'http://example.com/')
    assert.throws(
      () => normalizePageUrl('ftp://example.com'),
      (error) => error instanceof OmnimuxError && error.code === 'omnimux-invalid-request',
    )
    assert.throws(
      () => normalizePageUrl('not-a-url'),
      (error) => error instanceof OmnimuxError && error.code === 'omnimux-invalid-request',
    )
    assert.throws(
      () => normalizePageUrl(''),
      (error) => error instanceof OmnimuxError && error.code === 'omnimux-invalid-request',
    )
  })
})

describe('resolveReaderBaseUrl', () => {
  it('keeps /v1 and appends it when missing', () => {
    assert.equal(resolveReaderBaseUrl(undefined), 'https://api.omnimux.ai/v1')
    assert.equal(resolveReaderBaseUrl('https://api.omnimux.ai/v1/'), 'https://api.omnimux.ai/v1')
    assert.equal(resolveReaderBaseUrl('https://omnimux.ai'), 'https://omnimux.ai/v1')
  })
})

describe('fetchPage', () => {
  it('throws omnimux-unconfigured without a key', async () => {
    await assert.rejects(
      () => fetchPage({ env: {}, fetcher: async () => { throw new Error('no fetch') } }, { url: 'https://example.com' }),
      (error) => error instanceof OmnimuxError && error.code === 'omnimux-unconfigured',
    )
  })

  it('uses resolveApiKey when env has no key', async () => {
    const markdown = 'Title: Example Domain\n\n# Example Domain\n'
    const result = await fetchPage(
      {
        env: {},
        resolveApiKey: async () => 'sk-from-credentials',
        fetcher: async (_url, init) => {
          assert.match(String(init.headers.authorization), /^Bearer sk-from-credentials$/)
          return { ok: true, status: 200, text: async () => markdown }
        },
      },
      { url: 'https://example.com' },
    )
    assert.equal(result.title, 'Example Domain')
    assert.equal(result.mode, 'live')
  })

  it('POSTs /v1/reader as JSON and parses text/plain markdown', async () => {
    /** @type {{ url?: string, init?: RequestInit }} */
    const seen = {}
    const markdown = 'Title: Example Domain\n\nURL Source: https://example.com/\n\n# Example Domain\n'
    const result = await fetchPage(
      {
        env: { OMNIMUX_API_KEY: 'sk-test', OMNIMUX_BASE_URL: 'https://api.omnimux.ai/v1' },
        fetcher: async (url, init) => {
          seen.url = String(url)
          seen.init = init
          return {
            ok: true,
            status: 200,
            text: async () => markdown,
            json: async () => { throw new Error('must not json() a 200 reader body') },
          }
        },
      },
      { url: 'https://example.com' },
    )
    assert.equal(seen.url, 'https://api.omnimux.ai/v1/reader')
    assert.equal(seen.init.method, 'POST')
    assert.equal(JSON.parse(String(seen.init.body)).model, 'jina-reader-v1')
    assert.equal(JSON.parse(String(seen.init.body)).url, 'https://example.com/')
    assert.match(String(seen.init.headers.authorization), /^Bearer sk-test$/)
    assert.deepEqual(result, {
      mode: 'live',
      model: 'jina-reader-v1',
      url: 'https://example.com/',
      title: 'Example Domain',
      pageContent: markdown,
    })
  })

  it('maps JSON invalid_request to omnimux-invalid-request', async () => {
    await assert.rejects(
      () => fetchPage(
        {
          env: { OMNIMUX_API_KEY: 'sk-test' },
          fetcher: async () => ({
            ok: false,
            status: 500,
            text: async () => JSON.stringify({ error: 'invalid_request' }),
          }),
        },
        { url: 'https://example.com' },
      ),
      (error) => error instanceof OmnimuxError && error.code === 'omnimux-invalid-request',
    )
  })

  it('maps 401 to needs-omnimux', async () => {
    await assert.rejects(
      () => fetchPage(
        {
          env: { OMNIMUX_API_KEY: 'sk-test' },
          fetcher: async () => ({
            ok: false,
            status: 401,
            text: async () => JSON.stringify({ error: { message: 'Invalid token', type: 'invalid_request' } }),
          }),
        },
        { url: 'https://example.com' },
      ),
      (error) => error instanceof OmnimuxError && error.code === 'needs-omnimux',
    )
  })
})

describe('clipPageContent', () => {
  it('marks overflow without dropping the prefix', () => {
    const huge = 'x'.repeat(120_001)
    const clipped = clipPageContent(huge)
    assert.equal(clipped.truncated, true)
    assert.match(clipped.pageContent, /\[truncated\]$/)
    assert.equal(clipped.pageContent.startsWith('x'.repeat(32)), true)
  })
})
