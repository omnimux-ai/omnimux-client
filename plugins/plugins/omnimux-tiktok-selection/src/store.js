import { randomBytes } from 'node:crypto'
import {
  ASSET_STATUSES,
  DEFAULT_SETTINGS,
  OPERATIONAL_LIMITS,
  RISK_WORD_TYPES,
  SELECTION_STATUSES,
  computeAcceleration,
  currencyForRegion,
} from './constants.js'
import { SelectionError } from './errors.js'
import { ensureDir, readJsonFile, resolveSelectionPaths, writeJsonAtomic } from './paths.js'

function nowIso() {
  return new Date().toISOString()
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`
}

function makeTaskCode(existingCount) {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const seq = String(existingCount + 1).padStart(3, '0')
  return `OMSEL-${y}${m}${day}-${seq}`
}

function toNumOrNull(val) {
  if (val === null || val === undefined || val === '') return null
  const cleaned = typeof val === 'string' ? val.replace(/[,$%£€¥\s]/g, '') : val
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function clampInt(val, min, max, fallback) {
  const n = Number.parseInt(String(val ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function normalizeProductKey(productId, region = 'US') {
  return `${String(region || 'US').trim().toUpperCase()}::${String(productId || '').trim()}`
}

export function normalizeProductInput(raw = {}, defaults = {}) {
  const productId = String(raw.productId ?? raw.product_id ?? raw.id ?? '').trim()
  if (!productId) {
    throw new SelectionError('invalid-request', 'productId is required')
  }
  const region = String(raw.region || defaults.region || 'US').trim().toUpperCase()
  const title = String(raw.title || raw.name || '').trim()
  if (!title) {
    throw new SelectionError('invalid-request', `title is required for product ${productId}`)
  }
  const priceMin = toNumOrNull(raw.priceMin ?? raw.price_min ?? raw.price)
  const priceMax = toNumOrNull(raw.priceMax ?? raw.price_max ?? priceMin)
  const sales7d = toNumOrNull(raw.sales7d ?? raw.sales_7d ?? raw.periodSales)
  const sales28d = toNumOrNull(raw.sales28d ?? raw.sales_28d)
  const accel = computeAcceleration(sales7d, sales28d)

  return {
    productId,
    region,
    title,
    coverUrl: String(raw.coverUrl ?? raw.cover_url ?? raw.imageUrl ?? raw.image ?? '').trim(),
    currency: String(raw.currency || currencyForRegion(region)),
    priceMin,
    priceMax,
    priceDisplay: String(raw.priceDisplay || '').trim() || formatPriceRange(priceMin, priceMax, raw.currency || currencyForRegion(region)),
    commissionRate: toNumOrNull(raw.commissionRate ?? raw.commission_rate),
    periodSales: toNumOrNull(raw.periodSales ?? raw.period_sales ?? sales7d),
    periodGmv: toNumOrNull(raw.periodGmv ?? raw.period_gmv ?? raw.gmv7d),
    growthRate: toNumOrNull(raw.growthRate ?? raw.growth_rate),
    totalSales: toNumOrNull(raw.totalSales ?? raw.total_sales),
    sales7d,
    sales28d,
    sales90d: toNumOrNull(raw.sales90d ?? raw.sales_90d),
    gmv7d: toNumOrNull(raw.gmv7d ?? raw.gmv_7d),
    gmv28d: toNumOrNull(raw.gmv28d ?? raw.gmv_28d),
    totalGmv: toNumOrNull(raw.totalGmv ?? raw.total_gmv),
    creatorsCount: toNumOrNull(raw.creatorsCount ?? raw.creators_count),
    videosCount: toNumOrNull(raw.videosCount ?? raw.videos_count),
    liveCount: toNumOrNull(raw.liveCount ?? raw.live_count),
    rating: toNumOrNull(raw.rating),
    reviewCount: toNumOrNull(raw.reviewCount ?? raw.review_count),
    skuCount: toNumOrNull(raw.skuCount ?? raw.sku_count),
    listedDate: String(raw.listedDate ?? raw.listed_date ?? '').trim(),
    listedDays: toNumOrNull(raw.listedDays ?? raw.listed_days),
    shopId: String(raw.shopId ?? raw.shop_id ?? '').trim(),
    shopName: String(raw.shopName ?? raw.shop_name ?? '').trim(),
    shopTotalSales: toNumOrNull(raw.shopTotalSales ?? raw.shop_total_sales),
    shopType: String(raw.shopType ?? raw.shop_type ?? '').trim(),
    category: String(raw.category ?? '').trim(),
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    freeShipping: typeof raw.freeShipping === 'boolean' ? raw.freeShipping : null,
    fullyManaged: typeof raw.fullyManaged === 'boolean' ? raw.fullyManaged : null,
    isDelisted: Boolean(raw.isDelisted),
    rank: toNumOrNull(raw.rank),
    accelRatio: toNumOrNull(raw.accelRatio) ?? accel.ratio,
    accelLabel: String(raw.accelLabel || accel.label),
    tiktokUrl:
      String(raw.tiktokUrl ?? raw.tiktok_url ?? '').trim() ||
      `https://shop.tiktok.com/view/product/${encodeURIComponent(productId)}?region=${encodeURIComponent(region)}`,
    channelMetrics: normalizeChannelMetrics(raw.channelMetrics ?? raw),
    source: String(raw.source || defaults.source || 'manual'),
    rankPeriod: String(raw.rankPeriod || defaults.rankPeriod || ''),
    sourceDetail: String(raw.sourceDetail || defaults.sourceDetail || ''),
    sourceTaskId: String(raw.sourceTaskId || defaults.sourceTaskId || ''),
    referenceVideos: Array.isArray(raw.referenceVideos) ? raw.referenceVideos : [],
  }
}

