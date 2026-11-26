import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  estimateInspirationCardWeight,
  toCollectionMemberCard,
  toInspirationCardRow,
  toSocialPostCardItem,
} from './inspiration-card.js'
import { rivalCardHeightPx, rivalPlacements } from './rival-masonry.js'
import { zh } from './locales.js'

describe('inspiration cards — shared account-feed mapping', () => {
  it('distinguishes text, photo tweets and video tweets without mutating stored records', () => {
    const rows = [
      { id: 'text', type: 'link', source_platform: 'x', content: '正文', title: '标题' },
      { id: 'photo', type: 'image', source_platform: 'x', content_shape: 'gallery', media_urls: ['https://images.example/1.jpg', 'https://images.example/2.jpg'], ratio: 1.5 },
      { id: 'video', type: 'video', source_platform: 'x', media_urls: ['/omnimux/inspiration/local/media/videos/v_ab12.mp4'] },
    ]
    const before = JSON.stringify(rows)
    const [text, photo, video] = rows.map(toInspirationCardRow)
    assert.equal(text.card_type, 'text')
    assert.equal(text.title, '正文')
    assert.equal(photo.card_type, 'text-media')
    assert.equal(photo.media_kind, 'image')
    assert.equal(photo.image_count, 2)
    assert.equal(photo.ratio, 1.5)
    assert.equal(video.card_type, 'text-media')
    assert.equal(video.media_kind, 'video')
    assert.equal(JSON.stringify(rows), before)
    assert.equal(text.source_row, rows[0])
  })

  it('keeps public videos in the shared video shape and respects landscape-platform geometry', () => {
    assert.equal(toInspirationCardRow({ id: 'public', type: 'video', source_platform: 'tiktok', cover_key: 'cover.jpg' }).card_type, 'short-video')
    assert.equal(toInspirationCardRow({ id: 'youtube', type: 'video', source_platform: 'youtube', cover_key: 'cover.jpg' }).card_type, 'long-video')
    assert.equal(toInspirationCardRow({ id: 'plain', type: 'link', title: '离线文字' }).card_type, 'text')
  })

  it('uses the existing shortest-column layout for mixed library content and stable appends', () => {
    const rows = [
      { id: 'short', type: 'link', source_platform: 'x', title: '短文' },
      { id: 'video', type: 'video', source_platform: 'tiktok', cover_key: 'cover.jpg' },
      { id: 'long', type: 'link', source_platform: 'x', title: '长文内容'.repeat(80) },
      { id: 'image', type: 'image', source_platform: 'x', media_urls: ['https://images.example/1.jpg'] },
    ].map(toInspirationCardRow)
    const initial = rivalPlacements(rows.slice(0, 3), 2, 250)
    const appended = rivalPlacements(rows, 2, 250)
    for (const [id, placement] of initial.placements) {
      assert.deepEqual(appended.placements.get(id), placement)
    }
    assert.notEqual(appended.placements.get('video').height, appended.placements.get('short').height)
    for (const [id, item] of appended.placements) {
      for (const [otherId, other] of appended.placements) {
        if (id !== otherId && item.col === other.col && item.top < other.top) {
          assert.ok(item.top + item.height <= other.top)
        }
      }
    }
  })

  it('uses the visible failure or importing notice as the measured text body', () => {
    const t = (key) => zh[key] || key
    const row = { id: 'failed', title: '原始标题', source_platform: 'x', type: 'link', import_status: 'failed', import_error: '导入中断，请重试。'.repeat(30) }
    const failed = toInspirationCardRow(row, t)
    assert.equal(failed.title, zh['add.failedDetail'].replace('{error}', row.import_error))
    assert.equal(failed.notice_kind, 'error')
    const failedVideo = toInspirationCardRow({ ...row, type: 'video' }, t)
    assert.equal(failedVideo.card_type, 'text', 'a failed import with no saved media needs its readable error body')
    assert.equal(failedVideo.title, failed.title)
    assert.equal(failed.source_row.title, '原始标题')
    // 帖子卡正文最多 3 行：再长的失败原因也只占 3 行，高度按 3 行记。
    assert.equal(rivalCardHeightPx(failed, 250), Math.max(144, 24 + 3 * 20 + 24 + 2))
    const importing = toInspirationCardRow({ ...row, import_status: 'importing', import_stage: 'downloading' }, t)
    assert.equal(importing.title, zh['add.status.downloading'])
    assert.equal(importing.notice_kind, 'importing')
  })

})


