import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { SelectionError } from './errors.js'

/**
 * Resolve storage paths under `$DSH_HOME/omnimux/tiktok-selection/`.
 * @param {{ home?: string, rootDir?: string }} [opts]
 */
export function resolveSelectionPaths(opts = {}) {
  const rootDir = opts.rootDir
    ? String(opts.rootDir)
    : join(opts.home || process.env.DSH_HOME || join(homedir(), '.omnimux'), 'omnimux', 'tiktok-selection')
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
