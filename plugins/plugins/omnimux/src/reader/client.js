import { OmnimuxError } from '../media/errors.js'

export const READER_MODEL = 'jina-reader-v1'
export const DEFAULT_READER_BASE = 'https://api.omnimux.ai/v1'
const USER_AGENT = 'OmniMuxHub/0.1.2 (omnimux_page_fetch; +https://omnimux.ai)'

/**
 * Reader 200 is text/plain markdown. `createOfficialClient.withSk` always
 * `response.json()` and cannot be the success path.
 *
 * @param {string | undefined} raw
 */
export function resolveReaderBaseUrl(raw) {
  const base = String(raw || DEFAULT_READER_BASE).replace(/\/+$/, '')
  if (!base) return DEFAULT_READER_BASE
  if (/\/v1$/i.test(base)) return base
  return `${base}/v1`
}

/**
 * @param {{
 *   fetcher?: typeof fetch,
 *   env?: Record<string, string | undefined>,
 *   resolveApiKey?: () => Promise<string | undefined> | string | undefined,
 * }} deps
 * @param {{ url: string }} args
 * @returns {Promise<string>}
 */
export async function postReader(deps, args) {
  const env = deps.env ?? process.env
  const resolved = typeof deps.resolveApiKey === 'function'
    ? await deps.resolveApiKey()
    : (env.OMNIMUX_API_KEY || env.OMNIMUX_TOKEN)
  const key = String(resolved || '').trim()
  if (!key) {
    throw new OmnimuxError('omnimux-unconfigured', 'set OMNIMUX_API_KEY or OMNIMUX_TOKEN')
  }

  const fetcher = deps.fetcher ?? fetch
  const base = resolveReaderBaseUrl(env.OMNIMUX_BASE_URL)
  const response = await fetcher(`${base}/reader`, {
    method: 'POST',
    headers: {
      accept: 'text/plain, application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
      'user-agent': USER_AGENT,
    },
    body: JSON.stringify({ model: READER_MODEL, url: args.url }),
  })

  const raw = await readBodyText(response)
  if (response.status === 401 || response.status === 403) {
    throw new OmnimuxError('needs-omnimux', `official request unauthorized (HTTP ${response.status})`)
  }
  if (!response.ok) {
    const json = tryJson(raw)
    const message = pickErrorMessage(json) || `official request failed (HTTP ${response.status})`
    const code = isInvalidRequest(json, message) ? 'omnimux-invalid-request' : 'omnimux-request-failed'
    const error = new OmnimuxError(code, message)
    error.status = response.status
    throw error
  }
  if (!String(raw || '').trim()) {
    throw new OmnimuxError('omnimux-invalid-response', 'reader returned empty markdown')
  }
  return raw
}

/**
 * @param {{ text?: () => Promise<string>, json?: () => Promise<unknown> }} response
 */
async function readBodyText(response) {
  if (typeof response.text === 'function') return response.text()
  if (typeof response.json === 'function') {
    try {
      return JSON.stringify(await response.json())
    } catch {
      return ''
    }
  }
  return ''
}

/**
 * @param {string} raw
 */
function tryJson(raw) {
  const text = String(raw || '').trim()
  if (!text.startsWith('{') && !text.startsWith('[')) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * @param {unknown} json
 * @param {string} message
 */
function isInvalidRequest(json, message) {
  if (!json || typeof json !== 'object') return /invalid/i.test(message)
  const row = /** @type {Record<string, unknown>} */ (json)
  const error = row.error
  if (typeof error === 'string' && /invalid/i.test(error)) return true
  if (error && typeof error === 'object') {
    const inner = /** @type {Record<string, unknown>} */ (error)
    if (/invalid/i.test(String(inner.type || inner.code || inner.message || ''))) return true
  }
  return /invalid/i.test(message)
}

/**
 * @param {unknown} json
 */
function pickErrorMessage(json) {
  if (!json || typeof json !== 'object') return ''
  const row = /** @type {Record<string, unknown>} */ (json)
  const error = row.error
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (error && typeof error === 'object') {
    const inner = /** @type {Record<string, unknown>} */ (error)
    const nested = String(inner.message || inner.type || inner.code || '').trim()
    if (nested) return nested
  }
  const data = row.data && typeof row.data === 'object' ? /** @type {Record<string, unknown>} */ (row.data) : {}
  return String(row.message || data.error || data.message || '').trim()
}
