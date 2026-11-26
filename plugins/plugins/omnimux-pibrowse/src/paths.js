import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path'
import { PibrowseError } from './errors.js'

/**
 * Resolve DSH home directory following OmniMux storage convention.
 * @param {{ home?: string, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {string}
 */
export function resolveDshHome(opts = {}) {
  const env = opts.env ?? process.env
  const raw = opts.home || env.DSH_HOME || join(homedir(), '.dsh')
  return resolve(raw)
}

/**
 * Resolve the current effective UID on POSIX systems (returns null on Windows).
 * @param {{ platform?: NodeJS.Platform, uid?: number | null }} [opts]
 * @returns {number | null}
 */
export function resolveCurrentUid(opts = {}) {
  const platform = opts.platform ?? process.platform
  if (platform === 'win32') return null
  if (typeof opts.uid === 'number') return opts.uid
  if (opts.uid === null) return null
  if (typeof process.geteuid === 'function') return process.geteuid()
  if (typeof process.getuid === 'function') return process.getuid()
  return null
}

/**
 * Compute deterministic, short-path local IPC socket endpoint for a given dataDir.
 * macOS Unix domain socket sun_path limit is 104 bytes; placing the socket inside a
 * per-user 0700 directory (`omx-pb-<uid>`) with an 8-hex hash guarantees < 100 bytes
 * regardless of DSH_HOME depth while preventing cross-user socket hijacking in shared tmp dirs.
 *
 * @param {string} dataDir
 * @param {{ platform?: NodeJS.Platform, socketDir?: string, uid?: number | null }} [opts]
 * @returns {string}
 */
export function computeSocketPath(dataDir, opts = {}) {
  const platform = opts.platform ?? process.platform
  const hash8 = createHash('sha256').update(resolve(dataDir)).digest('hex').slice(0, 8)
  if (platform === 'win32') {
    return `\\\\.\\pipe\\omx-pibrowse-${hash8}`
  }
  if (opts.socketDir) {
    const candidate = join(opts.socketDir, `omx-pibrowse-${hash8}.sock`)
    if (Buffer.byteLength(candidate, 'utf8') < 100) {
      return candidate
    }
  }
  const uid = resolveCurrentUid({ platform, uid: opts.uid })
  if (uid === null) {
    throw new PibrowseError('insecure-socket', 'Unable to determine POSIX UID for private IPC socket directory')
  }
  const userDirName = `omx-pb-${uid}`
  const xdgRuntimeDir = platform === 'linux' ? (opts.env ?? process.env).XDG_RUNTIME_DIR : undefined
  if (typeof xdgRuntimeDir === 'string' && xdgRuntimeDir.trim() && isAbsolute(xdgRuntimeDir.trim())) {
    const xdgCandidate = join(xdgRuntimeDir.trim(), userDirName, `pb-${hash8}.sock`)
    if (Buffer.byteLength(xdgCandidate, 'utf8') < 100) {
      return xdgCandidate
    }
  }
  const baseDir = join(tmpdir(), userDirName)
  const candidate = join(baseDir, `pb-${hash8}.sock`)
  if (Buffer.byteLength(candidate, 'utf8') >= 100) {
    return join('/tmp', userDirName, `pb-${hash8}.sock`)
  }
  return candidate
}

/**
 * Verify that the Unix socket parent directory is a real directory owned by the
 * current UID with strictly private `0700` permissions (no group/other access),
 * and if the socket path itself exists, that it is a real non-symlink socket owned
 * by the current UID without group/world write permissions.
 *
 * @param {string} socketPath
 * @param {{ platform?: NodeJS.Platform, uid?: number | null, allowMissingDir?: boolean, lstatImpl?: typeof lstat }} [opts]
 * @returns {Promise<{ exists: boolean, dirExists?: boolean, dirMode?: number, socketMode?: number }>}
 */
