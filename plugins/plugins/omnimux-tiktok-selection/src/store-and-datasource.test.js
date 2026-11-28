import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { computeAcceleration } from './constants.js'
import { createDataSourceAdapter, parseCsvRows, parseSnapshotPayload } from './datasource.js'
import { createSelectionStore, normalizeProductKey } from './store.js'

function makeTempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'omnimux-ttsel-store-'))
  const store = createSelectionStore({ rootDir: dir })
  return {
    dir,
    store,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

describe('computeAcceleration', () => {
  it('computes 7d vs 28d daily velocity acceleration ratio accurately', () => {
    const res = computeAcceleration(140, 280, 1.1, 28)
    assert.equal(res.avg7d, 20)
    assert.equal(res.avg28d, 10)
    assert.equal(res.ratio, 2)
    assert.equal(res.insufficient, false)
    assert.equal(res.rising, true)
  })

  it('marks insufficient 28d baseline and missing null inputs without coercing null to zero', () => {
    const lowBase = computeAcceleration(30, 12, 1.1, 28)
    assert.equal(lowBase.insufficient, true)
    assert.equal(lowBase.rising, false)
    const missing = computeAcceleration(30, null, 1.1, 28)
    assert.equal(missing.sold28d, null)
    assert.equal(missing.ratio, null)
    assert.equal(missing.rising, null)
    assert.equal(missing.insufficient, true)
  })
})

describe('SelectionStore persistence, dedupe & risk words', () => {
  it('persists library records atomically across reloads and deduplicates by productId + region', () => {
    const { dir, store, cleanup } = makeTempStore()
    try {
      const first = store.ingestProducts(
        [
          {
            productId: '17294000001',
            region: 'US',
            title: 'Herbal Lymphatic Drainage Support 30 Packs',
            category: 'Health',
            priceMin: 20.5,
            sales7d: 17420,
            gmv7d: 357643,
            commissionRate: 15,
            creatorsCount: 114,
            productCardRatio: 52.6,
          },
        ],
        { source: 'rank', sourceDetail: 'US Daily 2026-11-20' }
      )
      assert.equal(first.addedCount, 1)
      assert.equal(first.duplicatedCount, 0)
      assert.equal(first.blockedCount, 0)

      // Duplicate productId in same region is skipped; same ID in GB is accepted
      const second = store.ingestProducts(
        [
          { productId: '17294000001', region: 'US', title: 'Herbal Lymphatic Drainage Support 30 Packs' },
          { productId: '17294000001', region: 'GB', title: 'Herbal Lymphatic Drainage UK Edition' },
        ],
        { source: 'search' }
      )
      assert.equal(second.addedCount, 1)
      assert.equal(second.duplicatedCount, 1)

      // Reload fresh store from disk to verify atomic persistence
      const reloaded = createSelectionStore({ rootDir: dir })
      const items = reloaded.listLibrary({})
      assert.equal(items.length, 2)
      const keys = reloaded.getLibraryKeySet()
      assert.equal(keys.has(normalizeProductKey('17294000001', 'US')), true)
      assert.equal(keys.has(normalizeProductKey('17294000001', 'GB')), true)
      assert.equal(keys.has(normalizeProductKey('99999999999', 'US')), false)
    } finally {
      cleanup()
    }
  })

  it('blocks products matching enabled brand or sensitive risk words and ignores disabled words', () => {
    const { store, cleanup } = makeTempStore()
    try {
      const nike = store.addRiskWord({ type: 'brand', term: 'Nike', zhName: '耐克', enabled: true })
      const fake = store.addRiskWord({ type: 'sensitive', term: 'replica', enabled: true })
      const disabled = store.addRiskWord({ type: 'brand', term: 'Herbal', enabled: false })
      assert.ok(nike.id && fake.id && disabled.id)

      const res = store.ingestProducts(
        [
          { productId: 'p1', region: 'US', title: 'Nike Running Shoes Air Max' },
          { productId: 'p2', region: 'US', title: 'Luxury Watch Replica Grade A' },
          { productId: 'p3', region: 'US', title: 'Herbal Hair Growth Rosemary Oil' },
        ],
        { checkRiskWords: true }
      )
      assert.equal(res.addedCount, 1)
      assert.equal(res.blockedCount, 2)
      assert.equal(res.added[0].productId, 'p3')
      assert.equal(res.blocked[0].hits[0].type, 'brand')
      assert.equal(res.blocked[1].hits[0].type, 'sensitive')

      // Updating status & removing records
      const updated = store.batchUpdateStatus([res.added[0].id], 'approved', 'High product card share')
      assert.equal(updated.updatedCount, 1)
      assert.equal(store.getLibraryItem(res.added[0].id).selectionStatus, 'approved')

      const removed = store.removeLibraryItems([res.added[0].id])
      assert.equal(removed.removedCount, 1)
      assert.equal(store.listLibrary({}).length, 0)
    } finally {
      cleanup()
    }
  })

  it('clamps settings concurrency to 1..8 and supports resetPrompts', () => {
    const { store, cleanup } = makeTempStore()
    try {
      const updated = store.updateSettings({ concurrency: 99, dailyAssetCap: 500, excludedCategories: ['电池', '液体'] })
      assert.equal(updated.concurrency, 8)
      assert.equal(updated.dailyAssetCap, 500)
      assert.deepEqual(updated.excludedCategories, ['电池', '液体'])

      const reset = store.updateSettings({ resetPrompts: true })
      assert.ok(reset.excludedCategories.includes('大IP'))
    } finally {
      cleanup()
    }
  })
})

describe('DataSourceAdapter CSV/JSON snapshot parsing & live socialData', () => {
  it('parses RFC-4180 CSV with quoted commas and ZH/EN FastMoss/Chuhaijiang aliases', () => {
    const csv = [
      '商品ID,商品标题,站点,类目,价格,7天销量,28天销量,7天GMV,佣金率,带货达人数,商品卡占比,视频占比,评分,上架天数',
      '10001,"Rosemary, Mint & Rice Water Hair Spray",US,Beauty & Personal Care,$10.50,1200,2400,$12600,18%,45,32.5%,67.5%,4.7,42',
      '10002,"LED Flashing Holiday Stickers",US,Home Supplies,9.99,300,600,2997,15%,20,25.0%,75.0%,4.4,30',
    ].join('\n')

    const keyedRows = parseCsvRows(csv)
    assert.equal(keyedRows.length, 2)
    assert.equal(keyedRows[0].title, 'Rosemary, Mint & Rice Water Hair Spray')

    const parsed = parseSnapshotPayload({ content: csv, format: 'csv', name: 'Test Export', region: 'US' })
    assert.equal(parsed.format, 'csv')
    assert.equal(parsed.items.length, 2)
    assert.equal(parsed.items[0].productId, '10001')
    assert.equal(parsed.items[0].sales7d, 1200)
    assert.equal(parsed.items[0].sales28d, 2400)
    assert.equal(parsed.items[0].commissionRate, 18)
    assert.equal(parsed.items[0].channelMetrics.productCardRatio, 32.5)
    assert.equal(parsed.items[0].accelRatio, 2)
  })

  it('imports snapshots and supports rank/search queries with inLibrary flags and fail-loud missing channel enrichment', async () => {
    const { store, cleanup } = makeTempStore()
    try {
      const adapter = createDataSourceAdapter({ store, getService: () => null })
      const imported = adapter.importSnapshot({
        format: 'json',
        name: 'US Beauty Batch',
        region: 'US',
        content: JSON.stringify([
          {
            productId: '20001',
            title: 'Peptide Lip Balm Set',
            category: 'Beauty & Personal Care',
            price: 12.9,
            sales7d: 850,
            sales28d: 1700,
            gmv7d: 10965,
            commissionRate: 16,
            creatorsCount: 38,
            rating: 4.8,
            listedDays: 25,
            productCardRatio: 44.2,
          },
          {
            productId: '20002',
            title: 'Travel Cosmetic Organizer Bag',
            category: 'Beauty & Personal Care',
            price: 15.0,
            sales7d: 400,
            sales28d: 1200,
            gmv7d: 6000,
            commissionRate: 12,
            creatorsCount: 15,
            rating: 4.5,
            listedDays: 60,
          },
        ]),
      })
      assert.equal(imported.snapshot.itemCount, 2)

      const rank = await adapter.queryRank({ region: 'US', snapshotId: imported.snapshot.id, sortField: 'sales7d' })
      assert.equal(rank.source, 'snapshot')
      assert.equal(rank.items.length, 2)
      assert.equal(rank.items[0].productId, '20001')
      assert.equal(rank.items[0].inLibrary, false)

      store.ingestProducts([rank.items[0]], { region: 'US', source: 'snapshot' })
      const searched = await adapter.searchProducts({ keyword: 'Peptide', snapshotId: imported.snapshot.id })
      assert.equal(searched.items.length, 1)
      assert.equal(searched.items[0].inLibrary, true)

      // Product with snapshot channel metrics enriches cleanly; product without fails loud with missing-channel-provider
      const hasMetrics = await adapter.enrichChannelMetrics(rank.items[0])
      assert.equal(hasMetrics.ok, true)
      assert.equal(hasMetrics.metrics.productCardRatio, 44.2)

      const noMetrics = await adapter.enrichChannelMetrics(rank.items[1])
      assert.equal(noMetrics.ok, false)
      assert.equal(noMetrics.code, 'channel-source-unavailable')
    } finally {
      cleanup()
    }
  })

  it('delegates live queries to Hub socialData seam without fabricating missing metrics', async () => {
    const { store, cleanup } = makeTempStore()
    try {
      const calls = []
      const fakeSocialData = {
        fetch: async (req) => {
          calls.push(req)
          if (req.capability === 'shop_search_v2') {
            return {
              data: {
                products: [
                  {
                    product_id: 'live_901',
                    title: 'Collagen Overnight Mask',
                    price: 19.99,
                    sold_count: 1500,
                    rating: 4.9,
                    seller_name: 'GlowLab US',
                  },
                ],
                total: 1,
              },
            }
          }
          if (req.capability === 'creator_search_videos') {
            return {
              data: {
                videos: [
                  {
                    id: 'vid_1',
                    desc: 'Glass skin in 1 night!',
                    author: { unique_id: 'glowcreator' },
                    stats: { play_count: 250000, digg_count: 18500 },
                  },
                ],
              },
            }
          }
          return { data: {} }
        },
      }
      const adapter = createDataSourceAdapter({
        store,
        getService: (name) => (name === 'socialData' ? fakeSocialData : null),
      })

      const live = await adapter.searchProducts({ keyword: 'Collagen', region: 'US' })
      assert.equal(live.source, 'omnimux_social_data')
      assert.equal(live.items.length, 1)
      assert.equal(live.items[0].productId, 'live_901')
      // Live shop_search_v2 does not return productCardRatio, so it stays null (never fabricated)
      assert.equal(live.items[0].channelMetrics, null)

      const detail = await adapter.getProductDetail({
        productId: 'live_901',
        region: 'US',
        loadVideos: true,
        productHint: live.items[0],
      })
      assert.equal(detail.referenceVideos.length, 1)
      assert.equal(detail.referenceVideos[0].playCount, 250000)
      assert.ok(calls.some((c) => c.capability === 'shop_search_v2'))
      assert.ok(calls.some((c) => c.capability === 'creator_search_videos'))
    } finally {
      cleanup()
    }
  })

  it('normalizes real TikHub Shop search object prices, V3 product_data, creator video_list, and product_reviews envelopes', async () => {
    const { store, cleanup } = makeTempStore()
    try {
      const fakeSocialData = {
        fetch: async (req) => {
          if (req.capability === 'shop_search_v2') {
            return {
              code: 0,
              data: {
                has_more: true,
                products: [
                  {
                    product_id: '1731128793906516409',
                    title: 'Vitamin C Brightening Facial Serum',
                    price: {
                      sale_price: '19.99',
                      max_price: '24.99',
                      currency: '$',
                    },
                    sales: 1250,
                    rating: 4.7,
                    cover_url: 'https://p16-oec.example/serum.jpg',
                    product_url: 'https://www.tiktok.com/view/product/1731128793906516409',
                  },
                ],
              },
            }
          }
          if (req.capability === 'shop_product') {
            return {
              product_data: {
                page_config: {
                  components_map: [
                    {
                      component_data: {
                        product_info: {
                          product_model: {
                            name: 'Vitamin C Brightening Facial Serum 30ml',
                            product_id: '1731128793906516409',
                            category_name: 'Beauty & Personal Care',
                            images: [{ url_list: ['https://p16-oec.example/v3-serum.webp'] }],
                          },
                          seller_model: {
                            shop_name: 'GlowLab Official US',
                            seller_id: 'seller_881',
                          },
                          promotion_model: {
                            promotion_product_price: {
                              min_price: {
                                sale_price_format: '18.50',
                                currency_symbol: '$',
                              },
                            },
                          },
                          review_model: {
                            product_rating: 4.8,
                            review_count: 340,
                          },
                          sold_count: 1380,
                        },
                      },
                    },
                  ],
                },
              },
            }
          }
          if (req.capability === 'creator_search_videos') {
            return {
              status_code: 0,
              has_more: 1,
              video_list: [
                {
                  aweme_id: '7350810998023949599',
                  desc: 'Glow serum 7 day glass skin demo',
                  create_time: 1711305600,
                  author: { unique_id: 'skincare_creator' },
                  statistics: { play_count: 450000, digg_count: 32000, collect_count: 1900 },
                },
              ],
            }
          }
          if (req.capability === 'shop_reviews_v2') {
            return {
              code: 0,
              data: {
                has_more: true,
                total_reviews: '100',
                product_reviews: [
                  {
                    review_id: '9001',
                    review_rating: 5,
                    review_time: '2026-10-01',
                    review_text: 'Great texture and fast shipping!',
                    reviewer_name: 'J*** D.',
                  },
                ],
              },
            }
          }
          return {}
        },
      }
      const adapter = createDataSourceAdapter({
        store,
        getService: (name) => (name === 'socialData' ? fakeSocialData : null),
      })

      const searchRes = await adapter.searchProducts({ keyword: 'serum', region: 'US' })
      assert.equal(searchRes.items.length, 1)
      assert.equal(searchRes.items[0].productId, '1731128793906516409')
      assert.equal(searchRes.items[0].priceMin, 19.99)
      assert.equal(searchRes.items[0].priceMax, 24.99)
      assert.equal(searchRes.items[0].priceDisplay, '$19.99 - $24.99')
      assert.equal(searchRes.items[0].totalSales, 1250)
      assert.equal(searchRes.items[0].rating, 4.7)
      assert.equal(searchRes.items[0].coverUrl, 'https://p16-oec.example/serum.jpg')

      const detailRes = await adapter.getProductDetail({
        productId: '1731128793906516409',
        region: 'US',
        loadVideos: true,
        loadReviews: true,
        productHint: searchRes.items[0],
      })
      assert.equal(detailRes.product.shopName, 'GlowLab Official US')
      assert.equal(detailRes.product.priceMin, 18.5)
      assert.equal(detailRes.product.rating, 4.8)
      assert.equal(detailRes.product.reviewCount, 340)
      assert.equal(detailRes.product.totalSales, 1380)
      assert.equal(detailRes.referenceVideos.length, 1)
      assert.equal(detailRes.referenceVideos[0].videoId, '7350810998023949599')
      assert.equal(detailRes.referenceVideos[0].playCount, 450000)
      assert.equal(detailRes.referenceVideos[0].likeCount, 32000)
      assert.equal(detailRes.reviews.length, 1)
      assert.equal(detailRes.reviews[0].rating, 5)
      assert.equal(detailRes.reviews[0].text, 'Great texture and fast shipping!')
      assert.equal(detailRes.reviews[0].createdAt, '2026-10-01')
      assert.equal(detailRes.reviews[0].reviewer, 'J*** D.')
    } finally {
      cleanup()
    }
  })

  it('guards malformed TikHub items (object cover, null entries, non-numeric timestamps, missing/NaN review ratings)', async () => {
    const { store, cleanup } = makeTempStore()
    try {
      const fakeSocialData = {
        fetch: async (req) => {
          if (req.capability === 'shop_search_v2') {
            return {
              data: {
                products: [
                  {
                    product_id: '777',
                    title: 'Safe Fallback Product',
                    images: [{ url_list: [] }, 'https://cdn.example/ignored.jpg'],
                    main_image: 'https://cdn.example/main-cover.jpg',
                    price: { unknown_key: true },
                  },
                ],
              },
            }
          }
          if (req.capability === 'creator_search_videos') {
            return {
              data: {
                video_list: [
                  null,
                  {
                    aweme_id: '888',
                    desc: 'Date formatted video',
                    create_time: '2026-10-01',
                    author: { nickname: 'CreatorA' },
                  },
                ],
              },
            }
          }
          if (req.capability === 'shop_reviews_v2') {
            return {
              data: {
                product_reviews: [
                  null,
                  {
                    review_rating: null,
                    review_text: 'No stars provided',
                    author: { nickname: 'Alice' },
                    review_time: '2026-10-02',
                  },
                  {
                    rating: 'N/A',
                    text: 'Non-numeric rating',
                    reviewer_name: 'Bob',
                  },
                ],
              },
            }
          }
          return {}
        },
      }
      const adapter = createDataSourceAdapter({
        store,
        getService: (name) => (name === 'socialData' ? fakeSocialData : null),
      })

      const search = await adapter.searchProducts({ keyword: 'Safe', region: 'US' })
      assert.equal(search.items.length, 1)
      assert.equal(search.items[0].coverUrl, 'https://cdn.example/main-cover.jpg')
      assert.equal(search.items[0].priceMin, null)
      assert.equal(search.items[0].priceDisplay, '—')

      const detail = await adapter.getProductDetail({
        productId: '777',
        region: 'US',
        loadVideos: true,
        loadReviews: true,
        productHint: search.items[0],
      })
      assert.equal(detail.referenceVideos.length, 1)
      assert.equal(detail.referenceVideos[0].publishedAt, '2026-10-01')
      assert.equal(detail.reviews.length, 2)
      assert.equal(detail.reviews[0].rating, null)
      assert.equal(detail.reviews[0].reviewer, 'Alice')
      assert.equal(detail.reviews[1].rating, null)
      assert.equal(detail.reviews[1].text, 'Non-numeric rating')
    } finally {
      cleanup()
    }
  })

  it('formats CHANNEL_UNAVAILABLE into actionable selection messages while preserving needs-omnimux and quota-exceeded', async () => {
    const { store, cleanup } = makeTempStore()
    try {
      let nextError = Object.assign(new Error('该模型当前不可用，请换一个试试'), {
        code: 'CHANNEL_UNAVAILABLE',
        status: 503,
        retryable: true,
      })
      const adapter = createDataSourceAdapter({
        store,
        getService: (name) => (name === 'socialData'
          ? {
              fetch: async () => {
                throw nextError
              },
            }
          : null),
      })

      await assert.rejects(
        () => adapter.queryRank({ region: 'US' }),
        (err) => err.name === 'SelectionError'
          && err.code === 'upstream-failed'
          && err.message === '实时选品数据源暂不可用，请稍后重试或先导入 CSV/JSON 快照'
          && !err.message.includes('该模型当前不可用'),
      )

      await assert.rejects(
        () => adapter.searchProducts({ keyword: 'serum', region: 'US' }),
        (err) => err.name === 'SelectionError'
          && err.code === 'upstream-failed'
          && err.message === '实时选品数据源暂不可用，请稍后重试或先导入 CSV/JSON 快照'
          && !err.message.includes('该模型当前不可用'),
      )

      nextError = Object.assign(new Error('社媒数据通道暂不可用，请稍后重试'), {
        code: 'CHANNEL_UNAVAILABLE',
        status: 503,
        retryable: true,
      })

      const detail = await adapter.getProductDetail({
        productId: 'live_901',
        region: 'US',
        loadVideos: true,
        loadReviews: true,
        productHint: { productId: 'live_901', region: 'US', title: 'Vitamin C Serum' },
      })
      assert.deepEqual(detail.warnings, [
        '实时选品数据源暂不可用，请稍后重试',
        '实时选品数据源暂不可用，请稍后重试',
        '实时选品数据源暂不可用，请稍后重试',
      ])

      nextError = Object.assign(new Error('请先登录 OmniMux。'), {
        code: 'needs-omnimux',
        status: 401,
      })
      await assert.rejects(
        () => adapter.queryRank({ region: 'US' }),
        (err) => err.name === 'SelectionError' && err.code === 'needs-omnimux' && err.message === '请先登录 OmniMux。',
      )
      await assert.rejects(
        () => adapter.searchProducts({ keyword: 'serum', region: 'US' }),
        (err) => err.name === 'SelectionError' && err.code === 'needs-omnimux' && err.message === '请先登录 OmniMux。',
      )

      nextError = Object.assign(new Error('当前操作需要更多额度，充值后即可继续使用 OmniMux。'), {
        code: 'quota-exceeded',
        status: 402,
      })
      await assert.rejects(
        () => adapter.queryRank({ region: 'US' }),
        (err) => err.name === 'SelectionError'
          && err.code === 'upstream-failed'
          && err.message === '当前操作需要更多额度，充值后即可继续使用 OmniMux。',
      )
      const quotaDetail = await adapter.getProductDetail({
        productId: 'live_901',
        region: 'US',
        loadVideos: true,
        loadReviews: true,
        productHint: { productId: 'live_901', region: 'US', title: 'Vitamin C Serum' },
      })
      assert.deepEqual(quotaDetail.warnings, [
        '当前操作需要更多额度，充值后即可继续使用 OmniMux。',
        '当前操作需要更多额度，充值后即可继续使用 OmniMux。',
        '当前操作需要更多额度，充值后即可继续使用 OmniMux。',
      ])
    } finally {
      cleanup()
    }
  })

  it('unpacks component_data.products, maps TikHub fields without HEIC, and avoids trending-best-seller rank miss (#438)', async () => {
    const { store, cleanup } = makeTempStore()
    try {
      const rankQueries = []
      const fakeSocialData = {
        fetch: async (req) => {
          if (req.capability === 'shop_search_v2') {
            rankQueries.push(req.query)
            if (req.query === 'Beauty & Personal Care') {
              return {
                data: {
                  products: [],
                  component_data: { products: [] },
                },
              }
            }
            return {
              data: {
                data: {
                  products: [],
                  component_data: {
                    products: [
                      {
                        product_id: '1732501600694931597',
                        title: 'Portable Blender - USB Charged, Leak-Proof, Easy-to-Clean',
                        image: {
                          url_list: [
                            'https://p16-oec.example/cover~tplv-crop-heic.heic',
                            'https://p16-oec.example/cover~tplv-webp.webp',
                          ],
                          thumb_url_list: ['https://p16-oec.example/thumb.jpg'],
                        },
                        product_price_info: {
                          sale_price_decimal: '19.99',
                          sale_price_format: '$19.99',
                          origin_price_decimal: '39.99',
                          currency_symbol: '$',
                        },
                        rate_info: {
                          score: 4.8,
                          review_count: '1.2K',
                        },
                        sold_info: {
                          sold_count: '2.5K+',
                        },
                        seller_info: {
                          seller_id: 'seller_99',
                          shop_name: 'HydroBlend Direct',
                        },
                        brand_info: {
                          brand_name: 'HydroBlend',
                        },
                        seo_url: 'https://shop.tiktok.com/view/product/1732501600694931597?region=US',
                        sku_info: [{ sku_id: 'sku_1' }, { sku_id: 'sku_2' }],
                      },
                    ],
                  },
                },
              },
            }
          }
          return {}
        },
      }
      const adapter = createDataSourceAdapter({
        store,
        getService: (name) => (name === 'socialData' ? fakeSocialData : null),
      })

      const rankRes = await adapter.queryRank({ region: 'US' })
      assert.equal(rankQueries.includes('trending best seller'), false)
      assert.deepEqual(rankQueries, ['Beauty & Personal Care', 'Home Supplies'])
      assert.equal(rankRes.items.length, 1)
      const item = rankRes.items[0]
      assert.equal(item.productId, '1732501600694931597')
      assert.equal(item.coverUrl, 'https://p16-oec.example/cover~tplv-webp.webp')
      assert.equal(item.priceMin, 19.99)
      assert.equal(item.priceMax, 19.99)
      assert.equal(item.priceDisplay, '$19.99')
      assert.equal(item.totalSales, 2500)
      assert.equal(item.rating, 4.8)
      assert.equal(item.reviewCount, 1200)
      assert.equal(item.shopName, 'HydroBlend Direct')
      assert.equal(item.shopId, 'seller_99')
      assert.equal(item.skuCount, 2)
      assert.equal(item.tiktokUrl, 'https://shop.tiktok.com/view/product/1732501600694931597?region=US')
      assert.equal(item.sales28d, null)
      assert.equal(item.channelMetrics, null)
    } finally {
      cleanup()
    }
  })

  it('falls back from shop_product v3 400/invalid to shop_product_v1, unwraps double product_info, and unpacks search_item_list videos (#438)', async () => {
    const { store, cleanup } = makeTempStore()
    try {
      const calls = []
      const fakeSocialData = {
        fetch: async (req) => {
          calls.push(req.capability)
          if (req.capability === 'shop_product') {
            throw Object.assign(new Error('openai_error: bad_response_status_code 400'), {
              code: 'omnimux-request-failed',
              status: 400,
            })
          }
          if (req.capability === 'shop_product_v1') {
            return {
              data: {
                components_map: [
                  {
                    component_name: 'feed_list_you_may_like',
                    component_type: 'feed_list',
                    component_data: {
                      products: [
                        {
                          product_id: 'other_item',
                          title: 'You may also like',
                        },
                      ],
                    },
                  },
                ],
                global_data: {
                  product_info: {
                    error_code: 0,
                    categories: [{ category_name: 'Home Supplies' }, { category_name: 'Kitchen Appliances' }],
                    product_info: {
                      product_id: '1732501600694931597',
                      seller_id: 'seller_99',
                      product_model: {
                        product_id: '1732501600694931597',
                        name: 'Portable Blender - USB Charged, Leak-Proof',
                        images: [
                          {
                            url_list: [
                              'https://p16-oec.example/v1~tplv-crop-heic.heic',
                              'https://p16-oec.example/v1~tplv.jpg',
                            ],
                          },
                        ],
                      },
                      seller_model: {
                        shop_name: 'HydroBlend Direct',
                        seller_id: 'seller_99',
                      },
                      promotion_model: {
                        promotion_product_price: {
                          min_price: {
                            sale_price_format: '21.50',
                            currency_symbol: '$',
                          },
                        },
                      },
                      review_model: {
                        product_rating: 4.9,
                        review_count: 420,
                      },
                      sold_count: '3.1K',
                    },
                  },
                },
              },
            }
          }
          if (req.capability === 'creator_search_videos') {
            return {
              data: {
                aweme_list: [],
                search_item_list: [
                  {
                    aweme_info: {
                      aweme_id: '7499001122334455667',
                      desc: 'Portable blender morning smoothie test',
                      create_time: 1732500000,
                      author: { unique_id: 'smoothie_lab', nickname: 'Smoothie Lab' },
                      statistics: { play_count: 185000, digg_count: 9200, collect_count: 1400 },
                      share_url: 'https://www.tiktok.com/@smoothie_lab/video/7499001122334455667',
                    },
                  },
                ],
              },
            }
          }
          return {}
        },
      }
      const adapter = createDataSourceAdapter({
        store,
        getService: (name) => (name === 'socialData' ? fakeSocialData : null),
      })

      const detail = await adapter.getProductDetail({
        productId: '1732501600694931597',
        region: 'US',
        loadVideos: true,
      })
      assert.deepEqual(calls, ['shop_product', 'shop_product_v1', 'creator_search_videos'])
      assert.deepEqual(detail.warnings, [])
      assert.equal(detail.product.title, 'Portable Blender - USB Charged, Leak-Proof')
      assert.equal(detail.product.shopName, 'HydroBlend Direct')
      assert.equal(detail.product.category, 'Kitchen Appliances')
      assert.equal(detail.product.priceMin, 21.5)
      assert.equal(detail.product.totalSales, 3100)
      assert.equal(detail.product.coverUrl, 'https://p16-oec.example/v1~tplv.jpg')
      assert.equal(detail.referenceVideos.length, 1)
      assert.equal(detail.referenceVideos[0].videoId, '7499001122334455667')
      assert.equal(detail.referenceVideos[0].author, 'smoothie_lab')
      assert.equal(detail.referenceVideos[0].playCount, 185000)
      assert.equal(detail.referenceVideos[0].likeCount, 9200)
      assert.equal(detail.referenceVideos[0].collectCount, 1400)
      assert.equal(detail.referenceVideos[0].url, 'https://www.tiktok.com/@smoothie_lab/video/7499001122334455667')

      // Invalid v3 & v1 envelopes without productHint must fail as not-found
      const invalidAdapter = createDataSourceAdapter({
        store,
        getService: (name) => (name === 'socialData'
          ? {
              fetch: async (req) => {
                if (req.capability === 'shop_product') {
                  return { data: { exists: false, error_code: 23002002 } }
                }
                return { data: { region_match: false, error_code: 100000 } }
              },
            }
          : null),
      })
      await assert.rejects(
        () => invalidAdapter.getProductDetail({ productId: '9999999999999', region: 'US' }),
        (err) => err.name === 'SelectionError' && err.code === 'not-found',
      )
    } finally {
      cleanup()
    }
  })

  it('skips HEIC-only leading images for later webp images and ignores empty global_data.product_info stubs', async () => {
    const { store, cleanup } = makeTempStore()
    try {
      const adapter = createDataSourceAdapter({
        store,
        getService: (name) =>
          name === 'socialData'
            ? {
                fetch: async (req) => {
                  if (req.capability === 'shop_product') {
                    return {
                      data: {
                        global_data: {
                          product_info: {
                            error_code: 0,
                            product_info: {
                              product_model: { product_id: '1732501600694931999' },
                            },
                          },
                        },
                        product_data: {
                          page_config: {
                            components_map: [
                              {
                                component_name: 'product_info',
                                component_data: {
                                  product_info: {
                                    product_id: '1732501600694931999',
                                    product_model: {
                                      product_id: '1732501600694931999',
                                      name: 'Hydrating Sheet Mask Kit',
                                      images: [
                                        { url_list: ['https://p16-oec.example/first~tplv-crop-heic.heic'] },
                                        { url_list: ['https://p16-oec.example/second~tplv.webp'] },
                                      ],
                                    },
                                    seller_model: { shop_name: 'Glow Studio', seller_id: 'seller_glow' },
                                  },
                                },
                              },
                            ],
                          },
                        },
                      },
                    }
                  }
                  return {}
                },
              }
            : null,
      })

      const detail = await adapter.getProductDetail({ productId: '1732501600694931999', region: 'US' })
      assert.deepEqual(detail.warnings, [])
      assert.equal(detail.product.title, 'Hydrating Sheet Mask Kit')
      assert.equal(detail.product.shopName, 'Glow Studio')
      assert.equal(detail.product.coverUrl, 'https://p16-oec.example/second~tplv.webp')

      // Fallback to HEIC-only when no renderable image exists, and skip empty components_map stubs
      const heicOnlyAdapter = createDataSourceAdapter({
        store,
        getService: (name) =>
          name === 'socialData'
            ? {
                fetch: async (req) => {
                  if (req.capability === 'shop_product') {
                    return {
                      data: {
                        product_data: {
                          page_config: {
                            components_map: [
                              {
                                component_name: 'product_info',
                                component_data: { product_info: { product_id: '1732501600694932000' } },
                              },
                              {
                                component_name: 'product_info',
                                component_data: {
                                  product_info: {
                                    product_id: '1732501600694932000',
                                    product_model: {
                                      product_id: '1732501600694932000',
                                      name: 'HEIC Fallback Mask',
                                      images: [{ url_list: ['https://p16-oec.example/only~tplv-crop-heic.heic'] }],
                                    },
                                  },
                                },
                              },
                            ],
                          },
                        },
                      },
                    }
                  }
                  return {}
                },
              }
            : null,
      })
      const heicDetail = await heicOnlyAdapter.getProductDetail({ productId: '1732501600694932000', region: 'US' })
      assert.equal(heicDetail.product.title, 'HEIC Fallback Mask')
      assert.equal(heicDetail.product.coverUrl, 'https://p16-oec.example/only~tplv-crop-heic.heic')
    } finally {
      cleanup()
    }
  })

  it('caches list queries across pagination/sorting, decouples detail/video/review scopes, negative-caches invalid products, and protects snapshot & sales7d integrity (#453)', async () => {
    const { store, cleanup } = makeTempStore()
    try {
      let nowMs = 1_700_000_000_000
      const fetched = []
      const fakeSocialData = {
        fetch: async (req) => {
          fetched.push(req)
          if (req.capability === 'shop_search_v2') {
            return {
              data: {
                products: Array.from({ length: 12 }, (_, idx) => ({
                  product_id: `p_${idx + 1}`,
                  title: `Beauty Stick #${idx + 1}`,
                  price: 10 + idx,
                  sold_count: (idx + 1) * 10,
                  rating: 4.5,
                })),
              },
            }
          }
          if (req.capability === 'shop_product' || req.capability === 'shop_product_v1') {
            if (req.id === 'p_invalid') {
              return { data: { exists: false, error_code: 23002002 } }
            }
            return {
              data: {
                product_info: {
                  product_model: { product_id: req.id, name: `Live ${req.id}` },
                  seller_model: { shop_name: 'BeautyLab' },
                  sold_count: 88,
                },
              },
            }
          }
          if (req.capability === 'creator_search_videos') {
            return {
              data: {
                search_item_list: [
                  {
                    aweme_info: {
                      aweme_id: 'v_100',
                      desc: 'Body stick demo',
                      author: { unique_id: 'creator1' },
                      statistics: { play_count: 5000, digg_count: 300, collect_count: 40 },
                    },
                  },
                ],
              },
            }
          }
          if (req.capability === 'shop_reviews_v2') {
            return {
              data: {
                product_reviews: [{ review_rating: 5, review_text: 'Smooth and waterproof', reviewer_name: 'A***n' }],
              },
            }
          }
          return {}
        },
      }

      const adapter = createDataSourceAdapter({
        store,
        getService: (name) => (name === 'socialData' ? fakeSocialData : null),
        cacheConfig: {
          now: () => nowMs,
          listTtlMs: 10_000,
          detailTtlMs: 10_000,
          detailInvalidTtlMs: 5_000,
          videosTtlMs: 10_000,
          reviewsTtlMs: 10_000,
        },
      })

      // 1. Live rank query keeps sales7d === null when upstream only returns sold_count, and sorts by totalSales desc
      const page1 = await adapter.queryRank({ region: 'US', category: 'Beauty & Personal Care', page: 1 })
      assert.equal(page1.cached, false)
      assert.equal(page1.items.length, 10)
      assert.equal(page1.items[0].productId, 'p_12')
      assert.equal(page1.items[0].totalSales, 120)
      assert.equal(page1.items[0].sales7d, null)
      assert.equal(page1.items[0].periodSales, null)
      assert.ok(page1.unavailableFields.includes('sales7d'))

      // 2. Pagination & sort reuse list cache (0 additional shop_search_v2 calls)
      const page2 = await adapter.queryRank({ region: 'US', category: 'Beauty & Personal Care', page: 2 })
      assert.equal(page2.cached, true)
      assert.equal(page2.items.length, 2)
      const priceSorted = await adapter.queryRank({
        region: 'US',
        category: 'Beauty & Personal Care',
        sortField: 'priceMin',
        sortDir: 'asc',
        page: 1,
      })
      assert.equal(priceSorted.cached, true)
      assert.equal(priceSorted.items[0].productId, 'p_1')
      assert.equal(fetched.filter((r) => r.capability === 'shop_search_v2').length, 1)

      // 3. Search also reuses cache across local filters/pagination, and forceRefresh bypasses cache
      await adapter.searchProducts({ keyword: 'Stick', region: 'US', page: 1 })
      await adapter.searchProducts({ keyword: 'Stick', region: 'US', page: 2, sortField: 'priceMin', sortDir: 'asc' })
      assert.equal(fetched.filter((r) => r.capability === 'shop_search_v2').length, 2)
      const refreshed = await adapter.queryRank({ region: 'US', category: 'Beauty & Personal Care', forceRefresh: true })
      assert.equal(refreshed.cached, false)
      assert.equal(fetched.filter((r) => r.capability === 'shop_search_v2').length, 3)

      // 4. Independent detail/video/review scopes: video tab & review tab do NOT re-trigger shop_product/v1
      fetched.length = 0
      const invalidHint = { productId: 'p_invalid', region: 'US', title: 'Glow Stick' }
      const d1 = await adapter.getProductDetail({ productId: 'p_invalid', region: 'US', productHint: invalidHint })
      assert.equal(d1.detailStatus, 'unavailable')
      assert.deepEqual(fetched.map((r) => r.capability), ['shop_product', 'shop_product_v1'])

      // Re-opening within negative cache TTL costs 0 upstream calls
      const d2 = await adapter.getProductDetail({ productId: 'p_invalid', region: 'US', productHint: invalidHint })
      assert.equal(d2.detailStatus, 'unavailable')
      assert.equal(d2.cache.detail, true)
      assert.equal(fetched.length, 2)

      // Switching to videos tab (includeDetail: false, loadVideos: true) makes ONLY creator_search_videos call
      const v1 = await adapter.getProductDetail({
        productId: 'p_invalid',
        region: 'US',
        includeDetail: false,
        loadVideos: true,
        productHint: invalidHint,
      })
      assert.equal(v1.videosStatus, 'loaded')
      assert.equal(v1.referenceVideos.length, 1)
      assert.deepEqual(fetched.map((r) => r.capability), ['shop_product', 'shop_product_v1', 'creator_search_videos'])

      // Re-visiting videos costs 0 upstream calls
      const v2 = await adapter.getProductDetail({
        productId: 'p_invalid',
        region: 'US',
        includeDetail: false,
        loadVideos: true,
        productHint: invalidHint,
      })
      assert.equal(v2.cache.videos, true)
      assert.equal(fetched.length, 3)

      // Switching to reviews tab (includeDetail: false, loadReviews: true) makes ONLY shop_reviews_v2 call
      const r1 = await adapter.getProductDetail({
        productId: 'p_invalid',
        region: 'US',
        includeDetail: false,
        loadReviews: true,
        productHint: invalidHint,
      })
      assert.equal(r1.reviewsStatus, 'loaded')
      assert.equal(r1.reviews.length, 1)
      assert.deepEqual(fetched.map((r) => r.capability), [
        'shop_product',
        'shop_product_v1',
        'creator_search_videos',
        'shop_reviews_v2',
      ])

      // 5. After negative cache TTL expires, detail retries upstream
      nowMs += 6_000
      await adapter.getProductDetail({ productId: 'p_invalid', region: 'US', productHint: invalidHint })
      assert.equal(fetched.filter((r) => r.capability === 'shop_product').length, 2)

      // 6. Snapshot source skips live detail lookup unless forceRefresh is true
      fetched.length = 0
      const snapHint = { productId: 'snap_1', region: 'US', title: 'Snapshot Item', source: 'snapshot' }
      const snapDetail = await adapter.getProductDetail({ productId: 'snap_1', region: 'US', productHint: snapHint })
      assert.equal(snapDetail.detailStatus, 'snapshot')
      assert.equal(fetched.length, 0)
      await adapter.getProductDetail({ productId: 'snap_1', region: 'US', productHint: snapHint, forceRefresh: true })
      assert.equal(fetched.length, 1)

      // 7. Positive detailCache hit, concurrent dedupeInFlight, forceRefresh on videos/reviews, and asc null-last sorting
      fetched.length = 0
      const validHint = { productId: 'p_valid', region: 'US', title: 'Valid Beauty Product' }
      const [c1, c2] = await Promise.all([
        adapter.getProductDetail({ productId: 'p_valid', region: 'US', productHint: validHint }),
        adapter.getProductDetail({ productId: 'p_valid', region: 'US', productHint: validHint }),
      ])
      assert.equal(c1.detailStatus, 'live')
      assert.equal(c2.detailStatus, 'live')
      assert.equal(fetched.filter((r) => r.capability === 'shop_product').length, 1)

      const cachedDetailHit = await adapter.getProductDetail({ productId: 'p_valid', region: 'US', productHint: validHint })
      assert.equal(cachedDetailHit.detailStatus, 'cached')
      assert.equal(cachedDetailHit.cache.detail, true)
      assert.equal(fetched.length, 1)

      await adapter.getProductDetail({ productId: 'p_valid', region: 'US', includeDetail: false, loadVideos: true, productHint: validHint })
      await adapter.getProductDetail({ productId: 'p_valid', region: 'US', includeDetail: false, loadVideos: true, forceRefresh: true, productHint: validHint })
      assert.equal(fetched.filter((r) => r.capability === 'creator_search_videos').length, 2)

      await adapter.getProductDetail({ productId: 'p_valid', region: 'US', includeDetail: false, loadReviews: true, productHint: validHint })
      await adapter.getProductDetail({ productId: 'p_valid', region: 'US', includeDetail: false, loadReviews: true, forceRefresh: true, productHint: validHint })
      assert.equal(fetched.filter((r) => r.capability === 'shop_reviews_v2').length, 2)

      // Snapshot asc sort keeps null values last
      const nullSortSnap = adapter.importSnapshot({
        name: 'null-last-snap',
        region: 'US',
        content: JSON.stringify([
          { productId: 'n_null', title: 'Missing Price', price: null },
          { productId: 'n_high', title: 'Higher Price', price: 29.9 },
          { productId: 'n_low', title: 'Lower Price', price: 9.9 },
        ]),
      })
      const ascSorted = await adapter.queryRank({
        region: 'US',
        snapshotId: nullSortSnap.snapshot.id,
        sortField: 'priceMin',
        sortDir: 'asc',
      })
      assert.deepEqual(
        ascSorted.items.map((x) => x.productId),
        ['n_low', 'n_high', 'n_null']
      )
    } finally {
      cleanup()
    }
  })

  it('never negative-caches terminal quota/auth errors or transient v3 error with empty v1 stub', async () => {
    const { store, cleanup } = makeTempStore('omx-ttsel-noncache-')
    try {
      let mode = 'quota-exceeded'
      let callCount = 0
      const errSocialData = {
        async fetch(req) {
          callCount += 1
          if (req.capability === 'shop_product_v1') {
            return { data: {} } // Empty non-terminal v1 stub
          }
          if (mode === 'transient') {
            const err = new Error('upstream timeout')
            err.code = 'UPSTREAM_TIMEOUT'
            throw err
          }
          const err = new Error(`blocked:${mode}`)
          err.code = mode
          throw err
        },
      }
      const adapter = createDataSourceAdapter({ store, getService: (n) => (n === 'socialData' ? errSocialData : null) })
      const hint = { productId: 'p_err_1', region: 'US', title: 'Error Probe Product' }

      for (const terminalCode of ['needs-omnimux', 'quota-exceeded', 'CHANNEL_UNAVAILABLE']) {
        mode = terminalCode
        const before = callCount
        const dRes = await adapter.getProductDetail({ productId: `p_${terminalCode}`, region: 'US', productHint: { ...hint, productId: `p_${terminalCode}` } })
        assert.equal(dRes.detailStatus, 'error')
        const vRes = await adapter.getProductDetail({ productId: `p_${terminalCode}`, region: 'US', includeDetail: false, loadVideos: true, productHint: { ...hint, productId: `p_${terminalCode}` } })
        assert.equal(vRes.videosStatus, 'error')
        const rRes = await adapter.getProductDetail({ productId: `p_${terminalCode}`, region: 'US', includeDetail: false, loadReviews: true, productHint: { ...hint, productId: `p_${terminalCode}` } })
        assert.equal(rRes.reviewsStatus, 'error')
        assert.equal(callCount, before + 3)

        // Immediate retry must re-invoke upstream (must NOT negative-cache)
        await adapter.getProductDetail({ productId: `p_${terminalCode}`, region: 'US', productHint: { ...hint, productId: `p_${terminalCode}` } })
        await adapter.getProductDetail({ productId: `p_${terminalCode}`, region: 'US', includeDetail: false, loadVideos: true, productHint: { ...hint, productId: `p_${terminalCode}` } })
        await adapter.getProductDetail({ productId: `p_${terminalCode}`, region: 'US', includeDetail: false, loadReviews: true, productHint: { ...hint, productId: `p_${terminalCode}` } })
        assert.equal(callCount, before + 6)
      }

      // Transient v3 error + empty v1 stub must return error and NOT negative-cache
      mode = 'transient'
      const beforeTransient = callCount
      const tr1 = await adapter.getProductDetail({ productId: 'p_transient', region: 'US', productHint: { ...hint, productId: 'p_transient' } })
      assert.equal(tr1.detailStatus, 'error')
      const tr2 = await adapter.getProductDetail({ productId: 'p_transient', region: 'US', productHint: { ...hint, productId: 'p_transient' } })
      assert.equal(tr2.detailStatus, 'error')
      assert.equal(callCount, beforeTransient + 4)
    } finally {
      cleanup()
    }
  })
})
