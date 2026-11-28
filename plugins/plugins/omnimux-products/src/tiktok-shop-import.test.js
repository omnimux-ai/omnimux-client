import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, it } from 'node:test'
import {
  extractShopProductId,
  extractShopRegion,
  fetchTikTokShopProductViaHub,
  isTikTokShopCdnHost,
  isTikTokShopProductUrl,
  mapShopDetailToFields,
} from './tiktok-shop-import.js'
import { importProductFromUrl } from './link-importer.js'

const SHOP_URL = 'https://shop.tiktok.com/sg/pdp/1733226176534972037'

describe('tiktok shop import helpers', () => {
  it('detects shop product urls and ids', () => {
    assert.equal(isTikTokShopProductUrl(SHOP_URL), true)
    assert.equal(isTikTokShopProductUrl('https://www.amazon.com/dp/B0'), false)
    assert.equal(extractShopProductId(SHOP_URL), '1733226176534972037')
    assert.equal(extractShopRegion(SHOP_URL), 'SG')
  })

  it('maps detail payload into draft fields', () => {
    const fields = mapShopDetailToFields({
      product_data: {
        page_config: {
          components_map: [{
            component_data: {
              product_info: {
                product_model: {
                  name: 'Mini Perfume Bottle',
                  product_id: '1733226176534972037',
                  images: [
                    { url_list: ['https://cdn.example/a~tplv-o3syd03w52-crop-webp:1000:1000.webp'] },
                    { url_list: ['https://cdn.example/b~tplv-o3syd03w52-crop-webp:1000:1000.webp'] },
                  ],
                  description: [{ type: 'text', text: 'Brand New' }],
                },
                seller_model: { shop_name: 'Comfort Bay' },
                promotion_model: {
                  promotion_product_price: {
                    min_price: {
                      sale_price_format: '2.00',
                      origin_price_format: '5.00',
                      currency_symbol: 'S$',
                      discount_format: '60%',
                    },
                  },
                },
              },
            },
          }],
        },
      },
    }, { url: SHOP_URL, productId: '1733226176534972037', region: 'SG' })

    assert.equal(fields.name, 'Mini Perfume Bottle')
    assert.equal(fields.brand, 'Comfort Bay')
    assert.match(fields.price, /2\.00/)
    assert.equal(fields.images.length, 2)
  })

  it('fetchTikTokShopProductViaHub uses shop_product then maps fields', async () => {
    const calls = []
    const shop = await fetchTikTokShopProductViaHub({
      url: SHOP_URL,
      socialData: async (args) => {
        calls.push(args)
        assert.equal(args.capability, 'shop_product')
        return {
          data: {
            product_data: {
              page_config: {
                components_map: [{
                  component_data: {
                    product_info: {
                      product_model: {
                        name: 'Bottle',
                        images: ['https://cdn.example/x.jpg'],
                      },
                      seller_model: { shop_name: 'Shop' },
                      promotion_model: {
                        promotion_product_price: {
                          min_price: { sale_price_format: '3.20', currency_symbol: 'S$' },
                        },
                      },
                    },
                  },
                }],
              },
            },
          },
        }
      },
    })
    assert.equal(shop.productId, '1733226176534972037')
    assert.equal(shop.region, 'SG')
    assert.equal(shop.fields.name, 'Bottle')
    assert.equal(calls[0].platform, 'tiktok')
  })
})

