import { DEFAULT_QUERY } from './defaults.js'
import { filterTopPosts } from './sort.js'

export const FETCH_KEYS = /** @type {const} */ (['platform', 'profileId', 'timeRange'])

/**
 * Cache key ignores searchQuery (client-side title/id filter) and tab
 * (inbox is a placeholder that does not refetch).
 * @param {Partial<typeof DEFAULT_QUERY>} query
 */
export function cacheKey(query) {
  const q = { ...DEFAULT_QUERY, ...query }
  return JSON.stringify({
    platform: q.platform,
    profileId: q.profileId,
    timeRange: q.timeRange,
  })
}

/**
 * Whether a query patch should bust the in-memory dashboard cache.
 * @param {Record<string, unknown>} patch
 */
export function patchNeedsFetch(patch) {
  return FETCH_KEYS.some((key) => Object.prototype.hasOwnProperty.call(patch, key))
}

/**
 * Live-clock rewrite of the fixture's frozen sync timestamps so the
 * prototype copy ("14 minutes ago / 46 minutes later") holds at runtime.
 * @param {Record<string, unknown>} raw
 * @param {number} now
 */
export function materializeFixture(raw, now = Date.now()) {
  const payload = structuredClone(raw)
  const sync = payload.syncStatus && typeof payload.syncStatus === 'object'
    ? /** @type {Record<string, unknown>} */ (payload.syncStatus)
    : {}
  payload.syncStatus = {
    ...sync,
    lastSyncedAt: now - 14 * 60 * 1000,
    nextSyncAt: now + 46 * 60 * 1000,
    syncing: false,
  }
  return payload
}

/**
 * Apply the current filter query onto a dashboard payload. Search only
 * touches `topPosts` client-side. Platform / account / range are Host
 * concerns — do not slice KPI or charts here.
 * @param {Record<string, unknown>} payload
 * @param {Partial<typeof DEFAULT_QUERY>} query
 */
export function applyDashboardQuery(payload, query) {
  const q = { ...DEFAULT_QUERY, ...query }
  const next = structuredClone(payload)
  next.filtersEcho = q
  if (Array.isArray(next.topPosts)) {
    next.topPosts = filterTopPosts(next.topPosts, q.searchQuery)
  }
  return next
}

/**
 * Pad a sparse heatmap to the contracted 168 cells (`day * 24 + hour`).
 * @param {Array<Record<string, unknown>> | undefined} cells
 * @param {number} maxScore
 */
export function ensureHeatmapCells(cells, maxScore = 0) {
  const out = Array.from({ length: 168 }, (_, i) => ({
    dayOfWeek: Math.floor(i / 24),
    hour: i % 24,
    score: 0,
    level: 0,
    postCount: 0,
  }))
  if (!Array.isArray(cells)) return out
  for (const cell of cells) {
    const day = Number(cell.dayOfWeek)
    const hour = Number(cell.hour)
    if (!Number.isInteger(day) || !Number.isInteger(hour)) continue
    if (day < 0 || day > 6 || hour < 0 || hour > 23) continue
    out[day * 24 + hour] = {
      dayOfWeek: day,
      hour,
      score: Number(cell.score) || 0,
      level: cell.level == null ? 0 : cell.level,
      postCount: cell.postCount == null ? 0 : cell.postCount,
      maxScore,
    }
  }
  return out
}
