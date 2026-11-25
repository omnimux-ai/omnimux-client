/**
 * Analytics library — official-only PAT lane to OmniMux cloud / Zernio.
 * Verticals must not import this file; they hit Host `/omnimux/analytics/*`,
 * the `omnimuxAnalytics` seam, or registered tools.
 *
 * Parameter names and wire types follow `omnimux-ai/omnimux-gateway`
 * (`controller/social.go`) as the single source of truth:
 * - `profileId` is resolved server-side from the signed-in tenant.
 * - Connected-account filters use snake_case `account_ids` (comma-separated
 *   positive int64) or `account_id` (positive int64; JSON number for POST sync).
 * - Unknown or legacy camelCase keys fail loudly instead of being silently
 *   ignored by the gateway.
 */

import { OmnimuxError } from '../media/errors.js'

const API = '/api/social/v1/analytics'

const DAILY_METRICS_KEYS = Object.freeze(['fromDate', 'toDate', 'platform', 'timezone', 'account_ids'])
const BEST_TIME_KEYS = Object.freeze(['platform', 'timezone', 'account_id'])
const PLATFORM_ONLY_KEYS = Object.freeze(['platform'])
const FOLLOWER_STATS_KEYS = Object.freeze(['days', 'account_ids'])
const POSTS_KEYS = Object.freeze(['post_id', 'platform', 'sortBy', 'sortOrder', 'page', 'limit'])
const SYNC_EXTERNAL_KEYS = Object.freeze(['account_id', 'url'])
const INBOX_CAPABILITY_KEYS = Object.freeze({
  volume: Object.freeze(['platform', 'fromDate', 'toDate']),
  'response-time': Object.freeze(['platform', 'fromDate', 'toDate']),
  heatmap: Object.freeze(['platform', 'timezone']),
  'source-breakdown': Object.freeze(['platform', 'fromDate', 'toDate']),
})
const SORT_ORDERS = new Set(['asc', 'desc'])

/**
 * @param {unknown} input
 * @param {string} endpoint
 * @returns {Record<string, unknown>}
 */
function assertRecord(input, endpoint) {
  if (input == null) return {}
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new OmnimuxError('analytics-invalid-query', `${endpoint} expects an object payload`, { status: 400 })
  }
  return /** @type {Record<string, unknown>} */ (input)
}

/**
 * Reject unknown or legacy keys before the request reaches the gateway, where
 * unrecognized query keys would be silently dropped and widen the result set.
 * @param {Record<string, unknown>} source
 * @param {readonly string[]} allowedKeys
 * @param {string} endpoint
 */
function assertAllowedKeys(source, allowedKeys, endpoint) {
  const allowed = new Set(allowedKeys)
  const unknown = Object.keys(source).filter((key) => source[key] !== undefined && !allowed.has(key))
  if (unknown.length > 0) {
    throw new OmnimuxError(
      'analytics-invalid-query',
      `unsupported parameter(s) for ${endpoint}: ${unknown.join(', ')} (allowed: ${allowedKeys.join(', ')})`,
      { status: 400 },
    )
  }
}

/**
 * Parse a positive safe integer (matching gateway local int64 IDs and paging).
 * @param {unknown} value
 * @param {string} fieldName
 * @param {{ code?: string, required?: boolean }} [opts]
 * @returns {number | undefined}
 */
export function parsePositiveInt(value, fieldName, { code = 'analytics-invalid-query', required = false } = {}) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) {
    if (required) {
      throw new OmnimuxError(code, `${fieldName} is required`, { status: 400 })
    }
    return undefined
  }
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value > 0) return value
    throw new OmnimuxError(code, `${fieldName} must be a positive integer`, { status: 400 })
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^[1-9]\d*$/.test(trimmed)) {
      const parsed = Number(trimmed)
      if (Number.isSafeInteger(parsed) && parsed > 0) return parsed
    }
    throw new OmnimuxError(code, `${fieldName} must be a positive integer`, { status: 400 })
  }
  throw new OmnimuxError(code, `${fieldName} must be a positive integer`, { status: 400 })
}

/**
 * Parse a comma-separated list (or array) of positive int64 account IDs.
 * Gateway `parseLocalAccountIDs` silently skips invalid entries, so we fail
 * loudly here rather than silently widening the query to all accounts.
 * @param {unknown} value
 * @param {string} [fieldName]
 * @returns {string | undefined}
 */
