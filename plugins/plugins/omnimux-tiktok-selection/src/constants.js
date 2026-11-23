export const TIKTOK_REGIONS = Object.freeze([
  { code: 'US', labelZh: '美国', labelEn: 'United States', currency: '$' },
  { code: 'GB', labelZh: '英国', labelEn: 'United Kingdom', currency: '£' },
  { code: 'MX', labelZh: '墨西哥', labelEn: 'Mexico', currency: 'MX$' },
  { code: 'ES', labelZh: '西班牙', labelEn: 'Spain', currency: '€' },
  { code: 'DE', labelZh: '德国', labelEn: 'Germany', currency: '€' },
  { code: 'IT', labelZh: '意大利', labelEn: 'Italy', currency: '€' },
  { code: 'FR', labelZh: '法国', labelEn: 'France', currency: '€' },
  { code: 'ID', labelZh: '印度尼西亚', labelEn: 'Indonesia', currency: 'Rp' },
  { code: 'VN', labelZh: '越南', labelEn: 'Vietnam', currency: '₫' },
  { code: 'MY', labelZh: '马来西亚', labelEn: 'Malaysia', currency: 'RM' },
  { code: 'TH', labelZh: '泰国', labelEn: 'Thailand', currency: '฿' },
  { code: 'PH', labelZh: '菲律宾', labelEn: 'Philippines', currency: '₱' },
  { code: 'BR', labelZh: '巴西', labelEn: 'Brazil', currency: 'R$' },
  { code: 'JP', labelZh: '日本', labelEn: 'Japan', currency: '¥' },
  { code: 'SG', labelZh: '新加坡', labelEn: 'Singapore', currency: 'S$' },
])

export const TIKTOK_CATEGORIES = Object.freeze([
  'Beauty & Personal Care',
  'Womenswear & Underwear',
  'Menswear & Underwear',
  'Phones & Electronics',
  'Home Supplies',
  'Kitchenware',
  'Pet Supplies',
  'Baby & Maternity',
  'Health',
  'Fashion Accessories',
  'Sports & Outdoor',
  'Food & Beverages',
  'Toys & Hobbies',
  'Luggage & Bags',
])

export const RANK_GRANULARITIES = Object.freeze(['daily', 'weekly', 'monthly'])
export const RANK_SORT_FIELDS = Object.freeze([
  'periodSales',
  'periodGmv',
  'sales7d',
  'gmv7d',
  'totalSales',
  'totalGmv',
  'growthRate',
  'commissionRate',
  'accelRatio',
])

export const PRODUCT_TAGS = Object.freeze([
  'hot_selling',
  'new_arrival',
  'fully_managed',
  'free_shipping',
  'local_warehouse',
])

export const SHOP_TYPES = Object.freeze(['all', 'cross_border', 'local'])

export const SELECTION_STATUSES = Object.freeze([
  'pending_review',
  'approved',
  'recheck',
  'rejected',
])

export const ASSET_STATUSES = Object.freeze([
  'none',
  'script_ready',
  'generating',
  'partial',
  'ready',
  'failed',
])

export const RISK_WORD_TYPES = Object.freeze(['brand', 'sensitive'])

export const GATE_CONCLUSIONS = Object.freeze(['pass', 'fail', 'incomplete'])

export const TASK_STATUSES = Object.freeze([
  'queued',
  'g1_running',
  'g2_running',
  'g3_running',
  'completed',
  'stopped',
  'failed',
])

export const OPERATIONAL_LIMITS = Object.freeze({
  pageSize: 10,
  maxApiMatches: 2000,
  maxImagesPerProduct: 10,
  maxVideosPerProduct: 5,
  maxBatchImages: 60,
  maxBatchVideos: 20,
  maxSingleSlotRetries: 2,
  minConcurrency: 1,
  maxConcurrency: 8,
  maxLogEntries: 50,
  maxSchedulePages: 10,
  maxScheduleIngest: 200,
})

