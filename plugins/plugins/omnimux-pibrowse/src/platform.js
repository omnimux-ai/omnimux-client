import { access, readdir, readFile, stat } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PINNED_UPSTREAM } from './constants.js'

const STANDALONE_MAC_APP_AGENT = '/Applications/PiBrowse.app/Contents/MacOS/fury-agent'

/**
 * Check whether a filesystem path exists (and optionally is executable).
 * @param {string} targetPath
 * @param {number} [mode]
 * @returns {Promise<boolean>}
 */
export function pathAccessible(targetPath, mode = fsConstants.F_OK) {
  if (!targetPath || typeof targetPath !== 'string') return Promise.resolve(false)
  return access(targetPath, mode).then(() => true, () => false)
}

/**
 * Check if a path is an existing directory.
 * @param {string} targetPath
 * @returns {Promise<boolean>}
 */
export function isDirectory(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return Promise.resolve(false)
  return stat(targetPath).then((info) => info.isDirectory(), () => false)
}

/**
 * Compute platform/arch capability descriptor against pinned upstream preview assets.
 * @param {{ platform?: NodeJS.Platform, arch?: string }} [opts]
 */
export function getPlatformInfo(opts = {}) {
  const platform = opts.platform ?? process.platform
  const arch = opts.arch ?? process.arch
  const targetKey = `${platform}-${arch}`
  const prebuiltSupported = PINNED_UPSTREAM.supportedPrebuiltTargets.includes(targetKey)
  const prebuiltAssets = prebuiltSupported ? PINNED_UPSTREAM.assets[targetKey] : null

  return {
    platform,
    arch,
    targetKey,
    prebuiltSupported,
    prebuiltReleaseTag: PINNED_UPSTREAM.releaseTag,
    chromiumVersion: PINNED_UPSTREAM.chromiumVersion,
    prebuiltAssets: prebuiltAssets
      ? {
          dmg: {
            filename: prebuiltAssets.dmg.filename,
            sizeBytes: prebuiltAssets.dmg.sizeBytes,
            sha256: prebuiltAssets.dmg.sha256,
          },
          core: {
            filename: prebuiltAssets.core.filename,
            sizeBytes: prebuiltAssets.core.sizeBytes,
            sha256: prebuiltAssets.core.sha256,
          },
        }
      : null,
    unsupportedGuidance: prebuiltSupported
      ? null
      : `Upstream ${PINNED_UPSTREAM.releaseTag} preview assets are published for macOS Apple Silicon (darwin-arm64) only. Configure local fury-agent and FURY_CORE paths manually or build from ${PINNED_UPSTREAM.repo}.`,
  }
}

/**
 * Locate candidate Google Chrome WidevineCdm directories matching upstream
 * `agent/src/widevine.rs` read-only discovery logic. Never copies or redistributes CDM.
 * @param {{ platform?: NodeJS.Platform, home?: string, env?: NodeJS.ProcessEnv, candidateRoots?: string[] }} [opts]
 */
