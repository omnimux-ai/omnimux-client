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
 * @property {string | null} [error_code]
 * @property {string | null} [upstream_code]
 * @property {string | null} [upstream_log_id]
 * @property {Record<string, unknown> | null} [errorBody]
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

/** @typedef {object} BlockedAccountEntry
 * @property {string} account_id
 * @property {string} display_name
 * @property {string} code
 * @property {string} category
 * @property {string} social_code
 * @property {string} upstream_code
 * @property {string} upstream_log_id
 * @property {string} message
 */

/** @typedef {object} AggregatedCreatorInfo
 * @property {boolean} ready
 * @property {boolean} blocked
 * @property {string} blockedReason
 * @property {string} blockedCategory
 * @property {string} blockedLogId
 * @property {string} blockedMessage
 * @property {BlockedAccountEntry[]} blockedAccounts
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

export const SOCIAL_TIKTOK_CODES = Object.freeze({
  RATE_LIMITED: 'SOCIAL_TIKTOK_RATE_LIMITED',
  PUBLISH_RESTRICTED: 'SOCIAL_TIKTOK_PUBLISH_RESTRICTED',
  POSTING_BANNED: 'SOCIAL_TIKTOK_POSTING_BANNED',
  TOKEN_INVALID: 'SOCIAL_TIKTOK_TOKEN_INVALID',
  SCOPE_MISSING: 'SOCIAL_TIKTOK_SCOPE_MISSING',
  UPSTREAM_ERROR: 'SOCIAL_TIKTOK_UPSTREAM_ERROR',
})

const SAFE_TAG_TOKEN_RE = /^[A-Za-z0-9_.-]+$/
const TRAILING_SOCIAL_TAG_RE = /\s*\[((?:(?:code|upstream_code|upstream_log_id)=[A-Za-z0-9_.-]+\s*)+)\]\s*$/

/** @param {unknown} value @returns {boolean} */
export function isSocialTikTokCode(value) {
  return typeof value === 'string' && value.startsWith('SOCIAL_TIKTOK_')
}

/** @param {unknown} value @returns {string} */
function safeTagToken(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed !== '' && SAFE_TAG_TOKEN_RE.test(trimmed) ? trimmed : ''
}

/**
 * Parse a structured tail tag appended by the hub boundary:
 * `... [code=SOCIAL_TIKTOK_* upstream_code=... upstream_log_id=...]`
 * @param {string} rawText
 * @returns {{ message: string, code: string, upstream_code: string, upstream_log_id: string } | null}
 */
export function parseSocialTikTokTag(rawText) {
  if (typeof rawText !== 'string' || rawText === '') return null
  const match = TRAILING_SOCIAL_TAG_RE.exec(rawText)
  if (!match) return null
  let code = ''
  let upstreamCode = ''
  let upstreamLogId = ''
  for (const part of match[1].trim().split(/\s+/)) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const key = part.slice(0, eq)
    const val = safeTagToken(part.slice(eq + 1))
    if (!val) continue
    if (key === 'code') code = val
    else if (key === 'upstream_code') upstreamCode = val
    else if (key === 'upstream_log_id') upstreamLogId = val
  }
  if (!code && !upstreamCode && !upstreamLogId) return null
  return {
    message: rawText.slice(0, match.index).trim(),
    code,
    upstream_code: upstreamCode,
    upstream_log_id: upstreamLogId,
  }
}

