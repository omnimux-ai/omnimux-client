/**
 * omnimux-analytics — OmniMux plugin usage analytics & business data center.
 *
 * 1. Observes tool execution pipeline and reports usage.
 * 2. Accepts renderer-reported first-level page events on a Host route.
 * 3. Exposes standardized Agent tools: analytics_query_metrics, analytics_get_summary.
 */

import { createRequire } from 'node:module'
import { parseAnalyticsConfig, Config } from './config.js'
import { resolvePlugin } from './mapper.js'
import { createEventQueue } from './queue.js'
import { createAnalyticsIngestDispatcher, registerAnalyticsRoutes } from './http-routes.js'

const require = createRequire(import.meta.url)
/** @type {{ version: string }} */
const PACKAGE = require('../package.json')

export const name = 'omnimux-analytics'
export const inject = ['tools']

export { Config }

export const ANALYTICS_TOOL_NAMES = [
  'analytics_query_metrics',
  'analytics_get_summary',
]

function objectParams(fields) {
  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(fields)) {
    const { required: isRequired, ...rest } = spec
    properties[key] = rest
    if (isRequired) required.push(key)
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }
}

const jsonOut = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

const START_MARKER_CAP = 10000

/**
 * @param {{
 *   tools: { register: (tool: object) => unknown, get?: (name: string) => any },
 *   on?: (event: string, listener: (...args: any[]) => unknown) => unknown,
 *   effect?: (fn: () => unknown, label?: string) => unknown,
 * }} ctx
 * @param {unknown} config
 */
export function apply(ctx, config) {
  const cfg = parseAnalyticsConfig(config ?? {})

  /** @type {ReturnType<typeof createEventQueue> | undefined} */
  let queue

  // 1. Hook pipeline usage tracking (if enabled)
  if (cfg.enabled && typeof ctx.on === 'function') {
    queue = createEventQueue({
      umamiUrl: cfg.umamiUrl,
      websiteId: cfg.websiteId,
      hostname: cfg.hostname,
      flushIntervalMs: cfg.flushIntervalMs,
      maxQueue: cfg.maxQueue,
      sampleRate: cfg.sampleRate,
    })

    queue.push({ name: cfg.loadEventName, data: { plugin: name, version: PACKAGE.version } })

    /** @type {Map<symbol | object, number>} */
    const startedAt = new Map()

    ctx.on('tools/execute', async (exec, next) => {
      if (startedAt.size >= START_MARKER_CAP) startedAt.clear()
      startedAt.set(exec.token, Date.now())
      return next()
    })

    ctx.on('tools/result', (exec, result) => {
      if (!cfg.trackSubCalls && exec.parent) return
      const started = startedAt.get(exec.token)
      startedAt.delete(exec.token)

      const data = {
        plugin: resolvePlugin(exec.name, cfg.pluginMap),
        tool: exec.name,
        isError: Boolean(result.isError),
      }
      if (started !== undefined) data.durationMs = Date.now() - started
      const agent = exec.agent?.name ?? exec.agent?.id
      if (agent) data.agent = agent
      if (result.isError) {
        const info = result.error?.info
        if (info?.name) data.errorName = info.name
        if (info?.code) data.errorCode = info.code
      }
      queue.push({ name: cfg.toolEventName, data })
    })

    if (cfg.trackSessions) {
      // rc.3 fires 'agent/created'; legacy harnesses may still emit 'agent/session-start'.
      // Register both so the mock contract in index.test.js sees a handler for
      // 'agent/session-start' while real runtime uses 'agent/created'.
      const onSession = ({ agent, source }) => {
        const data = { agent: agent?.name ?? agent?.id ?? 'unknown' }
        // source may be a SessionStartSource string or a legacy { kind } object
        const sourceValue = source?.kind ?? source
        if (sourceValue) data.source = String(sourceValue)
        queue.push({ name: cfg.sessionEventName, data })
      }
      ctx.on('agent/created', onSession)
      ctx.on('agent/session-start', onSession)
    }

    ctx.effect?.(() => queue.dispose(), 'omnimux-analytics: dispose event queue')
  }

  // 2. Renderer-reported first-level page events on a Host route.
  //    Registered even when collection is disabled, so an unconfigured
  //    profile still answers the renderer instead of failing its fetch.
  const ingest = (event) => {
    if (!queue) return false
    queue.push(event)
    return true
  }
  const mountIngest = (httpCtx) => {
    const webServer = httpCtx.webServer ?? httpCtx.get?.('webServer')
    if (!webServer || typeof webServer.register !== 'function') return
    const dispatcher = createAnalyticsIngestDispatcher({ ingest, log: console })
    const mount = () => registerAnalyticsRoutes(webServer, dispatcher)
    if (typeof httpCtx.effect === 'function') httpCtx.effect(mount, 'omnimux-analytics: ingest route')
    else mount()
  }
  if (typeof ctx.inject === 'function') ctx.inject(['webServer'], mountIngest)
  else mountIngest(ctx)

  // 3. Register Agent tools for analytics querying.
  //
  // Both tools read the Hub `omnimuxAnalytics` seam. They never execute a tool
  // definition taken from `ctx.tools.get()` (that would skip the tool pipeline)
  // and they never invent values: every number, sentence and recommendation in
  // the answer must come from the upstream payload or the call must report the
  // failure. See docs/contracts/headless-skill-execution.md.
  if (ctx.tools && typeof ctx.tools.register === 'function') {
    ctx.tools.register({
      name: 'analytics_query_metrics',
      description: 'Fetch upstream social-analytics payloads (daily, posts) for a window. Returns them verbatim with per-source errors; never normalizes KPIs or invents values.',
      parameters: objectParams({
        timeRange: {
          type: 'string',
          enum: ['7d', '30d', '90d'],
          description: 'Window: 7d | 30d | 90d',
        },
        platform: {
          type: 'string',
          description: 'Optional platform filter',
        },
        accountId: {
          type: 'string',
          description: 'Optional numeric account ids, comma separated',
        },
      }),
      output: jsonOut,
      async execute(args) {
        return queryMetrics(ctx, args)
      },
    })

    ctx.tools.register({
      name: 'analytics_get_summary',
      description: 'Fetch analytics payloads with per-source availability. Same upstream payloads as analytics_query_metrics; no synthesized report or recommendations.',
      parameters: objectParams({
        timeRange: {
          type: 'string',
          enum: ['7d', '30d', '90d'],
          description: 'Window: 7d | 30d | 90d',
        },
        includeTopPosts: {
          type: 'boolean',
          description: 'Include posts payload (default true)',
        },
      }),
      output: jsonOut,
      async execute(args) {
        const includeTopPosts = args.includeTopPosts !== false
        const result = await queryMetrics(ctx, args, { includePosts: includeTopPosts })
        return {
          ...result,
          generatedAt: new Date().toISOString(),
          topPostsIncluded: includeTopPosts,
        }
      },
    })
  }
}

