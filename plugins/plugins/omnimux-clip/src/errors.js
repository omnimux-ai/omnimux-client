/**
 * Typed domain error for omnimux-clip. Tools MUST throw this class
 * (never return `{ ok: false }` as a successful value).
 *
 * Stable `code` strings are the wire contract — keep them ASCII kebab /
 * SCREAMING_SNAKE as frozen in the clip-studio spec.
 */
export class ClipDomainError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {object} [details]
   */
  constructor(code, message, details) {
    super(message)
    this.name = 'ClipDomainError'
    this.code = code
    const safe = safeDetails(details)
    if (safe) this.details = safe
  }

  static revisionConflict(currentRevision, message = 'The Clip revision changed. Read the latest project before editing.', currentRevisionEpoch) {
    return new ClipDomainError('REVISION_CONFLICT', message, { currentRevision, currentRevisionEpoch })
  }

  /**
   * @param {string} message
   */
  static needsClipPlugin(message = 'clip plugin is not loaded') {
    return new ClipDomainError('needs-clip-plugin', message)
  }

  /**
   * @param {string} message
   */
  static exportEncodeFailed(message = 'WebCodecs encoder failed') {
    return new ClipDomainError('export-encode-failed', message)
  }

  /**
   * Overlay is not mounted — snapshot / view RPC only.
   * @param {string} message
   */
  static previewNotReady(message = 'clip overlay is not mounted') {
    return new ClipDomainError('PREVIEW_NOT_READY', message)
  }

  /**
   * The Host has no connected clip editor executor.
   * @param {string} message
   */
  static uiUnavailable(message = 'clip UI channel is unavailable') {
    return new ClipDomainError('ui-unavailable', message)
  }

  /**
   * @param {string} message
   */
  static timelineGap(message = 'timeline has a gap') {
    return new ClipDomainError('timeline_gap', message)
  }

  /**
   * @param {string} message
   */
  static clipOverlap(message = 'clips overlap on the same track') {
    return new ClipDomainError('clip_overlap', message)
  }

  /**
   * @param {string} message
   */
  static mediaMissing(message = 'media file is missing') {
    return new ClipDomainError('media_missing', message)
  }

  /**
   * @param {string} message
   */
  static schemaTooLarge(message = 'event detail exceeds 1MB; persist via projectId') {
    return new ClipDomainError('schema-too-large', message)
  }

  /**
   * @param {string} message
   */
  static canceled(message = 'export canceled') {
    return new ClipDomainError('canceled', message)
  }

  /**
   * @param {string} message
   */
  static pathDenied(message = 'path escapes the clip storage domain') {
    return new ClipDomainError('path-denied', message)
  }

  /**
   * @param {string} message
   */
  static notFound(message = 'project not found') {
    return new ClipDomainError('not-found', message)
  }

  static projectNotMaterialized(id) {
    return new ClipDomainError('project-not-materialized', `Canvas clip project ${id} has no saved draft yet. Open its composition node in the canvas to initialize it.`)
  }

  static projectUnreadable(id) {
    return new ClipDomainError('project-unreadable', `Project ${id} could not be read. Check that its saved entry is a readable file.`)
  }

  static openReelMigrationRequired(id) {
    return new ClipDomainError('openreel-migration-required', `Project ${id} uses the native OpenReel format. The current Host tools read legacy TimelineSchema projects and require migration support for this project.`)
  }

  /**
   * @param {string} message
   */
  static invalidJson(message = 'invalid json') {
    return new ClipDomainError('invalid-json', message)
  }

  /**
   * @param {string} message
   */
  static invalidId(message = 'invalid project id') {
    return new ClipDomainError('invalid-id', message)
  }
}

