import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_TIKTOK_OPTIONS,
  TIKTOK_BRANDED_CONTENT_URL,
  TIKTOK_MUSIC_USAGE_URL,
  TIKTOK_PRIVACY_LEVELS,
  aggregateCreatorInfo,
  buildCreateTikTokOptions,
  normalizeTikTokOptions,
  privacyChoices,
  tiktokOptionProblems,
} from './tiktok-options.js'

describe('normalizeTikTokOptions', () => {
  it('fills defaults and keeps booleans strict', () => {
    assert.deepEqual(normalizeTikTokOptions(undefined), { ...DEFAULT_TIKTOK_OPTIONS })
    assert.equal(DEFAULT_TIKTOK_OPTIONS.privacy_level, '')
    assert.equal(DEFAULT_TIKTOK_OPTIONS.allow_comment, false)
    assert.equal(DEFAULT_TIKTOK_OPTIONS.allow_duet, false)
    assert.equal(DEFAULT_TIKTOK_OPTIONS.allow_stitch, false)
    const options = normalizeTikTokOptions({ privacy_level: 'public_to_everyone', allow_comment: 'false', commercial_content: 1 })
    assert.equal(options.privacy_level, 'PUBLIC_TO_EVERYONE')
    assert.equal(options.allow_comment, false)
    assert.equal(options.commercial_content, false)
  })

  it('drops unknown privacy levels back to SELF_ONLY', () => {
    // Updated per Issue #186 (§2.b): unknown or empty privacy_level normalizes to '' (no preset default).
    assert.equal(normalizeTikTokOptions({ privacy_level: 'EVERYONE' }).privacy_level, '')
    assert.equal(normalizeTikTokOptions({ privacy_level: '' }).privacy_level, '')
    assert.equal(normalizeTikTokOptions({}).privacy_level, '')
  })

  it('clears commercial sub-flags when commercial_content is false', () => {
    const normalized = normalizeTikTokOptions({
      privacy_level: 'SELF_ONLY',
      commercial_content: false,
      your_brand: true,
      branded_content: true,
    })
    assert.equal(normalized.your_brand, false)
    assert.equal(normalized.branded_content, false)
  })

  it('accepts every documented privacy level', () => {
    for (const level of TIKTOK_PRIVACY_LEVELS) {
      assert.equal(normalizeTikTokOptions({ privacy_level: level }).privacy_level, level)
    }
  })
})

describe('privacyChoices', () => {
  it('trusts creator-info options when present', () => {
    assert.deepEqual(privacyChoices({ privacy_level_options: ['SELF_ONLY'] }), ['SELF_ONLY'])
    assert.deepEqual(
      privacyChoices({ privacy_level_options: ['public_to_everyone', 'SELF_ONLY'] }),
      ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
    )
  })

  it('falls back to all levels when creator-info is missing or empty', () => {
    assert.deepEqual(privacyChoices(null), [...TIKTOK_PRIVACY_LEVELS])
    assert.deepEqual(privacyChoices({ privacy_level_options: [] }), [...TIKTOK_PRIVACY_LEVELS])
    assert.deepEqual(privacyChoices({ privacy_level_options: ['UNKNOWN'] }), [...TIKTOK_PRIVACY_LEVELS])
  })
})

