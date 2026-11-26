import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { parsePublishConfig } from './config.js'
import { createPublishDispatcher, registerPublishRoutes } from './http-routes.js'
import { createHubChannel } from './hubtools.js'
import { createAccountSource } from './accounts.js'
import { createMediaStore } from './media.js'
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

describe('omnimux-publish local path boundaries (issue #357)', () => {
  let dir = ''
  let media = null
  let dispatcher = null
  let routeHandler = null

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-publish-path-sec-'))
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
    dispatcher = createPublishDispatcher({ store, media, accounts, service, channel, config })
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

  it('rejects local file path refs on HTTP POST /drafts and POST /drafts/update', async () => {
    const localImg = join(dir, 'photo.png')
    writeFileSync(localImg, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const createRes = mockReqRes({
      method: 'POST',
      url: '/omnimux/publish/drafts',
      headers: LOCAL,
      body: { type: 'image', payload: { title: 'Test', media: [{ path: localImg }] } },
    })
    await routeHandler(createRes.req, createRes.res)
    assert.equal(createRes.captured.status, 403)
    assert.equal(createRes.captured.body.error, 'path-not-allowed')

    const coverRes = mockReqRes({
      method: 'POST',
      url: '/omnimux/publish/drafts',
      headers: LOCAL,
      body: { type: 'image', payload: { title: 'Test', media: [], cover: { path: localImg } } },
    })
    await routeHandler(coverRes.req, coverRes.res)
    assert.equal(coverRes.captured.status, 403)
    assert.equal(coverRes.captured.body.error, 'path-not-allowed')

    // Valid HTTP draft uses uploaded media_id, and updateDraft still refuses local path refs
    const uploaded = media.importBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47]), { filename: 'ok.png', content_type: 'image/png' }).media
    const okDraft = mockReqRes({
      method: 'POST',
      url: '/omnimux/publish/drafts',
      headers: LOCAL,
      body: { type: 'image', payload: { title: 'OK', media: [{ media_id: uploaded.id }] } },
    })
    await routeHandler(okDraft.req, okDraft.res)
    assert.equal(okDraft.captured.status, 200)
    const draftId = okDraft.captured.body.record.id

    const updateRes = mockReqRes({
      method: 'POST',
      url: '/omnimux/publish/drafts/update',
      headers: LOCAL,
      body: { draft_id: draftId, patch: { media: [{ path: localImg }] } },
    })
    await routeHandler(updateRes.req, updateRes.res)
    assert.equal(updateRes.captured.status, 403)
    assert.equal(updateRes.captured.body.error, 'path-not-allowed')

    const updateCoverRes = mockReqRes({
      method: 'POST',
      url: '/omnimux/publish/drafts/update',
      headers: LOCAL,
      body: { draft_id: draftId, patch: { cover: { path: localImg } } },
    })
    await routeHandler(updateCoverRes.req, updateCoverRes.res)
    assert.equal(updateCoverRes.captured.status, 403)
    assert.equal(updateCoverRes.captured.body.error, 'path-not-allowed')
  })

  it('blocks case-insensitive sensitive path bypasses, custom DSH_HOME secrets, and UNC paths in MediaStore.importPath', () => {
    // Uppercase / mixed-case sensitive system & credential directories must be rejected
    if (process.platform === 'darwin') {
      assert.throws(
        () => media.importPath('/PRIVATE/ETC/hosts'),
        (err) => err instanceof PublishError && err.code === 'path-not-allowed',
      )
    }

    const upperSsh = join(dir, '.SSH')
    mkdirSync(upperSsh, { recursive: true })
    const upperKey = join(upperSsh, 'photo.png')
    writeFileSync(upperKey, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    assert.throws(
      () => media.importPath(upperKey),
      (err) => err instanceof PublishError && err.code === 'path-not-allowed',
    )

    const lowerKeychains = join(dir, 'Library', 'keychains')
    mkdirSync(lowerKeychains, { recursive: true })
    const kcFile = join(lowerKeychains, 'login.png')
    writeFileSync(kcFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    assert.throws(
      () => media.importPath(kcFile),
      (err) => err instanceof PublishError && err.code === 'path-not-allowed',
    )

    const upperDsh = join(dir, '.DSH')
    mkdirSync(upperDsh, { recursive: true })
    const upperDshToken = join(upperDsh, 'token.png')
    writeFileSync(upperDshToken, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    assert.throws(
      () => media.importPath(upperDshToken),
      (err) => err instanceof PublishError && err.code === 'path-not-allowed',
    )

    // Custom DSH_HOME outside managed media subtrees must also be blocked
    const customHome = join(dir, 'custom-home')
    mkdirSync(customHome, { recursive: true })
    const customSecret = join(customHome, 'settings.png')
    writeFileSync(customSecret, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const prevDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = customHome
    try {
      assert.throws(
        () => media.importPath(customSecret),
        (err) => err instanceof PublishError && err.code === 'path-not-allowed',
      )
    } finally {
      if (prevDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prevDshHome
    }

    // UNC / double-slash paths rejected
    assert.throws(
      () => media.importPath('//server/share/photo.png'),
      (err) => err instanceof PublishError && err.code === 'path-not-allowed',
    )
    assert.throws(
      () => media.importPath('\\\\server\\share\\photo.png'),
      (err) => err instanceof PublishError && err.code === 'path-not-allowed',
    )
  })

  it('rejects symlinks, sensitive credential paths, out-of-root paths, and active web files in MediaStore.importPath', () => {
    const validFile = join(dir, 'sample.png')
    writeFileSync(validFile, Buffer.from('png-bytes'))

    // Symlink rejected
    const linkPath = join(dir, 'link.png')
    symlinkSync(validFile, linkPath)
    assert.throws(
      () => media.importPath(linkPath),
      (err) => err instanceof PublishError && err.code === 'path-not-allowed',
    )

    // Relative / null-byte paths rejected
    assert.throws(
      () => media.importPath('relative/photo.png'),
      (err) => err instanceof PublishError && err.code === 'path-not-allowed',
    )
    assert.throws(
      () => media.importPath(`${validFile}\0.png`),
      (err) => err instanceof PublishError && err.code === 'path-not-allowed',
    )

    // Sensitive credential directories and files rejected
    const sshDir = join(dir, '.ssh')
    mkdirSync(sshDir, { recursive: true })
    const keyFile = join(sshDir, 'id_ed25519')
    writeFileSync(keyFile, 'PRIVATE-KEY')
    assert.throws(
      () => media.importPath(keyFile),
      (err) => err instanceof PublishError && err.code === 'path-not-allowed',
    )

    const envFile = join(dir, '.env')
    writeFileSync(envFile, 'TOKEN=12345')
    assert.throws(
      () => media.importPath(envFile),
      (err) => err instanceof PublishError && err.code === 'path-not-allowed',
    )

    // Active HTML/SVG content or extension rejected
    const svgFile = join(dir, 'evil.svg')
    writeFileSync(svgFile, '<svg onload="alert(1)"></svg>')
    assert.throws(
      () => media.importPath(svgFile),
      (err) => err instanceof PublishError && err.code === 'unsupported-media-type',
    )

    const spoofedHtml = join(dir, 'spoof.png')
    writeFileSync(spoofedHtml, '<!doctype html><html><script>alert(1)</script></html>')
    assert.throws(
      () => media.importPath(spoofedHtml),
      (err) => err instanceof PublishError && err.code === 'unsupported-media-type',
    )

    // allowedRoots boundary enforced when configured
    const allowedDir = join(dir, 'allowed')
    mkdirSync(allowedDir, { recursive: true })
    const restricted = createMediaStore({
      paths: { mediaIndexFile: join(dir, 'media2.json'), mediaDir: join(dir, 'media2') },
      allowedRoots: [allowedDir],
    })
    assert.throws(
      () => restricted.importPath(validFile),
      (err) => err instanceof PublishError && err.code === 'path-not-allowed',
    )
    const insideFile = join(allowedDir, 'inside.png')
    writeFileSync(insideFile, Buffer.from('ok-image'))
    const imported = restricted.importPath(insideFile)
    assert.equal(imported.media.filename, 'inside.png')
  })
})
