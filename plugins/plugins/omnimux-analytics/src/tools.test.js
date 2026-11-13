import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, ANALYTICS_TOOL_NAMES } from './index.js'

test('omnimux-analytics tools registration and execution', async () => {
  const registered = new Map()
  const mockCtx = {
    tools: {
      register(tool) {
        registered.set(tool.name, tool)
      },
      get(name) {
        if (name === 'omnimux_analytics_daily_metrics') {
          return {
            async execute() {
              return {
                engagementRate: 0.052,
                totalReach: 250000,
                totalFollowers: 68000,
                followerDiff: 3200,
              }
            },
          }
        }
        if (name === 'omnimux_analytics_posts') {
          return {
            async execute() {
              return {
                total: 42,
                bestPost: { title: '爆款短剧第1集', views: 180000 },
              }
            },
          }
        }
        return undefined
      },
    },
  }

  apply(mockCtx, { enabled: false })

  assert.deepEqual([...registered.keys()], ANALYTICS_TOOL_NAMES)
  assert.ok(registered.has('analytics_query_metrics'))
  assert.ok(registered.has('analytics_get_summary'))

  // 1. Test analytics_query_metrics
  const queryTool = registered.get('analytics_query_metrics')
  const metricsRes = await queryTool.execute({ timeRange: '30d', platform: 'tiktok' })
  assert.equal(metricsRes.ok, true)
  assert.equal(metricsRes.timeRange, '30d')
  assert.equal(metricsRes.platform, 'tiktok')
  assert.equal(metricsRes.metrics.engagementRate, 0.052)
  assert.equal(metricsRes.metrics.totalReach, 250000)
  assert.equal(metricsRes.metrics.postsCount, 42)
  assert.equal(metricsRes.metrics.bestPost.title, '爆款短剧第1集')

  // 2. Test analytics_get_summary
  const summaryTool = registered.get('analytics_get_summary')
  const summaryRes = await summaryTool.execute({ timeRange: '7d' })
  assert.equal(summaryRes.ok, true)
  assert.equal(summaryRes.timeRange, '7d')
  assert.ok(typeof summaryRes.summary.headline === 'string')
  assert.ok(Array.isArray(summaryRes.summary.keyFindings))
  assert.ok(Array.isArray(summaryRes.summary.recommendations))
  assert.equal(summaryRes.summary.topPostsIncluded, true)
})
