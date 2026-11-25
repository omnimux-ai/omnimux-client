/** Typed domain error carrying the existing HTTP/tool wire error code. */
export class PublishError extends Error {
  /** @param {string} code @param {string | Record<string, unknown>} message @param {Record<string, unknown>} [details] */
  constructor(code, message, details) {
    super(typeof message === 'string' ? message : JSON.stringify(message))
    this.name = 'PublishError'
    this.code = code
    if (details && typeof details === 'object') this.details = details
    else if (typeof message !== 'string') this.details = message
  }
}
