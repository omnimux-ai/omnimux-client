import { isPublishingAccount } from '../account-policy.js'
import { accountPublishMode } from '../shared/tiktok-capabilities.js'
import {
  SOCIAL_SEAT_CODES,
  computeSeatRenewPreview,
  extractSocialSeatError,
  formatSeatDate,
  pickAccountSeat,
  seatGraceDaysRemaining,
} from '../shared/social-seat.js'
/**
 * TikTok 账号侧栏视图的纯函数逻辑（无 DOM / 无 React，可 node --test 直测）。
 * 数据真源：hub `GET /omnimux/accounts?platform=tiktok`（ViewRow 合并），
 * 行字段：id / platform / display_name / username / name / group / status /
 * avatar_url / agent_usable。
 */

/** 侧栏固定平台（本轮只接 TikTok 官方授权）。 */
export const ACCOUNT_PLATFORM = 'tiktok'

/**
 * 从 hub 响应体取账号行数组；任何非数组形状都归一为 []。
 * @param {unknown} body
 * @returns {Array<Record<string, unknown>>}
 */
export function extractAccounts(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return []
  const rows = /** @type {Record<string, unknown>} */ (body).accounts
  if (!Array.isArray(rows)) return []
  return rows.filter(isPublishingAccount)
}

/**
 * 本地搜索：display_name / username / name 大小写不敏感 substring。
 * 空 query 恒真。
 * @param {Record<string, unknown>} row
 * @param {string} query
 */
export function matchesAccountQuery(row, query) {
  const needle = String(query ?? '').trim().toLowerCase()
  if (needle === '') return true
  const fields = [row?.display_name, row?.username, row?.name]
  return fields.some((value) => String(value ?? '').toLowerCase().includes(needle))
}

/**
 * 搜索过滤全量账号列表。
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} [query]
 * @returns {Array<Record<string, unknown>>}
 */
export function filterAccounts(rows, query = '') {
  const list = Array.isArray(rows) ? rows : []
  return list.filter((row) => isPublishingAccount(row) && matchesAccountQuery(row, query))
}

/**
 * 行显示名：display_name → name → username → id 逐级回退。
 * @param {Record<string, unknown>} row
 */
export function accountDisplayName(row) {
  const candidates = [row?.display_name, row?.name, row?.username, row?.id]
  for (const value of candidates) {
    const text = String(value ?? '').trim()
    if (text !== '') return text
  }
  return ''
}

/**
 * @username 副标题；无 username 时为空串（UI 不渲染）。
 * @param {Record<string, unknown>} row
 */
export function accountHandle(row) {
  const username = String(row?.username ?? '').trim()
  return username === '' ? '' : `@${username}`
}

/**
 * 状态语义色。status 取值由 hub 透传（connected/active/expired/error…），
 * 未识别值归 muted；agent_usable === false 恒为 muted（另行标注）。
 * @param {Record<string, unknown>} row
 * @returns {'success' | 'warn' | 'error' | 'muted'}
 */
export function accountStatusTone(row) {
  const status = String(row?.status ?? '').trim().toLowerCase()
  if (status === 'connected' || status === 'active' || status === 'ok') return 'success'
  if (status === 'expired' || status === 'refreshing' || status === 'pending') return 'warn'
  if (status === 'error' || status === 'failed' || status === 'revoked') return 'error'
  return 'muted'
}

/**
 * 账号发布能力徽标（与 Composer 渠道面板同源，用于 Accounts 列表与渠道选择器一致区分）。
 * @param {(key: string, vars?: Record<string, unknown>) => string} t
 * @param {Record<string, unknown>} row
 * @returns {{ label: string, tone: 'draft' | 'direct' | 'warn' } | null}
 */
export function accountCapabilityBadge(t, row) {
  const mode = accountPublishMode(row)
  if (mode === 'draft_only') return { label: t('accounts.cap.draft'), tone: 'draft' }
  if (mode === 'direct') return { label: t('accounts.cap.direct'), tone: 'direct' }
  if (mode === 'no_publish_scope') return { label: t('accounts.cap.noScope'), tone: 'warn' }
  return null
}

/**
 * connect 响应取值：只接受 https auth_url（与 hub pickConnectView 同源约束，
 * 前端再做一次防御校验）。
 * @param {unknown} body
 * @returns {string} 合法 https URL 或 ''
 */
export function pickAuthUrl(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ''
  const url = /** @type {Record<string, unknown>} */ (body).auth_url
  return typeof url === 'string' && /^https:\/\//i.test(url) ? url : ''
}

/**
 * 登录引导判定：401 / 403 或错误体带 needs-omnimux。
 * @param {{ ok: boolean, status: number, body: unknown }} result
 */
