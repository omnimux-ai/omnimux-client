export const STATUS_BY_CODE = Object.freeze({
  'invalid-request': 400,
  'invalid-json': 400,
  'confirmation-required': 400,
  'not-local': 403,
  'not-found': 404,
  'conflict': 409,
  'batch-limit-exceeded': 400,
  'needs-omnimux': 401,
  'needs-provider': 503,
  'upstream-failed': 502,
  'store-corrupt': 500,
})

export class SelectionError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'SelectionError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

export function httpStatusForError(error) {
  if (error instanceof SelectionError) {
    return STATUS_BY_CODE[error.code] ?? 400
  }
  const code = typeof error?.code === 'string' ? error.code : ''
  if (code && STATUS_BY_CODE[code]) return STATUS_BY_CODE[code]
  return 500
}