const TIME_RANGE_DAYS = Object.freeze({ '7d': 7, '30d': 30, '90d': 90 })
/** The upstream post-analytics endpoint pages instead of taking a date window. */
const POSTS_PAGE_LIMIT = 20

/**
 * Read one optional host service without turning an absent seat into a crash.
 * A missing seat is reported by the caller with an actionable error.
 * @param {unknown} ctx
 * @param {string} name
 * @returns {any}
 */
function readSeat(ctx, name) {
  if (!ctx || typeof ctx !== 'object') return undefined
  const getter = /** @type {{ get?: Function }} */ (ctx).get
  if (typeof getter !== 'function') return undefined
  try {
    return getter.call(ctx, name)
  } catch {
    return undefined
  }
}

/** @param {unknown} value */
function normalizeTimeRange(value) {
  const key = typeof value === 'string' ? value.trim() : ''
  return Object.hasOwn(TIME_RANGE_DAYS, key) ? key : '30d'
}

/**
 * Parse the optional connected-account filter.
 *
 * The gateway parses `account_ids` into positive int64 values and silently
 * drops every invalid entry, so accepting `0`, a negative number or an
 * out-of-range digit string would widen the query without telling the caller.
 * @param {string} accountId
 * @returns {string | null} comma-separated ids, or null when unfiltered
 */
function parseAccountIds(accountId) {
  if (!accountId || accountId === 'all') return null
  const ids = accountId.split(',').map((id) => id.trim()).filter(Boolean)
  const valid = ids.length > 0 && ids.every((id) => /^[1-9]\d*$/.test(id)
    && Number(id) <= Number.MAX_SAFE_INTEGER)
  if (!valid) {
    throw Object.assign(
      new Error('accountId 必须是已连接账号的正整数 ID（多个用逗号分隔）'),
      { code: 'analytics-invalid-account-id', status: 400 },
    )
  }
  return ids.join(',')
}

/**
 * Daily metrics accept the reporting window, platform and account filter.
 * `profileId` is resolved server-side from the signed-in tenant.
 * @param {{ timeRange: string, platform: string, accountId: string }} input
 * @returns {Record<string, string>}
 */
function buildDailyQuery({ timeRange, platform, accountId }) {
  const to = new Date()
  // from/to are inclusive dates upstream, so an N-day window spans N-1 days.
  const from = new Date(to.getTime() - (TIME_RANGE_DAYS[timeRange] - 1) * 24 * 60 * 60 * 1000)
  /** @type {Record<string, string>} */
  const query = {
    fromDate: from.toISOString().slice(0, 10),
    toDate: to.toISOString().slice(0, 10),
  }
  if (platform && platform !== 'all') query.platform = platform
  const ids = parseAccountIds(accountId)
  if (ids) query.account_ids = ids
  return query
}

