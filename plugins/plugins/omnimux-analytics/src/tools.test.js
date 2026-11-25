import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, ANALYTICS_TOOL_NAMES } from './index.js'

/**
 * Build a host ctx whose `omnimuxAnalytics` seat is programmable per source.
 * @param {{ dailyMetrics?: (query: any) => unknown, posts?: (query: any) => unknown } | null} seat
 */
function makeCtx(seat) {
  const registered = new Map()
  return {
    registered,
    ctx: {
      tools: {
        register(tool) {
          registered.set(tool.name, tool)
        },
      },
      get(name) {
        return name === 'omnimuxAnalytics' ? seat ?? undefined : undefined
      },
    },
  }
}

const DAILY_PAYLOAD = { series: [{ date: '2026-11-20', reach: 1200 }], meta: { timezone: 'Asia/Taipei' } }
const POSTS_PAYLOAD = { rows: [{ id: 'p1', views: 180000 }], total: 1 }

function daysBetween(fromDate, toDate) {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000)
}

test('omnimux-analytics tools read the hub seam and never fabricate data', async () => {
  const queries = []
  const { registered, ctx } = makeCtx({
    dailyMetrics: async (query) => { queries.push(['daily', query]); return DAILY_PAYLOAD },
    posts: async (query) => { queries.push(['posts', query]); return POSTS_PAYLOAD },
  })

  apply(ctx, { enabled: false })

  assert.deepEqual([...registered.keys()], ANALYTICS_TOOL_NAMES)

  // 1. Both sources succeed: the upstream payloads are returned verbatim, with
  //    no normalized KPI block and no placeholder numbers.
  const metricsRes = await registered.get('analytics_query_metrics').execute({ timeRange: '30d', platform: 'tiktok' })
  assert.equal(metricsRes.ok, true)
  assert.equal(metricsRes.partial, false)
  assert.equal(metricsRes.timeRange, '30d')
  assert.equal(metricsRes.platform, 'tiktok')
  assert.equal(metricsRes.source, 'upstream')
  assert.deepEqual(metricsRes.data.daily, DAILY_PAYLOAD)
  assert.deepEqual(metricsRes.data.posts, POSTS_PAYLOAD)
  assert.deepEqual(metricsRes.errors, [])
  assert.equal(Object.hasOwn(metricsRes, 'metrics'), false, 'must not invent a normalized KPI block')
  assert.match(metricsRes.queries.daily.fromDate, /^\d{4}-\d{2}-\d{2}$/)
  assert.match(metricsRes.queries.daily.toDate, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(daysBetween(metricsRes.queries.daily.fromDate, metricsRes.queries.daily.toDate), 29, '30d is an inclusive 30-day window')
  // Each endpoint gets only the parameters it actually honours.
  assert.deepEqual(Object.keys(metricsRes.queries.daily).sort(), ['fromDate', 'platform', 'toDate'])
  assert.deepEqual(metricsRes.queries.posts, { limit: '20', platform: 'tiktok' })
  assert.equal(queries.length, 2)
  assert.deepEqual(queries.map(([name]) => name).sort(), ['daily', 'posts'])
  assert.deepEqual(metricsRes.warnings, [{
    source: 'posts',
    code: 'analytics-posts-unfiltered',
    message: 'posts 接口只支持平台与分页，不按时间窗与账号过滤，返回的是默认首页（20 条）',
  }])

  // 2. The summary tool returns the same payloads and an availability status,
  //    never synthesized insights or industry comparisons.
  const summaryRes = await registered.get('analytics_get_summary').execute({ timeRange: '7d' })
  assert.equal(summaryRes.ok, true)
  assert.equal(summaryRes.timeRange, '7d')
  assert.equal(summaryRes.topPostsIncluded, true)
  assert.deepEqual(summaryRes.data.daily, DAILY_PAYLOAD)
  assert.deepEqual(summaryRes.data.posts, POSTS_PAYLOAD)
  assert.equal(Object.hasOwn(summaryRes, 'summary'), false, 'must not ship a pre-written report')
  assert.ok(!JSON.stringify(summaryRes).includes('行业基准'))

  const withoutPosts = await registered.get('analytics_get_summary').execute({ timeRange: '7d', includeTopPosts: false })
  assert.equal(withoutPosts.topPostsIncluded, false)
  assert.equal(Object.hasOwn(withoutPosts.data, 'posts'), false)
  assert.deepEqual(withoutPosts.data.daily, DAILY_PAYLOAD)
  assert.deepEqual(withoutPosts.warnings, [])
})

test('omnimux-analytics reports a partial failure instead of filling gaps with defaults', async () => {
  const { registered, ctx } = makeCtx({
    dailyMetrics: async () => DAILY_PAYLOAD,
    posts: async () => { throw Object.assign(new Error('upstream posts 503'), { code: 'omnimux-request-failed' }) },
  })
  apply(ctx, { enabled: false })

  const result = await registered.get('analytics_query_metrics').execute({ timeRange: '90d' })
  assert.equal(result.ok, false)
  assert.equal(result.partial, true)
  assert.deepEqual(result.data.daily, DAILY_PAYLOAD)
  assert.equal(result.data.posts, null)
  assert.deepEqual(result.errors, [
    { source: 'posts', code: 'omnimux-request-failed', message: 'upstream posts 503' },
  ])
  assert.equal(result.timeRange, '90d')
})

test('omnimux-analytics fails loudly when both sources fail, the seam is missing, or the account filter is unusable', async () => {
  const bothFail = makeCtx({
    dailyMetrics: async () => { throw new Error('daily down') },
    posts: async () => { throw new Error('posts down') },
  })
  apply(bothFail.ctx, { enabled: false })
  await assert.rejects(
    () => bothFail.registered.get('analytics_query_metrics').execute({}),
    (error) => {
      assert.equal(error.code, 'analytics-source-failed')
      assert.match(error.message, /daily down/)
      assert.match(error.message, /posts down/)
      assert.equal(error.errors.length, 2)
      return true
    },
  )

  const noSeam = makeCtx(null)
  apply(noSeam.ctx, { enabled: false })
  await assert.rejects(
    () => noSeam.registered.get('analytics_query_metrics').execute({}),
    (error) => error.code === 'needs-hub' && /omnimuxAnalytics/.test(error.message),
  )

  const calls = []
  const seam = makeCtx({
    dailyMetrics: async (query) => { calls.push(['daily', query]); return DAILY_PAYLOAD },
    posts: async (query) => { calls.push(['posts', query]); return POSTS_PAYLOAD },
  })
  apply(seam.ctx, { enabled: false })
  // A dropped account filter would silently widen the query to every account,
  // so zeros, negatives and out-of-range ids are refused before any call.
  for (const accountId of ['acc_1', '0', '12,0', '-3', '99999999999999999999']) {
    await assert.rejects(
      () => seam.registered.get('analytics_query_metrics').execute({ accountId }),
      (error) => error.code === 'analytics-invalid-account-id',
      accountId,
    )
  }
  assert.deepEqual(calls, [], 'a rejected filter must never reach the upstream')

  const filtered = await seam.registered.get('analytics_query_metrics').execute({ accountId: '12, 34' })
  assert.equal(filtered.queries.daily.account_ids, '12,34')
  assert.equal(filtered.accountId, '12, 34')
  // The posts endpoint cannot filter by account, so it never receives the key.
  assert.equal(Object.hasOwn(filtered.queries.posts, 'account_ids'), false)
})

test('omnimux-analytics keeps posts out of a daily-only summary', async () => {
  const calls = []
  const { registered, ctx } = makeCtx({
    dailyMetrics: async (query) => { calls.push(['daily', query]); return DAILY_PAYLOAD },
    posts: async () => { calls.push(['posts']); throw new Error('posts unavailable') },
  })
  apply(ctx, { enabled: false })

  const result = await registered.get('analytics_get_summary').execute({ includeTopPosts: false })
  assert.equal(result.ok, true)
  assert.equal(result.partial, false)
  assert.deepEqual(result.data.daily, DAILY_PAYLOAD)
  assert.equal(Object.hasOwn(result.data, 'posts'), false)
  assert.deepEqual(calls.map(([name]) => name), ['daily'], 'a daily-only summary must not touch the posts source')
})

test('omnimux-analytics treats empty or explicit-failure payloads as errors', async () => {
  const { registered, ctx } = makeCtx({
    dailyMetrics: async () => null,
    posts: async () => ({ success: false, message: 'upstream said no' }),
  })
  apply(ctx, { enabled: false })

  await assert.rejects(
    () => registered.get('analytics_query_metrics').execute({}),
    (error) => {
      assert.equal(error.code, 'analytics-empty-payload')
      assert.deepEqual(error.errors, [
        { source: 'daily', code: 'analytics-empty-payload', message: '分析数据源 dailyMetrics 返回空载荷' },
        { source: 'posts', code: 'analytics-source-failed', message: 'upstream said no' },
      ])
      return true
    },
  )

  const undefinedDaily = makeCtx({ dailyMetrics: async () => undefined, posts: async () => POSTS_PAYLOAD })
  apply(undefinedDaily.ctx, { enabled: false })
  const partial = await undefinedDaily.registered.get('analytics_query_metrics').execute({})
  assert.equal(partial.partial, true)
  assert.equal(partial.data.daily, null)
  assert.deepEqual(partial.data.posts, POSTS_PAYLOAD)
})

test('omnimux-analytics tolerates a seam that only exposes one capability', async () => {
  const { registered, ctx } = makeCtx({ dailyMetrics: async () => DAILY_PAYLOAD })
  apply(ctx, { enabled: false })

  const result = await registered.get('analytics_query_metrics').execute({})
  assert.equal(result.partial, true)
  assert.deepEqual(result.data.daily, DAILY_PAYLOAD)
  assert.deepEqual(result.errors, [
    { source: 'posts', code: 'analytics-seam-incomplete', message: 'Hub 分析接缝缺少 posts 能力，请更新 omnimux 执行中枢' },
  ])
})