/** HTTP status mapping for ClipDomainError.code. Unknown codes fall back to 400. */
export const CLIP_STATUS_BY_CODE = {
  'needs-clip-plugin': 503,
  'export-encode-failed': 500,
  PREVIEW_NOT_READY: 409,
  AMBIGUOUS_TARGET: 409,
  EDITOR_NOT_VISIBLE: 409,
  EDITOR_OFFLINE: 503,
  EDITOR_LEASE_CONFLICT: 409,
  LEASE_INVALID: 409,
  WINDOW_UNAUTHORIZED: 403,
  VIEWPORT_NOT_REGISTERED: 409,
  SESSION_REQUIRED: 403,
  REVISION_CONFLICT: 409,
  REQUEST_ID_CONFLICT: 409,
  REQUEST_NOT_FOUND: 404,
  REQUEST_EXPIRED: 410,
  REQUEST_NOT_CLAIMED: 409,
  CONFIRMATION_REQUIRED: 409,
  INVALID_RECEIPT: 400,
  'outcome-unknown': 409,
  'invalid-clip-binding': 400,
  'clip-binding-mismatch': 409,
  'outside-project-boundary': 403,
  'needs-workflow-clip': 503,
  'draft-link-failed': 409,
  'export-upload-failed': 500,
  'export-upload-used': 409,
  'export-cancelled': 409,
  'invalid-export-media': 415,
  'snapshot-save-failed': 500,
  'motion-expression-denied': 403,
  'ui-unavailable': 409,
  timeline_gap: 400,
  clip_overlap: 400,
  media_missing: 400,
  'schema-too-large': 413,
  canceled: 499,
  'path-denied': 403,
  'not-found': 404,
  'project-not-materialized': 404,
  'project-unreadable': 409,
  'openreel-migration-required': 409,
  'invalid-json': 400,
  'invalid-id': 400,
}

/**
 * @param {unknown} error
 * @returns {error is ClipDomainError}
 */
export function isClipDomainError(error) {
  return error instanceof ClipDomainError
}

/**
 * @param {unknown} error
 */
export function clipErrorStatus(error) {
  if (error instanceof ClipDomainError) {
    return Object.hasOwn(CLIP_STATUS_BY_CODE, error.code) ? CLIP_STATUS_BY_CODE[error.code] : 400
  }
  return 500
}

export const isClipRevision = (value) => Number.isSafeInteger(value) && value >= 0
export const isClipToken = (value) => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value)

export function safeClipLabel(value, fallback = '') {
  if (typeof value !== 'string') return fallback
  return value.replace(/(?:[A-Za-z]:\\|(?:file|https?):\/\/|(?:^|\s)\/)[^\s)]+/gi, ' [redacted]')
    .replace(/[\x00-\x1f\x7f-\x9f<>]/g, ' ').trim().slice(0, 160) || fallback
}

export function clipErrorValue(error) {
  const details = safeDetails(error.details ?? error.detail)
  return { code: error.code, message: error.message, ...(details ? { details } : {}) }
}

function safeDetails(value) {
  if (!value || typeof value !== 'object') return undefined
  const safe = {}
  if (value.currentRevision === null || isClipRevision(value.currentRevision)) safe.currentRevision = value.currentRevision
  if (isClipRevision(value.currentRevisionEpoch)) safe.currentRevisionEpoch = value.currentRevisionEpoch
  if (value.retryable === true) safe.retryable = true
  if (isClipRevision(value.operationIndex)) safe.operationIndex = value.operationIndex
  if (isClipRevision(value.exportJobId) || isClipToken(value.exportJobId)) safe.exportJobId = value.exportJobId
  for (const key of ['requestId', 'reason']) {
    if (isClipToken(value[key])) safe[key] = value[key]
  }
  if (Array.isArray(value.candidates)) {
    safe.candidates = value.candidates.slice(0, 20).flatMap((candidate) => {
      if (!isClipToken(candidate?.projectId) || !['canvas', 'standalone'].includes(candidate.mode)) return []
      const { projectId, mode, visible, workspaceId, nodeId, windowInstanceId } = candidate
      return [{
        projectId,
        title: safeClipLabel(candidate.title, projectId),
        mode,
        visible: visible === true,
        ...(isClipToken(workspaceId) ? { workspaceId } : {}),
        ...(typeof nodeId === 'string' && /^[^\s/\\<>\x00-\x1f\x7f-\x9f]{1,256}$/.test(nodeId) ? { nodeId } : {}),
        ...(isClipToken(windowInstanceId) ? { windowInstanceId } : {}),
      }]
    })
  }
  if (Array.isArray(value.windows)) safe.windows = value.windows.slice(0, 20).filter(isClipToken)
  return Object.keys(safe).length > 0 ? safe : undefined
}