describe('tiktokOptionProblems', () => {
  it('accepts the default combination', () => {
    // Updated per Issue #186 (§2.b + §4): empty defaults require explicit privacy_level and music confirmation.
    assert.deepEqual(
      tiktokOptionProblems(normalizeTikTokOptions(undefined)),
      ['privacy-level-required', 'music-confirmation-required'],
    )
    assert.deepEqual(
      tiktokOptionProblems(normalizeTikTokOptions({ privacy_level: 'PUBLIC_TO_EVERYONE', music_usage_confirmed: true })),
      [],
    )
  })

  it('requires a commercial kind and music confirmation', () => {
    assert.deepEqual(
      tiktokOptionProblems(normalizeTikTokOptions({ commercial_content: true })),
      ['privacy-level-required', 'commercial-brand-required', 'music-confirmation-required'],
    )
  })

  it('refuses branded content with SELF_ONLY', () => {
    assert.deepEqual(
      tiktokOptionProblems(normalizeTikTokOptions({
        privacy_level: 'SELF_ONLY',
        commercial_content: true,
        branded_content: true,
        music_usage_confirmed: true,
      })),
      ['branded-requires-public'],
    )
    assert.deepEqual(
      tiktokOptionProblems(normalizeTikTokOptions({
        commercial_content: true,
        branded_content: true,
        music_usage_confirmed: true,
      })),
      ['privacy-level-required'],
    )
  })

  it('allows dual your_brand + branded_content when privacy is non-private and checks allowedPrivacyLevels', () => {
    assert.deepEqual(
      tiktokOptionProblems(
        normalizeTikTokOptions({
          privacy_level: 'PUBLIC_TO_EVERYONE',
          commercial_content: true,
          your_brand: true,
          branded_content: true,
          music_usage_confirmed: true,
        }),
        { allowedPrivacyLevels: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'] },
      ),
      [],
    )
    assert.deepEqual(
      tiktokOptionProblems(
        normalizeTikTokOptions({
          privacy_level: 'PUBLIC_TO_EVERYONE',
          music_usage_confirmed: true,
        }),
        { allowedPrivacyLevels: ['SELF_ONLY'] },
      ),
      ['privacy-level-disallowed'],
    )
    assert.deepEqual(
      tiktokOptionProblems(
        normalizeTikTokOptions({ privacy_level: 'PUBLIC_TO_EVERYONE' }),
        { requireMusicConfirmation: false },
      ),
      [],
    )
  })
})

describe('buildCreateTikTokOptions', () => {
  it('returns undefined when nothing was stored', () => {
    assert.equal(buildCreateTikTokOptions(undefined), undefined)
    assert.equal(buildCreateTikTokOptions(null), undefined)
  })

  it('maps interaction toggles and privacy level', () => {
    assert.deepEqual(
      buildCreateTikTokOptions({ privacy_level: 'PUBLIC_TO_EVERYONE', allow_comment: false, allow_duet: false, allow_stitch: true }),
      { privacy_level: 'PUBLIC_TO_EVERYONE', allow_comment: false, allow_duet: false, allow_stitch: true },
    )
  })

  it('omits allow_duet and allow_stitch for image posts and enforces account-disabled interactions', () => {
    const photoBody = buildCreateTikTokOptions(
      { privacy_level: 'PUBLIC_TO_EVERYONE', allow_comment: true, allow_duet: true, allow_stitch: true, music_usage_confirmed: true },
      { type: 'image' },
    )
    assert.equal(photoBody.allow_comment, true)
    assert.equal(Object.hasOwn(photoBody, 'allow_duet'), false)
    assert.equal(Object.hasOwn(photoBody, 'allow_stitch'), false)

    const disabledVideo = buildCreateTikTokOptions(
      { privacy_level: 'PUBLIC_TO_EVERYONE', allow_comment: true, allow_duet: true, allow_stitch: true },
      { type: 'video', creatorInfo: { comment_disabled: true, duet_disabled: true, stitch_disabled: false } },
    )
    assert.equal(disabledVideo.allow_comment, false)
    assert.equal(disabledVideo.allow_duet, false)
    assert.equal(disabledVideo.allow_stitch, true)
  })

  it('includes commercial disclosure and music confirmation only when chosen', () => {
    const body = buildCreateTikTokOptions({
      privacy_level: 'PUBLIC_TO_EVERYONE', commercial_content: true, your_brand: true, branded_content: true, music_usage_confirmed: true,
    })
    assert.equal(body.commercial_content, true)
    assert.equal(body.your_brand, true)
    assert.equal(body.branded_content, true)
    assert.equal(body.music_usage_confirmed, true)
    const plain = buildCreateTikTokOptions({ privacy_level: 'SELF_ONLY' })
    assert.equal(Object.hasOwn(plain, 'commercial_content'), false)
    assert.equal(Object.hasOwn(plain, 'music_usage_confirmed'), false)
  })
})

describe('aggregateCreatorInfo', () => {
  it('computes privacy intersection, minimum duration, and disabled interaction union across multiple direct accounts', () => {
    const agg = aggregateCreatorInfo([
      {
        account_id: 'a1',
        display_name: 'Creator One',
        data: {
          data: {
            creator_nickname: 'Alice',
            privacy_level_options: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
            max_video_post_duration_sec: 600,
            comment_disabled: false,
            duet_disabled: true,
            stitch_disabled: false,
          },
        },
      },
      {
        account_id: 'a2',
        display_name: 'Creator Two',
        data: {
          creator_nickname: 'Bob',
          privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
          max_video_post_duration_sec: 180,
          comment_disabled: false,
          duet_disabled: false,
          stitch_disabled: true,
        },
      },
    ])
    assert.equal(agg.ready, true)
    assert.equal(agg.blocked, false)
    assert.equal(agg.can_post, true)
    assert.equal(agg.hasNonPrivatePrivacy, true)
    assert.deepEqual(agg.privacy_level_options, ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'])
    assert.equal(agg.max_video_post_duration_sec, 180)
    assert.equal(agg.comment_disabled, false)
    assert.equal(agg.duet_disabled, true)
    assert.equal(agg.stitch_disabled, true)
    assert.deepEqual(agg.disabledBy.duet, ['Alice'])
    assert.deepEqual(agg.disabledBy.stitch, ['Bob'])
  })

  it('fails closed on can_post:false, upstream rate-limit errors, and empty privacy intersection', () => {
    const rateLimited = aggregateCreatorInfo([
      { account_id: 'a1', display_name: 'Alice', data: { creator_nickname: 'Alice', can_post: false, privacy_level_options: ['SELF_ONLY'] } },
    ])
    assert.equal(rateLimited.blocked, true)
    assert.equal(rateLimited.blockedReason, 'creator-cannot-post')
    assert.equal(rateLimited.can_post, false)

    const upstreamSpam = aggregateCreatorInfo([
      { account_id: 'a1', display_name: 'Alice', error: 'spam_risk_too_many_posts: daily limit reached' },
    ])
    assert.equal(upstreamSpam.blocked, true)
    assert.equal(upstreamSpam.blockedReason, 'creator-cannot-post')

    const emptyIntersection = aggregateCreatorInfo([
      { account_id: 'a1', data: { privacy_level_options: ['PUBLIC_TO_EVERYONE'] } },
      { account_id: 'a2', data: { privacy_level_options: ['SELF_ONLY'] } },
    ])
    assert.equal(emptyIntersection.blocked, true)
    assert.equal(emptyIntersection.blockedReason, 'privacy-intersection-empty')

    const sandbox = aggregateCreatorInfo([
      { account_id: 's1', data: { creator_nickname: 'Sandbox', privacy_level_options: ['SELF_ONLY'], max_video_post_duration_sec: 600 } },
    ])
    assert.equal(sandbox.blocked, false)
    assert.equal(sandbox.hasNonPrivatePrivacy, false)
  })

  it('exposes official TikTok legal policy URLs', () => {
    assert.equal(TIKTOK_MUSIC_USAGE_URL, 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en')
    assert.equal(TIKTOK_BRANDED_CONTENT_URL, 'https://www.tiktok.com/legal/page/global/bc-policy/en')
  })
})
