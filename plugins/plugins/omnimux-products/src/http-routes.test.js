import { importProductFromUrl } from './link-importer.js'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { createHubSeams, createProductsDispatcher, sendJson } from './http-routes.js'
import { createDraftMediaRegistry } from './draft-media.js'
import { createLibraryStore } from './library.js'

let root
let realFile

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'products-routes-'))
  realFile = join(root, 'hero.png')
  writeFileSync(realFile, 'png')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function makeDispatcher(opts = {}) {
  const library = createLibraryStore({
    paths: { libraryFile: join(root, 'store', 'library.json') },
  })
  const deps = { library }
  if (opts.picker) deps.picker = opts.picker
  if (opts.getService) deps.getService = opts.getService
  if (opts.importFromUrl) deps.importFromUrl = opts.importFromUrl
  if (opts.ctx) deps.ctx = opts.ctx
  if (opts.headlessSkill) deps.headlessSkill = opts.headlessSkill
  if (Object.prototype.hasOwnProperty.call(opts, 'hub')) deps.hub = opts.hub
  if (opts.paths) deps.paths = opts.paths
  if (opts.draftMedia) deps.draftMedia = opts.draftMedia
  return { dispatcher: createProductsDispatcher(deps), library }
}

describe('ProductsDispatcher nativeFilePicker seam', () => {
  it('uses the hub seam by default and forwards the products prompt', async () => {
    const calls = []
    const { dispatcher } = makeDispatcher({
      getService: (name) => (name === 'nativeFilePicker'
        ? {
            pick: async (kind, options) => {
              calls.push({ kind, options })
              return { path: '/tmp/product.png', paths: ['/tmp/product.png'] }
            },
          }
        : undefined),
    })
    const picked = await dispatcher.dispatch(post('/omnimux/products/pick', { kind: 'file' }))
    assert.equal(picked.status, 200)
    assert.deepEqual(picked.body, { path: '/tmp/product.png', paths: ['/tmp/product.png'] })
    assert.deepEqual(calls, [{ kind: 'file', options: { prompt: '选择要挂到产品的文件' } }])
  })

  it('answers 503 picker-unavailable when the hub seam is missing', async () => {
    const { dispatcher } = makeDispatcher({ getService: () => undefined })
    const missing = await dispatcher.dispatch(post('/omnimux/products/pick', { kind: 'file' }))
    assert.equal(missing.status, 503)
    assert.equal(missing.body.error, 'picker-unavailable')
  })

  it('maps coded picker failures to 400 / 501 / 500 and unknown errors to internal', async () => {
    for (const [code, status] of [['picker-invalid-kind', 400], ['picker-unsupported', 501], ['picker-failed', 500]]) {
      const { dispatcher } = makeDispatcher({
        picker: async () => { throw Object.assign(new Error(code), { code }) },
      })
      const result = await dispatcher.dispatch(post('/omnimux/products/pick', { kind: 'file' }))
      assert.equal(result.status, status, code)
      assert.equal(result.body.error, code)
    }
    const { dispatcher } = makeDispatcher({
      picker: async () => { throw new Error('boom') },
    })
    const plain = await dispatcher.dispatch(post('/omnimux/products/pick', { kind: 'file' }))
    assert.equal(plain.status, 500)
    assert.equal(plain.body.error, 'internal')
  })
})

function post(path, body, extra = {}) {
  return { method: 'POST', url: path, body, ...extra }
}

function put(path, body, extra = {}) {
  return { method: 'PUT', url: path, body, ...extra }
}

function del(path, extra = {}) {
  return { method: 'DELETE', url: path, ...extra }
}

describe('ProductsDispatcher state', () => {
  it('returns full state initially and unchanged (no products) when prev matches', async () => {
    const { dispatcher, library } = makeDispatcher()
    const first = await dispatcher.dispatch({ method: 'GET', url: '/omnimux/products/state' })
    assert.equal(first.status, 200)
    assert.equal(first.body.unchanged, false)
    assert.equal(first.body.revision, 0)
    assert.deepEqual(first.body.products, [])

    library.add({ name: '某防晒', selling_points: '清爽' })
    const second = await dispatcher.dispatch({ method: 'GET', url: '/omnimux/products/state?prev=0' })
    assert.equal(second.status, 200)
    assert.equal(second.body.unchanged, false)
    assert.equal(second.body.products.length, 1)
    assert.equal(Object.prototype.hasOwnProperty.call(second.body, 'products'), true)

    const rev = second.body.revision
    const third = await dispatcher.dispatch({ method: 'GET', url: `/omnimux/products/state?prev=${rev}` })
    assert.equal(third.body.unchanged, true)
    assert.equal(third.body.revision, rev)
    assert.equal(Object.prototype.hasOwnProperty.call(third.body, 'products'), false)
  })
})

