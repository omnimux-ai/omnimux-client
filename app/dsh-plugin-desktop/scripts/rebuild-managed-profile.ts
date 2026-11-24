#!/usr/bin/env node
/** Rebuild a Profile or switch shared Dev using one frozen OmniMux app. */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDesktopDataDirectory } from '../src/desktop-data-directory.ts'
import { installDesktopPnpmRuntime } from '../src/desktop-runtime-environment.ts'
import {
  acceptDevUpgrade,
  inspectDevUpgrade,
  recoverDevFromArchive,
  upgradeDevWithRecovery,
  type DevUpgradePaths,
} from '../src/dev-upgrade-transaction.ts'
import {
  MANAGED_GRAPH_ENTRIES,
  assertPhysicalProfileBoundary,
  inspectDevProfileSources,
  prepareManagedProfile,
  rebuildManagedProfile,
  type ManagedProfileRebuildOptions,
} from '../src/managed-profile.ts'
import { materializeProfile } from '../src/profile-materializer.ts'
import { readOwnedPackages } from '../src/preset-profile.ts'
import {
  nextCandidateLayout,
  prepareNextManagedProfileGraph,
  readNextDevBuild,
  writeDesktopNextActiveProfile,
} from './next-profile-upgrade.ts'

/** Homes whose managed Profiles this rebuild can establish. */
const PROFILE_TARGETS = Object.freeze({
  dev: join(homedir(), '.omnimux-dev'),
  prod: join(homedir(), '.omnimux'),
})
const SHARED_DEV_APP_PATH = '/Applications/OmniMux Dev.app'
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
type ProfileTarget = keyof typeof PROFILE_TARGETS

type Arguments =
  | { readonly command: 'rebuild'; readonly target: ProfileTarget; readonly app: string }
  | { readonly command: 'upgrade-dev'; readonly app: string; readonly recoveryDir: string; readonly dryRun: boolean }
  | { readonly command: 'recover-dev' | 'accept-dev'; readonly recoveryDir: string }

function usage(): never {
  throw new Error([
    'usage: yarn omnimux:profile rebuild --target dev|prod --app <frozen-candidate.app>',
    '       yarn omnimux:profile upgrade-dev --app <frozen-dev.app> --recovery-dir <nas-batch-dir> [--dry-run]',
    '       yarn omnimux:profile recover-dev|accept-dev --recovery-dir <nas-batch-dir>',
  ].join('\n'))
}

export function parseProfileArguments(argv: readonly string[]): Arguments {
  const command = argv[0]
  if (command !== 'rebuild' && command !== 'upgrade-dev' && command !== 'recover-dev' && command !== 'accept-dev') usage()
  const flags = new Map<string, string>()
  let dryRun = false
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index]!
    if (flag === '--dry-run' && command === 'upgrade-dev' && !dryRun) {
      dryRun = true
      continue
    }
    const value = argv[index + 1]
    if (flags.has(flag) || value === undefined || value.startsWith('--')) usage()
    if (flag === '--target' && command === 'rebuild'
      || flag === '--app' && (command === 'rebuild' || command === 'upgrade-dev')
      || flag === '--recovery-dir' && command !== 'rebuild') {
      flags.set(flag, value)
    } else {
      usage()
    }
    index += 1
  }

  const recoveryDir = flags.get('--recovery-dir')
  if (command !== 'rebuild' && (recoveryDir === undefined || !isAbsolute(recoveryDir))) usage()
  if (command === 'recover-dev' || command === 'accept-dev') return { command, recoveryDir: recoveryDir! }
  const app = flags.get('--app')
  if (app === undefined || !isAbsolute(app) || !app.endsWith('.app')) usage()
  if (command === 'upgrade-dev') return { command, app, recoveryDir: recoveryDir!, dryRun }
  const target = flags.get('--target')
  if (target !== 'dev' && target !== 'prod') usage()
  return { command, target, app }
}