export function normalizeChannelMetrics(raw = {}) {
  const productCardRatio = toNumOrNull(raw.productCardRatio ?? raw.product_card_ratio ?? raw.cardRatio)
  const videoRatio = toNumOrNull(raw.videoRatio ?? raw.video_ratio)
  const liveRatio = toNumOrNull(raw.liveRatio ?? raw.live_ratio)
  const creatorRatio = toNumOrNull(raw.creatorRatio ?? raw.creator_ratio)
  const shopAccountRatio = toNumOrNull(raw.shopAccountRatio ?? raw.shop_account_ratio)
  const gmv30d = toNumOrNull(raw.gmv30d ?? raw.channelGmv30d ?? raw.gmv_30d)
  const videoGmv30d = toNumOrNull(raw.videoGmv30d ?? raw.video_gmv_30d)
  const liveGmv30d = toNumOrNull(raw.liveGmv30d ?? raw.live_gmv_30d)
  const cardGmv30d = toNumOrNull(raw.cardGmv30d ?? raw.card_gmv_30d)
  const updatedAt = String(raw.channelUpdatedAt ?? raw.updatedAt ?? '').trim()
  const hasAny = [
    productCardRatio,
    videoRatio,
    liveRatio,
    creatorRatio,
    shopAccountRatio,
    gmv30d,
  ].some((v) => v !== null)
  if (!hasAny) return null
  return {
    productCardRatio,
    videoRatio,
    liveRatio,
    creatorRatio,
    shopAccountRatio,
    gmv30d,
    videoGmv30d,
    liveGmv30d,
    cardGmv30d,
    source: String(raw.channelSource || raw.source || 'imported'),
    updatedAt: updatedAt || nowIso(),
  }
}

export function formatPriceRange(min, max, currency = '$') {
  if (min === null && max === null) return '—'
  if (min !== null && (max === null || min === max)) return `${currency}${min}`
  return `${currency}${min ?? 0} - ${currency}${max ?? min ?? 0}`
}

export function computeAssetStatus(record) {
  const images = Array.isArray(record.generatedImages) ? record.generatedImages : []
  const videos = Array.isArray(record.generatedVideos) ? record.generatedVideos : []
  const all = [...images, ...videos]
  if (all.some((a) => a.status === 'generating' || a.status === 'queued')) return 'generating'
  const readyCount = all.filter((a) => a.status === 'ready').length
  const failedCount = all.filter((a) => a.status === 'failed').length
  if (readyCount > 0 && failedCount > 0) return 'partial'
  if (readyCount > 0) return 'ready'
  if (failedCount > 0) return 'failed'
  if (record.videoScript && String(record.videoScript.videoPromptEn || record.videoScript.hook || '').trim()) {
    return 'script_ready'
  }
  return 'none'
}

/**
 * Create the local atomic JSON store for `omnimux-tiktok-selection`.
 * @param {{ home?: string, rootDir?: string }} [opts]
 */
