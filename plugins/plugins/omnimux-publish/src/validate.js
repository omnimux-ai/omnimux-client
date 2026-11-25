/**
 * validate.js: 能力矩阵 + 账号可用性校验（工具面与 HTTP 面共用的单一真源）。
 *
 * 同一份合并矩阵（config.platforms）喂 UI 表单裁剪（GET /dsh-publish/capabilities）
 * 与本模块的提交前拦截 —— 同源，保证 UI 与 agent 行为一致。
 */
import { PublishError } from './publish-error.js'
import { RECORD_TYPES } from './record-schema.js'
import { isObject, isStringArray } from './shared/values.js'
import { normalizeTikTokOptions, tiktokOptionProblems } from './shared/tiktok-options.js'
import { accountMaxMediaItems, accountPublishMode, resolveSelectionPublishMode } from './shared/tiktok-capabilities.js'
import { unsupportedImageRows } from './shared/image-format.js'
/** @typedef {{ path?: string, media_id?: string, kind?: string }} MediaRef */
/** @typedef {{ type?: unknown, title?: unknown, description?: unknown, topics?: string[], media?: MediaRef[], cover?: MediaRef, settings?: Record<string, unknown>, account_ids?: string[] }} DraftPayload */
import { accountAvailability } from './accounts.js'
import { ACCOUNT_SOURCE_MESSAGE, isPublishingAccount } from './account-policy.js'

/**
 * 媒体种类收集：`mediaKinds` = record.media_ids 对应的 kind 列表（调用方从 MediaStore 取）。
 * @param {{ kind: string }[]} [mediaRows]
 */
function countKinds(mediaRows = []) {
  const rows = Array.isArray(mediaRows) ? mediaRows : []
  return {
    videos: rows.filter((row) => row.kind === 'video').length,
    images: rows.filter((row) => row.kind === 'image').length,
    others: rows.filter((row) => row.kind === 'other').length,
    total: rows.length,
  }
}

/**
 * 平台能力冲突检查（一份内容 × 多平台账号）。
 * @param {string} type record type ('video' | 'image')
 * @param {{ videos: number, images: number, total: number }} counts
 * @param {{ cover: boolean }} flags
 * @param {import('./config.js').PlatformCapabilities} platformRow
 * @param {string} platformName
 * @returns {string[]} 该平台的冲突描述
 */
function platformConflicts(type, counts, flags, platformRow, platformName) {
  /** @type {string[]} */
  const problems = []
  const mediaTypes = Array.isArray(platformRow.media_types) ? platformRow.media_types : []
  if (!mediaTypes.some((mediaType) => mediaType === type)) {
    problems.push(`平台 ${platformName} 不支持${type === 'video' ? '视频' : '图文'}内容（media_types: ${JSON.stringify(mediaTypes)}）`)
  }
  if (flags.cover && platformRow.supports_cover !== true) {
    problems.push(`平台 ${platformName} 不支持封面（supports_cover: false）`)
  }
  if (type === 'image' && typeof platformRow.max_images === 'number' && counts.images > platformRow.max_images) {
    problems.push(`平台 ${platformName} 图文最多 ${platformRow.max_images} 张图（当前 ${counts.images} 张）`)
  }
  return problems
}

/**
 * 内容自身校验（不依赖账号；create/update draft 即可执行）。
 * @param {{
 *   type: string,
 *   title?: string,
 *   description?: string,
 *   mediaRows?: Array<{ kind: string, id: string }>,
 *   coverRow?: { kind: string, id: string } | null,
 * }} draft
 * @returns {Array<{ code: string, field: string, message: string }>}
 */
export function validateContent(draft) {
  /** @type {Array<{ code: string, field: string, message: string }>} */
  const errors = []
  if (!RECORD_TYPES.includes(draft.type)) {
    errors.push({ code: 'invalid-type', field: 'type', message: `type 必须是 ${RECORD_TYPES.join(' | ')}，收到 ${JSON.stringify(draft.type)}` })
    return errors
  }
  const counts = countKinds(draft.mediaRows)
  if (counts.others > 0) {
    errors.push({ code: 'media-kind-unsupported', field: 'media', message: '存在无法识别类型的媒体文件（仅支持 image/* 与 video/*）' })
  }
  if (draft.type === 'video') {
    if (counts.videos === 0) {
      errors.push({ code: 'video-required', field: 'media', message: '视频发布至少需要一个视频文件' })
    }
  } else {
    if (counts.images === 0) {
      errors.push({ code: 'image-required', field: 'media', message: '图文发布至少需要一张图片' })
    }
    if (typeof draft.title !== 'string' || draft.title.trim() === '') {
      errors.push({ code: 'title-required', field: 'title', message: '图文发布需要标题' })
    }
  }
  if (draft.coverRow && draft.coverRow.kind !== 'image') {
    errors.push({ code: 'cover-not-image', field: 'cover', message: '封面必须是图片' })
  }
  const hasText = (typeof draft.title === 'string' && draft.title.trim() !== '') || (typeof draft.description === 'string' && draft.description.trim() !== '')
  if (!hasText) {
    errors.push({ code: 'text-required', field: 'description', message: '标题与描述至少填一项' })
  }
  return errors
}

