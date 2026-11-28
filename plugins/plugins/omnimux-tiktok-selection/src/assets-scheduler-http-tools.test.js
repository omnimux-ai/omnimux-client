import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createAssetsPipeline, normalizeProductSyncName, PRODUCT_NAME_MAX } from './assets-pipeline.js'
import { createDataSourceAdapter } from './datasource.js'
import { createSelectionDispatcher } from './dispatcher.js'
import { assertLocalWrite, createHttpHandler, ROUTE_PREFIX } from './http-routes.js'
import { apply, TIKTOK_SELECTION_TOOL_NAMES } from './index.js'
import { createSelectionScheduler } from './scheduler.js'
import { createSelectionStore } from './store.js'
import { resolveSelectionPaths, resolveWithin, safePathSegment } from './paths.js'
import { createThreeGateEngine } from './three-gate.js'

function createToolRegistryHarness(externalTools = {}, opts = {}) {
  const registered = new Map(Object.entries(externalTools))
  const batchCalls = []
  const legacyCalls = []
  const directExecuteCalls = []
  const wrapped = new Map()
  for (const [name, def] of registered.entries()) {
    if (!def) continue
    wrapped.set(name, {
      ...def,
      execute: async (args, exec) => {
        directExecuteCalls.push({ name, args })
        return def.execute(args, exec)
      },
    })
  }
  const registry = {
    register: (def) => {
      registered.set(def.name, def)
      wrapped.set(def.name, {
        ...def,
        execute: async (args, exec) => {
          directExecuteCalls.push({ name: def.name, args })
          return def.execute(args, exec)
        },
      })
    },
    get: (name) => wrapped.get(name),
    executable: (name) => wrapped.get(name),
    ...(opts.legacySingle
      ? {
          executionMode: () => 'single',
          execute: async (input) => {
            legacyCalls.push(input)
            const def = registered.get(input.name)
            if (!def) {
              return { isError: true, content: [{ type: 'text', text: `UNKNOWN_TOOL: ${input.name}` }], error: { message: `UNKNOWN_TOOL: ${input.name}` } }
            }
            const value = await def.execute(input.arguments || {}, { signal: input.signal })
            return { isError: false, content: [{ type: 'text', text: JSON.stringify(value) }], value }
          },
        }
      : {
          execute: async (batchInput) => {
            batchCalls.push(batchInput)
            const results = []
            for (const call of batchInput.calls || []) {
              const def = registered.get(call.name)
              if (!def) {
                results.push({
                  callId: call.id,
                  result: {
                    isError: true,
                    content: [{ type: 'text', text: `UNKNOWN_TOOL: ${call.name}` }],
                    error: { message: `UNKNOWN_TOOL: ${call.name}`, info: { code: 'UNKNOWN_TOOL' } },
                  },
                })
                continue
              }
              try {
                const parsedArgs = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : (call.arguments || {})
                const value = await def.execute(parsedArgs, { signal: batchInput.signal })
                results.push({
                  callId: call.id,
                  result: {
                    isError: false,
                    content: [{ type: 'text', text: JSON.stringify(value) }],
                    value,
                  },
                })
              } catch (err) {
                results.push({
                  callId: call.id,
                  result: {
                    isError: true,
                    content: [{ type: 'text', text: err?.message || 'tool error' }],
                    error: { message: err?.message || 'tool error', info: { code: err?.code || 'ERR' } },
                  },
                })
              }
            }
            return { results }
          },
        }),
    _batchCalls: batchCalls,
    _legacyCalls: legacyCalls,
    _directExecuteCalls: directExecuteCalls,
  }
  return registry
}