export function candidateLayout(app: string): {
  readonly executable: string
  readonly presetDir: string
  readonly pnpmBinPath: string
} {
  const executableDir = join(app, 'Contents', 'MacOS')
  const executables = readdirSync(executableDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => join(executableDir, entry.name))
  if (executables.length !== 1) {
    throw new Error(`candidate App must contain exactly one main executable in ${executableDir}`)
  }
  for (const name of ['app', 'app.asar.unpacked']) {
    const packageRoot = join(app, 'Contents', 'Resources', name)
    const presetDir = join(packageRoot, 'preset')
    const pnpmBinPath = join(packageRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
    if ([join(presetDir, 'owned-packages.json'), join(presetDir, 'plugins'), pnpmBinPath].every(existsSync)) {
      return { executable: executables[0]!, presetDir, pnpmBinPath }
    }
  }
  throw new Error('candidate App must contain a complete preset and pnpm under Resources/app or Resources/app.asar.unpacked')
}

function listPackedFiles(pnpmCommand: string, sourceDir: string): string[] {
  // Packages that ship through a staged "publish directory" (yarn monorepo
  // convention, e.g. @smithy/*) point pnpm's packer at <dir>/.release/package,
  // which a materialized snapshot never contains. The candidate directory is a
  // disposable copy, so the publishConfig can be dropped from the copy before
  // asking pnpm to enumerate its files.
  const manifestPath = join(sourceDir, 'package.json')
  let manifest: Record<string, unknown> | undefined
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  } catch {
    manifest = undefined
  }
  if (manifest !== undefined && manifest['publishConfig'] !== undefined) {
    delete manifest['publishConfig']
    writeFileSync(manifestPath, JSON.stringify(manifest))
  }
  const result = spawnSync(
    pnpmCommand,
    // A managed plugin may pin its own pnpm release (devEngines/packageManager).
    // The pack runs under the app's bundled pnpm, and its only purpose here is to
    // enumerate the files a package would ship, so a version mismatch must not
    // abort the rebuild (it did for omnimux-studio, pinned to pnpm 11.7.0).
    ['--config.ignore-scripts=true', '--pm-on-fail=ignore', 'pack', '--dry-run', '--json'],
    { cwd: sourceDir, env: { ...process.env, CI: 'true' }, encoding: 'utf8', timeout: 30_000 },
  )
  if (result.status !== 0) {
    throw new Error(`pnpm pack list failed for ${sourceDir}: ${result.stderr || result.stdout || String(result.error)}`)
  }
  const parsed = JSON.parse(result.stdout) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`pnpm returned an invalid pack list for ${sourceDir}`)
  }
  const files = (parsed as { files?: unknown }).files
  if (!Array.isArray(files) || files.some(file => {
    return typeof file !== 'object' || file === null || Array.isArray(file)
      || typeof (file as { path?: unknown }).path !== 'string'
  })) {
    throw new Error(`pnpm returned an invalid packed files array for ${sourceDir}`)
  }
  return files.map(file => (file as { path: string }).path)
}

async function withProfileBuilder<T>(
  app: string,
  homeDir: string,
  profileDir: string,
  build: (options: ManagedProfileRebuildOptions) => Promise<T>,
  isolatedInstall = false,
): Promise<T> {
  const electronVersion = process.versions.electron
  if (electronVersion === undefined) {
    throw new Error('profile rebuild must run through the frozen candidate App in ELECTRON_RUN_AS_NODE mode')
  }
  const layout = candidateLayout(app)
  if (realpathSync(process.execPath) !== realpathSync(layout.executable)) {
    throw new Error(`profile rebuild is running through ${process.execPath}, not frozen candidate ${layout.executable}`)
  }
  assertPhysicalProfileBoundary(profileDir)
  const runtimeDir = mkdtempSync(join(tmpdir(), 'omnimux-profile-rebuild-runtime-'))
  try {
    const runtime = installDesktopPnpmRuntime({
      platform: process.platform,
      appExecutable: layout.executable,
      pnpmBinPath: layout.pnpmBinPath,
      electronVersion,
      stateDir: runtimeDir,
      environment: process.env,
    })
    try {
      return await build({
        profileDir,
        presetDir: layout.presetDir,
        ownedPackages: readOwnedPackages(layout.presetDir),
        packedFiles: async sourceDir => listPackedFiles(runtime.pnpmShimPath, sourceDir),
        materialize: async candidateProfileDir => {
          await materializeProfile({
            appExecutable: layout.executable,
            clearEnvironmentPath: runtime.clearEnvironmentPath,
            pnpmBinPath: layout.pnpmBinPath,
            nodeBinDir: runtime.nodeBinDir,
            nodeShimPath: runtime.nodeShimPath,
            homeDir: isolatedInstall ? runtimeDir : homeDir,
            profileDir: candidateProfileDir,
            electronVersion,
            updateLockfile: true,
          })
        },
      })
    } finally {
      runtime.dispose()
    }
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true })
  }
}

