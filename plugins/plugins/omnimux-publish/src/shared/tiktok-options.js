/**
 * TikTok Content Sharing Guidelines options (privacy level, interaction toggles,
 * commercial disclosure, music confirmation) and multi-account creator_info aggregation.
 * Shared by Host validation and the publishing composer so both sides agree on
 * defaults, legality, and fail-closed checks.
 */

/** @typedef {object} TikTokOptions
 * @property {string} privacy_level
 * @property {boolean} allow_comment
 * @property {boolean} allow_duet
 * @property {boolean} allow_stitch
 * @property {boolean} commercial_content
 * @property {boolean} your_brand
 * @property {boolean} branded_content
 * @property {boolean} music_usage_confirmed
 */

/** @typedef {object} CreatorInfoEntry
 * @property {string} account_id
 * @property {string} [display_name]
 * @property {Record<string, unknown> | null} [data]
 * @property {string | null} [error]
 */

/** @typedef {object} NormalizedCreatorInfo
 * @property {string} account_id
 * @property {string} display_name
 * @property {string} creator_nickname
 * @property {string} creator_username
 * @property {string} creator_avatar_url
 * @property {number | null} max_video_post_duration_sec
 * @property {boolean} can_post
 * @property {string[]} privacy_level_options
 * @property {boolean} comment_disabled
 * @property {boolean} duet_disabled
 * @property {boolean} stitch_disabled
 */

/** @typedef {object} AggregatedCreatorInfo
 * @property {boolean} ready
 * @property {boolean} blocked
 * @property {string} blockedReason
 * @property {string} blockedMessage
 * @property {Array<{ account_id: string, display_name: string, code: string, message: string }>} blockedAccounts
 * @property {NormalizedCreatorInfo[]} creators
 * @property {string[]} privacy_level_options
 * @property {number | null} max_video_post_duration_sec
 * @property {boolean} comment_disabled
 * @property {boolean} duet_disabled
 * @property {boolean} stitch_disabled
 * @property {{ comment: string[], duet: string[], stitch: string[] }} disabledBy
 * @property {boolean} can_post
 * @property {boolean} hasNonPrivatePrivacy
 */

export const TIKTOK_MUSIC_USAGE_URL = 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en'
export const TIKTOK_BRANDED_CONTENT_URL = 'https://www.tiktok.com/legal/page/global/bc-policy/en'

/** @type {readonly string[]} */
export const TIKTOK_PRIVACY_LEVELS = Object.freeze([
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY',
])

/**
 * TikTok Content Sharing Guidelines defaults:
 * - §2.b: privacy_level MUST NOT have a preset default (must be chosen manually)
 * - §2.c: interaction toggles default to unchecked (false)
 * - §3: commercial disclosure defaults to off (false)
 * - §4: music_usage_confirmed defaults to false until confirmed on submit
 * @type {Readonly<TikTokOptions>}
 */
export const DEFAULT_TIKTOK_OPTIONS = Object.freeze({
  privacy_level: '',
  allow_comment: false,
  allow_duet: false,
  allow_stitch: false,
  commercial_content: false,
  your_brand: false,
  branded_content: false,
  music_usage_confirmed: false,
})

/** @param {unknown} value @returns {boolean} */
const asBool = (value) => value === true

/** @param {unknown} value @returns {Record<string, unknown> | null} */
function asObj(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : null
}

/**
 * Normalize a stored/picked options object.
 * - Unknown or empty privacy levels normalize to '' (never fall back to SELF_ONLY).
 * - Interaction toggles default strictly to false.
 * - Turning commercial_content off clears your_brand and branded_content so stale
 *   flags cannot lock SELF_ONLY.
 * @param {unknown} raw
 * @returns {TikTokOptions}
 */
export function normalizeTikTokOptions(raw) {
  const input = asObj(raw) ?? {}
  const privacy = typeof input.privacy_level === 'string' ? input.privacy_level.trim().toUpperCase() : ''
  const commercialContent = asBool(input.commercial_content)
  return {
    privacy_level: TIKTOK_PRIVACY_LEVELS.includes(privacy) ? privacy : '',
    allow_comment: asBool(input.allow_comment),
    allow_duet: asBool(input.allow_duet),
    allow_stitch: asBool(input.allow_stitch),
    commercial_content: commercialContent,
    your_brand: commercialContent ? asBool(input.your_brand) : false,
    branded_content: commercialContent ? asBool(input.branded_content) : false,
    music_usage_confirmed: asBool(input.music_usage_confirmed),
  }
}

/**
 * Extract valid TikTok privacy levels from an array.
 * @param {unknown} options
 * @returns {string[]}
 */
function parsePrivacyList(options) {
  if (!Array.isArray(options)) return []
  const allowed = options
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim().toUpperCase())
    .filter((item) => TIKTOK_PRIVACY_LEVELS.includes(item))
  return [...new Set(allowed)]
}

/**
 * Privacy levels the account may actually choose. When creator-info reports a
 * non-empty list we trust it (unaudited sandbox apps only allow SELF_ONLY).
 * @param {unknown} creatorInfo
 * @returns {string[]}
 */
