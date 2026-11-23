import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { createDataSourceAdapter } from './datasource.js'
import { createSelectionStore } from './store.js'
import { createThreeGateEngine, evaluateG1, evaluateG2, normalizeGateCriteria } from './three-gate.js'

function makeEnv(services = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'omnimux-ttsel-gate-'))
  const store = createSelectionStore({ rootDir: dir })
  const getService = (name) => services[name] || null
  const dataSource = createDataSourceAdapter({ store, getService })
  const engine = createThreeGateEngine({ store, dataSource, getService })
  return {
    dir,
    store,
    dataSource,
    engine,
    cleanup: () => {
      engine.dispose()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

describe('G1 & G2 pure evaluators', () => {
  it('flags every G1 quantitative failure reason code accurately', () => {
    const criteria = normalizeGateCriteria({
      totalSalesMax: 50000,
      sales7dMin: 50,
      creatorsMax: 1000,
      commissionMin: 10,
      accelMin: 1.1,
      accelBase28dMin: 28,
      ratingMin: 4.0,
      listedDaysMax: 180,
      missingMetricPolicy: 'fail_on_missing',
    })

    const base = {
      totalSales: 4000,
      sales7d: 300,
      sales28d: 600,
      creatorsCount: 40,
      commissionRate: 15,
      rating: 4.6,
      listedDays: 45,
    }

    assert.equal(evaluateG1(base, criteria).reasonCode, 'G1_PASS')
    assert.equal(evaluateG1({ ...base, totalSales: 90000 }, criteria).reasonCode, 'G1_TOTAL_SALES_HIGH')
    assert.equal(evaluateG1({ ...base, sales7d: 12 }, criteria).reasonCode, 'G1_SALES_7D_LOW')
    assert.equal(evaluateG1({ ...base, creatorsCount: 1500 }, criteria).reasonCode, 'G1_CREATORS_HIGH')
    assert.equal(evaluateG1({ ...base, commissionRate: 5 }, criteria).reasonCode, 'G1_COMMISSION_LOW')
    assert.equal(evaluateG1({ ...base, sales28d: 10 }, criteria).reasonCode, 'G1_ACCEL_BASE_LOW')
    assert.equal(evaluateG1({ ...base, sales7d: 100, sales28d: 1000 }, criteria).reasonCode, 'G1_ACCEL_LOW')
    assert.equal(evaluateG1({ ...base, rating: 3.4 }, criteria).reasonCode, 'G1_RATING_LOW')
    assert.equal(evaluateG1({ ...base, listedDays: 240 }, criteria).reasonCode, 'G1_AGE_OVER_WINDOW')
  })

  it('respects missingMetricPolicy for G2 channel ratio checks', () => {
    const failCrit = normalizeGateCriteria({ g2MinCardRatio: 20, missingMetricPolicy: 'fail_on_missing' })
    const skipCrit = normalizeGateCriteria({ g2MinCardRatio: 20, missingMetricPolicy: 'skip_missing_metric' })

    const missing = { ok: false, error: 'missing-channel-provider', message: 'no provider' }
    assert.equal(evaluateG2(missing, failCrit).conclusion, 'fail')
    assert.equal(evaluateG2(missing, skipCrit).conclusion, 'pass')

    const lowCard = { ok: true, metrics: { productCardRatio: 11.5, videoRatio: 88.5 } }
    const g2Fail = evaluateG2(lowCard, failCrit)
    assert.equal(g2Fail.conclusion, 'fail')
    assert.equal(g2Fail.reasonCode, 'G2_CARD_RATIO_LOW')

    const goodCard = { ok: true, metrics: { productCardRatio: 52.6, videoRatio: 47.4 } }
    const g2Pass = evaluateG2(goodCard, failCrit)
    assert.equal(g2Pass.conclusion, 'pass')
    assert.equal(g2Pass.reasonCode, 'G2_PASS')
  })
})

describe('Three-Gate end-to-end funnel execution, Dry-Run, AI fail-closed & overrides', () => {
  const sampleProducts = [
    {
      // Passes G1, G2, G3 -> auto-ingested
      productId: 'win_001',
      title: 'Herbal Lymphatic Drainage Blend 30 Stick Packs',
      category: 'Health',
      price: 20.5,
      totalSales: 21000,
      sales7d: 1742,
      sales28d: 3500,
      gmv7d: 35711,
      commissionRate: 15,
      creatorsCount: 114,
      rating: 4.8,
      listedDays: 40,
      productCardRatio: 52.6,
      videoRatio: 47.4,
    },
    {
      // Fails G1 rating low
      productId: 'g1_fail_002',
      title: 'Budget Phone Mount Stand',
      category: 'Phones & Electronics',
      price: 8.9,
      totalSales: 3200,
      sales7d: 200,
      sales28d: 400,
      commissionRate: 15,
      creatorsCount: 25,
      rating: 3.6,
      listedDays: 30,
      productCardRatio: 40,
    },
    {
      // Passes G1, fails G2 product card ratio low
      productId: 'g2_fail_003',
      title: 'Silk Pillowcase Cooling Cover',
      category: 'Home Supplies',
      price: 16.0,
      totalSales: 4000,
      sales7d: 450,
      sales28d: 900,
      commissionRate: 18,
      creatorsCount: 60,
      rating: 4.7,
      listedDays: 50,
      productCardRatio: 9.5,
      videoRatio: 90.5,
    },
    {
      // Passes G1 & G2, blocked at G3 by excluded category (电池) even if AI says pass
      productId: 'g3_bat_004',
      title: 'Holiday LED Flashing Wall Stickers Battery Powered',
      category: 'Home Supplies',
      price: 11.9,
      totalSales: 2500,
      sales7d: 350,
      sales28d: 700,
      commissionRate: 16,
      creatorsCount: 32,
      rating: 4.6,
      listedDays: 22,
      productCardRatio: 38.0,
      videoRatio: 62.0,
    },
    {
      // Passes G1 & G2, blocked at G3 by local brand risk word
      productId: 'g3_brand_005',
      title: 'Spider-Man Kids Toy Action Figure',
      category: 'Toys',
      price: 14.5,
      totalSales: 1800,
      sales7d: 320,
      sales28d: 640,
      commissionRate: 14,
      creatorsCount: 20,
      rating: 4.8,
      listedDays: 18,
      productCardRatio: 45.0,
      videoRatio: 55.0,
    },
  ]

  it('runs Dry-Run estimate and full G1->G2->G3 funnel with Hub headlessSkill + hubEvents + auto-ingest', async () => {
    const emittedEvents = []
    const aiCalls = []
    const fakeHeadlessSkill = {
      run: async (opts) => {
        aiCalls.push(opts)
        return {
          model: 'mock-vision-auditor',
          data: {
            pass: true,
            riskLevel: 'low',
            brandRisk: 'none',
            suspectBrand: '',
            excludedHits: [],
            reason: 'No brand logo or restricted category detected.',
          },
        }
      },
    }
    const { store, dataSource, engine, cleanup } = makeEnv({
      headlessSkill: fakeHeadlessSkill,
      hubEvents: { emit: (ev) => emittedEvents.push(ev) },
    })

    try {
      store.addRiskWord({ type: 'brand', term: 'Spider-Man', enabled: true })
      const snap = dataSource.importSnapshot({
        format: 'json',
        name: 'Three-Gate Fixture',
        region: 'US',
        content: JSON.stringify(sampleProducts),
      })

      const dryRun = await engine.dryRunEstimate({
        source: 'snapshot',
        region: 'US',
        snapshotId: snap.snapshot.id,
        maxPages: 1,
        maxIngest: 50,
      })
      assert.equal(dryRun.page1Count, 5)
      assert.equal(dryRun.maxProcessCount, 5)
      assert.equal(dryRun.stages.length, 3)

      const task = await engine.createAndRunTask(
        {
          source: 'snapshot',
          region: 'US',
          snapshotId: snap.snapshot.id,
          maxPages: 1,
          maxIngest: 50,
          useAiAudit: true,
        },
        { awaitCompletion: true }
      )

      assert.equal(task.status, 'completed')
      assert.equal(task.metrics.g1.input, 5)
      assert.equal(task.metrics.g1.pass, 4)
      assert.equal(task.metrics.g1.fail, 1)

      assert.equal(task.metrics.g2.input, 4)
      assert.equal(task.metrics.g2.pass, 3)
      assert.equal(task.metrics.g2.fail, 1)

      assert.equal(task.metrics.g3.input, 3)
      assert.equal(task.metrics.g3.pass, 1)
      assert.equal(task.metrics.g3.fail, 2)
      assert.equal(task.metrics.ingestedCount, 1)

      // Only win_001 entered library
      const lib = store.listLibrary({})
      assert.equal(lib.length, 1)
      assert.equal(lib[0].productId, 'win_001')
      assert.equal(lib[0].sourceTaskId, task.id)

      // Excluded category hard override blocked g3_bat_004 even though AI returned pass: true
      const batItem = task.gateItems.g3.find((i) => i.productId === 'g3_bat_004')
      assert.equal(batItem.conclusion, 'fail')
      assert.ok(batItem.metrics.excludedHits.includes('电池'))

      // Brand word blocked g3_brand_005 locally before AI call
      const brandItem = task.gateItems.g3.find((i) => i.productId === 'g3_brand_005')
      assert.equal(brandItem.conclusion, 'fail')
      assert.equal(brandItem.reasonCode, 'G3_RISK_WORD_HIT')

      assert.ok(emittedEvents.length >= 2)
      assert.ok(aiCalls.length >= 1)
      assert.equal(aiCalls[0].skillName, 'tiktok-selection-risk-audit')
    } finally {
      cleanup()
    }
  })

  it('fails closed as incomplete when Hub headlessSkill throws, then recovers via retryIncomplete', async () => {
    let shouldFailAi = true
    const dynamicHeadless = {
      run: async () => {
        if (shouldFailAi) throw new Error('upstream 503')
        return {
          model: 'mock-auditor',
          data: {
            pass: true,
            riskLevel: 'low',
            brandRisk: 'none',
            suspectBrand: '',
            excludedHits: [],
            reason: 'Passed on retry',
          },
        }
      },
    }
    const { store, dataSource, engine, cleanup } = makeEnv({ headlessSkill: dynamicHeadless })
    try {
      const snap = dataSource.importSnapshot({
        format: 'json',
        name: 'Single Winner',
        region: 'US',
        content: JSON.stringify([sampleProducts[0]]),
      })
      const task = await engine.createAndRunTask(
        { source: 'snapshot', region: 'US', snapshotId: snap.snapshot.id, useAiAudit: true },
        { awaitCompletion: true }
      )
      assert.equal(task.metrics.g3.incomplete, 1)
      assert.equal(task.metrics.g3.pass, 0)
      assert.equal(store.listLibrary({}).length, 0) // Fail-closed: never auto-ingested!

      // Now AI recovers and retryIncomplete re-runs only incomplete items
      shouldFailAi = false
      const retried = await engine.retryIncomplete(task.id)
      assert.equal(retried.metrics.g3.incomplete, 0)
      assert.equal(retried.metrics.g3.pass, 1)
      assert.equal(store.listLibrary({}).length, 1)
    } finally {
      cleanup()
    }
  })

  it('supports manual row override (force_pass, ignore, delete) and cloneAndRun', async () => {
    const { store, dataSource, engine, cleanup } = makeEnv({})
    try {
      const snap = dataSource.importSnapshot({
        format: 'json',
        name: 'Override Test',
        region: 'US',
        content: JSON.stringify([sampleProducts[1], sampleProducts[2]]),
      })
      const task = await engine.createAndRunTask(
        { source: 'snapshot', region: 'US', snapshotId: snap.snapshot.id, useAiAudit: false },
        { awaitCompletion: true }
      )
      assert.equal(store.listLibrary({}).length, 0)

      const firstItem = task.gateItems.g1[0]
      const forced = store.overrideGateItem(task.id, firstItem.id, 'force_pass')
      assert.equal(forced.action, 'force_pass')
      assert.equal(forced.item.conclusion, 'pass')
      assert.equal(forced.item.reasonCode, 'MANUAL_APPROVED')

      const secondItem = task.gateItems.g1[1]
      const ignored = store.overrideGateItem(task.id, secondItem.id, 'ignore')
      assert.equal(ignored.action, 'ignore')
      assert.equal(ignored.item.reasonCode, 'MANUAL_IGNORED')

      const deleted = store.overrideGateItem(task.id, secondItem.id, 'delete')
      assert.equal(deleted.action, 'delete')
      assert.equal(store.getTask(task.id).gateItems.g1.length, 1)

      const cloned = await engine.cloneAndRun(task.id, { awaitCompletion: true })
      assert.notEqual(cloned.id, task.id)
      assert.equal(cloned.metrics.g1.input, 2)
    } finally {
      cleanup()
    }
  })
})
