import {
  OPERATIONAL_LIMITS,
  TIKTOK_CATEGORIES,
  computeAcceleration,
  currencyForRegion,
} from './constants.js'
import { SelectionError } from './errors.js'
import { normalizeProductInput, normalizeProductKey } from './store.js'

const HEADER_ALIASES = Object.freeze({
  productid: 'productId',
  product_id: 'productId',
  id: 'productId',
  商品id: 'productId',
  spu: 'productId',
  title: 'title',
  name: 'title',
  product_name: 'title',
  商品标题: 'title',
  标题: 'title',
  region: 'region',
  site: 'region',
  站点: 'region',
  coverurl: 'coverUrl',
  cover_url: 'coverUrl',
  image: 'coverUrl',
  image_url: 'coverUrl',
  主图: 'coverUrl',
  price: 'priceMin',
  pricemin: 'priceMin',
  price_min: 'priceMin',
  最低价: 'priceMin',
  价格: 'priceMin',
  pricemax: 'priceMax',
  price_max: 'priceMax',
  最高价: 'priceMax',
  currency: 'currency',
  币种: 'currency',
  commissionrate: 'commissionRate',
  commission_rate: 'commissionRate',
  commission: 'commissionRate',
  佣金率: 'commissionRate',
  totalsales: 'totalSales',
  total_sales: 'totalSales',
  总销量: 'totalSales',
  sales7d: 'sales7d',
  sales_7d: 'sales7d',
  '7天销量': 'sales7d',
  periodsales: 'periodSales',
  period_sales: 'periodSales',
  期间销量: 'periodSales',
  sales28d: 'sales28d',
  sales_28d: 'sales28d',
  '28天销量': 'sales28d',
  sales90d: 'sales90d',
  sales_90d: 'sales90d',
  '90天销量': 'sales90d',
  gmv7d: 'gmv7d',
  gmv_7d: 'gmv7d',
  '7天gmv': 'gmv7d',
  periodgmv: 'periodGmv',
  period_gmv: 'periodGmv',
  期间gmv: 'periodGmv',
  totalgmv: 'totalGmv',
  total_gmv: 'totalGmv',
  总gmv: 'totalGmv',
  growthrate: 'growthRate',
  growth_rate: 'growthRate',
  增长率: 'growthRate',
  creatorscount: 'creatorsCount',
  creators_count: 'creatorsCount',
  creators: 'creatorsCount',
  带货达人数: 'creatorsCount',
  达人数: 'creatorsCount',
  videoscount: 'videosCount',
  videos_count: 'videosCount',
  带货视频数: 'videosCount',
  rating: 'rating',
  评分: 'rating',
  reviewcount: 'reviewCount',
  review_count: 'reviewCount',
  评论数: 'reviewCount',
  listeddays: 'listedDays',
  listed_days: 'listedDays',
  上架天数: 'listedDays',
  listeddate: 'listedDate',
  listed_date: 'listedDate',
  上架时间: 'listedDate',
  shopname: 'shopName',
  shop_name: 'shopName',
  店铺名称: 'shopName',
  店铺名: 'shopName',
  shopid: 'shopId',
  shop_id: 'shopId',
  店铺id: 'shopId',
  shoptype: 'shopType',
  shop_type: 'shopType',
  店铺类型: 'shopType',
  category: 'category',
  类目: 'category',
  productcardratio: 'productCardRatio',
  product_card_ratio: 'productCardRatio',
  商品卡占比: 'productCardRatio',
  videoratio: 'videoRatio',
  video_ratio: 'videoRatio',
  视频占比: 'videoRatio',
  liveratio: 'liveRatio',
  live_ratio: 'liveRatio',
  直播占比: 'liveRatio',
  creatorratio: 'creatorRatio',
  creator_ratio: 'creatorRatio',
  达人带货占比: 'creatorRatio',
  shopaccountratio: 'shopAccountRatio',
  shop_account_ratio: 'shopAccountRatio',
  店铺号带货占比: 'shopAccountRatio',
  gmv30d: 'gmv30d',
  channelgmv30d: 'gmv30d',
  '近30天渠道gmv': 'gmv30d',
  tiktokurl: 'tiktokUrl',
  tiktok_url: 'tiktokUrl',
  商品链接: 'tiktokUrl',
  rank: 'rank',
  排名: 'rank',
})

/**
 * Parse RFC-4180 CSV text into an array of keyed objects.
 * @param {string} rawText
 */
