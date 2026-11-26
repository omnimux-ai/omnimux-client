/**
 * Category shuffle and session cache helpers for cloud assets row layout.
 *
 * Provides safe Fisher-Yates array shuffling, parallel cross-page sampling with
 * cache-friendly bounded hot-pool seeding, and a session-level cache to keep
 * randomized card order stable during tab switching and navigation within the
 * same session, while allowing explicit invalidation on refresh.
 */

/**
 * 热池槽位数：同一天内首次打开「公共 → 全部」时，每个分类命中固定一对跨区间热页，
 * 既保证多子类混排多样性（避免 page-0000 按 ID 排序导致单子类扎堆），又将全球与本机
 * 流量收敛在有界热集内，大幅提高 Cloudflare 边缘缓存（cf=HIT）与本地磁盘缓存命中率。
 */
export const HOT_POOL_SLOTS = 2

/**
 * FNV-1a 32-bit string hash for deterministic daily hot-pool seeding.
 * @param {string} text
 * @returns {number}
 */
export function hashSeed(text) {
  const input = String(text ?? '')
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(i), 16777619) >>> 0
  }
  return hash >>> 0
}

/**
 * Mulberry32 deterministic PRNG returning values in [0, 1).
 * @param {string} seedText
 * @returns {() => number}
 */
