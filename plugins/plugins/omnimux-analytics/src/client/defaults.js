/**
 * Client-side dashboard defaults. Host Config stays Umami-only —
 * these values are the dashboard contract the Stage store consumes.
 * Live Host `/omnimux/analytics/*` is the default; mock is an explicit fallback.
 */
export const STAGE_ID = 'omnimux-analytics'
export const SLOT_ID = 'omnimux-analytics-stage'
export const SIDEBAR_RANK = 4.5 // Directly below 创作 (omnimux-workflow rank 4)
export const OVERLAY_ORDER = 22

/** Production default: live Host aggregation. Flip only for fixture replay. */
export const USE_MOCK = false
export const CACHE_TTL_MS = 5000
export const FILTER_DEBOUNCE_MS = 300

/**
 * Mock is opt-in so a missing key never silently impersonates live numbers.
 * - `opts.useMock` on fetch
 * - `?analytics_mock=1` / localStorage `omnimux-analytics-mock=1`
 * - `OMNIMUX_ANALYTICS_MOCK=1` (unit tests)
 */
export function resolveUseMock(explicit) {
  if (typeof explicit === 'boolean') return explicit
  if (typeof process !== 'undefined' && process.env?.OMNIMUX_ANALYTICS_MOCK === '1') return true
  if (typeof window !== 'undefined') {
    try {
      const url = new URL(window.location.href)
      if (url.searchParams.get('analytics_mock') === '1') return true
      if (window.localStorage?.getItem('omnimux-analytics-mock') === '1') return true
    } catch {}
  }
  return USE_MOCK
}

/** @type {Readonly<{ tab: 'posting' | 'inbox', platform: 'all' | string, profileId: 'all' | string, source: 'all' | 'manual' | 'omnimux', timeRange: '7d' | '30d' | '90d', searchQuery: string }>} */
export const DEFAULT_QUERY = Object.freeze({
  tab: 'posting',
  platform: 'all',
  profileId: 'all',
  source: 'all',
  timeRange: '30d',
  searchQuery: '',
})
