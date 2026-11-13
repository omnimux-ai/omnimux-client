/**
 * Pure view helpers for the Accounts app: filtering, sorting, summary numbers,
 * and relative-time formatting. No React, no DOM — fully unit-testable.

 * Account rows come from the hub as ViewRows:
 * { id, platform?, display_name?, username?, name?, group?, status?,
 *   avatar_url?, agent_usable?, last_used_at?, expires_at?, connected_at? }
 * `avatar_url` is either an https CDN URL (cache miss) or the same-origin
 * relative path `/omnimux/accounts/{id}/avatar` after Host rewrite.
 * Every field is optional beyond id; rendering stays field-driven.
 */

const STATUS_ORDER = Object.freeze({ active: 0, expiring: 1, expired: 2, error: 3 })

/**
 * Text search across the searchable fields. Empty query matches everything.
 * @param {Record<string, unknown>} row
 * @param {string} query already-trimmed, lower-cased text
 */
function matchesQuery(row, query) {
  if (query === '') return true
  const hay = [row.display_name, row.username, row.name, row.platform, row.group, row.id]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase()
  return hay.includes(query)
}

/**
 * Filters accounts by free-text query plus exact platform / group / status / statusGroup.
 * Missing filters are skipped; comparisons are case-insensitive where the
 * underlying values are strings. Specific `status` takes precedence over `statusGroup`.
 * @param {Array<Record<string, unknown>>} accounts
 * @param {{ query?: string, platform?: string, group?: string, status?: string, statusGroup?: string }} filters
 * @returns {Array<Record<string, unknown>>}
 */
export function filterAccounts(accounts, filters = {}) {
  const query = String(filters.query || '').trim().toLocaleLowerCase()
  const platform = String(filters.platform || '').trim().toLocaleLowerCase()
  const group = String(filters.group || '').trim().toLocaleLowerCase()
  const status = String(filters.status || '').trim().toLocaleLowerCase()
  const statusGroup = String(filters.statusGroup || '').trim().toLocaleLowerCase()
  return (Array.isArray(accounts) ? accounts : []).filter((row) => {
    if (!matchesQuery(row, query)) return false
    if (platform && String(row.platform || '').toLocaleLowerCase() !== platform) return false
    if (group && String(row.group || '').toLocaleLowerCase() !== group) return false
    if (status) {
      if (String(row.status || '').toLocaleLowerCase() !== status) return false
    } else if (statusGroup === 'connected') {
      const s = String(row.status || '').toLocaleLowerCase()
      if (s !== 'active' && s !== 'expiring') return false
    } else if (statusGroup === 'needsattention') {
      const s = String(row.status || '').toLocaleLowerCase()
      if (s !== 'expired' && s !== 'error') return false
    }
    return true
  })
}

/**
 * Sort key comparators. Missing values always sink to the end regardless of
 * direction so an asc/desc toggle never hides rows.
 * @param {Record<string, unknown>} row
 * @param {string} key
 */
function sortValue(row, key) {
  const value = row[key]
  if (key === 'status') {
    const status = typeof value === 'string' ? value : ''
    return STATUS_ORDER[status] ?? STATUS_ORDER.error
  }
  return typeof value === 'string' ? value.toLocaleLowerCase() : undefined
}

/**
 * Default recommended sort direction when selecting a sort dimension.
 * Time/recency fields default to 'desc' (latest first), other fields default to 'asc'.
 */
export const DEFAULT_SORT_DIRECTIONS = Object.freeze({
  display_name: 'asc',
  platform: 'asc',
  status: 'asc',
  last_used_at: 'desc',
  connected_at: 'desc',
  expires_at: 'asc',
})

/**
 * Sorts a copy of the accounts list. Supported keys: display_name, platform,
 * status, last_used_at, connected_at, expires_at (ISO 8601 UTC strings sort
 * correctly as plain text). Unknown keys fall back to display_name.
 * @param {Array<Record<string, unknown>>} accounts
 * @param {string} key
 * @param {'asc' | 'desc'} dir
 * @returns {Array<Record<string, unknown>>}
 */
export function sortAccounts(accounts, key = 'display_name', dir = 'asc') {
  const rows = Array.isArray(accounts) ? [...accounts] : []
  const effectiveKey = ['display_name', 'platform', 'status', 'last_used_at', 'connected_at', 'expires_at'].includes(key)
    ? key
    : 'display_name'
  const sign = dir === 'desc' ? -1 : 1
  const fallbackKey = effectiveKey === 'display_name' ? 'username' : undefined
  return rows.sort((a, b) => {
    const av = sortValue(a, effectiveKey) ?? (fallbackKey ? sortValue(a, fallbackKey) : undefined)
    const bv = sortValue(b, effectiveKey) ?? (fallbackKey ? sortValue(b, fallbackKey) : undefined)
    if (av === undefined && bv === undefined) return 0
    if (av === undefined) return 1 // missing values last, always
    if (bv === undefined) return -1
    if (av < bv) return -1 * sign
    if (av > bv) return 1 * sign
    return 0
  })
}

/**
 * Overview numbers. "connected" counts active + expiring (still usable),
 * "needsAttention" counts expired + error, "platformCount" counts distinct
 * non-empty platforms.
 * @param {Array<Record<string, unknown>>} accounts
 * @returns {{ total: number, connected: number, needsAttention: number, platformCount: number }}
 */