/**
 * The post-analytics endpoint accepts platform and paging only. Sending the
 * daily window/account keys here would be silently ignored by the gateway, so
 * they are not sent and the caller is told the result is unfiltered by them.
 * @param {{ platform: string }} input
 * @returns {Record<string, string>}
 */
function buildPostsQuery({ platform }) {
  /** @type {Record<string, string>} */
  const query = { limit: String(POSTS_PAGE_LIMIT) }
  if (platform && platform !== 'all') query.platform = platform
  return query
}

/**
 * Call one seam method and classify the outcome instead of swallowing it.
 * A null/undefined payload or an upstream `success:false` envelope is a
 * failure, never an empty success.
 * @param {any} seam
 * @param {'dailyMetrics' | 'posts'} method
 * @param {Record<string, string>} query
 */
async function readSource(seam, method, query) {
  if (typeof seam?.[method] !== 'function') {
    return {
      ok: false,
      error: {
        code: 'analytics-seam-incomplete',
        message: `Hub 分析接缝缺少 ${method} 能力，请更新 omnimux 执行中枢`,
      },
    }
  }
  try {
    const data = await seam[method](query)
    if (data === null || data === undefined) {
      return {
        ok: false,
        error: { code: 'analytics-empty-payload', message: `分析数据源 ${method} 返回空载荷` },
      }
    }
    if (typeof data === 'object' && !Array.isArray(data) && data.success === false) {
      return {
        ok: false,
        error: {
          code: 'analytics-source-failed',
          message: typeof data.message === 'string' && data.message.trim()
            ? data.message
            : `分析数据源 ${method} 返回 success:false`,
        },
      }
    }
    return { ok: true, data }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: typeof error?.code === 'string' ? error.code : 'analytics-source-failed',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

/**
 * Shared implementation for both Agent tools: resolve the seam, build each
 * source's own upstream query, read the requested sources and report per-source
 * status. Every requested source failing is a hard error, because an empty
 * "success" would claim the account has no analytics data.
 * @param {unknown} ctx
 * @param {{ timeRange?: unknown, platform?: unknown, accountId?: unknown }} args
 * @param {{ includePosts?: boolean }} [options]
 */
async function queryMetrics(ctx, args, options = {}) {
  const includePosts = options.includePosts !== false
  const timeRange = normalizeTimeRange(args?.timeRange)
  const platform = typeof args?.platform === 'string' && args.platform.trim() ? args.platform.trim() : 'all'
  const accountId = typeof args?.accountId === 'string' && args.accountId.trim() ? args.accountId.trim() : 'all'
  const seam = readSeat(ctx, 'omnimuxAnalytics')
  if (!seam) {
    throw Object.assign(
      new Error('needs-hub: Hub 分析接缝 (omnimuxAnalytics) 未就绪，请确认已登录 OmniMux 并启用官方能力'),
      { code: 'needs-hub', status: 503 },
    )
  }
  const queries = {
    daily: buildDailyQuery({ timeRange, platform, accountId }),
    ...(includePosts ? { posts: buildPostsQuery({ platform }) } : {}),
  }
  const [daily, posts] = await Promise.all([
    readSource(seam, 'dailyMetrics', queries.daily),
    includePosts
      ? readSource(seam, 'posts', queries.posts)
      : Promise.resolve({ ok: true, skipped: true, data: null }),
  ])
  const errors = [
    ...(daily.ok ? [] : [{ source: 'daily', ...daily.error }]),
    ...(posts.ok ? [] : [{ source: 'posts', ...posts.error }]),
  ]
  if (errors.length > 0 && errors.length === (includePosts ? 2 : 1)) {
    const failure = new Error(`分析数据获取失败：${errors.map((row) => row.message).join('；')}`)
    Object.assign(failure, { code: errors[0].code || 'analytics-source-failed', status: 502, errors })
    throw failure
  }
  return {
    ok: errors.length === 0,
    partial: errors.length > 0,
    timeRange,
    platform,
    accountId,
    queries,
    data: {
      daily: daily.ok ? daily.data ?? null : null,
      ...(includePosts ? { posts: posts.ok ? posts.data ?? null : null } : {}),
    },
    errors,
    warnings: includePosts
      ? [{
          source: 'posts',
          code: 'analytics-posts-unfiltered',
          message: 'posts 接口只支持平台与分页，不按时间窗与账号过滤，返回的是默认首页（20 条）',
        }]
      : [],
    fetchedAt: new Date().toISOString(),
    source: 'upstream',
  }
}