export function isNeedsLogin(result) {
  if (!result || typeof result !== 'object') return false
  if (result.status === 401 || result.status === 403) return true
  const body = result.body
  const code = body && typeof body === 'object' && !Array.isArray(body)
    ? /** @type {Record<string, unknown>} */ (body).error
    : null
  return /needs-omnimux/.test(String(code ?? ''))
}

/**
 * 轮询检测：返回 baseline 之外出现的第一行（新授权账号），无则 null。
 * @param {Set<string>} baselineIds 发起授权时的账号 id 快照
 * @param {Array<Record<string, unknown>>} rows 最新账号行
 * @returns {Record<string, unknown> | null}
 */
export function findNewAccount(baselineIds, rows) {
  const baseline = baselineIds instanceof Set ? baselineIds : new Set()
  const list = Array.isArray(rows) ? rows : []
  for (const row of list) {
    if (!isPublishingAccount(row)) continue
    if (!baseline.has(String(row.id))) return row
  }
  return null
}

/**
 * 账号 id 快照（轮询 baseline）。
 * @param {Array<Record<string, unknown>>} rows
 * @returns {Set<string>}
 */
export function snapshotAccountIds(rows) {
  const list = Array.isArray(rows) ? rows : []
  return new Set(list.map((row) => String(row?.id)))
}

const SEAT_EXPIRING_SOON_MS = 5 * 24 * 60 * 60 * 1000

/**
 * 仅当服务端明确返回 `billing_mode === 'seat'` 时展示席位计费 UI。
 * @param {import('../shared/social-seat.js').SeatsSummaryView | null | undefined} seats
 */
export function isSeatBillingActive(seats) {
  return Boolean(seats && seats.billing_mode === 'seat')
}

/**
 * 是否已达席位上限且无空席可复用。
 * @param {import('../shared/social-seat.js').SeatsSummaryView | null | undefined} seats
 */
export function isSeatCapReached(seats) {
  if (!isSeatBillingActive(seats)) return false
  const vacant = typeof seats.seats_vacant === 'number' ? seats.seats_vacant : 0
  const purchased = typeof seats.seats_purchased === 'number' ? seats.seats_purchased : 0
  const cap = typeof seats.seats_cap === 'number' ? seats.seats_cap : 0
  return vacant === 0 && cap > 0 && purchased >= cap
}

/**
 * 授权弹窗 1 行计费提示判定（纯逻辑，仅 `billing_mode === 'seat'` 返回非空）。
 * @param {import('../shared/social-seat.js').SeatsSummaryView | null | undefined} seats
 * @returns {{
 *   kind: 'vacantSwappable' | 'vacantSameOnly' | 'capReached' | 'newSeat',
 *   tone: 'success' | 'warn' | 'error' | 'info',
 *   blocked: boolean,
 *   priceCredits: number,
 *   purchased: number,
 *   cap: number,
 * } | null}
 */
export function authorizeSeatNotice(seats) {
  if (!isSeatBillingActive(seats)) return null
  const priceCredits = typeof seats.seat_price_credits === 'number' && seats.seat_price_credits > 0
    ? seats.seat_price_credits
    : 20
  const purchased = typeof seats.seats_purchased === 'number' ? seats.seats_purchased : 0
  const cap = typeof seats.seats_cap === 'number' ? seats.seats_cap : 20
  const vacant = typeof seats.seats_vacant === 'number' ? seats.seats_vacant : 0
  if (vacant > 0) {
    const vacantList = Array.isArray(seats.vacant_seats) ? seats.vacant_seats : []
    const allSameOnly = vacantList.length > 0 && vacantList.every((entry) => entry.same_account_only === true)
    return {
      kind: allSameOnly ? 'vacantSameOnly' : 'vacantSwappable',
      tone: allSameOnly ? 'warn' : 'success',
      blocked: false,
      priceCredits,
      purchased,
      cap,
    }
  }
  if (isSeatCapReached(seats)) {
    return {
      kind: 'capReached',
      tone: 'error',
      blocked: true,
      priceCredits,
      purchased,
      cap,
    }
  }
  return {
    kind: 'newSeat',
    tone: 'info',
    blocked: false,
    priceCredits,
    purchased,
    cap,
  }
}

/**
 * 单个账号行的席位展示投影（纯逻辑，无 DOM/React）。
 * @param {Record<string, unknown> | null | undefined} row
 * @param {number} [nowMs]
 */