const UPSTREAM_CODE_PATTERNS = [
  ['rate_limit_exceeded', 'rate_limited', SOCIAL_TIKTOK_CODES.RATE_LIMITED],
  ['spam_risk_user_banned_from_posting', 'posting_banned', SOCIAL_TIKTOK_CODES.POSTING_BANNED],
  ['spam_risk_too_many_posts', 'publish_restricted', SOCIAL_TIKTOK_CODES.PUBLISH_RESTRICTED],
  ['reached_active_user_cap', 'publish_restricted', SOCIAL_TIKTOK_CODES.PUBLISH_RESTRICTED],
  ['spam_risk_too_many_pending_share', 'publish_restricted', SOCIAL_TIKTOK_CODES.PUBLISH_RESTRICTED],
  ['unaudited_client_can_only_post_to_private_accounts', 'publish_restricted', SOCIAL_TIKTOK_CODES.PUBLISH_RESTRICTED],
  ['url_ownership_unverified', 'publish_restricted', SOCIAL_TIKTOK_CODES.PUBLISH_RESTRICTED],
  ['access_token_invalid', 'token_invalid', SOCIAL_TIKTOK_CODES.TOKEN_INVALID],
  ['scope_not_authorized', 'scope_missing', SOCIAL_TIKTOK_CODES.SCOPE_MISSING],
]

/** @param {string} code @returns {string} */
function categoryFromUpstreamCode(code) {
  const lower = code.trim().toLowerCase()
  if (!lower) return ''
  for (const [token, category] of UPSTREAM_CODE_PATTERNS) {
    if (lower === token) return category
  }
  if (lower.includes('banned_from_posting') || lower.includes('user_banned')) return 'posting_banned'
  if (lower.includes('rate_limit')) return 'rate_limited'
  if (lower.includes('spam_risk') || lower.includes('active_user_cap') || lower.includes('unaudited_client') || lower.includes('url_ownership')) {
    return 'publish_restricted'
  }
  if (lower === 'access_token_invalid') return 'token_invalid'
  if (lower === 'scope_not_authorized') return 'scope_missing'
  return ''
}

/** @param {string} code @returns {string} */
function categoryFromSocialCode(code) {
  switch (code) {
    case SOCIAL_TIKTOK_CODES.RATE_LIMITED: return 'rate_limited'
    case SOCIAL_TIKTOK_CODES.POSTING_BANNED: return 'posting_banned'
    case SOCIAL_TIKTOK_CODES.PUBLISH_RESTRICTED: return 'publish_restricted'
    case SOCIAL_TIKTOK_CODES.TOKEN_INVALID: return 'token_invalid'
    case SOCIAL_TIKTOK_CODES.SCOPE_MISSING: return 'scope_missing'
    case SOCIAL_TIKTOK_CODES.UPSTREAM_ERROR: return 'upstream_error'
    default: return ''
  }
}

/** @param {string} category @returns {string} */
export function socialCodeFromCategory(category) {
  switch (category) {
    case 'rate_limited': return SOCIAL_TIKTOK_CODES.RATE_LIMITED
    case 'posting_banned': return SOCIAL_TIKTOK_CODES.POSTING_BANNED
    case 'publish_restricted': return SOCIAL_TIKTOK_CODES.PUBLISH_RESTRICTED
    case 'token_invalid': return SOCIAL_TIKTOK_CODES.TOKEN_INVALID
    case 'scope_missing': return SOCIAL_TIKTOK_CODES.SCOPE_MISSING
    default: return SOCIAL_TIKTOK_CODES.UPSTREAM_ERROR
  }
}

/** @param {...unknown} values @returns {string} */
function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return ''
}

/**
 * Extract structured TikTok error metadata from a wire error body, Error, or string.
 * @param {unknown} source
 * @returns {{ code: string, upstream_code: string, upstream_log_id: string, message: string }}
 */