function sharedDevPaths(checkActiveHome = true): DevUpgradePaths {
  if (process.platform !== 'darwin') throw new Error('Shared Dev migration requires macOS')
  const homeDir = PROFILE_TARGETS.dev
  const userDataDir = join(homedir(), 'Library', 'Application Support', 'OmniMux-Dev')
  if (checkActiveHome && resolveDesktopDataDirectory(userDataDir, homeDir, 'default').homeDir !== homeDir) {
    throw new Error('Shared Dev migration requires the default Dev data directory')
  }
  return { appPath: SHARED_DEV_APP_PATH, homeDir, userDataDir }
}

export function devAppIsRunning(processPaths: string, appPath: string): boolean {
  const appContents = `${appPath}${sep}Contents${sep}`
  return processPaths.split('\n').some(line => line.trimStart().startsWith(appContents))
}

function assertDevStopped(paths: DevUpgradePaths): void {
  const result = spawnSync('/bin/ps', ['-axww', '-o', 'comm='], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  if (result.status !== 0) throw new Error('Cannot verify that the shared Dev App and its helpers have exited')
  if (devAppIsRunning(result.stdout, paths.appPath)) {
    throw new Error('Quit shared OmniMux Dev and wait for its Host and helpers to exit before proceeding')
  }
}

function readDevBuild(app: string, presetDir: string): { version: string; commit: string } {
  const channel = JSON.parse(readFileSync(join(presetDir, 'plugins', 'omnimux', 'src', 'release-channel.json'), 'utf8')) as { channel?: unknown }
  const build = JSON.parse(readFileSync(join(app, 'Contents', 'Resources', 'build-info.json'), 'utf8')) as {
    channel?: unknown
    version?: unknown
    repo?: { commit?: unknown; dirty?: unknown }
  }
  if (channel.channel !== 'development' || build.channel !== 'package-dev' || typeof build.version !== 'string'
    || build.repo?.dirty !== false || typeof build.repo.commit !== 'string' || !/^[a-f0-9]{40}$/u.test(build.repo.commit)) {
    throw new Error('Use a signed development App produced by package:dev from a clean commit')
  }
  if (spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]).status !== 0) {
    throw new Error('Candidate Dev App signature verification failed')
  }
  return { version: build.version, commit: build.repo.commit }
}

function assertMergedBuild(commit: string): void {
  const result = spawnSync('git', ['-C', REPOSITORY_ROOT, 'merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main'])
  if (result.status !== 0) throw new Error('Fetch origin/main and use a Dev App built from an already merged commit')
}

