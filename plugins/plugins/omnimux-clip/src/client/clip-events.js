/**
 * Browser-side event names + payload guards.
 * Kept as a sibling of `src/seam/types.js` so the overlay / canvas copies
 * stay JSON-only (no React elements, no refs, no context).
 */

export const OMNIMUX_CLIP_OPEN = 'omnimux-clip-open'
export const OMNIMUX_CLIP_SAVE = 'omnimux-clip-save'
export const OMNIMUX_CLIP_CLOSE = 'omnimux-clip-close'
export const OMNIMUX_CLIP_PROGRESS = 'omnimux-clip-progress'
export const OMNIMUX_CLIP_RELOAD = 'omnimux-clip-reload'

export const CLIP_EVENT_MAX_BYTES = 1024 * 1024

const OPEN_SOURCES = new Set(['canvas', 'sidebar', 'agent', 'url'])

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * @param {unknown} payload
 */
export function assertJsonPayload(payload) {
  let encoded
  try {
    encoded = JSON.stringify(payload)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`clip payload is not JSON-serializable: ${reason}`)
  }
  if (encoded === undefined) {
    throw new Error('clip payload is not JSON-serializable')
  }
  const bytes = typeof TextEncoder === 'function'
    ? new TextEncoder().encode(encoded).length
    : encoded.length
  if (bytes > CLIP_EVENT_MAX_BYTES) {
    throw new Error('clip payload exceeds 1MB; persist via projectId')
  }
  return payload
}

/** Keep in sync with omnimux-workflow/src/canvas/bridge/clipEvents.ts. */
export function isCanvasClipBinding(payload) {
  if (!isPlainObject(payload)) return false
  const { workspaceId, nodeId, projectId } = payload
  return typeof workspaceId === 'string' && /^ws_[A-Za-z0-9_-]{1,128}$/.test(workspaceId)
    && typeof nodeId === 'string' && /^[^\s/\\\x00-\x1f\x7f]{1,256}$/.test(nodeId)
    && typeof projectId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(projectId)
}

/**
 * @param {unknown} payload
 */
export function isOpenClipEditorPayload(payload) {
  if (!isPlainObject(payload)) return false
  if (!OPEN_SOURCES.has(payload.source)) return false
  if (payload.nodeId != null && typeof payload.nodeId !== 'string') return false
  const { mediaReturn } = payload
  if (mediaReturn !== undefined) {
    if (payload.source !== 'canvas' || !isPlainObject(mediaReturn) || typeof mediaReturn.requestId !== 'string'
      || !/^[A-Za-z0-9-]{1,128}$/.test(mediaReturn.requestId) || !isPlainObject(mediaReturn.upstreamInputs)) return false
    for (const [key, list] of Object.entries(mediaReturn.upstreamInputs)) {
      if (!['videos', 'images', 'audios'].includes(key) || !Array.isArray(list)) return false
      if (!list.every(item => isPlainObject(item) && typeof item.path === 'string' && typeof item.name === 'string'
        && ['url', 'sourceId', 'sourceVersion'].every(field => item[field] === undefined || typeof item[field] === 'string'))) return false
    }
  }
  return payload.source !== 'canvas' || isCanvasClipBinding(payload)
}

/**
 * @param {unknown} payload
 */
export function isSaveClipEditorPayload(payload) {
  if (!isCanvasClipBinding(payload)) return false
  if (payload.schema != null && !isPlainObject(payload.schema)) return false
  if (payload.output != null) {
    if (!isPlainObject(payload.output)) return false
    if (typeof payload.output.videoPath !== 'string' || !payload.output.videoPath.trim()) return false
  }
  return true
}

/**
 * @param {unknown} payload
 */
export const isCloseClipEditorPayload = isCanvasClipBinding

/**
 * @param {unknown} payload
 */
export function isProgressClipEditorPayload(payload) {
  if (!isCanvasClipBinding(payload)) return false
  if (payload.status !== undefined && !['idle', 'editing', 'rendering', 'completed', 'error'].includes(payload.status)) return false
  if (payload.renderProgress !== undefined && !Number.isFinite(payload.renderProgress)) return false
  return true
}

/**
 * @param {string} type
 * @param {unknown} detail
 * @param {{ dispatch?: (event: Event) => boolean, target?: EventTarget }} [opts]
 */
export function dispatchClipEvent(type, detail, opts = {}) {
  assertJsonPayload(detail)
  const target = opts.target
    || (typeof window !== 'undefined' ? window : undefined)
  if (!target || typeof CustomEvent !== 'function') {
    throw new Error('clip events require a DOM EventTarget')
  }
  const event = new CustomEvent(type, { detail, bubbles: true })
  if (typeof opts.dispatch === 'function') return opts.dispatch(event)
  return target.dispatchEvent(event)
}
