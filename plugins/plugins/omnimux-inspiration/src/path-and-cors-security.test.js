import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { apply } from './index.js'
import { LOCAL_PREFIX, assertLocalWrite, corsOriginFor } from './http-routes.js'
import { maybeEnsureVideoCover, resolveContainedMediaFile } from './http-handlers.js'
import { createLocalStore } from './local-store.js'
import { resolveInspirationPaths } from './paths.js'
import { createInspirationShareApi } from '../../omnimux/src/official/inspiration-share.js'

function makeReq({ method = 'GET', url, headers = {}, body } = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const req = Readable.from(payload === '' ? [] : [Buffer.from(payload, 'utf8')])
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:64245', ...(payload === '' ? {} : { 'content-type': 'application/json' }), ...headers }
  return req
}

function makeRes() {
  const state = { status: 0, headers: {}, body: '' }
  const res = new PassThrough()
  res.state = state
  res.writeHead = function writeHead(status, headers) {
    state.status = status
    state.headers = headers || {}
    return this
  }
  res.on('data', (chunk) => { state.body += chunk.toString('utf8') })
  res.json = () => { try { return state.body ? JSON.parse(state.body) : null } catch { return null } }
  return res
}

async function httpCall(route, options) {
  const req = makeReq(options)
  const res = makeRes()
  await route.handler(req, res)
  if (!res.writableEnded) {
    await new Promise((resolve) => {
      res.once('finish', resolve)
      res.once('close', resolve)
      setTimeout(resolve, 100)
    })
  }
  return { status: res.state.status, headers: res.state.headers, body: res.json(), raw: res.state.body }
}

