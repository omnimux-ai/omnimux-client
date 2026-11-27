import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatSocialRelativeTime,
  isSafeHttpUrl,
  isSafeMediaSrc,
  parseSocialToolBlock,
} from '../../lib/social-card.js'

const FIXED_NOW = Date.parse('2026-11-27T12:00:00.000Z')

describe('dsh-ui-kit/social-card toolview parser', () => {
  it('handles preparing and start running blocks gracefully', () => {
    const preparing = parseSocialToolBlock({ phase: 'preparing', callId: 'c1', name: 'omnimux_x_search' }, 'omnimux_x_search')
    assert.equal(preparing.phase, 'running')
    assert.equal(preparing.platform, 'x')
    assert.equal(preparing.querySummary, undefined)
    assert.deepEqual(preparing.items, [])

    const started = parseSocialToolBlock(
      { phase: 'start', callId: 'c2', name: 'omnimux_tiktok_search', argsRaw: '{"query":"ai agents"}' },
      'omnimux_tiktok_search',
    )
    assert.equal(started.phase, 'running')
    assert.equal(started.platform, 'tiktok')
    assert.equal(started.querySummary, 'ai agents')

    const brokenArgs = parseSocialToolBlock(
      { phase: 'start', callId: 'c3', name: 'omnimux_x_search', argsRaw: '{broken' },
      'omnimux_x_search',
    )
    assert.equal(brokenArgs.phase, 'running')
    assert.equal(brokenArgs.querySummary, undefined)
  })

  it('handles settled error blocks and empty sentinel / empty lists', () => {
    const errored = parseSocialToolBlock(
      {
        kind: 'tool-result',
        callId: 'c-err',
        isError: true,
        call: { name: 'omnimux_x_tweet', argsRaw: '{"url":"https://x.com/u/status/1"}' },
        content: [{ type: 'text', text: '[needs-omnimux] 请先登录 OmniMux' }],
      },
      'omnimux_x_tweet',
    )
    assert.equal(errored.phase, 'error')
    assert.match(errored.errorMessage || '', /needs-omnimux/)
    assert.equal(errored.querySummary, 'https://x.com/u/status/1')

    const sentinel = parseSocialToolBlock(
      {
        kind: 'tool-result',
        callId: 'c-sentinel',
        call: { name: 'omnimux_tiktok_search', argsRaw: '{"query":"empty"}' },
        content: [{ type: 'text', text: JSON.stringify({ platform: 'tiktok', capability: 'search', value: 'empty', data: { text: null } }) }],
      },
      'omnimux_tiktok_search',
    )
    assert.equal(sentinel.phase, 'empty')
    assert.equal(sentinel.totalCount, 0)

    const emptyList = parseSocialToolBlock(
      {
        kind: 'tool-result',
        callId: 'c-empty',
        call: { name: 'inspiration_search', argsRaw: '{"query":"none"}' },
        content: [{ type: 'text', text: JSON.stringify({ count: 0, items: [], inspirations: [] }) }],
      },
      'inspiration_search',
    )
    assert.equal(emptyList.phase, 'empty')
    assert.equal(emptyList.totalCount, 0)
  })

  it('parses X Long Article and regular note_tweet posts into distinct archetypes', () => {
    const block = {
      kind: 'tool-result',
      callId: 'c-x',
      call: { name: 'omnimux_x_search', argsRaw: '{"query":"deep work"}' },
      content: [{
        type: 'text',
        text: JSON.stringify({
          platform: 'x',
          capability: 'search',
          value: 'deep work',
          data: {
            timeline: [
              {
                id_str: '2094156823020323038',
                content_shape: 'article',
                created_at: '2026-11-27T08:00:00.000Z',
                article: {
                  article_results: {
                    result: {
                      title: 'The deep work routine that changed my life',
                      preview_text: 'If you can spend 8 hours building someone else’s dream...',
                      cover_media: { media_info: { original_img_url: 'https://pbs.twimg.com/media/article-cover.jpg' } },
                      plain_text: 'Long article plain body text...',
                    },
                  },
                },
                user: { name: 'DAN KOE', screen_name: 'thedankoe', profile_image_url_https: 'https://pbs.twimg.com/avatar1.jpg' },
                engagement: { likes: 5700, retweets: 750 },
              },
              {
                id_str: '2094156823020323039',
                created_at: '2026-11-27T10:00:00.000Z',
                note_tweet: { note_tweet_results: { result: { text: 'Full note tweet text with &amp; entity decoded.' } } },
                text: 'Truncated preview...',
                user: { name: 'Elena', screen_name: 'elena_ai', profile_image_url_https: 'https://pbs.twimg.com/avatar2.jpg' },
                mediaDetails: [
                  { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/photo1.jpg' },
                ],
                engagement: { likes: 420, retweets: 32 },
              },
            ],
          },
        }),
      }],
    }

    const parsed = parseSocialToolBlock(block, 'omnimux_x_search', { locale: 'en', nowMs: FIXED_NOW })
    assert.equal(parsed.phase, 'ready')
    assert.equal(parsed.platform, 'x')
    assert.equal(parsed.totalCount, 2)

    const [article, regular] = parsed.items
    assert.equal(article?.archetype, 'article')
    assert.equal(article?.title, 'The deep work routine that changed my life')
    assert.equal(article?.excerpt, 'If you can spend 8 hours building someone else’s dream...')
    assert.equal(article?.coverUrl, 'https://pbs.twimg.com/media/article-cover.jpg')
    assert.equal(article?.author?.avatarUrl, 'https://pbs.twimg.com/avatar1.jpg')
    assert.equal(article?.publishedLabel, '4h')
    assert.equal(article?.outlierBadges, undefined)

    assert.equal(regular?.archetype, 'social-post')
    assert.equal(regular?.body, 'Full note tweet text with & entity decoded.')
    assert.equal(regular?.coverUrl, 'https://pbs.twimg.com/media/photo1.jpg')
    assert.equal(regular?.sourceUrl, 'https://x.com/i/status/2094156823020323039')
  })

  it('parses TikTok search aweme_info envelopes and converts duration milliseconds to seconds', () => {
    const block = {
      kind: 'tool-result',
      callId: 'c-tt',
      call: { name: 'omnimux_tiktok_search', argsRaw: '{"query":"gemini workflow"}' },
      content: [{
        type: 'text',
        text: JSON.stringify({
          platform: 'tiktok',
          capability: 'search',
          value: 'gemini workflow',
          data: {
            aweme_list: [
              {
                aweme_info: {
                  aweme_id: '7412345678901234567',
                  desc: 'POV morning AI workflow',
                  create_time: 1795770000,
                  author: {
                    nickname: 'MythicShadowws',
                    unique_id: 'mythicshadowws',
                    avatar_thumb: { url_list: ['https://p16.tiktokcdn.com/avatar.jpg'] },
                  },
                  video: {
                    duration: 28400,
                    width: 720,
                    height: 1280,
                    cover: { url_list: ['https://p16.tiktokcdn.com/cover.jpg'] },
                    play_addr: { url_list: ['https://v16.tiktokcdn.com/video.mp4'] },
                  },
                  statistics: { digg_count: 1500000, share_count: 73000, play_count: 12000000 },
                },
              },
            ],
          },
        }),
      }],
    }

    const parsed = parseSocialToolBlock(block, 'omnimux_tiktok_search', { locale: 'en', nowMs: FIXED_NOW })
    assert.equal(parsed.phase, 'ready')
    const item = parsed.items[0]
    assert.equal(item?.archetype, 'short-video')
    assert.equal(item?.durationSec, 28)
    assert.equal(item?.coverUrl, 'https://p16.tiktokcdn.com/cover.jpg')
    assert.equal(item?.metrics?.likes, 1500000)
    assert.equal(item?.metrics?.reposts, 73000)
    assert.equal(item?.sourceUrl, 'https://www.tiktok.com/video/7412345678901234567')
  })

  it('parses Instagram photo feeds and passes through user/hashtag-only search results', () => {
    const igPosts = parseSocialToolBlock(
      {
        kind: 'tool-result',
        callId: 'c-ig-posts',
        call: { name: 'omnimux_instagram_posts', argsRaw: '{"username":"creator_swift"}' },
        content: [{
          type: 'text',
          text: JSON.stringify({
            platform: 'instagram',
            capability: 'posts',
            data: {
              items: [
                {
                  pk: '35001234',
                  code: 'DB_xyz123',
                  taken_at: 1795700000,
                  caption: { text: 'One extra prompt can make your AI images look real.' },
                  user: { username: 'creator_swift', full_name: 'Rudra Mukherjee', profile_pic_url: 'https://scontent.cdninstagram.com/av.jpg' },
                  image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/cover.jpg' }] },
                  carousel_media: [{ display_url: 'https://scontent.cdninstagram.com/c1.jpg' }, { display_url: 'https://scontent.cdninstagram.com/c2.jpg' }],
                  like_count: 30000,
                  video_view_count: 1400000,
                },
              ],
            },
          }),
        }],
      },
      'omnimux_instagram_posts',
    )
    assert.equal(igPosts.phase, 'ready')
    assert.equal(igPosts.items[0]?.archetype, 'photo-feed')
    assert.equal(igPosts.items[0]?.mediaCount, 2)
    assert.equal(igPosts.items[0]?.sourceUrl, 'https://www.instagram.com/p/DB_xyz123')
    assert.equal(igPosts.items[0]?.metrics?.views, 1400000)

    const igUserOnlySearch = parseSocialToolBlock(
      {
        kind: 'tool-result',
        callId: 'c-ig-search',
        call: { name: 'omnimux_instagram_search', argsRaw: '{"query":"design"}' },
        content: [{
          type: 'text',
          text: JSON.stringify({
            platform: 'instagram',
            capability: 'search',
            data: { users: [{ username: 'design_daily' }], hashtags: [{ name: 'design' }] },
          }),
        }],
      },
      'omnimux_instagram_search',
    )
    assert.equal(igUserOnlySearch.phase, 'passthrough')
  })

  it('parses YouTube videoRenderer and flat video responses, and distinguishes Shorts', () => {
    const ytSearch = parseSocialToolBlock(
      {
        kind: 'tool-result',
        callId: 'c-yt',
        call: { name: 'omnimux_youtube_search', argsRaw: '{"query":"gemini"}' },
        content: [{
          type: 'text',
          text: JSON.stringify({
            platform: 'youtube',
            capability: 'search',
            value: 'gemini',
            data: {
              contents: [
                {
                  videoRenderer: {
                    videoId: 'dQw4w9WgXcQ',
                    title: { runs: [{ text: 'Gemini Multimodal Live Benchmark' }] },
                    thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' }] },
                    ownerText: { runs: [{ text: 'MKBHD' }] },
                    lengthText: { simpleText: '14:22' },
                    viewCountText: { simpleText: '412K views' },
                    publishedTimeText: { simpleText: '3 days ago' },
                  },
                },
                {
                  videoId: 'abcDEF12345',
                  title: 'Quick Tip',
                  url: 'https://www.youtube.com/shorts/abcDEF12345',
                  thumbnail_url: 'https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg',
                  duration: 24,
                  views: 98000,
                },
              ],
            },
          }),
        }],
      },
      'omnimux_youtube_search',
    )
    assert.equal(ytSearch.phase, 'ready')
    assert.equal(ytSearch.totalCount, 2)
    assert.equal(ytSearch.items[0]?.archetype, 'landscape-video')
    assert.equal(ytSearch.items[0]?.durationSec, 862)
    assert.equal(ytSearch.items[0]?.metrics?.views, 412000)
    assert.equal(ytSearch.items[0]?.author?.name, 'MKBHD')
    assert.equal(ytSearch.items[1]?.archetype, 'short-video')
  })

  it('routes omnimux_social_data non-post capabilities to passthrough and rewrites inspiration media URLs', () => {
    const shopPassthrough = parseSocialToolBlock(
      {
        kind: 'tool-result',
        callId: 'c-sd-user',
        call: { name: 'omnimux_social_data', argsRaw: '{"platform":"x","capability":"user","id":"thedankoe"}' },
        content: [{
          type: 'text',
          text: JSON.stringify({
            platform: 'x',
            capability: 'user',
            value: 'thedankoe',
            data: { screen_name: 'thedankoe', followers_count: 728400 },
          }),
        }],
      },
      'omnimux_social_data',
    )
    assert.equal(shopPassthrough.phase, 'passthrough')
    assert.equal(shopPassthrough.capability, 'user')

    const insp = parseSocialToolBlock(
      {
        kind: 'tool-result',
        callId: 'c-insp',
        call: { name: 'omnimux_inspiration_list', argsRaw: '{"q":"hook"}' },
        content: [{
          type: 'text',
          text: JSON.stringify({
            items: [
              {
                id: 'insp_1',
                source_platform: 'tiktok',
                title: 'Hook test',
                cover_url: 'https://omnimux.ai/api/inspiration/v1/media/covers/c1.jpg',
                source_url: 'https://www.tiktok.com/@a/video/7412345678901234567',
                stats: { likes: 1000, views: 50000 },
                velocity: { multiplier: 6.2, topPercent: 4 },
              },
            ],
          }),
        }],
      },
      'omnimux_inspiration_list',
    )
    assert.equal(insp.phase, 'ready')
    assert.equal(insp.items[0]?.coverUrl, '/omnimux/inspiration/media/covers/c1.jpg')
    assert.deepEqual(insp.items[0]?.outlierBadges, [
      { label: '6.2×', tone: 'amber' },
      { label: 'Top 4%', tone: 'violet' },
    ])
  })

  it('blocks unsafe javascript:, data:, traversal, query/fragment smuggling, and crafted videoIds', () => {
    assert.equal(isSafeHttpUrl('https://x.com/user/status/1'), true)
    assert.equal(isSafeHttpUrl('javascript:alert(1)'), false)
    assert.equal(isSafeMediaSrc('/omnimux/inspiration/local/media/covers/c1.jpg'), true)
    assert.equal(isSafeMediaSrc('/omnimux/inspiration/media/covers/c1.jpg'), true)
    assert.equal(isSafeMediaSrc('data:text/html,<script>alert(1)</script>'), false)
    assert.equal(isSafeMediaSrc('/omnimux/inspiration/media/../etc/passwd'), false)
    assert.equal(isSafeMediaSrc('/omnimux/inspiration/media/%2e%2e/etc/passwd'), false)
    assert.equal(isSafeMediaSrc('/omnimux/inspiration/media/%2E%2E%2Fsecret.jpg'), false)
    assert.equal(isSafeMediaSrc('/omnimux/inspiration/media/covers/c1.jpg?pat=leak'), false)
    assert.equal(isSafeMediaSrc('/omnimux/inspiration/media/covers/c1.jpg#frag'), false)
    assert.equal(isSafeMediaSrc('/omnimux/inspiration/media/covers\\evil.jpg'), false)
    assert.equal(isSafeMediaSrc('/omnimux/inspiration/local/import-url'), false)

    const parsed = parseSocialToolBlock(
      {
        kind: 'tool-result',
        callId: 'c-xss',
        call: { name: 'omnimux_x_search' },
        content: [{
          type: 'text',
          text: JSON.stringify({
            timeline: [
              {
                id_str: '9999999',
                text: 'Safe text with bad links stripped',
                url: 'javascript:alert(1)',
                cover_url: '/omnimux/inspiration/media/%2e%2e/secret',
              },
              {
                id: 'yt-crafted-1',
                title: 'Crafted videoId must not forge watch URL',
                videoId: 'abc&list=PL_evil#frag',
              },
            ],
          }),
        }],
      },
      'omnimux_x_search',
    )
    assert.equal(parsed.phase, 'ready')
    assert.equal(parsed.items[0]?.sourceUrl, 'https://x.com/i/status/9999999')
    assert.equal(parsed.items[0]?.coverUrl, undefined)
    assert.equal(parsed.items[1]?.sourceUrl, undefined)
  })

  it('handles inspiration_get, inspiration_rival_post cached media, non-post arrays, and error.reason', () => {
    const rivalSingle = parseSocialToolBlock(
      {
        kind: 'tool-result',
        callId: 'c-riv-single',
        call: { name: 'inspiration_rival_post', argsRaw: '{"account_id":"riv_1","post_id":"p_1"}' },
        content: [{
          type: 'text',
          text: JSON.stringify({
            post: {
              id: 'p_1',
              type: 'video',
              url: 'https://www.tiktok.com/@creator/video/7412345678901234567',
              cover_http_url: '/omnimux/inspiration/local/media/rival-accounts/covers/x.jpg',
              cover_url: 'https://expired.remote/cdn.jpg',
              duration: 19,
            },
            account: {
              id: 'riv_1',
              platform: 'tiktok',
              handle: '@creator',
              nickname: 'Creator Lab',
              avatar_http_url: '/omnimux/inspiration/local/media/rival-accounts/avatars/a.jpg',
            },
          }),
        }],
      },
      'inspiration_rival_post',
    )
    assert.equal(rivalSingle.phase, 'ready')
    assert.equal(rivalSingle.items[0]?.coverUrl, '/omnimux/inspiration/local/media/rival-accounts/covers/x.jpg')
    assert.equal(rivalSingle.items[0]?.author?.avatarUrl, '/omnimux/inspiration/local/media/rival-accounts/avatars/a.jpg')

    const primitiveArray = parseSocialToolBlock(
      {
        kind: 'tool-result',
        callId: 'c-arr',
        call: { name: 'omnimux_social_data', argsRaw: '{"capability":"search"}' },
        content: [{ type: 'text', text: '[1, 2, 3]' }],
      },
      'omnimux_social_data',
    )
    assert.equal(primitiveArray.phase, 'passthrough')

    const reasonErr = parseSocialToolBlock(
      {
        kind: 'tool-result',
        callId: 'c-err-reason',
        isError: true,
        error: { name: 'ToolError', code: 'E_RATE', reason: 'Upstream backoff 30s' },
        content: [],
      },
      'omnimux_x_search',
    )
    assert.equal(reasonErr.phase, 'error')
    assert.equal(reasonErr.errorMessage, 'Upstream backoff 30s')
  })

  it('formats relative time cleanly without middle dots', () => {
    assert.equal(formatSocialRelativeTime(FIXED_NOW - 120_000, 'en', FIXED_NOW), '2m')
    assert.equal(formatSocialRelativeTime(FIXED_NOW - 7_200_000, 'zh', FIXED_NOW), '2小时前')
    assert.equal(formatSocialRelativeTime('2026-11-24T12:00:00.000Z', 'en', FIXED_NOW)?.includes('·'), false)
  })
})
