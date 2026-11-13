/**
 * @param {Array<Record<string, unknown>>} accounts
 * @param {{ platform?: string, group?: string }} filters
 */
export function filterAccounts(accounts, filters = {}) {
  const platform = String(filters.platform || '').trim().toLowerCase()
  const group = String(filters.group || '').trim().toLowerCase()
  return (Array.isArray(accounts) ? accounts : []).filter((row) => {
    if (platform && String(row.platform || '').toLowerCase() !== platform) return false
    if (group && String(row.group || '').toLowerCase() !== group) return false
    return true
  })
}

/**
 * @param {Array<Record<string, unknown>>} accounts
 * @param {string} key
 */
export function uniqueValues(accounts, key) {
  const seen = new Set()
  const values = []
  for (const row of Array.isArray(accounts) ? accounts : []) {
    const value = typeof row[key] === 'string' ? row[key].trim() : ''
    if (!value || seen.has(value)) continue
    seen.add(value)
    values.push(value)
  }
  return values.sort((a, b) => a.localeCompare(b))
}