export async function verifySocketTrust(socketPath, opts = {}) {
  const platform = opts.platform ?? process.platform
  if (platform === 'win32') {
    return { exists: false, dirExists: true }
  }
  const lstatFn = opts.lstatImpl ?? lstat
  const expectedUid = resolveCurrentUid({ platform, uid: opts.uid })
  const socketDir = dirname(socketPath)

  let dirStat
  try {
    dirStat = await lstatFn(socketDir)
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined
    if (code === 'ENOENT' && opts.allowMissingDir === true) {
      return { exists: false, dirExists: false }
    }
    throw new PibrowseError(
      'insecure-socket',
      `IPC socket directory does not exist or cannot be inspected: ${socketDir}`,
      { code },
    )
  }
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
    throw new PibrowseError('insecure-socket', `IPC socket directory must be a non-symlink directory: ${socketDir}`)
  }
  if (expectedUid !== null && dirStat.uid !== expectedUid) {
    throw new PibrowseError(
      'insecure-socket',
      `IPC socket directory owner UID (${dirStat.uid}) does not match current user (${expectedUid})`,
    )
  }
  const dirMode = dirStat.mode & 0o777
  if ((dirMode & 0o077) !== 0) {
    throw new PibrowseError(
      'insecure-socket',
      `IPC socket directory permissions (0${dirMode.toString(8)}) must not allow group or world access (expected 0700)`,
    )
  }

  let sockStat = null
  try {
    sockStat = await lstatFn(socketPath)
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return { exists: false, dirExists: true, dirMode }
    }
    throw new PibrowseError('insecure-socket', `Failed to inspect IPC socket path: ${socketPath}`)
  }

  if (sockStat.isSymbolicLink() || !sockStat.isSocket()) {
    throw new PibrowseError('insecure-socket', `IPC socket path must be a non-symlink Unix domain socket: ${socketPath}`)
  }
  if (expectedUid !== null && sockStat.uid !== expectedUid) {
    throw new PibrowseError(
      'insecure-socket',
      `IPC socket owner UID (${sockStat.uid}) does not match current user (${expectedUid})`,
    )
  }
  const socketMode = sockStat.mode & 0o777
  if ((socketMode & 0o022) !== 0) {
    throw new PibrowseError(
      'insecure-socket',
      `IPC socket permissions (0${socketMode.toString(8)}) must not allow group or world write access`,
    )
  }
  return { exists: true, dirExists: true, dirMode, socketMode }
}

/**
 * Tighten a newly spawned sidecar socket to `0600` after verifying its parent dir
 * is private `0700` and the socket itself is a non-symlink socket owned by the
 * current UID (preventing Linux UPG `umask 0002` `0775` sockets from tripping checks).
 *
 * @param {string} socketPath
 * @param {{ platform?: NodeJS.Platform, uid?: number | null, lstatImpl?: typeof lstat, chmodImpl?: typeof chmod }} [opts]
 */
export async function hardenOwnedSocketPermissions(socketPath, opts = {}) {
  const platform = opts.platform ?? process.platform
  if (platform === 'win32') return false
  const lstatFn = opts.lstatImpl ?? lstat
  const chmodFn = opts.chmodImpl ?? chmod
  const expectedUid = resolveCurrentUid({ platform, uid: opts.uid })
  const socketDir = dirname(socketPath)

  let dirStat
  try {
    dirStat = await lstatFn(socketDir)
  } catch {
    throw new PibrowseError('insecure-socket', `IPC socket directory cannot be inspected: ${socketDir}`)
  }
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory() || (expectedUid !== null && dirStat.uid !== expectedUid) || (dirStat.mode & 0o077) !== 0) {
    throw new PibrowseError('insecure-socket', `IPC socket directory failed ownership/permission check: ${socketDir}`)
  }

  let sockStat
  try {
    sockStat = await lstatFn(socketPath)
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return false
    throw new PibrowseError('insecure-socket', `Failed to inspect IPC socket path: ${socketPath}`)
  }
  if (sockStat.isSymbolicLink() || !sockStat.isSocket()) {
    throw new PibrowseError('insecure-socket', `IPC socket path must be a non-symlink Unix domain socket: ${socketPath}`)
  }
  if (expectedUid !== null && sockStat.uid !== expectedUid) {
    throw new PibrowseError('insecure-socket', `IPC socket owner UID (${sockStat.uid}) does not match current user (${expectedUid})`)
  }
  if ((sockStat.mode & 0o077) !== 0) {
    await chmodFn(socketPath, 0o600)
  }
  return true
}

/**
 * Create (atomically with `0700` mode, never blindly chmod-ing an unverified path)
 * and verify the private socket parent directory on POSIX.
 *
 * @param {string} socketPath
 * @param {{ platform?: NodeJS.Platform, uid?: number | null, mkdirImpl?: typeof mkdir, lstatImpl?: typeof lstat }} [opts]
 */
