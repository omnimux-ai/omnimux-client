import { analysisInputFingerprint, analysisMediaItems, sourceFingerprint } from '../analysis-input.js'
import { hostMediaSrc, pickVideoSrc } from './api.js'

/** Original post text is independent of generated narration and analysis. */
export function getPostBody(item) {
  return typeof item?.content === 'string' ? item.content : ''
}

/** Keep persisted indexes: filtering an unusable URL must not retarget another asset. */
export function getPostMedia(item) {
  // Filesystem paths are not browser media addresses. A legacy player must have
  // a persisted URL; only an actual image record may use its saved cover.
  const hasUrls = item?.media_items?.length || item?.media_urls?.length
  const imageRecord = ['image', 'photo', 'gallery'].includes(item?.type)
    || ['photo', 'gallery'].includes(item?.content_shape) || item?.media_kind === 'image'
  if (!hasUrls && !imageRecord) return []
  const counters = { video: 0, image: 0 }
  return analysisMediaItems(item).flatMap((media, index) => {
    if (!media || !['video', 'image'].includes(media.type) || typeof media.url !== 'string') return []
    if (/^[a-z][a-z\d+.-]*:/i.test(media.url) && !/^https?:\/\//i.test(media.url)) return []
    const url = media.type === 'video' ? pickVideoSrc({ media_urls: [media.url] }) : hostMediaSrc(media.url)
    if (!url) return []
    const number = ++counters[media.type]
    const label = `${media.type === 'video' ? '视频' : '图片'} ${number}`
    return [{ ...media, id: `media:${index}`, index, url, label, title: media.title || label, duration: media.duration || (media.type === 'video' && number === 1 ? item?.duration : undefined) }]
  })
}

export function analysisTargetKey(target = { scope: 'post' }) {
  return target.scope === 'media' ? `media:${target.media_index}` : target.scope
}

/** The server lock remains active even if the saved input has since changed. */
export function hasRunningAnalysis(item) {
  return Object.values(item?.analysis_results || {}).some(entry => entry?.status === 'running')
}

/** Reuse the row poller without treating network errors as task completion. */
export function decideAnalysisPollOutcome(response) {
  if (response?.status === 404) return { action: 'gone' }
  const item = response?.body?.data
  if (!response?.ok || !item || typeof item !== 'object' || Array.isArray(item)) return { action: 'keep' }
  return { action: hasRunningAnalysis(item) ? 'pending' : 'settled', item }
}

/** Return only results whose complete saved inputs still match this post. */
export function getTargetAnalysis(item, target = { scope: 'post' }) {
  const key = analysisTargetKey(target)
  const entry = item?.analysis_results?.[key]
  if (entry) {
    const fingerprint = analysisInputFingerprint(item, { ...target, directions: entry.directions })
    if (entry.input_fingerprint !== fingerprint) return { ...entry, status: 'stale', error: '原帖或素材已更新，请重新分析', result: null }
    return entry
  }
  const firstVideo = analysisMediaItems(item).findIndex((media) => media?.type === 'video')
  const legacy = item?.deconstruction || item?.analysis
  if (target.scope === 'media' && target.media_index === firstVideo && legacy) {
    return { scope: 'media', media_index: firstVideo, status: 'legacy', source: 'legacy_unknown', model: '', result: typeof legacy === 'object' ? legacy : { markdown: legacy }, error: null }
  }
  return null
}

/** Direction IDs are stable across text, image and video; labels adapt in the view. */
export function analysisDirections() {
  return ['content', 'expression', 'creative']
}

export function getBodyTranslation(item) {
  const translation = item?.body_translation
  return translation?.source_fingerprint === sourceFingerprint(getPostBody(item)) && typeof translation.text === 'string'
    ? translation : null
}

/**
 * Classify a post into its polymorphic detail presentation mode.
 * @param {Record<string, any> | null | undefined} item
 * @param {Array<{ type: string }>} [media]
 * @param {string} [body]
 * @returns {'video' | 'carousel' | 'image' | 'text' | 'empty'}
 */
export function detectPostVariant(item, media = getPostMedia(item), body = getPostBody(item)) {
  const assets = Array.isArray(media) ? media : []
  if (assets.some((asset) => asset?.type === 'video')) return 'video'
  if (assets.length > 1 && assets.every((asset) => asset?.type === 'image')) return 'carousel'
  if (assets.length >= 1) return 'image'
  const rawType = String(item?.type || item?.content_shape || item?.media_kind || '').toLowerCase()
  if (rawType === 'video' && typeof item?.source_url === 'string' && /tiktok\.com/i.test(item.source_url)) {
    return 'video'
  }
  if (String(body || '').trim()) return 'text'
  return 'empty'
}

const STAGE_LOCALE_KEYS = Object.freeze({
  queued: 'post.stage.queued',
  'resolving-skill': 'post.stage.resolving-skill',
  'preparing-media': 'post.stage.preparing-media',
  executing: 'post.stage.executing',
  validating: 'post.stage.validating',
  'repairing-schema': 'post.stage.repairing-schema',
  done: 'post.stage.done',
  cancelled: 'post.stage.cancelled',
  failed: 'post.stage.failed',
})

/**
 * Map a Hub headlessSkill stage/status pair to its localized key.
 * @param {string | null | undefined} stage
 * @param {string | null | undefined} [status]
 * @returns {string}
 */
export function headlessStageLocaleKey(stage, status) {
  if (stage && STAGE_LOCALE_KEYS[stage]) return STAGE_LOCALE_KEYS[stage]
  if (status && STAGE_LOCALE_KEYS[status]) return STAGE_LOCALE_KEYS[status]
  return 'post.running'
}

/**
 * Filter a Hub event stream entry for one inspiration item's headless analysis job.
 * @param {{ type?: string, payload?: Record<string, any> } | null | undefined} event
 * @param {string | number | null | undefined} itemId
 * @returns {{
 *   targetKey: string,
 *   status: string,
 *   stage: string,
 *   jobId: string,
 *   model: string,
 *   error: string,
 *   errorCode: string,
 *   terminal: boolean,
 * } | null}
 */
export function matchHeadlessSkillEvent(event, itemId) {
  if (!event || event.type !== 'omnimux:headless-skill') return null
  const payload = event.payload
  if (!payload || typeof payload !== 'object') return null
  if (payload.ownerPlugin !== 'omnimux-inspiration') return null
  const id = itemId == null ? '' : String(itemId)
  const targetId = typeof payload.targetId === 'string' ? payload.targetId : ''
  if (!id || !targetId.startsWith(`${id}:`)) return null
  const targetKey = targetId.slice(id.length + 1)
  if (!targetKey || targetKey.startsWith('translate:')) return null
  const status = typeof payload.status === 'string' ? payload.status : ''
  const stage = typeof payload.stage === 'string' ? payload.stage : status
  return {
    targetKey,
    status,
    stage,
    jobId: typeof payload.jobId === 'string' ? payload.jobId : '',
    model: typeof payload.model === 'string' ? payload.model : '',
    error: typeof payload.error === 'string' ? payload.error : '',
    errorCode: typeof payload.errorCode === 'string' ? payload.errorCode : '',
    terminal: status === 'done' || status === 'failed' || status === 'cancelled',
  }
}