describe('inspiration cards — typed post attachments', () => {
  it('counts saved images for image and mixed-video posts while keeping the shared shapes', () => {
    const media = [{ type: 'image', url: '/omnimux/inspiration/local/media/images/a.jpg' }, { type: 'image', url: '/omnimux/inspiration/local/media/images/b.jpg' }]
    const image = toInspirationCardRow({ id: 'typed-image', source_platform: 'x', type: 'image', media_urls: [], media_items: media })
    assert.equal(image.image_count, 2)
    assert.equal(image.cover_key, media[0].url)
    assert.equal(image.media_kind, 'image')
    const mixed = toInspirationCardRow({ id: 'typed-mixed', source_platform: 'x', type: 'video', media_urls: ['/omnimux/inspiration/local/media/videos/a.mp4'], media_items: [media[0], { type: 'video', url: '/omnimux/inspiration/local/media/videos/a.mp4' }, media[1]] })
    assert.equal(mixed.image_count, 2)
    assert.equal(mixed.card_type, 'text-media')
    assert.equal(mixed.media_kind, 'video')
  })
})

describe('inspiration cards — 6-archetype SocialPostCard mapping', () => {
  const zhEntries = new Map(Object.entries(zh))
  const t = (key) => zhEntries.get(key) || key

  it('resolves all 6 semantic archetypes from structured row fields without fabricating outlier metrics', () => {
    const article = toSocialPostCardItem({
      id: 'a1',
      source_platform: 'x',
      type: 'link',
      content_shape: 'article',
      title: 'Long-Form Systems Essay',
      excerpt: 'How composable abstractions beat framework sprawl.',
      content: 'How composable abstractions beat framework sprawl.',
      cover_url: 'https://pbs.twimg.com/media/article.jpg',
      author: { name: 'Dan', handle: 'dan_koe', profile_image_url_https: 'https://pbs.twimg.com/p/dan.jpg' },
      stats: { likes: 5700, shares: 750 },
      velocity: { multiplier: 1.46, top_percent: 4 },
      source_url: 'https://x.com/dan_koe/status/1',
    }, t)
    assert.equal(article.archetype, 'article')
    assert.equal(article.title, 'Long-Form Systems Essay')
    assert.equal(article.author?.avatarUrl, 'https://pbs.twimg.com/p/dan.jpg')
    assert.equal(article.outlierBadges?.length, 2)

    const shortVideo = toSocialPostCardItem({
      id: 'sv1',
      source_platform: 'tiktok',
      type: 'video',
      duration: 28,
      ratio: 9 / 16,
      media_urls: ['/omnimux/inspiration/local/media/videos/sv1.mp4'],
      source_url: 'https://www.tiktok.com/@creator/video/1',
    }, t)
    assert.equal(shortVideo.archetype, 'short-video')
    assert.deepEqual(shortVideo.outlierBadges, [])

    const photoFeed = toSocialPostCardItem({
      id: 'pf1',
      source_platform: 'instagram',
      type: 'image',
      content_shape: 'gallery',
      media_urls: ['https://cdn.example/1.jpg', 'https://cdn.example/2.jpg'],
      source_url: 'https://www.instagram.com/p/abc/',
    }, t)
    assert.equal(photoFeed.archetype, 'photo-feed')
    assert.equal(photoFeed.mediaCount, 2)

    const landscapeVideo = toSocialPostCardItem({
      id: 'lv1',
      source_platform: 'youtube',
      type: 'video',
      duration: 840,
      cover_url: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
      source_url: 'https://www.youtube.com/watch?v=abc',
    }, t)
    assert.equal(landscapeVideo.archetype, 'landscape-video')

    const socialPost = toSocialPostCardItem({
      id: 'sp1',
      source_platform: 'x',
      type: 'link',
      content: 'Short X post with real stats only',
      source_url: 'https://x.com/builder/status/2',
    }, t)
    assert.equal(socialPost.archetype, 'social-post')

    const webLink = toSocialPostCardItem({
      id: 'wl1',
      source_platform: 'web',
      type: 'link',
      title: 'Building Effective Agents',
      favicon_url: 'https://www.anthropic.com/favicon.ico',
      source_url: 'https://www.anthropic.com/research/building-effective-agents',
    }, t)
    assert.equal(webLink.archetype, 'web-link')
    assert.equal(webLink.hostname, 'anthropic.com')
    assert.equal(webLink.faviconUrl, 'https://www.anthropic.com/favicon.ico')
  })

  it('preserves collection membership flag and positive balanced weights', () => {
    const member = toCollectionMemberCard({
      id: 'm1',
      source_platform: 'tiktok',
      type: 'video',
      cover_key: 'cover.jpg',
      source_url: 'https://www.tiktok.com/@a/video/1',
    }, t)
    assert.equal(member.in_collection, true)
    assert.equal(member.archetype, 'short-video')
    assert.ok(estimateInspirationCardWeight(member) > estimateInspirationCardWeight({
      card_type: 'web-link',
      social_item: { id: 'w', platform: 'web', title: 'Site', sourceUrl: 'https://example.com' },
    }))
    assert.ok(estimateInspirationCardWeight({ card_type: 'collection' }) > 1)
  })
})
