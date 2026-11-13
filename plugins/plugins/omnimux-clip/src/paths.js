import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { ClipDomainError } from './errors.js'

/**
 * Resolve the official DSH home, matching the hub / assets convention.
 * @param {string | undefined} [homeDir]
 * @param {{ DSH_HOME?: string }} [env]
 */
export function resolveDshHome(homeDir, env = process.env) {
  return homeDir || env.DSH_HOME || join(homedir(), '.dsh')
}

/**
 * All clip state lives under `<dsh home>/omnimux/clip/`.
 * This directory is the only disk area this plugin may write.
 * @param {{ homeDir?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
export function resolveClipPaths(opts = {}) {
  const home = resolveDshHome(opts.homeDir, opts.env)
  const dir = join(home, 'omnimux', 'clip')
  return {
    dir,
    projectsDir: join(dir, 'projects'),
    exportsDir: join(dir, 'exports'),
    snapshotsDir: join(dir, 'snapshots'),
    tmpDir: join(dir, 'tmp'),
  }
}

/**
 * Ensure `{projects,exports,snapshots,tmp}/` exist. Safe to call on every
 * plugin apply — mkdir is recursive and idempotent.
 * @param {ReturnType<typeof resolveClipPaths>} paths
 * @param {{ mkdirSync?: typeof mkdirSync }} [fs]
 */
export function ensureClipDirs(paths, fs = { mkdirSync }) {
  fs.mkdirSync(paths.dir, { recursive: true, mode: 0o700 })
  fs.mkdirSync(paths.projectsDir, { recursive: true, mode: 0o700 })
  fs.mkdirSync(paths.exportsDir, { recursive: true, mode: 0o700 })
  fs.mkdirSync(paths.snapshotsDir, { recursive: true, mode: 0o700 })
  fs.mkdirSync(paths.tmpDir, { recursive: true, mode: 0o700 })
  return paths
}

/**
 * Project ids are filesystem names. Keep them ASCII so they stay portable.
 * @param {string} id
 */
export function assertProjectId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
    throw ClipDomainError.invalidId(`invalid project id: ${String(id)}`)
  }
  return id
}

/**
 * Refuse any path that would leave the clip storage domain.
 * Lexical resolve only — callers that need symlink safety should realpath
 * after the file exists.
 * @param {string} rootDir
 * @param {string} candidate
 */
export function assertInsideClipRoot(rootDir, candidate) {
  const root = resolve(rootDir)
  const resolved = resolve(candidate)
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw ClipDomainError.pathDenied(`path escapes clip root: ${candidate}`)
  }
  return resolved
}

/**
 * @param {ReturnType<typeof resolveClipPaths>} paths
 * @param {string} id
 */
export function projectJsonPath(paths, id) {
  assertProjectId(id)
  return assertInsideClipRoot(paths.projectsDir, join(paths.projectsDir, `${id}.json`))
}

/**
 * @param {ReturnType<typeof resolveClipPaths>} paths
 * @param {string} id
 */
export function exportMp4Path(paths, id) {
  assertProjectId(id)
  return assertInsideClipRoot(paths.exportsDir, join(paths.exportsDir, `${id}.mp4`))
}

/**
 * @param {ReturnType<typeof resolveClipPaths>} paths
 * @param {string} id
 * @param {number} timeMs
 */
export function snapshotPngPath(paths, id, timeMs) {
  assertProjectId(id)
  const stamp = Math.max(0, Math.round(Number(timeMs) || 0))
  return assertInsideClipRoot(
    paths.snapshotsDir,
    join(paths.snapshotsDir, `${id}-${stamp}.png`),
  )
}

/**
 * @param {ReturnType<typeof resolveClipPaths>} paths
 * @param {string} id
 */
export function exportJobPath(paths, id) {
  assertProjectId(id)
  return assertInsideClipRoot(paths.exportsDir, join(paths.exportsDir, `${id}.export.json`))
}
