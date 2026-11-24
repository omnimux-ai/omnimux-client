/** Safely reclaim legacy plugin-managed skill directories left by pre-Phase-3 desktop staging. */
import { lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Directory under Harness Home where DSH discovers user skills. */
export const LEGACY_SKILLS_DIRNAME = 'skills'

/** Marker written by pre-Phase-3 desktop preset staging into plugin-managed skills. */
export const LEGACY_SKILL_ORIGIN_FILENAME = 'omnimux-skill.json'

/** Return true iff `marker` is a valid legacy plugin-managed skill marker for `dirName`. */
export function isLegacyPluginSkillMarker(marker: unknown, dirName: string): boolean {
  if (typeof marker !== 'object' || marker === null || Array.isArray(marker)) return false
  const record = marker as Record<string, unknown>
  if (record.id !== dirName) return false
  if (typeof record.origin !== 'string') return false
  return record.origin.startsWith('plugin:') && record.origin.length > 'plugin:'.length
}

/**
 * Reclaim legacy plugin-managed skill copies from `<home>/skills/`.
 *
 * Pre-Phase-3 `dsh-plugin-desktop` staged plugin-bundled skills into `$DSH_HOME/skills/`
 * with an `omnimux-skill.json` marker (`{ id, origin: "plugin:<name>" }`). Because
 * DSH's user filesystem provider (`user-dsh`, rank 400) outranks bundled plugin
 * providers (`BUNDLED_SKILL_RANK`, rank 600), stale copies permanently shadow
 * upgraded plugin-bundled skills and bypass `disable-model-invocation: true`.
 *
 * Safety boundary:
 * - Never traverses or deletes symlinks (`<home>/skills`, `<home>/skills/<id>`, or marker).
 * - Only removes a real directory `<id>` containing a regular JSON file `omnimux-skill.json`
 *   with `origin` starting with `"plugin:"` (non-empty plugin name) and `id === <id>`.
 * - User-authored skills, Market manual installs (no marker), non-plugin origins,
 *   malformed markers, and entries listed in `keepIds` are always preserved untouched.
 *
 * @param home - Harness Home directory (`$DSH_HOME`, `~/.omnimux`, `~/.omnimux-dev`, etc.).
 * @param keepIds - Optional skill directory ids to keep (for fixtures with explicitly staged skills).
 * @returns Sorted list of reclaimed skill directory ids.
 */
export function reclaimLegacyManagedPluginSkills(
  home: string,
  keepIds?: Iterable<string>,
): string[] {
  if (typeof home !== 'string' || home.trim() === '') return []
  const keep = new Set(keepIds ?? [])
  const skillsRoot = join(resolve(home), LEGACY_SKILLS_DIRNAME)

  let rootStat
  try {
    rootStat = lstatSync(skillsRoot, { throwIfNoEntry: false })
  } catch (cause) {
    process.stderr.write(`omnimux: skipped legacy skill reclaim (unreadable skills root ${skillsRoot}): ${String(cause)}\n`)
    return []
  }
  if (rootStat === undefined || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return []
  }

  let entries
  try {
    entries = readdirSync(skillsRoot, { withFileTypes: true })
  } catch (cause) {
    process.stderr.write(`omnimux: skipped legacy skill reclaim (could not list ${skillsRoot}): ${String(cause)}\n`)
    return []
  }

  const reclaimed: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || keep.has(entry.name)) continue
    const entryDir = join(skillsRoot, entry.name)
    let entryStat
    try {
      entryStat = lstatSync(entryDir, { throwIfNoEntry: false })
    } catch (cause) {
      process.stderr.write(`omnimux: skipped legacy skill entry ${entryDir}: ${String(cause)}\n`)
      continue
    }
    if (entryStat === undefined || entryStat.isSymbolicLink() || !entryStat.isDirectory()) continue

    const markerPath = join(entryDir, LEGACY_SKILL_ORIGIN_FILENAME)
    let markerStat
    try {
      markerStat = lstatSync(markerPath, { throwIfNoEntry: false })
    } catch (cause) {
      process.stderr.write(`omnimux: skipped legacy skill marker ${markerPath}: ${String(cause)}\n`)
      continue
    }
    if (markerStat === undefined || markerStat.isSymbolicLink() || !markerStat.isFile()) continue

    let marker: unknown
    try {
      marker = JSON.parse(readFileSync(markerPath, 'utf8'))
    } catch (cause) {
      process.stderr.write(`omnimux: skipped malformed skill marker ${markerPath}: ${String(cause)}\n`)
      continue
    }
    if (!isLegacyPluginSkillMarker(marker, entry.name)) continue

    try {
      rmSync(entryDir, { recursive: true, force: true })
      reclaimed.push(entry.name)
    } catch (cause) {
      process.stderr.write(`omnimux: could not remove legacy plugin skill ${entryDir}: ${String(cause)}\n`)
    }
  }

  return reclaimed.sort()
}
