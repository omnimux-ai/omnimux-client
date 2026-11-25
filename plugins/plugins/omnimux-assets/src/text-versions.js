/**
 * Persistent version snapshot store for managed text assets.
 *
 * All disk writes stay strictly inside `<dsh home>/omnimux/assets/data/text-versions/<assetId>/`
 * and use async `node:fs/promises` I/O so the Host main thread never blocks.
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { AssetsError } from './mappings.js'
import { isInsideDir } from './ingest.js'
import {
  MAX_TEXT_VERSIONS,
  TEXT_FILE_MAX_BYTES,
  calculateTextStats,
  normalizeTextSubPath,
} from './text-files.js'

const VALID_SOURCES = new Set(['manual', 'revert', 'auto'])
const SAFE_ASSET_ID_RE = /^[A-Za-z0-9_-]+$/
const SNAPSHOT_NAME_MAX = 120

/**
 * @param {string} assetId
 */
function assertSafeAssetId(assetId) {
  const id = String(assetId ?? '').trim()
  if (!id || !SAFE_ASSET_ID_RE.test(id)) {
    throw new AssetsError('asset-not-found', 'invalid asset id')
  }
  return id
}

/**
 * @param {string} fileId
 * @param {string} subPath
 */
function snapshotKeyOf(fileId, subPath) {
  const normalized = normalizeTextSubPath(subPath)
  return createHash('sha256').update(`${String(fileId ?? '')}\0${normalized}`).digest('hex').slice(0, 32)
}

/**
 * Strip snapshot `content` for JSON list/create/revert responses so raw document
 * prose never passes through the JSON secret-emission guard or bloats list payloads.
 * @param {{ id: string, timestamp: number, name: string, source: string, wordCount: number, charCount: number }} row
 */
export function snapshotMetaOf(row) {
  return {
    id: row.id,
    timestamp: row.timestamp,
    name: row.name,
    source: row.source,
    wordCount: row.wordCount,
    charCount: row.charCount,
  }
}

/**
 * @param {number} timestamp
 */
function defaultSnapshotName(timestamp) {
  const d = new Date(timestamp)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `版本快照 ${hh}:${mm}:${ss}`
}

/**
 * @param {string} filePath
 * @param {string} text
 */
