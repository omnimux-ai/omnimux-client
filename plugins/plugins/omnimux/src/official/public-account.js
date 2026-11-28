/** Strip official account payloads down to browser-safe fields. */

import { mergeMeta } from './account-meta.js'

export const ACCOUNT_KEYS = Object.freeze([
  'id', 'platform', 'provider', 'display_name', 'username', 'name', 'group', 'status',
  'expires_at', 'connected_at',
])

/** Statuses the UI knows how to render. Anything else normalizes to error. */
const STATUS_VALUES = new Set(['active', 'expiring', 'expired', 'error'])
const SEAT_STATUS_VALUES = new Set(['active', 'frozen', 'unactivated'])
const SEAT_BILLING_MODES = new Set(['off', 'seat'])

/** An expires_at inside this window counts as expiring (D7). */
const EXPIRING_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Normalizes an account status. Site status strings pass through when they
 * already match a known value (unknown non-empty strings become 'error');
 * with no site status, expires_at drives the verdict; with neither the
 * account is active. Pure.
 * @param {Record<string, unknown> | null | undefined} row
 * @param {number | Date} [now]
 * @returns {'active' | 'expiring' | 'expired' | 'error'}
 */
export function computeStatus(row, now = Date.now()) {
  const base = now instanceof Date ? now.getTime() : now
  const source = row && typeof row === 'object' ? row : {}
  const status = typeof source.status === 'string' ? source.status.trim().toLowerCase() : ''
  if (status !== '') return STATUS_VALUES.has(status) ? /** @type {'active' | 'expiring' | 'expired' | 'error'} */ (status) : 'error'
  const expires = typeof source.expires_at === 'string' ? Date.parse(source.expires_at) : NaN
  if (Number.isFinite(expires)) {
    if (expires <= base) return 'expired'
    if (expires <= base + EXPIRING_WINDOW_MS) return 'expiring'
  }
  return 'active'
}

/**
 * Whitelist-copy account publishing capabilities (`upload_draft`, `publish_direct`,
 * and optional server-supplied `max_media_items` / `max_images` caps).
 * Missing or malformed input returns undefined so callers can distinguish legacy responses.
 * @param {unknown} raw
 * @returns {{ upload_draft?: boolean, publish_direct?: boolean, max_media_items?: number, max_images?: number } | undefined}
 */
