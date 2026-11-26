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
})