export function accountSeatDisplay(row, nowMs = Date.now()) {
  const seat = pickAccountSeat(row?.seat)
  if (!seat) return null
  const expiresDate = formatSeatDate(seat.expires_at)
  const expiresMs = seat.expires_at ? Date.parse(seat.expires_at) : NaN
  const isExpiringSoon = seat.status === 'active'
    && Number.isFinite(expiresMs)
    && expiresMs > nowMs
    && expiresMs - nowMs <= SEAT_EXPIRING_SOON_MS
  const graceDays = seatGraceDaysRemaining(seat, nowMs)
  const isRenewLimit = seat.can_renew === false
    && seat.renew_blocked_reason === SOCIAL_SEAT_CODES.RENEW_LIMIT
  const priceCredits = typeof seat.price_credits === 'number' && seat.price_credits > 0
    ? seat.price_credits
    : 20
  const swapsRemaining = typeof seat.swaps_remaining === 'number' ? seat.swaps_remaining : 0
  return {
    status: seat.status,
    expiresDate,
    graceDays,
    isExpiringSoon,
    canRenew: seat.can_renew !== false,
    renewBlockedReason: seat.renew_blocked_reason || '',
    isRenewLimit,
    priceCredits,
    swapsRemaining,
    preview: computeSeatRenewPreview(seat, nowMs),
  }
}

/**
 * 将席位相关 HTTP 错误体映射为可读本地化文案，未知或非席位错误交由 fallback 处理。
 * @param {(key: string, vars?: Record<string, unknown>) => string} t
 * @param {unknown} body
 * @param {number} status
 * @param {(body: unknown, status?: number) => string} fallback
 * @param {import('../shared/social-seat.js').SeatsSummaryView | null} [seats]
 */
export function seatErrorMessage(t, body, status, fallback, seats = null) {
  const obj = body && typeof body === 'object' && !Array.isArray(body)
    ? /** @type {Record<string, unknown>} */ (body)
    : null
  const seatErr = extractSocialSeatError(obj)
  const explicitCredits = seatErr?.need_credits
    ?? (typeof obj?.need_credits === 'number' && obj.need_credits > 0 ? obj.need_credits : null)
  const isSeatQuota = seatErr?.code === SOCIAL_SEAT_CODES.QUOTA || explicitCredits !== null
  if (isSeatQuota) {
    const credits = explicitCredits
      ?? (typeof seats?.seat_price_credits === 'number' && seats.seat_price_credits > 0
        ? seats.seat_price_credits
        : null)
    if (credits !== null) return t('acct.seat.err.quota', { credits })
    return fallback(body, status)
  }
  if (seatErr?.code === SOCIAL_SEAT_CODES.CAP) return t('acct.seat.err.cap')
  if (seatErr?.code === SOCIAL_SEAT_CODES.EXPIRED) return t('acct.seat.err.expired')
  if (seatErr?.code === SOCIAL_SEAT_CODES.RENEW_LIMIT) {
    const days = seatErr.max_validity_days
      ?? (typeof seats?.max_validity_days === 'number' && seats.max_validity_days > 0
        ? seats.max_validity_days
        : 90)
    return t('acct.seat.err.renewLimit', { days })
  }
  if (seatErr?.code === SOCIAL_SEAT_CODES.SWAP_LIMIT) return t('acct.seat.err.swapLimit')
  return fallback(body, status)
}

/**
 * 同步防重锁控制席位续费提交（与 createDisconnectController 同范式），防止双击产生重复扣费。
 * @param {{
 *   renew: (accountId: unknown) => Promise<{ ok: boolean, status: number, body: unknown }>,
 *   reload: () => Promise<unknown>,
 *   isMounted: () => boolean,
 *   isNeedsLogin: (result: { ok: boolean, status: number, body: unknown }) => boolean,
 *   formatError: (body: unknown, status: number) => string,
 *   onStart: (accountId: string) => void,
 *   onFailure: (message: string) => void,
 *   onNeedLogin: () => void,
 *   onSuccess: () => void,
 *   onFinally: () => void,
 * }} options
 */
export function createSeatRenewController(options) {
  let locked = false
  return {
    /** @param {unknown} accountId */
    async confirm(accountId) {
      if (locked) return
      locked = true
      const displayId = typeof accountId === 'string' ? accountId : ''
      if (options.isMounted()) options.onStart(displayId)
      try {
        const result = await options.renew(accountId)
        if (!options.isMounted()) return
        if (options.isNeedsLogin(result)) {
          options.onNeedLogin()
          return
        }
        if (!result.ok) {
          options.onFailure(options.formatError(result.body, result.status))
          return
        }
        options.onSuccess()
        if (options.isMounted()) await options.reload()
      } catch (caught) {
        if (options.isMounted()) {
          options.onFailure(caught instanceof Error ? caught.message : String(caught))
        }
      } finally {
        locked = false
        if (options.isMounted()) options.onFinally()
      }
    },
  }
}