export function createSelectionStore(opts = {}) {
  const paths = resolveSelectionPaths(opts)
  ensureDir(paths.rootDir)
  ensureDir(paths.assetsDir)

  let rev = 1
  const bump = () => {
    rev += 1
    return rev
  }

  function readLibrary() {
    const data = readJsonFile(paths.libraryFile, { items: [] })
    return Array.isArray(data.items) ? data.items : []
  }
  function saveLibrary(items) {
    writeJsonAtomic(paths.libraryFile, { version: 1, updatedAt: nowIso(), items })
    bump()
  }

  function readTasks() {
    const data = readJsonFile(paths.tasksFile, { items: [] })
    return Array.isArray(data.items) ? data.items : []
  }
  function saveTasks(items) {
    writeJsonAtomic(paths.tasksFile, { version: 1, updatedAt: nowIso(), items })
    bump()
  }

  function readGateItems() {
    const data = readJsonFile(paths.gateItemsFile, { items: [] })
    return Array.isArray(data.items) ? data.items : []
  }
  function saveGateItems(items) {
    writeJsonAtomic(paths.gateItemsFile, { version: 1, updatedAt: nowIso(), items })
    bump()
  }

  function readRiskWords() {
    const data = readJsonFile(paths.riskWordsFile, { items: [] })
    return Array.isArray(data.items) ? data.items : []
  }
  function saveRiskWords(items) {
    writeJsonAtomic(paths.riskWordsFile, { version: 1, updatedAt: nowIso(), items })
    bump()
  }

  function readSchedules() {
    const data = readJsonFile(paths.schedulesFile, { items: [] })
    return Array.isArray(data.items) ? data.items : []
  }
  function saveSchedules(items) {
    writeJsonAtomic(paths.schedulesFile, { version: 1, updatedAt: nowIso(), items })
    bump()
  }

  function readRuns() {
    const data = readJsonFile(paths.runsFile, { items: [] })
    return Array.isArray(data.items) ? data.items : []
  }
  function saveRuns(items) {
    writeJsonAtomic(paths.runsFile, { version: 1, updatedAt: nowIso(), items })
    bump()
  }

  function readSnapshots() {
    const data = readJsonFile(paths.snapshotsFile, { items: [] })
    return Array.isArray(data.items) ? data.items : []
  }
  function saveSnapshots(items) {
    writeJsonAtomic(paths.snapshotsFile, { version: 1, updatedAt: nowIso(), items })
    bump()
  }

  function getSettings() {
    const saved = readJsonFile(paths.settingsFile, {})
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      concurrency: clampInt(saved.concurrency, OPERATIONAL_LIMITS.minConcurrency, OPERATIONAL_LIMITS.maxConcurrency, DEFAULT_SETTINGS.concurrency),
      dailyAssetCap: clampInt(saved.dailyAssetCap, 1, 50000, DEFAULT_SETTINGS.dailyAssetCap),
      excludedCategories: Array.isArray(saved.excludedCategories)
        ? saved.excludedCategories.map((c) => String(c).trim()).filter(Boolean)
        : [...DEFAULT_SETTINGS.excludedCategories],
    }
  }

  function updateSettings(patch = {}) {
    const current = getSettings()
    const next = { ...current }
    if (patch.concurrency !== undefined) {
      next.concurrency = clampInt(patch.concurrency, OPERATIONAL_LIMITS.minConcurrency, OPERATIONAL_LIMITS.maxConcurrency, current.concurrency)
    }
    if (patch.dailyAssetCap !== undefined) {
      next.dailyAssetCap = clampInt(patch.dailyAssetCap, 1, 50000, current.dailyAssetCap)
    }
    if (patch.excludedCategories !== undefined) {
      const list = Array.isArray(patch.excludedCategories)
        ? patch.excludedCategories
        : String(patch.excludedCategories).split(/[、,，\n]+/)
      next.excludedCategories = list.map((s) => String(s).trim()).filter(Boolean)
    }
    if (patch.defaultMissingMetricPolicy === 'skip_missing_metric' || patch.defaultMissingMetricPolicy === 'fail_on_missing') {
      next.defaultMissingMetricPolicy = patch.defaultMissingMetricPolicy
    }
    if (typeof patch.defaultImagePrompt === 'string') {
      next.defaultImagePrompt = patch.defaultImagePrompt.trim() || DEFAULT_SETTINGS.defaultImagePrompt
    }
    if (typeof patch.defaultVideoPrompt === 'string') {
      next.defaultVideoPrompt = patch.defaultVideoPrompt.trim() || DEFAULT_SETTINGS.defaultVideoPrompt
    }
    if (patch.resetPrompts === true) {
      next.defaultImagePrompt = DEFAULT_SETTINGS.defaultImagePrompt
      next.defaultVideoPrompt = DEFAULT_SETTINGS.defaultVideoPrompt
      next.excludedCategories = [...DEFAULT_SETTINGS.excludedCategories]
    }
    writeJsonAtomic(paths.settingsFile, { ...next, updatedAt: nowIso() })
    bump()
    return next
  }

  // ---- Risk words matching ----
  function listRiskWords(filter = {}) {
    let items = readRiskWords()
    if (filter.type && RISK_WORD_TYPES.includes(filter.type)) {
      items = items.filter((w) => w.type === filter.type)
    }
    if (filter.enabled !== undefined && filter.enabled !== null && filter.enabled !== 'all') {
      const want = filter.enabled === true || filter.enabled === 'enabled'
      items = items.filter((w) => w.enabled === want)
    }
    if (filter.term) {
      const q = String(filter.term).trim().toLowerCase()
      items = items.filter((w) => w.term.toLowerCase().includes(q))
    }
    if (filter.zhName) {
      const q = String(filter.zhName).trim().toLowerCase()
      items = items.filter((w) => (w.zhName || '').toLowerCase().includes(q))
    }
    if (filter.source) {
      const q = String(filter.source).trim().toLowerCase()
      items = items.filter((w) => (w.source || '').toLowerCase().includes(q))
    }
    return items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  }

  function addRiskWord(input) {
    const type = input.type
    if (!RISK_WORD_TYPES.includes(type)) {
      throw new SelectionError('invalid-request', `risk word type must be brand or sensitive`)
    }
    const term = String(input.term || '').trim()
    if (!term) {
      throw new SelectionError('invalid-request', 'term is required')
    }
    const items = readRiskWords()
    const dup = items.find((w) => w.type === type && w.term.toLowerCase() === term.toLowerCase())
    if (dup) {
      throw new SelectionError('conflict', `Risk word "${term}" already exists in ${type} list`)
    }
    const record = {
      id: makeId('rw'),
      type,
      term,
      zhName: String(input.zhName || '').trim(),
      enabled: input.enabled !== false,
      source: String(input.source || '手动添加').trim() || '手动添加',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    items.unshift(record)
    saveRiskWords(items)
    return record
  }

  function updateRiskWord(id, patch = {}) {
    const items = readRiskWords()
    const idx = items.findIndex((w) => w.id === id)
    if (idx === -1) throw new SelectionError('not-found', `Risk word ${id} not found`)
    const cur = items[idx]
    const nextTerm = patch.term !== undefined ? String(patch.term).trim() : cur.term
    if (!nextTerm) throw new SelectionError('invalid-request', 'term cannot be empty')
    const updated = {
      ...cur,
      term: nextTerm,
      zhName: patch.zhName !== undefined ? String(patch.zhName).trim() : cur.zhName,
      enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : cur.enabled,
      source: patch.source !== undefined ? String(patch.source).trim() : cur.source,
      updatedAt: nowIso(),
    }
    items[idx] = updated
    saveRiskWords(items)
    return updated
  }

  function removeRiskWord(id) {
    const items = readRiskWords()
    const next = items.filter((w) => w.id !== id)
    if (next.length === items.length) {
      throw new SelectionError('not-found', `Risk word ${id} not found`)
    }
    saveRiskWords(next)
    return { removedId: id }
  }

  function matchRiskWords(product) {
    const enabledWords = readRiskWords().filter((w) => w.enabled)
    const haystackTitle = String(product.title || '').toLowerCase()
    const haystackShop = String(product.shopName || '').toLowerCase()
    const hits = []
    for (const w of enabledWords) {
      const needle = w.term.toLowerCase()
      if (!needle) continue
      const inTitle = haystackTitle.includes(needle)
      const inShop = haystackShop.includes(needle)
      if (inTitle || inShop) {
        hits.push({
          id: w.id,
          type: w.type,
          term: w.term,
          zhName: w.zhName,
          matchedIn: inTitle && inShop ? 'title+shop' : inTitle ? 'title' : 'shop',
        })
      }
    }
    return hits
  }

  // ---- Library CRUD & Filtering ----
  function getLibraryKeySet() {
    const items = readLibrary()
    return new Set(items.map((item) => normalizeProductKey(item.productId, item.region)))
  }

  function listLibrary(filter = {}) {
    let items = readLibrary()
    if (filter.assetsOnly) {
      items = items.filter((p) => {
        const st = computeAssetStatus(p)
        return st !== 'none'
      })
    }
    if (filter.query) {
      const q = String(filter.query).trim().toLowerCase()
      items = items.filter((p) =>
        p.title.toLowerCase().includes(q) ||
        p.productId.toLowerCase().includes(q) ||
        (p.shopName || '').toLowerCase().includes(q)
      )
    }
    if (filter.productId) {
      const q = String(filter.productId).trim().toLowerCase()
      items = items.filter((p) => p.productId.toLowerCase().includes(q))
    }
    if (filter.region) {
      const r = String(filter.region).trim().toUpperCase()
      items = items.filter((p) => p.region === r)
    }
    if (filter.category) {
      const q = String(filter.category).trim().toLowerCase()
      items = items.filter((p) => (p.category || '').toLowerCase().includes(q))
    }
    if (filter.selectionStatus && filter.selectionStatus !== 'all') {
      items = items.filter((p) => p.selectionStatus === filter.selectionStatus)
    }
    if (filter.assetStatus && filter.assetStatus !== 'all') {
      items = items.filter((p) => computeAssetStatus(p) === filter.assetStatus)
    }
    if (filter.source && filter.source !== 'all') {
      items = items.filter((p) => p.source === filter.source)
    }
    if (filter.sourceTaskId) {
      const q = String(filter.sourceTaskId).trim().toLowerCase()
      items = items.filter((p) => (p.sourceTaskId || '').toLowerCase().includes(q))
    }
    if (filter.shopName) {
      const q = String(filter.shopName).trim().toLowerCase()
      items = items.filter((p) => (p.shopName || '').toLowerCase().includes(q))
    }
    const minComm = toNumOrNull(filter.commissionMin)
    const maxComm = toNumOrNull(filter.commissionMax)
    if (minComm !== null) items = items.filter((p) => (p.commissionRate ?? -1) >= minComm)
    if (maxComm !== null) items = items.filter((p) => p.commissionRate !== null && p.commissionRate <= maxComm)

    const minSales7 = toNumOrNull(filter.sales7dMin)
    const maxSales7 = toNumOrNull(filter.sales7dMax)
    if (minSales7 !== null) items = items.filter((p) => (p.sales7d ?? -1) >= minSales7)
    if (maxSales7 !== null) items = items.filter((p) => p.sales7d !== null && p.sales7d <= maxSales7)

    const minCreators = toNumOrNull(filter.creatorsMin)
    const maxCreators = toNumOrNull(filter.creatorsMax)
    if (minCreators !== null) items = items.filter((p) => (p.creatorsCount ?? -1) >= minCreators)
    if (maxCreators !== null) items = items.filter((p) => p.creatorsCount !== null && p.creatorsCount <= maxCreators)

    const minPrice = toNumOrNull(filter.priceMin)
    const maxPrice = toNumOrNull(filter.priceMax)
    if (minPrice !== null) items = items.filter((p) => (p.priceMin ?? -1) >= minPrice)
    if (maxPrice !== null) items = items.filter((p) => p.priceMin !== null && p.priceMin <= maxPrice)

    const minRating = toNumOrNull(filter.ratingMin)
    if (minRating !== null) items = items.filter((p) => (p.rating ?? -1) >= minRating)

    items = items.map((p) => ({ ...p, assetStatus: computeAssetStatus(p) }))
    items.sort((a, b) => String(b.ingestedAt).localeCompare(String(a.ingestedAt)))
    return items
  }

  function getLibraryItem(idOrProductId) {
    const items = readLibrary()
    const found = items.find((p) => p.id === idOrProductId || p.productId === idOrProductId)
    return found ? { ...found, assetStatus: computeAssetStatus(found) } : null
  }

  function ingestProducts(rawProducts, opts = {}) {
    if (!Array.isArray(rawProducts) || rawProducts.length === 0) {
      throw new SelectionError('invalid-request', 'products array must be non-empty')
    }
    const checkRiskWords = opts.checkRiskWords !== false
    const items = readLibrary()
    const existingKeys = new Set(items.map((p) => normalizeProductKey(p.productId, p.region)))
    const added = []
    const duplicated = []
    const blocked = []

    for (const raw of rawProducts) {
      const normalized = normalizeProductInput(raw, {
        region: opts.region,
        source: opts.source || 'manual',
        rankPeriod: opts.rankPeriod || '',
        sourceDetail: opts.sourceDetail || '',
        sourceTaskId: opts.sourceTaskId || '',
      })
      const key = normalizeProductKey(normalized.productId, normalized.region)
      if (existingKeys.has(key)) {
        duplicated.push({ productId: normalized.productId, title: normalized.title, reason: 'already_in_library' })
        continue
      }
      if (checkRiskWords) {
        const hits = matchRiskWords(normalized)
        if (hits.length > 0) {
          blocked.push({
            productId: normalized.productId,
            title: normalized.title,
            hits,
            reason: `命中风险词：${hits.map((h) => h.term).join(' / ')}`,
          })
          continue
        }
      }
      const record = {
        id: makeId('sel'),
        ...normalized,
        selectionStatus: 'pending_review',
        reviewNotes: '',
        assetStatus: 'none',
        assetError: '',
        videoScript: null,
        generatedImages: [],
        generatedVideos: [],
        syncedProductId: '',
        ingestedAt: nowIso(),
        updatedAt: nowIso(),
      }
      items.unshift(record)
      existingKeys.add(key)
      added.push(record)
    }
    if (added.length > 0) {
      saveLibrary(items)
    }
    return {
      addedCount: added.length,
      duplicatedCount: duplicated.length,
      blockedCount: blocked.length,
      added,
      duplicated,
      blocked,
    }
  }

  function updateLibraryItem(id, patchFnOrObj) {
    const items = readLibrary()
    const idx = items.findIndex((p) => p.id === id || p.productId === id)
    if (idx === -1) throw new SelectionError('not-found', `Library product ${id} not found`)
    const cur = items[idx]
    const patch = typeof patchFnOrObj === 'function' ? patchFnOrObj(cur) : patchFnOrObj
    const updated = {
      ...cur,
      ...patch,
      id: cur.id,
      updatedAt: nowIso(),
    }
    updated.assetStatus = computeAssetStatus(updated)
    items[idx] = updated
    saveLibrary(items)
    return updated
  }

  function batchUpdateStatus(ids, selectionStatus, reviewNotes) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new SelectionError('invalid-request', 'ids array is required')
    }
    if (!SELECTION_STATUSES.includes(selectionStatus)) {
      throw new SelectionError('invalid-request', `invalid selectionStatus: ${selectionStatus}`)
    }
    const idSet = new Set(ids.map((x) => String(x)))
    const items = readLibrary()
    let updatedCount = 0
    for (let i = 0; i < items.length; i += 1) {
      if (idSet.has(items[i].id) || idSet.has(items[i].productId)) {
        items[i] = {
          ...items[i],
          selectionStatus,
          ...(reviewNotes !== undefined && String(reviewNotes).trim() !== '' ? { reviewNotes: String(reviewNotes).trim() } : {}),
          updatedAt: nowIso(),
        }
        updatedCount += 1
      }
    }
    if (updatedCount > 0) saveLibrary(items)
    return { updatedCount, selectionStatus }
  }

  function removeLibraryItems(ids) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new SelectionError('invalid-request', 'ids array is required')
    }
    const idSet = new Set(ids.map((x) => String(x)))
    const items = readLibrary()
    const next = items.filter((p) => !idSet.has(p.id) && !idSet.has(p.productId))
    const removedCount = items.length - next.length
    if (removedCount > 0) saveLibrary(next)
    return { removedCount }
  }

  // ---- Selection Tasks & Gate Items ----
  function createTask(criteria, estimate = {}) {
    const tasks = readTasks()
    const taskId = makeTaskCode(tasks.length)
    const now = nowIso()
    const task = {
      id: taskId,
      status: 'queued',
      stage: 'init',
      trigger: criteria.trigger || 'manual',
      ruleVersion: 'om-gate-1',
      criteria,
      estimate,
      metrics: {
        matchedTotal: estimate.matchedTotal ?? 0,
        fetchedPages: 0,
        rounds: 0,
        ingestedCount: 0,
        g1: { input: 0, pass: 0, fail: 0, incomplete: 0 },
        g2: { input: 0, pass: 0, fail: 0, incomplete: 0 },
        g3: { input: 0, pass: 0, fail: 0, incomplete: 0 },
      },
      logs: [],
      startedAt: now,
      lastActivityAt: now,
      finishedAt: '',
    }
    tasks.unshift(task)
    saveTasks(tasks)
    return task
  }

  function updateTask(taskId, mutator) {
    const tasks = readTasks()
    const idx = tasks.findIndex((t) => t.id === taskId)
    if (idx === -1) throw new SelectionError('not-found', `Task ${taskId} not found`)
    const next = mutator({ ...tasks[idx] })
    next.lastActivityAt = nowIso()
    if (Array.isArray(next.logs) && next.logs.length > OPERATIONAL_LIMITS.maxLogEntries) {
      next.logs = next.logs.slice(-OPERATIONAL_LIMITS.maxLogEntries)
    }
    tasks[idx] = next
    saveTasks(tasks)
    return next
  }

  function appendTaskLog(taskId, stage, message) {
    const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    return updateTask(taskId, (t) => ({
      ...t,
      logs: [...(t.logs || []), `[${stamp}] ${stage} ${message}`],
    }))
  }

  function listTasks(filter = {}) {
    let tasks = readTasks()
    if (filter.taskId) {
      const q = String(filter.taskId).trim().toLowerCase()
      tasks = tasks.filter((t) => t.id.toLowerCase().includes(q))
    }
    if (filter.status && filter.status !== 'all') {
      tasks = tasks.filter((t) => t.status === filter.status)
    }
    if (filter.source && filter.source !== 'all') {
      tasks = tasks.filter((t) => t.criteria?.source === filter.source)
    }
    if (filter.region && filter.region !== 'all') {
      const r = String(filter.region).trim().toUpperCase()
      tasks = tasks.filter((t) => t.criteria?.region === r)
    }
    return tasks
  }

  function getTask(taskId) {
    const task = readTasks().find((t) => t.id === taskId)
    if (!task) return null
    const items = readGateItems().filter((g) => g.taskId === taskId)
    return {
      ...task,
      gateItems: {
        g1: items.filter((g) => g.gate === 'g1'),
        g2: items.filter((g) => g.gate === 'g2'),
        g3: items.filter((g) => g.gate === 'g3'),
      },
    }
  }

  function saveGateItem(item) {
    const items = readGateItems()
    const idx = items.findIndex(
      (g) => g.taskId === item.taskId && g.gate === item.gate && g.productId === item.productId
    )
    const record = {
      id: idx >= 0 ? items[idx].id : makeId('gi'),
      ...item,
      updatedAt: nowIso(),
    }
    if (idx >= 0) items[idx] = record
    else items.push(record)
    saveGateItems(items)
    return record
  }

  function overrideGateItem(taskId, itemId, action) {
    const items = readGateItems()
    const idx = items.findIndex((g) => g.taskId === taskId && g.id === itemId)
    if (idx === -1) throw new SelectionError('not-found', `Gate item ${itemId} not found in task ${taskId}`)
    if (action === 'delete') {
      items.splice(idx, 1)
      saveGateItems(items)
      recomputeTaskGateCounters(taskId)
      return { action: 'delete', itemId }
    }
    if (action === 'ignore' || action === 'fail') {
      items[idx] = {
        ...items[idx],
        conclusion: 'fail',
        reasonCode: 'MANUAL_IGNORED',
        shortReason: '人工忽略',
        detailReason: '用户手动将此记录标记为不通过',
        updatedAt: nowIso(),
      }
      saveGateItems(items)
      recomputeTaskGateCounters(taskId)
      return { action: 'ignore', item: items[idx] }
    }
    if (action === 'force_pass') {
      items[idx] = {
        ...items[idx],
        conclusion: 'pass',
        reasonCode: 'MANUAL_APPROVED',
        shortReason: '人工放行',
        detailReason: '用户手动覆写该闸口结论为通过',
        updatedAt: nowIso(),
      }
      saveGateItems(items)
      recomputeTaskGateCounters(taskId)
      return { action: 'force_pass', item: items[idx] }
    }
    throw new SelectionError('invalid-request', `Unsupported row action: ${action}`)
  }

  function recomputeTaskGateCounters(taskId) {
    const all = readGateItems().filter((g) => g.taskId === taskId)
    const countGate = (gate) => {
      const sub = all.filter((g) => g.gate === gate)
      return {
        input: sub.length,
        pass: sub.filter((x) => x.conclusion === 'pass').length,
        fail: sub.filter((x) => x.conclusion === 'fail').length,
        incomplete: sub.filter((x) => x.conclusion === 'incomplete').length,
      }
    }
    return updateTask(taskId, (t) => ({
      ...t,
      metrics: {
        ...t.metrics,
        g1: countGate('g1'),
        g2: countGate('g2'),
        g3: countGate('g3'),
      },
    }))
  }

  // ---- Snapshots (CSV/JSON external imports) ----
  function saveSnapshot(snapshot) {
    const list = readSnapshots()
    const record = {
      id: makeId('snap'),
      name: String(snapshot.name || `导入快照 ${new Date().toLocaleDateString('zh-CN')}`).trim(),
      format: snapshot.format || 'json',
      region: String(snapshot.region || 'US').trim().toUpperCase(),
      sourceLabel: String(snapshot.sourceLabel || 'external_import'),
      itemCount: snapshot.items.length,
      items: snapshot.items,
      createdAt: nowIso(),
    }
    list.unshift(record)
    saveSnapshots(list.slice(0, 30))
    return record
  }

  function listSnapshots() {
    return readSnapshots().map(({ items, ...meta }) => meta)
  }

  function getSnapshot(id) {
    return readSnapshots().find((s) => s.id === id) || null
  }

  // ---- Schedules & Runs ----
  function listSchedules() {
    return readSchedules()
  }

  function getSchedule(id) {
    return readSchedules().find((s) => s.id === id) || null
  }

  function createSchedule(input) {
    const name = String(input.name || '').trim()
    if (!name) throw new SelectionError('invalid-request', 'schedule name is required')
    const list = readSchedules()
    const record = {
      id: makeId('sch'),
      name,
      enabled: input.enabled !== false,
      frequency: ['daily', 'weekly', 'hourly'].includes(input.frequency) ? input.frequency : 'daily',
      timeOfDay: String(input.timeOfDay || '09:00'),
      weekday: clampInt(input.weekday, 0, 6, 1),
      timezone: String(input.timezone || 'Asia/Shanghai'),
      source: ['rank', 'search', 'snapshot'].includes(input.source) ? input.source : 'rank',
      region: String(input.region || 'US').trim().toUpperCase(),
      granularity: ['daily', 'weekly', 'monthly'].includes(input.granularity) ? input.granularity : 'daily',
      category: String(input.category || '').trim(),
      keyword: String(input.keyword || '').trim(),
      snapshotId: String(input.snapshotId || '').trim(),
      sortField: String(input.sortField || 'sales7d'),
      maxPages: clampInt(input.maxPages, 1, OPERATIONAL_LIMITS.maxSchedulePages, 3),
      maxIngest: clampInt(input.maxIngest, 1, OPERATIONAL_LIMITS.maxScheduleIngest, 30),
      autoGenerateAssets: Boolean(input.autoGenerateAssets),
      useThreeGate: input.useThreeGate !== false,
      lastRunAt: '',
      lastRunStatus: '',
      totalRuns: 0,
      totalIngested: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    list.unshift(record)
    saveSchedules(list)
    return record
  }

  function updateSchedule(id, patch = {}) {
    const list = readSchedules()
    const idx = list.findIndex((s) => s.id === id)
    if (idx === -1) throw new SelectionError('not-found', `Schedule ${id} not found`)
    const cur = list[idx]
    const updated = {
      ...cur,
      ...patch,
      id: cur.id,
      maxPages: patch.maxPages !== undefined ? clampInt(patch.maxPages, 1, OPERATIONAL_LIMITS.maxSchedulePages, cur.maxPages) : cur.maxPages,
      maxIngest: patch.maxIngest !== undefined ? clampInt(patch.maxIngest, 1, OPERATIONAL_LIMITS.maxScheduleIngest, cur.maxIngest) : cur.maxIngest,
      updatedAt: nowIso(),
    }
    list[idx] = updated
    saveSchedules(list)
    return updated
  }

  function removeSchedule(id) {
    const list = readSchedules()
    const next = list.filter((s) => s.id !== id)
    if (next.length === list.length) throw new SelectionError('not-found', `Schedule ${id} not found`)
    saveSchedules(next)
    return { removedId: id }
  }

  function recordRun(run) {
    const list = readRuns()
    const record = {
      id: makeId('run'),
      scheduleId: String(run.scheduleId || ''),
      scheduleName: String(run.scheduleName || ''),
      status: String(run.status || 'completed'),
      trigger: String(run.trigger || 'manual'),
      sourceSummary: String(run.sourceSummary || ''),
      pulledCount: Number(run.pulledCount || 0),
      addedCount: Number(run.addedCount || 0),
      duplicatedCount: Number(run.duplicatedCount || 0),
      blockedCount: Number(run.blockedCount || 0),
      snapshotSaved: Boolean(run.snapshotSaved),
      taskId: String(run.taskId || ''),
      error: String(run.error || ''),
      startedAt: run.startedAt || nowIso(),
      finishedAt: run.finishedAt || nowIso(),
    }
    list.unshift(record)
    saveRuns(list.slice(0, 200))
    return record
  }

  function listRuns(filter = {}) {
    let list = readRuns()
    if (filter.scheduleId) {
      const q = String(filter.scheduleId).trim().toLowerCase()
      list = list.filter((r) => r.scheduleId.toLowerCase().includes(q))
    }
    if (filter.scheduleName) {
      const q = String(filter.scheduleName).trim().toLowerCase()
      list = list.filter((r) => r.scheduleName.toLowerCase().includes(q))
    }
    if (filter.status && filter.status !== 'all') {
      list = list.filter((r) => r.status === filter.status)
    }
    if (filter.trigger && filter.trigger !== 'all') {
      list = list.filter((r) => r.trigger === filter.trigger)
    }
    return list
  }

  function summaryStats() {
    const lib = readLibrary()
    const tasks = readTasks()
    const words = readRiskWords()
    const schedules = readSchedules()
    return {
      revision: rev,
      libraryTotal: lib.length,
      approvedCount: lib.filter((p) => p.selectionStatus === 'approved').length,
      pendingCount: lib.filter((p) => p.selectionStatus === 'pending_review').length,
      assetsReadyCount: lib.filter((p) => computeAssetStatus(p) === 'ready' || computeAssetStatus(p) === 'script_ready').length,
      tasksTotal: tasks.length,
      tasksRunning: tasks.filter((t) => ['queued', 'g1_running', 'g2_running', 'g3_running'].includes(t.status)).length,
      brandWordsCount: words.filter((w) => w.type === 'brand' && w.enabled).length,
      sensitiveWordsCount: words.filter((w) => w.type === 'sensitive' && w.enabled).length,
      activeSchedulesCount: schedules.filter((s) => s.enabled).length,
    }
  }

  return {
    paths,
    revision: () => rev,
    getSettings,
    updateSettings,
    listRiskWords,
    addRiskWord,
    updateRiskWord,
    removeRiskWord,
    matchRiskWords,
    getLibraryKeySet,
    listLibrary,
    getLibraryItem,
    ingestProducts,
    updateLibraryItem,
    batchUpdateStatus,
    removeLibraryItems,
    createTask,
    updateTask,
    appendTaskLog,
    listTasks,
    getTask,
    saveGateItem,
    overrideGateItem,
    recomputeTaskGateCounters,
    saveSnapshot,
    listSnapshots,
    getSnapshot,
    listSchedules,
    getSchedule,
    createSchedule,
    updateSchedule,
    removeSchedule,
    recordRun,
    listRuns,
    summaryStats,
  }
}