export function privacyChoices(creatorInfo) {
  const info = asObj(creatorInfo)
  const allowed = parsePrivacyList(info?.privacy_level_options)
  return allowed.length > 0 ? allowed : [...TIKTOK_PRIVACY_LEVELS]
}

const POST_BLOCK_ERROR_RE = /spam_risk|too_many_posts|banned|cannot_post|active_user_cap|rate_limit|reached_active_user_cap/i

/**
 * Unwrap a creator-info envelope (`{ data: {...} }` or direct payload).
 * @param {unknown} raw
 * @returns {Record<string, unknown> | null}
 */
export function unwrapCreatorInfoData(raw) {
  const obj = asObj(raw)
  if (!obj) return null
  const inner = asObj(obj.data)
  return inner ?? obj
}

/**
 * Aggregate `creator_info` responses across one or more Direct Post accounts:
 * - Privacy options: intersection (preserving official ordering).
 * - Max video duration: minimum positive `max_video_post_duration_sec`.
 * - Interaction disabled flags: union (OR), recording which accounts disable each.
 * - Any error / `can_post === false` / empty privacy intersection -> fail-closed `blocked: true`.
 * @param {CreatorInfoEntry[]} entries
 * @returns {AggregatedCreatorInfo}
 */
export function aggregateCreatorInfo(entries) {
  const list = Array.isArray(entries) ? entries : []
  /** @type {NormalizedCreatorInfo[]} */
  const creators = []
  /** @type {Array<{ account_id: string, display_name: string, code: string, message: string }>} */
  const blockedAccounts = []
  /** @type {{ comment: string[], duet: string[], stitch: string[] }} */
  const disabledBy = { comment: [], duet: [], stitch: [] }

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const accountId = String(entry.account_id || '')
    const fallbackName = String(entry.display_name || accountId)
    if (typeof entry.error === 'string' && entry.error.trim() !== '') {
      const msg = entry.error.trim()
      const code = POST_BLOCK_ERROR_RE.test(msg) ? 'creator-cannot-post' : 'creator-info-unavailable'
      blockedAccounts.push({ account_id: accountId, display_name: fallbackName, code, message: msg })
      continue
    }
    const data = unwrapCreatorInfoData(entry.data)
    if (!data || data.degraded === true) {
      blockedAccounts.push({
        account_id: accountId,
        display_name: fallbackName,
        code: 'creator-info-unavailable',
        message: 'creator_info unavailable',
      })
      continue
    }
    const errObj = asObj(data.error)
    const errCode = errObj && typeof errObj.code === 'string' ? errObj.code.trim() : ''
    const errMsg = errObj && typeof errObj.message === 'string' ? errObj.message.trim() : ''
    if (errCode !== '' && errCode.toLowerCase() !== 'ok') {
      const detail = errMsg ? `${errCode}: ${errMsg}` : errCode
      blockedAccounts.push({
        account_id: accountId,
        display_name: fallbackName,
        code: POST_BLOCK_ERROR_RE.test(detail) ? 'creator-cannot-post' : 'creator-info-unavailable',
        message: detail,
      })
      continue
    }
    const nickname = typeof data.creator_nickname === 'string' && data.creator_nickname.trim() !== ''
      ? data.creator_nickname.trim()
      : fallbackName
    const username = typeof data.creator_username === 'string' ? data.creator_username.trim() : ''
    const avatarUrl = typeof data.creator_avatar_url === 'string' ? data.creator_avatar_url.trim() : ''
    const rawMaxDur = Number(data.max_video_post_duration_sec)
    const maxDuration = Number.isFinite(rawMaxDur) && rawMaxDur > 0 ? Math.floor(rawMaxDur) : null
    const canPost = data.can_post !== false && data.can_post_more !== false
    const allowed = parsePrivacyList(data.privacy_level_options)
    const commentDisabled = data.comment_disabled === true
    const duetDisabled = data.duet_disabled === true
    const stitchDisabled = data.stitch_disabled === true

    creators.push({
      account_id: accountId,
      display_name: fallbackName,
      creator_nickname: nickname,
      creator_username: username,
      creator_avatar_url: avatarUrl,
      max_video_post_duration_sec: maxDuration,
      can_post: canPost,
      privacy_level_options: allowed.length > 0 ? allowed : [...TIKTOK_PRIVACY_LEVELS],
      comment_disabled: commentDisabled,
      duet_disabled: duetDisabled,
      stitch_disabled: stitchDisabled,
    })

    if (commentDisabled) disabledBy.comment.push(nickname)
    if (duetDisabled) disabledBy.duet.push(nickname)
    if (stitchDisabled) disabledBy.stitch.push(nickname)

    if (!canPost) {
      const reason = typeof data.cannot_post_reason === 'string' && data.cannot_post_reason.trim() !== ''
        ? data.cannot_post_reason.trim()
        : (typeof data.message === 'string' && data.message.trim() !== '' ? data.message.trim() : 'creator cannot post right now')
      blockedAccounts.push({
        account_id: accountId,
        display_name: nickname,
        code: 'creator-cannot-post',
        message: reason,
      })
    }
  }

  /** @type {string[]} */
  let intersectedPrivacy = []
  if (creators.length > 0) {
    const sets = creators.map((c) => new Set(c.privacy_level_options))
    intersectedPrivacy = TIKTOK_PRIVACY_LEVELS.filter((level) => sets.every((set) => set.has(level)))
  }

  const durations = creators
    .map((c) => c.max_video_post_duration_sec)
    .filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)
  const minDuration = durations.length > 0 ? Math.min(.../** @type {number[]} */ (durations)) : null

  const commentDisabled = disabledBy.comment.length > 0
  const duetDisabled = disabledBy.duet.length > 0
  const stitchDisabled = disabledBy.stitch.length > 0

  let blocked = blockedAccounts.length > 0
  let blockedReason = blockedAccounts.some((b) => b.code === 'creator-cannot-post')
    ? 'creator-cannot-post'
    : (blockedAccounts[0]?.code ?? '')
  let blockedMessage = blockedAccounts.map((b) => `${b.display_name}: ${b.message}`).join('; ')

  if (!blocked && creators.length > 0 && intersectedPrivacy.length === 0) {
    blocked = true
    blockedReason = 'privacy-intersection-empty'
    blockedMessage = 'selected accounts share no common privacy level'
  }

  const ready = list.length > 0 && blockedAccounts.length === 0 && creators.length === list.length
  const canPost = !blocked && creators.every((c) => c.can_post)
  const hasNonPrivatePrivacy = intersectedPrivacy.some((level) => level !== 'SELF_ONLY')

  return {
    ready,
    blocked,
    blockedReason,
    blockedMessage,
    blockedAccounts,
    creators,
    privacy_level_options: intersectedPrivacy,
    max_video_post_duration_sec: minDuration,
    comment_disabled: commentDisabled,
    duet_disabled: duetDisabled,
    stitch_disabled: stitchDisabled,
    disabledBy,
    can_post: canPost,
    hasNonPrivatePrivacy,
  }
}