export function createSeededRandom(seedText) {
  let state = hashSeed(seedText) || 0x9e3779b9
  return function nextRandom() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Local calendar day bucket (`YYYY-MM-DD`) so cold restarts on the same day
 * reuse CDN edge & browser HTTP disk cache while refreshing naturally next day.
 * @param {Date} [now]
 * @returns {string}
 */
export function dailyHotPoolBucket(now = new Date()) {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Immutably shuffle an array using Fisher-Yates algorithm.
 * @template T
 * @param {T[]} items
 * @param {() => number} [rng=Math.random]
 * @returns {T[]}
 */
export function shuffleArray(items, rng = Math.random) {
  if (!Array.isArray(items) || items.length <= 1) {
    return Array.isArray(items) ? [...items] : []
  }
  const random = typeof rng === 'function' ? rng : Math.random
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const temp = result[i]
    result[i] = result[j]
    result[j] = temp
  }
  return result
}

/**
 * Choose 1–2 distinct page indices to sample for a category.
 *
 * - `useHotPool === true`（首次冷打开）：按日从前段与后段对称锚点选取热池页对，
 *   同时兼顾头尾子类多样性（如角色页 0 动物/数字人 + 尾页奇幻/网梗）与高缓存命中。
 * - `useHotPool === false`（显式刷新或兼容调用）：在 `[0, totalPages - 1]` 全页池
 *   随机选取 1–2 个不同页码。
 *
 * @param {{
 *   totalPages: number,
 *   scope: string,
 *   useHotPool?: boolean,
 *   seedSalt?: number | string,
 *   dayBucket?: string,
 *   rng?: () => number,
 * }} input
 * @returns {number[]}
 */
export function selectSamplePages(input) {
  const totalPages = Math.max(1, Math.floor(Number(input?.totalPages) || 1))
  if (totalPages <= 1) return [0]
  if (totalPages === 2) return [0, 1]

  if (input?.useHotPool === true) {
    const bucket = input.dayBucket || dailyHotPoolBucket()
    const salt = input.seedSalt ?? 0
    const slotCount = Math.max(1, Math.min(HOT_POOL_SLOTS, Math.floor(totalPages / 2)))
    const slot = hashSeed(`${bucket}:${input.scope}:${salt}`) % slotCount
    const pageA = slot
    const pageB = Math.max(pageA + 1, totalPages - 1 - slot)
    return pageA === pageB ? [pageA] : [pageA, pageB]
  }

  const random = typeof input?.rng === 'function' ? input.rng : Math.random
  const pageA = Math.floor(random() * totalPages)
  const pageB = (pageA + 1 + Math.floor(random() * (totalPages - 1))) % totalPages
  return pageA === pageB ? [pageA] : [pageA, pageB]
}

/**
 * Safely invoke `fetchPageFn`, turning thrown rejections into a structured miss
 * so sibling parallel requests still settle cleanly.
 * @param {(catId: string, page: number) => Promise<any>} fetchPageFn
 * @param {string} categoryId
 * @param {number} page
 */
async function safeFetchPage(fetchPageFn, categoryId, page) {
  try {
    return await fetchPageFn(categoryId, page)
  } catch (error) {
    return { ok: false, error }
  }
}

/**
 * 跨页采样并混编洗牌算法：
 * - 当调用方传入 `options.totalPages`（来自 `manifest.json`）时，直接算出目标页码并用
 *   `Promise.all` 并发拉取，将原先 3 轮串行请求压缩为 1 轮并行；
 * - 未传 `totalPages` 时先拉 page 0 获取总页数，再并发拉取其余抽样页；
 * - `options.useHotPool === true` 时使用按日稳定的多子类热池锚点页，提升 CDN 与本地磁盘缓存命中。
 *
 * @template T
 * @param {string} categoryId 分类 ID（如 character, scene, prop）
 * @param {(catId: string, page: number) => Promise<{ ok: boolean, body?: { items?: any[], totalPages?: number } }>} fetchPageFn
 * @param {(raw: any) => T} [normalizeFn=(x) => x]
 * @param {number} [targetCount=24]
 * @param {{ totalPages?: number, useHotPool?: boolean, seedSalt?: number | string, dayBucket?: string }} [options]
 * @returns {Promise<T[]>}
 */
export async function fetchCategoryRandomSample(
  categoryId,
  fetchPageFn,
  normalizeFn = (x) => x,
  targetCount = 24,
  options = {},
) {
  if (!categoryId || typeof fetchPageFn !== 'function') return []

  const useHotPool = options?.useHotPool === true
  const dayBucket = options?.dayBucket || (useHotPool ? dailyHotPoolBucket() : '')
  const seedSalt = options?.seedSalt ?? 0
  const rng = useHotPool
    ? createSeededRandom(`${dayBucket}:${categoryId}:${seedSalt}`)
    : Math.random

  const knownPages = Number(options?.totalPages)
  /** @type {any[]} */
  let candidatePool = []

  if (Number.isFinite(knownPages) && knownPages >= 1) {
    const pages = selectSamplePages({
      totalPages: knownPages,
      scope: categoryId,
      useHotPool,
      seedSalt,
      dayBucket,
      rng,
    })
    const results = await Promise.all(pages.map((page) => safeFetchPage(fetchPageFn, categoryId, page)))
    for (const res of results) {
      if (res?.ok && Array.isArray(res?.body?.items) && res.body.items.length > 0) {
        candidatePool.push(...res.body.items)
      }
    }
    // 所选分片均失败且未覆盖 page 0 时，兜底回落 page 0 一次，避免行内容意外变空。
    if (candidatePool.length === 0 && !pages.includes(0)) {
      const fallbackRes = await safeFetchPage(fetchPageFn, categoryId, 0)
      if (fallbackRes?.ok && Array.isArray(fallbackRes?.body?.items)) {
        candidatePool.push(...fallbackRes.body.items)
      }
    }
  } else {
    // 1. 兼容路径：未提供已知总页数时，先拉取 page 0 获取总页数
    const initialRes = await safeFetchPage(fetchPageFn, categoryId, 0)
    if (!initialRes?.ok || !Array.isArray(initialRes?.body?.items)) {
      return []
    }
    const firstItems = initialRes.body.items
    const totalPages = Math.max(1, Number(initialRes.body?.totalPages) || 1)
    if (totalPages <= 1) {
      return shuffleArray(firstItems.map(normalizeFn), rng).slice(0, targetCount)
    }

    const pages = selectSamplePages({
      totalPages,
      scope: categoryId,
      useHotPool,
      seedSalt,
      dayBucket,
      rng,
    })
    const results = await Promise.all(
      pages.map((page) => (page === 0 ? Promise.resolve(initialRes) : safeFetchPage(fetchPageFn, categoryId, page))),
    )
    for (const res of results) {
      if (res?.ok && Array.isArray(res?.body?.items) && res.body.items.length > 0) {
        candidatePool.push(...res.body.items)
      }
    }
    if (candidatePool.length === 0) {
      candidatePool = [...firstItems]
    }
  }

  // 去重（依据 id）后全局 Fisher-Yates 洗牌并截取目标数量
  const seenIds = new Set()
  const uniqueItems = []
  for (const item of candidatePool) {
    const id = item?.id || JSON.stringify(item)
    if (!seenIds.has(id)) {
      seenIds.add(id)
      uniqueItems.push(item)
    }
  }

  const normalized = uniqueItems.map(normalizeFn)
  return shuffleArray(normalized, rng).slice(0, targetCount)
}

/**
 * 多 scope 合并采样：并行拉取所有二级 scope 后合并去重、过滤、洗牌并截取。
 *
 * @template T
 * @param {string[]} scopes 二级 scope 列表（如 ['audio/bgm', 'audio/sfx']）
 * @param {(catId: string, page: number) => Promise<{ ok: boolean, body?: { items?: any[], totalPages?: number } }>} fetchPageFn
 * @param {(raw: any) => T} [normalizeFn=(x) => x]
 * @param {number} [targetCount=24]
 * @param {(item: T) => boolean} [keepFn=() => true] 行级筛除，作用于合并去重后的完整候选池
 * @param {{ totalPagesByScope?: Record<string, number>, useHotPool?: boolean, seedSalt?: number | string, dayBucket?: string }} [options]
 * @returns {Promise<T[]>}
 */
export async function fetchScopesRandomSample(
  scopes,
  fetchPageFn,
  normalizeFn = (x) => x,
  targetCount = 24,
  keepFn = () => true,
  options = {},
) {
  if (!Array.isArray(scopes) || typeof fetchPageFn !== 'function') return []

  const activeScopes = scopes.filter(Boolean)
  if (activeScopes.length === 0) return []

  const perScope = targetCount * Math.max(1, activeScopes.length)
  const useHotPool = options?.useHotPool === true
  const dayBucket = options?.dayBucket || (useHotPool ? dailyHotPoolBucket() : '')
  const seedSalt = options?.seedSalt ?? 0
  const rng = useHotPool
    ? createSeededRandom(`${dayBucket}:${activeScopes.join('|')}:${seedSalt}`)
    : Math.random

  // 并行采样全部二级 scope，消除原先串行 for-await 瀑布；单 scope 异常不阻断其余 scope。
  const perScopeResults = await Promise.all(
    activeScopes.map(async (scope) => {
      try {
        const totalPages = options?.totalPagesByScope?.[scope]
        return await fetchCategoryRandomSample(scope, fetchPageFn, normalizeFn, perScope, {
          totalPages,
          useHotPool,
          seedSalt,
          dayBucket,
        })
      } catch (error) {
        return { failed: true, error }
      }
    }),
  )

  const merged = []
  for (const sampled of perScopeResults) {
    if (Array.isArray(sampled)) merged.push(...sampled)
  }

  // 跨 scope 去重（依据 id）
  const seenIds = new Set()
  const uniqueItems = []
  for (const item of merged) {
    const id = item?.id || JSON.stringify(item)
    if (!seenIds.has(id)) {
      seenIds.add(id)
      uniqueItems.push(item)
    }
  }

  // 过滤 → 洗牌 → 截取
  return shuffleArray(uniqueItems.filter((item) => keepFn(item)), rng).slice(0, targetCount)
}

export class CategoryShuffleCache {
  /**
   * @param {number} [maxEntries=30]
   */
  constructor(maxEntries = 30) {
    this.maxEntries = maxEntries
    /** @type {Map<string, any[]>} */
    this.cache = new Map()
  }

  /**
   * @param {string} categoryId
   * @returns {any[] | undefined}
   */
  get(categoryId) {
    return this.cache.get(categoryId)
  }

  /**
   * @param {string} categoryId
   * @param {any[]} items
   */
  set(categoryId, items) {
    if (this.cache.size >= this.maxEntries && !this.cache.has(categoryId)) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) this.cache.delete(firstKey)
    }
    this.cache.set(categoryId, Array.isArray(items) ? items : [])
  }

  /**
   * Get cached shuffled items or shuffle and cache new items.
   * @param {string} categoryId
   * @param {any[]} sourceItems
   * @returns {any[]}
   */
  getOrShuffle(categoryId, sourceItems) {
    const existing = this.get(categoryId)
    if (existing !== undefined && existing.length > 0) {
      return existing
    }
    const shuffled = shuffleArray(sourceItems)
    this.set(categoryId, shuffled)
    return shuffled
  }

  /**
   * Check if category is cached.
   * @param {string} categoryId
   * @returns {boolean}
   */
  has(categoryId) {
    return this.cache.has(categoryId)
  }

  /**
   * Invalidate all cached shuffles (e.g. on manual refresh).
   */
  clear() {
    this.cache.clear()
  }
}

/** Global shuffle cache instance for cloud assets view */
export const globalShuffleCache = new CategoryShuffleCache(30)
