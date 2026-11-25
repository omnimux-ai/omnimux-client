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
  assert.match(metricsRes.query.fromDate, /^\d{4}-\d{2}-\d{2}$/)
  assert.match(metricsRes.query.toDate, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(queries.length, 2)
  assert.deepEqual(queries.map(([name]) => name).sort(), ['daily', 'posts'])

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
    dailyMetrics: async (query) => { calls.push(query); return DAILY_PAYLOAD },
    posts: async (query) => { calls.push(query); return POSTS_PAYLOAD },
  })
  apply(seam.ctx, { enabled: false })
  // A non-numeric connected-account id would be dropped upstream, which would
  // silently widen the query to every account; refuse it instead.
  await assert.rejects(
    () => seam.registered.get('analytics_query_metrics').execute({ accountId: 'acc_1' }),
    (error) => error.code === 'analytics-invalid-account-id',
  )
  assert.deepEqual(calls, [], 'a rejected filter must never reach the upstream')

  const filtered = await seam.registered.get('analytics_query_metrics').execute({ accountId: '12, 34' })
  assert.equal(filtered.query.account_ids, '12,34')
  assert.equal(filtered.accountId, '12, 34')
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