export function extractTikTokErrorMeta(source) {
  if (typeof source === 'string') {
    const tagged = parseSocialTikTokTag(source)
    if (tagged) {
      return {
        code: tagged.code,
        upstream_code: tagged.upstream_code,
        upstream_log_id: tagged.upstream_log_id,
        message: tagged.message || source.trim(),
      }
    }
    return { code: '', upstream_code: '', upstream_log_id: '', message: source.trim() }
  }
  const obj = asObj(source)
  if (!obj) return { code: '', upstream_code: '', upstream_log_id: '', message: '' }
  const details = asObj(obj.details)
  const errObj = asObj(obj.error)
  const rawMessage = firstNonEmptyString(
    obj.message,
    errObj?.message,
    typeof obj.error === 'string' ? obj.error : '',
  )
  const tagged = parseSocialTikTokTag(rawMessage)
  const codeCandidates = [
    obj.code,
    details?.code,
    typeof obj.error === 'string' ? obj.error : '',
    obj.error_code,
    tagged?.code,
  ]
  const socialCode = /** @type {string | undefined} */ (codeCandidates.find((c) => isSocialTikTokCode(c)))
  const code = socialCode || firstNonEmptyString(...codeCandidates)
  const upstreamCode = firstNonEmptyString(
    obj.upstream_code,
    details?.upstream_code,
    errObj && typeof errObj.code === 'string' && errObj.code.toLowerCase() !== 'ok' ? errObj.code : '',
    tagged?.upstream_code,
  )
  const upstreamLogId = firstNonEmptyString(
    obj.upstream_log_id,
    details?.upstream_log_id,
    errObj?.log_id,
    tagged?.upstream_log_id,
  )
  const message = tagged && tagged.message ? tagged.message : rawMessage
  return { code, upstream_code: upstreamCode, upstream_log_id: upstreamLogId, message }
}

/**
 * Classify a TikTok social error with strict priority:
 * `upstream_code` -> `code` (`SOCIAL_TIKTOK_*`) -> legacy text fallback -> fail-closed (`upstream_error`).
 * @param {unknown} input
 * @returns {{ category: string, code: string, upstream_code: string, upstream_log_id: string, message: string, matchedSocial: boolean }}
 */
export function classifyTikTokError(input) {
  const meta = extractTikTokErrorMeta(input)
  const message = meta.message
  let upstreamCode = meta.upstream_code
  let category = categoryFromUpstreamCode(upstreamCode)
  if (!category && isSocialTikTokCode(meta.code)) {
    category = categoryFromSocialCode(meta.code)
  }
  if (!category && message) {
    const lower = message.toLowerCase()
    for (const [token, cat] of UPSTREAM_CODE_PATTERNS) {
      if (lower.includes(token)) {
        if (!upstreamCode) upstreamCode = token
        category = cat
        break
      }
    }
    if (!category) {
      if (/rate_limit|too many requests|\bhttp\s*429\b/i.test(message)) category = 'rate_limited'
      else if (/banned_from_posting|user_banned/i.test(message)) category = 'posting_banned'
      else if (/spam_risk|too_many_posts|active_user_cap|too_many_pending|unaudited_client|url_ownership|cannot_post/i.test(message)) category = 'publish_restricted'
      else if (/access_token_invalid/i.test(message)) category = 'token_invalid'
      else if (/scope_not_authorized/i.test(message)) category = 'scope_missing'
    }
  }
  const matchedSocial = Boolean(
    category
    || isSocialTikTokCode(meta.code)
    || upstreamCode
    || /\btiktok:/i.test(message),
  )
  const resolvedCategory = category || 'upstream_error'
  const upstreamCategory = categoryFromUpstreamCode(meta.upstream_code)
  const resolvedCode = upstreamCategory
    ? socialCodeFromCategory(upstreamCategory)
    : (isSocialTikTokCode(meta.code)
      ? meta.code
      : (matchedSocial ? socialCodeFromCategory(resolvedCategory) : meta.code))
  return {
    category: resolvedCategory,
    code: resolvedCode,
    upstream_code: upstreamCode,
    upstream_log_id: meta.upstream_log_id,
    message,
    matchedSocial,
  }
}

/**
 * Format a compact diagnostic message for task ledger persistence (preserves
 * upstream_code and upstream_log_id without leaking secrets).
 * @param {unknown} error
 * @returns {string}
 */
