import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { SelectionError } from './errors.js'

/**
 * Resolve storage paths under `$DSH_HOME/omnimux/tiktok-selection/`.
 * @param {{ home?: string, rootDir?: string }} [opts]
 */
export function resolveSelectionPaths(opts = {}) {
  const hostHome = opts.home || process.env.DSH_HOME
  const rootDir = opts.rootDir
    ? String(opts.rootDir)
    : hostHome
      ? join(hostHome, 'omnimux', 'tiktok-selection')
      : join(homedir(), '.omnimux', 'tiktok-selection')
  return {
    rootDir,
    libraryFile: join(rootDir, 'library.json'),
    tasksFile: join(rootDir, 'tasks.json'),
    gateItemsFile: join(rootDir, 'gate-items.json'),
    riskWordsFile: join(rootDir, 'risk-words.json'),
    schedulesFile: join(rootDir, 'schedules.json'),
    runsFile: join(rootDir, 'runs.json'),
    snapshotsFile: join(rootDir, 'snapshots.json'),
    settingsFile: join(rootDir, 'settings.json'),
    assetsDir: join(rootDir, 'assets'),
  }
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true })
}

/**
 * Sanitize an untrusted identifier (e.g. productId from an imported CSV/JSON
 * snapshot) into a single safe path segment. Strips path separators, `..`
 * sequences and characters outside `[A-Za-z0-9._-]`, so it can never escape
 * a containing directory.
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function safePathSegment(value, fallback = 'unknown') {
  const raw = String(value == null ? '' : value).trim()
  const cleaned = raw
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._]+/, '')
    .replace(/[._]+$/, '')
  if (!cleaned || cleaned === '.' || cleaned === '..') return fallback
  return cleaned.slice(0, 120)
}

/**
 * Resolve `segments` under `baseDir` and assert the result cannot escape it.
 * @param {string} baseDir
 * @param {...string} segments
 * @returns {string}
 */
export function resolveWithin(baseDir, ...segments) {
  const base = resolve(baseDir)
  const target = resolve(base, ...segments)
  if (target !== base && !target.startsWith(base + sep)) {
    throw new SelectionError('invalid-request', 'Resolved path escapes the assets directory')
  }
  return target
}

export function readJsonFile(filePath, fallback) {
  if (!existsSync(filePath)) return fallback
  try {
    const raw = readFileSync(filePath, 'utf8')
    if (!raw.trim()) return fallback
    return JSON.parse(raw)
  } catch (err) {
    throw new SelectionError('store-corrupt', `Failed to read store file ${filePath}: ${err.message}`)
  }
}

export function writeJsonAtomic(filePath, data) {
  ensureDir(dirname(filePath))
  const tmpPath = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmpPath, filePath)
}