/**
 * Blocking problems for a chosen Direct Post options combination.
 * Empty array means options themselves are valid.
 * @param {unknown} rawOptions
 * @param {{
 *   allowedPrivacyLevels?: string[] | null,
 *   type?: string,
 *   requireMusicConfirmation?: boolean,
 * }} [ctx]
 * @returns {string[]} stable machine codes
 */
export function tiktokOptionProblems(rawOptions, ctx = {}) {
  const options = normalizeTikTokOptions(rawOptions)
  /** @type {string[]} */
  const problems = []
  if (!options.privacy_level) {
    problems.push('privacy-level-required')
  } else if (Array.isArray(ctx.allowedPrivacyLevels) && ctx.allowedPrivacyLevels.length > 0
    && !ctx.allowedPrivacyLevels.includes(options.privacy_level)) {
    problems.push('privacy-level-disallowed')
  }
  if (options.commercial_content && !options.your_brand && !options.branded_content) {
    problems.push('commercial-brand-required')
  }
  if (options.commercial_content && options.branded_content && options.privacy_level === 'SELF_ONLY') {
    problems.push('branded-requires-public')
  }
  if (ctx.requireMusicConfirmation !== false && !options.music_usage_confirmed) {
    problems.push('music-confirmation-required')
  }
  return problems
}

/**
 * Build the gateway `tiktok_options` body. Returns undefined when nothing should
 * be sent, so older gateways keep their previous behavior.
 * - Photo posts (`ctx.type === 'image'`) omit `allow_duet` and `allow_stitch`.
 * - Account-disabled interaction flags force the corresponding `allow_*` to `false`.
 * @param {unknown} raw
 * @param {{
 *   type?: string,
 *   creatorInfo?: { comment_disabled?: boolean, duet_disabled?: boolean, stitch_disabled?: boolean } | null,
 * }} [ctx]
 * @returns {Record<string, unknown> | undefined}
 */
export function buildCreateTikTokOptions(raw, ctx = {}) {
  if (raw === undefined || raw === null) return undefined
  const options = normalizeTikTokOptions(raw)
  const creator = ctx.creatorInfo ?? null
  /** @type {Record<string, unknown>} */
  const body = {
    privacy_level: options.privacy_level,
    allow_comment: creator?.comment_disabled === true ? false : options.allow_comment,
  }
  if (ctx.type !== 'image') {
    body.allow_duet = creator?.duet_disabled === true ? false : options.allow_duet
    body.allow_stitch = creator?.stitch_disabled === true ? false : options.allow_stitch
  }
  if (options.commercial_content) {
    body.commercial_content = true
    body.your_brand = options.your_brand
    body.branded_content = options.branded_content
  }
  if (options.music_usage_confirmed) body.music_usage_confirmed = true
  return body
}

/**
 * Shrink an options object for draft persistence (settings.tiktok_options).
 * @param {unknown} raw
 * @returns {TikTokOptions}
 */
export function storeTikTokOptions(raw) {
  return normalizeTikTokOptions(raw)
}
