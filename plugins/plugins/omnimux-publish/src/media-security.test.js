import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { parsePublishConfig } from './config.js'
import { createPublishDispatcher, registerPublishRoutes } from './http-routes.js'
import { createHubChannel } from './hubtools.js'
import { createAccountSource } from './accounts.js'
import { contentTypeOf, createMediaStore } from './media.js'
import { createRecordStore, PublishError } from './store.js'
import { createSubmitService } from './submit.js'

const LOCAL = { origin: 'http://127.0.0.1:65432', 'sec-fetch-site': 'same-origin' }

function mockReqRes({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))]
  const req = {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
  const captured = { status: 0, raw: undefined, body: undefined, headers: {} }
  const res = {
    writeHead(status, hdrs) {
      captured.status = status
      Object.assign(captured.headers, hdrs || {})
    },
    end(payload) {
      captured.raw = payload
      if (typeof payload !== 'string' || payload === '') return
      try { captured.body = JSON.parse(payload) } catch { captured.body = payload }
    },
  }
  return { req, res, captured }
}

describe('omnimux-publish media content isolation and MIME allowlist (issue #356)', () => {
  let dir = ''
  let media = null
  let routeHandler = null

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-publish-media-sec-'))
    const store = createRecordStore({ paths: { recordsFile: join(dir, 'records.json') } })
    media = createMediaStore({
      paths: { mediaIndexFile: join(dir, 'media.json'), mediaDir: join(dir, 'media') },
      maxBytes: 1024 * 1024,
    })
    const tools = { get: () => undefined, execute: async () => ({ results: [] }) }
    const channel = createHubChannel({ tools, fetcher: async () => ({ ok: true, status: 200 }) })
    const accounts = createAccountSource({ channel, overlayPath: '' })
    const config = parsePublishConfig({ dataDir: dir, submitTimeoutSeconds: 5 })
    const service = createSubmitService({ store, media, channel, accounts, config })
    const dispatcher = createPublishDispatcher({ store, media, accounts, service, channel, config })
    const routes = []
    registerPublishRoutes(
      { register: (route) => { routes.push(route); return () => {} } },
      dispatcher,
      { getConnection: () => ({ requestRejection: () => undefined }) },
    )
    routeHandler = routes[0].handler
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('does not map .svg to image/svg+xml and rejects active document types in MediaStore.importBuffer', () => {
    assert.equal(contentTypeOf('vector.svg'), 'application/octet-stream')
    for (const badType of ['text/html', 'text/html; charset=utf-8', 'image/svg+xml', 'application/xhtml+xml', 'application/javascript']) {
      assert.throws(
        () => media.importBuffer(Buffer.from('<script>alert(1)</script>'), { filename: 'x.bin', content_type: badType }),
        (err) => err instanceof PublishError && err.code === 'unsupported-media-type',
        `expected unsupported-media-type for ${badType}`,
      )
    }
  })

  it('rejects HTML, SVG, and script uploads on POST /omnimux/publish/media with 415', async () => {
    const cases = [
      { filename: 'xss.html', type: 'text/html' },
      { filename: 'xss.svg', type: 'image/svg+xml' },
      { filename: 'xss.svg', type: 'application/octet-stream' },
      { filename: 'code.js', type: 'application/javascript' },
    ]
    for (const item of cases) {
      const { req, res, captured } = mockReqRes({
        method: 'POST',
        url: `/omnimux/publish/media?filename=${encodeURIComponent(item.filename)}`,
        headers: { ...LOCAL, 'content-type': item.type },
        body: Buffer.from('<svg onload="alert(1)"></svg>'),
      })
      await routeHandler(req, res)
      assert.equal(captured.status, 415, `expected 415 for ${item.filename} (${item.type})`)
      assert.equal(captured.body.error, 'unsupported-media-type')
    }
  })

  it('serves allowed raster/video media with sandbox CSP and nosniff headers', async () => {
    const { media: row } = media.importBuffer(Buffer.from('png-fixture'), { filename: 'ok.png', content_type: 'image/png' })
    const { req, res, captured } = mockReqRes({
      method: 'GET',
      url: `/omnimux/publish/media/content?id=${encodeURIComponent(row.id)}`,
    })
    await routeHandler(req, res)
    assert.equal(captured.status, 200)
    assert.equal(captured.headers['Content-Type'], 'image/png')
    assert.equal(captured.headers['X-Content-Type-Options'], 'nosniff')
    assert.equal(captured.headers['Content-Security-Policy'], "sandbox; default-src 'none'")
    assert.equal(captured.headers['Content-Disposition'], undefined)
  })

  it('forces attachment download and application/octet-stream for legacy non-safe media types on GET /media/content', async () => {
    // Simulate a legacy media.json row written before this hardening with image/svg+xml
    const legacyId = 'a'.repeat(64)
    const legacyFile = join(dir, 'media', legacyId)
    media.importBuffer(Buffer.from('init'), { filename: 'init.png', content_type: 'image/png' })
    writeFileSync(legacyFile, Buffer.from('<svg onload="alert(1)"></svg>'))
    writeFileSync(
      join(dir, 'media.json'),
      JSON.stringify({
        schema: 1,
        revision: 1,
        media: [{
          id: legacyId,
          sha256: legacyId,
          filename: 'legacy.svg',
          content_type: 'image/svg+xml',
          kind: 'image',
          size: 29,
          created_at: new Date().toISOString(),
        }],
      }),
    )
    // Reload MediaStore with legacy media.json
    const reloadedMedia = createMediaStore({
      paths: { mediaIndexFile: join(dir, 'media.json'), mediaDir: join(dir, 'media') },
      maxBytes: 1024 * 1024,
    })
    const store = createRecordStore({ paths: { recordsFile: join(dir, 'records.json') } })
    const tools = { get: () => undefined, execute: async () => ({ results: [] }) }
    const channel = createHubChannel({ tools, fetcher: async () => ({ ok: true, status: 200 }) })
    const accounts = createAccountSource({ channel, overlayPath: '' })
    const config = parsePublishConfig({ dataDir: dir, submitTimeoutSeconds: 5 })
    const service = createSubmitService({ store, media: reloadedMedia, channel, accounts, config })
    const dispatcher = createPublishDispatcher({ store, media: reloadedMedia, accounts, service, channel, config })
    const routes = []
    registerPublishRoutes(
      { register: (route) => { routes.push(route); return () => {} } },
      dispatcher,
      { getConnection: () => ({ requestRejection: () => undefined }) },
    )

    const { req, res, captured } = mockReqRes({
      method: 'GET',
      url: `/omnimux/publish/media/content?id=${legacyId}`,
    })
    await routes[0].handler(req, res)
    assert.equal(captured.status, 200)
    assert.equal(captured.headers['Content-Type'], 'application/octet-stream')
    assert.equal(captured.headers['X-Content-Type-Options'], 'nosniff')
    assert.equal(captured.headers['Content-Security-Policy'], "sandbox; default-src 'none'")
    assert.match(String(captured.headers['Content-Disposition']), /^attachment; filename="legacy\.svg"$/)
  })
})
