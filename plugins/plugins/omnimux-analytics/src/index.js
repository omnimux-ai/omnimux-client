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
      description: 'Fetch the upstream social-analytics payloads (daily metrics and post analytics) for a reporting window. Returns the provider payloads verbatim under data.daily / data.posts plus per-source availability and errors. It does not normalize fields into KPIs and does not fabricate metrics: a failed source is reported in errors, never replaced with placeholder numbers.',
      parameters: objectParams({
        timeRange: {
          type: 'string',
          enum: ['7d', '30d', '90d'],
          description: 'Time window (default 30d)',
        },
        platform: {
          type: 'string',
          description: 'Optional platform filter (tiktok | instagram | youtube | x)',
        },
        accountId: {
          type: 'string',
          description: 'Optional comma-separated connected-account numeric ID filter; the upstream only accepts numeric account IDs',
        },
      }),
      output: jsonOut,
      async execute(args) {
        return queryMetrics(ctx, args)
      },
    })

    ctx.tools.register({
      name: 'analytics_get_summary',
      description: 'Fetch the analytics payloads for a reporting window and report per-source availability. Returns the same upstream payloads as analytics_query_metrics; it does not synthesize a weekly/monthly report, industry comparisons or recommendations.',
      parameters: objectParams({
        timeRange: {
          type: 'string',
          enum: ['7d', '30d', '90d'],
          description: 'Time window for summary report (default 30d)',
        },
        includeTopPosts: {
          type: 'boolean',
          description: 'Whether to include the post-analytics payload (default true)',
        },
      }),
      output: jsonOut,
      async execute(args) {
        const includeTopPosts = args.includeTopPosts !== false
        const result = await queryMetrics(ctx, args)
        return {
          ...result,
          generatedAt: new Date().toISOString(),
          data: {
            daily: result.data.daily,
            ...(includeTopPosts ? { posts: result.data.posts } : {}),
          },
          topPostsIncluded: includeTopPosts,
        }
      },
    })
  }
}

const TIME_RANGE_DAYS = Object.freeze({ '7d': 7, '30d': 30, '90d': 90 })

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
 * The upstream analytics endpoints take an explicit date window and a
 * comma-separated numeric account filter; a non-numeric filter would be
 * silently dropped upstream, so it is rejected here instead of widening the
 * query without telling the caller.
 * @param {{ timeRange: string, platform: string, accountId: string }} input
 */
function buildQuery({ timeRange, platform, accountId }) {
  const to = new Date()
  const from = new Date(to.getTime() - TIME_RANGE_DAYS[timeRange] * 24 * 60 * 60 * 1000)
  /** @type {Record<string, string>} */
  const query = {
    fromDate: from.toISOString().slice(0, 10),
    toDate: to.toISOString().slice(0, 10),
  }
  if (platform && platform !== 'all') query.platform = platform
  if (accountId && accountId !== 'all') {
    const ids = accountId.split(',').map((id) => id.trim()).filter(Boolean)
    if (ids.length === 0 || ids.some((id) => !/^\d+$/.test(id))) {
      throw Object.assign(
        new Error('accountId 必须是已连接账号的数字 ID（多个用逗号分隔）'),
        { code: 'analytics-invalid-account-id', status: 400 },
      )
    }
    query.account_ids = ids.join(',')
  }
  return query
}

/**
 * Call one seam method and classify the outcome instead of swallowing it.
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
    return { ok: true, data: await seam[method](query) }
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
 * Shared implementation for both Agent tools: resolve the seam, build the
 * upstream query, read both sources concurrently and report per-source status.
 * Both sources failing is a hard error, because an empty "success" would claim
 * the account has no analytics data.
 * @param {unknown} ctx
 * @param {{ timeRange?: unknown, platform?: unknown, accountId?: unknown }} args
 */
async function queryMetrics(ctx, args) {
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
  const query = buildQuery({ timeRange, platform, accountId })
  const [daily, posts] = await Promise.all([
    readSource(seam, 'dailyMetrics', query),
    readSource(seam, 'posts', query),
  ])
  const errors = [
    ...(daily.ok ? [] : [{ source: 'daily', ...daily.error }]),
    ...(posts.ok ? [] : [{ source: 'posts', ...posts.error }]),
  ]
  if (errors.length === 2) {
    const failure = new Error(`分析数据获取失败：${errors.map((row) => row.message).join('；')}`)
    Object.assign(failure, { code: errors[0].code || 'analytics-source-failed', status: 502, errors })
    throw failure
  }
  return {
    ok: errors.length === 0,
    partial: errors.length === 1,
    timeRange,
    platform,
    accountId,
    query,
    data: {
      daily: daily.ok ? daily.data ?? null : null,
      posts: posts.ok ? posts.data ?? null : null,
    },
    errors,
    fetchedAt: new Date().toISOString(),
    source: 'upstream',
  }
}
