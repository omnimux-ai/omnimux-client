/** Build provenance: record the exact source tree behind a packaged app bundle. */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Quiet git invocation; returns trimmed stdout or null on failure. */
function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0 || result.error) return null
  const out = result.stdout.trim()
  return out.length > 0 ? out : null
}

/** Tracked-file working tree status; null when git cannot report it. */
function gitStatus(cwd) {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd, encoding: 'utf8' })
  if (result.status !== 0 || result.error) return null
  return result.stdout.trim()
}

/** This fork repository root (the app directory above dsh-plugin-desktop/). */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Snapshot the current source identity of this build.
 * @param channel - Build channel label, e.g. `package-dir`, `dist:mac`, or `release`.
 * @param {{ packageDir?: string, repoRoot?: string }} [options] - Optional package directory and repository root overrides.
 */
export function currentBuildInfo(channel, options = {}) {
  const root = options.repoRoot ?? repoRoot
  const packageDir = options.packageDir ?? 'dsh-plugin-desktop'
  const desktopPackage = JSON.parse(
    readFileSync(join(root, packageDir, 'package.json'), 'utf8'),
  )
  const dshSpec = desktopPackage.dependencies?.['@deepseek-ai/dsh'] ?? null
  const status = gitStatus(root)
  if (status === null) {
    throw new Error('build-info: cannot inspect git status; refusing to record build provenance')
  }
  return {
    product: desktopPackage.build?.productName ?? 'OmniMux',
    version: desktopPackage.version,
    channel,
    builtAt: new Date().toISOString(),
    repo: {
      branch: git(root, 'branch', '--show-current'),
      commit: git(root, 'rev-parse', 'HEAD'),
      commitShort: git(root, 'rev-parse', '--short', 'HEAD'),
      dirty: status.length > 0,
      // Remote URLs are deliberately not recorded: a public DMG must never
      // carry a local SSH alias, a private fork address, or userinfo/PATs.
    },
    upstream: {
      main: git(root, 'rev-parse', '--short', 'origin/main'),
      master: git(root, 'rev-parse', '--short', 'origin/master'),
    },
    dsh: {
      packageSpec: dshSpec,
      submodule: git(join(root, 'deepseek-harness'), 'rev-parse', '--short', 'HEAD'),
    },
  }
}

/**
 * Write `build-info.json` into an app bundle's Resources.
 * @param appPath - Path to the `.app` bundle.
 * @param channel - Build channel label.
 * @param {{ packageDir?: string, repoRoot?: string }} [options] - Optional package directory and repository root overrides.
 * @returns The recorded snapshot.
 */
export function writeAppBuildInfo(appPath, channel = 'local', options = {}) {
  const info = currentBuildInfo(channel, options)
  const resources = join(appPath, 'Contents', 'Resources')
  writeFileSync(join(resources, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`)
  return info
}

// CLI mode: `node scripts/build-info.mjs <appPath> [channel] [packageDir]`
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const appPath = process.argv[2]
  if (appPath === undefined) {
    console.error('usage: build-info.mjs <appPath> [channel] [packageDir]')
    process.exit(1)
  }
  console.log(JSON.stringify(writeAppBuildInfo(appPath, process.argv[3] ?? 'cli', {
    packageDir: process.argv[4] ?? 'dsh-plugin-desktop',
  }), null, 2))
}
