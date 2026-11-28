import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseDraftPayload, validateContent, validateForSubmit, validationError } from './validate.js'
import { PublishError } from './store.js'

const PLATFORMS = {
  tiktok: { media_types: ['image', 'video'], supports_cover: false, supports_schedule: false, max_images: 18 },
}

const ACCOUNTS = [
  { id: 'a1', provider: 'tiktok_direct', platform: 'tiktok', status: 'active' },
  { id: 'a2', provider: 'tiktok_direct', platform: 'tiktok', status: 'active' },
  { id: 'a3', provider: 'tiktok_direct', platform: 'tiktok', status: 'expired' },
  { id: 'a4', provider: 'tiktok_direct', platform: 'tiktok', status: 'active', agent_usable: false },
]

describe('validateContent（草稿内容自身校验）', () => {
  it('accepts a well-formed image draft', () => {
    const errors = validateContent({
      type: 'image',
      title: '标题',
      description: '描述',
      mediaRows: [{ id: 'm1', kind: 'image' }, { id: 'm2', kind: 'image' }],
      coverRow: null,
    })
    assert.deepEqual(errors, [])
  })

  it('accepts a well-formed video draft', () => {
    const errors = validateContent({
      type: 'video',
      description: '描述',
      mediaRows: [{ id: 'm1', kind: 'video' }],
      coverRow: { id: 'c1', kind: 'image' },
    })
    assert.deepEqual(errors, [])
  })

  it('rejects image draft without title / images', () => {
    const errors = validateContent({ type: 'image', mediaRows: [], title: '' })
    assert.ok(errors.some((e) => e.code === 'image-required'))
    assert.ok(errors.some((e) => e.code === 'title-required'))
    assert.ok(errors.some((e) => e.code === 'text-required'))
  })

  it('rejects video draft without a video file', () => {
    const errors = validateContent({ type: 'video', description: 'd', mediaRows: [{ id: 'm1', kind: 'image' }] })
    assert.ok(errors.some((e) => e.code === 'video-required'))
  })

  it('rejects unknown media kinds and non-image covers', () => {
    const errors = validateContent({
      type: 'image', title: 't',
      mediaRows: [{ id: 'm1', kind: 'image' }, { id: 'm2', kind: 'other' }],
      coverRow: { id: 'c1', kind: 'video' },
    })
    assert.ok(errors.some((e) => e.code === 'media-kind-unsupported'))
    assert.ok(errors.some((e) => e.code === 'cover-not-image'))
  })
})

describe('validateForSubmit: official account source, availability and capabilities', () => {
  const imageDraft = { type: 'image', title: 'title', mediaRows: [{ id: 'm1', kind: 'image' }], account_ids: ['a1'] }

  it('accepts a usable official account', () => {
    assert.equal(validateForSubmit(imageDraft, { accounts: ACCOUNTS, platforms: PLATFORMS }).ok, true)
  })

  it('rejects missing, unknown, Zernio and forged non-TikTok sources', () => {
    for (const row of [null, { id: 'a1', platform: 'tiktok' }, { id: 'a1', platform: 'tiktok', provider: 'unknown' }, { id: 'a1', platform: 'tiktok', provider: 'zernio' }, { id: 'a1', platform: 'instagram', provider: 'tiktok_direct' }]) {
      const verdict = validateForSubmit(imageDraft, { accounts: row ? [row] : [], platforms: PLATFORMS })
      assert.equal(verdict.ok, false)
      assert.ok(verdict.errors.some((e) => e.code === 'account-provider-mismatch'))
      assert.equal(validationError(verdict.errors).code, 'account-provider-mismatch')
    }
  })

  it('rejects expired and Agent-disabled official accounts', () => {
    for (const id of ['a3', 'a4']) {
      const result = validateForSubmit({ ...imageDraft, account_ids: [id] }, { accounts: ACCOUNTS, platforms: PLATFORMS })
      assert.ok(result.errors.some((e) => e.code === 'account-unavailable'))
    }
  })

  it('enforces cover, image count and media type capabilities after source validation', () => {
    const conflicts = validateForSubmit({ ...imageDraft, coverRow: { id: 'cover', kind: 'image' }, mediaRows: Array.from({ length: 20 }, (_, i) => ({ id: String(i), kind: 'image' })) }, { accounts: ACCOUNTS, platforms: PLATFORMS })
    assert.ok(conflicts.errors.some((e) => e.code === 'capability-conflict' && /不支持封面/.test(e.message)))
    assert.ok(conflicts.errors.some((e) => e.code === 'capability-conflict' && /最多 18 张图/.test(e.message)))
    const imageOnly = validateForSubmit({ type: 'video', description: 'd', mediaRows: [{ id: 'v', kind: 'video' }], account_ids: ['a1'] }, { accounts: ACCOUNTS, platforms: { tiktok: { media_types: ['image'] } } })
    assert.ok(imageOnly.errors.some((e) => e.code === 'capability-conflict' && /不支持视频/.test(e.message)))
  })

  it('distinguishes missing selection and missing platform capability definitions', () => {
    const empty = validateForSubmit({ ...imageDraft, account_ids: [] }, { accounts: ACCOUNTS, platforms: PLATFORMS })
    assert.ok(empty.errors.some((e) => e.code === 'accounts-required'))
    const unknown = validateForSubmit(imageDraft, { accounts: ACCOUNTS, platforms: {} })
    assert.ok(unknown.errors.some((e) => e.code === 'platform-unknown'))
  })
})

