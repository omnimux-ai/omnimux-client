/**
 * Typed error carrying a wire error code (see http-routes.js STATUS_BY_CODE).
 */
export class ProductsError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message)
    this.name = 'ProductsError'
    this.code = code
  }
}