export function summarize(accounts) {
  const rows = Array.isArray(accounts) ? accounts : []
  let connected = 0
  let needsAttention = 0
  const platforms = new Set()
  for (const row of rows) {
    const status = String(row.status || '').toLowerCase()
    if (status === 'active' || status === 'expiring') connected += 1
    if (status === 'expired' || status === 'error') needsAttention += 1
    const platform = typeof row.platform === 'string' ? row.platform.trim() : ''
    if (platform !== '') platforms.add(platform.toLocaleLowerCase())
  }
  return {
    total: rows.length,
    connected,
    needsAttention,
    platformCount: platforms.size,
  }
}

/**
 * Resolve a BCP 47 tag for RelativeTimeFormat that matches product UI locale.
 * Prefer an explicit override, then `html[lang]`, then navigator — never bare
 * `undefined` (ICU default can disagree with DSH dictionary language).
 * @param {string} [override]
 * @returns {string}
 */
export function resolveUiLocale(override) {
  const raw = typeof override === 'string' && override.trim() !== ''
    ? override.trim()
    : (typeof document !== 'undefined' && document.documentElement?.lang
      ? document.documentElement.lang
      : (typeof navigator !== 'undefined' ? navigator.language : 'en'))
  const lower = String(raw || 'en').toLowerCase()
  if (lower === 'zh' || lower.startsWith('zh-')) return 'zh-CN'
  if (lower === 'en' || lower.startsWith('en-')) return 'en'
  return raw
}

/**
 * Relative time via Intl.RelativeTimeFormat ("2 days ago", "in 18 hours").
 * Returns '' for missing / unparseable input.
 * @param {unknown} iso ISO 8601 date string
 * @param {number | Date} [now]
 * @param {string} [locale] DSH / html lang (`zh`/`en` or BCP 47); defaults via resolveUiLocale
 * @returns {string}
 */
export function relativeTime(iso, now = Date.now(), locale) {
  if (typeof iso !== 'string' || iso === '') return ''
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ''
  const base = now instanceof Date ? now.getTime() : now
  const diffMs = then - base
  const abs = Math.abs(diffMs)
  const formatter = new Intl.RelativeTimeFormat(resolveUiLocale(locale), { numeric: 'auto' })
  if (abs < 60 * 1000) return formatter.format(Math.round(diffMs / 1000), 'second')
  if (abs < 60 * 60 * 1000) return formatter.format(Math.round(diffMs / (60 * 1000)), 'minute')
  if (abs < 24 * 60 * 60 * 1000) return formatter.format(Math.round(diffMs / (60 * 60 * 1000)), 'hour')
  return formatter.format(Math.round(diffMs / (24 * 60 * 60 * 1000)), 'day')
}

/**
 * Unique, sorted non-empty values of a string field — used to derive filter
 * dropdown options from live data (empty data ⇒ no options rendered).
 * @param {Array<Record<string, unknown>>} accounts
 * @param {string} key
 * @returns {string[]}
 */
export function uniqueValues(accounts, key) {
  const seen = new Set()
  /** @type {string[]} */
  const values = []
  for (const row of Array.isArray(accounts) ? accounts : []) {
    const value = typeof row[key] === 'string' ? /** @type {string} */ (row[key]).trim() : ''
    if (value === '' || seen.has(value)) continue
    seen.add(value)
    values.push(value)
  }
  return values.sort((a, b) => a.localeCompare(b))
}

/**
 * Statuses actually present in the data, in display order.
 * @param {Array<Record<string, unknown>>} accounts
 * @returns {string[]}
 */
export function presentStatuses(accounts) {
  const present = new Set()
  for (const row of Array.isArray(accounts) ? accounts : []) {
    const status = String(row.status || '').toLowerCase()
    if (status !== '') present.add(status)
  }
  return ['active', 'expiring', 'expired', 'error'].filter((status) => present.has(status))
}

/**
 * Single-brace template formatting: fmt('Hi {name}', { name }) → 'Hi Ada'.
 * Unknown placeholders are left intact.
 * @param {string} template
 * @param {Record<string, unknown>} vars
 * @returns {string}
 */
export function fmt(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole))
}

/**
 * Locale lookup with a fallback for keys the dictionaries do not define
 * (e.g. a platform id the registry does not know). Handles binders that echo
 * the key, return empty, or return undefined for missing entries.
 * @param {(key: string) => string} t
 * @param {string} key
 * @param {string} fallback
 * @returns {string}
 */
export function localeText(t, key, fallback) {
  const value = t(key)
  return typeof value === 'string' && value !== '' && value !== key ? value : fallback
}

/**
 * Rows whose id is in the selection, preserving the input order. Accepts a
 * Set or an array of ids (string coercion matches the rest of the app).
 * @param {Array<Record<string, unknown>>} accounts
 * @param {Set<string> | Array<string>} selectedIds
 * @returns {Array<Record<string, unknown>>}
 */
export function selectRows(accounts, selectedIds) {
  const ids = selectedIds instanceof Set ? selectedIds : new Set(Array.isArray(selectedIds) ? selectedIds : [])
  return (Array.isArray(accounts) ? accounts : []).filter((row) => ids.has(String(row.id)))
}

/**
 * Select-all checkbox state over the visible rows: `all` when every visible
 * row is selected (and at least one exists), `some` when at least one is.
 * @param {Array<Record<string, unknown>>} accounts visible rows
 * @param {Set<string>} selectedIds
 * @returns {{ all: boolean, some: boolean, count: number }}
 */
export function selectAllState(accounts, selectedIds) {
  const rows = Array.isArray(accounts) ? accounts : []
  const ids = selectedIds instanceof Set ? selectedIds : new Set()
  let hit = 0
  for (const row of rows) {
    if (ids.has(String(row.id))) hit += 1
  }
  return {
    all: rows.length > 0 && hit === rows.length,
    some: hit > 0,
    count: hit,
  }
}
