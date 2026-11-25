import { prepareCuaNative } from './upstream-family.ts'
/** Materialize the Next payload independently of Electron Builder, then seal it. */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { nextRuntimeFileExclusion, nextRuntimePackageExclusion, nextRuntimeUnusedFeatureExclusion, type NextPackagingTarget, type RuntimePackageConstraints } from './runtime-file-policy.ts'
import { nextPackagingTarget, nextPayloadRelease, payloadDir, verifyNextPayload } from './packaged-payload.ts'
import type { MacPackageArch } from './mac-runtime.ts'
import { DESKTOP_RUNTIME_FILE, physicalPayload, sealPayloadAsync, type DesktopRuntimeDescriptor } from '../src/runtime-tree.ts'
import { packagingStep, packagingStepSync } from './packaging-step.ts'
import { windowsCodePayload, writeWindowsCodeFiles } from './windows-asar-unpack.ts'

/**
 * Shell entries copied beside the dependency tree; `package.json` is written separately. OmniMux ships
 * one unified brand icon set (`app-icon.{ico,png,mac.png}` and `assets/tray-icon*`); upstream dark and
 * classic whale sets are intentionally omitted.
 */
const SHELL_ENTRIES = ['lib', 'assets', 'build/app-icon.ico', 'build/app-icon.png', 'build/app-icon-mac.png',
  'cordis.patch.yml', 'host.cordis.patch.yml', 'scripts/node-bin'] as const

/** Report of the unused-feature packages one preparation skipped, written beside the payload directory. */
export const SKIPPED_FEATURES_FILE = 'payload-skipped-features.json'

/** Names electron-builder's walker never copies; the inventory has to agree with it. */
const IGNORED_NAMES = new Set(['.DS_Store', '.gitkeep'])

const PACKAGE_NAME = /^(?:@[^/\\]+\/)?[^/\\]+$/u

interface ManifestTransformer {
  createTransformer(root: string, configuration: object, extraMetadata: object | undefined): (path: string) => Promise<string | null | undefined> | null
}

// electron-builder publishes no declarations for its manifest transformer. It runs the same
// function again while copying the payload, so applying it first keeps the sealed bytes final.
const { createTransformer } = createRequire(import.meta.url)('app-builder-lib/out/fileTransformer.js') as ManifestTransformer

interface PackageManifest extends RuntimePackageConstraints {
  readonly name?: string
  readonly version?: string
  readonly main?: string
  readonly files?: readonly string[]
  readonly dependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>
  readonly optionalDependencies?: Readonly<Record<string, string>>
}

function readManifest(directory: string): PackageManifest {
  return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as PackageManifest
}

/**
 * Locate one dependency the way Node does from the dependent's directory, without honouring
 * `exports`, which may hide `package.json`.
 * @param name - Package name.
 * @param from - Dependent's physical directory.
 * @returns The package directory as installed, which may be a link, or undefined.
 */