async function atomicWriteAsync(filePath, text) {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`
  try {
    await writeFile(tmp, text, { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, filePath)
  } catch (error) {
    await unlink(tmp).catch((cleanupErr) => {
      console.warn('[omnimux-assets] failed to remove temp snapshot file:', cleanupErr?.message || cleanupErr)
    })
    throw error
  }
}

/**
 * @param {{ paths?: { dir?: string, libraryFile?: string, textVersionsDir?: string } }} [opts]
 */
export function createTextVersionStore(opts = {}) {
  const paths = opts.paths ?? {}
  const vaultRoot = paths.dir || (paths.libraryFile ? dirname(paths.libraryFile) : '')
  const rootDir = paths.textVersionsDir || (vaultRoot ? join(vaultRoot, 'data', 'text-versions') : '')

  /** @type {Map<string, Promise<unknown>>} */
  const locks = new Map()

  /**
   * Serialize mutations per file ledger so rapid create/delete/revert calls
   * cannot overwrite each other's JSON array.
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  function withFileLock(key, fn) {
    const previous = locks.get(key) ?? Promise.resolve()
    const run = previous.then(fn, fn)
    const settled = run.then(() => undefined, () => undefined)
    locks.set(key, settled)
    void settled.finally(() => {
      if (locks.get(key) === settled) locks.delete(key)
    })
    return run
  }

  /**
   * @param {string} assetId
   * @param {string} fileId
   * @param {string} [subPath]
   */
  function ledgerPathOf(assetId, fileId, subPath = '') {
    if (!rootDir) {
      throw new AssetsError('path-denied', 'text versions directory is unavailable')
    }
    const safeAsset = assertSafeAssetId(assetId)
    const key = snapshotKeyOf(fileId, subPath)
    const target = resolve(rootDir, safeAsset, `${key}.json`)
    if (!isInsideDir(target, rootDir)) {
      throw new AssetsError('path-denied', 'snapshot path escapes text versions root')
    }
    return target
  }

  /**
   * @param {string} filePath
   * @returns {Promise<Array<{ id: string, timestamp: number, name: string, content: string, source: string, wordCount: number, charCount: number }>>}
   */
  async function readLedger(filePath) {
    try {
      const raw = await readFile(filePath, 'utf8')
      const parsed = JSON.parse(raw)
      if (!parsed || !Array.isArray(parsed.versions)) return []
      return parsed.versions.filter((row) => (
        row
        && typeof row === 'object'
        && typeof row.id === 'string'
        && typeof row.content === 'string'
      ))
    } catch (error) {
      if (error && error.code === 'ENOENT') return []
      console.warn('[omnimux-assets] failed to read text versions ledger:', error?.message || error)
      return []
    }
  }

  /**
   * @param {string} filePath
   * @param {Array<object>} versions
   */
  async function writeLedger(filePath, versions) {
    const payload = JSON.stringify({ schema: 1, versions }, null, 2) + '\n'
    await atomicWriteAsync(filePath, payload)
  }

  /**
   * @param {string} assetId
   * @param {string} fileId
   * @param {string} [subPath]
   */
  async function listSnapshots(assetId, fileId, subPath = '') {
    const filePath = ledgerPathOf(assetId, fileId, subPath)
    const versions = await readLedger(filePath)
    return versions.map(snapshotMetaOf)
  }

  /**
   * @param {string} assetId
   * @param {string} fileId
   * @param {string} subPath
   * @param {string} versionId
   */
  async function getSnapshot(assetId, fileId, subPath, versionId) {
    const id = String(versionId ?? '').trim()
    if (!id) throw new AssetsError('version-not-found', 'versionId is required')
    const filePath = ledgerPathOf(assetId, fileId, subPath)
    const versions = await readLedger(filePath)
    const found = versions.find((row) => row.id === id)
    if (!found) throw new AssetsError('version-not-found', 'text version snapshot not found')
    return { ...found }
  }

  /**
   * @param {string} assetId
   * @param {string} fileId
   * @param {string} subPath
   * @param {{ name?: unknown, content?: unknown, source?: unknown }} input
   */
  async function createSnapshot(assetId, fileId, subPath, input = {}) {
    if (typeof input.content !== 'string') {
      throw new AssetsError('file-not-text', 'snapshot content must be a UTF-8 string')
    }
    const byteLength = Buffer.byteLength(input.content, 'utf8')
    if (byteLength > TEXT_FILE_MAX_BYTES) {
      throw new AssetsError('file-too-large', `text content exceeds ${TEXT_FILE_MAX_BYTES} bytes`)
    }
    const filePath = ledgerPathOf(assetId, fileId, subPath)
    const now = Date.now()
    const rawName = typeof input.name === 'string' ? input.name.trim() : ''
    const name = (rawName || defaultSnapshotName(now)).slice(0, SNAPSHOT_NAME_MAX)
    const source = typeof input.source === 'string' && VALID_SOURCES.has(input.source)
      ? input.source
      : 'manual'
    const stats = calculateTextStats(input.content)
    const snapshot = {
      id: `ver_${randomBytes(6).toString('hex')}`,
      timestamp: now,
      name,
      content: input.content,
      source,
      wordCount: stats.wordCount,
      charCount: stats.charCount,
    }
    await withFileLock(filePath, async () => {
      const existing = await readLedger(filePath)
      const next = [snapshot, ...existing].slice(0, MAX_TEXT_VERSIONS)
      await writeLedger(filePath, next)
    })
    return snapshotMetaOf(snapshot)
  }

  /**
   * @param {string} assetId
   * @param {string} fileId
   * @param {string} subPath
   * @param {string} versionId
   */
  async function deleteSnapshot(assetId, fileId, subPath, versionId) {
    const id = String(versionId ?? '').trim()
    if (!id) throw new AssetsError('version-not-found', 'versionId is required')
    const filePath = ledgerPathOf(assetId, fileId, subPath)
    return withFileLock(filePath, async () => {
      const existing = await readLedger(filePath)
      const next = existing.filter((row) => row.id !== id)
      if (next.length === existing.length) {
        throw new AssetsError('version-not-found', 'text version snapshot not found')
      }
      await writeLedger(filePath, next)
      return { deleted: true, versionId: id }
    })
  }

  /**
   * Clean up all snapshot ledgers belonging to a deleted asset.
   * @param {string} assetId
   */
  async function recycleAssetSnapshots(assetId) {
    if (!rootDir || !assetId || !SAFE_ASSET_ID_RE.test(String(assetId))) return
    const assetDir = resolve(rootDir, String(assetId))
    if (!isInsideDir(assetDir, rootDir) || assetDir === resolve(rootDir)) return
    try {
      await rm(assetDir, { recursive: true, force: true })
    } catch (error) {
      console.warn('[omnimux-assets] failed to recycle asset text snapshots:', error?.message || error)
    }
  }

  return {
    listSnapshots,
    getSnapshot,
    createSnapshot,
    deleteSnapshot,
    recycleAssetSnapshots,
  }
}
