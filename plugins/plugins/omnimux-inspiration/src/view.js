/**
 * @param {unknown} body
 * @returns {{ total: number, items: Array<Record<string, unknown>> }}
 */
export function pickList(body) {
  const root = body && typeof body === 'object' ? /** @type {Record<string, unknown>} */ (body) : {}
  const data = root.data && typeof root.data === 'object' ? /** @type {Record<string, unknown>} */ (root.data) : root
  const items = Array.isArray(data.items) ? data.items : []
  const total = typeof data.total === 'number' ? data.total : items.length
  return { total, items: items.filter((row) => row && typeof row === 'object') }
}

/**
 * @param {Array<Record<string, unknown>>} items
 */
export function uniqueTags(items) {
  const seen = new Set()
  const tags = []
  for (const row of Array.isArray(items) ? items : []) {
    const list = Array.isArray(row.tags) ? row.tags : []
    for (const tag of list) {
      const name = typeof tag === 'string' ? tag : (tag && typeof tag === 'object' && typeof /** @type {any} */ (tag).name === 'string' ? /** @type {any} */ (tag).name : '')
      if (!name || seen.has(name)) continue
      seen.add(name)
      tags.push(name)
    }
  }
  return tags.sort((a, b) => a.localeCompare(b))
}

/**
 * @param {unknown} errorBody
 * @param {number} status
 */
export function errorMessage(errorBody, status) {
  const body = errorBody && typeof errorBody === 'object' ? /** @type {Record<string, unknown>} */ (errorBody) : {}
  const code = String(body.code || body.error || '')
  if (code === 'INSPIRATION_DISABLED' || /disabled/i.test(code)) return 'disabled'
  if (code === 'INSPIRATION_NOT_CONFIGURED') return 'disabled'
  return String(body.message || body.error || `HTTP ${String(status)}`)
}
