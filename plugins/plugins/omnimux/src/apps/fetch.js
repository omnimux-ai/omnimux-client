/** Host-only GET of the official Apps catalog. */

import { MAX_CATALOG_BYTES } from './parse.js'

/**
 * @param {string} url
 * @param {string} siteHost
 */
function assertSameHostHttps(url, siteHost) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error('apps catalog URL must be https')
  if (parsed.host !== siteHost) throw new Error('apps catalog redirect left the site host')
}

/**
 * @param {{
 *   url: string,
 *   siteHost: string,
 *   timeoutMs: number,
 *   etag?: string | null,
 *   lastModified?: string | null,
 *   fetcher?: typeof fetch,
 *   now?: () => number,
 * }} opts
 */
export async function fetchRemoteCatalog(opts) {
  const fetcher = opts.fetcher ?? fetch
  assertSameHostHttps(opts.url, opts.siteHost)
  const headers = { Accept: 'application/json' }
  if (opts.etag) headers['If-None-Match'] = opts.etag
  if (opts.lastModified) headers['If-Modified-Since'] = opts.lastModified
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs)
  try {
    const response = await follow(fetcher, opts.url, headers, controller.signal, opts.siteHost, 0)
    if (response.status === 304) {
      return { kind: 'not_modified', etag: opts.etag ?? null, lastModified: opts.lastModified ?? null }
    }
    if (response.status !== 200) {
      return { kind: 'network', error: `HTTP ${String(response.status)}` }
    }
    const raw = await readLimited(response)
    return {
      kind: 'ok',
      raw,
      etag: response.headers?.get?.('etag') ?? null,
      lastModified: response.headers?.get?.('last-modified') ?? null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error && /** @type {{ name?: string }} */ (error).name === 'AbortError') {
      return { kind: 'network', error: 'timeout' }
    }
    if (error && /** @type {{ name?: string }} */ (error).name === 'InvalidCatalog') {
      return { kind: 'invalid', error: message }
    }
    return { kind: 'network', error: message }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @param {typeof fetch} fetcher
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {AbortSignal} signal
 * @param {string} siteHost
 * @param {number} hops
 */
async function follow(fetcher, url, headers, signal, siteHost, hops) {
  if (hops > 3) throw new Error('too many redirects')
  assertSameHostHttps(url, siteHost)
  const response = await fetcher(url, { method: 'GET', headers, signal, redirect: 'manual' })
  if (response.status >= 300 && response.status < 400 && response.status !== 304) {
    const location = response.headers?.get?.('location')
    if (!location) throw new Error('redirect missing location')
    return follow(fetcher, new URL(location, url).toString(), headers, signal, siteHost, hops + 1)
  }
  return response
}

/**
 * @param {{
 *   headers?: { get?: (name: string) => string | null },
 *   text?: () => Promise<string>,
 *   body?: AsyncIterable<unknown> | ReadableStream<Uint8Array> | null,
 * }} response
 */
async function readLimited(response) {
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > MAX_CATALOG_BYTES) {
    const error = new Error('apps catalog exceeds size limit')
    error.name = 'InvalidCatalog'
    throw error
  }
  const body = response.body
  if (body && typeof body.getReader === 'function') {
    return readStream(body)
  }
  if (body && typeof body[Symbol.asyncIterator] === 'function') {
    return readChunks(body)
  }
  if (typeof response.text === 'function') {
    const raw = await response.text()
    if (Buffer.byteLength(raw, 'utf8') > MAX_CATALOG_BYTES) {
      const error = new Error('apps catalog exceeds size limit')
      error.name = 'InvalidCatalog'
      throw error
    }
    return raw
  }
  return ''
}

/**
 * @param {ReadableStream<Uint8Array>} stream
 */
async function readStream(stream) {
  const reader = stream.getReader()
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = value == null ? Buffer.alloc(0) : Buffer.from(value)
      size += chunk.byteLength
      if (size > MAX_CATALOG_BYTES) {
        const error = new Error('apps catalog exceeds size limit')
        error.name = 'InvalidCatalog'
        throw error
      }
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * @param {AsyncIterable<unknown>} iterable
 */
async function readChunks(iterable) {
  let raw = ''
  for await (const chunk of iterable) {
    raw += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    if (Buffer.byteLength(raw, 'utf8') > MAX_CATALOG_BYTES) {
      const error = new Error('apps catalog exceeds size limit')
      error.name = 'InvalidCatalog'
      throw error
    }
  }
  return raw
}