describe('ProductsDispatcher CRUD', () => {
  it('creates, conflicts 409, 404s missing, and deletes via REST verbs', async () => {
    const { dispatcher, library } = makeDispatcher()
    const created = await dispatcher.dispatch(post('/omnimux/products', {
      name: '某防晒',
      selling_points: '清爽不粘腻',
      media: [{ real_path: realFile }],
    }))
    assert.equal(created.status, 200)
    assert.equal(created.body.product.cite, '@产品/某防晒')
    assert.equal(library.list().length, 1)
    const id = created.body.product.id

    const conflict = await dispatcher.dispatch(post('/omnimux/products', { name: '某防晒' }))
    assert.equal(conflict.status, 409)
    assert.equal(conflict.body.error, 'name-conflict')

    const missing = await dispatcher.dispatch({ method: 'GET', url: '/omnimux/products/prd_deadbeef' })
    assert.equal(missing.status, 404)
    assert.equal(missing.body.error, 'product-not-found')

    const updated = await dispatcher.dispatch(put(`/omnimux/products/${id}`, { price: '199' }))
    assert.equal(updated.status, 200)
    assert.equal(updated.body.product.price, '199')

    const listed = await dispatcher.dispatch({ method: 'GET', url: '/omnimux/products?q=清爽' })
    assert.equal(listed.status, 200)
    assert.equal(listed.body.products.length, 1)

    const media = await dispatcher.dispatch({ method: 'GET', url: `/omnimux/products/${id}/media` })
    assert.equal(media.status, 200)
    assert.equal(media.body.media.length, 1)

    const deleted = await dispatcher.dispatch(del(`/omnimux/products/${id}`))
    assert.equal(deleted.status, 200)
    assert.equal(library.list().length, 0)

    const gone = await dispatcher.dispatch(del(`/omnimux/products/${id}`))
    assert.equal(gone.status, 404)
  })

  it('returns 400 for invalid or unavailable media without creating or changing products', async () => {
    const { dispatcher, library } = makeDispatcher()
    for (const [path, code] of [
      ['relative/hero.png', 'media-path-invalid'],
      [join(root, 'missing.png'), 'media-path-unavailable'],
    ]) {
      const rejected = await dispatcher.dispatch(post('/omnimux/products', {
        name: '无效商品', media: [{ real_path: path }],
      }))
      assert.equal(rejected.status, 400)
      assert.equal(rejected.body.error, code)
    }
    assert.deepEqual(library.list(), [])
    assert.equal(library.revision(), 0)

    const product = library.add({ name: '某防晒', price: '99', media: [{ real_path: realFile }] })
    const before = library.get(product.id)
    const rejected = await dispatcher.dispatch(put(`/omnimux/products/${product.id}`, {
      name: '新名称', price: '199', media: [{ real_path: join(root, 'missing.png') }],
    }))
    assert.equal(rejected.status, 400)
    assert.equal(rejected.body.error, 'media-path-unavailable')
    assert.deepEqual(library.get(product.id), before)
    assert.equal(library.revision(), 1)
  })

  it('PUT without a JSON object is invalid-json', async () => {
    const { dispatcher } = makeDispatcher()
    const created = await dispatcher.dispatch(post('/omnimux/products', { name: '某防晒' }))
    const id = created.body.product.id
    const bad = await dispatcher.dispatch(put(`/omnimux/products/${id}`, null))
    assert.equal(bad.status, 400)
    assert.equal(bad.body.error, 'invalid-json')
  })
})

