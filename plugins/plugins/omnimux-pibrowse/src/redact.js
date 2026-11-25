const SECRET_KEY_NAMES = new Set([
  'password',
  'passwd',
  'pass',
  'secret',
  'token',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'session_token',
  'sessiontoken',
  'lock_token',
  'locktoken',
  'challenge_token',
  'challengetoken',
  'totp',
  'totp_code',
  'totpcode',
  'totp_secret',
  'totpsecret',
  'org_key',
  'orgkey',
  'org_key_b64',
  'orgkeyb64',
  'ork',
  'org_root_key',
  'orgrootkey',
  'user_key',
  'userkey',
  'private_key',
  'privatekey',
  'secret_key',
  'secretkey',
  'profile_key',
  'profilekey',
  'cookie_key',
  'cookiekey',
  'os_crypt_key',
  'oscryptkey',
  'dek',
  'bundle_key',
  'bundlekey',
  'wrapped_private_key',
  'wrappedprivatekey',
  'wrapped_ork',
  'wrappedork',
  'wrapped_dek',
  'wrappeddek',
  'wrapped_cookie_key',
  'wrappedcookiekey',
  'credentials_enc',
  'credentialsenc',
  'authorization',
])

export const SECRET_VALUE_PATTERN =
  /sk-[A-Za-z0-9_-]{16,}|\b(?:https?|socks5h?|socks4a?):\/\/[^/\s:@"'`]+:(?!\*\*\*@)[^/\s@"'`]+@|(?:access_token|refresh_token|session_token|lock_token|rotate_url|api[_-]?key|client_secret|authorization|profile_key|cookie_key|org_root_key|private_key)\s*["']?\s*[:=]\s*["']?(?!\[REDACTED\])[A-Za-z0-9+/=._:-]{12,}/i

/**
 * Recursively convert any value into lossless JSON (zero `undefined` properties,
 * zero sparse array holes, no NaN/Infinity).
 * @param {unknown} value
 * @returns {unknown}
 */
export function toLosslessJson(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) {
    const out = []
    for (let i = 0; i < value.length; i += 1) {
      const item = value[i]
      out.push(item === undefined ? null : toLosslessJson(item))
    }
    return out
  }
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue
      out[k] = toLosslessJson(v)
    }
    return out
  }
  return String(value)
}

/**
 * Strip inline credentials from proxy URLs such as `socks5://user:pass@host:port`.
 * @param {string} raw
 * @returns {string}
 */
export function redactUrlCredentials(raw) {
  if (typeof raw !== 'string' || !raw) return ''
  return raw.replace(
    /(\b(?:https?|socks5h?|socks4a?):\/\/)([^/\s:@]+):([^/\s@]+)@/gi,
    '$1$2:***@',
  )
}

/**
 * Redact a proxy record coming from `fury-agent` IPC or Team Server.
 * Never exposes plaintext proxy `password` or rotate URL query secrets.
 * @param {Record<string, unknown> | null | undefined} proxy
 */
export function redactProxy(proxy) {
  if (!proxy || typeof proxy !== 'object') return null
  const out = {}
  const hasPassword = Boolean(
    (typeof proxy.password === 'string' && proxy.password.length > 0) ||
    proxy.has_password === true ||
    proxy.hasPassword === true ||
    (typeof proxy.url === 'string' && /:[^/\s@]+@/.test(proxy.url)),
  )
  const hasRotateUrl = Boolean(
    (typeof proxy.rotate_url === 'string' && proxy.rotate_url.length > 0) ||
    (typeof proxy.rotateUrl === 'string' && proxy.rotateUrl.length > 0) ||
    proxy.has_rotate_url === true ||
    proxy.hasRotateUrl === true,
  )
  for (const [key, value] of Object.entries(proxy)) {
    if (value === undefined) continue
    const lower = key.toLowerCase()
    if (SECRET_KEY_NAMES.has(lower)) continue
    if (lower === 'rotate_url' || lower === 'rotateurl') {
      continue
    }
    out[key] = redactAny(value)
  }
  out.hasPassword = hasPassword
  out.hasRotateUrl = hasRotateUrl
  return out
}

/**
 * Redact a profile object returned from `fury-agent` IPC.
 * @param {Record<string, unknown> | null | undefined} profile
 */
export function redactProfile(profile) {
  if (!profile || typeof profile !== 'object') return null
  const out = {}
  for (const [key, value] of Object.entries(profile)) {
    if (value === undefined) continue
    const lower = key.toLowerCase()
    if (SECRET_KEY_NAMES.has(lower)) continue
    if (lower === 'proxy' && value && typeof value === 'object') {
      out[key] = redactProxy(/** @type {Record<string, unknown>} */ (value))
      continue
    }
    out[key] = redactAny(value)
  }
  return out
}

/**
 * Deeply scrub secret keys and URL credentials from arbitrary payloads before
 * emitting to HTTP, Agent tools, or logs.
 * @param {unknown} value
 * @returns {unknown}
 */
export function redactAny(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return redactUrlCredentials(value)
  if (typeof value === 'number' || typeof value === 'boolean') {
    return typeof value === 'number' && !Number.isFinite(value) ? null : value
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactAny(item))
  }
  if (typeof value === 'object') {
    const rec = /** @type {Record<string, unknown>} */ (value)
    if (
      ('host' in rec || 'scheme' in rec || 'protocol' in rec) &&
      ('password' in rec || 'rotate_url' in rec || 'rotateUrl' in rec)
    ) {
      return redactProxy(rec)
    }
    const out = {}
    for (const [key, v] of Object.entries(rec)) {
      if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue
      const lower = key.toLowerCase()
      if (SECRET_KEY_NAMES.has(lower)) continue
      if (lower === 'rotate_url' || lower === 'rotateurl') {
        out.hasRotateUrl = typeof v === 'string' && v.length > 0
        continue
      }
      out[key] = redactAny(v)
    }
    return out
  }
  return String(value)
}

/**
 * Scrub a single log or error line of Bearer tokens, inline URL credentials,
 * and key/secret/rotate_url parameters.
 * @param {string} line
 * @returns {string}
 */
export function redactLogLine(line) {
  if (typeof line !== 'string') return ''
  return redactUrlCredentials(line)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]')
    .replace(
      /((?:password|passwd|token|session_token|lock_token|secret|profile_key|cookie_key|org_key|private_key|rotate_url|ork|dek)\s*[:=]\s*["']?)[^\s"',}]+/gi,
      '$1[REDACTED]',
    )
}

/**
 * Guard serialized outbound JSON text against accidental secret emission.
 * @param {string} text
 * @returns {boolean}
 */
export function containsLeakedSecret(text) {
  return SECRET_VALUE_PATTERN.test(text)
}
