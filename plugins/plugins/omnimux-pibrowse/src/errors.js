export class PibrowseError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details) {
    super(message)
    this.name = 'PibrowseError'
    this.code = code
    if (details && typeof details === 'object') {
      this.details = details
    }
  }
}

const CODE_STATUS_MAP = Object.freeze({
  'invalid-input': 400,
  'invalid-json': 400,
  'invalid-path': 400,
  'invalid-url': 400,
  'confirmation-required': 400,
  'not-local': 403,
  'insecure-socket': 403,
  'unauthorized': 401,
  'totp-required': 401,
  'forbidden': 403,
  'not-found': 404,
  'conflict': 409,
  'proxy-in-use': 409,
  'profile-locked': 409,
  'rollback-detected': 409,
  'checksum-mismatch': 422,
  'unsupported-platform': 422,
  'gatekeeper-blocked': 422,
  'agent-not-installed': 503,
  'core-not-installed': 503,
  'sidecar-offline': 503,
  'ipc-timeout': 504,
  'ipc-error': 502,
  'team-offline': 502,
  'team-error': 502,
  'team-locked': 423,
  'install-failed': 500,
})

/**
 * Map a domain error to an HTTP status code.
 * @param {unknown} err
 * @returns {number}
 */
export function httpStatusForError(err) {
  if (err && typeof err === 'object') {
    const status = /** @type {{ httpStatus?: unknown, status?: unknown, code?: unknown }} */ (err)
    if (typeof status.httpStatus === 'number' && status.httpStatus >= 400 && status.httpStatus < 600) {
      return status.httpStatus
    }
    if (typeof status.status === 'number' && status.status >= 400 && status.status < 600) {
      return status.status
    }
    if (typeof status.code === 'string' && Object.hasOwn(CODE_STATUS_MAP, status.code)) {
      return CODE_STATUS_MAP[status.code]
    }
  }
  return 500
}

/**
 * Translate upstream `fury-agent` missing-core IPC errors into a structured
 * `core-not-installed` (HTTP 503) domain error with actionable guidance.
 * @param {unknown} err
 */
export function normalizeCoreLaunchError(err) {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (/no core binary/i.test(msg)) {
    return new PibrowseError(
      'core-not-installed',
      '尚未安装 Chromium 157 内核，请先下载并安装 Core 或在「环境与运行态」配置本地 FURY_CORE 路径。',
      { upstreamMessage: msg },
    )
  }
  return err
}