export function formatTikTokErrorDiagnostic(error) {
  const info = classifyTikTokError(error)
  const base = info.message || (error instanceof Error ? error.message : String(error || 'publish failed'))
  /** @type {string[]} */
  const suffix = []
  if (info.upstream_code && !base.includes(info.upstream_code)) suffix.push(`upstream_code=${info.upstream_code}`)
  if (info.upstream_log_id && !base.includes(info.upstream_log_id)) suffix.push(`log_id=${info.upstream_log_id}`)
  return suffix.length > 0 ? `${base} (${suffix.join(', ')})` : base
}

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
 * Privacy levels the account may actually choose.
 * - When `creatorInfo` is provided (Direct Post), strictly trust upstream
 *   `privacy_level_options` without fabricating fallback levels (explicit `[]`
 *   or unknown values stay `[]` for fail-closed handling).
 * - Only when `creatorInfo` is null/undefined (legacy compatibility path with
 *   no `creator_info` query) return all official levels.
 * @param {unknown} creatorInfo
 * @returns {string[]}
 */
export function privacyChoices(creatorInfo) {
  const info = asObj(creatorInfo)
  if (!info) return [...TIKTOK_PRIVACY_LEVELS]
  return parsePrivacyList(info.privacy_level_options)
}

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
 * Map a classified TikTok error category to the coarse Direct Post block code.
 * @param {string} category
 * @returns {string}
 */
function blockCodeForCategory(category) {
  if (category === 'rate_limited' || category === 'posting_banned' || category === 'publish_restricted') {
    return 'creator-cannot-post'
  }
  return 'creator-info-unavailable'
}

/**
 * Aggregate `creator_info` responses across one or more Direct Post accounts:
 * - Privacy options: intersection (preserving official ordering); explicit empty
 *   `privacy_level_options` never falls back to all 4 levels (fail-closed).
 * - Max video duration: minimum positive `max_video_post_duration_sec`.
 * - Interaction disabled flags: union (OR), recording which accounts disable each.
 * - Any error / `can_post === false` / empty privacy options -> fail-closed `blocked: true`.
 * @param {CreatorInfoEntry[]} entries
 * @returns {AggregatedCreatorInfo}
 */
