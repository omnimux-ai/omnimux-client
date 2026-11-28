/**
 * Social account seat billing contract helpers shared by Host validation,
 * hub error parsing, and browser UI views. Pure functions only (no DOM/Node I/O).
 */

/** @typedef {'active' | 'frozen' | 'unactivated'} AccountSeatStatus */

/** @typedef {object} AccountSeatView
 * @property {number} [id]
 * @property {AccountSeatStatus} status
 * @property {string} [expires_at]
 * @property {string} [grace_until]
 * @property {number} [swap_count]
 * @property {number} [swaps_remaining]
 * @property {boolean} [can_renew]
 * @property {string} [renew_blocked_reason]
 * @property {number} [price_credits]
 */

/** @typedef {object} VacantSeatView
 * @property {number} [id]
 * @property {string} [expires_at]
 * @property {number} [swaps_remaining]
 * @property {boolean} [same_account_only]
 */

/** @typedef {object} SeatsSummaryView
 * @property {'off' | 'seat'} billing_mode
 * @property {number} [seats_purchased]
 * @property {number} [seats_occupied]
 * @property {number} [seats_vacant]
 * @property {number} [seats_cap]
 * @property {string} [next_expiry]
 * @property {number} [seat_price_usd]
 * @property {number} [seat_price_credits]
 * @property {boolean} [wallet_ok]
 * @property {string} [grandfather_until]
 * @property {number} [max_validity_days]
 * @property {number} [max_swaps_per_window]
 * @property {number} [grace_days]
 * @property {VacantSeatView[]} vacant_seats
 */

export const SOCIAL_SEAT_CODES = Object.freeze({
  QUOTA: 'SOCIAL_SEAT_QUOTA',
  CAP: 'SOCIAL_SEAT_CAP',
  EXPIRED: 'SOCIAL_SEAT_EXPIRED',
  RENEW_LIMIT: 'SOCIAL_SEAT_RENEW_LIMIT',
  SWAP_LIMIT: 'SOCIAL_SEAT_SWAP_LIMIT',
})

/** @type {Set<string>} */
const SEAT_CONFLICT_SET = new Set([
  SOCIAL_SEAT_CODES.CAP,
  SOCIAL_SEAT_CODES.EXPIRED,
  SOCIAL_SEAT_CODES.RENEW_LIMIT,
  SOCIAL_SEAT_CODES.SWAP_LIMIT,
])

const SEAT_STATUS_SET = new Set(['active', 'frozen', 'unactivated'])
const SEAT_MODE_SET = new Set(['off', 'seat'])
const DAY_MS = 24 * 60 * 60 * 1000
const TRAILING_SEAT_TAG_RE = /\s*\[((?:(?:code|need_credits|max_validity_days)=[A-Za-z0-9_.-]+\s*)+)\]\s*$/

/** @param {unknown} value @returns {Record<string, unknown> | null} */
function asObj(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : null
}

/** @param {unknown} value @returns {boolean} */
export function isSocialSeatCode(value) {
  return typeof value === 'string' && (value === SOCIAL_SEAT_CODES.QUOTA || SEAT_CONFLICT_SET.has(value))
}

/** @param {unknown} value @returns {boolean} */
export function isSocialSeatConflictCode(value) {
  return typeof value === 'string' && SEAT_CONFLICT_SET.has(value)
}

/**
 * Whitelist-copy an account's `seat` view. Absent or invalid inputs yield undefined.
 * @param {unknown} raw
 * @returns {AccountSeatView | undefined}
 */
