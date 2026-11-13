/**
 * Cross-plugin JSON contract for omnimux-clip.
 *
 * Workflow canvas MUST copy this file (or the event-name constants) rather
 * than import omnimux-clip source. Time unit inside a project is always
 * integer milliseconds.
 */

export const OMNIMUX_CLIP_OPEN = 'omnimux-clip-open'
export const OMNIMUX_CLIP_SAVE = 'omnimux-clip-save'
export const OMNIMUX_CLIP_CLOSE = 'omnimux-clip-close'
export const OMNIMUX_CLIP_PROGRESS = 'omnimux-clip-progress'

export const CLIP_EVENT_MAX_BYTES = 1024 * 1024

const OPEN_SOURCES = new Set(['canvas', 'sidebar', 'agent'])

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * CustomEvent.detail must stay JSON-serializable and ≤ 1MB.
 * Larger schemas go through PUT /omnimux-clip/api/projects/:id first.
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
  if (Buffer.byteLength(encoded, 'utf8') > CLIP_EVENT_MAX_BYTES) {
    throw new Error('clip payload exceeds 1MB; persist via projectId')
  }
  return payload
}

/**
 * @param {unknown} payload
 * @returns {payload is {
 *   source: 'canvas' | 'sidebar' | 'agent',
 *   nodeId?: string,
 *   workspaceId?: string,
 *   nodeTitle?: string,
 *   draftSchema?: object,
 *   upstreamInputs?: object,
 *   canvasConfig?: object,
 *   projectId?: string,
 * }}
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
 * @returns {payload is {
 *   nodeId?: string,
 *   schema?: object,
 *   projectId?: string,
 *   output?: {
 *     videoPath: string,
 *     thumbnailPath?: string,
 *     durationMs?: number,
 *     width?: number,
 *     height?: number,
 *   },
 * }}
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
 * @returns {payload is { nodeId?: string }}
 */
export function isCloseClipEditorPayload(payload) {
  if (!isPlainObject(payload)) return false
  if (payload.nodeId != null && typeof payload.nodeId !== 'string') return false
  return true
}

/**
 * @param {unknown} payload
 * @returns {payload is {
 *   nodeId?: string,
 *   status?: string,
 *   renderProgress?: number,
 * }}
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
 */
export function createClipEvent(type, detail) {
  assertJsonPayload(detail)
  return new CustomEvent(type, { detail, bubbles: true })
}