export function parseCsvRows(rawText) {
  const text = String(rawText || '').replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"'
        i += 1
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(cell.trim())
      cell = ''
    } else if (ch === '\r' && next === '\n') {
      row.push(cell.trim())
      if (row.some((v) => v !== '')) rows.push(row)
      row = []
      cell = ''
      i += 1
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell.trim())
      if (row.some((v) => v !== '')) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += ch
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim())
    if (row.some((v) => v !== '')) rows.push(row)
  }
  if (rows.length < 2) return []
  const headers = rows[0].map((h) => {
    const key = h.toLowerCase().replace(/[\s-]+/g, '')
    return HEADER_ALIASES[key] || HEADER_ALIASES[h.toLowerCase().trim()] || h.trim()
  })
  const out = []
  for (let r = 1; r < rows.length; r += 1) {
    const obj = {}
    for (let c = 0; c < headers.length; c += 1) {
      if (headers[c]) obj[headers[c]] = rows[r][c] ?? ''
    }
    out.push(obj)
  }
  return out
}

export function parseSnapshotPayload({ content, format, region = 'US', name = '' }) {
  if (typeof content !== 'string' && !Array.isArray(content)) {
    throw new SelectionError('invalid-request', 'content (CSV/JSON string or array) is required')
  }
  let rawRows = []
  let detectedFormat = format || 'json'
  if (Array.isArray(content)) {
    rawRows = content
    detectedFormat = 'json'
  } else {
    const trimmed = content.trim()
    if (!trimmed) throw new SelectionError('invalid-request', 'snapshot content is empty')
    if (format === 'json' || (!format && (trimmed.startsWith('[') || trimmed.startsWith('{')))) {
      try {
        const parsed = JSON.parse(trimmed)
        rawRows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : Array.isArray(parsed.products) ? parsed.products : []
        detectedFormat = 'json'
      } catch (err) {
        throw new SelectionError('invalid-json', `Failed to parse JSON snapshot: ${err.message}`)
      }
    } else {
      rawRows = parseCsvRows(trimmed)
      detectedFormat = 'csv'
    }
  }

  if (rawRows.length === 0) {
    throw new SelectionError('invalid-request', 'Invalid snapshot: no valid product rows found')
  }

  const normalized = []
  for (let i = 0; i < rawRows.length; i += 1) {
    const row = rawRows[i]
    if (!row || typeof row !== 'object') continue
    const fallbackId = row.productId || row.product_id || row.id || `snap_${Date.now()}_${i + 1}`
    const fallbackTitle = row.title || row.name || row.product_name || ''
    if (!String(fallbackTitle).trim()) continue
    normalized.push(
      normalizeProductInput(
        { ...row, productId: fallbackId, rank: row.rank ?? i + 1 },
        { region, source: 'snapshot', sourceDetail: name || '导入快照' }
      )
    )
  }
  if (normalized.length === 0) {
    throw new SelectionError('invalid-request', 'Snapshot rows missing required title column')
  }
  return { format: detectedFormat, items: normalized }
}

function pickScalar(val) {
  if (typeof val === 'number' && Number.isFinite(val)) return val
  if (typeof val === 'string' && val.trim() !== '') return val.trim()
  return null
}

function extractPriceValue(raw, kind = 'min') {
  const priceObj = raw.price && typeof raw.price === 'object' ? raw.price : null
  const priceInfo =
    raw.price_info && typeof raw.price_info === 'object'
      ? raw.price_info
      : raw.product_price_info && typeof raw.product_price_info === 'object'
        ? raw.product_price_info
        : null
  const candidates =
    kind === 'max'
      ? [
          priceObj?.max_price,
          priceObj?.origin_price,
          priceObj?.origin_price_format,
          priceInfo?.max_price,
          raw.max_price,
          raw.price_max,
          extractPriceValue(raw, 'min'),
        ]
      : [
          priceObj?.real_price,
          priceObj?.sale_price,
          priceObj?.min_price,
          priceObj?.sale_price_format,
          priceObj?.price_format,
          priceInfo?.sale_price_decimal,
          priceInfo?.sale_price,
          priceInfo?.min_price,
          raw.sale_price,
          raw.min_price,
          raw.price_min,
          priceObj ? null : raw.price,
        ]
  for (const val of candidates) {
    const scalar = pickScalar(val)
    if (scalar !== null) return scalar
  }
  return null
}

function findProductInfoNode(root, seen = new Set(), depth = 0) {
  if (!root || typeof root !== 'object' || depth > 8 || seen.has(root)) return null
  seen.add(root)
  if (Array.isArray(root)) {
    for (let i = 0; i < Math.min(root.length, 40); i += 1) {
      const hit = findProductInfoNode(root[i], seen, depth + 1)
      if (hit) return hit
    }
    return null
  }
  if (root.product_info && typeof root.product_info === 'object') {
    return root.product_info
  }
  for (const val of Object.values(root)) {
    const hit = findProductInfoNode(val, seen, depth + 1)
    if (hit) return hit
  }
  return null
}

