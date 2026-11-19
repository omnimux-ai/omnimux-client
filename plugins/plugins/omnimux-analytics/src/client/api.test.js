import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { authGuard, fetchAccounts, fetchDashboard, HOST_PATHS, syncNow } from './api.js'

describe('fetchDashboard mock', () => {
  it('returns a complete Phase-1 payload with 9 series and 168 heatmap cells', async () => {
    const payload = await fetchDashboard({ timeRange: '30d' }, { useMock: true, now: 1_700_000_000_000 })
    assert.equal(payload.kpi.engagementRate.value, 0.0226)
    assert.equal(payload.kpi.totalReach.value, 1900)
    assert.equal(payload.kpi.totalFollowers.value, 635)
    assert.equal(payload.kpi.postsCount.value, 12)
    assert.equal(payload.kpi.bestPost.postId, 'post_ep1_pilot')
    assert.equal(payload.engagementOverTime.series.length, 9)
    assert.equal(payload.heatmap.cells.length, 168)
    assert.equal(payload.topPosts.length, 3)
    assert.equal(payload.emptyState, null)
    assert.equal(payload.filtersEcho.timeRange, '30d')
  })

  it('applies searchQuery against topPosts only', async () => {
    const payload = await fetchDashboard({ searchQuery: 'Episode 2' }, { useMock: true })
    assert.equal(payload.topPosts.length, 1)
    assert.equal(payload.topPosts[0].postId, 'post_ep2_clip')
    assert.equal(payload.kpi.postsCount.value, 12)
  })
})

describe('syncNow mock', () => {
  it('waits ~800ms then stamps lastSyncedAt to now', async () => {
    const now = 1_800_000_000_000
    const started = Date.now()
    const payload = await syncNow({}, { useMock: true, now })
    const elapsed = Date.now() - started
    assert.ok(elapsed >= 700, `expected ≥800ms latency, got ${elapsed}`)
    assert.equal(payload.syncStatus.lastSyncedAt, now)
    assert.equal(payload.syncStatus.nextSyncAt, now + 3_600_000)
    assert.equal(payload.syncStatus.syncing, false)
  })
})

describe('authGuard', () => {
  it('passes a non-401 through and replays once after login', async () => {
    const pass = async () => ({ ok: true, status: 200, body: { ok: true } })
    assert.deepEqual(await authGuard(pass)(), { ok: true, status: 200, body: { ok: true } })

    const saved = globalThis.window
    let calls = 0
    let recordedKind = null
    globalThis.window = {
      __omnimuxAuth: {
        ensureLogin({ kind, onSuccess }) {
          recordedKind = kind
          onSuccess({ logged_in: true })
        },
      },
    }
    try {
      const fn = async () => {
        calls += 1
        return calls === 1
          ? { ok: false, status: 401, body: { error: 'need-login' } }
          : { ok: true, status: 200, body: { ok: true } }
      }
      const result = await authGuard(fn)()
      assert.equal(calls, 2)
      assert.equal(result.status, 200)
      assert.equal(recordedKind, 'write')
    } finally {
      globalThis.window = saved
    }
  })
})

describe('HOST_PATHS', () => {
  it('keeps the Host route names so the mock can flip without renaming', () => {
    assert.equal(HOST_PATHS.overview, '/omnimux/analytics/overview')
    assert.equal(HOST_PATHS.insights, '/omnimux/analytics/insights')
    assert.equal(HOST_PATHS.followers, '/omnimux/analytics/followers')
    assert.equal(HOST_PATHS.posts, '/omnimux/analytics/posts')
    assert.equal(HOST_PATHS.sync, '/omnimux/analytics/sync')
  })
})

it('notifies a quota refusal when listing filter accounts without prechecking the balance', async (t) => {
  const originalWindow = globalThis.window
  t.after(() => { globalThis.window = originalWindow })
  let prechecks = 0
  let notifications = 0
  globalThis.window = { __omnimuxQuota: {
    ensureQuota: async () => { prechecks++; return { ok: false, reason: 'quota' } },
    notify: () => { notifications++ },
  } }
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ error: 'quota-exceeded' }, { status: 402 }))
  await assert.rejects(fetchAccounts(), /quota-exceeded/)
  assert.equal(fetch.mock.callCount(), 1)
  assert.equal(prechecks, 0)
  assert.equal(notifications, 1)
})

it('keeps login and quota denials distinct for the dashboard and manual sync', async (t) => {
  const originalWindow = globalThis.window
  t.after(() => { globalThis.window = originalWindow })
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected Host request') })
  for (const [reason, status, message, action] of [
    ['auth', 401, 'needs-omnimux', 'login'],
    ['quota', 402, 'quota-exceeded', 'retry'],
  ]) {
    const checks = []
    globalThis.window = { __omnimuxQuota: {
      ensureQuota: async (context) => { checks.push(context); return { ok: false, reason } },
    } }
    const payload = await fetchDashboard({}, { useMock: false })
    assert.equal(payload.syncStatus.lastError, message)
    assert.equal(payload.emptyState.action, action)
    await fetchDashboard({}, { useMock: false, userInitiated: true })
    await assert.rejects(syncNow({}, { useMock: false }), { status, message })
    assert.deepEqual(checks.map(({ userInitiated }) => Boolean(userInitiated)), [false, true, true])
  }
  assert.equal(fetch.mock.callCount(), 0)
})