export function pickCapabilities(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const src = /** @type {Record<string, unknown>} */ (raw)
  /** @type {{ upload_draft?: boolean, publish_direct?: boolean, max_media_items?: number, max_images?: number }} */
  const out = {}
  if (typeof src.upload_draft === 'boolean') out.upload_draft = src.upload_draft
  if (typeof src.publish_direct === 'boolean') out.publish_direct = src.publish_direct
  if (typeof src.max_media_items === 'number' && Number.isInteger(src.max_media_items) && src.max_media_items > 0) {
    out.max_media_items = src.max_media_items
  }
  if (typeof src.max_images === 'number' && Number.isInteger(src.max_images) && src.max_images > 0) {
    out.max_images = src.max_images
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Whitelist-copy account seat billing view attached when `billing_mode === 'seat'`.
 * Omitted completely when absent or malformed so `billing_mode === 'off'` stays clean.
 * @param {unknown} raw
 */
export function pickSeat(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const src = /** @type {Record<string, unknown>} */ (raw)
  const status = typeof src.status === 'string' ? src.status.trim().toLowerCase() : ''
  if (!SEAT_STATUS_VALUES.has(status)) return undefined
  /** @type {Record<string, unknown>} */
  const out = { status }
  if (typeof src.id === 'number' && Number.isInteger(src.id) && src.id > 0) out.id = src.id
  if (typeof src.expires_at === 'string' && src.expires_at.trim() !== '') out.expires_at = src.expires_at.trim()
  if (typeof src.grace_until === 'string' && src.grace_until.trim() !== '') out.grace_until = src.grace_until.trim()
  if (typeof src.swap_count === 'number' && Number.isInteger(src.swap_count) && src.swap_count >= 0) out.swap_count = src.swap_count
  if (typeof src.swaps_remaining === 'number' && Number.isInteger(src.swaps_remaining) && src.swaps_remaining >= 0) {
    out.swaps_remaining = src.swaps_remaining
  }
  if (typeof src.can_renew === 'boolean') out.can_renew = src.can_renew
  if (typeof src.renew_blocked_reason === 'string') out.renew_blocked_reason = src.renew_blocked_reason.trim()
  if (typeof src.price_credits === 'number' && Number.isFinite(src.price_credits) && src.price_credits > 0) {
    out.price_credits = src.price_credits
  }
  return out
}

/**
 * Whitelist one vacant seat entry from `GET /api/social/v1/seats`.
 * @param {unknown} raw
 */
function pickVacantSeat(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const src = /** @type {Record<string, unknown>} */ (raw)
  /** @type {Record<string, unknown>} */
  const out = {}
  if (typeof src.id === 'number' && Number.isInteger(src.id) && src.id > 0) out.id = src.id
  if (typeof src.expires_at === 'string' && src.expires_at.trim() !== '') out.expires_at = src.expires_at.trim()
  if (typeof src.swaps_remaining === 'number' && Number.isInteger(src.swaps_remaining) && src.swaps_remaining >= 0) {
    out.swaps_remaining = src.swaps_remaining
  }
  if (typeof src.same_account_only === 'boolean') out.same_account_only = src.same_account_only
  return Object.keys(out).length > 0 ? out : null
}

/**
 * Whitelist-copy the browser-safe seats summary from `GET /api/social/v1/seats`.
 * Returns null if the upstream payload lacks a valid `billing_mode`.
 * @param {unknown} raw
 */
export function pickSeatsView(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const envelope = /** @type {Record<string, unknown>} */ (raw)
  const src = envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data)
    ? /** @type {Record<string, unknown>} */ (envelope.data)
    : envelope
  const mode = typeof src.billing_mode === 'string' ? src.billing_mode.trim().toLowerCase() : ''
  if (!SEAT_BILLING_MODES.has(mode)) return null
  /** @type {Record<string, unknown>} */
  const out = { billing_mode: mode }
  for (const key of [
    'seats_purchased', 'seats_occupied', 'seats_vacant', 'seats_cap',
    'seat_price_usd', 'seat_price_credits', 'max_validity_days', 'max_swaps_per_window', 'grace_days',
  ]) {
    const val = src[key]
    if (typeof val === 'number' && Number.isFinite(val) && val >= 0) out[key] = val
  }
  if (typeof src.wallet_ok === 'boolean') out.wallet_ok = src.wallet_ok
  if (typeof src.next_expiry === 'string') out.next_expiry = src.next_expiry.trim()
  if (typeof src.grandfather_until === 'string') out.grandfather_until = src.grandfather_until.trim()
  if (Array.isArray(src.vacant_seats)) {
    out.vacant_seats = src.vacant_seats.map(pickVacantSeat).filter((entry) => entry !== null)
  } else {
    out.vacant_seats = []
  }
  return out
}

/**
 * Whitelist-copy the response from `POST /api/social/v1/accounts/:id/renew`.
 * @param {unknown} raw
 */
export function pickRenewView(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const envelope = /** @type {Record<string, unknown>} */ (raw)
  const src = envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data)
    ? /** @type {Record<string, unknown>} */ (envelope.data)
    : envelope
  const seat = pickSeat(src.seat)
  if (!seat) return null
  /** @type {Record<string, unknown>} */
  const out = { seat }
  if (typeof src.account_id === 'number' && Number.isFinite(src.account_id)) out.account_id = String(src.account_id)
  else if (typeof src.account_id === 'string' && src.account_id.trim() !== '') out.account_id = src.account_id.trim()
  return out
}

/**
 * @param {unknown} raw
 */
export function pickAccount(raw) {
  const row = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? /** @type {Record<string, unknown>} */ (raw)
    : {}
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const key of ACCOUNT_KEYS) {
    const value = row[key]
    if (value == null) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value
    }
  }
  if (typeof row.id === 'number') out.id = String(row.id)
  const avatar = row.avatar_url
  if (typeof avatar === 'string' && isAllowedAvatarUrl(avatar, out.id)) out.avatar_url = avatar
  const capabilities = pickCapabilities(row.capabilities)
  if (capabilities) out.capabilities = capabilities
  const seat = pickSeat(row.seat)
  if (seat) out.seat = seat
  return out
}

