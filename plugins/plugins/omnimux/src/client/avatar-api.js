/**
 * Browser calls to the Host avatar route. Response parsing drops unknown keys.
 */

const AVATAR_KEYS = ['uri', 'name', 'opts', 'using_default']
const AVATAR_OPTS_KEYS = ['seed', 'hue', 'tone', 'background']

/**
 * @param {unknown} raw
 */
export function pickAvatar(raw) {
  const row = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
  const avatar = row.avatar && typeof row.avatar === 'object' ? /** @type {Record<string, unknown>} */ (row.avatar) : {}
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const key of AVATAR_KEYS) {
    if (key in avatar) out[key] = avatar[key]
  }
  if (out.opts && typeof out.opts === 'object') {
    const opts = /** @type {Record<string, unknown>} */ (out.opts)
    /** @type {Record<string, unknown>} */
    const picked = {}
    for (const key of AVATAR_OPTS_KEYS) {
      if (key in opts) picked[key] = opts[key]
    }
    out.opts = picked
  }
  if (typeof row.error === 'string') out.error = row.error
  return out
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [opts]
 */
export async function avatarRequest(path, opts = {}) {
  const response = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('json')) {
    return {
      ok: false,
      status: response.status,
      body: { error: response.status === 404 ? 'avatar route not mounted' : `unexpected ${contentType || 'response'}` },
    }
  }
  let json = null
  try {
    json = await response.json()
  } catch {
    json = {}
  }
  const body = pickAvatar(json)
  if (/"access_token"\s*:/.test(JSON.stringify(body))) {
    throw new Error('refused a secret-bearing avatar payload')
  }
  return { ok: response.ok, status: response.status, body }
}

export function getAvatar() {
  return avatarRequest('/omnimux/avatar')
}

/**
 * @param {{ seed?: string, hue?: number, tone?: number, background?: string, upload?: string, reroll?: boolean, reset?: boolean }} patch
 */
export function updateAvatar(patch) {
  return avatarRequest('/omnimux/avatar', { method: 'PATCH', body: patch })
}