export async function runDevProfileUpgrade(
  args: Pick<Extract<Arguments, { command: 'upgrade-dev' }>, 'app' | 'recoveryDir' | 'dryRun'>,
  paths: DevUpgradePaths = sharedDevPaths(),
): Promise<unknown> {
  const app = realpathSync(args.app)
  if (app === paths.appPath) throw new Error('Use the frozen build outside the shared Dev installation')
  const profileDir = join(paths.homeDir, 'profiles', 'omnimux')
  const recovery = { paths, recoveryDir: args.recoveryDir }
  const preflight = inspectDevUpgrade(recovery)

  const nextLayout = nextCandidateLayout(app)
  if (nextLayout !== null) {
    const build = readNextDevBuild(app)
    if (paths.appPath === SHARED_DEV_APP_PATH) assertMergedBuild(build.commit)
    if (args.dryRun) return { build, shell: nextLayout.shell, preflight }

    const confirmStopped = () => assertDevStopped(paths)
    confirmStopped()
    const electronVersion = process.versions.electron
    if (electronVersion === undefined) {
      throw new Error('profile upgrade-dev must run through the frozen candidate App in ELECTRON_RUN_AS_NODE mode')
    }
    if (realpathSync(process.execPath) !== realpathSync(nextLayout.executable)) {
      throw new Error(`profile upgrade-dev is running through ${process.execPath}, not frozen candidate ${nextLayout.executable}`)
    }
    assertPhysicalProfileBoundary(profileDir)
    const runtimeDir = mkdtempSync(join(tmpdir(), 'omnimux-next-profile-rebuild-runtime-'))
    try {
      const runtime = installDesktopPnpmRuntime({
        platform: process.platform,
        appExecutable: nextLayout.executable,
        pnpmBinPath: nextLayout.pnpmBinPath,
        electronVersion,
        stateDir: runtimeDir,
        environment: process.env,
      })
      try {
        const graph = await prepareNextManagedProfileGraph({
          profileDir,
          homeDir: paths.homeDir,
          asarPath: nextLayout.asarPath,
          materialize: async candidateProfileDir => {
            await materializeProfile({
              appExecutable: nextLayout.executable,
              clearEnvironmentPath: runtime.clearEnvironmentPath,
              pnpmBinPath: nextLayout.pnpmBinPath,
              nodeBinDir: runtime.nodeBinDir,
              nodeShimPath: runtime.nodeShimPath,
              homeDir: runtimeDir,
              profileDir: candidateProfileDir,
              electronVersion,
              updateLockfile: true,
            })
          },
        })
        try {
          await upgradeDevWithRecovery({
            ...recovery,
            candidateApp: app,
            profileDir,
            graph: { candidateDir: graph.candidateDir, entries: MANAGED_GRAPH_ENTRIES, verify: graph.verify },
            confirmStopped,
          })
          const activeConfig = writeDesktopNextActiveProfile(paths.homeDir, 'omnimux')
          return { status: 'switched', recoveryDir: args.recoveryDir, build, graph: graph.result, activeConfig }
        } finally {
          graph.dispose()
        }
      } finally {
        runtime.dispose()
      }
    } finally {
      rmSync(runtimeDir, { recursive: true, force: true })
    }
  }

  const layout = candidateLayout(app)
  const build = readDevBuild(app, layout.presetDir)
  if (paths.appPath === SHARED_DEV_APP_PATH) assertMergedBuild(build.commit)
  const sources = inspectDevProfileSources(profileDir, layout.presetDir, readOwnedPackages(layout.presetDir))
  if (args.dryRun) return { build, sources, preflight }

  const confirmStopped = () => assertDevStopped(paths)
  confirmStopped()
  return withProfileBuilder(app, paths.homeDir, profileDir, async options => {
    const graph = await prepareManagedProfile({ ...options, mode: 'dev-upgrade' })
    try {
      await upgradeDevWithRecovery({
        ...recovery,
        candidateApp: app,
        profileDir,
        graph: { candidateDir: graph.candidateDir, entries: MANAGED_GRAPH_ENTRIES, verify: graph.verify },
        confirmStopped,
      })
      return { status: 'switched', recoveryDir: args.recoveryDir, build, graph: graph.result }
    } finally {
      graph.dispose()
    }
  }, true)
}

export async function runManagedProfileRebuild(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = parseProfileArguments(argv)
  let result: unknown
  if (args.command === 'rebuild') {
    const homeDir = PROFILE_TARGETS[args.target]
    result = await withProfileBuilder(realpathSync(args.app), homeDir, join(homeDir, 'profiles', 'omnimux'), rebuildManagedProfile)
  } else if (args.command === 'upgrade-dev') {
    result = await runDevProfileUpgrade(args)
  } else {
    const paths = sharedDevPaths(args.command !== 'recover-dev')
    const recovery = { paths, recoveryDir: args.recoveryDir }
    if (args.command === 'recover-dev') {
      await recoverDevFromArchive({ ...recovery, confirmStopped: () => assertDevStopped(paths) })
      result = { status: 'restored', recoveryDir: args.recoveryDir }
    } else {
      await acceptDevUpgrade(recovery)
      result = { status: 'accepted', recoveryDir: args.recoveryDir }
    }
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

function isDirectExecution(): boolean {
  const entry = process.argv[1]
  return entry !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(entry)
}

if (isDirectExecution()) {
  void runManagedProfileRebuild().catch(cause => {
    process.stderr.write(`omnimux profile rebuild failed: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`)
    process.exitCode = 1
  })
}
