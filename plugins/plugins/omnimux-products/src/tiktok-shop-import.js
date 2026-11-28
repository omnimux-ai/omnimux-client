/**
 * TikTok Shop link import via OmniMux hub social-data models
 * (tiktok-shop-product-link / tiktok-shop-product-v3 / tiktok-shop-product).
 *
 * Domain plugins never call TikHub directly and never hold TikHub keys —
 * only hub.socialData (omnimux_social_data) with OMNIMUX_API_KEY.
 */

const SHOP_HOST_RE = /(?:^|\.)shop\.tiktok\.com$/i
const PRODUCT_PATH_RE = /\/(?:pdp|product)(?:\/[^/?#]+)?\/(\d{5,})/i
const RECOMMENDATION_BLOCK_RE =
  /(?:you_may_like|top_reviewed|more_from|feed_list|recommend|related_link|video_list)/i
const RECOMMENDATION_TITLE_RE =
  /^(?:you may also like|explore more|top reviewed|more from this shop|related products|similar products|customers also viewed)$/i
const TERMINAL_HUB_ERROR_CODES = new Set(['needs-omnimux', 'quota-exceeded'])

/**
 * @param {string} url
 */
export function isTikTokShopProductUrl(url) {
  const raw = String(url || '').trim()
  if (!raw) return false
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`)
    if (!SHOP_HOST_RE.test(u.hostname)) return false
    return PRODUCT_PATH_RE.test(u.pathname) || /\/view\/product\//i.test(u.pathname)
  } catch {
    return SHOP_HOST_RE.test(raw) && PRODUCT_PATH_RE.test(raw)
  }
}

/**
 * @param {string} url
 */
export function extractShopProductId(url) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  if (/^\d{5,}$/.test(raw)) return raw
  const m = raw.match(PRODUCT_PATH_RE)
  return m?.[1] || ''
}

/**
 * @param {string} url
 */
export function extractShopRegion(url) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`)
    const q = u.searchParams.get('region')
    if (q && /^[a-zA-Z]{2}$/.test(q)) return q.toUpperCase()
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts[0] && /^[a-z]{2}$/i.test(parts[0]) && (parts[1] === 'pdp' || parts[1] === 'view')) {
      return parts[0].toUpperCase()
    }
  } catch {
    const m = raw.match(/[?&]region=([a-zA-Z]{2})\b/)
    if (m) return m[1].toUpperCase()
    const p = raw.match(/shop\.tiktok\.com\/([a-z]{2})\//i)
    if (p) return p[1].toUpperCase()
  }
  return ''
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObj(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function asText(value) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function isHeicUrl(url) {
  return /\.(?:heic|heif)(?:[?#]|$)/i.test(url) || /(?:crop|resize|origin)-heic|format=heic/i.test(url)
}

/**
 * Walk object tree with a visitor, skipping recommendation blocks.
 * @param {unknown} obj
 * @param {(path: string, value: unknown) => void} visit
 * @param {string} [path]
 * @param {Set<unknown>} [seen]
 * @param {number} [depth]
 */
function walk(obj, visit, path = '$', seen = new Set(), depth = 0) {
  if (depth > 8 || !obj || typeof obj !== 'object') {
    visit(path, obj)
    return
  }
  if (seen.has(obj)) return
  seen.add(obj)
  visit(path, obj)
  if (Array.isArray(obj)) {
    for (let i = 0; i < Math.min(obj.length, 80); i += 1) walk(obj[i], visit, `${path}[${i}]`, seen, depth + 1)
    return
  }
  const row = /** @type {Record<string, unknown>} */ (obj)
  if (
    RECOMMENDATION_BLOCK_RE.test(String(row.component_name || '')) ||
    RECOMMENDATION_BLOCK_RE.test(String(row.component_type || ''))
  ) {
    return
  }
  for (const [k, v] of Object.entries(row)) {
    if (RECOMMENDATION_BLOCK_RE.test(k)) continue
    walk(v, visit, `${path}.${k}`, seen, depth + 1)
  }
}

/**
 * Check explicit upstream failure / unavailability markers across v1 and v3 envelopes.
 * @param {unknown} data
 * @returns {{ invalid: boolean, reason: string }}
 */
export function inspectShopDetailStatus(data) {
  if (!isPlainObj(data)) return { invalid: false, reason: '' }
  const outer = /** @type {Record<string, unknown>} */ (
    /** @type {Record<string, unknown>} */ (/** @type {Record<string, unknown>} */ (data.data)?.global_data)?.product_info ||
    /** @type {Record<string, unknown>} */ (data.global_data)?.product_info ||
    /** @type {Record<string, unknown>} */ (/** @type {Record<string, unknown>} */ (/** @type {Record<string, unknown>} */ (data.data)?.data)?.global_data)?.product_info
  )
  const inner = isPlainObj(outer?.product_info) ? outer.product_info : null
  const nodes = [
    data,
    data.data,
    isPlainObj(data.data) ? data.data.data : null,
    data.product_data,
    isPlainObj(data.data) ? data.data.product_data : null,
    data.global_data,
    isPlainObj(data.data) ? data.data.global_data : null,
    outer,
    inner,
  ]
  for (const node of nodes) {
    if (!isPlainObj(node)) continue
    if (node.exists === false) return { invalid: true, reason: 'exists=false' }
    if (node.region_match === false) return { invalid: true, reason: 'region_match=false' }
    if (node.error_code !== undefined && node.error_code !== null && String(node.error_code).trim() !== '') {
      const code = Number(node.error_code)
      if (Number.isFinite(code) && code !== 0) {
        return { invalid: true, reason: `error_code=${code}` }
      }
    }
  }
  return { invalid: false, reason: '' }
}

/**
 * Unwrap nested `{ error_code, categories, product_info: { product_model, ... } }` envelopes.
 * @param {unknown} node
 * @returns {{ pinfo: Record<string, unknown> | null, categories: unknown[] }}
 */
function unwrapProductInfo(node) {
  let cur = node
  /** @type {unknown[]} */
  let categories = []
  for (let depth = 0; depth < 4 && isPlainObj(cur); depth += 1) {
    if (Array.isArray(cur.categories) && cur.categories.length > 0 && categories.length === 0) {
      categories = cur.categories
    }
    if (isPlainObj(cur.product_model) || isPlainObj(cur.product_base)) {
      return { pinfo: cur, categories }
    }
    if (isPlainObj(cur.product_info)) {
      cur = cur.product_info
      continue
    }
    return { pinfo: cur, categories }
  }
  return { pinfo: isPlainObj(cur) ? cur : null, categories }
}

/**
 * @param {unknown} comp
 * @returns {boolean}
 */
function isRecommendationComponent(comp) {
  if (!isPlainObj(comp)) return false
  return (
    RECOMMENDATION_BLOCK_RE.test(String(comp.component_name || '')) ||
    RECOMMENDATION_BLOCK_RE.test(String(comp.component_type || ''))
  )
}

/**
 * Locate the canonical `product_info` node for both v1 double-nested and v3 component layouts.
 * @param {Record<string, unknown>} root
 * @returns {{ pinfo: Record<string, unknown> | null, categories: unknown[] }}
 */
function locateProductInfo(root) {
  const dataObj = isPlainObj(root.data) ? root.data : null
  const dataDataObj = dataObj && isPlainObj(dataObj.data) ? dataObj.data : null
  const v1Candidates = [
    isPlainObj(root.global_data) ? root.global_data.product_info : null,
    dataObj && isPlainObj(dataObj.global_data) ? dataObj.global_data.product_info : null,
    dataDataObj && isPlainObj(dataDataObj.global_data) ? dataDataObj.global_data.product_info : null,
  ]
  for (const candidate of v1Candidates) {
    if (isPlainObj(candidate)) {
      const unwrapped = unwrapProductInfo(candidate)
      if (unwrapped.pinfo) return unwrapped
    }
  }

  const compMaps = [
    isPlainObj(root.product_data) && isPlainObj(root.product_data.page_config)
      ? root.product_data.page_config.components_map
      : null,
    dataObj && isPlainObj(dataObj.product_data) && isPlainObj(dataObj.product_data.page_config)
      ? dataObj.product_data.page_config.components_map
      : null,
    root.components_map,
    dataObj?.components_map,
  ]
  for (const cmap of compMaps) {
    if (!Array.isArray(cmap)) continue
    for (const comp of cmap) {
      if (isRecommendationComponent(comp)) continue
      const candidate = isPlainObj(comp) && isPlainObj(comp.component_data) ? comp.component_data.product_info : null
      if (isPlainObj(candidate)) {
        const unwrapped = unwrapProductInfo(candidate)
        if (unwrapped.pinfo) return unwrapped
      }
    }
  }

  /** @type {{ pinfo: Record<string, unknown> | null, categories: unknown[] } | null} */
  let preferred = null
  /** @type {{ pinfo: Record<string, unknown> | null, categories: unknown[] } | null} */
  let fallback = null
  walk(root, (_path, value) => {
    if (preferred || !isPlainObj(value)) return
    if (isPlainObj(value.product_info)) {
      const unwrapped = unwrapProductInfo(value.product_info)
      if (!unwrapped.pinfo) return
      if (isPlainObj(unwrapped.pinfo.product_model) || isPlainObj(unwrapped.pinfo.product_base)) {
        preferred = unwrapped
      } else if (!fallback) {
        fallback = unwrapped
      }
    }
  })
  return preferred || fallback || { pinfo: null, categories: [] }
}

/**
 * Extract ordered image URLs from an image entry, avoiding HEIC when renderable formats exist.
 * @param {unknown} item
 * @returns {string[]}
 */
function extractImageCandidates(item) {
  if (typeof item === 'string') {
    const s = item.trim()
    return s.startsWith('http') ? [s] : []
  }
  if (!isPlainObj(item)) return []
  /** @type {string[]} */
  const cands = []
  const priorityKeys = ['url_list', 'urls', 'url', 'image_url', 'src', 'thumb_url_list', 'thumb_urls']
  for (const key of priorityKeys) {
    const v = item[key]
    if (typeof v === 'string' && v.startsWith('http')) cands.push(v)
    if (Array.isArray(v)) {
      for (const x of v) if (typeof x === 'string' && x.startsWith('http')) cands.push(x)
    }
  }
  for (const [key, v] of Object.entries(item)) {
    if (priorityKeys.includes(key)) continue
    if (typeof v === 'string' && v.startsWith('http')) cands.push(v)
    if (Array.isArray(v)) {
      for (const x of v) if (typeof x === 'string' && x.startsWith('http')) cands.push(x)
    }
  }
  return cands
}

/**
 * Map gateway product detail payload into importer page-ish fields.
 * @param {unknown} data
 * @param {{ url: string, productId?: string, region?: string }} meta
 */
export function mapShopDetailToFields(data, meta) {
  const root = data && typeof data === 'object' ? /** @type {Record<string, unknown>} */ (data) : {}
  const status = inspectShopDetailStatus(root)
  if (status.invalid) {
    return {
      name: '',
      brand: '',
      price: '',
      promotion: '',
      selling_points: '',
      features: '',
      target_audience: '',
      sku: '',
      link: meta.url,
      categories: [],
      images: [],
      title: '',
      text: '',
      product_id: meta.productId || extractShopProductId(meta.url),
      region: meta.region || extractShopRegion(meta.url) || 'SG',
      valid: false,
      invalidReason: status.reason,
    }
  }

  /** @type {string} */
  let name = ''
  /** @type {string} */
  let brand = ''
  /** @type {string} */
  let sale = ''
  /** @type {string} */
  let origin = ''
  /** @type {string} */
  let currency = ''
  /** @type {string} */
  let discount = ''
  /** @type {string[]} */
  const images = []
  /** @type {string[]} */
  const bullets = []

  const located = locateProductInfo(root)
  const hasShellContainer = Boolean(root.global_data || root.components_map || root.product_data)
  const pinfo = located.pinfo
    ? located.pinfo
    : !hasShellContainer
      ? root
      : /** @type {Record<string, unknown>} */ ({})
  const pm = isPlainObj(pinfo.product_model)
    ? pinfo.product_model
    : isPlainObj(pinfo.product_base)
      ? pinfo.product_base
      : pinfo
  const seller = isPlainObj(pinfo.seller_model)
    ? pinfo.seller_model
    : isPlainObj(pinfo.seller_info)
      ? pinfo.seller_info
      : isPlainObj(pinfo.seller)
        ? pinfo.seller
        : {}
  const brandObj = isPlainObj(pinfo.brand_info)
    ? pinfo.brand_info
    : isPlainObj(pm.brand_info)
      ? pm.brand_info
      : {}

  const rawName = asText(pm.name) || asText(pm.title) || asText(pm.product_name)
  name = rawName && !RECOMMENDATION_TITLE_RE.test(rawName) ? rawName : ''
  brand =
    asText(seller.shop_name) ||
    asText(seller.seller_name) ||
    asText(seller.name) ||
    asText(brandObj.brand_name) ||
    asText(brandObj.name) ||
    asText(pm.brand_name) ||
    asText(pm.brand)

  const promo = isPlainObj(pinfo.promotion_model) ? pinfo.promotion_model : {}
  const prices = isPlainObj(promo.promotion_product_price) ? promo.promotion_product_price : {}
  const minp = isPlainObj(prices.min_price)
    ? prices.min_price
    : isPlainObj(pinfo.price_model?.min_price)
      ? /** @type {Record<string, unknown>} */ (pinfo.price_model.min_price)
      : isPlainObj(pinfo.product_price_info)
        ? pinfo.product_price_info
        : isPlainObj(pinfo.price_info)
          ? pinfo.price_info
          : {}
  sale =
    asText(minp.sale_price_format) ||
    asText(minp.single_product_price_format) ||
    asText(minp.sale_price_decimal) ||
    asText(minp.sale_price) ||
    asText(minp.min_price)
  origin = asText(minp.origin_price_format) || asText(minp.raw_origin_price_format) || asText(minp.origin_price_decimal)
  currency = asText(minp.currency_symbol) || asText(minp.currency_name)
  discount = asText(minp.discount_format) || asText(minp.reduce_price_format)

  // images from product_model.images (and pinfo.images / main_images fallback)
  const rawImages = [
    ...(Array.isArray(pm.images) ? pm.images : []),
    ...(Array.isArray(pinfo.images) ? pinfo.images : []),
    ...(Array.isArray(pm.main_images) ? pm.main_images : []),
    ...(pm.image ? [pm.image] : []),
    ...(pinfo.image ? [pinfo.image] : []),
  ]
  for (const it of rawImages) {
    const cands = extractImageCandidates(it)
    if (cands.length === 0) continue
    const renderable = cands.filter((u) => !isHeicUrl(u))
    const pool = renderable.length > 0 ? renderable : cands
    pool.sort((a, b) => scoreImage(b) - scoreImage(a))
    if (pool[0] && !isHeicUrl(pool[0])) images.push(pool[0])
  }

  // description bullets
  const desc = pm.description
  if (typeof desc === 'string' && desc.trim()) bullets.push(desc.trim().slice(0, 80))
  if (Array.isArray(desc)) {
    for (const block of desc.slice(0, 8)) {
      if (!block || typeof block !== 'object') continue
      const t = asText(/** @type {Record<string, unknown>} */ (block).text)
      if (t) bullets.push(t.slice(0, 80))
    }
  }

  // fallbacks scoped strictly to located product_info (never recommendation trees)
  if (!name && located.pinfo) {
    walk(pinfo, (path, value) => {
      if (name) return
      const key = path.split('.').pop() || ''
      if ((key === 'name' || key === 'title' || key === 'product_name') && typeof value === 'string' && value.length > 3 && value.length < 300) {
        if (!RECOMMENDATION_TITLE_RE.test(value.trim())) name = value.trim()
      }
    })
  }
  if (!sale && located.pinfo) {
    walk(pinfo, (path, value) => {
      if (sale) return
      if ((path.endsWith('sale_price_format') || path.endsWith('sale_price_decimal')) && typeof value === 'string' && /\d/.test(value)) {
        sale = value.trim()
      }
    })
  }
  if (!currency && located.pinfo) {
    walk(pinfo, (path, value) => {
      if (currency) return
      if ((path.endsWith('currency_symbol') || path.endsWith('currency_name')) && typeof value === 'string') {
        currency = value.trim()
      }
    })
  }
  if (images.length === 0 && located.pinfo) {
    const seen = new Set()
    walk(pinfo, (_path, value) => {
      if (typeof value !== 'string' || !value.startsWith('http')) return
      if (isHeicUrl(value)) return
      if (!/(?:jpg|jpeg|png|webp|tos-|tiktokcdn|ibyteimg)/i.test(value)) return
      if (/avatar|thumb_video|video\/tos/i.test(value)) return
      const key = (value.match(/\/([0-9a-f]{16,})~/) || [])[1] || value.split('?')[0]
      if (seen.has(key)) return
      seen.add(key)
      images.push(value)
    })
  }

  const uniqImages = dedupeImages(images).slice(0, 8)
  const priceText = sale
    ? `${currency && !sale.includes(currency) ? currency : ''}${sale}`.trim()
    : ''
  const promotion = [discount, origin ? `was ${currency}${origin}` : ''].filter(Boolean).join(' ')
  const hasRealProductSignal = Boolean(name || priceText || uniqImages.length > 0)

  return {
    name,
    brand,
    price: priceText || sale,
    promotion,
    selling_points: bullets.slice(0, 6).join('\n'),
    features: bullets.slice(0, 12).join('\n'),
    target_audience: '',
    sku: hasRealProductSignal ? asText(meta.productId) : '',
    link: meta.url,
    categories: brand ? [brand] : [],
    images: uniqImages,
    // page-shaped extras for importer merge path
    title: name,
    text: [name, brand, priceText, ...bullets].filter(Boolean).join('\n'),
    product_id: meta.productId || extractShopProductId(meta.url),
    region: meta.region || extractShopRegion(meta.url) || 'SG',
    valid: hasRealProductSignal && Boolean(name),
  }
}

/**
 * @param {string} url
 * @returns {number}
 */
function scoreImage(url) {
  let s = 0
  if (isHeicUrl(url)) s -= 100
  if (url.includes('1000:1000') || url.includes('800:800')) s += 5
  if (url.includes('origin')) s += 4
  if (url.includes('p16-')) s += 1
  if (/\.jpe?g/i.test(url)) s += 3
  if (/\.webp|\.png/i.test(url)) s += 2
  return s
}

/**
 * @param {string[]} urls
 */
function dedupeImages(urls) {
  const seen = new Set()
  const out = []
  for (const u of urls) {
    const key = (u.match(/\/([0-9a-f]{16,})~/) || [])[1] || u.split('?')[0]
    if (seen.has(key)) continue
    seen.add(key)
    out.push(u)
  }
  return out
}

/**
 * @param {string} code
 * @param {string} message
 */
function createImportError(code, message) {
  const err = /** @type {Error & { code?: string }} */ (new Error(message))
  err.code = code
  return err
}

/**
 * @param {unknown} payload
 * @param {ReturnType<typeof mapShopDetailToFields>} fields
 * @returns {boolean}
 */
function isUsableShopResult(payload, fields) {
  if (inspectShopDetailStatus(payload).invalid) return false
  return Boolean(fields?.name) && Boolean(fields.price || fields.images.length > 0 || fields.brand || fields.selling_points)
}

/**
 * Fetch shop product detail through hub.socialData.
 * @param {{
 *   url: string,
 *   socialData: (args: Record<string, unknown>) => Promise<unknown>,
 * }} input
 */
export async function fetchTikTokShopProductViaHub(input) {
  if (typeof input.socialData !== 'function') {
    throw new Error('hub socialData seam unavailable')
  }
  const url = String(input.url || '').trim()
  if (!isTikTokShopProductUrl(url)) {
    throw new Error('not a TikTok Shop product url')
  }
  let productId = extractShopProductId(url)
  const region = extractShopRegion(url) || 'SG'

  if (!productId) {
    const linked = await input.socialData({
      platform: 'tiktok',
      capability: 'shop_product_link',
      url,
    })
    productId = pickProductIdFromLinkResult(linked) || ''
  }

  if (!productId) {
    throw createImportError('link-import-empty', 'could not resolve TikTok Shop product_id')
  }

  /** @type {unknown} */
  let payload = null
  /** @type {ReturnType<typeof mapShopDetailToFields> | null} */
  let fields = null
  /** @type {string} */
  let modelUsed = 'tiktok-shop-product-v3'
  /** @type {unknown} */
  let v3Error = null
  let needFallback = false

  try {
    const detail = await input.socialData({
      platform: 'tiktok',
      capability: 'shop_product',
      id: productId,
      url,
      region,
    })
    payload = unwrapSocialData(detail)
    fields = mapShopDetailToFields(payload, { url, productId, region })
    if (!isUsableShopResult(payload, fields)) {
      needFallback = true
    }
  } catch (error) {
    if (TERMINAL_HUB_ERROR_CODES.has(/** @type {any} */ (error)?.code)) {
      throw error
    }
    v3Error = error
    needFallback = true
  }

  if (needFallback) {
    modelUsed = 'tiktok-shop-product'
    try {
      const v1Detail = await input.socialData({
        platform: 'tiktok',
        capability: 'shop_product_v1',
        id: productId,
        url,
        region,
      })
      const v1Payload = unwrapSocialData(v1Detail)
      const v1Fields = mapShopDetailToFields(v1Payload, { url, productId, region })
      if (!isUsableShopResult(v1Payload, v1Fields)) {
        const status = inspectShopDetailStatus(v1Payload)
        throw createImportError(
          'link-import-empty',
          status.invalid
            ? `TikTok Shop product unavailable (${status.reason})`
            : 'TikTok Shop product returned no usable detail'
        )
      }
      payload = v1Payload
      fields = v1Fields
    } catch (v1Error) {
      if (/** @type {any} */ (v1Error)?.code === 'link-import-empty') {
        throw v1Error
      }
      if (TERMINAL_HUB_ERROR_CODES.has(/** @type {any} */ (v1Error)?.code) || /** @type {any} */ (v1Error)?.code === 'CHANNEL_UNAVAILABLE') {
        throw v1Error
      }
      if (v3Error && TERMINAL_HUB_ERROR_CODES.has(/** @type {any} */ (v3Error)?.code)) {
        throw v3Error
      }
      const message =
        v1Error instanceof Error
          ? v1Error.message
          : v3Error instanceof Error
            ? v3Error.message
            : 'TikTok Shop detail fetch failed'
      throw createImportError('link-import-failed', message)
    }
  }

  if (!fields || !isUsableShopResult(payload, fields)) {
    throw createImportError('link-import-empty', 'TikTok Shop product returned no usable detail')
  }

  return {
    productId,
    region,
    model: modelUsed,
    fields,
    raw: payload,
  }
}

/**
 * @param {unknown} result
 */
function unwrapSocialData(result) {
  if (!result || typeof result !== 'object') return result
  const row = /** @type {Record<string, unknown>} */ (result)
  if (row.data !== undefined) return row.data
  return result
}

/**
 * @param {unknown} result
 */
function pickProductIdFromLinkResult(result) {
  const data = unwrapSocialData(result)
  if (!data || typeof data !== 'object') return ''
  const row = /** @type {Record<string, unknown>} */ (data)
  const id = asText(row.product_id) || asText(row.productId)
  if (id) return id
  // sometimes nested
  let found = ''
  walk(data, (_p, v) => {
    if (found) return
    if (typeof v === 'string' && /^\d{10,}$/.test(v)) found = v
  })
  return found
}