/**
 * Same-origin cached avatar path the Host GET-list rewrite emits.
 * Absolute URLs (even with this path) are rejected so `http://evil/...` cannot sneak through.
 * @param {unknown} id
 */
export function localAvatarUrl(id) {
  if (id == null) return ''
  const text = String(id)
  if (text === '') return ''
  return `/omnimux/accounts/${encodeURIComponent(text)}/avatar`
}

/**
 * @param {string} avatar
 * @param {unknown} id
 */
function isAllowedAvatarUrl(avatar, id) {
  if (/^https:\/\//i.test(avatar)) return true
  const expected = localAvatarUrl(id)
  return expected !== '' && avatar === expected
}

/**
 * @param {unknown} raw
 */
export function listFromPayload(raw) {
  if (Array.isArray(raw)) return raw
  if (!raw || typeof raw !== 'object') return []
  const row = /** @type {Record<string, unknown>} */ (raw)
  if (Array.isArray(row.accounts)) return row.accounts
  if (Array.isArray(row.data)) return row.data
  const data = row.data && typeof row.data === 'object' && !Array.isArray(row.data)
    ? /** @type {Record<string, unknown>} */ (row.data)
    : null
  if (data && Array.isArray(data.accounts)) return data.accounts
  if (data && Array.isArray(data.items)) return data.items
  return []
}

/**
 * Builds the browser-safe account view. When `opts.meta` is provided each row
 * is overlay-merged with its local metadata (local group / agent_usable /
 * last_used_at win over site fields) and every row gets a computed status.
 * @param {unknown} raw
 * @param {{ meta?: Record<string, Record<string, unknown>>, now?: number | Date }} [opts]
 */
export function pickAccountsView(raw, opts = {}) {
  const meta = opts.meta && typeof opts.meta === 'object' && !Array.isArray(opts.meta)
    ? /** @type {Record<string, Record<string, unknown>>} */ (opts.meta)
    : null
  const now = opts.now === undefined ? Date.now() : opts.now
  const accounts = listFromPayload(raw)
    .map((item) => {
      let row = pickAccount(item)
      if (meta && typeof row.id === 'string' && meta[row.id]) row = mergeMeta(row, meta[row.id])
      row.status = computeStatus(row, now)
      return row
    })
    .filter((row) => typeof row.id === 'string' && row.id !== '')
  return { accounts }
}

/**
 * @param {unknown} raw
 */
export function pickConnectView(raw) {
  const row = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? /** @type {Record<string, unknown>} */ (raw)
    : {}
  const nested = row.data && typeof row.data === 'object' && !Array.isArray(row.data)
    ? /** @type {Record<string, unknown>} */ (row.data)
    : {}
  const url = [row.auth_url, row.url, nested.auth_url, nested.url].find((value) => typeof value === 'string')
  if (typeof url === 'string' && /^https:\/\//i.test(url)) return { auth_url: url }
  return { auth_url: '' }
}

/**
 * Platform / group filter over already-built view rows.
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ platform?: string, group?: string }} [filters]
 */
export function filterRows(rows, filters = {}) {
  const platform = typeof filters.platform === 'string' ? filters.platform.trim().toLowerCase() : ''
  const group = typeof filters.group === 'string' ? filters.group.trim().toLowerCase() : ''
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (platform && String(row.platform || '').toLowerCase() !== platform) return false
    if (group && String(row.group || '').toLowerCase() !== group) return false
    return true
  })
}

/**
 * @param {unknown} raw
 * @param {{ platform?: string, group?: string }} [filters]
 * @param {{ meta?: Record<string, Record<string, unknown>>, now?: number | Date }} [opts]
 */
export function filterAccounts(raw, filters = {}, opts = {}) {
  const view = pickAccountsView(raw, opts)
  return { accounts: filterRows(view.accounts, filters) }
}
