import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  computeMasonryColumnCount,
  distributeMasonryColumns,
  estimateArchetypeWeight,
  extractHostname,
  formatCompactCount,
  formatDuration,
  normalizeSocialPlatform,
  resolveOutlierBadges,
  resolveSocialCardArchetype,
} from '../../lib/social-card.js'

describe('dsh-ui-kit/social-card archetype resolution', () => {
  it('classifies all 6 content archetypes and raw local media accurately', () => {
    assert.equal(
      resolveSocialCardArchetype({
        id: 'x-art',
        platform: 'x',
        contentShape: 'article',
        title: 'The deep work routine',
        excerpt: 'If you can spend 8 hours...',
        sourceUrl: 'https://x.com/user/status/1',
      }),
      'article',
    )

    assert.equal(
      resolveSocialCardArchetype({
        id: 'x-art-inferred',
        platform: 'x',
        title: 'Distinct Article Title',
        excerpt: 'Short preview summary',
        body: 'Full body differs from title',
        sourceUrl: 'https://x.com/user/status/2',
      }),
      'article',
    )

    assert.equal(
      resolveSocialCardArchetype({
        id: 'x-post',
        platform: 'x',
        title: 'Quick tweet text',
        body: 'Quick tweet text',
        sourceUrl: 'https://x.com/user/status/3',
      }),
      'social-post',
    )

    assert.equal(
      resolveSocialCardArchetype({
        id: 'tiktok-1',
        platform: 'tiktok',
        mediaType: 'video',
        sourceUrl: 'https://www.tiktok.com/@u/video/1',
      }),
      'short-video',
    )

    assert.equal(
      resolveSocialCardArchetype({
        id: 'yt-short',
        platform: 'youtube',
        mediaType: 'video',
        sourceUrl: 'https://www.youtube.com/shorts/abc',
      }),
      'short-video',
    )

    assert.equal(
      resolveSocialCardArchetype({
        id: 'ig-1',
        platform: 'instagram',
        mediaType: 'image',
        mediaCount: 3,
        sourceUrl: 'https://instagram.com/p/1',
      }),
      'photo-feed',
    )

    assert.equal(
      resolveSocialCardArchetype({
        id: 'yt-long',
        platform: 'youtube',
        mediaType: 'video',
        coverUrl: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
        durationSec: 3588,
        sourceUrl: 'https://www.youtube.com/watch?v=abc',
      }),
      'landscape-video',
    )

    assert.equal(
      resolveSocialCardArchetype({
        id: 'web-gh',
        title: 'DeepSeek-R1',
        sourceUrl: 'https://github.com/deepseek-ai/DeepSeek-R1',
      }),
      'web-link',
    )

    assert.equal(
      resolveSocialCardArchetype({
        id: 'local-raw',
        mediaType: 'video',
        coverUrl: '/omnimux/inspiration/local/media/covers/c1.jpg',
      }),
      'raw-media',
    )
  })

  it('never fabricates outlier badges when velocity data is absent', () => {
    assert.deepEqual(resolveOutlierBadges(null), [])
    assert.deepEqual(resolveOutlierBadges(undefined), [])
    assert.deepEqual(resolveOutlierBadges({ multiplier: 1.05 }), [])
    assert.deepEqual(resolveOutlierBadges({ multiplier: 1.46, topPercent: 4 }), [
      { label: '1.46×', tone: 'blue' },
      { label: 'Top 4%', tone: 'violet' },
    ])
    assert.deepEqual(resolveOutlierBadges({ multiplier: 6.23 }), [
      { label: '6.23×', tone: 'amber' },
    ])
  })

  it('formats counts, durations, hostnames, and normalized platforms consistently', () => {
    assert.equal(formatCompactCount(5700), '5.7K')
    assert.equal(formatCompactCount(1_500_000), '1.5M')
    assert.equal(formatCompactCount(842), '842')
    assert.equal(formatCompactCount(undefined), undefined)
    assert.equal(formatDuration(28), '0:28')
    assert.equal(formatDuration(3588), '59:48')
    assert.equal(formatDuration(3665), '1:01:05')
    assert.equal(extractHostname('https://www.anthropic.com/engineering'), 'anthropic.com')
    assert.equal(normalizeSocialPlatform('twitter'), 'x')
    assert.equal(normalizeSocialPlatform(undefined, 'https://b23.tv/abc'), 'bilibili')
  })
})

describe('dsh-ui-kit/social-card MasonryGrid column stability', () => {
  it('computes responsive column counts clamped to min/max bounds', () => {
    assert.equal(computeMasonryColumnCount(1440, { minColumnWidth: 236, maxColumns: 6, gap: 12 }), 5)
    assert.equal(computeMasonryColumnCount(760, { minColumnWidth: 236, maxColumns: 2, gap: 10 }), 2)
    assert.equal(computeMasonryColumnCount(320, { minColumnWidth: 236, maxColumns: 5, gap: 12 }), 1)
  })

  it('keeps existing card column assignments stable when paginated batches append', () => {
    const initialItems = [
      { id: 'a', archetype: 'article' },
      { id: 'b', archetype: 'short-video' },
      { id: 'c', archetype: 'social-post' },
      { id: 'd', archetype: 'landscape-video' },
    ]
    const first = distributeMasonryColumns(initialItems, (x) => x.id, 3, undefined, estimateArchetypeWeight)
    const appendedItems = [
      ...initialItems,
      { id: 'e', archetype: 'photo-feed' },
      { id: 'f', archetype: 'web-link' },
    ]
    const second = distributeMasonryColumns(appendedItems, (x) => x.id, 3, first.assignments, estimateArchetypeWeight)

    for (const [id, col] of first.assignments.entries()) {
      assert.equal(second.assignments.get(id), col, `item ${id} must stay in column ${col} after append`)
    }
    assert.equal(second.columns.flat().length, appendedItems.length)
  })
})