export async function ensurePrivateSocketDir(socketPath, opts = {}) {
  const platform = opts.platform ?? process.platform
  if (platform === 'win32') return
  const mkdirFn = opts.mkdirImpl ?? mkdir
  const lstatFn = opts.lstatImpl ?? lstat
  const socketDir = dirname(socketPath)
  const expectedUid = resolveCurrentUid({ platform, uid: opts.uid })

  try {
    await mkdirFn(socketDir, { mode: 0o700 })
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined
    if (code === 'ENOENT') {
      await mkdirFn(dirname(socketDir), { recursive: true })
      try {
        await mkdirFn(socketDir, { mode: 0o700 })
      } catch (retryErr) {
        const retryCode = retryErr && typeof retryErr === 'object' && 'code' in retryErr ? retryErr.code : undefined
        if (retryCode !== 'EEXIST') {
          throw new PibrowseError('insecure-socket', `Failed to create private IPC socket directory: ${socketDir}`, { code: retryCode })
        }
      }
    } else if (code !== 'EEXIST') {
      throw new PibrowseError('insecure-socket', `Failed to create private IPC socket directory: ${socketDir}`, { code })
    }
  }

  let dirStat
  try {
    dirStat = await lstatFn(socketDir)
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined
    throw new PibrowseError('insecure-socket', `Failed to inspect IPC socket directory: ${socketDir}`, { code })
  }
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
    throw new PibrowseError('insecure-socket', `IPC socket directory must be a non-symlink directory: ${socketDir}`)
  }
  if (expectedUid !== null && dirStat.uid !== expectedUid) {
    throw new PibrowseError(
      'insecure-socket',
      `IPC socket directory owner UID (${dirStat.uid}) does not match current user (${expectedUid})`,
    )
  }
  const dirMode = dirStat.mode & 0o777
  if ((dirMode & 0o077) !== 0) {
    throw new PibrowseError(
      'insecure-socket',
      `IPC socket directory permissions (0${dirMode.toString(8)}) must not allow group or world access (expected 0700)`,
    )
  }
}

/**
 * Validate a user-supplied filesystem path (reject null bytes, traversal segments, empty).
 * @param {unknown} raw
 * @param {{ allowRelative?: boolean, label?: string }} [opts]
 * @returns {string}
 */
export function validateUserPath(raw, opts = {}) {
  const label = opts.label || 'path'
  if (typeof raw !== 'string') {
    throw new PibrowseError('invalid-path', `${label} must be a non-empty string`)
  }
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new PibrowseError('invalid-path', `${label} must not be empty`)
  }
  if (trimmed.includes('\0')) {
    throw new PibrowseError('invalid-path', `${label} contains forbidden null byte`)
  }
  const segments = trimmed.split(/[\\/]+/)
  if (segments.includes('..')) {
    throw new PibrowseError('invalid-path', `${label} must not contain parent traversal (..)`)
  }
  if (!opts.allowRelative && !isAbsolute(trimmed)) {
    throw new PibrowseError('invalid-path', `${label} must be an absolute path`)
  }
  return normalize(trimmed)
}

/**
 * Resolve the isolated storage directory tree under `$DSH_HOME/omnimux/pibrowse/`.
 * Never touches standalone PiBrowse user data (`~/Library/Application Support/Fury`).
 *
 * @param {{ home?: string, rootDir?: string, socketPath?: string, socketDir?: string, platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv }} [opts]
 */
export function resolvePibrowsePaths(opts = {}) {
  const platform = opts.platform ?? process.platform
  const dshHome = resolveDshHome(opts)
  const rootDir = opts.rootDir ? resolve(opts.rootDir) : join(dshHome, 'omnimux', 'pibrowse')
  const binDir = join(rootDir, 'bin')
  const dataDir = join(rootDir, 'data')
  const downloadsDir = join(rootDir, 'downloads')
  const agentBinaryName = platform === 'win32' ? 'fury-agent.exe' : 'fury-agent'
  const managedAgentPath = join(binDir, agentBinaryName)
  const configFile = join(rootDir, 'config.json')
  const teamSessionFile = join(rootDir, 'team-session.json')
  const socketPath = opts.socketPath || computeSocketPath(dataDir, { platform, socketDir: opts.socketDir })

  return Object.freeze({
    dshHome,
    rootDir,
    binDir,
    dataDir,
    downloadsDir,
    managedAgentPath,
    configFile,
    teamSessionFile,
    socketPath,
  })
}

/**
 * Ensure isolated storage directories exist with restricted permissions.
 * @param {ReturnType<typeof resolvePibrowsePaths>} paths
 */
export async function ensurePibrowseDirs(paths, opts = {}) {
  await Promise.all([
    mkdir(paths.rootDir, { recursive: true, mode: 0o700 }),
    mkdir(paths.binDir, { recursive: true, mode: 0o700 }),
    mkdir(paths.dataDir, { recursive: true, mode: 0o700 }),
    mkdir(paths.downloadsDir, { recursive: true, mode: 0o700 }),
    ensurePrivateSocketDir(paths.socketPath, opts),
  ])
}
