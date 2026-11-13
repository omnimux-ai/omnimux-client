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

/**
 * @param {unknown} payload
 */
export function isOpenClipEditorPayload(payload) {
  if (!isPlainObject(payload)) return false
  if (!OPEN_SOURCES.has(payload.source)) return false
  if (payload.nodeId != null && typeof payload.nodeId !== 'string') return false
  if (payload.source === 'canvas' && !payload.nodeId) return false
  return true
}

/**
 * @param {unknown} payload
 */
export function isSaveClipEditorPayload(payload) {
  if (!isPlainObject(payload)) return false
  if (payload.nodeId != null && typeof payload.nodeId !== 'string') return false
  if (payload.projectId != null && typeof payload.projectId !== 'string') return false
  if (payload.schema != null && !isPlainObject(payload.schema)) return false
  if (payload.output != null) {
    if (!isPlainObject(payload.output)) return false
    if (typeof payload.output.videoPath !== 'string') return false
  }
  return true
}

/**
 * @param {unknown} payload
 */
export function isCloseClipEditorPayload(payload) {
  if (!isPlainObject(payload)) return false
  if (payload.nodeId != null && typeof payload.nodeId !== 'string') return false
  return true
}

/**
 * @param {unknown} payload
 */
export function isProgressClipEditorPayload(payload) {
  if (!isPlainObject(payload)) return false
  if (payload.nodeId != null && typeof payload.nodeId !== 'string') return false
  if (payload.status != null && typeof payload.status !== 'string') return false
  if (payload.renderProgress != null && typeof payload.renderProgress !== 'number') return false
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
