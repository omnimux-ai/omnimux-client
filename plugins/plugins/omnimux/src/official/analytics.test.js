import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { OmnimuxError } from '../media/errors.js'
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

  it('forwards timezone and validated account_ids on getDailyMetrics and rejects legacy/invalid filters', async () => {
    const client = fakeClient()
    await getDailyMetrics(client, {
      fromDate: '2026-08-01',
      toDate: '2026-08-30',
      platform: 'tiktok',
      timezone: 'Asia/Shanghai',
      account_ids: '12, 34',
    })
    assert.equal(
      client.calls[0].path,
      '/api/social/v1/analytics/daily-metrics?fromDate=2026-08-01&toDate=2026-08-30&platform=tiktok&timezone=Asia%2FShanghai&account_ids=12%2C34',
    )

    const rejectedClient = fakeClient()
    for (const badQuery of [{ accountIds: '12' }, { profileId: 'prof_1' }, { days: 30 }]) {
      await assert.rejects(
        () => getDailyMetrics(rejectedClient, badQuery),
        (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-query' && err.status === 400,
      )
    }
    for (const badIds of [
      'acc_1',
      '0',
      '-3',
      '12,0',
      '12,,34',
      '99999999999999999999',
      [12, ''],
      [12, null],
      [undefined],
      ['  '],
      [12, , 34],
    ]) {
      await assert.rejects(
        () => getDailyMetrics(rejectedClient, { account_ids: badIds }),
        (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-account-id' && err.status === 400,
      )
    }
    assert.equal(rejectedClient.calls.length, 0)

    await getDailyMetrics(client, { account_ids: [12, '34'] })
    assert.equal(client.calls[1].path, '/api/social/v1/analytics/daily-metrics?account_ids=12%2C34')
  })

  it('calls getBestTimeToPost', async () => {
    const client = fakeClient()
    await getBestTimeToPost(client, { platform: 'x' })
    assert.equal(client.calls.length, 1)
    assert.equal(client.calls[0].path, '/api/social/v1/analytics/best-time-to-post?platform=x')
  })

  it('forwards account_id and timezone on getBestTimeToPost and rejects legacy/invalid filters', async () => {
    const client = fakeClient()
    await getBestTimeToPost(client, { platform: 'tiktok', timezone: 'UTC', account_id: '12' })
    assert.equal(client.calls[0].path, '/api/social/v1/analytics/best-time-to-post?platform=tiktok&timezone=UTC&account_id=12')

    const rejected = fakeClient()
    await assert.rejects(
      () => getBestTimeToPost(rejected, { accountId: '12' }),
      (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-query',
    )
    await assert.rejects(
      () => getBestTimeToPost(rejected, { profileId: 'p1' }),
      (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-query',
    )
    for (const badId of ['0', '-1', 'acc_1', '12,34']) {
      await assert.rejects(
        () => getBestTimeToPost(rejected, { account_id: badId }),
        (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-account-id',
      )
    }
    assert.equal(rejected.calls.length, 0)
  })

  it('calls getPostingFrequency', async () => {
    const client = fakeClient()
    await getPostingFrequency(client, { platform: 'tiktok' })
    assert.equal(client.calls.length, 1)
    assert.equal(client.calls[0].path, '/api/social/v1/analytics/posting-frequency?platform=tiktok')
    await assert.rejects(
      () => getPostingFrequency(client, { profileId: 'p1' }),
      (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-query',
    )
    assert.equal(client.calls.length, 1)
  })

  it('calls getContentDecay', async () => {
    const client = fakeClient()
    await getContentDecay(client, { platform: 'tiktok' })
    assert.equal(client.calls.length, 1)
    assert.equal(client.calls[0].path, '/api/social/v1/analytics/content-decay?platform=tiktok')
    await assert.rejects(
      () => getContentDecay(client, { profileId: 'p1' }),
      (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-query',
    )
    assert.equal(client.calls.length, 1)
  })

  it('calls getFollowerStats', async () => {
    const client = fakeClient()
    await getFollowerStats(client, { days: 30 })
    assert.equal(client.calls.length, 1)
    assert.equal(client.calls[0].path, '/api/social/v1/accounts/follower-stats?days=30')

    await getFollowerStats(client, { days: 14, account_ids: '7, 9' })
    assert.equal(client.calls[1].path, '/api/social/v1/accounts/follower-stats?days=14&account_ids=7%2C9')

    await assert.rejects(
      () => getFollowerStats(client, { accountIds: '7' }),
      (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-query',
    )
    await assert.rejects(
      () => getFollowerStats(client, { profileId: 'p1' }),
      (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-query',
    )
    await assert.rejects(
      () => getFollowerStats(client, { days: 0 }),
      (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-query',
    )
    await assert.rejects(
      () => getFollowerStats(client, { account_ids: '0' }),
      (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-account-id',
    )
    assert.equal(client.calls.length, 2)
  })

  it('calls getPostAnalytics with sortBy and pagination', async () => {
    const client = fakeClient()
    await getPostAnalytics(client, { sortBy: 'engagement', sortOrder: 'desc', limit: 50 })
    assert.equal(client.calls.length, 1)
    assert.equal(client.calls[0].path, '/api/social/v1/analytics/posts?sortBy=engagement&sortOrder=desc&limit=50')

    await getPostAnalytics(client, { post_id: 'post_123', platform: 'tiktok', page: 2, limit: 10 })
    assert.equal(client.calls[1].path, '/api/social/v1/analytics/posts?post_id=post_123&platform=tiktok&page=2&limit=10')

    for (const bad of [{ postId: 'post_123' }, { fromDate: '2026-08-01' }, { account_ids: '12' }, { sortOrder: 'up' }, { limit: 0 }]) {
      await assert.rejects(
        () => getPostAnalytics(client, bad),
        (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-query',
      )
    }
    assert.equal(client.calls.length, 2)
  })

  it('calls syncExternalPosts with POST body', async () => {
    const client = fakeClient()
    await syncExternalPosts(client, { account_id: '12', url: 'https://tiktok.com/video/123' })
    assert.equal(client.calls.length, 1)
    assert.equal(client.calls[0].path, '/api/social/v1/analytics/sync-external-posts')
    assert.deepEqual(client.calls[0].opts, {
      method: 'POST',
      body: { account_id: 12, url: 'https://tiktok.com/video/123' },
    })
    assert.equal(typeof client.calls[0].opts.body.account_id, 'number')

    await syncExternalPosts(client, { account_id: 42 })
    assert.deepEqual(client.calls[1].opts, {
      method: 'POST',
      body: { account_id: 42 },
    })

    await assert.rejects(
      () => syncExternalPosts(client, { accountId: '12' }),
      (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-query',
    )
    for (const badBody of [{}, { account_id: '' }, { account_id: '0' }, { account_id: 'acc-1' }, { account_id: 12.5 }]) {
      await assert.rejects(
        () => syncExternalPosts(client, badBody),
        (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-account-id',
      )
    }
    assert.equal(client.calls.length, 2)
  })

  it('calls getInboxAnalytics for various capabilities', async () => {
    const client = fakeClient()
    await getInboxAnalytics(client, 'heatmap', { platform: 'tiktok', timezone: 'Asia/Shanghai' })
    assert.equal(client.calls.length, 1)
    assert.equal(client.calls[0].path, '/api/social/v1/inbox-analytics/heatmap?platform=tiktok&timezone=Asia%2FShanghai')

    await getInboxAnalytics(client, 'volume', { platform: 'tiktok', fromDate: '2026-08-01', toDate: '2026-08-07' })
    assert.equal(client.calls[1].path, '/api/social/v1/inbox-analytics/volume?platform=tiktok&fromDate=2026-08-01&toDate=2026-08-07')

    await assert.rejects(
      () => getInboxAnalytics(client, 'heatmap', { fromDate: '2026-08-01' }),
      (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-query',
    )
    await assert.rejects(
      () => getInboxAnalytics(client, 'volume', { timezone: 'UTC' }),
      (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-query',
    )
    await assert.rejects(
      () => getInboxAnalytics(client, 'response-time', { profileId: 'p1' }),
      (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-query',
    )
    await assert.rejects(
      () => getInboxAnalytics(client, 'source-breakdown', { accountId: '12' }),
      (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-query',
    )
    await assert.rejects(
      () => getInboxAnalytics(client, '', {}),
      (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-capability',
    )
    await assert.rejects(
      () => getInboxAnalytics(client, 'unknown', {}),
      (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-capability',
    )
    assert.equal(client.calls.length, 2)
  })
})
