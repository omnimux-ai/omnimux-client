/** Fail-loud verification that a packaged app was built from origin/main and recorded clean provenance. */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Repository root above the desktop package. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Quiet git invocation; returns trimmed stdout or null on failure. */
function git(cwd: string, ...args: string[]): string | null {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0 || result.error) return null
  const out = result.stdout.trim()
  return out.length > 0 ? out : null
}

/** Tracked-file working tree status; null when git cannot report it. */
function gitStatus(cwd: string): string | null {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd, encoding: 'utf8' })
  if (result.status !== 0 || result.error) return null
  return result.stdout.trim()
}

/** Build-info shape written by `build-info.mjs`. */
interface BuildInfo {
  readonly product?: unknown
  readonly version?: unknown
  readonly channel?: unknown
  readonly builtAt?: unknown
  readonly repo?: {
    readonly commit?: unknown
    readonly commitShort?: unknown
    readonly dirty?: unknown
    readonly origin?: unknown
  }
}

/** Options controlling which package tree and commit the release must match. */
export interface VerifyBuildInfoOptions {
  /** Package directory whose version must match the packaged app. */
  readonly packageDir?: string
  /** Repository root containing `.git`; defaults to the repo above this script. */
  readonly repoRoot?: string
  /** Explicit expected commit; defaults to local HEAD. */
  readonly expectedCommit?: string
}

/**
 * Verify a packaged app's build-info against origin/main and its package version.
 * @param appPath - Path to the packaged `.app` bundle.
 * @param options - Package directory and repository root overrides.
 * @returns Parsed build-info.
 */
export function verifyAppBuildInfo(appPath: string, options: VerifyBuildInfoOptions = {}): BuildInfo {
  const root = options.repoRoot ?? repoRoot
  const packageDir = options.packageDir ?? 'dsh-plugin-desktop'
  const expectedCommit = options.expectedCommit ?? git(root, 'rev-parse', 'HEAD')
  const originMain = git(root, 'rev-parse', 'origin/main')
  if (expectedCommit === null) throw new Error('release build-info check: cannot resolve git HEAD')
  if (originMain === null) throw new Error('release build-info check: cannot resolve origin/main')
  if (expectedCommit !== originMain) {
    throw new Error(`release build-info check: HEAD ${expectedCommit} is not origin/main ${originMain}`)
  }
  const status = gitStatus(root)
  if (status === null) throw new Error('release build-info check: cannot inspect git status')
  if (status.length > 0) {
    throw new Error(`release build-info check: tracked worktree is dirty:\n${status}`)
  }

  const buildInfoPath = join(appPath, 'Contents', 'Resources', 'build-info.json')
  let parsed: BuildInfo
  try {
    parsed = JSON.parse(readFileSync(buildInfoPath, 'utf8')) as BuildInfo
  } catch (cause) {
    throw new Error(`release build-info check: cannot read ${buildInfoPath}`, { cause })
  }
  const expectedVersion = (JSON.parse(readFileSync(join(root, packageDir, 'package.json'), 'utf8')) as { version?: unknown }).version
  if (parsed.product !== 'OmniMux') throw new Error(`release build-info check: unexpected product ${String(parsed.product)}`)
  if (parsed.channel !== 'release') throw new Error(`release build-info check: channel must be release, got ${String(parsed.channel)}`)
  if (parsed.version !== expectedVersion) {
    throw new Error(`release build-info check: version ${String(parsed.version)} does not match ${String(expectedVersion)}`)
  }
  if (parsed.repo?.commit !== expectedCommit) {
    throw new Error(`release build-info check: commit ${String(parsed.repo?.commit)} does not match HEAD ${expectedCommit}`)
  }
  if (parsed.repo?.dirty !== false) throw new Error('release build-info check: build tree was recorded as dirty')
  console.log(`Verified release build-info: ${String(parsed.product)} ${String(parsed.version)} ${expectedCommit}`)
  return parsed
}
