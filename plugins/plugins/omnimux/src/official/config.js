export const DEFAULT_ACCOUNT_AVATARS = Object.freeze({
  enabled: true,
  maxBytes: 204800,
  fetchTimeoutMs: 8000,
  concurrency: 4,
})

export const DEFAULT_OFFICIAL = Object.freeze({
  mount: true,
  accountAvatars: DEFAULT_ACCOUNT_AVATARS,
})

/**
 * @param {unknown} value
 * @param {string} name
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 */
function parseBoundedInt(value, name, fallback, min, max) {
  if (value == null) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`omnimux: official.accountAvatars.${name} must be an integer ${min}…${max}`)
  }
  return value
}

/**
 * @param {unknown} value
 */
function parseAccountAvatars(value) {
  if (value == null) {
    return {
      enabled: DEFAULT_ACCOUNT_AVATARS.enabled,
      maxBytes: DEFAULT_ACCOUNT_AVATARS.maxBytes,
      fetchTimeoutMs: DEFAULT_ACCOUNT_AVATARS.fetchTimeoutMs,
      concurrency: DEFAULT_ACCOUNT_AVATARS.concurrency,
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('omnimux: official.accountAvatars must be an object')
  }
  const input = /** @type {Record<string, unknown>} */ (value)
  if (input.enabled != null && typeof input.enabled !== 'boolean') {
    throw new Error('omnimux: official.accountAvatars.enabled must be a boolean')
  }
  return {
    enabled: input.enabled !== false,
    maxBytes: parseBoundedInt(input.maxBytes, 'maxBytes', DEFAULT_ACCOUNT_AVATARS.maxBytes, 1, 1048576),
    fetchTimeoutMs: parseBoundedInt(
      input.fetchTimeoutMs,
      'fetchTimeoutMs',
      DEFAULT_ACCOUNT_AVATARS.fetchTimeoutMs,
      500,
      60000,
    ),
    concurrency: parseBoundedInt(input.concurrency, 'concurrency', DEFAULT_ACCOUNT_AVATARS.concurrency, 1, 16),
  }
}

/**
 * @param {unknown} value
 */
export function parseOfficialConfig(value) {
  if (value == null) {
    return {
      mount: DEFAULT_OFFICIAL.mount,
      accountAvatars: parseAccountAvatars(undefined),
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('omnimux: official config must be an object')
  }
  const input = /** @type {Record<string, unknown>} */ (value)
  return {
    mount: input.mount !== false,
    accountAvatars: parseAccountAvatars(input.accountAvatars),
  }
}
