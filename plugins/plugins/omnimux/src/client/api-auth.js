import { jsonRequest } from './api-json.js'

const PUBLIC_KEYS = [
  'logged_in', 'verified', 'base_url', 'id', 'username', 'display_name',
  'group', 'quota_usd', 'used_quota_usd', 'flow_id', 'verification_url',
  'user_code', 'expires_in', 'interval', 'kind', 'error',
]

/**
 * Session-level status cache. No TTL — expiry is event-driven (logout, 401,
 * verify/network failure, explicit logged_out). Lives here, not in the gate
 * store, so every caller of `getStatus` / `getStatusCached` shares one picture.
 * @type {{ ok: boolean, status: number, body: any } | null}
 */
let statusCache = null
/** @type {Promise<{ ok: boolean, status: number, body: any }> | null} */
let statusInflight = null
/** Bumped on invalidate so a stale inflight cannot rewrite the cache. */
let statusGeneration = 0

/**
 * @param {unknown} raw
 */
export function pickPublic(raw) {
  const row = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const key of PUBLIC_KEYS) {
    if (key in row) out[key] = row[key]
  }
  return out
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [opts]
 */
export async function authRequest(path, opts = {}) {
  const result = await jsonRequest(path, {
    ...opts,
    pick: pickPublic,
    requireJson: true,
    notMounted: 'auth routes not mounted',
  })
  const dumped = JSON.stringify(result.body)
  if (typeof dumped === 'string' && /access_token|"sk-/.test(dumped)) {
    throw new Error('refused a secret-bearing auth payload')
  }
  return result
}

/**
 * Synchronous session-cache read for the login-gate short path.
 * @returns {{ ok: boolean, status: number, body: any } | null}
 */
export function peekStatusCache() {
  return statusCache
}

/**
 * Drop the session cache immediately and discard any inflight write.
 */
export function invalidateStatusCache() {
  statusGeneration += 1
  statusCache = null
  statusInflight = null
}

/** Test-only: identical to invalidate; kept as a named seam for L1 resets. */
export function resetStatusCache() {
  invalidateStatusCache()
}

/**
 * Remember a successful login so the next `ensureLogin` can resolve
 * synchronously. Also drops any inflight status read so it cannot clobber
 * the positive cache with a stale negative.
 * @param {any} profile
 */
export function rememberLoggedInStatus(profile) {
  statusGeneration += 1
  statusInflight = null
  if (!profile || typeof profile !== 'object') return
  const body = /** @type {Record<string, unknown>} */ (profile)
  statusCache = {
    ok: true,
    status: 200,
    body: body.logged_in === true ? body : { ...body, logged_in: true },
  }
}

/**
 * @param {{ ok?: boolean, status?: number, body?: any }} result
 * @param {number} generation
 */
function rememberStatusResult(result, generation) {
  if (generation !== statusGeneration) return
  const body = result && result.body
  const loggedIn = Boolean(result && result.ok && body && body.logged_in === true)
  const loggedOut = Boolean(body && body.logged_in === false)
  if (loggedIn || loggedOut) {
    statusCache = {
      ok: Boolean(result.ok),
      status: Number(result.status) || 0,
      body,
    }
    return
  }
  // verify / network-shaped failure: never write as logged in; drop a
  // positive cache conservatively.
  statusCache = null
}

/**
 * Always hits HTTP. On the way back: `logged_in:true` remembers; explicit
 * `logged_in:false` writes a negative cache; verify/network failure drops
 * any positive cache and does not remember a login.
 * @param {boolean} [verify]
 */
export function getStatus(verify = false) {
  const generation = statusGeneration
  return authRequest(verify ? '/omnimux/auth/status?verify=1' : '/omnimux/auth/status').then(
    (result) => {
      rememberStatusResult(result, generation)
      return result
    },
    (error) => {
      if (generation === statusGeneration) statusCache = null
      throw error
    },
  )
}

/**
 * Peek hit → `Promise.resolve` (0 HTTP). Miss → one inflight `getStatus(false)`.
 */
export function getStatusCached() {
  if (statusCache) return Promise.resolve(statusCache)
  if (statusInflight) return statusInflight
  const started = getStatus(false)
  statusInflight = started.finally(() => {
    if (statusInflight === started) statusInflight = null
  })
  return statusInflight
}

/** The Host uses this exact code to signal "sign in to OmniMux first". */
export const NEEDS_AUTH_CODE = 'needs-omnimux'

/**
 * Normalized "this call needs auth" detector. It accepts both the 401 status
 * and the `error` code so the client works regardless of the two Host route
 * formats (official maps `needs-omnimux` to a message body, avatar to a code).
 * @param {{ ok?: boolean, status?: number, body?: unknown }} result
 * @returns {string | null} the auth code when the call was rejected, else null.
 */
export function pickAuthError(result) {
  const body = result && typeof result.body === 'object' ? /** @type {Record<string, unknown>} */ (result.body) : null
  if (body && body.error === NEEDS_AUTH_CODE) return NEEDS_AUTH_CODE
  if (result && result.status === 401) return NEEDS_AUTH_CODE
  return null
}

/**
 * Wrap any `/omnimux/*` request so a 401 / needs-omnimux response triggers the
 * unified login gate, then replays the original call once the user signs in.
 * When the gate is unavailable (or the user cancels) the original result is
 * returned untouched. The replay bypasses the guard so a still-401 response
 * cannot recursively re-open the gate.
 *
 * Cache is invalidated *before* `ensureLogin` so a stale positive peek cannot
 * short-circuit the gate and replay the 401 forever.
 * @param {(...args: any[]) => Promise<{ ok: boolean, status: number, body: unknown }>} fn
 * @returns {(...args: any[]) => Promise<{ ok: boolean, status: number, body: unknown }>}
 */
export function authGuard(fn) {
  return (...args) => {
    const run = async () => {
      const result = await fn(...args)
      if (pickAuthError(result) === null) return result
      // 401 / needs-omnimux means the session picture is stale. Drop it
      // before the gate short path can replay the same 401 forever, even
      // when the gate global is absent.
      invalidateStatusCache()
      const authGlobal = typeof window !== 'undefined' ? /** @type {any} */ (window).__omnimuxAuth : undefined
      if (!authGlobal || typeof authGlobal.ensureLogin !== 'function') return result
      return new Promise((resolve, reject) => {
        authGlobal.ensureLogin({
          kind: 'write',
          onSuccess: () => {
            fn(...args).then(resolve, reject)
          },
          onCancel: () => resolve(result),
        })
      })
    }
    return run()
  }
}

export function startLogin() {
  return authRequest('/omnimux/auth/login', { method: 'POST' })
}

/**
 * @param {string} flowId
 */
export function pollLogin(flowId) {
  return authRequest('/omnimux/auth/poll', { method: 'POST', body: { flow_id: flowId } })
}

export function logout() {
  // Drop the session picture *before* the request leaves, so a concurrent
  // `ensureLogin` cannot peek a stale logged-in row while logout is in flight.
  invalidateStatusCache()
  return authRequest('/omnimux/auth/logout', { method: 'POST' })
}
