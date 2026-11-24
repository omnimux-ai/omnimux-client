/**
 * Desktop Next (`dsh-desktop-next`) layout detection, Dev build verification,
 * and clean managed-profile graph preparation for `yarn omnimux:profile upgrade-dev`.
 *
 * Unlike the frozen legacy shell (`dsh-plugin-desktop`), Next bundles all 13 OmniMux
 * product plugins and `dsh-better-sidebar` inside `Contents/Resources/app.asar` and
 * supports external Profile-local overrides (`<profile>/node_modules/<pkg>`) without
 * mutating `app.asar` or breaking `.app` code signatures.
 */

import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import {
  MANAGED_GRAPH_ENTRIES,
  MANAGED_SOURCE_DIRECTORY,
  managedDependencySpec,
} from '../src/managed-profile.ts'

export const NEXT_SHELL_NAME = 'dsh-desktop-next'
export const DEV_BUNDLE_IDENTIFIER = 'ai.omnimux.desktop.dev'
export const DEV_USER_DATA_DIRECTORY_NAME = 'OmniMux-Dev'
export const DESKTOP_NEXT_LAST_HOME_FILE = 'desktop-next-last-home.json'

const CORE_BUNDLE_PREFIX = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] as const
const OPTIONAL_BUNDLES_CARRIED_OVER = new Set([
  'dshmarket',
  'dsh-community-market',
  '@agents-anywhere/dsh-bridge-next',
  '@deepseek-ai/dsh-experimental-plugin-market-bundle',
  '@deepseek-ai/dsh-experimental-subagent-oar',
])

export interface NextCandidateLayout {
  readonly shell: typeof NEXT_SHELL_NAME
  readonly executable: string
  readonly asarPath: string
  readonly pnpmBinPath: string
  readonly buildInfoPath: string
}

export interface NextDevBuildInfo {
  readonly version: string
  readonly commit: string
  readonly shell: typeof NEXT_SHELL_NAME
  readonly dsh: string
}

interface AsarNode {
  readonly files?: Readonly<Record<string, AsarNode>>
  readonly size?: number
  readonly offset?: string
  readonly unpacked?: boolean
}

export interface AsarReader {
  readonly readFile: (relativePath: string) => Buffer | null
  readonly extractDirectory: (relativePrefix: string, destinationDir: string) => number
}

/** Read physical ASAR archive entries directly without relying on Electron virtual fs. */
export function openPhysicalAsar(asarPath: string): AsarReader {
  const raw = readFileSync(asarPath)
  const headerSize = raw.readUInt32LE(4)
  const jsonSize = raw.readUInt32LE(12)
  const header = JSON.parse(raw.subarray(16, 16 + jsonSize).toString('utf8')) as AsarNode
  const dataBase = 8 + headerSize

  const lookup = (relativePath: string): AsarNode | null => {
    let node: AsarNode | undefined = header
    for (const part of relativePath.split('/').filter(Boolean)) {
      node = node?.files?.[part]
      if (!node) return null
    }
    return node ?? null
  }

  const readNode = (node: AsarNode, relativePath: string): Buffer => {
    if (node.unpacked) {
      const unpackedPath = join(`${asarPath}.unpacked`, ...relativePath.split('/'))
      return readFileSync(unpackedPath)
    }
    const start = dataBase + Number(node.offset)
    return raw.subarray(start, start + Number(node.size))
  }

  const readFile = (relativePath: string): Buffer | null => {
    const node = lookup(relativePath)
    if (!node || node.files !== undefined) return null
    return readNode(node, relativePath)
  }

  const extractDirectory = (relativePrefix: string, destinationDir: string): number => {
    const root = lookup(relativePrefix)
    if (!root || !root.files) return 0
    let count = 0
    const walk = (node: AsarNode, rel: string, dst: string): void => {
      if (node.files) {
        mkdirSync(dst, { recursive: true })
        for (const [name, child] of Object.entries(node.files)) {
          walk(child, `${rel}/${name}`, join(dst, name))
        }
        return
      }
      mkdirSync(dirname(dst), { recursive: true })
      writeFileSync(dst, readNode(node, rel))
      count += 1
    }
    walk(root, relativePrefix, destinationDir)
    return count
  }

  return { readFile, extractDirectory }
}

function readPlistBundleId(plistPath: string): string | undefined {
  if (!existsSync(plistPath)) return undefined
  const raw = readFileSync(plistPath)
  let xml: string
  if (raw.subarray(0, 6).toString('ascii') === 'bplist') {
    const converted = spawnSync('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', plistPath], { encoding: 'utf8' })
    if (converted.status !== 0 || !converted.stdout) return undefined
    xml = converted.stdout
  } else {
    xml = raw.toString('utf8')
  }
  const match = /<key>\s*CFBundleIdentifier\s*<\/key>\s*<string>([\s\S]*?)<\/string>/u.exec(xml)
  return match?.[1]?.trim()
}

