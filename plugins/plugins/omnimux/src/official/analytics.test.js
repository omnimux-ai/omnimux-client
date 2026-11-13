import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  analyticsQueryString,
  getDailyMetrics,
  getBestTimeToPost,
  getPostingFrequency,
  getContentDecay,
  getFollowerStats,
  getPostAnalytics,
  syncExternalPosts,
  getInboxAnalytics,
} from './analytics.js'

function fakeClient() {
  /** @type {Array<{ path: string, opts?: unknown }>} */
  const calls = []
  return {
    calls,
    withPat(path, opts) {
      calls.push({ path, opts })
      return Promise.resolve({ ok: true, path, opts })
    },
  }
}

describe('analytics client lane', () => {
  it('formats query string correctly', () => {
    assert.equal(analyticsQueryString({}), '')
    assert.equal(analyticsQueryString({ platform: 'tiktok', limit: 20 }), '?platform=tiktok&limit=20')
    assert.equal(analyticsQueryString({ platform: '', empty: null, undef: undefined, valid: 'yes' }), '?valid=yes')
  })

  it('calls getDailyMetrics with query', async () => {
    const client = fakeClient()
    await getDailyMetrics(client, { fromDate: '2026-08-01', platform: 'tiktok' })
    assert.equal(client.calls.length, 1)
    assert.equal(client.calls[0].path, '/api/social/v1/analytics/daily-metrics?fromDate=2026-08-01&platform=tiktok')
  })

  it('calls getBestTimeToPost', async () => {
    const client = fakeClient()
    await getBestTimeToPost(client, { platform: 'x' })
    assert.equal(client.calls.length, 1)
    assert.equal(client.calls[0].path, '/api/social/v1/analytics/best-time-to-post?platform=x')
  })

  it('calls getPostingFrequency', async () => {
    const client = fakeClient()
    await getPostingFrequency(client, { platform: 'tiktok' })
    assert.equal(client.calls.length, 1)
    assert.equal(client.calls[0].path, '/api/social/v1/analytics/posting-frequency?platform=tiktok')
  })

  it('calls getContentDecay', async () => {
    const client = fakeClient()
    await getContentDecay(client, { platform: 'tiktok' })
    assert.equal(client.calls.length, 1)
    assert.equal(client.calls[0].path, '/api/social/v1/analytics/content-decay?platform=tiktok')
  })

  it('calls getFollowerStats', async () => {
    const client = fakeClient()
    await getFollowerStats(client, { days: 30 })
    assert.equal(client.calls.length, 1)
    assert.equal(client.calls[0].path, '/api/social/v1/accounts/follower-stats?days=30')
  })

  it('calls getPostAnalytics with sortBy and pagination', async () => {
    const client = fakeClient()
    await getPostAnalytics(client, { sortBy: 'engagement', sortOrder: 'desc', limit: 50 })
    assert.equal(client.calls.length, 1)
    assert.equal(client.calls[0].path, '/api/social/v1/analytics/posts?sortBy=engagement&sortOrder=desc&limit=50')
  })

  it('calls syncExternalPosts with POST body', async () => {
    const client = fakeClient()
    await syncExternalPosts(client, { accountId: 'acc-1', url: 'https://tiktok.com/video/123' })
    assert.equal(client.calls.length, 1)
    assert.equal(client.calls[0].path, '/api/social/v1/analytics/sync-external-posts')
    assert.deepEqual(client.calls[0].opts, {
      method: 'POST',
      body: { accountId: 'acc-1', url: 'https://tiktok.com/video/123' },
    })
  })

  it('calls getInboxAnalytics for various capabilities', async () => {
    const client = fakeClient()
    await getInboxAnalytics(client, 'heatmap', { fromDate: '2026-08-01' })
    assert.equal(client.calls.length, 1)
    assert.equal(client.calls[0].path, '/api/social/v1/inbox-analytics/heatmap?fromDate=2026-08-01')
  })
})