function makeStack(services = {}, externalTools = {}, registryOpts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'omnimux-ttsel-full-'))
  const store = createSelectionStore({ rootDir: dir })
  const getService = (name) => services[name] || null
  const toolRegistry = createToolRegistryHarness(externalTools, registryOpts)
  const dataSource = createDataSourceAdapter({ store, getService })
  const threeGate = createThreeGateEngine({ store, dataSource, getService })
  const assetsPipeline = createAssetsPipeline({ store, dataSource, getService, resolveTools: () => toolRegistry })
  const scheduler = createSelectionScheduler({ store, dataSource, threeGate, assetsPipeline })
  const dispatcher = createSelectionDispatcher({ store, dataSource, threeGate, assetsPipeline, scheduler })
  const http = createHttpHandler(dispatcher)
  return {
    dir,
    store,
    toolRegistry,
    dataSource,
    threeGate,
    assetsPipeline,
    scheduler,
    dispatcher,
    http,
    cleanup: () => {
      scheduler.dispose()
      threeGate.dispose()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

describe('AssetsPipeline (script rewrite, image/video batch caps, omnimux-products sync)', () => {
  it('rewrites video script via headlessSkill, generates images & videos via Hub seams, and syncs to omnimux-products', async () => {
    const syncedPayloads = []
    let capturedVideoPrompt = ''
    const services = {
      modelCatalog: {
        list: () => ({ defaults: { image: 'test/image-pro', video: 'test/video-i2v' } }),
      },
      headlessSkill: {
        run: async ({ skillName }) => {
          assert.equal(skillName, 'tiktok-selection-video-script')
          return {
            model: 'mock-script-writer',
            data: {
              hook: 'Stop wasting money on heavy serums!',
              sellingPoints: ['Fast absorption', 'Clean formula'],
              shotBeats: [{ second: '0-3s', visual: 'Close-up drop on wrist', voiceover: 'Zero stickiness' }],
              videoPromptEn: '9:16 handheld daylight beauty product demo with clean framing.',
              imagePromptEn: '3:4 clean studio product shot with natural daylight shadows.',
            },
          }
        },
      },
      imageGenerate: {
        execute: async ({ model, aspectRatio }) => {
          assert.equal(model, 'test/image-pro')
          assert.equal(aspectRatio, '3:4')
          return { url: 'https://cdn.example.invalid/img1.png', localPath: '/tmp/img1.png' }
        },
      },
      videoGenerate: {
        execute: async ({ model, aspectRatio, prompt }) => {
          assert.equal(model, 'test/video-i2v')
          assert.equal(aspectRatio, '9:16')
          capturedVideoPrompt = prompt
          return { url: 'https://cdn.example.invalid/vid1.mp4', localPath: '/tmp/vid1.mp4' }
        },
      },
    }
    const externalTools = {
      products_create: {
        execute: async (payload) => {
          syncedPayloads.push(payload)
          return { id: 'prod_synced_1', name: payload.name }
        },
      },
    }

    const { store, toolRegistry, assetsPipeline, cleanup } = makeStack(services, externalTools)
    try {
      const { added } = store.ingestProducts([
        {
          productId: 'asset_001',
          region: 'US',
          title: 'Rosemary Hair Growth Spray 200ml',
          category: 'Beauty & Personal Care',
          priceMin: 10.5,
          sales7d: 7965,
          gmv7d: 71685,
          commissionRate: 18,
          creatorsCount: 92,
        },
      ])
      const id = added[0].id

      const scriptRes = await assetsPipeline.generateVideoScript({ productIds: [id], extraSellingPoints: 'Organic rosemary' })
      assert.equal(scriptRes.succeeded, 1)
      assert.equal(store.getLibraryItem(id).videoScript.hook, 'Stop wasting money on heavy serums!')

      const imgRes = await assetsPipeline.generateImages({ productIds: [id], countPerProduct: 2 })
      assert.equal(imgRes.planned, 2)
      assert.equal(imgRes.results[0].created, 2)
      assert.equal(store.getLibraryItem(id).generatedImages.length, 2)

      const vidRes = await assetsPipeline.generateVideos({ productIds: [id], countPerProduct: 1, useExistingScript: true })
      assert.equal(vidRes.planned, 1)
      assert.equal(vidRes.results[0].created, 1)
      assert.equal(capturedVideoPrompt, '9:16 handheld daylight beauty product demo with clean framing.')
      assert.equal(store.getLibraryItem(id).assetStatus, 'ready')

      const syncRes = await assetsPipeline.syncToOmnimuxProducts({ productIds: [id] })
      assert.equal(syncRes.succeeded, 1)
      assert.equal(syncedPayloads.length, 1)
      assert.equal(toolRegistry._batchCalls.length, 1, 'must dispatch via ctx.tools.execute batch contract')
      assert.equal(toolRegistry._directExecuteCalls.length, 0, 'must not call toolDefinition.execute directly')
      assert.equal(store.getLibraryItem(id).syncedProductId, 'prod_synced_1')
    } finally {
      cleanup()
    }
  })

  it('normalizes >40-char slash titles to satisfy NAME_MAX=40 and dispatches through ctx.tools.execute without direct-execute bypass', async () => {
    const syncedPayloads = []
    const { store, toolRegistry, assetsPipeline, cleanup } = makeStack(
      {},
      {
        products_create: {
          execute: async (payload) => {
            if (!payload.name || payload.name.length > 40 || /[\\/\u0000-\u001f\u007f]/.test(payload.name)) {
              throw Object.assign(new Error('display name must be at most 40 characters and contain no slashes'), { code: 'name-invalid' })
            }
            syncedPayloads.push(payload)
            return { product: { id: 'prd_real_contract_1', name: payload.name } }
          },
        },
      },
    )

    try {
      const longTitle = 'Ultra Soft Travel Makeup Brush Set / 14-Piece Vegan Bristle Kit With Case Pro'
      const { added } = store.ingestProducts([
        {
          productId: 'tt_long_001',
          region: 'US',
          title: longTitle,
          category: 'Beauty & Personal Care -> Makeup Tools',
          priceMin: 18.9,
          sales7d: 420,
          commissionRate: 15,
        },
      ])
      const item = added[0]
      const syncRes = await assetsPipeline.syncToOmnimuxProducts({ productIds: [item.id] })
      assert.equal(syncRes.succeeded, 1, JSON.stringify(syncRes))
      assert.equal(toolRegistry._batchCalls.length, 1)
      assert.equal(toolRegistry._batchCalls[0].calls[0].name, 'products_create')
      assert.equal(toolRegistry._directExecuteCalls.length, 0)

      assert.equal(syncedPayloads.length, 1)
      assert.ok(syncedPayloads[0].name.length <= PRODUCT_NAME_MAX)
      assert.equal(syncedPayloads[0].name.includes('/'), false)
      assert.equal(syncedPayloads[0].name, normalizeProductSyncName(longTitle, item.productId))
      assert.equal(store.getLibraryItem(item.id).syncedProductId, 'prd_real_contract_1')
    } finally {
      cleanup()
    }
  })

  it('supports frozen 0.2.1-rc.3 single-call tools.execute and fails loudly when products_create is absent', async () => {
    const legacy = makeStack(
      {},
      { products_create: { execute: async (payload) => ({ product: { id: 'prd_legacy', name: payload.name } }) } },
      { legacySingle: true },
    )
    try {
      const { added } = legacy.store.ingestProducts([{ productId: 'leg_1', region: 'US', title: 'Legacy Shell Product' }])
      const res = await legacy.assetsPipeline.syncToOmnimuxProducts({ productIds: [added[0].id] })
      assert.equal(res.succeeded, 1)
      assert.equal(legacy.toolRegistry._legacyCalls.length, 1)
      assert.equal(legacy.toolRegistry._directExecuteCalls.length, 0)
    } finally {
      legacy.cleanup()
    }

    const missing = makeStack({}, {})
    try {
      const { added } = missing.store.ingestProducts([{ productId: 'miss_1', region: 'US', title: 'Missing Tool Product' }])
      await assert.rejects(
        () => missing.assetsPipeline.syncToOmnimuxProducts({ productIds: [added[0].id] }),
        (err) => err.code === 'needs-provider',
      )
    } finally {
      missing.cleanup()
    }
  })

  it('enforces 60-image and 20-video batch hard caps', async () => {
    const { store, assetsPipeline, cleanup } = makeStack({
      imageGenerate: { execute: async () => ({ url: 'https://cdn.example.invalid/x.png' }) },
      videoGenerate: { execute: async () => ({ url: 'https://cdn.example.invalid/x.mp4' }) },
    })
    try {
      const batch = Array.from({ length: 7 }, (_, i) => ({
        productId: `cap_${i}`,
        region: 'US',
        title: `Batch Product ${i}`,
      }))
      const { added } = store.ingestProducts(batch)
      const ids = added.map((x) => x.id)

      // 7 * 10 = 70 > 60
      await assert.rejects(
        () => assetsPipeline.generateImages({ productIds: ids, countPerProduct: 10 }),
        (err) => err.code === 'batch-limit-exceeded'
      )

      // 7 * 5 = 35 > 20
      await assert.rejects(
        () => assetsPipeline.generateVideos({ productIds: ids, countPerProduct: 5 }),
        (err) => err.code === 'batch-limit-exceeded'
      )
    } finally {
      cleanup()
    }
  })
})

describe('Scheduler, HTTP routes, local-write guard & 18 Cordis Agent tools', () => {
  it('executes scheduled auto-selection manually and records 12-field run history', async () => {
    const { store, dataSource, scheduler, cleanup } = makeStack({})
    try {
      const snap = dataSource.importSnapshot({
        format: 'json',
        name: 'Schedule Feed',
        region: 'US',
        content: JSON.stringify([
          { productId: 'sch_1', title: 'Organic Matcha Whisk Set', sales7d: 500, commissionRate: 15 },
          { productId: 'sch_2', title: 'Bamboo Tea Organizer', sales7d: 300, commissionRate: 14 },
        ]),
      })
      const sched = store.createSchedule({
        name: 'Daily US Matcha Pull',
        source: 'snapshot',
        snapshotId: snap.snapshot.id,
        region: 'US',
        useThreeGate: false,
      })

      const run = await scheduler.runScheduleNow(sched.id, 'manual')
      assert.equal(run.status, 'completed')
      assert.equal(run.pulledCount, 2)
      assert.equal(run.addedCount, 2)
      assert.equal(run.trigger, 'manual')

      const run2 = await scheduler.runScheduleNow(sched.id, 'manual')
      assert.equal(run2.addedCount, 0)
      assert.equal(run2.duplicatedCount, 2)
      assert.equal(store.listRuns({ scheduleId: sched.id }).length, 2)
    } finally {
      cleanup()
    }
  })

  it('rejects cross-origin writes and enforces confirm:true on destructive HTTP & Dispatcher calls', async () => {
    assert.throws(
      () => assertLocalWrite({ origin: 'https://evil.example.com' }),
      (err) => err.code === 'not-local'
    )
    assert.throws(
      () => assertLocalWrite({ secFetchSite: 'cross-site' }),
      (err) => err.code === 'not-local'
    )

    const { store, http, cleanup } = makeStack({})
    try {
      const { added } = store.ingestProducts([{ productId: 'rm_1', region: 'US', title: 'Removable Item' }])
      const denied = await http.dispatch({
        method: 'POST',
        url: `${ROUTE_PREFIX}/library/remove`,
        body: { ids: [added[0].id], confirm: false },
      })
      assert.equal(denied.status, 400)
      assert.equal(denied.body.error, 'confirmation-required')

      const allowed = await http.dispatch({
        method: 'POST',
        url: `${ROUTE_PREFIX}/library/remove`,
        body: { ids: [added[0].id], confirm: true },
      })
      assert.equal(allowed.status, 200)
      assert.equal(allowed.body.removedCount, 1)

      const overview = await http.dispatch({ method: 'GET', url: `${ROUTE_PREFIX}/overview` })
      assert.equal(overview.status, 200)
      assert.equal(overview.body.stats.libraryTotal, 0)
    } finally {
      cleanup()
    }
  })

  it('registers all 18 tiktok_selection_* Agent tools and prompt section via apply(ctx)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omnimux-ttsel-apply-'))
    const registeredTools = new Map()
    const promptSections = []
    const disposers = []

    const ctx = {
      tools: {
        register: (tool) => {
          registeredTools.set(tool.name, tool)
          return () => registeredTools.delete(tool.name)
        },
        get: (name) => registeredTools.get(name),
      },
      systemPrompt: {
        section: (sec) => {
          promptSections.push(sec)
          return () => {}
        },
      },
      get: () => null,
      effect: (fn) => {
        const d = fn()
        if (typeof d === 'function') disposers.push(d)
      },
      inject: () => {},
    }

    try {
      apply(ctx, { rootDir: dir, enableScheduler: false })
      assert.equal(registeredTools.size, 18)
      for (const expectedName of TIKTOK_SELECTION_TOOL_NAMES) {
        const tool = registeredTools.get(expectedName)
        assert.ok(tool, `Missing tool: ${expectedName}`)
        assert.equal(typeof tool.execute, 'function')
        assert.equal(typeof tool.output?.render, 'function')
        assert.equal(tool.parameters?.type, 'object')
      }
      assert.equal(promptSections.length, 1)
      assert.equal(promptSections[0].name, 'tiktok-selection:ops')

      // Confirm guard works via Agent tool surface too
      const rmTool = registeredTools.get('tiktok_selection_remove_products')
      const denied = await rmTool.execute({ ids: ['missing'], confirm: false })
      assert.equal(denied.ok, false)
      assert.equal(denied.error, 'confirmation-required')
    } finally {
      for (const d of disposers) d()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('Asset path sanitization (untrusted productId must not escape assetsDir)', () => {
  it('safePathSegment collapses traversal and separators into one safe segment', () => {
    assert.equal(safePathSegment('../../etc/passwd'), 'etc_passwd')
    assert.equal(safePathSegment('a/b\\c'), 'a_b_c')
    assert.equal(safePathSegment('..'), 'unknown')
    assert.equal(safePathSegment(''), 'unknown')
    assert.equal(safePathSegment(null, 'fb'), 'fb')
    for (const evil of ['../x', 'a/../../b', '/abs/path', 'x/../../..']) {
      const seg = safePathSegment(evil)
      assert.ok(!seg.includes('/') && !seg.includes('\\') && !seg.includes('..'), `unsafe segment: ${seg}`)
    }
  })

  it('resolveWithin rejects any path that escapes the base directory', () => {
    const base = '/tmp/assets-root'
    assert.equal(resolveWithin(base, 'ok-product'), '/tmp/assets-root/ok-product')
    assert.throws(() => resolveWithin(base, '../escape'), (err) => err.code === 'invalid-request')
    assert.throws(() => resolveWithin(base, '..'), (err) => err.code === 'invalid-request')
  })

  it('generates media only inside assetsDir even for a malicious snapshot productId', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omnimux-ttsel-traversal-'))
    const store = createSelectionStore({ rootDir: dir })
    const assetsDir = store.paths.assetsDir
    const pipeline = createAssetsPipeline({
      store,
      dataSource: createDataSourceAdapter({ store, getService: () => null }),
      getService: (name) =>
        ({
          imageGenerate: { execute: async ({ dest }) => ({ localPath: dest }) },
          modelCatalog: { list: () => ({ defaults: { image: 'stub/image' } }) },
        })[name] || null,
      getTool: () => null,
    })
    try {
      const { added } = store.ingestProducts([
        { productId: '../../../PWNED_DIR/evil', region: 'US', title: 'Traversal Probe Product' },
      ])
      assert.equal(added.length, 1)
      const res = await pipeline.generateImages({ productIds: [added[0].id], countPerProduct: 1 })
      assert.equal(res.results[0].created, 1)
      const slotPath = res.results[0].slots[0].path
      assert.ok(slotPath.startsWith(assetsDir + '/'), `generated path escaped assetsDir: ${slotPath}`)
      assert.ok(!slotPath.includes('..'), `traversal segment leaked into path: ${slotPath}`)
      const rel = slotPath.slice(assetsDir.length + 1)
      assert.equal(rel.split('/').length, 2, `expected <safeSegment>/<file>, got: ${rel}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
