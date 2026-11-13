import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { CACHE_TTL_MS, FILTER_DEBOUNCE_MS } from './defaults.js'
import { analyticsStore, loadDashboard, resetStore, setQuery, syncNow } from './store.js'

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

afterEach(() => {
  resetStore()
})

describe('analytics store cache + debounce', () => {
  it('serves a 5s TTL hit without a second fetch of a different object', async () => {
    const first = await loadDashboard({ timeRange: '30d' })
    const second = await loadDashboard({ timeRange: '30d' })
    assert.equal(first, second)
    assert.equal(analyticsStore.getSnapshot().phase, 'ready')
    assert.equal(analyticsStore.getSnapshot().payload.kpi.postsCount.value, 12)
    assert.equal(analyticsStore.cache.size, 1)
  })

  it('debounces filter patches by 300ms before refetching', async () => {
    await loadDashboard()
    setQuery({ platform: 'tiktok' })
    assert.equal(analyticsStore.getSnapshot().query.platform, 'tiktok')
    await tick(FILTER_DEBOUNCE_MS - 80)
    // Still the original key in cache; the debounce has not fired.
    assert.equal(analyticsStore.cache.size, 1)
    await tick(200)
    assert.equal(analyticsStore.getSnapshot().query.platform, 'tiktok')
    assert.ok(analyticsStore.cache.size >= 1)
  })

  it('applies search immediately against the snapshot without waiting for TTL', async () => {
    await loadDashboard()
    setQuery({ searchQuery: 'teaser' }, { debounceMs: 30 })
    const payload = analyticsStore.getSnapshot().payload
    assert.equal(payload.topPosts.length, 1)
    assert.equal(payload.topPosts[0].postId, 'post_teaser')
    await tick(40)
  })
})

describe('syncNow scheduler', () => {
  it('marks syncing then restores a fresh lastSyncedAt', async () => {
    await loadDashboard()
    const pending = syncNow()
    assert.equal(analyticsStore.getSnapshot().syncing, true)
    const payload = await pending
    assert.equal(analyticsStore.getSnapshot().syncing, false)
    assert.ok(payload.syncStatus.lastSyncedAt)
    assert.equal(payload.syncStatus.lastError, null)
  })
})

describe('CACHE_TTL_MS contract', () => {
  it('exposes the contracted 5s / 300ms constants', () => {
    assert.equal(CACHE_TTL_MS, 5000)
    assert.equal(FILTER_DEBOUNCE_MS, 300)
  })
})

describe('query object identity (React #185 guard)', () => {
  it('refresh keeps the same query object reference when fields are unchanged', async () => {
    await loadDashboard({ timeRange: '30d' })
    const before = analyticsStore.getSnapshot().query
    await analyticsStore.refresh()
    const after = analyticsStore.getSnapshot().query
    assert.equal(after, before)
  })

  it('setQuery with identical values reuses the existing query object', async () => {
    await loadDashboard()
    const before = analyticsStore.getSnapshot().query
    setQuery({ platform: before.platform, timeRange: before.timeRange })
    assert.equal(analyticsStore.getSnapshot().query, before)
  })
})