/** @type {Record<string, string>} */
const TIKTOK_OPTION_MESSAGES = {
  'privacy-level-required': 'TikTok 直发必须手动选择隐私级别（请在 settings.tiktok_options.privacy_level 指定该账号允许的可见范围）',
  'privacy-level-disallowed': '所选隐私级别不在该 TikTok 账号允许的 privacy_level_options 范围内，请重新选择',
  'commercial-brand-required': '开启商业内容披露后，必须至少选择「你的品牌（your_brand）」或「品牌合作内容（branded_content）」之一',
  'branded-requires-public': '品牌合作内容（branded_content）不可设置为「仅自己可见（SELF_ONLY）」，请选择其他可见范围',
  'music-confirmation-required': 'TikTok 直发必须确认音乐使用条款（请将 settings.tiktok_options.music_usage_confirmed 设为 true）',
}

/**
 * submit 前全量校验：内容 + 账号存在性 + 账号可用性 + 平台能力冲突 + TikTok Direct Post 合规与创作者能力校验。
 * @param {{
 *   type: string,
 *   title?: string,
 *   description?: string,
 *   mediaRows?: Array<{ kind: string, id: string, filename?: string, content_type?: string, duration_sec?: number | null }>,
 *   coverRow?: { kind: string, id: string } | null,
 *   account_ids: string[],
 *   settings?: Record<string, unknown>,
 * }} draft
 * @param {{
 *   accounts: Record<string, unknown>[],
 *   platforms: Record<string, import('./config.js').PlatformCapabilities>,
 *   phase?: 'submit' | 'assign',
 *   creatorInfo?: import('./shared/tiktok-options.js').AggregatedCreatorInfo | null,
 * }} ctx
 * @returns {{ ok: boolean, errors: Array<{ code: string, field: string, message: string }> }}
 */
