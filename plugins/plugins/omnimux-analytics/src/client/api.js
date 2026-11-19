/**
 * Analytics dashboard fetch. Live Host aggregation is the default.
 * Field names match `GET /omnimux/analytics/overview` + insights + followers
 * + posts so the mock fixture stays isomorphic.
 */
import { isQuotaHttpResult, notifyQuota, quotaGuard as guardRequest, quotaPrecheckFailure } from 'dsh-ui-kit/quota-request'
export { isQuotaHttpResult, notifyQuota }
import { resolveUseMock } from './defaults.js'
import { applyDashboardQuery, materializeFixture } from './query.js'
import fixture from './mock/dashboard-fixture.json' with { type: 'json' }
import emptyStates from './mock/empty-states.json' with { type: 'json' }

export const HOST_PATHS = Object.freeze({
  overview: '/omnimux/analytics/overview',
  insights: '/omnimux/analytics/insights',
  followers: '/omnimux/analytics/followers',
  posts: '/omnimux/analytics/posts',
  sync: '/omnimux/analytics/sync',
})

const MOCK_LATENCY_MS = 40
const SYNC_LATENCY_MS = 800

// These individual reads report Host refusals; the dashboard checks once for the group.
export function quotaGuard(fn, context) {
  return guardRequest(fn, context, { precheck: false })
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown, query?: Record<string, string> }} [opts]
 */
export async function analyticsRequest(path, opts = {}) {
  const url = opts.query
    ? `${path}?${new URLSearchParams(opts.query).toString()}`
    : path
  const response = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  let json = {}
  try {
    json = await response.json()
  } catch {
    json = { error: `HTTP ${String(response.status)}` }
  }
  return { ok: response.ok, status: response.status, body: json }
}

/**
 * Open the Hub login gate after a 401. Reads can resume after sign-in.
 * @param {(...args: any[]) => Promise<{ ok: boolean, status: number, body: any }>} fn
 */