describe('ProductsDispatcher kind + brand_strategy', () => {
  it('POST digital + strategy 200', async () => {
    const { dispatcher } = makeDispatcher()
    const created = await dispatcher.dispatch(post('/omnimux/products', {
      name: '数字货',
      kind: 'digital',
      selling_points: '订阅制',
      brand_strategy: { brand_basic_info: { product: { name: 'X' } } },
    }))
    assert.equal(created.status, 200)
    assert.equal(created.body.product.kind, 'digital')
    assert.equal(created.body.product.brand_strategy.brand_basic_info.product.name, 'X')
  })

  it('kind service 400', async () => {
    const { dispatcher } = makeDispatcher()
    const bad = await dispatcher.dispatch(post('/omnimux/products', { name: '服务货', kind: 'service' }))
    assert.equal(bad.status, 400)
    assert.equal(bad.body.error, 'kind-invalid')
  })

  it('PUT only price keeps strategy; PUT null clears', async () => {
    const { dispatcher } = makeDispatcher()
    const created = await dispatcher.dispatch(post('/omnimux/products', {
      name: '某防晒',
      selling_points: '清爽',
      brand_strategy: { brand_basic_info: { product: { name: 'X' } } },
    }))
    const id = created.body.product.id

    const priced = await dispatcher.dispatch(put(`/omnimux/products/${id}`, { price: '199' }))
    assert.equal(priced.status, 200)
    assert.equal(priced.body.product.price, '199')
    assert.equal(priced.body.product.brand_strategy.brand_basic_info.product.name, 'X')

    const cleared = await dispatcher.dispatch(put(`/omnimux/products/${id}`, { brand_strategy: null }))
    assert.equal(cleared.status, 200)
    assert.equal(cleared.body.product.brand_strategy, null)
  })

  it('POST [] 400; POST {} stores null', async () => {
    const { dispatcher } = makeDispatcher()
    const arrayBody = await dispatcher.dispatch(post('/omnimux/products', {
      name: '数组战略',
      brand_strategy: [],
    }))
    assert.equal(arrayBody.status, 400)
    assert.equal(arrayBody.body.error, 'brand-strategy-invalid')

    const emptyObj = await dispatcher.dispatch(post('/omnimux/products', {
      name: '空战略',
      brand_strategy: {},
    }))
    assert.equal(emptyObj.status, 200)
    assert.equal(emptyObj.body.product.brand_strategy, null)
  })
})

describe('ProductsDispatcher loopback guard', () => {
  it('rejects cross-origin POST/PUT/DELETE with 403 not-local', async () => {
    const { dispatcher } = makeDispatcher()
    const evilPost = await dispatcher.dispatch(post('/omnimux/products', { name: 'x' }, { origin: 'http://evil.example' }))
    assert.equal(evilPost.status, 403)
    assert.equal(evilPost.body.error, 'not-local')

    const local = await dispatcher.dispatch(post('/omnimux/products', { name: '本机货' }, { origin: 'http://127.0.0.1:3210' }))
    assert.equal(local.status, 200)
    const id = local.body.product.id

    const evilPut = await dispatcher.dispatch(put(`/omnimux/products/${id}`, { price: '1' }, { origin: 'http://evil.example' }))
    assert.equal(evilPut.status, 403)

    const evilDel = await dispatcher.dispatch(del(`/omnimux/products/${id}`, { secFetchSite: 'cross-site' }))
    assert.equal(evilDel.status, 403)
  })
})

