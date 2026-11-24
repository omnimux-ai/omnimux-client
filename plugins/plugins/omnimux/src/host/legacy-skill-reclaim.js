import { lstat, readdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Marker written by pre-Phase-3 desktop preset staging into plugin-managed skills. */
export const SKILL_ORIGIN_FILENAME = 'omnimux-skill.json'

/**
 * Safely reclaim legacy plugin-managed skill copies from `<home>/skills/`.
 *
 * Pre-Phase-3 `dsh-plugin-desktop` copied plugin-bundled skills into `$DSH_HOME/skills/`
 * with an `omnimux-skill.json` marker (`{ id, origin: "plugin:<name>" }`). Because
 * DSH's local filesystem provider (`user-dsh`, rank 400) outranks bundled plugin
 * providers (`BUNDLED_SKILL_RANK`, rank 600), stale copies would permanently shadow
 * upgraded plugin-bundled skills and bypass `disable-model-invocation: true`.
 *
 * Safety boundary:
 * - Never touches symlinks (neither `<home>/skills` nor `<home>/skills/<id>` nor marker).
 * - Only removes a real directory `<id>` containing a regular JSON file `omnimux-skill.json`
 *   whose `origin` starts with `"plugin:"` (non-empty plugin name) and whose `id === <id>`.
 * - User-authored skills, manually installed Market skills (no marker), non-plugin origins,
 *   malformed markers, and entries listed in `keepIds` are always preserved untouched.
 *
 * @param {string} home
 * @param {{ keepIds?: Iterable<string>, logger?: { warn?: (...args: unknown[]) => void } }} [options]
 * @returns {Promise<{ reclaimed: string[] }>}
 */
export async function reclaimLegacyManagedPluginSkills(home, options = {}) {
  if (typeof home !== 'string' || !home.trim()) {
    return { reclaimed: [] }
  }
  const keep = new Set(options.keepIds ?? [])
  const logger = options.logger
  const warn = (msg, detail) => {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(msg, detail)
    } else {
      console.warn(msg, detail)
    }
  }
  const skillsRoot = join(resolve(home), 'skills')

  let rootStat
  try {
    rootStat = await lstat(skillsRoot)
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') {
      return { reclaimed: [] }
    }
    warn('omnimux: legacy skill reclaim skipped (skills root unreadable)', {
      path: skillsRoot,
      message: err instanceof Error ? err.message : String(err),
    })
    return { reclaimed: [] }
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return { reclaimed: [] }
  }

  let entries
  try {
    entries = await readdir(skillsRoot, { withFileTypes: true })
  } catch (err) {
    warn('omnimux: legacy skill reclaim failed to list skills root', {
      path: skillsRoot,
      message: err instanceof Error ? err.message : String(err),
    })
    return { reclaimed: [] }
  }

  const reclaimed = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || keep.has(entry.name)) continue
    const entryDir = join(skillsRoot, entry.name)
    let entryStat
    try {
      entryStat = await lstat(entryDir)
    } catch (err) {
      if (err && typeof err === 'object' && err.code === 'ENOENT') continue
      warn('omnimux: legacy skill reclaim skipped unreadable entry', {
        path: entryDir,
        message: err instanceof Error ? err.message : String(err),
      })
      continue
    }
    if (entryStat.isSymbolicLink() || !entryStat.isDirectory()) continue

    const markerPath = join(entryDir, SKILL_ORIGIN_FILENAME)
    let markerStat
    try {
      markerStat = await lstat(markerPath)
    } catch (err) {
      if (err && typeof err === 'object' && err.code === 'ENOENT') continue
      warn('omnimux: legacy skill reclaim skipped unreadable marker', {
        path: markerPath,
        message: err instanceof Error ? err.message : String(err),
      })
      continue
    }
    if (markerStat.isSymbolicLink() || !markerStat.isFile()) continue

    let marker
    try {
      marker = JSON.parse(await readFile(markerPath, 'utf8'))
    } catch (err) {
      warn('omnimux: legacy skill reclaim skipped malformed marker', {
        path: markerPath,
        message: err instanceof Error ? err.message : String(err),
      })
      continue
    }
    if (!isLegacyPluginSkillMarker(marker, entry.name)) continue

    try {
      await rm(entryDir, { recursive: true, force: true })
      reclaimed.push(entry.name)
    } catch (err) {
      warn('omnimux: legacy skill reclaim failed to remove directory', {
        path: entryDir,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  reclaimed.sort()
  return { reclaimed }
}

/**
 * @param {unknown} marker
 * @param {string} dirName
 * @returns {boolean}
 */
export function isLegacyPluginSkillMarker(marker, dirName) {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return false
  const record = /** @type {Record<string, unknown>} */ (marker)
  if (record.id !== dirName) return false
  if (typeof record.origin !== 'string') return false
  return record.origin.startsWith('plugin:') && record.origin.length > 'plugin:'.length
}