describe('validationError 形态', () => {
  it('carries structured details for the tool/HTTP faces', () => {
    const error = validationError([{ code: 'image-required', field: 'media', message: 'x' }])
    assert.ok(error instanceof PublishError)
    assert.equal(error.code, 'validation-failed')
    assert.deepEqual(error.details.errors.length, 1)
  })
})

describe('parseDraftPayload', () => {
  it('normalizes media refs with path or media_id', () => {
    const parsed = parseDraftPayload({ title: 't', media: [{ path: '/a.png' }, { media_id: 'abc' }] })
    assert.deepEqual(parsed.media, [{ path: '/a.png' }, { media_id: 'abc' }])
  })

  it('rejects media entries without path/media_id', () => {
    assert.throws(() => parseDraftPayload({ media: [{}] }), (e) => e.code === 'invalid-arguments')
    assert.throws(() => parseDraftPayload({ media: 'nope' }), (e) => e.code === 'invalid-arguments')
  })

  it('parses cover and rejects bad topics', () => {
    const parsed = parseDraftPayload({ cover: { media_id: 'c' }, topics: ['a', 'b'] })
    assert.deepEqual(parsed.cover, { media_id: 'c' })
    assert.throws(() => parseDraftPayload({ topics: [1] }), (e) => e.code === 'invalid-arguments')
    assert.throws(() => parseDraftPayload({ cover: {} }), (e) => e.code === 'invalid-arguments')
  })

  it('rejects non-object payloads', () => {
    assert.throws(() => parseDraftPayload('x'), (e) => e.code === 'invalid-arguments')
  })
})

describe('validateForSubmit: TikTok draft mode and server media limits (#185)', () => {
  const TIKTOK_PLATFORMS = {
    tiktok: { media_types: ['video', 'image'], supports_cover: false, supports_schedule: false, max_images: 35 },
  }

  it('skips Direct Post tiktok_options validation for draft_only accounts', () => {
    const accounts = [{
      id: 'draft-1',
      provider: 'tiktok_direct',
      platform: 'tiktok',
      status: 'active',
      capabilities: { upload_draft: true, publish_direct: false },
    }]
    const verdict = validateForSubmit({
      type: 'video',
      title: 'draft clip',
      mediaRows: [{ id: 'v1', kind: 'video', filename: 'clip.mp4', content_type: 'video/mp4' }],
      account_ids: ['draft-1'],
      settings: { tiktok_options: { privacy_level: 'SELF_ONLY', commercial_content: true, branded_content: true } },
    }, { accounts, platforms: TIKTOK_PLATFORMS })
    assert.equal(verdict.ok, true)
  })

  it('enforces JPEG/WebP format, cover index, single video, and server-supplied max_media_items', () => {
    const accounts = [{
      id: 'draft-1',
      provider: 'tiktok_direct',
      platform: 'tiktok',
      status: 'active',
      capabilities: { upload_draft: true, publish_direct: false, max_media_items: 10 },
    }]
    const pngVerdict = validateForSubmit({
      type: 'image',
      title: 'carousel',
      mediaRows: [{ id: 'i1', kind: 'image', filename: 'bad.png', content_type: 'image/png' }],
      account_ids: ['draft-1'],
    }, { accounts, platforms: TIKTOK_PLATFORMS })
    assert.equal(pngVerdict.ok, false)
    assert.ok(pngVerdict.errors.some((e) => e.code === 'image-format-unsupported'))

    const overServerLimit = validateForSubmit({
      type: 'image',
      title: 'too many photos',
      mediaRows: Array.from({ length: 11 }, (_, idx) => ({ id: `i${idx}`, kind: 'image', filename: `${idx}.jpg`, content_type: 'image/jpeg' })),
      account_ids: ['draft-1'],
    }, { accounts, platforms: TIKTOK_PLATFORMS })
    assert.equal(overServerLimit.ok, false)
    assert.ok(overServerLimit.errors.some((e) => e.code === 'capability-conflict' && /最多 10 张图/.test(e.message)))
  })

  it('rejects accounts explicitly lacking both upload_draft and publish_direct', () => {
    const accounts = [{
      id: 'no-scope',
      provider: 'tiktok_direct',
      platform: 'tiktok',
      status: 'active',
      capabilities: { upload_draft: false, publish_direct: false },
    }]
    const verdict = validateForSubmit({
      type: 'video',
      title: 'v',
      mediaRows: [{ id: 'v1', kind: 'video' }],
      account_ids: ['no-scope'],
    }, { accounts, platforms: TIKTOK_PLATFORMS })
    assert.equal(verdict.ok, false)
    assert.ok(verdict.errors.some((e) => e.code === 'account-unavailable'))
  })
})