it('checks once before loading the four dashboard sections', async (t) => {
  const originalWindow = globalThis.window
  t.after(() => { globalThis.window = originalWindow })
  let checks = 0
  globalThis.window = { __omnimuxQuota: {
    ensureQuota: async () => { checks++; return { ok: true } },
  } }
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ error: 'overview-unavailable' }, { status: 503 }))
  const payload = await fetchDashboard({}, { useMock: false })
  assert.equal(checks, 1)
  assert.equal(fetch.mock.callCount(), 4)
  assert.equal(payload.syncStatus.lastError, 'overview-unavailable')
})

it('keeps available charts and reports a quota refusal from inside an insights response', async (t) => {
  const originalWindow = globalThis.window
  t.after(() => { globalThis.window = originalWindow })
  let checks = 0
  const notices = []
  globalThis.window = { __omnimuxQuota: {
    ensureQuota: async () => { checks++; return { ok: true } },
    notify: result => notices.push(result),
  } }
  const heatmap = { cells: [{ dayOfWeek: 3, hour: 9, score: 80 }] }
  const strategy = { cadence: { optimal: ['1-5/wk'] }, accumulation: { windows: [] } }
  const responses = new Map([
    [HOST_PATHS.overview, { kpi: { postsCount: { value: 4 } } }],
    [HOST_PATHS.insights, { heatmap, strategy, partialErrors: [{ key: 'content-decay', status: 402, error: 'quota-exceeded' }] }],
    [HOST_PATHS.followers, { kpiPatch: { totalFollowers: { value: 12 } } }],
    [HOST_PATHS.posts, { topPosts: [{ postId: 'retained' }] }],
  ])
  let postsDenied = false
  const reads = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.method, 'GET')
    const path = url.split('?')[0]
    reads.push(path)
    if (postsDenied && path === HOST_PATHS.posts) return Response.json({ error: 'quota-exceeded' }, { status: 402 })
    return Response.json(responses.get(path))
  })
  const result = await fetchDashboard({}, { useMock: false })
  assert.deepEqual(result.heatmap, heatmap)
  assert.deepEqual(result.strategy, strategy)
  assert.equal(result.kpi.postsCount.value, 4)
  assert.equal(result.kpi.totalFollowers.value, 12)
  assert.equal(result.topPosts[0].postId, 'retained')
  assert.equal(result.emptyState?.action, 'retry')
  assert.match(result.syncStatus.lastError, /内容.*衰减/)
  assert.deepEqual(notices.map(({status,code}) => [status,code]), [[402, 'quota-exceeded']])
  assert.equal(checks, 1)
  assert.deepEqual(reads.sort(), [HOST_PATHS.overview, HOST_PATHS.insights, HOST_PATHS.followers, HOST_PATHS.posts].sort())

  postsDenied = true
  notices.length = 0
  const retry = await fetchDashboard({}, { useMock: false, userInitiated: true })
  assert.deepEqual(retry.heatmap, heatmap)
  assert.match(retry.syncStatus.lastError, /content-decay 402.*posts 402/)
  assert.equal(notices.length, 1)
  assert.equal(checks, 2)
})

it('retains independent sections when part or all of overview is refused for quota', async (t) => {
  const originalWindow = globalThis.window
  t.after(() => { globalThis.window = originalWindow })
  const notices = []
  globalThis.window = { __omnimuxQuota: { ensureQuota: async () => ({ ok: true }), notify: event => notices.push(event) } }
  let overviewDenied = false
  t.mock.method(globalThis, 'fetch', async url => {
    switch (url.split('?')[0]) {
      case HOST_PATHS.insights: return Response.json({ heatmap: { maxScore: 85 } })
      case HOST_PATHS.followers: return Response.json({ kpiPatch: { totalFollowers: { value: 63 } } })
      case HOST_PATHS.posts: return Response.json({ topPosts: [{ postId: 'kept' }] })
      case HOST_PATHS.overview: return overviewDenied
        ? Response.json({ error: 'quota-exceeded' }, { status: 402 })
        : Response.json({ kpi: { postsCount: { value: 12 } }, partialErrors: [{ key: 'daily-metrics', status: 402, error: 'quota-exceeded' }] })
      default: throw new Error('Unexpected analytics request')
    }
  })
  const partial = await fetchDashboard({}, { useMock: false })
  assert.equal(partial.kpi.postsCount.value, 12)
  assert.equal(partial.emptyState?.action, 'retry')
  assert.match(partial.syncStatus.lastError, /daily-metrics 402/)
  overviewDenied = true
  const reduced = await fetchDashboard({}, { useMock: false })
  assert.equal(reduced.emptyState?.code, 'network_error')
  assert.equal(reduced.heatmap.maxScore, 85)
  assert.equal(reduced.kpi.totalFollowers.value, 63)
  assert.equal(reduced.topPosts[0].postId, 'kept')
  assert.equal(notices.length, 2)
})

it('opens login after a rejected sync without replaying the write on success or cancel', async (t) => {
  const originalWindow = globalThis.window
  t.after(() => { globalThis.window = originalWindow })
  const posts = []
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    posts.push([path, options.method])
    return Response.json({ error: 'needs-omnimux' }, { status: 401 })
  })
  for (const finish of [gate => gate.onSuccess(), gate => gate.onCancel()]) {
    let logins = 0
    globalThis.window = {
      __omnimuxQuota: { ensureQuota: async () => ({ ok: true }) },
      __omnimuxAuth: { ensureLogin: gate => { logins++; finish(gate) } },
    }
    posts.length = 0
    await assert.rejects(syncNow({}, { useMock: false }), { status: 401 })
    assert.equal(logins, 1)
    assert.deepEqual(posts, [[HOST_PATHS.sync, 'POST']])
  }
})
