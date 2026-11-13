import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { compareNullable, filterTopPosts, sortRows, sortTopPostsDefault } from './sort.js'

describe('compareNullable', () => {
  it('sinks null in both directions so missing never sorts as zero', () => {
    const rows = [
      { id: 'a', likes: 10 },
      { id: 'b', likes: null },
      { id: 'c', likes: 2 },
      { id: 'd', likes: undefined },
    ]
    assert.deepEqual(sortRows(rows, 'likes', 'asc').map((r) => r.id), ['c', 'a', 'b', 'd'])
    assert.deepEqual(sortRows(rows, 'likes', 'desc').map((r) => r.id), ['a', 'c', 'b', 'd'])
  })
})

describe('sortTopPostsDefault', () => {
  it('orders by ER desc then views desc, matching the fixture ranking', () => {
    const rows = [
      { postId: 'post_ep1_pilot', er: 0.0183, views: 930 },
      { postId: 'post_ep2_clip', er: 0.0317, views: 630 },
      { postId: 'post_teaser', er: 0.0215, views: 325 },
    ]
    assert.deepEqual(
      sortTopPostsDefault(rows).map((r) => r.postId),
      ['post_ep2_clip', 'post_teaser', 'post_ep1_pilot'],
    )
  })
})

describe('filterTopPosts', () => {
  const posts = [
    { postId: 'post_ep1_pilot', title: '第1集 正片首发 (Episode 1 Pilot)' },
    { postId: 'post_teaser', title: '悬疑短剧上线前瞻预告 (Teaser)' },
  ]

  it('matches title or id case-insensitively and ignores blank queries', () => {
    assert.equal(filterTopPosts(posts, '').length, 2)
    assert.equal(filterTopPosts(posts, '   ').length, 2)
    assert.deepEqual(filterTopPosts(posts, 'TEASER').map((p) => p.postId), ['post_teaser'])
    assert.deepEqual(filterTopPosts(posts, 'post_ep1').map((p) => p.postId), ['post_ep1_pilot'])
    assert.deepEqual(filterTopPosts(posts, 'zzz'), [])
  })
})

describe('compareNullable strings', () => {
  it('compares platform labels without treating them as numbers', () => {
    assert.ok(compareNullable('TikTok', 'YouTube', 'asc') < 0)
    assert.equal(compareNullable(null, 'TikTok', 'asc'), 1)
  })
})