export function validateForSubmit(draft, ctx) {
  const errors = [...validateContent(draft)]
  const byId = new Map((ctx.accounts || []).map((row) => [String(row.id), row]))
  const selectedRows = Array.isArray(draft.account_ids)
    ? draft.account_ids.map((id) => byId.get(String(id))).filter((row) => row != null)
    : []
  const selectionMode = resolveSelectionPublishMode(selectedRows)
  const isAssignPhase = ctx.phase === 'assign'
  const creatorInfo = ctx.creatorInfo ?? null
  const hasTikTokOptions = Boolean(draft.settings && isObject(draft.settings.tiktok_options))
  if (!isAssignPhase && (selectionMode === 'direct' || (selectionMode !== 'draft_only' && hasTikTokOptions))) {
    const allowedPrivacyLevels = creatorInfo && creatorInfo.privacy_level_options.length > 0
      ? creatorInfo.privacy_level_options
      : null
    for (const code of tiktokOptionProblems(
      normalizeTikTokOptions(hasTikTokOptions ? draft.settings?.tiktok_options : undefined),
      { allowedPrivacyLevels, type: draft.type, requireMusicConfirmation: true },
    )) {
      errors.push({ code, field: 'settings.tiktok_options', message: TIKTOK_OPTION_MESSAGES[code] ?? code })
    }
  }
  if (!isAssignPhase && selectionMode === 'direct' && creatorInfo) {
    if (creatorInfo.blocked) {
      const code = creatorInfo.blockedReason || 'creator-info-unavailable'
      const defaultMsg = code === 'creator-cannot-post'
        ? '当前 TikTok 账号暂时无法发布（已达发帖上限或受平台限制），请稍后再试'
        : code === 'privacy-intersection-empty'
          ? '所选多个 TikTok 账号之间没有共同可用的隐私级别，请调整账号选择'
          : code === 'privacy-options-empty'
            ? '当前 TikTok 账号未返回可用的隐私级别选项，已阻断发布，请重试后再试'
            : '无法读取 TikTok 创作者发布能力（creator_info），请重试后再发布'
      errors.push({
        code,
        field: 'account_ids',
        message: creatorInfo.blockedMessage ? `${defaultMsg}（${creatorInfo.blockedMessage}）` : defaultMsg,
      })
    }
    if (draft.type === 'video' && typeof creatorInfo.max_video_post_duration_sec === 'number' && creatorInfo.max_video_post_duration_sec > 0) {
      const maxSec = creatorInfo.max_video_post_duration_sec
      for (const row of Array.isArray(draft.mediaRows) ? draft.mediaRows : []) {
        if (row.kind !== 'video') continue
        if (typeof row.duration_sec === 'number' && Number.isFinite(row.duration_sec) && row.duration_sec > maxSec) {
          errors.push({
            code: 'video-duration-exceeded',
            field: 'media',
            message: `视频时长 ${Math.round(row.duration_sec)}s 超出当前 TikTok 账号允许的最大时长 ${maxSec}s`,
          })
        }
      }
    }
  }
  if (!Array.isArray(draft.account_ids) || draft.account_ids.length === 0) {
    errors.push({ code: 'accounts-required', field: 'account_ids', message: '提交前需要至少选择一个账号（publish_assign_accounts）' })
    return { ok: false, errors }
  }
  const counts = countKinds(draft.mediaRows)
  const flags = { cover: Boolean(draft.coverRow) }
  const mediaRows = Array.isArray(draft.mediaRows) ? draft.mediaRows : []
  let checkedTikTokMediaRules = false
  /** @type {Set<string>} */
  const seen = new Set()
  for (const accountId of draft.account_ids) {
    const key = String(accountId)
    if (seen.has(key)) continue
    seen.add(key)
    const row = byId.get(key)
    if (!isPublishingAccount(row)) {
      errors.push({ code: 'account-provider-mismatch', field: 'account_ids', message: `账号 ${key}：${ACCOUNT_SOURCE_MESSAGE}` })
      continue
    }
    const availability = accountAvailability(row)
    if (!availability.ok) {
      errors.push({ code: 'account-unavailable', field: 'account_ids', message: `账号 ${key}（${String(row.display_name || row.username || row.platform || '')}）不可用：${availability.reason}` })
      continue
    }
    const platform = String(row.platform || '').toLowerCase()
    const platformRow = ctx.platforms ? ctx.platforms[platform] : undefined
    if (!platformRow) {
      errors.push({ code: 'platform-unknown', field: 'account_ids', message: `账号 ${key} 的平台 ${platform || '(空)'} 不在能力矩阵中；可在配置 publish.platforms 中补充该平台定义` })
      continue
    }
    const capMaxImages = accountMaxMediaItems(row)
    const effectivePlatformRow = typeof capMaxImages === 'number'
      && (typeof platformRow.max_images !== 'number' || capMaxImages < platformRow.max_images)
      ? { ...platformRow, max_images: capMaxImages }
      : platformRow
    for (const problem of platformConflicts(draft.type, counts, flags, effectivePlatformRow, platform)) {
      errors.push({ code: 'capability-conflict', field: 'accounts', message: problem })
    }
    const mode = accountPublishMode(row)
    if (!checkedTikTokMediaRules && (mode === 'draft_only' || mode === 'direct')) {
      checkedTikTokMediaRules = true
      if (counts.videos > 0 && counts.images > 0) {
        errors.push({ code: 'mixed-media-unsupported', field: 'media', message: 'TikTok 不支持视频与图片混合发布，请仅选择视频或仅选择图片' })
      }
      if (draft.type === 'video' && counts.videos > 1) {
        errors.push({ code: 'video-count-exceeded', field: 'media', message: `TikTok 视频发布仅支持 1 个视频（当前 ${counts.videos} 个）` })
      }
      if (draft.type === 'image') {
        const inspectable = mediaRows.filter((item) => item.kind === 'image' && (Boolean(item.content_type) || Boolean(item.filename)))
        const badImages = unsupportedImageRows(inspectable)
        if (badImages.length > 0) {
          errors.push({ code: 'image-format-unsupported', field: 'media', message: 'TikTok 图文仅支持 JPEG / WebP 图片格式（不支持 PNG/GIF 等）' })
        }
        const coverIndex = draft.settings && typeof draft.settings.photo_cover_index === 'number'
          ? draft.settings.photo_cover_index
          : undefined
        if (coverIndex !== undefined && (!Number.isInteger(coverIndex) || coverIndex < 0 || coverIndex >= counts.images)) {
          errors.push({ code: 'invalid-photo-cover-index', field: 'settings.photo_cover_index', message: `图文封面索引 photo_cover_index=${coverIndex} 超出范围 [0, ${counts.images})` })
        }
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

/**
 * 校验失败 → 确定性错误（工具面与 HTTP 面共用形态）。
 * @param {Array<{ code: string, field: string, message: string }>} errors
 */
export function validationError(errors) {
  const code = errors.some((error) => error.code === 'account-provider-mismatch') ? 'account-provider-mismatch' : 'validation-failed'
  return new PublishError(code, {
    message: '提交前校验未通过',
    errors,
  })
}

/**
 * payload 形状校验（publish_create_draft / publish_update_draft 的输入面）。
 * 媒体的 path|media_id 二选一；返回规整后的 media 引用列表。
 * @param {unknown} payload
 * @returns {DraftPayload}
 */
export function parseDraftPayload(payload) {
  if (payload === undefined || payload === null) return {}
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new PublishError('invalid-arguments', 'payload must be a JSON object')
  }
  const raw = /** @type {Record<string, unknown>} */ (payload)
  /** @type {DraftPayload} */
  // 注意：只有 raw 里出现的字段才进 out——patch 语义是「未提及的字段保持不变」，
  // 绝不能给 media 之类字段设缺省值（否则一个不含 media 的 patch 会清空素材）。
  const out = {}
  if ('type' in raw) out.type = raw.type
  if ('title' in raw) out.title = raw.title
  if ('description' in raw) out.description = raw.description
  if ('topics' in raw) {
    if (!isStringArray(raw.topics)) {
      throw new PublishError('invalid-arguments', 'payload.topics must be an array of strings')
    }
    out.topics = raw.topics
  }
  if ('media' in raw) {
    if (!Array.isArray(raw.media)) throw new PublishError('invalid-arguments', 'payload.media must be an array')
    const media = raw.media.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new PublishError('invalid-arguments', `payload.media[${index}] must be an object`)
      }
      const row = /** @type {Record<string, unknown>} */ (item)
      const hasPath = typeof row.path === 'string' && row.path.trim() !== ''
      const hasId = typeof row.media_id === 'string' && row.media_id.trim() !== ''
      if (!hasPath && !hasId) {
        throw new PublishError('invalid-arguments', `payload.media[${index}] needs path (local file) or media_id (already imported)`)
      }
      if (row.kind !== undefined && typeof row.kind !== 'string') {
        throw new PublishError('invalid-arguments', `payload.media[${index}].kind must be a string`)
      }
      return {
        ...(hasPath ? { path: String(row.path).trim() } : {}),
        ...(hasId ? { media_id: String(row.media_id).trim() } : {}),
        ...(typeof row.kind === 'string' ? { kind: row.kind } : {}),
      }
    })
    out.media = media
  }
  if ('cover' in raw && raw.cover !== undefined && raw.cover !== null) {
    if (typeof raw.cover !== 'object' || Array.isArray(raw.cover)) {
      throw new PublishError('invalid-arguments', 'payload.cover must be an object with path or media_id')
    }
    const cover = /** @type {Record<string, unknown>} */ (raw.cover)
    const hasPath = typeof cover.path === 'string' && cover.path.trim() !== ''
    const hasId = typeof cover.media_id === 'string' && cover.media_id.trim() !== ''
    if (!hasPath && !hasId) {
      throw new PublishError('invalid-arguments', 'payload.cover needs path or media_id')
    }
    out.cover = {
      ...(hasPath ? { path: String(cover.path).trim() } : {}),
      ...(hasId ? { media_id: String(cover.media_id).trim() } : {}),
    }
  }
  if ('settings' in raw && raw.settings !== undefined && raw.settings !== null) {
    if (!isObject(raw.settings)) {
      throw new PublishError('invalid-arguments', 'payload.settings must be an object')
    }
    out.settings = raw.settings
  }
  if ('account_ids' in raw && raw.account_ids !== undefined) {
    if (!isStringArray(raw.account_ids)) {
      throw new PublishError('invalid-arguments', 'payload.account_ids must be an array of strings')
    }
    out.account_ids = raw.account_ids
  }
  return out
}