/** Detect whether `app` is a packaged `dsh-desktop-next` bundle. Returns null for legacy preset bundles. */
export function nextCandidateLayout(app: string): NextCandidateLayout | null {
  const buildInfoPath = join(app, 'Contents', 'Resources', 'build-info.json')
  const asarPath = join(app, 'Contents', 'Resources', 'app.asar')
  if (!existsSync(buildInfoPath) || !existsSync(asarPath)) return null

  let buildInfo: { shell?: unknown }
  try {
    buildInfo = JSON.parse(readFileSync(buildInfoPath, 'utf8')) as { shell?: unknown }
  } catch {
    return null
  }
  if (buildInfo.shell !== NEXT_SHELL_NAME) return null

  const executableDir = join(app, 'Contents', 'MacOS')
  const executables = readdirSync(executableDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => join(executableDir, entry.name))
  if (executables.length !== 1) {
    throw new Error(`candidate Next App must contain exactly one main executable in ${executableDir}`)
  }
  const pnpmBinPath = join(app, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  if (!existsSync(pnpmBinPath)) {
    throw new Error(`candidate Next App is missing unpacked pnpm at ${pnpmBinPath}`)
  }
  return {
    shell: NEXT_SHELL_NAME,
    executable: executables[0]!,
    asarPath,
    pnpmBinPath,
    buildInfoPath,
  }
}

/** Verify a frozen Next Dev App's build metadata, Dev Bundle ID, and macOS code signature. */
export function readNextDevBuild(
  app: string,
  options: { readonly verifySignature?: (appPath: string) => void } = {},
): NextDevBuildInfo {
  const buildInfoPath = join(app, 'Contents', 'Resources', 'build-info.json')
  const build = JSON.parse(readFileSync(buildInfoPath, 'utf8')) as {
    shell?: unknown
    channel?: unknown
    releaseChannel?: unknown
    version?: unknown
    repo?: { commit?: unknown; dirty?: unknown }
    dsh?: { packageSpec?: unknown }
  }
  if (
    build.shell !== NEXT_SHELL_NAME
    || build.channel !== 'package-dev'
    || build.releaseChannel !== 'development'
    || typeof build.version !== 'string'
    || build.repo?.dirty !== false
    || typeof build.repo.commit !== 'string'
    || !/^[a-f0-9]{40}$/u.test(build.repo.commit)
    || typeof build.dsh?.packageSpec !== 'string'
    || build.dsh.packageSpec.trim() === ''
  ) {
    throw new Error('Use a signed Next development App produced by package:dev from a clean commit')
  }

  const plistPath = join(app, 'Contents', 'Info.plist')
  const bundleId = readPlistBundleId(plistPath)
  if (bundleId !== DEV_BUNDLE_IDENTIFIER) {
    throw new Error(`Candidate Next Dev App must declare CFBundleIdentifier=${DEV_BUNDLE_IDENTIFIER} (received ${JSON.stringify(bundleId)})`)
  }

  if (options.verifySignature) {
    options.verifySignature(app)
  } else if (spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]).status !== 0) {
    throw new Error('Candidate Next Dev App signature verification failed')
  }

  return {
    version: build.version,
    commit: build.repo.commit,
    shell: NEXT_SHELL_NAME,
    dsh: build.dsh.packageSpec.trim(),
  }
}

/** Compute the ordered Next bundle list for `profiles/omnimux` from the frozen App manifest + existing user opt-ins. */
export function computeNextProfileBundles(
  appManifest: { readonly dependencies?: Readonly<Record<string, string>> },
  existingBundles: readonly string[],
): string[] {
  const bundledDeps = new Set(Object.keys(appManifest.dependencies ?? {}))
  const productBundles = [...bundledDeps]
    .filter(name => name === 'dsh-better-sidebar' || name === 'omnimux' || name.startsWith('omnimux-'))
    .sort((left, right) => {
      if (left === 'omnimux') return -1
      if (right === 'omnimux') return 1
      return left.localeCompare(right)
    })

  const ordered: string[] = []
  const seen = new Set<string>()
  const add = (name: string): void => {
    if (!seen.has(name)) {
      seen.add(name)
      ordered.push(name)
    }
  }

  for (const core of CORE_BUNDLE_PREFIX) add(core)
  for (const bundle of productBundles) add(bundle)
  for (const existing of existingBundles) {
    if (OPTIONAL_BUNDLES_CARRIED_OVER.has(existing) && bundledDeps.has(existing)) {
      add(existing)
    }
  }
  return ordered
}