function pickImageUrl(candidate) {
  if (typeof candidate === 'string') return candidate.trim()
  if (candidate && typeof candidate === 'object') {
    return (
      pickScalar(candidate.url_list?.[0]) ??
      pickScalar(candidate.thumb_url_list?.[0]) ??
      pickScalar(candidate.url) ??
      ''
    )
  }
  return ''
}

function firstImageUrl(candidates) {
  for (const candidate of candidates) {
    const resolved = pickImageUrl(candidate)
    if (resolved) return String(resolved)
  }
  return ''
}

function normalizeHubReviews(rRes) {
  const rawReviews =
    rRes?.product_reviews ||
    rRes?.reviews ||
    rRes?.data?.product_reviews ||
    rRes?.data?.reviews ||
    rRes?.data?.items ||
    rRes?.data?.data?.product_reviews ||
    rRes?.data?.data?.reviews ||
    rRes?.data?.data?.items ||
    []
  if (!Array.isArray(rawReviews)) return []
  return rawReviews
    .filter((r) => r && typeof r === 'object')
    .slice(0, 10)
    .map((r) => {
      const rawRating = r.review_rating ?? r.rating ?? r.score
      const numericRating =
        rawRating !== null && rawRating !== undefined && String(rawRating).trim() !== ''
          ? Number(rawRating)
          : NaN
      const rating = Number.isFinite(numericRating) ? numericRating : null
      const textCandidate = pickScalar(r.review_text) ?? pickScalar(r.text) ?? pickScalar(r.content) ?? pickScalar(r.review_text?.text)
      const text = textCandidate !== null ? String(textCandidate) : ''
      const timeCandidate = pickScalar(r.review_time) ?? pickScalar(r.created_at) ?? pickScalar(r.create_time)
      const createdAt = timeCandidate !== null ? String(timeCandidate) : ''
      const authorObj = r.author && typeof r.author === 'object' ? r.author : null
      const reviewerCandidate =
        pickScalar(r.reviewer_name) ??
        pickScalar(r.user_name) ??
        (authorObj ? pickScalar(authorObj.nickname) ?? pickScalar(authorObj.unique_id) ?? pickScalar(authorObj.name) : pickScalar(r.author))
      const reviewer = reviewerCandidate !== null ? String(reviewerCandidate) : ''
      return { rating, text, createdAt, reviewer }
    })
    .filter((r) => r.rating !== null || r.text !== '' || r.reviewer !== '' || r.createdAt !== '')
}

function extractHubProductDetail(res) {
  const candidates = [res?.product, res?.data?.product, res?.data?.data, res?.data, res]
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && (candidate.title || candidate.product_name || candidate.name)) {
      return candidate
    }
  }
  const pinfo = findProductInfoNode(res)
  if (!pinfo || typeof pinfo !== 'object') return null
  const pm = pinfo.product_model && typeof pinfo.product_model === 'object' ? pinfo.product_model : pinfo
  const title = String(pm.name ?? pm.title ?? pm.product_name ?? pinfo.title ?? '').trim()
  if (!title) return null
  const seller = pinfo.seller_model && typeof pinfo.seller_model === 'object' ? pinfo.seller_model : pinfo.seller || {}
  const minPrice =
    pinfo.promotion_model?.promotion_product_price?.min_price &&
    typeof pinfo.promotion_model.promotion_product_price.min_price === 'object'
      ? pinfo.promotion_model.promotion_product_price.min_price
      : {}
  const maxPrice =
    pinfo.promotion_model?.promotion_product_price?.max_price &&
    typeof pinfo.promotion_model.promotion_product_price.max_price === 'object'
      ? pinfo.promotion_model.promotion_product_price.max_price
      : {}
  const reviewModel = pinfo.review_model && typeof pinfo.review_model === 'object' ? pinfo.review_model : {}
  const firstImg = Array.isArray(pm.images) ? pm.images[0] : null
  const coverUrl = pickImageUrl(firstImg)

  return {
    product_id: pm.product_id ?? pm.id ?? pinfo.product_id,
    title,
    cover_url: coverUrl,
    price: {
      sale_price: minPrice.sale_price_format ?? minPrice.single_product_price_format ?? minPrice.sale_price,
      max_price: maxPrice.sale_price_format ?? maxPrice.origin_price_format ?? maxPrice.sale_price,
      currency: minPrice.currency_symbol || minPrice.currency_name,
    },
    sold_count: pinfo.sold_count ?? pm.sold_count ?? pinfo.sales ?? null,
    product_rating: reviewModel.product_rating ?? reviewModel.overall_score ?? pinfo.product_rating ?? null,
    review_count: reviewModel.review_count ?? pinfo.review_count ?? null,
    seller_name: seller.shop_name || seller.name || seller.seller_name || '',
    seller_id: seller.seller_id || seller.id || '',
    category_name: pm.category_name || pinfo.category_name || '',
  }
}