export async function probeWidevineCdm(opts = {}) {
  const platform = opts.platform ?? process.platform
  const home = opts.home ?? homedir()
  const env = opts.env ?? process.env

  const roots = Array.isArray(opts.candidateRoots)
    ? opts.candidateRoots
    : platform === 'darwin'
      ? [
          // Prefer Chrome's read-only app bundle framework first to avoid triggering
          // macOS Sequoia/Tahoe TCC "App Data" prompts against ~/Library/Application Support/Google/Chrome.
          '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Libraries/WidevineCdm',
          '/Applications/Google Chrome Canary.app/Contents/Frameworks/Google Chrome Framework.framework/Libraries/WidevineCdm',
        ]
      : platform === 'win32'
        ? [
            ...(env.LOCALAPPDATA
              ? [join(env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'WidevineCdm')]
              : []),
            'C:\\Program Files\\Google\\Chrome\\Application',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application',
          ]
        : [
            join(home, '.config', 'google-chrome', 'WidevineCdm'),
            '/opt/google/chrome/WidevineCdm',
            '/usr/lib/chromium/WidevineCdm',
          ]

  for (const root of roots) {
    if (!(await isDirectory(root))) continue
    // Either direct manifest.json or versioned subdirectory containing manifest.json
    const manifestPath = join(root, 'manifest.json')
    if (await pathAccessible(manifestPath)) {
      let version = null
      try {
        const parsed = JSON.parse(await readFile(manifestPath, 'utf8'))
        if (typeof parsed?.version === 'string' && parsed.version.trim()) {
          version = parsed.version.trim()
        }
      } catch (err) {
        opts.logger?.warn?.('omnimux-pibrowse: failed reading Widevine manifest.json version', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
      return {
        available: true,
        sourcePath: root,
        version,
        warning: null,
      }
    }
    const entries = await readdir(root, { withFileTypes: true }).catch(() => null)
    if (!entries) continue
    const versions = entries
      .filter((entry) => entry.isDirectory() && /^\d+(\.\d+)+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    for (const ver of versions) {
      const verDir = join(root, ver)
      if (
        (await pathAccessible(join(verDir, 'manifest.json'))) ||
        (await isDirectory(join(verDir, '_platform_specific')))
      ) {
        return {
          available: true,
          sourcePath: verDir,
          version: ver,
          warning: null,
        }
      }
    }
  }

  return {
    available: false,
    sourcePath: null,
    version: null,
    warning:
      'Local Google Chrome Widevine CDM was not detected. DRM-protected media sites (such as Netflix or Spotify) will be limited until Chrome is installed locally. OmniMux never bundles or redistributes Widevine CDM.',
  }
}

/**
 * Read-only detection of a standalone PiBrowse.app installation on macOS so
 * users can optionally reuse its `fury-agent` binary without touching its data dir.
 * @param {{ platform?: NodeJS.Platform, standaloneCandidates?: string[] }} [opts]
 */
export async function probeStandaloneAgent(opts = {}) {
  const platform = opts.platform ?? process.platform
  const candidates = Array.isArray(opts.standaloneCandidates)
    ? opts.standaloneCandidates
    : platform === 'darwin'
      ? [STANDALONE_MAC_APP_AGENT]
      : []

  for (const candidate of candidates) {
    if (await pathAccessible(candidate, fsConstants.X_OK)) {
      return {
        found: true,
        path: candidate,
      }
    }
  }
  return { found: false, path: null }
}

/**
 * Upstream `agent/src/main.rs::core_leaves()` executable paths inside a Core directory.
 * @param {NodeJS.Platform} [platform]
 * @returns {string[]}
 */
export function getCoreLeaves(platform = process.platform) {
  if (platform === 'darwin') {
    return [
      'PiBrowse.app/Contents/MacOS/PiBrowse',
      'Fury.app/Contents/MacOS/Fury',
      'Chromium.app/Contents/MacOS/Chromium',
    ]
  }
  if (platform === 'win32') {
    return [
      'PiBrowse/chrome.exe',
      'PiBrowse/pibrowse.exe',
      'Fury/chrome.exe',
      'Fury/fury.exe',
      'pibrowse.exe',
      'fury.exe',
      'chrome.exe',
    ]
  }
  return ['pibrowse-core', 'fury-core', 'chrome']
}

async function isAccessibleExecutableFile(candidatePath, execMode) {
  const info = await stat(candidatePath).catch(() => null)
  if (!info || !info.isFile()) return false
  return pathAccessible(candidatePath, execMode)
}

/**
 * Resolve a user-supplied or managed Core path (executable file, macOS `.app` bundle,
 * or `core.bundle` root directory) to the exact Chromium executable expected by
 * upstream `fury-agent` (`FURY_CORE` / `core_binary()`).
 *
 * @param {string | null | undefined} targetPath
 * @param {NodeJS.Platform} [platform]
 * @returns {Promise<string | null>}
 */
export async function resolveCoreExecutable(targetPath, platform = process.platform) {
  if (!targetPath || typeof targetPath !== 'string') return null
  const trimmed = targetPath.trim()
  if (!trimmed) return null
  const info = await stat(trimmed).catch(() => null)
  if (!info) return null

  const execMode = platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK
  if (info.isFile()) {
    return (await pathAccessible(trimmed, execMode)) ? trimmed : null
  }
  if (!info.isDirectory()) return null

  const directCandidates =
    platform === 'darwin'
      ? [
          'Contents/MacOS/PiBrowse',
          'Contents/MacOS/Fury',
          'Contents/MacOS/Chromium',
          ...getCoreLeaves(platform),
        ]
      : getCoreLeaves(platform)

  for (const rel of directCandidates) {
    const candidate = join(trimmed, rel)
    if (await isAccessibleExecutableFile(candidate, execMode)) {
      return candidate
    }
  }

  // Match upstream `install_core::find_core()` one-level-down archive wrapper search
  if (!(platform === 'darwin' && trimmed.endsWith('.app'))) {
    const entries = await readdir(trimmed, { withFileTypes: true }).catch(() => null)
    if (entries) {
      const leaves = getCoreLeaves(platform)
      for (const entry of entries) {
        if ((!entry.isDirectory() && !entry.isSymbolicLink()) || entry.name.startsWith('.')) continue
        for (const rel of leaves) {
          const candidate = join(trimmed, entry.name, rel)
          if (await isAccessibleExecutableFile(candidate, execMode)) {
            return candidate
          }
        }
      }
    }
  }

  return null
}

/**
 * Inspect whether Chromium Core is installed inside the isolated `FURY_HOME/core.bundle`
 * (or legacy `core`) or via an explicit `corePath` override, verifying that a real
 * upstream executable leaf exists.
 * @param {{ dataDir: string, corePath?: string | null, platform?: NodeJS.Platform }} opts
 */
export async function probeCoreInstallation(opts) {
  const platform = opts.platform ?? process.platform
  if (opts.corePath) {
    const resolved = await resolveCoreExecutable(opts.corePath, platform)
    return {
      installed: Boolean(resolved),
      source: resolved ? 'custom' : 'missing',
      path: resolved || opts.corePath,
      configuredPath: opts.corePath,
    }
  }

  const coreBundleRoot = join(opts.dataDir, 'core.bundle')
  const legacyCoreRoot = join(opts.dataDir, 'core')

  const bundleExe = await resolveCoreExecutable(coreBundleRoot, platform)
  if (bundleExe) {
    return {
      installed: true,
      source: 'managed',
      path: bundleExe,
    }
  }

  const legacyExe = await resolveCoreExecutable(legacyCoreRoot, platform)
  if (legacyExe) {
    return {
      installed: true,
      source: 'managed',
      path: legacyExe,
    }
  }

  return { installed: false, source: 'missing', path: coreBundleRoot }
}

/**
 * Resolve the active `fury-agent` binary path in priority order:
 * 1. Explicit configured `agentPath`
 * 2. Managed binary under `$DSH_HOME/omnimux/pibrowse/bin/fury-agent`
 * 3. Optional standalone `/Applications/PiBrowse.app/Contents/MacOS/fury-agent` (only when reuse enabled or as suggestion)
 *
 * @param {{ paths: ReturnType<import('./paths.js').resolvePibrowsePaths>, config: Record<string, unknown>, platform?: NodeJS.Platform, standaloneCandidates?: string[] }} opts
 */
export async function resolveAgentBinary(opts) {
  const execMode = (opts.platform ?? process.platform) === 'win32' ? fsConstants.F_OK : fsConstants.X_OK
  const configured = typeof opts.config?.agentPath === 'string' && opts.config.agentPath.trim()
    ? opts.config.agentPath.trim()
    : null

  if (configured) {
    const exists = await pathAccessible(configured, execMode)
    return {
      installed: exists,
      source: exists ? 'custom' : 'missing',
      path: configured,
      standaloneCandidate: null,
    }
  }

  if (await pathAccessible(opts.paths.managedAgentPath, execMode)) {
    return {
      installed: true,
      source: 'managed',
      path: opts.paths.managedAgentPath,
      standaloneCandidate: null,
    }
  }

  const standalone = await probeStandaloneAgent({
    platform: opts.platform,
    standaloneCandidates: opts.standaloneCandidates,
  })
  return {
    installed: false,
    source: 'missing',
    path: null,
    standaloneCandidate: standalone.found ? standalone.path : null,
  }
}