export function parseAccountIdList(value, fieldName = 'account_ids') {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return undefined
  if (typeof value === 'number') {
    return String(parsePositiveInt(value, fieldName, { code: 'analytics-invalid-account-id' }))
  }
  if (typeof value === 'string') {
    const parts = value.split(',').map((item) => item.trim())
    if (parts.some((item) => item === '')) {
      throw new OmnimuxError('analytics-invalid-account-id', `${fieldName} must be comma-separated positive integers`, { status: 400 })
    }
    return parts
      .map((item) => String(parsePositiveInt(item, fieldName, { code: 'analytics-invalid-account-id' })))
      .join(',')
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined
    return value
      .map((item) => String(parsePositiveInt(item, fieldName, { code: 'analytics-invalid-account-id' })))
      .join(',')
  }
  throw new OmnimuxError('analytics-invalid-account-id', `${fieldName} must be comma-separated positive integers`, { status: 400 })
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {string | undefined}
 */
function optionalString(value, fieldName) {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string') {
    throw new OmnimuxError('analytics-invalid-query', `${fieldName} must be a string`, { status: 400 })
  }
  const trimmed = value.trim()
  return trimmed || undefined
}

/**
 * @param {Record<string, unknown>} [query]
 */
export function analyticsQueryString(query = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === '') continue
    params.set(key, String(value))
  }
  const suffix = params.toString()
  return suffix ? `?${suffix}` : ''
}

/**
 * 1. 每日时序大盘与各平台走势
 * @param {{ withPat: Function }} client
 * @param {Record<string, unknown>} [query]
 */
export async function getDailyMetrics(client, query = {}) {
  const src = assertRecord(query, 'daily-metrics')
  assertAllowedKeys(src, DAILY_METRICS_KEYS, 'daily-metrics')
  const normalized = {
    fromDate: optionalString(src.fromDate, 'fromDate'),
    toDate: optionalString(src.toDate, 'toDate'),
    platform: optionalString(src.platform, 'platform'),
    timezone: optionalString(src.timezone, 'timezone'),
    account_ids: parseAccountIdList(src.account_ids, 'account_ids'),
  }
  return client.withPat(`${API}/daily-metrics${analyticsQueryString(normalized)}`)
}

/**
 * 2. 7x24小时最佳发布时间热力矩阵
 * @param {{ withPat: Function }} client
 * @param {Record<string, unknown>} [query]
 */
export async function getBestTimeToPost(client, query = {}) {
  const src = assertRecord(query, 'best-time-to-post')
  assertAllowedKeys(src, BEST_TIME_KEYS, 'best-time-to-post')
  const accountId = parsePositiveInt(src.account_id, 'account_id', { code: 'analytics-invalid-account-id' })
  const normalized = {
    platform: optionalString(src.platform, 'platform'),
    timezone: optionalString(src.timezone, 'timezone'),
    account_id: accountId === undefined ? undefined : String(accountId),
  }
  return client.withPat(`${API}/best-time-to-post${analyticsQueryString(normalized)}`)
}

/**
 * 3. 发帖频次 vs 互动率模型
 * @param {{ withPat: Function }} client
 * @param {Record<string, unknown>} [query]
 */
export async function getPostingFrequency(client, query = {}) {
  const src = assertRecord(query, 'posting-frequency')
  assertAllowedKeys(src, PLATFORM_ONLY_KEYS, 'posting-frequency')
  const normalized = {
    platform: optionalString(src.platform, 'platform'),
  }
  return client.withPat(`${API}/posting-frequency${analyticsQueryString(normalized)}`)
}

/**
 * 4. 互动生命周期累积衰减曲线
 * @param {{ withPat: Function }} client
 * @param {Record<string, unknown>} [query]
 */
export async function getContentDecay(client, query = {}) {
  const src = assertRecord(query, 'content-decay')
  assertAllowedKeys(src, PLATFORM_ONLY_KEYS, 'content-decay')
  const normalized = {
    platform: optionalString(src.platform, 'platform'),
  }
  return client.withPat(`${API}/content-decay${analyticsQueryString(normalized)}`)
}

/**
 * 5. 账号粉丝历史演进统计
 * @param {{ withPat: Function }} client
 * @param {Record<string, unknown>} [query]
 */
