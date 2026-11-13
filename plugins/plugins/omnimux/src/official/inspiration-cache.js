import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_ENTRIES = 512
const MAX_BYTES = 256 * 1024 * 1024
const HASH_LEN = 20

/**
 * @param {string} key
 */
export function cacheId(key) {
  return createHash('sha1').update(key).digest('hex').slice(0, HASH_LEN)
}

/**
 * @param {unknown} dataRoot
 * @param {{ maxEntries?: number, maxBytes?: number, ttlMs?: number }} [opts]
 */
export function createMediaCache(dataRoot, opts = {}) {
  const root = typeof dataRoot === 'string' && dataRoot.trim() ? join(dataRoot, 'omnimux', 'media', 'inspiration') : ''
  const maxEntries = typeof opts.maxEntries === 'number' && opts.maxEntries > 0 ? opts.maxEntries : MAX_ENTRIES
  const maxBytes = typeof opts.maxBytes === 'number' && opts.maxBytes > 0 ? opts.maxBytes : MAX_BYTES
  const ttlMs = typeof opts.ttlMs === 'number' && opts.ttlMs > 0 ? opts.ttlMs : TTL_MS
  let lastFetchedAt = 0

  /**
   * @param {string} key
   */
  function paths(key) {
    const id = cacheId(key)
    return { bin: join(root, `${id}.bin`), meta: join(root, `${id}.json`) }
  }

  /**
   * @param {string} key
   */
  function readMeta(key) {
    if (!root) return null
    try {
      const raw = JSON.parse(readFileSync(paths(key).meta, 'utf8'))
      if (!raw || typeof raw !== 'object') return null
      return /** @type {Record<string, unknown>} */ (raw)
    } catch {
      return null
    }
  }

  /**
   * @param {string} key
   * @param {{ allowStale?: boolean }} [flags]
   */
  function read(key, flags = {}) {
    if (!root) return null
    const loc = paths(key)
    const meta = readMeta(key)
    if (!meta) return null
    const fetchedAt = typeof meta.fetchedAt === 'number' ? meta.fetchedAt : 0
    if (!flags.allowStale && Date.now() - fetchedAt > ttlMs) return null
    let body
    try {
      body = readFileSync(loc.bin)
    } catch {
      return null
    }
    const length = typeof meta.length === 'number' ? meta.length : body.length
    if (length !== body.length) return null
    return {
      body,
      mime: typeof meta.mime === 'string' && meta.mime ? meta.mime : 'application/octet-stream',
      etag: typeof meta.etag === 'string' ? meta.etag : `"${cacheId(key)}"`,
      lastModified: typeof meta.lastModified === 'string' ? meta.lastModified : '',
      length: body.length,
      fetchedAt,
    }
  }

  /**
   * @param {string} key
   * @param {{ body: Buffer, mime?: string, etag?: string, lastModified?: string }} entry
   */
  function write(key, entry) {
    if (!root) return
    try {
      mkdirSync(root, { recursive: true, mode: 0o700 })
      const loc = paths(key)
      let fetchedAt = Date.now()
      if (fetchedAt <= lastFetchedAt) fetchedAt = lastFetchedAt + 1
      lastFetchedAt = fetchedAt
      const meta = {
        mime: entry.mime || 'application/octet-stream',
        etag: entry.etag || `"${cacheId(key)}"`,
        lastModified: entry.lastModified || '',
        length: entry.body.length,
        fetchedAt,
        hits: 0,
      }
      writeFileSync(loc.bin, entry.body, { mode: 0o600 })
      writeFileSync(loc.meta, JSON.stringify(meta), { mode: 0o600 })
      prune()
    } catch {
      // Disk is optional. Stream still succeeds without a cache write.
    }
  }

  /**
   * @param {string} key
   */
  function touch(key) {
    if (!root) return
    const meta = readMeta(key)
    if (!meta) return
    meta.fetchedAt = Date.now()
    meta.hits = (typeof meta.hits === 'number' ? meta.hits : 0) + 1
    try {
      writeFileSync(paths(key).meta, JSON.stringify(meta), { mode: 0o600 })
      const now = new Date()
      utimesSync(paths(key).bin, now, now)
    } catch {
      // ignore
    }
  }

  function prune() {
    if (!root) return
    /** @type {Array<{ id: string, fetchedAt: number, bytes: number }>} */
    const rows = []
    let names
    try {
      names = readdirSync(root)
    } catch {
      return
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const id = name.slice(0, -'.json'.length)
      let fetchedAt = 0
      let bytes = 0
      try {
        const meta = JSON.parse(readFileSync(join(root, name), 'utf8'))
        fetchedAt = typeof meta.fetchedAt === 'number' ? meta.fetchedAt : 0
      } catch {
        fetchedAt = 0
      }
      let mtimeMs = 0
      try {
        const st = statSync(join(root, `${id}.bin`))
        bytes = st.size
        mtimeMs = st.mtimeMs || 0
      } catch {
        bytes = 0
      }
      rows.push({ id, fetchedAt, mtimeMs, bytes })
    }
    rows.sort((a, b) => (a.fetchedAt - b.fetchedAt) || (a.mtimeMs - b.mtimeMs))
    let total = rows.reduce((sum, row) => sum + row.bytes, 0)
    while (rows.length > maxEntries || total > maxBytes) {
      const oldest = rows.shift()
      if (!oldest) break
      total -= oldest.bytes
      try { unlinkSync(join(root, `${oldest.id}.bin`)) } catch { /* ignore */ }
      try { unlinkSync(join(root, `${oldest.id}.json`)) } catch { /* ignore */ }
    }
  }

  return { enabled: Boolean(root), read, write, touch, readMeta, prune }
}

/**
 * @param {{ etag?: string, lastModified?: string }} hit
 * @param {string | undefined} ifNoneMatch
 * @param {string | undefined} ifModifiedSince
 */
export function matchesCondition(hit, ifNoneMatch, ifModifiedSince) {
  if (ifNoneMatch && hit.etag && ifNoneMatch.split(',').map((part) => part.trim()).includes(hit.etag)) return true
  if (ifModifiedSince && hit.lastModified) {
    const since = Date.parse(ifModifiedSince)
    const modified = Date.parse(hit.lastModified)
    if (!Number.isNaN(since) && !Number.isNaN(modified) && modified <= since) return true
  }
  return false
}

/**
 * @param {{ etag?: string, lastModified?: string }} hit
 */
export function cacheResponseHeaders(hit) {
  /** @type {Record<string, string>} */
  const headers = {
    'cache-control': 'public, max-age=3600',
    'accept-ranges': 'bytes',
  }
  if (hit.etag) headers.etag = hit.etag
  if (hit.lastModified) headers['last-modified'] = hit.lastModified
  return headers
}