export function aggregateCreatorInfo(entries) {
  const list = Array.isArray(entries) ? entries : []
  /** @type {NormalizedCreatorInfo[]} */
  const creators = []
  /** @type {BlockedAccountEntry[]} */
  const blockedAccounts = []
  /** @type {{ comment: string[], duet: string[], stitch: string[] }} */
  const disabledBy = { comment: [], duet: [], stitch: [] }

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const accountId = String(entry.account_id || '')
    const fallbackName = String(entry.display_name || accountId)
    const hasExplicitError = (typeof entry.error === 'string' && entry.error.trim() !== '')
      || (typeof entry.error_code === 'string' && entry.error_code.trim() !== '')
      || (typeof entry.upstream_code === 'string' && entry.upstream_code.trim() !== '')
      || Boolean(asObj(entry.errorBody))
    if (hasExplicitError) {
      const errSource = asObj(entry.errorBody) ?? {
        code: entry.error_code ?? '',
        upstream_code: entry.upstream_code ?? '',
        upstream_log_id: entry.upstream_log_id ?? '',
        message: typeof entry.error === 'string' ? entry.error.trim() : '',
      }
      const classified = classifyTikTokError(errSource)
      const msg = classified.message || (typeof entry.error === 'string' ? entry.error.trim() : '') || classified.upstream_code || classified.code || 'creator_info unavailable'
      blockedAccounts.push({
        account_id: accountId,
        display_name: fallbackName,
        code: blockCodeForCategory(classified.category),
        category: classified.category,
        social_code: isSocialTikTokCode(classified.code) ? classified.code : '',
        upstream_code: classified.upstream_code,
        upstream_log_id: classified.upstream_log_id,
        message: msg,
      })
      continue
    }
    const rawEnvelope = asObj(entry.data)
    if (rawEnvelope && (rawEnvelope.success === false || isSocialTikTokCode(rawEnvelope.code) || (typeof rawEnvelope.upstream_code === 'string' && rawEnvelope.upstream_code.trim() !== ''))) {
      const classified = classifyTikTokError(rawEnvelope)
      const msg = classified.message || classified.upstream_code || classified.code || 'creator_info unavailable'
      blockedAccounts.push({
        account_id: accountId,
        display_name: fallbackName,
        code: blockCodeForCategory(classified.category),
        category: classified.category,
        social_code: isSocialTikTokCode(classified.code) ? classified.code : '',
        upstream_code: classified.upstream_code,
        upstream_log_id: classified.upstream_log_id,
        message: msg,
      })
      continue
    }
    const data = unwrapCreatorInfoData(entry.data)
    if (!data || data.degraded === true) {
      blockedAccounts.push({
        account_id: accountId,
        display_name: fallbackName,
        code: 'creator-info-unavailable',
        category: 'upstream_error',
        social_code: '',
        upstream_code: '',
        upstream_log_id: '',
        message: 'creator_info unavailable',
      })
      continue
    }
    const errObj = asObj(data.error)
    const errCode = errObj && typeof errObj.code === 'string' ? errObj.code.trim() : ''
    const errMsg = errObj && typeof errObj.message === 'string' ? errObj.message.trim() : ''
    if (errCode !== '' && errCode.toLowerCase() !== 'ok') {
      const detail = errMsg ? `${errCode}: ${errMsg}` : errCode
      const classified = classifyTikTokError({
        upstream_code: errCode,
        upstream_log_id: errObj && typeof errObj.log_id === 'string' ? errObj.log_id : '',
        message: detail,
      })
      blockedAccounts.push({
        account_id: accountId,
        display_name: fallbackName,
        code: blockCodeForCategory(classified.category),
        category: classified.category,
        social_code: isSocialTikTokCode(classified.code) ? classified.code : '',
        upstream_code: classified.upstream_code || errCode,
        upstream_log_id: classified.upstream_log_id,
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
      privacy_level_options: allowed,
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
      const classified = classifyTikTokError({
        code: data.code,
        upstream_code: data.upstream_code,
        upstream_log_id: data.upstream_log_id,
        message: reason,
      })
      blockedAccounts.push({
        account_id: accountId,
        display_name: nickname,
        code: 'creator-cannot-post',
        category: classified.category === 'upstream_error' ? 'publish_restricted' : classified.category,
        social_code: isSocialTikTokCode(classified.code) ? classified.code : '',
        upstream_code: classified.upstream_code,
        upstream_log_id: classified.upstream_log_id,
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
  const primaryBlocked = blockedAccounts.find((b) => b.code === blockedReason) ?? blockedAccounts[0] ?? null
  let blockedCategory = primaryBlocked?.category ?? ''
  const blockedLogId = blockedAccounts.find((b) => b.upstream_log_id)?.upstream_log_id ?? ''
  let blockedMessage = blockedAccounts.map((b) => {
    const logSuffix = b.upstream_log_id && !b.message.includes(b.upstream_log_id) ? ` [log_id=${b.upstream_log_id}]` : ''
    return `${b.display_name}: ${b.message}${logSuffix}`
  }).join('; ')

  if (!blocked && creators.length > 0 && intersectedPrivacy.length === 0) {
    blocked = true
    blockedReason = creators.length > 1 ? 'privacy-intersection-empty' : 'privacy-options-empty'
    blockedCategory = blockedReason
    blockedMessage = creators.length > 1
      ? 'selected accounts share no common privacy level'
      : 'creator_info returned no available privacy_level_options'
  }

  const ready = list.length > 0 && !blocked && blockedAccounts.length === 0 && creators.length === list.length
  const canPost = !blocked && creators.every((c) => c.can_post)
  const hasNonPrivatePrivacy = intersectedPrivacy.some((level) => level !== 'SELF_ONLY')

  return {
    ready,
    blocked,
    blockedReason,
    blockedCategory,
    blockedLogId,
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