describe('validateForSubmit: TikTok draft_only & no_publish_scope rules (#185)', () => {
  const TIKTOK_PLATFORMS = {
    tiktok: { media_types: ['image', 'video'], supports_cover: false, supports_schedule: false, max_images: 35 },
  }
  const DRAFT_ACCOUNTS = [
    { id: 'draft-1', provider: 'tiktok_direct', platform: 'tiktok', status: 'active', capabilities: { upload_draft: true, publish_direct: false } },
    { id: 'direct-1', provider: 'tiktok_direct', platform: 'tiktok', status: 'active', capabilities: { upload_draft: true, publish_direct: true } },
    { id: 'noscope-1', provider: 'tiktok_direct', platform: 'tiktok', status: 'active', capabilities: { upload_draft: false, publish_direct: false } },
  ]

  it('fails closed when selected account lacks both upload_draft and publish_direct', () => {
    const verdict = validateForSubmit({
      type: 'video',
      description: 'demo',
      mediaRows: [{ id: 'v1', kind: 'video', filename: 'clip.mp4', content_type: 'video/mp4' }],
      account_ids: ['noscope-1'],
    }, { accounts: DRAFT_ACCOUNTS, platforms: TIKTOK_PLATFORMS })
    assert.equal(verdict.ok, false)
    assert.ok(verdict.errors.some((e) => e.code === 'account-unavailable' && /video\.upload/.test(e.message)))
  })

  it('rejects mixed media and multiple videos for TikTok draft_only accounts', () => {
    const mixed = validateForSubmit({
      type: 'video',
      description: 'demo',
      mediaRows: [
        { id: 'v1', kind: 'video', filename: 'a.mp4', content_type: 'video/mp4' },
        { id: 'i1', kind: 'image', filename: 'b.jpg', content_type: 'image/jpeg' },
      ],
      account_ids: ['draft-1'],
    }, { accounts: DRAFT_ACCOUNTS, platforms: TIKTOK_PLATFORMS })
    assert.equal(mixed.ok, false)
    assert.ok(mixed.errors.some((e) => e.code === 'mixed-media-unsupported'))

    const twoVideos = validateForSubmit({
      type: 'video',
      description: 'demo',
      mediaRows: [
        { id: 'v1', kind: 'video', filename: 'a.mp4', content_type: 'video/mp4' },
        { id: 'v2', kind: 'video', filename: 'b.mp4', content_type: 'video/mp4' },
      ],
      account_ids: ['draft-1'],
    }, { accounts: DRAFT_ACCOUNTS, platforms: TIKTOK_PLATFORMS })
    assert.equal(twoVideos.ok, false)
    assert.ok(twoVideos.errors.some((e) => e.code === 'video-count-exceeded'))
  })

  it('enforces JPEG/WebP only and photo_cover_index bounds for TikTok photo carousel', () => {
    const pngVerdict = validateForSubmit({
      type: 'image',
      title: 'Photos',
      mediaRows: [
        { id: 'i1', kind: 'image', filename: 'a.jpg', content_type: 'image/jpeg' },
        { id: 'i2', kind: 'image', filename: 'b.png', content_type: 'image/png' },
      ],
      account_ids: ['draft-1'],
    }, { accounts: DRAFT_ACCOUNTS, platforms: TIKTOK_PLATFORMS })
    assert.equal(pngVerdict.ok, false)
    assert.ok(pngVerdict.errors.some((e) => e.code === 'image-format-unsupported'))

    const badCover = validateForSubmit({
      type: 'image',
      title: 'Photos',
      mediaRows: [{ id: 'i1', kind: 'image', filename: 'a.webp', content_type: 'image/webp' }],
      settings: { photo_cover_index: 2 },
      account_ids: ['draft-1'],
    }, { accounts: DRAFT_ACCOUNTS, platforms: TIKTOK_PLATFORMS })
    assert.equal(badCover.ok, false)
    assert.ok(badCover.errors.some((e) => e.code === 'invalid-photo-cover-index'))

    const okPhotos = validateForSubmit({
      type: 'image',
      title: 'Photos',
      mediaRows: [
        { id: 'i1', kind: 'image', filename: 'a.jpg', content_type: 'image/jpeg' },
        { id: 'i2', kind: 'image', filename: 'b.webp', content_type: 'image/webp' },
      ],
      settings: {
        photo_cover_index: 1,
        is_aigc: true,
        // Direct Post options are stripped in draft_only mode and must not block draft upload
        tiktok_options: { privacy_level: 'SELF_ONLY', commercial_content: true, branded_content: true },
      },
      account_ids: ['draft-1'],
    }, { accounts: DRAFT_ACCOUNTS, platforms: TIKTOK_PLATFORMS })
    assert.equal(okPhotos.ok, true)
  })
})

