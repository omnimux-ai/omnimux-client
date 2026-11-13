import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fetchRemoteCatalog } from './fetch.js'

function jsonResponse(status, body, headers = {}) {
  return {
    status,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] ?? null
      },
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body)
    },
  }
}

describe('fetchRemoteCatalog', () => {
  it('sends conditional headers and accepts 304', async () => {
    const seen = []
    const result = await fetchRemoteCatalog({
      url: 'https://omnimux.ai/apps/catalog.json',
      siteHost: 'omnimux.ai',
      timeoutMs: 1000,
      etag: 'W/"abc"',
      lastModified: 'Mon, 17 Aug 2026 00:00:00 GMT',
      fetcher: async (url, init) => {
        seen.push({ url, headers: init.headers })
        return jsonResponse(304, '')
      },
    })
    assert.equal(result.kind, 'not_modified')
    assert.equal(seen[0].headers['If-None-Match'], 'W/"abc"')
    assert.equal(seen[0].headers['If-Modified-Since'], 'Mon, 17 Aug 2026 00:00:00 GMT')
    assert.equal(seen[0].headers.Accept, 'application/json')
  })

  it('rejects a redirect that leaves the site host', async () => {
    const result = await fetchRemoteCatalog({
      url: 'https://omnimux.ai/apps/catalog.json',
      siteHost: 'omnimux.ai',
      timeoutMs: 1000,
      fetcher: async () => jsonResponse(302, '', { location: 'https://evil.example/catalog.json' }),
    })
    assert.equal(result.kind, 'network')
    assert.match(result.error, /site host/)
  })

  it('treats an oversized body as invalid', async () => {
    const result = await fetchRemoteCatalog({
      url: 'https://omnimux.ai/apps/catalog.json',
      siteHost: 'omnimux.ai',
      timeoutMs: 1000,
      fetcher: async () => jsonResponse(200, 'x'.repeat(65537)),
    })
    assert.equal(result.kind, 'invalid')
    assert.match(result.error, /size limit/)
  })

  it('rejects an oversized Content-Length before reading the body', async () => {
    let read = false
    const result = await fetchRemoteCatalog({
      url: 'https://omnimux.ai/apps/catalog.json',
      siteHost: 'omnimux.ai',
      timeoutMs: 1000,
      fetcher: async () => ({
        status: 200,
        headers: {
          get(name) {
            return name.toLowerCase() === 'content-length' ? '70000' : null
          },
        },
        async text() {
          read = true
          return 'x'.repeat(70000)
        },
      }),
    })
    assert.equal(result.kind, 'invalid')
    assert.equal(read, false)
  })
})
