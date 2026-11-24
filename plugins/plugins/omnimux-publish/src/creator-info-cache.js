/**
 * Short-TTL per-account memory cache for TikTok `creator_info` queries.
 *
 * Shared by the UI route (`GET /creator-info`) and Host pre-submit validation
 * (`submit.js prepareNow`) to avoid tripping TikTok's 6 req/min rate limit:
 *   - Caches healthy successful responses for `ttlMs` (default 60s).
 *   - Coalesces concurrent in-flight requests for the same `account_id`.
 *   - Never caches errors or `can_post === false` responses so retries recover immediately.
 *   - Supports `{ force: true }` to bypass cache (e.g. UI Retry button).
 */
import { PublishError } from './publish-error.js'
import { isObject } from './shared/values.js'

export const DEFAULT_CREATOR_INFO_TTL_MS = 60_000

/**
 * Determine whether a `creator_info` response is healthy enough to cache.
 * Errors, `success: false`, upstream TikTok error payloads, and `can_post: false`
 * are never cached.
 * @param {unknown} response
 * @returns {boolean}
 */
export function isCacheableCreatorInfo(response) {
  if (!isObject(response)) return false
  if (response.success === false) return false
  const data = isObject(response.data) ? response.data : response
  if (isObject(data.error) && typeof data.error.code === 'string' && data.error.code !== '' && data.error.code.toLowerCase() !== 'ok') {
    return false
  }
  if (data.can_post === false || data.can_post_more === false) return false
  return true
}

/**
 * @param {{
 *   channel?: { creatorInfo?: (accountId: string, opts?: { agent?: unknown, signal?: AbortSignal }) => Promise<unknown> },
 *   ttlMs?: number,
 *   now?: () => number,
 * }} [deps]
 */
export function createCreatorInfoCache(deps = {}) {
  const channel = deps.channel
  const ttlMs = typeof deps.ttlMs === 'number' && deps.ttlMs >= 0 ? deps.ttlMs : DEFAULT_CREATOR_INFO_TTL_MS
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()

  /** @type {Map<string, { value: unknown, expiresAt: number }>} */
  const entries = new Map()
  /** @type {Map<string, Promise<unknown>>} */
  const inflight = new Map()

  /**
   * @param {string} accountId
   * @param {{ force?: boolean, agent?: unknown, signal?: AbortSignal }} [opts]
   * @returns {Promise<unknown>}
   */
  async function get(accountId, opts = {}) {
    const id = String(accountId || '').trim()
    if (id === '') throw new PublishError('invalid-arguments', 'account_id is required')
    if (!channel || typeof channel.creatorInfo !== 'function') {
      throw new PublishError('hub-tool-unavailable', 'creator info is unavailable')
    }
    const force = opts.force === true
    if (!force && ttlMs > 0) {
      const cached = entries.get(id)
      if (cached && now() < cached.expiresAt) return cached.value
      if (cached) entries.delete(id)
      const pending = inflight.get(id)
      if (pending) return pending
    }
    const callOpts = {
      ...(opts.agent !== undefined ? { agent: opts.agent } : {}),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    }
    const promise = Promise.resolve()
      .then(() => /** @type {(accountId: string, opts?: { agent?: unknown, signal?: AbortSignal }) => Promise<unknown>} */ (channel.creatorInfo)(id, callOpts))
      .then((result) => {
        if (ttlMs > 0 && isCacheableCreatorInfo(result)) {
          entries.set(id, { value: result, expiresAt: now() + ttlMs })
        } else {
          entries.delete(id)
        }
        return result
      })
      .catch((error) => {
        entries.delete(id)
        throw error
      })
      .finally(() => {
        if (inflight.get(id) === promise) inflight.delete(id)
      })

    if (!force) inflight.set(id, promise)
    return promise
  }

  /** @param {string} [accountId] */
  function clear(accountId) {
    if (accountId === undefined) {
      entries.clear()
      return
    }
    entries.delete(String(accountId || '').trim())
  }

  return { get, clear }
}