function extractItemsFromHubResponse(res) {
  if (!res || typeof res !== 'object') return []
  const candidates = [
    res.products,
    res.items,
    res.list,
    res.search_result,
    res.data?.products,
    res.data?.items,
    res.data?.list,
    res.data?.product_list,
    res.data?.search_result,
    res.data?.data?.products,
    res.data?.data?.items,
    res.data?.data?.list,
    res.data?.data?.product_list,
    res.data?.data?.search_result,
    res.result?.products,
    res.result?.items,
  ]
  for (const list of candidates) {
    if (Array.isArray(list)) return list
  }
  return []
}

function normalizeHubShopItem(rawInput, idx, region, source, sourceDetail) {
  const raw =
    rawInput && typeof rawInput === 'object'
      ? rawInput.title || rawInput.product_name || rawInput.name || rawInput.seo_title
        ? rawInput
        : (rawInput.product_info && typeof rawInput.product_info === 'object'
            ? rawInput.product_info
            : rawInput.product_base && typeof rawInput.product_base === 'object'
              ? rawInput.product_base
              : rawInput)
      : {}
  const productId = String(
    raw.product_id ?? raw.productId ?? raw.id ?? raw.item_id ?? raw.spu_id ?? `tt_${idx + 1}`
  ).trim()
  const title = String(raw.title ?? raw.product_name ?? raw.name ?? raw.seo_title ?? '').trim()
  if (!title) return null

  const priceRaw = extractPriceValue(raw, 'min')
  const priceMaxRaw = extractPriceValue(raw, 'max')
  const coverUrl = firstImageUrl([
    raw.cover_url,
    raw.cover,
    raw.image_url,
    raw.image,
    raw.img,
    raw.product_img,
    raw.product_image,
    Array.isArray(raw.images) ? raw.images[0] : null,
    raw.main_image,
  ])
  const salesTotal =
    raw.sold_count ?? raw.sold_info?.sold_count ?? raw.product_sales ?? raw.sales_count ?? raw.total_sales ?? raw.sale_count ?? raw.sales ?? raw.sold ?? null
  const sales7d = raw.sales_7d ?? raw.sold_7d ?? raw.period_sales ?? null
  const sales28d = raw.sales_28d ?? raw.sold_28d ?? null
  const rating = raw.product_rating ?? raw.rate_info?.score ?? raw.review_info?.rating ?? raw.rating ?? raw.review_rating ?? raw.score ?? null
  const reviewCount = raw.review_count ?? raw.rate_info?.review_count ?? raw.review_info?.review_count ?? raw.reviews_count ?? raw.comment_count ?? null
  const shopName = raw.seller?.name ?? raw.seller?.shop_name ?? raw.shop?.name ?? raw.shop?.shop_name ?? raw.shop_name ?? raw.seller_name ?? ''
  const shopId = raw.seller?.seller_id ?? raw.seller?.id ?? raw.shop?.id ?? raw.shop_id ?? raw.seller_id ?? ''
  const category = raw.category_name ?? raw.category ?? raw.category_path ?? ''
  const commissionRate = raw.commission_rate ?? raw.affiliate_commission ?? null

  return normalizeProductInput(
    {
      productId,
      region,
      title,
      coverUrl,
      currency: pickScalar(raw.currency) || pickScalar(raw.price?.currency) || pickScalar(raw.price?.currency_symbol) || currencyForRegion(region),
      priceMin: priceRaw,
      priceMax: priceMaxRaw,
      totalSales: salesTotal,
      sales7d,
      sales28d,
      periodSales: sales7d ?? salesTotal,
      gmv7d: raw.gmv_7d ?? raw.period_gmv ?? null,
      totalGmv: raw.total_gmv ?? null,
      commissionRate,
      creatorsCount: raw.creators_count ?? raw.affiliate_count ?? null,
      videosCount: raw.videos_count ?? null,
      rating,
      reviewCount,
      shopName,
      shopId,
      category,
      rank: raw.rank ?? idx + 1,
      tiktokUrl: raw.url ?? raw.product_url ?? '',
      channelMetrics: raw.channelMetrics ?? raw,
      source,
      sourceDetail,
    },
    { region, source, sourceDetail }
  )
}