describe('importProductFromUrl tiktok shop path', () => {
  it('uses hub.socialData for shop urls without HTML fetch', async () => {
    let fetched = false
    const draft = await importProductFromUrl({
      url: SHOP_URL,
      kind: 'physical',
      fetcher: async () => {
        fetched = true
        throw new Error('should not HTML-fetch shop')
      },
      hub: {
        socialData: async () => ({
          data: {
            product_data: {
              page_config: {
                components_map: [{
                  component_data: {
                    product_info: {
                      product_model: {
                        name: 'BUY 2 TAKE 1 Portable Mini Perfume',
                        images: [
                          'https://p16.example/img1.webp',
                          'https://p16.example/img2.webp',
                        ],
                      },
                      seller_model: { shop_name: 'Comfort Bay' },
                      promotion_model: {
                        promotion_product_price: {
                          min_price: {
                            sale_price_format: '2.00',
                            currency_symbol: 'S$',
                            origin_price_format: '5.00',
                            discount_format: '60%',
                          },
                        },
                      },
                    },
                  },
                }],
              },
            },
          },
        }),
      },
    })
    assert.equal(fetched, false)
    assert.match(draft.name, /Perfume|BUY 2/i)
    assert.ok(String(draft.price).includes('2.00'))
    assert.ok(Array.isArray(draft.images) && draft.images.length >= 1)
    assert.equal(draft.kind, 'physical')
  })

  it('unwraps v1 double product_info, skips recommendation blocks, avoids HEIC and prevents dashed title brand pollution (#438)', async () => {
    const v1Response = {
      data: {
        components_map: [
          {
            component_name: 'top_reviewed_products',
            component_type: 'top_reviewed_products',
            component_data: {
              products: [{ title: 'Top Reviewed Wrong Item', image: 'https://cdn.example/wrong.jpg' }],
            },
          },
          {
            component_name: 'feed_list_you_may_like',
            component_type: 'feed_list',
            component_data: {
              products: [{ title: 'You may also like', image: 'https://cdn.example/rec.jpg' }],
            },
          },
        ],
        global_data: {
          product_info: {
            error_code: 0,
            categories: [{ category_name: 'Kitchen' }],
            product_info: {
              product_model: {
                product_id: '1732501600694931597',
                name: 'Portable Blender - USB Charged, Leak-Proof, Easy-to-Clean',
                images: [
                  {
                    url_list: [
                      'https://p16-oec.example/main~tplv-crop-heic.heic',
                      'https://p16-oec.example/main~tplv-1000:1000.webp',
                    ],
                  },
                ],
                description: [{ type: 'text', text: 'Compact rechargeable blender cup' }],
              },
              seller_model: {},
              promotion_model: {
                promotion_product_price: {
                  min_price: {
                    sale_price_format: '24.99',
                    currency_symbol: '$',
                  },
                },
              },
            },
          },
        },
      },
    }

    const calls = []
    const draft = await importProductFromUrl({
      url: 'https://shop.tiktok.com/view/product/1732501600694931597?region=US&locale=en',
      kind: 'physical',
      fetcher: async () => {
        throw new Error('should not HTML-fetch TikTok Shop URL')
      },
      hub: {
        socialData: async (args) => {
          calls.push(args.capability)
          if (args.capability === 'shop_product') {
            throw Object.assign(new Error('openai_error: bad_response_status_code 400'), {
              code: 'omnimux-request-failed',
              status: 400,
            })
          }
          return v1Response
        },
      },
    })

    assert.deepEqual(calls, ['shop_product', 'shop_product_v1'])
    assert.equal(draft.analysis.model, 'tiktok-shop-product')
    assert.match(draft.name, /^Portable Blender/)
    assert.equal(draft.brand, '')
    assert.equal(draft.price, '$24.99')
    assert.equal(draft.sku, '1732501600694931597')
    assert.deepEqual(draft.images, ['https://p16-oec.example/main~tplv-1000:1000.webp'])
  })

  it('rejects invalid/region-mismatched TikTok Shop responses instead of fabricating placeholder names (#438)', async () => {
    const invalidFields = mapShopDetailToFields(
      {
        region_match: false,
        error_code: 100000,
        global_data: {
          product_info: {
            error_code: 23002002,
            product_info: { product_model: { product_id: '1732501600694931597' } },
          },
        },
      },
      { url: 'https://shop.tiktok.com/sg/pdp/1732501600694931597', productId: '1732501600694931597', region: 'SG' },
    )
    assert.equal(invalidFields.name, '')
    assert.equal(invalidFields.sku, '')
    assert.equal(invalidFields.valid, false)

    let htmlFetched = false
    await assert.rejects(
      () => importProductFromUrl({
        url: 'https://shop.tiktok.com/sg/pdp/1732501600694931597',
        kind: 'physical',
        fetcher: async () => {
          htmlFetched = true
          return new Response('<html><title>Blocked</title></html>', { status: 200 })
        },
        hub: {
          socialData: async (args) => {
            if (args.capability === 'shop_product') {
              return { data: { exists: false, error_code: 23002002 } }
            }
            return { data: { region_match: false, error_code: 100000 } }
          },
        },
      }),
      (err) => err.name === 'LinkImportError' && err.code === 'link-import-empty',
    )
    assert.equal(htmlFetched, false)
  })

  it('falls through an empty global_data.product_info stub to populated components_map data', () => {
    const fields = mapShopDetailToFields(
      {
        global_data: {
          product_info: {
            error_code: 0,
            product_info: {
              product_model: { product_id: '1732501600694931888' },
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
                    product_id: '1732501600694931888',
                    product_model: {
                      product_id: '1732501600694931888',
                      name: 'Hydrating Serum Mask',
                      images: [{ url_list: ['https://p16-oec.example/mask~tplv.jpg'] }],
                    },
                    seller_model: { shop_name: 'Glow Studio' },
                    promotion_model: {
                      promotion_product_price: {
                        min_price: { sale_price_format: '19.99', currency_symbol: '$' },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
      {
        url: 'https://shop.tiktok.com/view/product/1732501600694931888?region=US',
        productId: '1732501600694931888',
        region: 'US',
      },
    )
    assert.equal(fields.valid, true)
    assert.equal(fields.name, 'Hydrating Serum Mask')
    assert.equal(fields.brand, 'Glow Studio')
    assert.equal(fields.price, '$19.99')
    assert.deepEqual(fields.images, ['https://p16-oec.example/mask~tplv.jpg'])
  })

  it('approves only compiled-in official TikTok Shop CDN hostnames for synthetic proxy IP exemption', () => {
    for (const host of [
      'p16-oec-general.ttcdn-us.com',
      'p19-oec-general-useast5.ttcdn-us.com',
      'p16-oec-va.ibyteimg.com',
      'p16-sign-va.tiktokcdn.com.',
    ]) {
      assert.equal(isTikTokShopCdnHost(host), true, host)
    }
    for (const host of [
      'evil.ttcdn-us.com.attacker.com',
      'fakettcdn-us.com',
      '.ttcdn-us.com',
      'a..ttcdn-us.com',
      '198.18.52.164',
      'localhost',
      'example.com',
      '',
    ]) {
      assert.equal(isTikTokShopCdnHost(host), false, host)
    }
  })

  it('persists TikTok Shop images via default shopImageFetcher + publicFetch under 198.18.x.x fake-IP and enforces redirect SSRF bounds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'products-tt-cdn-e2e-'))
    const dialed = []
    const webpBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x0c, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
    const makeFakeRequest = () => (target, options, done) => {
      const req = new EventEmitter()
      req.destroy = () => {}
      req.end = () => options.lookup(target.hostname, {}, (err, address, family) => {
        if (err) {
          req.emit('error', err)
          return
        }
        dialed.push({ href: target.href, host: target.hostname, address, family })
        let statusCode = 200
        let headers = { 'content-type': 'image/webp' }
        let chunks = [webpBytes]
        if (target.pathname === '/redir-cdn') {
          statusCode = 302
          headers = { location: 'https://p19-oec-va.tiktokcdn.com/final.webp' }
          chunks = []
        } else if (target.pathname === '/redir-evil-host') {
          statusCode = 302
          headers = { location: 'https://tracker.example.com/evil.webp' }
          chunks = []
        } else if (target.pathname === '/redir-literal-ip') {
          statusCode = 302
          headers = { location: 'https://198.18.52.164/evil.webp' }
          chunks = []
        }
        const incoming = Readable.from(chunks)
        incoming.statusCode = statusCode
        incoming.headers = headers
        done(incoming)
      })
      return req
    }

    try {
      const draft = await importProductFromUrl({
        url: 'https://shop.tiktok.com/view/product/1731770029266276688?region=US',
        kind: 'physical',
        paths: { mediaDir: join(dir, 'media') },
        publicFetchDeps: {
          lookup: async (hostname) => [{ address: hostname.includes('tiktokcdn') ? '198.18.9.10' : '198.18.52.164', family: 4 }],
          request: makeFakeRequest(),
        },
        hub: {
          socialData: async () => ({
            data: {
              global_data: {
                product_info: {
                  error_code: 0,
                  product_info: {
                    product_id: '1731770029266276688',
                    product_model: {
                      product_id: '1731770029266276688',
                      name: 'Proxy Fake-IP Test Blender',
                      images: [
                        { url_list: ['https://p16-oec-general.ttcdn-us.com/direct.webp'] },
                        { url_list: ['https://p16-oec-general.ttcdn-us.com/redir-cdn'] },
                        { url_list: ['https://p16-oec-general.ttcdn-us.com/redir-evil-host'] },
                        { url_list: ['https://p16-oec-general.ttcdn-us.com/redir-literal-ip'] },
                      ],
                    },
                    seller_model: { shop_name: 'HydroBlend Direct' },
                    promotion_model: { promotion_product_price: { min_price: { sale_price_format: '29.99', currency_symbol: '$' } } },
                  },
                },
              },
            },
          }),
        },
      })

      assert.equal(draft.name, 'Proxy Fake-IP Test Blender')
      assert.equal(draft.media.length, 2)
      assert.equal(draft.cover_media_id, draft.media[0].id)
      assert.ok(existsSync(draft.media[0].real_path))
      assert.ok(existsSync(draft.media[1].real_path))
      assert.equal(dialed.some((entry) => entry.host === 'tracker.example.com'), false, 'must block non-TikTok redirect host on 198.18.x.x')
      assert.equal(dialed.some((entry) => entry.host === '198.18.52.164'), false, 'must block literal 198.18.x.x redirect target')
      assert.equal(dialed.some((entry) => entry.host === 'p19-oec-va.tiktokcdn.com' && entry.address === '198.18.9.10'), true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