export const DEFAULT_GATE_CRITERIA = Object.freeze({
  source: 'rank',
  region: 'US',
  category: '',
  keyword: '',
  sortField: 'sales7d',
  snapshotId: '',
  totalSalesMin: null,
  totalSalesMax: 50000,
  sales7dMin: 50,
  sales7dMax: null,
  creatorsMin: null,
  creatorsMax: 1000,
  commissionMin: 10,
  commissionMax: null,
  accelMin: 1.1,
  accelMax: null,
  accelBase28dMin: 28,
  ratingMin: 4.0,
  listedDaysMax: 180,
  g2MinCardRatio: 20,
  g2MaxVideoRatio: 0,
  maxPages: 3,
  maxIngest: 50,
  concurrency: 4,
  missingMetricPolicy: 'skip_missing_metric',
  useAiAudit: true,
})

export const DEFAULT_SETTINGS = Object.freeze({
  concurrency: 3,
  dailyAssetCap: 2000,
  excludedCategories: ['电池', '儿童玩具', '液体', '大件', '大IP'],
  defaultMissingMetricPolicy: 'skip_missing_metric',
  defaultImagePrompt:
    'Create a clean 3:4 commercial e-commerce showcase photograph preserving the exact product silhouette, color, material, and unmarked surfaces with soft studio lighting and no text overlays.',
  defaultVideoPrompt:
    'A 5-second vertical 9:16 commercial product video opening on the exact first-frame product, smoothly orbiting and pushing in to highlight texture and natural everyday use under clean daylight, without text or watermarks.',
})

export const RISK_AUDIT_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  required: ['pass', 'riskLevel', 'brandRisk', 'suspectBrand', 'excludedHits', 'reason'],
  additionalProperties: false,
  properties: {
    pass: { type: 'boolean' },
    riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
    brandRisk: { type: 'string', enum: ['none', 'suspected', 'confirmed'] },
    suspectBrand: { type: 'string' },
    excludedHits: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
  },
})

export const VIDEO_SCRIPT_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  required: ['hook', 'sellingPoints', 'shotBeats', 'videoPromptEn', 'imagePromptEn'],
  additionalProperties: false,
  properties: {
    hook: { type: 'string' },
    sellingPoints: { type: 'array', items: { type: 'string' } },
    shotBeats: {
      type: 'array',
      items: {
        type: 'object',
        required: ['second', 'visual', 'voiceover'],
        additionalProperties: false,
        properties: {
          second: { type: 'string' },
          visual: { type: 'string' },
          voiceover: { type: 'string' },
        },
      },
    },
    videoPromptEn: { type: 'string' },
    imagePromptEn: { type: 'string' },
  },
})

export function computeAcceleration(sales7d, sales28d, accelMin = 1.1, base28dMin = 28) {
  const parseOptionalNum = (v) => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const s7 = parseOptionalNum(sales7d)
  const s28 = parseOptionalNum(sales28d)
  if (s7 === null || s28 === null) {
    return {
      sold7d: s7,
      sold28d: s28,
      avg7d: s7 !== null ? Number((s7 / 7).toFixed(2)) : null,
      avg28d: s28 !== null ? Number((s28 / 28).toFixed(2)) : null,
      ratio: null,
      rising: null,
      insufficient: true,
      label: '缺少 7 天或 28 天销量数据',
    }
  }
  const avg7d = Number((s7 / 7).toFixed(2))
  const avg28d = Number((s28 / 28).toFixed(2))
  if (s28 < base28dMin || avg28d <= 0) {
    return {
      sold7d: s7,
      sold28d: s28,
      avg7d,
      avg28d,
      ratio: null,
      rising: false,
      insufficient: true,
      label: `28 天销量 ${s28} 低于加速基数下限 ${base28dMin}`,
    }
  }
  const ratio = Number((avg7d / avg28d).toFixed(3))
  const rising = ratio >= accelMin
  return {
    sold7d: s7,
    sold28d: s28,
    avg7d,
    avg28d,
    ratio,
    rising,
    insufficient: false,
    label: `7 天日均 ${avg7d.toFixed(2)} / 28 天日均 ${avg28d.toFixed(2)} = ${ratio.toFixed(2)} 倍（阈值 ${accelMin}）`,
  }
}

export function currencyForRegion(region) {
  const code = String(region || 'US').trim().toUpperCase()
  return TIKTOK_REGIONS.find((r) => r.code === code)?.currency || '$'
}