export interface PreparedNextProfileGraph {
  readonly candidateDir: string
  readonly result: {
    readonly profileDir: string
    readonly shell: typeof NEXT_SHELL_NAME
    readonly bundles: readonly string[]
    readonly hasManagedUiKit: boolean
    readonly manifestHash: string
  }
  readonly verify: (profileDir: string) => void
  readonly dispose: () => void
}

/**
 * Stage the 5 `MANAGED_GRAPH_ENTRIES` for a Desktop Next `profiles/omnimux` cutover:
 * - Drops legacy 0.2.1-rc.3 snapshot dependencies (including old `dsh-better-sidebar@0.28.1`)
 *   so Next serves its bundled 0.2.2-rc.5 plugins from `app.asar` cleanly;
 * - Seeds `.materialize-snapshots/plugins/dsh-ui-kit` from the frozen App's `app.asar` so
 *   subsequent `yarn omnimux:sync [plugin]` external overrides work out of the box without
 *   touching `app.asar` or breaking `.app` signatures.
 */
export async function prepareNextManagedProfileGraph(options: {
  readonly profileDir: string
  readonly homeDir: string
  readonly asarPath: string
  readonly materialize: (candidateProfileDir: string) => Promise<void>
}): Promise<PreparedNextProfileGraph> {
  const stagingRoot = mkdtempSync(join(dirname(options.homeDir), '.omnimux-next-profile-stage-'))
  const candidateDir = join(stagingRoot, 'omnimux')
  mkdirSync(candidateDir, { recursive: true, mode: 0o700 })
  try {
    const asar = openPhysicalAsar(options.asarPath)
    const rawAppPkg = asar.readFile('package.json')
    if (rawAppPkg === null) throw new Error(`Frozen Next App archive is missing package.json: ${options.asarPath}`)
    const appManifest = JSON.parse(rawAppPkg.toString('utf8')) as {
      readonly name?: unknown
      readonly dependencies?: Readonly<Record<string, string>>
    }
    if (appManifest.name !== NEXT_SHELL_NAME) {
      throw new Error(`Expected ${NEXT_SHELL_NAME} archive manifest, received ${JSON.stringify(appManifest.name)}`)
    }

    let existingManifest: Record<string, unknown> = {}
    const existingManifestPath = join(options.profileDir, 'package.json')
    if (existsSync(existingManifestPath)) {
      existingManifest = JSON.parse(readFileSync(existingManifestPath, 'utf8')) as Record<string, unknown>
    }
    const existingDsh = (typeof existingManifest.dsh === 'object' && existingManifest.dsh !== null)
      ? existingManifest.dsh as Record<string, unknown>
      : {}
    const existingProfile = (typeof existingDsh.profile === 'object' && existingDsh.profile !== null)
      ? existingDsh.profile as { bundles?: unknown }
      : {}
    const existingBundles = Array.isArray(existingProfile.bundles)
      ? existingProfile.bundles.filter((item): item is string => typeof item === 'string')
      : []

    const bundles = computeNextProfileBundles(appManifest, existingBundles)
    const managedSnapshotsDir = join(candidateDir, ...MANAGED_SOURCE_DIRECTORY.split('/'))
    mkdirSync(managedSnapshotsDir, { recursive: true, mode: 0o700 })
    const kitTargetDir = join(managedSnapshotsDir, 'dsh-ui-kit')
    const extractedKitFiles = asar.extractDirectory('node_modules/dsh-ui-kit', kitTargetDir)
    const hasManagedUiKit = extractedKitFiles > 0 && existsSync(join(kitTargetDir, 'package.json'))

    const nextManifest = {
      name: 'dsh-profile-omnimux',
      private: true,
      dependencies: hasManagedUiKit ? { 'dsh-ui-kit': managedDependencySpec('dsh-ui-kit') } : {},
      dsh: {
        ...existingDsh,
        desktopNextOnboarding: { version: 1, outcome: 'skipped' },
        desktopNextScheduleBundle: 2,
        profile: { bundles },
      },
    }
    const manifestJson = `${JSON.stringify(nextManifest, null, 2)}\n`
    writeFileSync(join(candidateDir, 'package.json'), manifestJson, 'utf8')
    writeFileSync(join(candidateDir, 'pnpm-workspace.yaml'), 'packages: []\n', 'utf8')

    await options.materialize(candidateDir)

    // Ensure all 5 MANAGED_GRAPH_ENTRIES exist even when dependencies is empty (pnpm skips node_modules/lockfile).
    if (!existsSync(join(candidateDir, 'pnpm-lock.yaml'))) {
      writeFileSync(join(candidateDir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n", 'utf8')
    }
    if (!existsSync(join(candidateDir, 'node_modules'))) {
      mkdirSync(join(candidateDir, 'node_modules'), { recursive: true })
    }

    const manifestHash = createHash('sha256').update(manifestJson).digest('hex')
    const verify = (profileDir: string): void => {
      for (const entry of MANAGED_GRAPH_ENTRIES) {
        const entryPath = join(profileDir, entry)
        const stat = lstatSync(entryPath)
        const expectDir = entry === 'node_modules' || entry === '.materialize-snapshots'
        if (expectDir ? !stat.isDirectory() : !stat.isFile()) {
          throw new Error(`Committed Next profile graph entry ${entry} has unexpected type at ${entryPath}`)
        }
      }
      const actualHash = createHash('sha256').update(readFileSync(join(profileDir, 'package.json'))).digest('hex')
      if (actualHash !== manifestHash) {
        throw new Error('Committed Next profile package.json hash mismatch')
      }
    }

    return {
      candidateDir,
      result: {
        profileDir: options.profileDir,
        shell: NEXT_SHELL_NAME,
        bundles,
        hasManagedUiKit,
        manifestHash,
      },
      verify,
      dispose: () => rmSync(stagingRoot, { recursive: true, force: true }),
    }
  } catch (error) {
    rmSync(stagingRoot, { recursive: true, force: true })
    throw error
  }
}

/** Persist `desktop-next.json` so Desktop Next always boots into `profiles/omnimux` without drift. */
export function writeDesktopNextActiveProfile(homeDir: string, profileName = 'omnimux'): string {
  const filePath = join(resolve(homeDir), 'desktop-next.json')
  writeFileSync(filePath, `${JSON.stringify({ version: 1, active: profileName }, null, 2)}\n`, { mode: 0o600 })
  chmodSync(filePath, 0o600)
  return filePath
}

function assertRealDirectoryOrCreate(dirPath: string): void {
  const parent = dirname(dirPath)
  if (parent !== dirPath) {
    const parentInfo = lstatSync(parent, { throwIfNoEntry: false })
    if (parentInfo && (!parentInfo.isDirectory() || parentInfo.isSymbolicLink())) {
      throw new Error(`Refusing to write Dev last-home under non-directory or symlink: ${parent}`)
    }
    if (!parentInfo) assertRealDirectoryOrCreate(parent)
  }
  const info = lstatSync(dirPath, { throwIfNoEntry: false })
  if (info && (!info.isDirectory() || info.isSymbolicLink())) {
    throw new Error(`Refusing to write Dev last-home under non-directory or symlink: ${dirPath}`)
  }
  if (!info) mkdirSync(dirPath, { mode: 0o700 })
}

/**
 * Calibrate Dev's `desktop-next-last-home.json` to the committed Dev `homeDir` after
 * `upgrade-dev` switches profiles, so stale paths left by isolated test runs cannot
 * trigger Next's first-boot "data directory differs from the last launch" prompt.
 *
 * Fail-closed boundaries:
 * - Only accepts a Dev `userDataDir` ending in `OmniMux-Dev` (never production `OmniMux`).
 * - Refuses to record a production `.omnimux` home directory.
 * - Rejects symlinks and writes atomically with 0600 permissions.
 */
export function writeDesktopNextLastHome(userDataDir: string, homeDir: string): string {
  if (!isAbsolute(userDataDir) || userDataDir.includes('\0')) {
    throw new Error(`Dev userDataDir must be an absolute path: ${userDataDir}`)
  }
  if (!isAbsolute(homeDir) || homeDir.includes('\0')) {
    throw new Error(`Dev homeDir must be an absolute path: ${homeDir}`)
  }

  const resolvedUserDataDir = resolve(userDataDir)
  const resolvedHomeDir = resolve(homeDir)
  if (basename(resolvedUserDataDir) !== DEV_USER_DATA_DIRECTORY_NAME) {
    throw new Error(
      `Refusing to write ${DESKTOP_NEXT_LAST_HOME_FILE} outside ${DEV_USER_DATA_DIRECTORY_NAME}: ${resolvedUserDataDir}`,
    )
  }
  if (basename(resolvedHomeDir) === '.omnimux') {
    throw new Error(`Refusing to point Dev ${DESKTOP_NEXT_LAST_HOME_FILE} at production home: ${resolvedHomeDir}`)
  }

  const locationRoot = join(resolvedUserDataDir, 'home')
  assertRealDirectoryOrCreate(locationRoot)

  const filePath = join(locationRoot, DESKTOP_NEXT_LAST_HOME_FILE)
  const existing = lstatSync(filePath, { throwIfNoEntry: false })
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
    throw new Error(`Refusing to replace linked or non-file Dev last-home record: ${filePath}`)
  }

  const temporary = `${filePath}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify({ home: resolvedHomeDir }, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    chmodSync(temporary, 0o600)
    renameSync(temporary, filePath)
  } finally {
    rmSync(temporary, { force: true })
  }
  return filePath
}