describe('validateForSubmit: TikTok Direct Post compliance (#186)', () => {
  const TIKTOK_PLATFORMS = {
    tiktok: { media_types: ['image', 'video'], supports_cover: false, supports_schedule: false, max_images: 35 },
  }
  const DIRECT_ACCOUNTS = [
    { id: 'direct-1', provider: 'tiktok_direct', platform: 'tiktok', status: 'active', capabilities: { upload_draft: true, publish_direct: true } },
  ]

  it('blocks direct accounts when settings.tiktok_options is omitted (prevents Agent/API bypass)', () => {
    const verdict = validateForSubmit({
      type: 'video',
      description: 'Agent direct post without tiktok_options',
      mediaRows: [{ id: 'v1', kind: 'video', filename: 'a.mp4', content_type: 'video/mp4', duration_sec: 30 }],
      account_ids: ['direct-1'],
    }, { accounts: DIRECT_ACCOUNTS, platforms: TIKTOK_PLATFORMS })
    assert.equal(verdict.ok, false)
    assert.ok(verdict.errors.some((e) => e.code === 'privacy-level-required'))
    assert.ok(verdict.errors.some((e) => e.code === 'music-confirmation-required'))
  })

  it('enforces allowedPrivacyLevels, creator blocked status, and video duration ceiling', () => {
    const disallowedPrivacy = validateForSubmit({
      type: 'video',
      description: 'Sandbox mismatch',
      mediaRows: [{ id: 'v1', kind: 'video', filename: 'a.mp4', content_type: 'video/mp4', duration_sec: 30 }],
      account_ids: ['direct-1'],
      settings: { tiktok_options: { privacy_level: 'PUBLIC_TO_EVERYONE', music_usage_confirmed: true } },
    }, {
      accounts: DIRECT_ACCOUNTS,
      platforms: TIKTOK_PLATFORMS,
      creatorInfo: {
        ready: true,
        blocked: false,
        blockedReason: '',
        blockedMessage: '',
        blockedAccounts: [],
        creators: [],
        privacy_level_options: ['SELF_ONLY'],
        max_video_post_duration_sec: 600,
        comment_disabled: false,
        duet_disabled: false,
        stitch_disabled: false,
        disabledBy: { comment: [], duet: [], stitch: [] },
        can_post: true,
        hasNonPrivatePrivacy: false,
      },
    })
    assert.equal(disallowedPrivacy.ok, false)
    assert.ok(disallowedPrivacy.errors.some((e) => e.code === 'privacy-level-disallowed'))

    const overDuration = validateForSubmit({
      type: 'video',
      description: 'Too long',
      mediaRows: [{ id: 'v1', kind: 'video', filename: 'long.mp4', content_type: 'video/mp4', duration_sec: 680 }],
      account_ids: ['direct-1'],
      settings: { tiktok_options: { privacy_level: 'PUBLIC_TO_EVERYONE', music_usage_confirmed: true } },
    }, {
      accounts: DIRECT_ACCOUNTS,
      platforms: TIKTOK_PLATFORMS,
      creatorInfo: {
        ready: true,
        blocked: false,
        blockedReason: '',
        blockedMessage: '',
        blockedAccounts: [],
        creators: [],
        privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
        max_video_post_duration_sec: 600,
        comment_disabled: false,
        duet_disabled: false,
        stitch_disabled: false,
        disabledBy: { comment: [], duet: [], stitch: [] },
        can_post: true,
        hasNonPrivatePrivacy: true,
      },
    })
    assert.equal(overDuration.ok, false)
    assert.ok(overDuration.errors.some((e) => e.code === 'video-duration-exceeded'))

    const rateLimited = validateForSubmit({
      type: 'video',
      description: 'Rate limited',
      mediaRows: [{ id: 'v1', kind: 'video', filename: 'ok.mp4', content_type: 'video/mp4', duration_sec: 30 }],
      account_ids: ['direct-1'],
      settings: { tiktok_options: { privacy_level: 'PUBLIC_TO_EVERYONE', music_usage_confirmed: true } },
    }, {
      accounts: DIRECT_ACCOUNTS,
      platforms: TIKTOK_PLATFORMS,
      creatorInfo: {
        ready: false,
        blocked: true,
        blockedReason: 'creator-cannot-post',
        blockedMessage: 'Alice: spam_risk_too_many_posts',
        blockedAccounts: [],
        creators: [],
        privacy_level_options: [],
        max_video_post_duration_sec: null,
        comment_disabled: false,
        duet_disabled: false,
        stitch_disabled: false,
        disabledBy: { comment: [], duet: [], stitch: [] },
        can_post: false,
        hasNonPrivatePrivacy: false,
      },
    })
    assert.equal(rateLimited.ok, false)
    assert.ok(rateLimited.errors.some((e) => e.code === 'creator-cannot-post'))

    const emptyPrivacy = validateForSubmit({
      type: 'video',
      description: 'No privacy options',
      mediaRows: [{ id: 'v1', kind: 'video', filename: 'ok.mp4', content_type: 'video/mp4', duration_sec: 30 }],
      account_ids: ['direct-1'],
      settings: { tiktok_options: { privacy_level: 'PUBLIC_TO_EVERYONE', music_usage_confirmed: true } },
    }, {
      accounts: DIRECT_ACCOUNTS,
      platforms: TIKTOK_PLATFORMS,
      creatorInfo: {
        ready: false,
        blocked: true,
        blockedReason: 'privacy-options-empty',
        blockedCategory: 'privacy-options-empty',
        blockedMessage: 'creator_info returned no available privacy_level_options',
        blockedAccounts: [],
        creators: [],
        privacy_level_options: [],
        max_video_post_duration_sec: 600,
        comment_disabled: false,
        duet_disabled: false,
        stitch_disabled: false,
        disabledBy: { comment: [], duet: [], stitch: [] },
        can_post: false,
        hasNonPrivatePrivacy: false,
      },
    })
    assert.equal(emptyPrivacy.ok, false)
    const privacyError = emptyPrivacy.errors.find((e) => e.code === 'privacy-options-empty')
    assert.ok(privacyError)
    assert.match(privacyError.message, /隐私级别/)
  })

  it('allows phase=assign for incomplete drafts before privacy_level is selected', () => {
    const verdict = validateForSubmit({
      type: 'video',
      description: 'Draft in progress',
      mediaRows: [{ id: 'v1', kind: 'video', filename: 'a.mp4', content_type: 'video/mp4', duration_sec: 30 }],
      account_ids: ['direct-1'],
    }, { accounts: DIRECT_ACCOUNTS, platforms: TIKTOK_PLATFORMS, phase: 'assign' })
    assert.equal(verdict.ok, true)
  })

  it('rejects frozen and unactivated account seats with SOCIAL_SEAT_EXPIRED (#412)', () => {
    const accounts = [
      {
        id: 'frozen-1',
        provider: 'tiktok_direct',
        platform: 'tiktok',
        display_name: 'Frozen',
        status: 'active',
        capabilities: { upload_draft: true, publish_direct: false },
        seat: { status: 'frozen', expires_at: '2026-11-20T00:00:00Z', can_renew: true },
      },
    ]
    const verdict = validateForSubmit({
      type: 'video',
      description: 'Blocked by expired seat',
      mediaRows: [{ id: 'v1', kind: 'video', filename: 'a.mp4', content_type: 'video/mp4' }],
      account_ids: ['frozen-1'],
    }, { accounts, platforms: TIKTOK_PLATFORMS })
    assert.equal(verdict.ok, false)
    assert.ok(verdict.errors.some((e) => e.code === 'SOCIAL_SEAT_EXPIRED'))
    const err = validationError(verdict.errors)
    assert.equal(err.code, 'SOCIAL_SEAT_EXPIRED')
  })
})
