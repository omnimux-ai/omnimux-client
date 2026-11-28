import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  extractShopProductId,
  extractShopRegion,
  fetchTikTokShopProductViaHub,
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
})