function normalizeHubVideos(res) {
  const list =
    res?.video_list ||
    res?.videos ||
    res?.aweme_list ||
    res?.items ||
    res?.data?.video_list ||
    res?.data?.videos ||
    res?.data?.aweme_list ||
    res?.data?.items ||
    res?.data?.data?.video_list ||
    res?.data?.data?.aweme_list ||
    res?.data?.data?.videos ||
    res?.data?.data?.items ||
    res?.data?.data ||
    []
  if (!Array.isArray(list)) return []
  return list
    .filter((v) => v && typeof v === 'object')
    .map((v, i) => {
      const id = String(v.aweme_id ?? v.video_id ?? v.id ?? `vid_${i + 1}`)
      const author = v.author?.unique_id || v.author?.nickname || v.creator_handle || v.author_name || ''
      const caption = String(v.desc ?? v.title ?? v.caption ?? '').trim()
      const playCount = Number(v.statistics?.play_count ?? v.stats?.play_count ?? v.play_count ?? v.views ?? 0) || 0
      const collectCount = Number(v.statistics?.collect_count ?? v.stats?.collect_count ?? v.collect_count ?? v.saves ?? 0) || 0
      const diggCount = Number(v.statistics?.digg_count ?? v.stats?.digg_count ?? v.digg_count ?? v.likes ?? 0) || 0
      const salesCount = Number(v.product_sales ?? v.sales ?? 0) || null
      const gmv = Number(v.product_gmv ?? v.gmv ?? 0) || null
      const url =
        v.share_url ||
        v.url ||
        (author ? `https://www.tiktok.com/@${encodeURIComponent(author)}/video/${encodeURIComponent(id)}` : `https://www.tiktok.com/video/${encodeURIComponent(id)}`)
      const rawTs = v.create_time
      let publishedAt = ''
      if (rawTs !== null && rawTs !== undefined && String(rawTs).trim() !== '') {
        const tsNum = Number(rawTs)
        publishedAt =
          Number.isFinite(tsNum) && tsNum > 0
            ? new Date(tsNum * (tsNum > 1e12 ? 1 : 1000)).toISOString()
            : String(rawTs).trim()
      } else {
        publishedAt = String(v.publishedAt || '')
      }
      return {
        videoId: id,
        author,
        caption: caption || `TikTok 参考视频 #${i + 1}`,
        playCount,
        likeCount: diggCount,
        collectCount,
        salesCount,
        gmv,
        publishedAt,
        url,
      }
    })
    .slice(0, 10)
}

function sortProducts(list, sortField = 'periodSales', sortDir = 'desc') {
  const mult = sortDir === 'asc' ? 1 : -1
  const valOf = (item) => {
    const v = item[sortField]
    if (v === null || v === undefined) return -Infinity
    return Number(v)
  }
  return [...list].sort((a, b) => (valOf(a) - valOf(b)) * mult)
}

function applyProductFilters(list, filter = {}) {
  let out = [...list]
  if (filter.keyword) {
    const q = String(filter.keyword).trim().toLowerCase()
    out = out.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q) ||
        (p.shopName || '').toLowerCase().includes(q)
    )
  }
  if (filter.category) {
    const q = String(filter.category).trim().toLowerCase()
    out = out.filter((p) => (p.category || '').toLowerCase().includes(q))
  }
  const rangeCheck = (val, min, max) => {
    if (min !== null && min !== undefined && min !== '' && (val === null || val < Number(min))) return false
    if (max !== null && max !== undefined && max !== '' && (val === null || val > Number(max))) return false
    return true
  }
  out = out.filter((p) => {
    const salesMetric = p.sales7d ?? p.periodSales ?? p.totalSales
    if (!rangeCheck(salesMetric, filter.salesMin, filter.salesMax)) return false
    if (!rangeCheck(p.commissionRate, filter.commissionMin, filter.commissionMax)) return false
    if (!rangeCheck(p.creatorsCount, filter.creatorsMin, filter.creatorsMax)) return false
    if (filter.shopType && filter.shopType !== 'all') {
      const st = (p.shopType || '').toLowerCase()
      if (filter.shopType === 'cross_border' && !st.includes('跨境') && !st.includes('cross')) return false
      if (filter.shopType === 'local' && !st.includes('本土') && !st.includes('local')) return false
    }
    if (Array.isArray(filter.tags) && filter.tags.length > 0) {
      for (const tag of filter.tags) {
        if (tag === 'free_shipping' && p.freeShipping === false) return false
        if (tag === 'fully_managed' && p.fullyManaged === false) return false
        if (!['free_shipping', 'fully_managed'].includes(tag) && Array.isArray(p.tags) && p.tags.length > 0 && !p.tags.includes(tag)) {
          return false
        }
      }
    }
    return true
  })
  return out
}