describe('ProductsDispatcher import-from-link', () => {
  it('POST returns { success, data } and forwards url + kind to the importer', async () => {
    const seen = []
    const imported = { name: '某防晒 50ml', brand: 'Aurora', categories: ['Beauty'], images: [] }
    const { dispatcher, library } = makeDispatcher({
      importFromUrl: async (args) => {
        seen.push(args)
        return imported
      },
    })

    const ok = await dispatcher.dispatch(post('/omnimux/products/import-from-link', {
      url: 'https://shop.example.com/p/1',
      kind: 'digital',
    }))
    assert.equal(ok.status, 200)
    assert.equal(ok.body.success, true)
    assert.deepEqual(ok.body.data, imported)
    assert.equal(seen.length, 1)
    // The url, the kind and the hub seams cross; this vertical holds no
    // credential and calls no OmniMux HTTP surface of its own.
    assert.equal(seen[0].url, 'https://shop.example.com/p/1')
    assert.equal(seen[0].kind, 'digital')
    assert.equal(seen[0].hub, null, 'no host ctx means no hub seams, not a failure')
    // Importing never writes to the library.
    assert.deepEqual(library.list(), [])
    assert.equal(library.revision(), 0)
  })

  it('hands the host seats to the importer as hub seams', async () => {
    const seen = []
    const headlessSkill = { run: async () => ({ data: { ok: true }, model: 'hub-default' }) }
    const pageFetch = { fetch: async () => ({ pageContent: '# page' }) }
    const ctx = {
      get: (name) => (name === 'headlessSkill'
        ? headlessSkill
        : name === 'pageFetch' ? pageFetch : undefined),
    }
    const { dispatcher } = makeDispatcher({
      ctx,
      importFromUrl: async (args) => {
        seen.push(args)
        return { name: '货' }
      },
    })
    const ok = await dispatcher.dispatch(post('/omnimux/products/import-from-link', { url: 'https://shop.example.com/p/1' }))
    assert.equal(ok.status, 200)
    assert.equal(typeof seen[0].hub.pageFetch, 'function')
    assert.equal(typeof seen[0].hub.headlessSkill?.run, 'function')
    const answer = await seen[0].hub.headlessSkill.run({ skillName: 'products-physical-import', input: 'hi' })
    assert.deepEqual(answer, { data: { ok: true }, model: 'hub-default' })
    assert.deepEqual(await seen[0].hub.pageFetch('https://shop.example.com/p/1'), { pageContent: '# page' })
  })

  it('defaults kind to physical when the body omits it', async () => {
    const seen = []
    const { dispatcher } = makeDispatcher({
      importFromUrl: async (args) => {
        seen.push(args)
        return { name: '货' }
      },
    })
    const ok = await dispatcher.dispatch(post('/omnimux/products/import-from-link', { url: 'https://shop.example.com/p/1' }))
    assert.equal(ok.status, 200)
    assert.equal(seen[0].kind, 'physical')
  })

  it('validates the url with the real importer and answers 400 invalid-url', async () => {
    const { dispatcher } = makeDispatcher()
    for (const bad of ['javascript:alert(1)', 'http://127.0.0.1:8080/p', 'not a url', '']) {
      const rejected = await dispatcher.dispatch(post('/omnimux/products/import-from-link', { url: bad }))
      assert.equal(rejected.status, 400, `expected 400 for ${bad}`)
      assert.equal(rejected.body.error, 'invalid-url')
    }
  })

  it('rejects an unknown kind and a non-object body', async () => {
    const { dispatcher } = makeDispatcher()
    const badKind = await dispatcher.dispatch(post('/omnimux/products/import-from-link', {
      url: 'https://shop.example.com/p/1',
      kind: 'service',
    }))
    assert.equal(badKind.status, 400)
    assert.equal(badKind.body.error, 'kind-invalid')

    const badBody = await dispatcher.dispatch(post('/omnimux/products/import-from-link', null))
    assert.equal(badBody.status, 400)
    assert.equal(badBody.body.error, 'invalid-json')
  })

  it('maps an importer failure onto its own status code', async () => {
    const { dispatcher } = makeDispatcher({
      importFromUrl: async () => {
        const { LinkImportError } = await import('./link-importer.js')
        throw new LinkImportError('link-import-failed', 'the page responded HTTP 500')
      },
    })
    const failed = await dispatcher.dispatch(post('/omnimux/products/import-from-link', { url: 'https://shop.example.com/p/1' }))
    assert.equal(failed.status, 502)
    assert.equal(failed.body.error, 'link-import-failed')
  })

  it('answers 422 link-import-empty for a page with no product information', async () => {
    const { dispatcher } = makeDispatcher({
      importFromUrl: async () => {
        const { LinkImportError } = await import('./link-importer.js')
        throw new LinkImportError('link-import-empty', 'no product information was found on the page')
      },
    })
    const empty = await dispatcher.dispatch(post('/omnimux/products/import-from-link', { url: 'https://shop.example.com/p/1' }))
    assert.equal(empty.status, 422)
    assert.equal(empty.body.error, 'link-import-empty')
  })

  it('reaches that 422 through the real importer and a chrome-only page', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      text: async () => '<head><title>首页 | Example Store</title></head><body><ul><li>首页</li><li>登录</li><li>购物车</li></ul></body>',
    })
    try {
      const { dispatcher } = makeDispatcher({ importFromUrl: (args) => importProductFromUrl({ ...args, fetcher: globalThis.fetch }) })
      const empty = await dispatcher.dispatch(post('/omnimux/products/import-from-link', { url: 'https://shop.example.com/p/1' }))
      assert.equal(empty.status, 422)
      assert.equal(empty.body.error, 'link-import-empty')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('keeps the local-write guard on the import route', async () => {
    const { dispatcher } = makeDispatcher({ importFromUrl: async () => ({ name: '货' }) })
    const evil = await dispatcher.dispatch(post('/omnimux/products/import-from-link', {
      url: 'https://shop.example.com/p/1',
    }, { origin: 'http://evil.example' }))
    assert.equal(evil.status, 403)
    assert.equal(evil.body.error, 'not-local')

    const crossSite = await dispatcher.dispatch(post('/omnimux/products/import-from-link', {
      url: 'https://shop.example.com/p/1',
    }, { secFetchSite: 'cross-site' }))
    assert.equal(crossSite.status, 403)

    const local = await dispatcher.dispatch(post('/omnimux/products/import-from-link', {
      url: 'https://shop.example.com/p/1',
    }, { origin: 'http://127.0.0.1:3210' }))
    assert.equal(local.status, 200)
  })

  it('imports a physical page end-to-end through the Hub headlessSkill seam', async () => {
    const page = '<html><head><title>落地页</title></head><body><h1>智能记账杯</h1>'
      + '<ul><li>双层陶瓷保温</li><li>防滑底座</li></ul></body></html>'
    const calls = []
    const ctx = {
      get: (name) => {
        if (name === 'headlessSkill') {
          return {
            run: async (request) => {
              calls.push(request)
              return {
                model: 'gemini-3.8-flash',
                data: {
                  name: '智能记账杯',
                  description: '双层陶瓷保温杯',
                  features: '双层陶瓷保温，防滑底座',
                  selling_points: '6 小时保温，防滑硅胶底',
                  brand: 'Aurora',
                  target_audience: '咖啡爱好者',
                  price: 29.9,
                  sku: null,
                  promotion: null,
                  categories: ['home', 'drinkware'],
                },
              }
            },
          }
        }
        if (name === 'pageFetch') {
          return { fetch: async () => ({ pageContent: '# 智能记账杯\n\n双层陶瓷保温，防滑底座' }) }
        }
        return undefined
      },
    }
    const { dispatcher } = makeDispatcher({
      ctx,
      importFromUrl: (args) => importProductFromUrl({ ...args, fetcher: globalThis.fetch }),
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(page, { status: 200, headers: { 'content-type': 'text/html' } })
    try {
      const ok = await dispatcher.dispatch(post('/omnimux/products/import-from-link', { url: 'https://shop.example.com/p/1' }))
      assert.equal(ok.status, 200)
      assert.equal(ok.body.success, true)
      assert.equal(ok.body.data.analysis.mode, 'model')
      assert.equal(ok.body.data.name, '智能记账杯')
      assert.equal(calls.length, 1)
      assert.equal(calls[0].skillName, 'products-physical-import')
      assert.equal(calls[0].ownerPlugin, 'omnimux-products')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('products hub seams', () => {
  it('answers null without a host context, and resolves nothing eagerly', () => {
    assert.equal(createHubSeams(undefined), null)
    assert.equal(createHubSeams(null), null)
    const seams = createHubSeams({})
    assert.equal(typeof seams.headlessSkill.run, 'function')
    assert.equal(typeof seams.headlessSkill.cancel, 'function')
    assert.equal(typeof seams.headlessSkill.getJob, 'function')
    assert.equal(typeof seams.headlessSkill.listJobs, 'function')
    assert.equal(typeof seams.pageFetch, 'function')
    assert.equal(typeof seams.socialData, 'function')
  })

  it('delegates headlessSkill.run / cancel / getJob / listJobs lazily to ctx.get("headlessSkill")', async () => {
    const calls = []
    const ctx = {
      get: (name) => (name === 'headlessSkill'
        ? {
            run: async (req) => { calls.push(['run', req]); return { data: { ok: true } } },
            cancel: (jobId, reason) => { calls.push(['cancel', jobId, reason]); return true },
            getJob: (jobId) => ({ id: jobId, status: 'running' }),
            listJobs: (filter) => [{ id: 'j1', ...filter }],
          }
        : undefined),
    }
    const seams = createHubSeams(ctx)
    const answer = await seams.headlessSkill.run({ skillName: 'products-brand-strategy', input: 'p' })
    assert.deepEqual(answer, { data: { ok: true } })
    assert.equal(seams.headlessSkill.cancel('j1', 'user-cancel'), true)
    assert.deepEqual(seams.headlessSkill.getJob('j1'), { id: 'j1', status: 'running' })
    assert.deepEqual(seams.headlessSkill.listJobs({ ownerPlugin: 'omnimux-products' }), [{ id: 'j1', ownerPlugin: 'omnimux-products' }])
    assert.deepEqual(calls, [
      ['run', { skillName: 'products-brand-strategy', input: 'p' }],
      ['cancel', 'j1', 'user-cancel'],
    ])
  })

  it('prefers an injected headlessSkill override in tests', async () => {
    let ctxReads = 0
    const ctx = { get: () => { ctxReads += 1; return undefined } }
    const seams = createHubSeams(ctx, {
      headlessSkill: { run: async () => ({ data: { from: 'override' } }) },
    })
    assert.deepEqual(await seams.headlessSkill.run({ skillName: 'x', input: 'p' }), { data: { from: 'override' } })
    assert.equal(ctxReads, 0)
  })

  it('reads the page through omnimux_page_fetch, and fails with headless-skill-unavailable when headlessSkill is missing', async () => {
    const ctx = { get: (name) => (name === 'pageFetch' ? { fetch: async (args) => ({ pageContent: `# ${args.url}` }) } : undefined) }
    const seams = createHubSeams(ctx)
    assert.deepEqual(await seams.pageFetch('https://a.example'), { pageContent: '# https://a.example' })

    const bare = createHubSeams({})
    await assert.rejects(() => bare.pageFetch('https://a.example'), /omnimux_page_fetch unavailable/)
    await assert.rejects(
      () => bare.headlessSkill.run({ skillName: 'products-brand-strategy', input: 'p' }),
      (error) => error.code === 'headless-skill-unavailable' && /headlessSkill unavailable/.test(error.message),
    )
    assert.equal(bare.headlessSkill.cancel('j1'), false)
    assert.equal(bare.headlessSkill.getJob('j1'), undefined)
    assert.deepEqual(bare.headlessSkill.listJobs(), [])
  })

  it('survives a ctx whose get() throws and reports headless-skill-unavailable', async () => {
    const ctx = {
      get: () => { throw new Error('no such seat') },
    }
    const seams = createHubSeams(ctx)
    await assert.rejects(
      () => seams.headlessSkill.run({ skillName: 'products-brand-strategy', input: 'p' }),
      (error) => error.code === 'headless-skill-unavailable',
    )
  })
})

describe('products responses · secret guard', () => {
  function fakeRes() {
    const out = { status: 0, body: '' }
    return {
      out,
      writeHead: (status) => { out.status = status },
      end: (text) => { out.body = text },
    }
  }

  it('emits ordinary page copy that merely contains "sk-"', () => {
    const res = fakeRes()
    sendJson(res, 200, { data: { selling_points: 'risk-free, task-focused, desk-lamp' } })
    assert.equal(res.out.status, 200)
    assert.match(res.out.body, /risk-free/)
  })

  it('still refuses a real-looking key and an access token', () => {
    for (const body of [
      { data: { note: 'sk-proj-abcdefghijklmnopqrstuvwxyz012345' } },
      { data: { note: 'access_token=abc' } },
    ]) {
      const res = fakeRes()
      sendJson(res, 200, body)
      assert.equal(res.out.status, 500)
      assert.match(res.out.body, /refused to emit a secret/)
    }
  })

  it('emits TikTok Shop URL slugs and copy containing "...sk-<words>" without false-positive HTTP 500', () => {
    for (const payload of [
      {
        data: {
          name: 'Face Mask Serum Set',
          link: 'https://shop.tiktok.com/us/pdp/face-mask-hyaluronic-acid-serum/1731547070032089440',
        },
      },
      {
        data: {
          name: 'SK-II Facial Treatment Essence',
          link: 'https://shop.tiktok.com/us/pdp/sk-ii-facial-treatment-essence/1731547070032089441',
        },
      },
    ]) {
      const res = fakeRes()
      sendJson(res, 200, payload)
      assert.equal(res.out.status, 200)
    }
  })

  it('still refuses bare, hyphenated prefixed, and Bearer credentials without leaking literals', () => {
    const filler16 = '0'.repeat(16)
    const fillerHalf = '0'.repeat(8)
    for (const body of [
      { data: { note: ['sk', filler16].join('-') } },
      { data: { note: ['sk', 'proj', `${fillerHalf}-${filler16}`].join('-') } },
      { data: { note: ['sk', 'ant', 'api03', `${fillerHalf}-${filler16}`].join('-') } },
      { data: { note: ['sk', 'or', 'v1', `${fillerHalf}-${filler16}`].join('-') } },
      { data: { note: ['Authorization: Bearer', `jwt_${filler16}`].join(' ') } },
    ]) {
      const res = fakeRes()
      sendJson(res, 200, body)
      assert.equal(res.out.status, 500, JSON.stringify(body))
      assert.match(res.out.body, /refused to emit a secret/)
    }
  })
})

describe('products routes · draft media read-only preview', () => {
  const makeMediaDir = () => {
    const mediaDir = join(root, 'store', 'media')
    mkdirSync(mediaDir, { recursive: true })
    const shot = join(mediaDir, 'site-aurora-desktop-20260914T000000Z-abcd.png')
    writeFileSync(shot, 'png')
    return { mediaDir, shot }
  }

  it('imports register their media so the unsaved draft can show a screenshot', async () => {
    const { mediaDir, shot } = makeMediaDir()
    const imported = {
      name: 'Aurora',
      kind: 'digital',
      media: [{ id: 'med_draft_1', real_path: shot, original_name: 'site-aurora-desktop.png' }],
      cover_media_id: 'med_draft_1',
    }
    const { dispatcher } = makeDispatcher({
      paths: { libraryFile: join(root, 'store', 'library.json'), mediaDir },
      importFromUrl: async () => imported,
    })
    const posted = await dispatcher.dispatch(post('/omnimux/products/import-from-link', { url: 'https://a.example.com' }))
    assert.equal(posted.status, 200)
    assert.equal(posted.body.data.media[0].id, 'med_draft_1')

    const stream = await dispatcher.dispatch({ method: 'GET', url: '/omnimux/products/draft-media/med_draft_1' })
    assert.equal(stream.status, 200)
    assert.equal(stream.stream.absolutePath, shot)
    assert.equal(stream.stream.mime, 'image/png')
  })

  it('answers 404 for an id nobody registered, and never streams on a bad path', async () => {
    const { mediaDir } = makeMediaDir()
    const { dispatcher } = makeDispatcher({
      paths: { libraryFile: join(root, 'store', 'library.json'), mediaDir },
    })
    const missing = await dispatcher.dispatch({ method: 'GET', url: '/omnimux/products/draft-media/med_nope' })
    assert.equal(missing.status, 404)
    assert.equal(missing.body.error, 'draft-media-not-found')

    // 越界路径：登记表只接受目录内的文件，注册了也不放行。
    const outside = join(root, 'outside.png')
    writeFileSync(outside, 'png')
    const registry = createDraftMediaRegistry({ mediaDir })
    registry.register([{ id: 'med_out', real_path: outside }])
    const scoped = makeDispatcher({
      paths: { libraryFile: join(root, 'store', 'library.json'), mediaDir },
      draftMedia: registry,
    })
    const blocked = await scoped.dispatcher.dispatch({ method: 'GET', url: '/omnimux/products/draft-media/med_out' })
    assert.equal(blocked.status, 404)
    assert.equal(blocked.body.error, 'draft-media-not-found')
  })

  it('a product preview route still requires the record to exist', async () => {
    const { mediaDir, shot } = makeMediaDir()
    const { dispatcher } = makeDispatcher({
      paths: { libraryFile: join(root, 'store', 'library.json'), mediaDir },
    })
    const product = (await dispatcher.dispatch(post('/omnimux/products', {
      name: 'Aurora',
      media: [{ real_path: shot, original_name: 'site-aurora-desktop.png' }],
    }))).body.product
    const preview = await dispatcher.dispatch({
      method: 'GET',
      url: `/omnimux/products/${product.id}?preview=${product.media[0].id}`,
    })
    assert.equal(preview.status, 200)
    assert.ok(preview.stream)

    const restMedia = await dispatcher.dispatch({
      method: 'GET',
      url: `/omnimux/products/${product.id}/media/${product.media[0].id}`,
    })
    assert.equal(restMedia.status, 200)
    assert.ok(restMedia.stream)
  })
})