describe('omnimux-inspiration local path boundaries and extension CORS hardening (issue #357)', () => {
  let root = ''
  let prevHome = undefined
  let route = null
  let paths = null
  let store = null
  let shareCalls = []

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'inspiration-path-sec-'))
    prevHome = process.env.DSH_HOME
    process.env.DSH_HOME = root
    paths = resolveInspirationPaths({ homeDir: root })
    mkdirSync(paths.videosDir, { recursive: true })
    mkdirSync(paths.coversDir, { recursive: true })
    store = createLocalStore({ paths })
    shareCalls = []

    const routes = []
    const ctx = {
      tools: { register() {}, get() { return undefined } },
      get(name) {
        if (name === 'inspirationShare') {
          return {
            async publishLocal(args) {
              shareCalls.push(args)
              return { shareId: 'ok', shareUrl: 'https://omnimux.ai/s/ok' }
            },
          }
        }
        return undefined
      },
      inject(deps, cb) {
        if (!deps.includes('webServer')) return
        cb({
          webServer: { register(r) { routes.push(r); return () => {} } },
          effect: () => () => {},
        })
      },
      effect() {},
    }
    apply(ctx)
    route = routes.find((entry) => entry.path === LOCAL_PREFIX)
    assert.ok(route)
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    rmSync(root, { recursive: true, force: true })
  })

  it('rejects traversal id and strips client-supplied local_paths on POST /omnimux/inspiration/local', async () => {
    const outsideSecret = join(root, 'outside-secret.txt')
    writeFileSync(outsideSecret, 'TOP-SECRET')

    const badIdRes = await httpCall(route, {
      method: 'POST',
      url: LOCAL_PREFIX,
      body: {
        id: '../../evil',
        title: 'Bad traversal id',
        local_paths: { video: outsideSecret },
      },
    })
    assert.equal(badIdRes.status, 400)

    const res = await httpCall(route, {
      method: 'POST',
      url: LOCAL_PREFIX,
      body: {
        title: 'Injected row',
        content: 'prompt text',
        local_paths: { video: outsideSecret, cover: outsideSecret },
      },
    })
    assert.equal(res.status, 201)
    assert.match(res.body.data.id, /^insp_/)
    assert.deepEqual(res.body.data.local_paths, {})

    assert.throws(
      () => store.add({ id: '../../evil', title: 'Bad ID' }),
      (err) => err.code === 'item-id-invalid',
    )
    assert.throws(
      () => store.add({ id: 'insp_bad/slash', title: 'Bad ID' }),
      (err) => err.code === 'item-id-invalid',
    )
  })

  it('refuses share uploads and video cover extraction for paths outside mediaDir or via symlinks', async () => {
    const outsideSecret = join(root, 'secret.mp4')
    writeFileSync(outsideSecret, 'SECRET-CONTENT')

    const rowOutside = store.add({
      title: 'Outside Path',
      content: 'prompt',
      local_paths: { video: outsideSecret },
    })
    const shareOutside = await httpCall(route, { method: 'POST', url: `${LOCAL_PREFIX}/${rowOutside.id}/share` })
    assert.equal(shareOutside.status, 400)
    assert.match(shareOutside.body.error, /超出受管媒体目录|符号链接/)
    assert.equal(shareCalls.length, 0)

    const symVideo = join(paths.videosDir, 'escape.mp4')
    symlinkSync(outsideSecret, symVideo)
    const rowSymlink = store.add({
      title: 'Symlink Path',
      content: 'prompt',
      local_paths: { video: symVideo },
    })
    const shareSymlink = await httpCall(route, { method: 'POST', url: `${LOCAL_PREFIX}/${rowSymlink.id}/share` })
    assert.equal(shareSymlink.status, 400)
    assert.match(shareSymlink.body.error, /超出受管媒体目录|符号链接/)
    assert.equal(shareCalls.length, 0)

    // Direct hub inspiration-share API enforces allowedRoot & symlink rejection too
    let uploaded = false
    const shareApi = createInspirationShareApi({
      client: { withSkSite: async () => ({}) },
      siteBaseUrl: 'https://omnimux.ai',
      resolveApiKey: () => 'sk-test-placeholder',
      uploadMedia: async () => {
        uploaded = true
        return 'https://cdn.example/file.mp4'
      },
    })
    await assert.rejects(
      () => shareApi.publishLocal({
        media: { path: outsideSecret },
        meta: { title: 'T', prompt: 'P' },
        allowedRoot: paths.mediaDir,
      }),
      (err) => err.code === 'omnimux-share-asset-outside-root',
    )
    await assert.rejects(
      () => shareApi.publishLocal({
        media: { path: symVideo },
        meta: { title: 'T', prompt: 'P' },
        allowedRoot: paths.mediaDir,
      }),
      (err) => err.code === 'omnimux-share-asset-outside-root',
    )
    assert.equal(uploaded, false)

    // maybeEnsureVideoCover ignores traversal IDs and outside/symlink video paths
    const traversalItem = {
      id: '../../escaped',
      type: 'video',
      local_paths: { video: outsideSecret },
    }
    const unchanged = maybeEnsureVideoCover(traversalItem, store, paths)
    assert.equal(unchanged.cover_url, undefined)
    assert.equal(existsSync(join(paths.dir, 'cover_..')), false)
    assert.equal(resolveContainedMediaFile(symVideo, paths.mediaDir).ok, false)
    assert.equal(resolveContainedMediaFile(outsideSecret, paths.mediaDir).ok, false)
  })

  it('blocks symlink escapes and traversal on /media/ stream and emits sandbox CSP + nosniff', async () => {
    const outsideSecret = join(root, 'leak.jpg')
    writeFileSync(outsideSecret, 'LEAK')
    symlinkSync(outsideSecret, join(paths.coversDir, 'sym.jpg'))

    const symRes = await httpCall(route, { url: `${LOCAL_PREFIX}/media/covers/sym.jpg` })
    assert.equal(symRes.status, 403)

    const travRes = await httpCall(route, { url: `${LOCAL_PREFIX}/media/covers/..%2f..%2fleak.jpg` })
    assert.equal(travRes.status, 400)
    const collapsedTravRes = await httpCall(route, { url: `${LOCAL_PREFIX}/media/covers/%2e%2e/%2e%2e/leak.jpg` })
    assert.notEqual(collapsedTravRes.status, 200)
    assert.equal(collapsedTravRes.raw.includes('LEAK'), false)

    const legit = join(paths.coversDir, 'legit.jpg')
    writeFileSync(legit, Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
    const okRes = await httpCall(route, { url: `${LOCAL_PREFIX}/media/covers/legit.jpg` })
    assert.equal(okRes.status, 200)
    assert.equal(okRes.headers['X-Content-Type-Options'], 'nosniff')
    assert.equal(okRes.headers['Content-Security-Policy'], "sandbox; default-src 'none'")
    assert.equal(okRes.headers['Cross-Origin-Resource-Policy'], 'same-origin')
  })

  it('rejects arbitrary chrome-extension origins while allowing paired bridge-token or explicitly allowlisted origins', async () => {
    const evilOrigin = 'chrome-extension://eviluntrustedextensionid'
    assert.equal(corsOriginFor({ headers: { origin: evilOrigin } }, { dshHome: root }), '')
    assert.throws(() => assertLocalWrite({ headers: { origin: evilOrigin } }, { dshHome: root }), /cross-origin/)

    // OPTIONS without Origin must never emit wildcard '*'
    const noOriginOpt = await httpCall(route, { method: 'OPTIONS', url: LOCAL_PREFIX })
    assert.equal(noOriginOpt.status, 204)
    assert.equal(noOriginOpt.headers['Access-Control-Allow-Origin'], undefined)

    // Persist a valid bridge token and verify authenticated extension requests succeed
    const token = 'paired-bridge-token-0123456789abcdef'
    writeFileSync(join(root, 'ext-bridge-token'), `${token}\n`, { mode: 0o600 })

    assert.equal(
      corsOriginFor({ headers: { origin: evilOrigin, 'x-omnimux-bridge-token': 'wrong-token-value-1234' } }, { dshHome: root }),
      '',
    )
    assert.throws(
      () => assertLocalWrite({ headers: { origin: evilOrigin, 'x-omnimux-bridge-token': 'wrong-token-value-1234' } }, { dshHome: root }),
      /cross-origin/,
    )

    const authedCreate = await httpCall(route, {
      method: 'POST',
      url: LOCAL_PREFIX,
      headers: { origin: evilOrigin, 'x-omnimux-bridge-token': token },
      body: { title: 'Authorized extension item' },
    })
    assert.equal(authedCreate.status, 201)
    assert.equal(authedCreate.headers['Access-Control-Allow-Origin'], evilOrigin)
    assert.equal(authedCreate.headers['Access-Control-Allow-Private-Network'], undefined)

    // Persisted ext-allowed-origins.json grants exact extension origin without wildcard
    const pairedOrigin = 'chrome-extension://officialpairedextensionid'
    writeFileSync(join(root, 'ext-allowed-origins.json'), JSON.stringify([pairedOrigin]), { mode: 0o600 })
    const allowedOpt = await httpCall(route, {
      method: 'OPTIONS',
      url: `${LOCAL_PREFIX}/import-url`,
      headers: { origin: pairedOrigin },
    })
    assert.equal(allowedOpt.status, 204)
    assert.equal(allowedOpt.headers['Access-Control-Allow-Origin'], pairedOrigin)
    assert.equal(allowedOpt.headers['Vary'], 'Origin')
    assert.equal(allowedOpt.headers['Content-Length'], undefined)
    assert.equal(allowedOpt.raw, '')

    // Authorized extension with browser Sec-Fetch-Site: cross-site still passes once verified
    const extCrossSite = await httpCall(route, {
      method: 'POST',
      url: LOCAL_PREFIX,
      headers: { origin: pairedOrigin, 'sec-fetch-site': 'cross-site' },
      body: { title: 'Allowlisted extension cross-site item' },
    })
    assert.equal(extCrossSite.status, 201)

    // Crafted unnormalized Origin (path/query) and non-HTTP schemes must never be reflected or admitted
    assert.equal(
      corsOriginFor({ headers: { origin: 'http://127.0.0.1:64245/injected?x=1', host: '127.0.0.1:64245' } }, { dshHome: root }),
      '',
    )
    assert.throws(
      () => assertLocalWrite({ headers: { origin: 'http://127.0.0.1:64245/injected?x=1', host: '127.0.0.1:64245' } }, { dshHome: root }),
      /cross-origin/,
    )
    assert.throws(
      () => assertLocalWrite({ headers: { origin: `${pairedOrigin}/evil?x=1` } }, { dshHome: root }),
      /cross-origin/,
    )
    assert.throws(
      () => assertLocalWrite({ headers: { origin: 'ws://127.0.0.1:64245' } }, { dshHome: root }),
      /cross-origin/,
    )
  })

  it('rejects outside or symlinked local_paths.video on POST /analyze and refuses dangling cover symlinks', async () => {
    const outsideSecret = join(root, 'outside-analyze.mp4')
    writeFileSync(outsideSecret, 'SECRET-VIDEO')

    const rowOutside = store.add({
      title: 'Outside Analyze',
      type: 'video',
      local_paths: { video: outsideSecret },
    })
    const analyzeOutside = await httpCall(route, {
      method: 'POST',
      url: `${LOCAL_PREFIX}/${rowOutside.id}/analyze`,
      body: { scope: 'post', directions: ['content'] },
    })
    assert.notEqual(analyzeOutside.status, 200)

    const symVideo = join(paths.videosDir, 'analyze-sym.mp4')
    symlinkSync(outsideSecret, symVideo)
    const rowSym = store.add({
      title: 'Symlink Analyze',
      type: 'video',
      local_paths: { video: symVideo },
    })
    const analyzeSym = await httpCall(route, {
      method: 'POST',
      url: `${LOCAL_PREFIX}/${rowSym.id}/analyze`,
      body: { scope: 'post', directions: ['content'] },
    })
    assert.notEqual(analyzeSym.status, 200)

    // Dangling symlink at target cover path must NOT be overwritten by ffmpeg
    const realVideo = join(paths.videosDir, 'real.mp4')
    writeFileSync(realVideo, 'FAKE-MP4')
    const danglingTarget = join(root, 'should-not-create.jpg')
    const danglingCover = join(paths.coversDir, 'cover_dangling1.jpg')
    symlinkSync(danglingTarget, danglingCover)
    const out = maybeEnsureVideoCover({ id: 'insp_dangling1', type: 'video', local_paths: { video: realVideo } }, store, paths)
    assert.equal(out.cover_url, undefined)
    assert.equal(existsSync(danglingTarget), false)
  })
})
