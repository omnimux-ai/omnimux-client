import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createAssetsPipeline } from './assets-pipeline.js'
import { createDataSourceAdapter } from './datasource.js'
import { createSelectionDispatcher } from './dispatcher.js'
import { assertLocalWrite, createHttpHandler, ROUTE_PREFIX } from './http-routes.js'
import { apply, TIKTOK_SELECTION_TOOL_NAMES } from './index.js'
import { createSelectionScheduler } from './scheduler.js'
import { createSelectionStore } from './store.js'
import { createThreeGateEngine } from './three-gate.js'

function makeStack(services = {}, externalTools = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'omnimux-ttsel-full-'))
  const store = createSelectionStore({ rootDir: dir })
  const getService = (name) => services[name] || null
  const getTool = (name) => externalTools[name] || null
  const dataSource = createDataSourceAdapter({ store, getService })
  const threeGate = createThreeGateEngine({ store, dataSource, getService })
  const assetsPipeline = createAssetsPipeline({ store, dataSource, getService, getTool })
  const scheduler = createSelectionScheduler({ store, dataSource, threeGate, assetsPipeline })
  const dispatcher = createSelectionDispatcher({ store, dataSource, threeGate, assetsPipeline, scheduler })
  const http = createHttpHandler(dispatcher)
  return {
    dir,
    store,
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

    const { store, assetsPipeline, cleanup } = makeStack(services, externalTools)
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
      assert.equal(store.getLibraryItem(id).syncedProductId, 'prod_synced_1')
    } finally {
      cleanup()
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
