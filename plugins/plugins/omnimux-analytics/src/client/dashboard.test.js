import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fixture from './mock/dashboard-fixture.json' with { type: 'json' }
import { formatCount, formatEr } from './format.js'
import { sortTopPostsDefault } from './sort.js'

describe('dashboard fixture as the Phase-3 visual source of truth', () => {
  it('formats the five KPI cards the way the prototype does', () => {
    assert.equal(formatEr(fixture.kpi.engagementRate.value), '2.26%')
    assert.equal(formatCount(fixture.kpi.totalReach.value), '1.9K')
    assert.equal(formatCount(fixture.kpi.totalFollowers.value), '635')
    assert.equal(formatCount(fixture.kpi.followerDiff.value), '17')
    assert.equal(formatCount(fixture.kpi.postsCount.value), '12')
    assert.equal(formatCount(fixture.kpi.bestPost.views), '930')
    assert.equal(fixture.kpi.postsHealth, 'normal')
  })

  it('keeps nine engagement series with the contracted default visibility', () => {
    const visible = fixture.engagementOverTime.series.filter((s) => s.defaultVisible).map((s) => s.key)
    assert.deepEqual(visible, ['likes', 'comments', 'shares', 'views', 'er'])
    assert.equal(fixture.engagementOverTime.series.find((s) => s.key === 'er').dashed, true)
    assert.equal(fixture.engagementOverTime.series.find((s) => s.key === 'views').yAxis, 1)
  })

  it('ranks top posts by ER then views, matching the contract default', () => {
    assert.deepEqual(
      sortTopPostsDefault(fixture.topPosts).map((p) => p.postId),
      ['post_ep2_clip', 'post_teaser', 'post_ep1_pilot'],
    )
    assert.equal(formatEr(fixture.platformBreakdown[0].er), '2.28%')
    assert.equal(formatCount(fixture.platformBreakdown[0].views), '1.9K')
    assert.equal(formatCount(fixture.platformBreakdown[0].saves), '-')
  })
})