export async function getFollowerStats(client, query = {}) {
  const src = assertRecord(query, 'follower-stats')
  assertAllowedKeys(src, FOLLOWER_STATS_KEYS, 'follower-stats')
  const normalized = {
    days: parsePositiveInt(src.days, 'days'),
    account_ids: parseAccountIdList(src.account_ids, 'account_ids'),
  }
  return client.withPat(`/api/social/v1/accounts/follower-stats${analyticsQueryString(normalized)}`)
}

/**
 * 6. 帖子列表与排行 / 单帖深度分析
 * @param {{ withPat: Function }} client
 * @param {Record<string, unknown>} [query]
 */
export async function getPostAnalytics(client, query = {}) {
  // OmniMux gateway rejects the Zernio collection root GET /analytics as
  // "Invalid URL". Posts list lives at the /posts suffix, same pattern as
  // daily-metrics / best-time-to-post.
  const src = assertRecord(query, 'analytics/posts')
  assertAllowedKeys(src, POSTS_KEYS, 'analytics/posts')
  const sortOrder = optionalString(src.sortOrder, 'sortOrder')
  if (sortOrder && !SORT_ORDERS.has(sortOrder)) {
    throw new OmnimuxError('analytics-invalid-query', 'sortOrder must be asc or desc', { status: 400 })
  }
  const normalized = {
    post_id: optionalString(src.post_id, 'post_id'),
    platform: optionalString(src.platform, 'platform'),
    sortBy: optionalString(src.sortBy, 'sortBy'),
    sortOrder,
    page: parsePositiveInt(src.page, 'page'),
    limit: parsePositiveInt(src.limit, 'limit'),
  }
  return client.withPat(`${API}/posts${analyticsQueryString(normalized)}`)
}

/**
 * 7. 即时增量拉取外部帖子
 * Gateway binds `account_id` as JSON int64 (> 0). Local views keep string IDs,
 * so valid numeric strings are widened to a JSON number right before the wire call.
 * @param {{ withPat: Function }} client
 * @param {Record<string, unknown>} body
 */
export async function syncExternalPosts(client, body = {}) {
  const src = assertRecord(body, 'sync-external-posts')
  assertAllowedKeys(src, SYNC_EXTERNAL_KEYS, 'sync-external-posts')
  const accountId = parsePositiveInt(src.account_id, 'account_id', {
    code: 'analytics-invalid-account-id',
    required: true,
  })
  const url = optionalString(src.url, 'url')
  /** @type {{ account_id: number, url?: string }} */
  const wireBody = { account_id: /** @type {number} */ (accountId) }
  if (url) wireBody.url = url
  return client.withPat(`${API}/sync-external-posts`, {
    method: 'POST',
    body: wireBody,
  })
}

/**
 * 8. 私信与收件箱分析系列
 * @param {{ withPat: Function }} client
 * @param {unknown} capability volume | response-time | heatmap | source-breakdown
 * @param {Record<string, unknown>} [query]
 */
export async function getInboxAnalytics(client, capability, query = {}) {
  const cap = typeof capability === 'string' ? capability.trim() : ''
  if (!cap) {
    throw new OmnimuxError('analytics-invalid-capability', 'capability is required', { status: 400 })
  }
  if (!Object.hasOwn(INBOX_CAPABILITY_KEYS, cap)) {
    throw new OmnimuxError(
      'analytics-invalid-capability',
      `unsupported inbox analytics capability: ${cap} (allowed: ${Object.keys(INBOX_CAPABILITY_KEYS).join(', ')})`,
      { status: 400 },
    )
  }
  const allowedKeys = INBOX_CAPABILITY_KEYS[/** @type {keyof typeof INBOX_CAPABILITY_KEYS} */ (cap)]
  const src = assertRecord(query, `inbox-analytics/${cap}`)
  assertAllowedKeys(src, allowedKeys, `inbox-analytics/${cap}`)
  /** @type {Record<string, string | undefined>} */
  const normalized = {}
  for (const key of allowedKeys) {
    normalized[key] = optionalString(src[key], key)
  }
  return client.withPat(`/api/social/v1/inbox-analytics/${encodeURIComponent(cap)}${analyticsQueryString(normalized)}`)
}