/**
 * Create the dual-mode DataSource adapter (Hub live socialData + imported CSV/JSON snapshots).
 */
export function createDataSourceAdapter({ store, getService, logger }) {
  function attachLibraryFlags(items) {
    const inLib = store.getLibraryKeySet()
    return items.map((item) => ({
      ...item,
      inLibrary: inLib.has(normalizeProductKey(item.productId, item.region)),
    }))
  }

  function resolveSnapshot(snapshotId) {
    if (snapshotId) {
      const found = store.getSnapshot(snapshotId)
      if (!found) throw new SelectionError('not-found', `Snapshot ${snapshotId} not found`)
      return found
    }
    return null
  }

  async function queryRank(params = {}) {
    const region = String(params.region || 'US').trim().toUpperCase()
    const granularity = String(params.granularity || 'daily')
    const period = String(params.period || new Date(Date.now() - 86400000).toISOString().slice(0, 10))
    const category = String(params.category || '').trim()
    const sortField = String(params.sortField || 'periodSales')
    const sortDir = params.sortDir === 'asc' ? 'asc' : 'desc'
    const page = Math.max(1, Number.parseInt(String(params.page || '1'), 10) || 1)
    const pageSize = Math.min(50, Math.max(1, Number.parseInt(String(params.pageSize || OPERATIONAL_LIMITS.pageSize), 10) || OPERATIONAL_LIMITS.pageSize))

    const snap = resolveSnapshot(params.snapshotId)
    if (snap) {
      const filtered = applyProductFilters(snap.items, { category })
      const sorted = sortProducts(filtered, sortField, sortDir)
      const slice = sorted.slice((page - 1) * pageSize, page * pageSize).map((item, i) => ({
        ...item,
        rank: (page - 1) * pageSize + i + 1,
        rankPeriod: `${granularity} ${period}`,
      }))
      return {
        source: 'snapshot',
        snapshotId: snap.id,
        snapshotName: snap.name,
        region,
        granularity,
        period,
        page,
        pageSize,
        total: sorted.length,
        totalPages: Math.max(1, Math.ceil(sorted.length / pageSize)),
        unavailableFields: [],
        items: attachLibraryFlags(slice),
      }
    }

    const socialData = getService?.('socialData')
    if (!socialData || typeof socialData.fetch !== 'function') {
      throw new SelectionError(
        'needs-provider',
        'Hub socialData seam is not mounted (needs-hub). Sign in to OmniMux or import a CSV/JSON product snapshot.'
      )
    }

    const queryKeyword = category || 'trending best seller'
    let rawRes
    try {
      rawRes = await socialData.fetch({
        platform: 'tiktok',
        capability: 'shop_search_v2',
        query: queryKeyword,
        region,
      })
    } catch (err) {
      logger?.warn?.('omnimux-tiktok-selection: rank query failed', { error: err?.message })
      const code = err?.code === 'needs-omnimux' ? 'needs-omnimux' : 'upstream-failed'
      throw new SelectionError(code, err?.message || 'TikTok Shop rank query failed')
    }

    const rawList = extractItemsFromHubResponse(rawRes)
    const sourceDetail = `${region} ${granularity} ${period} ${category || '全部类目'}`
    const normalized = rawList
      .map((item, idx) => normalizeHubShopItem(item, idx, region, 'rank', sourceDetail))
      .filter(Boolean)
    const sorted = sortProducts(normalized, sortField, sortDir)
    const slice = sorted.slice((page - 1) * pageSize, page * pageSize)

    return {
      source: 'omnimux_social_data',
      region,
      granularity,
      period,
      page,
      pageSize,
      total: sorted.length,
      totalPages: Math.max(1, Math.ceil(sorted.length / pageSize)),
      unavailableFields: ['sales28d', 'commissionRate', 'channelMetrics'],
      items: attachLibraryFlags(slice),
    }
  }

  async function searchProducts(params = {}) {
    const region = String(params.region || 'US').trim().toUpperCase()
    const keyword = String(params.keyword || '').trim()
    const category = String(params.category || '').trim()
    const sortField = String(params.sortField || 'sales7d')
    const sortDir = params.sortDir === 'asc' ? 'asc' : 'desc'
    const page = Math.max(1, Number.parseInt(String(params.page || '1'), 10) || 1)
    const pageSize = Math.min(50, Math.max(1, Number.parseInt(String(params.pageSize || OPERATIONAL_LIMITS.pageSize), 10) || OPERATIONAL_LIMITS.pageSize))

    const snap = resolveSnapshot(params.snapshotId)
    if (snap) {
      const filtered = applyProductFilters(snap.items, { ...params, keyword, category })
      const sorted = sortProducts(filtered, sortField, sortDir)
      const slice = sorted.slice((page - 1) * pageSize, page * pageSize)
      return {
        source: 'snapshot',
        snapshotId: snap.id,
        snapshotName: snap.name,
        region,
        keyword,
        page,
        pageSize,
        total: sorted.length,
        totalPages: Math.max(1, Math.ceil(sorted.length / pageSize)),
        items: attachLibraryFlags(slice),
      }
    }

    if (!keyword && !category) {
      throw new SelectionError('invalid-request', 'keyword, category, or snapshotId is required to search products')
    }
    const socialData = getService?.('socialData')
    if (!socialData || typeof socialData.fetch !== 'function') {
      throw new SelectionError(
        'needs-provider',
        'Hub socialData seam is not mounted (needs-hub). Sign in to OmniMux or import a CSV/JSON product snapshot.'
      )
    }

    let rawRes
    try {
      rawRes = await socialData.fetch({
        platform: 'tiktok',
        capability: 'shop_search_v2',
        query: keyword || category,
        region,
      })
    } catch (err) {
      logger?.warn?.('omnimux-tiktok-selection: search query failed', { error: err?.message })
      const code = err?.code === 'needs-omnimux' ? 'needs-omnimux' : 'upstream-failed'
      throw new SelectionError(code, err?.message || 'TikTok Shop search failed')
    }

    const rawList = extractItemsFromHubResponse(rawRes)
    const sourceDetail = `${region} 关键词 ${keyword || category}`
    const normalized = rawList
      .map((item, idx) => normalizeHubShopItem(item, idx, region, 'search', sourceDetail))
      .filter(Boolean)
    const filtered = applyProductFilters(normalized, { ...params, keyword: '', category })
    const sorted = sortProducts(filtered, sortField, sortDir)
    const slice = sorted.slice((page - 1) * pageSize, page * pageSize)

    return {
      source: 'omnimux_social_data',
      region,
      keyword,
      page,
      pageSize,
      total: sorted.length,
      totalPages: Math.max(1, Math.ceil(sorted.length / pageSize)),
      items: attachLibraryFlags(slice),
    }
  }

  async function getProductDetail({ productId, region = 'US', loadVideos = false, loadReviews = false, productHint = null }) {
    const pid = String(productId || '').trim()
    if (!pid) throw new SelectionError('invalid-request', 'productId is required')
    const reg = String(region || 'US').trim().toUpperCase()

    const localItem = store.getLibraryItem(pid)
    let product = localItem || (productHint ? normalizeProductInput({ ...productHint, productId: pid, region: reg }) : null)

    const socialData = getService?.('socialData')
    let detailWarning = ''
    if (socialData && typeof socialData.fetch === 'function') {
      try {
        const res = await socialData.fetch({
          platform: 'tiktok',
          capability: 'shop_product',
          id: pid,
          region: reg,
        })
        const rawObj = extractHubProductDetail(res)
        if (rawObj && typeof rawObj === 'object' && (rawObj.title || rawObj.product_name || rawObj.name)) {
          const liveNormalized = normalizeHubShopItem(rawObj, 0, reg, product?.source || 'detail', product?.sourceDetail || '')
          if (liveNormalized) {
            product = product
              ? {
                  ...liveNormalized,
                  ...product,
                  priceMin: liveNormalized.priceMin ?? product.priceMin,
                  priceMax: liveNormalized.priceMax ?? product.priceMax,
                  currency: liveNormalized.priceMin !== null ? liveNormalized.currency : product.currency,
                  priceDisplay: liveNormalized.priceMin !== null ? liveNormalized.priceDisplay : product.priceDisplay,
                  shopName: liveNormalized.shopName || product.shopName,
                  shopId: liveNormalized.shopId || product.shopId,
                  category: product.category || liveNormalized.category,
                  rating: liveNormalized.rating ?? product.rating,
                  reviewCount: liveNormalized.reviewCount ?? product.reviewCount,
                  totalSales: liveNormalized.totalSales ?? product.totalSales,
                  coverUrl: product.coverUrl || liveNormalized.coverUrl,
                }
              : liveNormalized
          }
        }
      } catch (err) {
        detailWarning = err?.message || 'Live product detail unavailable'
        logger?.warn?.('omnimux-tiktok-selection: detail lookup fallback to local', { productId: pid, error: detailWarning })
      }
    }

    if (!product) {
      throw new SelectionError('not-found', `Product ${pid} not found locally or via Hub socialData`)
    }

    let referenceVideos = Array.isArray(product.referenceVideos) ? product.referenceVideos : []
    let videosWarning = ''
    if (loadVideos) {
      if (socialData && typeof socialData.fetch === 'function') {
        try {
          const searchTerms = product.title.split(/\s+/).slice(0, 5).join(' ')
          const vRes = await socialData.fetch({
            platform: 'tiktok',
            capability: 'creator_search_videos',
            query: searchTerms,
            region: reg,
          })
          const parsed = normalizeHubVideos(vRes)
          if (parsed.length > 0) {
            referenceVideos = parsed
            if (localItem) {
              store.updateLibraryItem(localItem.id, { referenceVideos })
            }
          }
        } catch (err) {
          videosWarning = err?.message || 'Failed to load TikTok reference videos'
          logger?.warn?.('omnimux-tiktok-selection: reference video lookup failed', { productId: pid, error: videosWarning })
        }
      } else {
        videosWarning = 'Hub socialData 未挂载，无法在线拉取带货视频'
      }
    }

    let reviews = []
    let reviewsWarning = ''
    if (loadReviews) {
      if (socialData && typeof socialData.fetch === 'function') {
        try {
          const rRes = await socialData.fetch({
            platform: 'tiktok',
            capability: 'shop_reviews_v2',
            id: pid,
            region: reg,
          })
          reviews = normalizeHubReviews(rRes)
        } catch (err) {
          reviewsWarning = err?.message || 'Failed to load product reviews'
          logger?.warn?.('omnimux-tiktok-selection: reviews lookup failed', { productId: pid, error: reviewsWarning })
        }
      } else {
        reviewsWarning = 'Hub socialData 未挂载，无法在线拉取商品评价'
      }
    }

    return {
      product: {
        ...product,
        accel: computeAcceleration(product.sales7d, product.sales28d),
        referenceVideos,
      },
      referenceVideos,
      reviews,
      warnings: [detailWarning, videosWarning, reviewsWarning].filter(Boolean),
    }
  }

  async function enrichChannelMetrics(product) {
    if (product?.channelMetrics && product.channelMetrics.productCardRatio !== null) {
      return { ok: true, metrics: product.channelMetrics, source: product.channelMetrics.source || 'snapshot' }
    }
    const channelAdapter = getService?.('tiktokChannelMetrics')
    if (channelAdapter && typeof channelAdapter.fetch === 'function') {
      try {
        const res = await channelAdapter.fetch({ productId: product.productId, region: product.region })
        if (res && typeof res === 'object') {
          return { ok: true, metrics: res, source: 'provider_seam' }
        }
      } catch (err) {
        logger?.warn?.('omnimux-tiktok-selection: channel metrics seam failed', { productId: product.productId, error: err?.message })
        return { ok: false, code: 'upstream-failed', message: err?.message || 'Channel metrics fetch failed' }
      }
    }
    return {
      ok: false,
      code: 'channel-source-unavailable',
      message: '当前实时数据源未返回 30 天渠道 GMV 拆分；请导入含「商品卡占比 / 视频占比」列的 CSV/JSON 快照或配置渠道数据接缝。',
    }
  }

  function importSnapshot(payload) {
    const parsed = parseSnapshotPayload(payload)
    const saved = store.saveSnapshot({
      name: payload.name,
      format: parsed.format,
      region: payload.region || parsed.items[0]?.region || 'US',
      sourceLabel: payload.sourceLabel || 'external_import',
      items: parsed.items,
    })
    return {
      snapshot: {
        id: saved.id,
        name: saved.name,
        format: saved.format,
        region: saved.region,
        itemCount: saved.itemCount,
        createdAt: saved.createdAt,
      },
      preview: attachLibraryFlags(saved.items.slice(0, 10)),
    }
  }

  function getCapabilities() {
    return {
      categories: TIKTOK_CATEGORIES,
      hasSocialDataSeam: typeof getService?.('socialData')?.fetch === 'function',
      hasChannelMetricsSeam: typeof getService?.('tiktokChannelMetrics')?.fetch === 'function',
      hasHeadlessSkillSeam: typeof getService?.('headlessSkill')?.run === 'function',
      hasImageGenerateSeam: typeof getService?.('imageGenerate')?.execute === 'function',
      hasVideoGenerateSeam: typeof getService?.('videoGenerate')?.execute === 'function',
      snapshotsCount: store.listSnapshots().length,
    }
  }

  return {
    queryRank,
    searchProducts,
    getProductDetail,
    enrichChannelMetrics,
    importSnapshot,
    getCapabilities,
  }
}