export function pickAccountSeat(raw) {
  const src = asObj(raw)
  if (!src) return undefined
  const status = typeof src.status === 'string' ? src.status.trim().toLowerCase() : ''
  if (!SEAT_STATUS_SET.has(status)) return undefined
  /** @type {AccountSeatView} */
  const out = { status: /** @type {AccountSeatStatus} */ (status) }
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
 * Whitelist-copy the `GET /omnimux/accounts/seats` response.
 * @param {unknown} raw
 * @returns {SeatsSummaryView | null}
 */
export function pickSeatsSummary(raw) {
  const envelope = asObj(raw)
  if (!envelope) return null
  const src = asObj(envelope.data) ?? envelope
  const mode = typeof src.billing_mode === 'string' ? src.billing_mode.trim().toLowerCase() : ''
  if (!SEAT_MODE_SET.has(mode)) return null
  /** @type {SeatsSummaryView} */
  const out = { billing_mode: /** @type {'off' | 'seat'} */ (mode), vacant_seats: [] }
  if (typeof src.seats_purchased === 'number' && Number.isFinite(src.seats_purchased) && src.seats_purchased >= 0) out.seats_purchased = src.seats_purchased
  if (typeof src.seats_occupied === 'number' && Number.isFinite(src.seats_occupied) && src.seats_occupied >= 0) out.seats_occupied = src.seats_occupied
  if (typeof src.seats_vacant === 'number' && Number.isFinite(src.seats_vacant) && src.seats_vacant >= 0) out.seats_vacant = src.seats_vacant
  if (typeof src.seats_cap === 'number' && Number.isFinite(src.seats_cap) && src.seats_cap >= 0) out.seats_cap = src.seats_cap
  if (typeof src.seat_price_usd === 'number' && Number.isFinite(src.seat_price_usd) && src.seat_price_usd >= 0) out.seat_price_usd = src.seat_price_usd
  if (typeof src.seat_price_credits === 'number' && Number.isFinite(src.seat_price_credits) && src.seat_price_credits >= 0) out.seat_price_credits = src.seat_price_credits
  if (typeof src.max_validity_days === 'number' && Number.isFinite(src.max_validity_days) && src.max_validity_days >= 0) out.max_validity_days = src.max_validity_days
  if (typeof src.max_swaps_per_window === 'number' && Number.isFinite(src.max_swaps_per_window) && src.max_swaps_per_window >= 0) out.max_swaps_per_window = src.max_swaps_per_window
  if (typeof src.grace_days === 'number' && Number.isFinite(src.grace_days) && src.grace_days >= 0) out.grace_days = src.grace_days
  if (typeof src.wallet_ok === 'boolean') out.wallet_ok = src.wallet_ok
  if (typeof src.next_expiry === 'string') out.next_expiry = src.next_expiry.trim()
  if (typeof src.grandfather_until === 'string') out.grandfather_until = src.grandfather_until.trim()
  if (Array.isArray(src.vacant_seats)) {
    out.vacant_seats = src.vacant_seats.map((item) => {
      const row = asObj(item)
      if (!row) return null
      /** @type {VacantSeatView} */
      const entry = {}
      if (typeof row.id === 'number' && Number.isInteger(row.id) && row.id > 0) entry.id = row.id
      if (typeof row.expires_at === 'string' && row.expires_at.trim() !== '') entry.expires_at = row.expires_at.trim()
      if (typeof row.swaps_remaining === 'number' && Number.isInteger(row.swaps_remaining) && row.swaps_remaining >= 0) {
        entry.swaps_remaining = row.swaps_remaining
      }
      if (typeof row.same_account_only === 'boolean') entry.same_account_only = row.same_account_only
      return Object.keys(entry).length > 0 ? entry : null
    }).filter((entry) => entry !== null)
  }
  return out
}

/** @param {unknown} seat @returns {boolean} */
export function isSeatFrozen(seat) {
  const picked = pickAccountSeat(seat)
  return Boolean(picked && (picked.status === 'frozen' || picked.status === 'unactivated'))
}

/**
 * Map a seat object to the UI unusable reason code (empty when usable or seat absent).
 * @param {unknown} seat
 * @returns {'seatExpired' | 'seatUnactivated' | ''}
 */
export function seatUnusableReason(seat) {
  const picked = pickAccountSeat(seat)
  if (!picked) return ''
  if (picked.status === 'frozen') return 'seatExpired'
  if (picked.status === 'unactivated') return 'seatUnactivated'
  return ''
}

/**
 * Format an RFC3339 timestamp to `YYYY-MM-DD` (UTC date). Returns '' if unparseable.
 * @param {unknown} value
 * @returns {string}
 */
export function formatSeatDate(value) {
  if (typeof value !== 'string' || value.trim() === '') return ''
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return ''
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Compute renewal date preview matching gateway semantics:
 * - active seat with future `expires_at`: extends from `expires_at` + `days`
 * - frozen / unactivated / already past `expires_at`: extends from `now` + `days`
 * @param {unknown} rawSeat
 * @param {number} [nowMs]
 * @param {number} [days]
 * @returns {{ fromDate: string, toDate: string }}
 */
export function computeSeatRenewPreview(rawSeat, nowMs = Date.now(), days = 30) {
  const seat = pickAccountSeat(rawSeat)
  const expiresMs = seat?.expires_at ? Date.parse(seat.expires_at) : NaN
  const baseMs = seat?.status === 'active' && Number.isFinite(expiresMs) && expiresMs > nowMs
    ? expiresMs
    : nowMs
  const nextMs = baseMs + days * DAY_MS
  return {
    fromDate: new Date(baseMs).toISOString().slice(0, 10),
    toDate: new Date(nextMs).toISOString().slice(0, 10),
  }
}

/**
 * Whole days remaining in the grace period (rounded up, clamped >= 0). Null when missing.
 * @param {unknown} rawSeat
 * @param {number} [nowMs]
 * @returns {number | null}
 */
export function seatGraceDaysRemaining(rawSeat, nowMs = Date.now()) {
  const seat = pickAccountSeat(rawSeat)
  if (!seat?.grace_until) return null
  const graceMs = Date.parse(seat.grace_until)
  if (!Number.isFinite(graceMs)) return null
  const diff = graceMs - nowMs
  if (diff <= 0) return 0
  return Math.ceil(diff / DAY_MS)
}

/**
 * Parse a trailing structured seat tag appended by the hub tool boundary:
 * `... [code=SOCIAL_SEAT_* need_credits=20 max_validity_days=90]`
 * @param {string} rawText
 * @returns {{ message: string, code: string, need_credits?: number, max_validity_days?: number } | null}
 */
export function parseSocialSeatTag(rawText) {
  if (typeof rawText !== 'string' || rawText === '') return null
  const match = TRAILING_SEAT_TAG_RE.exec(rawText)
  if (!match) return null
  let code = ''
  /** @type {number | undefined} */
  let needCredits
  /** @type {number | undefined} */
  let maxValidityDays
  for (const part of match[1].trim().split(/\s+/)) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const key = part.slice(0, eq)
    const val = part.slice(eq + 1)
    if (key === 'code' && isSocialSeatCode(val)) code = val
    else if (key === 'need_credits') {
      const n = Number(val)
      if (Number.isFinite(n) && n > 0) needCredits = n
    } else if (key === 'max_validity_days') {
      const n = Number(val)
      if (Number.isFinite(n) && n > 0) maxValidityDays = n
    }
  }
  if (!code) return null
  return {
    message: rawText.slice(0, match.index).trim(),
    code,
    ...(needCredits !== undefined ? { need_credits: needCredits } : {}),
    ...(maxValidityDays !== undefined ? { max_validity_days: maxValidityDays } : {}),
  }
}

/**
 * Extract a structured `SOCIAL_SEAT_*` error from a tool result, HTTP body, or string.
 * @param {unknown} source
 * @returns {{ code: string, message: string, need_credits?: number, max_validity_days?: number } | null}
 */
export function extractSocialSeatError(source) {
  if (typeof source === 'string') {
    const tagged = parseSocialSeatTag(source)
    if (tagged) return tagged
    for (const code of Object.values(SOCIAL_SEAT_CODES)) {
      if (source.includes(code)) return { code, message: source.trim() }
    }
    return null
  }
  const obj = asObj(source)
  if (!obj) return null
  const details = asObj(obj.details)
  const rawMessage = typeof obj.message === 'string' ? obj.message.trim() : ''
  const tagged = parseSocialSeatTag(rawMessage)
  const candidates = [
    obj.code,
    details?.code,
    typeof obj.error === 'string' ? obj.error : '',
    tagged?.code,
  ]
  let code = /** @type {string | undefined} */ (candidates.find((c) => isSocialSeatCode(c))) || ''
  if (!code && rawMessage) {
    code = Object.values(SOCIAL_SEAT_CODES).find((known) => rawMessage.includes(known)) || ''
  }
  if (!code) return null
  const needCredits = [obj.need_credits, details?.need_credits, tagged?.need_credits]
    .find((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)
  const maxValidityDays = [obj.max_validity_days, details?.max_validity_days, tagged?.max_validity_days]
    .find((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)
  const message = tagged?.message || rawMessage
  return {
    code,
    message: message || code,
    ...(typeof needCredits === 'number' ? { need_credits: needCredits } : {}),
    ...(typeof maxValidityDays === 'number' ? { max_validity_days: maxValidityDays } : {}),
  }
}
