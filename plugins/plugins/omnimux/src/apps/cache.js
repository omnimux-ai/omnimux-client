/** Disk cache for the last valid remote Apps catalog. */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCatalog } from './parse.js'

/**
 * @param {string} home
 */
export function appsCacheDir(home) {
  return join(home, 'omnimux', 'apps')
}

/**
 * @param {string} home
 */
export function createAppsCache(home) {
  const dir = appsCacheDir(home)
  const catalogPath = join(dir, 'catalog.json')
  const metaPath = join(dir, 'meta.json')

  function readMeta() {
    try {
      const raw = JSON.parse(readFileSync(metaPath, 'utf8'))
      if (!raw || typeof raw !== 'object') return undefined
      return raw
    } catch {
      return undefined
    }
  }

  function readCatalog() {
    try {
      return parseCatalog(readFileSync(catalogPath, 'utf8'))
    } catch {
      return undefined
    }
  }

  /**
   * @param {object} meta
   */
  function writeMeta(meta) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(metaPath, `${JSON.stringify(meta, undefined, 2)}\n`, { mode: 0o600 })
  }

  /**
   * @param {string} raw
   * @param {object} meta
   */
  function writeCatalog(raw, meta) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(catalogPath, raw.endsWith('\n') ? raw : `${raw}\n`, { mode: 0o600 })
    writeMeta({
      ...meta,
      sha256: createHash('sha256').update(raw).digest('hex'),
    })
  }

  function clearCatalog() {
    try {
      rmSync(catalogPath)
    } catch {
      // already absent
    }
    const meta = readMeta() ?? {}
    writeMeta({
      ...meta,
      etag: null,
      last_modified: null,
      sha256: null,
    })
  }

  return { dir, catalogPath, metaPath, readMeta, readCatalog, writeMeta, writeCatalog, clearCatalog }
}

/**
 * @param {unknown} meta
 * @param {number} ttlSeconds
 * @param {number} [now]
 */
export function isRefreshDue(meta, ttlSeconds, now = Date.now()) {
  if (!meta || typeof meta !== 'object') return true
  const row = /** @type {Record<string, unknown>} */ (meta)
  if (typeof row.fetched_at !== 'string') return true
  const fetched = Date.parse(row.fetched_at)
  if (Number.isNaN(fetched)) return true
  return now - fetched >= ttlSeconds * 1000
}
