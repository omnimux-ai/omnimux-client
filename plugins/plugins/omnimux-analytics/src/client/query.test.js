import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyDashboardQuery, cacheKey, ensureHeatmapCells, materializeFixture, patchNeedsFetch } from './query.js'
import fixture from './mock/dashboard-fixture.json' with { type: 'json' }

describe('cacheKey', () => {
  it('ignores searchQuery and tab so typing in the search box does not bust TTL', () => {
    assert.equal(
      cacheKey({ platform: 'all', timeRange: '30d', searchQuery: 'ep1' }),
      cacheKey({ platform: 'all', timeRange: '30d', searchQuery: 'teaser', tab: 'inbox' }),
    )
    assert.notEqual(
      cacheKey({ platform: 'tiktok', timeRange: '30d' }),
      cacheKey({ platform: 'all', timeRange: '30d' }),
    )
    assert.equal(
      cacheKey({ platform: 'all', timeRange: '30d', source: 'manual' }),
      cacheKey({ platform: 'all', timeRange: '30d', source: 'omnimux' }),
    )
  })
})

describe('patchNeedsFetch', () => {
  it('treats search as client-side and platform/range as a refetch', () => {
    assert.equal(patchNeedsFetch({ searchQuery: 'ep' }), false)
    assert.equal(patchNeedsFetch({ tab: 'inbox' }), false)
    assert.equal(patchNeedsFetch({ platform: 'tiktok' }), true)
    assert.equal(patchNeedsFetch({ timeRange: '7d' }), true)
  })
})

describe('materializeFixture', () => {
  it('rewrites frozen timestamps onto a live 14 / 46 minute window', () => {
    const now = 2_000_000_000_000
    const next = materializeFixture(fixture, now)
    assert.equal(next.syncStatus.lastSyncedAt, now - 14 * 60_000)
    assert.equal(next.syncStatus.nextSyncAt, now + 46 * 60_000)
    assert.notEqual(next.kpi, fixture.kpi)
    assert.equal(next.kpi.engagementRate.value, 0.0226)
  })
})

describe('applyDashboardQuery', () => {
  it('filters topPosts by search without dropping KPI totals', () => {
    const next = applyDashboardQuery(fixture, { searchQuery: 'teaser' })
    assert.equal(next.topPosts.length, 1)
    assert.equal(next.topPosts[0].postId, 'post_teaser')
    assert.equal(next.kpi.postsCount.value, 12)
    assert.equal(next.filtersEcho.searchQuery, 'teaser')
  })

  it('does not slice KPI or platform tables client-side (Host owns that filter)', () => {
    const next = applyDashboardQuery(fixture, { platform: 'youtube' })
    assert.equal(next.platformBreakdown.length, fixture.platformBreakdown.length)
    assert.equal(next.topPosts.length, fixture.topPosts.length)
    assert.equal(next.kpi.postsCount.value, 12)
  })
})

describe('ensureHeatmapCells', () => {
  it('always returns 168 slots indexed day*24+hour', () => {
    const cells = ensureHeatmapCells([
      { dayOfWeek: 6, hour: 10, score: 24, level: 4 },
    ], 24)
    assert.equal(cells.length, 168)
    assert.equal(cells[6 * 24 + 10].score, 24)
    assert.equal(cells[0].score, 0)
    assert.equal(ensureHeatmapCells(undefined).length, 168)
  })
})