export function authGuard(fn, { replayAfterLogin = true } = {}) {
  return (...args) => {
    const run = async () => {
      const result = await fn(...args)
      if (result.status !== 401) return result
      const gate = typeof window !== 'undefined' ? /** @type {any} */ (window).__omnimuxAuth : undefined
      if (!gate || typeof gate.ensureLogin !== 'function') return result
      return new Promise((resolve, reject) => {
        gate.ensureLogin({
          kind: 'write',
          action: 'accounts',
          onSuccess: () => {
            if (replayAfterLogin) fn(...args).then(resolve, reject)
            else resolve(result)
          },
          onCancel: () => resolve(result),
        })
      })
    }
    return run()
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * @param {Partial<{ tab: string, platform: string, profileId: string, source: string, timeRange: string, searchQuery: string }>} query
 * @param {{ now?: number, variant?: string }} [opts]
 */
export async function fetchDashboardMock(query = {}, opts = {}) {
  await wait(MOCK_LATENCY_MS)
  const variant = opts.variant
  let raw = fixture
  if (variant && emptyStates.variants?.[variant]) {
    const pack = emptyStates.variants[variant]
    raw = pack.meta ? pack : { ...fixture, ...pack, emptyState: pack.emptyState ?? fixture.emptyState }
    if (pack.kpiOverrides) raw = { ...raw, kpi: { ...raw.kpi, ...pack.kpiOverrides } }
    if (pack.syncStatusPatch) raw = { ...raw, syncStatus: { ...raw.syncStatus, ...pack.syncStatusPatch } }
  }
  const materialized = materializeFixture(raw, opts.now ?? Date.now())
  return applyDashboardQuery(materialized, query)
}

function hostQuery(query) {
  const params = {
    platform: query.platform ?? 'all',
    profileId: query.profileId ?? 'all',
    timeRange: query.timeRange ?? '30d',
  }
  if (query.source && query.source !== 'all') params.source = query.source
  return params
}

function throwHttp(result) {
  const error = new Error(String(result.body?.error || `HTTP ${result.status}`))
  error.status = result.status
  throw error
}

function emptyBlock(kind) {
  if (kind === 'heatmap') {
    return {
      cells: Array.from({ length: 168 }, (_, i) => ({
        dayOfWeek: Math.floor(i / 24),
        hour: i % 24,
        score: 0,
        level: 0,
        postCount: 0,
      })),
      maxScore: 0,
      recommended: [],
      dayLabelsZh: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
      dayLabelsEn: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    }
  }
  if (kind === 'strategy') {
    return {
      cadence: { brackets: ['1-5/wk', '6-10/wk', '11+/wk'], series: [], optimal: [] },
      accumulation: { windows: [], milestones: {} },
    }
  }
  return { totalFollowers: null, platforms: [], timeline: [] }
}

function failedDashboard(query, failure) {
  return applyDashboardQuery({
    meta: { boundAccountCount: 0, authorizedPlatforms: [], filterAccounts: [], reachApprox: false },
    syncStatus: {
      lastSyncedAt: null,
      nextSyncAt: null,
      syncIntervalMs: 3_600_000,
      syncing: false,
      lastError: String(failure.body?.error || `HTTP ${failure.status}`),
    },
    kpi: {
      engagementRate: { value: null },
      totalReach: { value: null },
      totalFollowers: { value: null },
      followerDiff: { value: null },
      postsCount: { value: null },
      postsHealth: 'none',
      bestPost: null,
    },
    basicCharts: { postsPerPlatform: { labels: [], platformIds: [], values: [], total: 0 }, postsOverTime: { grain: 'week', total: 0, buckets: [] }, likesPerPlatform: { labels: [], platformIds: [], values: [], total: 0 }, likesOverTime: { grain: 'week', total: 0, buckets: [] } },
    engagementOverTime: { grain: 'week', buckets: [], labels: [], totals: {}, deltas: {}, series: [] },
    heatmap: emptyBlock('heatmap'),
    followerEvolution: emptyBlock('followers'),
    platformBreakdown: [],
    topPosts: [],
    strategy: emptyBlock('strategy'),
    emptyState: failure.status === 401
      ? { code: 'unauthorized', action: 'login' }
      : { code: 'fetch_failed', action: 'retry' },
  }, query)
}

/**
 * Live Host fetch. Overview is required; the remaining sections may degrade independently.
 * @param {Record<string, string>} query
 * @param {{ userInitiated?: boolean }} [opts]
 */
export async function fetchDashboardLive(query, opts = {}) {
  const denied = await quotaPrecheckFailure({ capability: 'analytics', userInitiated: opts.userInitiated === true })
  if (denied) return failedDashboard(query, denied)
  const params = hostQuery(query)
  const request = authGuard(analyticsRequest)
  const [overview, insights, followers, posts] = await Promise.all([
    request(HOST_PATHS.overview, { query: params }),
    request(HOST_PATHS.insights, { query: params }),
    request(HOST_PATHS.followers, { query: params }),
    request(HOST_PATHS.posts, { query: params }),
  ])
  const partialErrors = [overview, insights].flatMap(section =>
    section.ok && Array.isArray(section.body?.partialErrors) ? section.body.partialErrors : [])
  const refusals = partialErrors.map(({ status, error }) => ({ ok: false, status, body: { error } }))
  const quotaFailure = [overview, insights, followers, posts, ...refusals].find(isQuotaHttpResult)
  if (quotaFailure) notifyQuota(quotaFailure, { capability: 'analytics' })
  if (!overview.ok && (!isQuotaHttpResult(overview) || ![insights, followers, posts].some(section => section.ok))) {
    return failedDashboard(query, overview)
  }
  const overviewData = overview.ok ? overview.body : failedDashboard(query, overview)
  const kpi = { ...(overviewData?.kpi || {}) }
  if (followers.ok && followers.body?.kpiPatch) Object.assign(kpi, followers.body.kpiPatch)
  const payload = {
    ...overviewData,
    kpi,
    heatmap: insights.ok ? (insights.body?.heatmap ?? overviewData?.heatmap) : emptyBlock('heatmap'),
    strategy: insights.ok ? (insights.body?.strategy ?? overviewData?.strategy) : emptyBlock('strategy'),
    followerEvolution: followers.ok
      ? (followers.body?.followerEvolution ?? overviewData?.followerEvolution)
      : emptyBlock('followers'),
    topPosts: posts.ok
      ? (posts.body?.topPosts ?? overviewData?.topPosts)
      : (overviewData?.topPosts ?? []),
  }
  const BLOCK_LABEL = {
    insights: '热力图 / 策略分析',
    followers: '粉丝演进',
    posts: '爆款排行',
    overview: '核心指标',
    'best-time-to-post': '最佳发布时间热力图',
    'posting-frequency': '发帖频次',
    'content-decay': '内容互动衰减',
    'daily-metrics': '每日指标',
  }
  const failed = [
    ...partialErrors,
    !overview.ok && { key: 'overview', status: overview.status, error: overview.body?.error },
    !insights.ok && { key: 'insights', status: insights.status, error: insights.body?.error },
    !followers.ok && { key: 'followers', status: followers.status, error: followers.body?.error },
    !posts.ok && { key: 'posts', status: posts.status, error: posts.body?.error },
  ].filter(Boolean)
  if (failed.length) {
    const names = failed.map((row) => BLOCK_LABEL[row.key] || row.key).join('、')
    const detail = `未拉到：${names}（${failed.map((row) => `${row.key} ${row.status}${row.error ? ` ${row.error}` : ''}`).join('；')}）`
    const unauthorized = failed.some((row) => row.status === 401)
    if (!overview.ok || !payload.emptyState || payload.emptyState.code === 'network_error') {
      payload.emptyState = {
        code: unauthorized ? 'unauthorized' : 'network_error',
        action: unauthorized ? 'login' : 'retry',
        detail: payload.emptyState?.detail ? `${payload.emptyState.detail}；${detail}` : detail,
      }
    }
    payload.syncStatus = {
      ...(payload.syncStatus || {}),
      lastError: detail,
    }
  }
  return applyDashboardQuery(payload, query)
}

/**
 * Bound accounts for the FilterBar. Browser-safe Host list — never the hub client.
 */
export async function fetchAccounts() {
  const result = await quotaGuard(authGuard(analyticsRequest), { capability: 'analytics' })('/omnimux/accounts?provider=zernio')
  if (!result.ok) throwHttp(result)
  const accounts = Array.isArray(result.body?.accounts) ? result.body.accounts : []
  return accounts.map((row) => ({
    id: String(row.id),
    label: row.username
      ? `${String(row.username).startsWith('@') ? row.username : `@${row.username}`}${row.platform ? `（${row.platform}）` : ''}`
      : String(row.display_name || row.name || row.id),
    platform: row.platform || '',
    status: row.status || 'active',
    expired: row.status === 'expired' || row.status === 'error',
  }))
}

/**
 * @param {Partial<{ tab: string, platform: string, profileId: string, source: string, timeRange: string, searchQuery: string }>} query
 * @param {{ now?: number, variant?: string, useMock?: boolean, userInitiated?: boolean }} [opts]
 */
export async function fetchDashboard(query = {}, opts = {}) {
  const useMock = resolveUseMock(opts.useMock)
  if (useMock) return fetchDashboardMock(query, opts)
  return fetchDashboardLive(query, opts)
}

/**
 * Incremental sync. Mock path waits 800ms then returns a fresh payload
 * (contract: "立即同步成功后 800ms 内刷新大盘").
 * @param {Partial<{ tab: string, platform: string, profileId: string, source: string, timeRange: string, searchQuery: string }>} query
 * @param {{ now?: number, useMock?: boolean }} [opts]
 */
export async function syncNow(query = {}, opts = {}) {
  const useMock = resolveUseMock(opts.useMock)
  if (useMock) {
    await wait(SYNC_LATENCY_MS)
    const payload = await fetchDashboardMock(query, { now: opts.now ?? Date.now() })
    const now = opts.now ?? Date.now()
    payload.syncStatus = {
      ...payload.syncStatus,
      lastSyncedAt: now,
      nextSyncAt: now + (payload.syncStatus?.syncIntervalMs ?? 3_600_000),
      syncing: false,
      lastError: null,
    }
    return payload
  }
  const run = guardRequest(authGuard(analyticsRequest, { replayAfterLogin: false }), { capability: 'analytics', userInitiated: true })
  const result = await run(HOST_PATHS.sync, { method: 'POST', body: query })
  if (!result.ok) throwHttp(result)
  return fetchDashboardLive(query)
}

export { fixture as DASHBOARD_FIXTURE, emptyStates as EMPTY_STATE_FIXTURES }