function resolvePackageDir(name: string, from: string): string | undefined {
  if (!PACKAGE_NAME.test(name) || name.split('/').some(part => part === '.' || part === '..')) throw new Error(`Next payload: invalid dependency name ${JSON.stringify(name)}`)
  for (const directory of createRequire(join(from, 'package.json')).resolve.paths(name) ?? []) {
    if (basename(directory) !== 'node_modules') continue
    const candidate = join(directory, name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

/** One package of the production closure and where the payload places it. */
export interface ClosurePackage {
  readonly name: string
  readonly version: string
  /** Physical directory the files are read from. */
  readonly source: string
  /** Slash-separated directory below the payload's `node_modules`. */
  readonly destination: string
  /** A workspace package rather than an installed one: copied by its published file list. */
  readonly workspace: boolean
}

function installedPackage(installedModules: string, name: string): { source: string; version: string } | undefined {
  const directory = join(installedModules, name)
  if (!existsSync(join(directory, 'package.json'))) return undefined
  const source = realpathSync(directory)
  return { source, version: readManifest(source).version ?? '' }
}

/** A required dependency deliberately left out because this release line does not ship its feature. */
export interface SkippedFeaturePackage {
  readonly name: string
  /** Every dependent that declares it as a required edge, sorted. */
  readonly requiredBy: readonly string[]
  readonly reason: string
}

/** The production closure and the unused-feature packages it deliberately leaves out. */
export interface ProductionClosureReport {
  readonly packages: ClosurePackage[]
  /** Sorted by name; optional edges to excluded packages are not listed. */
  readonly skipped: SkippedFeaturePackage[]
}

/**
 * Collect the production closure of the application manifest: dependencies, required peers and
 * installed optional dependencies, each resolved from its dependent as Node will resolve it.
 * Packages inside the application's own `node_modules` keep their installed nesting. A
 * workspace package, and dependencies installed beside one, are placed the way an installer
 * hoists them: at the payload root unless the root already holds another version of the same
 * name, in which case they nest under their dependent. One version is copied once. The peers of
 * a workspace package resolve to the root copies, as they will in the payload, rather than to the
 * development copies its own tree installs for its tests.
 *
 * A package from the unused-feature table is skipped with its whole subtree even when an edge
 * requires it: the Next profile disables the cordis rows that would load it, so the edge is
 * never followed at runtime. Each such required edge is reported rather than dropped silently.
 * @param desktopRoot - Application package directory.
 * @param target - Release platform and architectures used to select optional native packages.
 * @returns Packages sorted by destination, and the skipped unused-feature packages.
 */
export function collectProductionClosureReport(desktopRoot: string, target = nextPackagingTarget(process.platform)): ProductionClosureReport {
  const root = realpathSync(desktopRoot)
  const installedModules = join(root, 'node_modules')
  const installedPlacement = (source: string): string | undefined => {
    const rel = relative(installedModules, source)
    return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? undefined : rel.split(sep).join('/')
  }
  const placed = new Map<string, ClosurePackage>()
  const skipped = new Map<string, { reason: string; requiredBy: Set<string> }>()
  // The copy Node finds from a package at the payload root: one placed there, else the application's.
  const rootPackageDir = (name: string): string | undefined => placed.get(name)?.source ?? resolvePackageDir(name, root)
  const visited = new Set<string>()
  const queue: { real: string; destination: string | undefined }[] = [{ real: root, destination: undefined }]
  while (queue.length > 0) {
    const { real, destination: dependentDestination } = queue.shift()!
    if (visited.has(real)) continue
    visited.add(real)
    const manifest = readManifest(real)
    const dependent = manifest.name ?? real
    const optionalPeers = manifest.peerDependenciesMeta ?? {}
    const optional = Object.keys(manifest.optionalDependencies ?? {})
    const required = [...Object.keys(manifest.dependencies ?? {}).filter(name => !optional.includes(name)),
      ...Object.keys(manifest.peerDependencies ?? {}).filter(name => optionalPeers[name]?.optional !== true)]
    // A workspace package sits at the payload root, away from the tree that holds its development peers.
    const rootPeers = dependentDestination !== undefined && !dependentDestination.includes('/node_modules/') && installedPlacement(real) === undefined
      ? Object.keys(manifest.peerDependencies ?? {}).filter(name => manifest.dependencies?.[name] === undefined)
      : []
    for (const name of new Set([...required, ...optional])) {
      const unused = nextRuntimeUnusedFeatureExclusion(name)
      if (unused !== undefined) {
        if (required.includes(name)) {
          const entry = skipped.get(name) ?? { reason: unused, requiredBy: new Set<string>() }
          entry.requiredBy.add(dependent)
          skipped.set(name, entry)
        }
        continue
      }
      const installed = (rootPeers.includes(name) ? rootPackageDir(name) : undefined) ?? resolvePackageDir(name, real)
      if (installed === undefined) {
        if (required.includes(name)) throw new Error(`Next payload: dependency ${name} required by ${dependent} is not installed`)
        continue
      }
      let source = realpathSync(installed)
      const exclusion = nextRuntimePackageExclusion(readManifest(source), target)
      if (exclusion !== undefined) {
        if (required.includes(name)) throw new Error(`Next payload: dependency ${name} required by ${dependent} cannot be packaged: ${exclusion}`)
        continue
      }
      let destination = installedPlacement(source)
      if (destination === undefined) {
        const version = readManifest(source).version ?? ''
        const hoisted = placed.get(name) ?? installedPackage(installedModules, name)
        if (hoisted !== undefined && hoisted.source !== source && hoisted.version !== version) {
          if (dependentDestination === undefined) throw new Error(`Next payload: ${name} ${version} conflicts with the installed ${hoisted.version}`)
          destination = `${dependentDestination}/node_modules/${name}`
        } else {
          destination = name
          if (hoisted !== undefined) source = hoisted.source
        }
      }
      const existing = placed.get(destination)
      if (existing === undefined) {
        placed.set(destination, { name, version: readManifest(source).version ?? '', source, destination,
          workspace: !source.split(sep).includes('node_modules') })
      } else if (existing.source !== source) {
        throw new Error(`Next payload: node_modules/${destination} is claimed by both ${existing.source} and ${source}`)
      }
      queue.push({ real: source, destination })
    }
  }
  const byString = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
  return {
    packages: [...placed.values()].sort((a, b) => byString(a.destination, b.destination)),
    skipped: [...skipped.entries()].sort(([a], [b]) => byString(a, b))
      .map(([name, { reason, requiredBy }]) => ({ name, requiredBy: [...requiredBy].sort(byString), reason })),
  }
}

/**
 * The production closure alone; see {@link collectProductionClosureReport}.
 * @param desktopRoot - Application package directory.
 * @param target - Release platform and architectures used to select optional native packages.
 * @returns Packages sorted by destination.
 */
export function collectProductionClosure(desktopRoot: string, target = nextPackagingTarget(process.platform)): ClosurePackage[] {
  return collectProductionClosureReport(desktopRoot, target).packages
}

type Keep = (path: string, name: string) => boolean

/**
 * Copy a file or directory, dereferencing links, under a filter over slash-separated paths.
 * @param source - File or directory to copy.
 * @param destination - Where it lands.
 * @param keep - Decides each entry below `source` by its relative path and base name.
 */
function copyTree(source: string, destination: string, keep: Keep, extensionFilters: readonly ExtensionFilter[] = [], packagePrefix = ''): void {
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, {
    recursive: true, dereference: true,
    filter: (path) => {
      const rel = relative(source, path)
      if (rel === '') return true
      const parts = rel.split(sep)
      const name = parts.at(-1)!
      if (!keep(parts.join('/'), name)) return false
      const packagePath = packagePrefix === '' ? rel.split(sep).join('/') : `${packagePrefix}/${rel.split(sep).join('/')}`
      const filters = extensionFilters.filter(filter => packagePath === filter.directory || packagePath.startsWith(`${filter.directory}/`))
      if (filters.length === 0 || statSync(path).isDirectory()) return true
      return filters.some(filter => filter.extensions.some(extension => name.endsWith(extension)))
    },
  })
}

/** One extension restriction inside a published directory. */
export interface ExtensionFilter {
  /** Slash-separated package-relative directory the restriction applies below. */
  readonly directory: string
  /** Extensions kept below that directory, in declaration order. */
  readonly extensions: readonly string[]
}

/** The entries a workspace package publishes, plus the negated paths it withholds. */
export interface PublishedTree {
  /** Slash-separated entries relative to the package, topmost first, sorted. */
  readonly entries: readonly string[]
  /** Slash-separated `files` exclusions (`!path`) that apply below the entries. */
  readonly excluded: readonly string[]
  /** Extension restrictions from nested extension-glob file patterns. */
  readonly extensionFilters: readonly ExtensionFilter[]
}

/**
 * The tree a workspace package publishes: the manifest, its readme and license files, the main
 * entry and the `files` list, as an installer would receive them. Literal names, `directory/**`
 * forms and npm's `!path` exclusions are supported; other globs stop the build rather than guess.
 * @param packageDir - Workspace package directory.
 * @returns Published entries and the exclusions that apply beneath them.
 */
export function publishedTree(packageDir: string): PublishedTree {
  const manifest = readManifest(packageDir)
  const entries = new Set(['package.json'])
  const excluded = new Set<string>()
  const extensionFilters: ExtensionFilter[] = []
  for (const name of readdirSync(packageDir)) if (/^(?:readme|licen[cs]e)(?:\..*)?$/iu.test(name)) entries.add(name)
  if (manifest.main !== undefined && existsSync(join(packageDir, manifest.main))) entries.add(manifest.main.replace(/^\.\//u, ''))
  for (const pattern of manifest.files ?? []) {
    const negated = pattern.startsWith('!')
    const rawEntry = (negated ? pattern.slice(1) : pattern).replace(/^\.\//u, '')
    // npm treats `dir/**/*.ext` as every matching file below dir, not a literal name.
    // Only this nested extension form is special; every other unknown glob still fails.
    const nestedExtension = /^(.+)\/\*\*\/\*\.[^/]+$/u.exec(rawEntry)
    if (!negated && nestedExtension !== null) {
      const directory = nestedExtension[1]!
      const extension = rawEntry.slice(directory.length + '/**/*'.length)
      if (directory === '' || !/^\.[0-9A-Za-z.]+$/u.test(extension) || directory.split('/').some(part => part === '.' || part === '..')) {
        throw new Error(`Next payload: unsupported files pattern ${JSON.stringify(pattern)} in ${manifest.name ?? packageDir}`)
      }
      if (existsSync(join(packageDir, directory))) {
        entries.add(directory)
        extensionFilters.push({ directory, extensions: [extension] })
      }
      continue
    }
    const entry = rawEntry.replace(/\/(?:\*\*(?:\/\*)?)?$/u, '')
    if (entry === '' || /[*?[\]{}!]/u.test(entry) || entry.split('/').some(part => part === '.' || part === '..')) {
      throw new Error(`Next payload: unsupported files pattern ${JSON.stringify(pattern)} in ${manifest.name ?? packageDir}`)
    }
    if (negated) excluded.add(entry)
    else if (existsSync(join(packageDir, entry))) entries.add(entry)
  }
  const sorted = [...entries].sort()
  return {
    entries: sorted.filter(entry => !sorted.some(other => other !== entry && entry.startsWith(`${other}/`))),
    excluded: [...excluded].sort(),
    extensionFilters,
  }
}

/**
 * The entries a workspace package publishes, as an installer would receive them.
 * @param packageDir - Workspace package directory.
 * @returns Slash-separated entries relative to the package.
 */
export function publishedEntries(packageDir: string): string[] {
  return [...publishedTree(packageDir).entries]
}

/**
 * Whether a published path stays inside a negated `files` entry.
 * @param excluded - Exclusions returned by {@link publishedTree}.
 * @param path - Slash-separated path relative to the package.
 * @returns True when the path or one of its parents is excluded.
 */
function isExcluded(excluded: readonly string[], path: string): boolean {
  return excluded.some(entry => path === entry || path.startsWith(`${entry}/`))
}

/**
 * Copy one package without its own `node_modules`, applying the Desktop file policy.
 * @param pkg - Package and its placement.
 * @param modules - The payload's `node_modules` directory.
 * @param target - Platform and architectures of the package.
 */
function matchesExtensionFilter(filters: readonly ExtensionFilter[], packagePath: string, name: string): boolean {
  return filters.some(filter => (packagePath === filter.directory || packagePath.startsWith(`${filter.directory}/`))
    && filter.extensions.some(extension => name.endsWith(extension)))
}

function copyPackage(pkg: ClosurePackage, modules: string, target: NextPackagingTarget): void {
  const destination = join(modules, ...pkg.destination.split('/'))
  const baseKeep: Keep = (path, name) => path.split('/')[0] !== 'node_modules' && !IGNORED_NAMES.has(name)
  const workspaceKeep: Keep = (path, name) => !path.split('/').includes('node_modules') && !IGNORED_NAMES.has(name)
  const keep: Keep = (path, name) => baseKeep(path, name)
    && nextRuntimeFileExclusion(`${pkg.destination}/${path}`, target) === undefined
  if (!pkg.workspace) { copyTree(pkg.source, destination, keep); return }
  const { entries, excluded, extensionFilters } = publishedTree(pkg.source)
  for (const entry of entries) {
    if (!workspaceKeep(entry, basename(entry))) continue
    copyTree(join(pkg.source, entry), join(destination, entry),
      (path, name) => {
        const packagePath = `${entry}/${path}`
        return workspaceKeep(packagePath, name) && !isExcluded(excluded, packagePath)
          && nextRuntimeFileExclusion(`${pkg.destination}/${packagePath}`, target,
            { allowTypeDeclarations: matchesExtensionFilter(extensionFilters, packagePath, name) }) === undefined
      },
      extensionFilters, entry)
  }
}

/** Options of one payload preparation. */
export interface PreparePayloadOptions {
  readonly desktopRoot: string
  readonly output: string
  readonly target: NextPackagingTarget
  readonly electronVersion: string
  /** Manifest fields electron-builder would merge into the application manifest, such as a drill version. */
  readonly extraMetadata?: Readonly<Record<string, unknown>>
  readonly log?: (message: string) => void
}

/**
 * Strip unused-feature packages omitted from the packaged `node_modules` out of the packaged root
 * manifest (`dependencies`, `optionalDependencies`, and `dsh.optionalBundles`). Leaving an excluded
 * official optional bundle such as `@deepseek-ai/dsh-experimental-voice-input-bundle` in
 * `app.asar/package.json` makes `@deepseek-ai/dsh-plugin-manager` treat it as installation-shipped,
 * fail to read its missing manifest, and surface a broken "Not installed / Problem" card in Plugins.
 * @param manifest - Parsed source application manifest.
 * @returns A pruned manifest when any entry matched the unused-feature table, else undefined.
 */
function stripUnusedFeatureManifestDeclarations(manifest: Record<string, unknown>): Record<string, unknown> | undefined {
  let changed = false
  const next: Record<string, unknown> = { ...manifest }
  for (const field of ['dependencies', 'optionalDependencies'] as const) {
    const record = next[field]
    if (record !== null && typeof record === 'object' && !Array.isArray(record)) {
      const entries = Object.entries(record as Record<string, unknown>)
      const kept = entries.filter(([name]) => nextRuntimeUnusedFeatureExclusion(name) === undefined)
      if (kept.length !== entries.length) {
        next[field] = Object.fromEntries(kept)
        changed = true
      }
    }
  }
  const dsh = next.dsh
  if (dsh !== null && typeof dsh === 'object' && !Array.isArray(dsh)) {
    const dshRecord = dsh as Record<string, unknown>
    if (Array.isArray(dshRecord.optionalBundles)) {
      const kept = dshRecord.optionalBundles.filter(
        name => typeof name !== 'string' || nextRuntimeUnusedFeatureExclusion(name) === undefined,
      )
      if (kept.length !== dshRecord.optionalBundles.length) {
        next.dsh = { ...dshRecord, optionalBundles: kept }
        changed = true
      }
    }
  }
  return changed ? next : undefined
}

/**
 * Materialize the payload: the shell files, the application manifest as electron-builder would
 * transform it, the production closure with the file policy applied and every manifest cleaned
 * the way electron-builder cleans it, then the sealed descriptor at the payload root.
 * @param options - Source, destination, target and release facts.
 * @returns The sealed descriptor, already verified against the prepared tree.
 */
export async function preparePayload(options: PreparePayloadOptions): Promise<DesktopRuntimeDescriptor> {
  const { desktopRoot, output, target } = options
  const log = options.log ?? (() => {})
  packagingStepSync('payload:reset', () => {
    rmSync(output, { recursive: true, force: true })
    mkdirSync(output, { recursive: true })
  })
  packagingStepSync('payload:copy-shell', () => {
    for (const entry of SHELL_ENTRIES) {
      const source = join(desktopRoot, ...entry.split('/'))
      if (!existsSync(source)) throw new Error(`Next payload: missing shell entry ${entry}`)
      copyTree(source, join(output, ...entry.split('/')), (path, name) => !IGNORED_NAMES.has(name) && nextRuntimeFileExclusion(`${entry}/${path}`, target) === undefined)
    }
  })
  const rawMainManifest = readFileSync(join(desktopRoot, 'package.json'))
  const prunedMainManifest = stripUnusedFeatureManifestDeclarations(JSON.parse(rawMainManifest.toString('utf8')) as Record<string, unknown>)
  writeFileSync(
    join(output, 'package.json'),
    prunedMainManifest === undefined ? rawMainManifest : `${JSON.stringify(prunedMainManifest, undefined, 2)}\n`,
  )
  const transformMain = createTransformer(output, {}, options.extraMetadata)
  const mainManifest = await packagingStep('payload:transform-main-manifest', async () => transformMain(join(output, 'package.json')))
  if (mainManifest != null) writeFileSync(join(output, 'package.json'), mainManifest)
  if (target.platform === 'darwin') {
    packagingStepSync('payload:prepare-cua', () => prepareCuaNative(desktopRoot, target.archs.map((arch) => {
      if (arch !== 'arm64' && arch !== 'x64') throw new Error(`Unsupported macOS CUA architecture: ${arch}`)
      return arch
    })))
  }
  const { packages: closure, skipped } = packagingStepSync('payload:collect-dependencies', () => collectProductionClosureReport(desktopRoot, target))
  for (const entry of skipped) log(`Skipped unused feature ${entry.name} (required by ${entry.requiredBy.join(', ')}): ${entry.reason}`)
  // Beside the payload rather than inside it: the sealed tree admits only the application's own root entries.
  writeFileSync(join(dirname(output), SKIPPED_FEATURES_FILE), `${JSON.stringify({ target, skipped }, undefined, 2)}\n`)
  const modules = join(output, 'node_modules')
  packagingStepSync('payload:copy-dependencies', () => {
    for (const pkg of closure) copyPackage(pkg, modules, target)
  })
  log(`Materialized ${String(closure.length)} packages for ${target.platform} ${target.archs.join('/')}`)
  const transform = createTransformer(output, {}, undefined)
  const manifestPaths: string[] = []
  packagingStepSync('payload:scan-manifests', () => {
    for (const entry of readdirSync(modules, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && entry.name === 'package.json') manifestPaths.push(join(entry.parentPath, entry.name))
    }
  })
  await packagingStep('payload:transform-manifests', () => Promise.all(manifestPaths.map(async (path) => {
    const transformed = await transform(path)
    if (transformed != null) writeFileSync(path, transformed)
  })))
  const source = packagingStepSync('payload:inventory-files', () => physicalPayload(output))
  packagingStepSync('payload:verify-dependencies', () => verifyNextPayload(source))
  const release = nextPayloadRelease(source, options.electronVersion)
  const manifest = readManifest(output)
  const skippedNames = new Set(skipped.map(entry => entry.name))
  const sharedNames = Object.keys(manifest.dependencies ?? {}).filter(name => !skippedNames.has(name)
    && (!Object.hasOwn(manifest.optionalDependencies ?? {}, name) || source.entry(`node_modules/${name}/package.json`) !== undefined))
  const file = join(output, DESKTOP_RUNTIME_FILE)
  const windowsCode = new Set<string>()
  const hashSource = target.platform === 'win32' ? windowsCodePayload(source, windowsCode) : source
  const descriptor = await packagingStep('payload:hash-and-seal', () => sealPayloadAsync(hashSource, file, release, sharedNames, target))
  if (target.platform === 'win32') {
    writeWindowsCodeFiles(output, windowsCode)
    log(`Discovered ${String(windowsCode.size)} Windows PE files while hashing the payload`)
  }
  log(`Sealed the prepared payload: ${String(descriptor.files.length)} files; OmniMux ${release.version}, dsh ${release.dshVersion}, Electron ${release.electronVersion}, pnpm ${release.pnpmVersion}`)
  return descriptor
}

/** Electron release the application package embeds. */
function electronVersion(desktopRoot: string): string {
  const require = createRequire(join(desktopRoot, 'package.json'))
  return (JSON.parse(readFileSync(require.resolve('electron/package.json'), 'utf8')) as { version: string }).version
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { values } = parseArgs({ options: { platform: { type: 'string' }, arch: { type: 'string' }, version: { type: 'string' } }, allowPositionals: false })
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const platform = (values.platform ?? process.platform) as NodeJS.Platform
  if (values.arch !== undefined && (platform !== 'darwin' || !['arm64', 'x64', 'universal'].includes(values.arch))) {
    throw new Error(`Next payload: --arch selects arm64, x64 or universal for a macOS package; received ${values.arch} for ${platform}`)
  }
  await preparePayload({
    desktopRoot, output: join(desktopRoot, ...payloadDir((values.platform ?? process.platform) as NodeJS.Platform).split('/')),
    target: nextPackagingTarget((values.platform ?? process.platform) as NodeJS.Platform, process.arch, (values.arch as MacPackageArch | undefined) ?? process.env),
    electronVersion: electronVersion(desktopRoot),
    ...(values.version === undefined ? {} : { extraMetadata: { version: values.version } }),
    log: message => console.log(message),
  })
}
