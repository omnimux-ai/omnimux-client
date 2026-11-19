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
