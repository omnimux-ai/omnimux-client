import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, normalize, resolve } from 'node:path'
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
 * Compute deterministic, short-path local IPC socket endpoint for a given dataDir.
 * macOS Unix domain socket sun_path limit is 104 bytes; placing the socket in
 * os.tmpdir() with an 8-hex hash guarantees < 60 bytes regardless of DSH_HOME depth.
 *
 * @param {string} dataDir
 * @param {{ platform?: NodeJS.Platform, socketDir?: string }} [opts]
 * @returns {string}
 */
export function computeSocketPath(dataDir, opts = {}) {
  const platform = opts.platform ?? process.platform
  const hash8 = createHash('sha256').update(resolve(dataDir)).digest('hex').slice(0, 8)
  if (platform === 'win32') {
    return `\\\\.\\pipe\\omx-pibrowse-${hash8}`
  }
  const baseDir = opts.socketDir || tmpdir()
  const candidate = join(baseDir, `omx-pibrowse-${hash8}.sock`)
  if (Buffer.byteLength(candidate, 'utf8') >= 100) {
    return join('/tmp', `omx-pb-${hash8}.sock`)
  }
  return candidate
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
export async function ensurePibrowseDirs(paths) {
  await Promise.all([
    mkdir(paths.rootDir, { recursive: true, mode: 0o700 }),
    mkdir(paths.binDir, { recursive: true, mode: 0o700 }),
    mkdir(paths.dataDir, { recursive: true, mode: 0o700 }),
    mkdir(paths.downloadsDir, { recursive: true, mode: 0o700 }),
  ])
}
