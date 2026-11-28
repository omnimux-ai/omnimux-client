/** Local macOS Dev cutover. The previous installation is archived only on the recovery share. */

import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  accessSync,
  constants,
  createReadStream,
  closeSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { list as listTar } from 'tar'
import { acquireDesktopDataOperationLock } from './desktop-data-operation-lock.ts'
import { MANAGED_GRAPH_ENTRIES } from './managed-profile.ts'

const ROOT_KEYS = ['appPath', 'homeDir', 'userDataDir'] as const
const ARCHIVE_OPTIONS = ['--acls', '--xattrs', '--mac-metadata']
const HASH = /^[a-f0-9]{64}$/

type RootKey = (typeof ROOT_KEYS)[number]
type Phase = 'prepared' | 'switching' | 'switched' | 'recovering' | 'restored' | 'accepted'

export interface DevUpgradePaths {
  readonly appPath: string
  readonly homeDir: string
  readonly userDataDir: string
}

interface TransactionHooks {
  readonly requireNetworkMount?: (path: string) => void
  readonly verifyApp?: (path: string) => void
}

export interface DevRecoveryOptions {
  readonly paths: DevUpgradePaths
  readonly recoveryDir: string
  /** Fixtures can exercise real file I/O without a real network share or signed App. */
  readonly hooks?: TransactionHooks
}

interface DevUpgradeOptions extends DevRecoveryOptions {
  readonly candidateApp: string
  readonly profileDir: string
  readonly graph: {
    readonly candidateDir: string
    readonly entries: readonly string[]
    readonly verify: (profileDir: string) => void
  }
  readonly confirmStopped: () => void
}

interface DevRollbackOptions extends DevRecoveryOptions {
  readonly confirmStopped: () => void
}

interface ArchiveReceipt {
  readonly root: RootKey
  readonly sha256: string
  readonly content: string
}

interface Receipt {
  readonly version: 1
  readonly id: string
  readonly paths: DevUpgradePaths
  readonly phase: Phase
  readonly archives: readonly ArchiveReceipt[]
}

interface ActiveTransaction {
  readonly id: string
  readonly recoveryDir: string
}

interface TreeEntry {
  readonly path: string
  readonly kind: 'directory' | 'file' | 'link'
  readonly mode: number
  readonly value: string
  readonly inode: string
}

function physicalDirectory(path: string): number {
  if (!isAbsolute(path) || path !== resolve(path) || realpathSync(path) !== path) {
    throw new Error('Expected a canonical physical directory: ' + path)
  }
  const info = lstatSync(path)
  if (!info.isDirectory()) throw new Error('Expected a directory: ' + path)
  return info.dev
}

function inside(root: string, path: string): boolean {
  const tail = relative(root, path)
  return tail === '' || (tail !== '..' && !tail.startsWith('..' + sep) && !isAbsolute(tail))
}

function requireNetworkMount(path: string): void {
  const mounts = spawnSync('/sbin/mount', ['-t', 'smbfs,nfs'], { encoding: 'utf8' })
  if (mounts.status !== 0) throw new Error('Could not inspect mounted recovery volumes')
  const match = mounts.stdout.split('\n').some(line => {
    const mount = / on (.+) \((?:smbfs|nfs)(?:,|\))/.exec(line)?.[1]
    return mount !== undefined && inside(mount, path) && lstatSync(mount).dev === lstatSync(path).dev
  })
  if (!match) throw new Error('Recovery directory must be on a mounted SMB or NFS volume')
}

function validatePaths(options: DevRecoveryOptions, liveRequired: boolean): number {
  const { paths, recoveryDir } = options
  if (process.platform !== 'darwin' && !options.hooks?.requireNetworkMount) {
    throw new Error('Dev recovery is available on macOS')
  }
  const parent = dirname(recoveryDir)
  if (recoveryDir === parent || !isAbsolute(recoveryDir) || recoveryDir !== resolve(recoveryDir) ||
      basename(recoveryDir).startsWith('.')) {
    throw new Error('Recovery directory must be an absolute, named child directory')
  }
  const recoveryDevice = physicalDirectory(parent)
  const checkMount = options.hooks?.requireNetworkMount ?? requireNetworkMount
  checkMount(parent)
  const targets = ROOT_KEYS.map(key => paths[key])
  for (const [index, target] of targets.entries()) {
    const targetInfo = lstatSync(target, { throwIfNoEntry: false })
    const targetDevice = physicalDirectory(dirname(target))
    if (targetInfo !== undefined || liveRequired) physicalDirectory(target)
    if (targetInfo && targetInfo.dev !== targetDevice) throw new Error('Dev target must share its parent filesystem')
    if (!options.hooks?.requireNetworkMount && targetDevice === recoveryDevice) {
      throw new Error('Dev installation and recovery share must be on different filesystems')
    }
    if (inside(target, recoveryDir) || inside(recoveryDir, target) ||
        targets.slice(index + 1).some(other => inside(target, other) || inside(other, target))) {
      throw new Error('Dev paths and recovery directory must be independent')
    }
  }
  if (!paths.appPath.endsWith('.app')) throw new Error('Dev application path must end in .app')
  accessSync(parent, constants.W_OK | constants.X_OK)
  return recoveryDevice
}

function assertNewRecoveryDirectory(recoveryDir: string): void {
  if (lstatSync(recoveryDir, { throwIfNoEntry: false })) throw new Error('Recovery directory already exists')
}

function controlPath(paths: DevUpgradePaths): string {
  return join(dirname(paths.homeDir), basename(paths.homeDir) + '-upgrade-control')
}

function activePath(paths: DevUpgradePaths): string {
  return join(controlPath(paths), 'active.json')
}

function readJson(path: string): unknown {
  const info = lstatSync(path)
  if (realpathSync(path) !== path || !info.isFile() || info.size > 16_384) throw new Error('Unsafe transaction record')
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function readActive(paths: DevUpgradePaths): ActiveTransaction | undefined {
  const path = activePath(paths)
  if (!lstatSync(path, { throwIfNoEntry: false })) return undefined
  const result = readJson(path) as Partial<ActiveTransaction> | null
  if (!result || typeof result.id !== 'string' || typeof result.recoveryDir !== 'string') {
    throw new Error('Invalid Dev transaction record')
  }
  return { id: result.id, recoveryDir: result.recoveryDir }
}

function requireNoActiveTransaction(paths: DevUpgradePaths): void {
  if (readActive(paths)) throw new Error('An existing Dev upgrade requires acceptance or recovery')
}

function syncFile(path: string): void {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function writeRecord(path: string, value: unknown): void {
  const temporary = join(dirname(path), '.' + randomUUID() + '.partial')
  const descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
  try {
    writeFileSync(descriptor, JSON.stringify(value) + '\n')
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  renameSync(temporary, path)
  syncFile(dirname(path))
}

function receiptPath(options: DevRecoveryOptions): string {
  return join(options.recoveryDir, 'receipt.json')
}

function assertBatch(options: DevRecoveryOptions, device: number): void {
  const info = lstatSync(options.recoveryDir)
  if (physicalDirectory(options.recoveryDir) !== device || (info.mode & 0o077) !== 0) {
    throw new Error('Recovery directory must stay private and on its original NAS volume')
  }
}

function setPhase(options: DevRecoveryOptions, device: number, receipt: Receipt, phase: Phase): Receipt {
  const next: Receipt = { ...receipt, phase }
  assertBatch(options, device)
  writeRecord(receiptPath(options), next)
  return next
}

function readReceipt(options: DevRecoveryOptions, device: number): Receipt {
  assertBatch(options, device)
  const result = readJson(receiptPath(options)) as Partial<Receipt> | null
  if (!result || result.version !== 1 || typeof result.id !== 'string' || !result.paths ||
      !result.phase || !['prepared', 'switching', 'switched', 'recovering', 'restored', 'accepted'].includes(result.phase) ||
      ROOT_KEYS.some(key => result.paths?.[key] !== options.paths[key]) || !Array.isArray(result.archives) ||
      result.archives.length !== ROOT_KEYS.length || ROOT_KEYS.some(key => !result.archives?.some((entry: ArchiveReceipt) =>
        entry?.root === key && HASH.test(entry.sha256) && HASH.test(entry.content)))) {
    throw new Error('Invalid recovery receipt or Dev target mismatch')
  }
  return result as Receipt
}

function requireActiveBatch(options: DevRecoveryOptions, receipt: Receipt): void {
  const current = readActive(options.paths)
  if (current?.id !== receipt.id || current.recoveryDir !== options.recoveryDir) {
    throw new Error('Recovery batch is not the active Dev upgrade')
  }
}

function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { stdio: 'ignore' })
  if (result.status !== 0) throw new Error(basename(command) + ' failed', { cause: result.error })
}

function verifyApp(path: string): void {
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', path])
}

function readPhysicalFile(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  return createReadStream(path, { fd })
}

async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const bytes of readPhysicalFile(path)) hash.update(bytes as Buffer)
  return hash.digest('hex')
}

async function readTree(root: string): Promise<Map<string, TreeEntry>> {
  const entries = new Map<string, TreeEntry>()
  const files = new Map<string, string>()
  async function visit(path: string, name: string): Promise<void> {
    const info = lstatSync(path)
    const mode = info.mode & 0o7777
    const inode = String(info.dev) + ':' + String(info.ino)
    if (info.isDirectory()) {
      entries.set(name, { path: name, kind: 'directory', mode, value: '', inode })
      for (const child of readdirSync(path).sort()) await visit(join(path, child), name + '/' + child)
    } else if (info.isSymbolicLink()) {
      entries.set(name, { path: name, kind: 'link', mode, value: readlinkSync(path), inode })
    } else if (info.isFile()) {
      const value = files.get(inode) ?? await fileHash(path)
      if (info.nlink > 1) files.set(inode, value)
      entries.set(name, { path: name, kind: 'file', mode, value, inode })
    } else {
      throw new Error('Dev data contains a file type that cannot be restored')
    }
  }
  await visit(root, basename(root))
  return entries
}

function treeHash(entries: Map<string, TreeEntry>): string {
  const hash = createHash('sha256')
  for (const path of [...entries.keys()].sort()) {
    const entry = entries.get(path)!
    hash.update(JSON.stringify([entry.path, entry.kind, entry.mode, entry.value]) + '\n')
  }
  return hash.digest('hex')
}

function archivePath(options: DevRecoveryOptions, root: RootKey): string {
  return join(options.recoveryDir, root + '.tar')
}

async function verifyArchive(path: string, tree: Map<string, TreeEntry>): Promise<string> {
  const seen = new Set<string>()
  const metadata = new Set<string>()
  const archiveHash = createHash('sha256')
  await new Promise<void>((resolveArchive, reject) => {
    const input = readPhysicalFile(path)
    const failVerification = (error: Error) => {
      reject(error)
      input.destroy()
    }
    const parser = listTar({
      strict: true,
      onReadEntry: entry => {
        const name = entry.path.replace(/\/$/, '')
        const expected = tree.get(name)
        if (!expected && entry.type === 'File' && basename(name).startsWith('._')) {
          const base = basename(name).slice(2)
          const target = dirname(name) === '.' ? base : dirname(name) + '/' + base
          if (tree.has(target) && !metadata.has(name)) {
            metadata.add(name)
            return
          }
        }
        if (!expected || seen.has(name) || entry.mode === undefined || (entry.mode & 0o7777) !== expected.mode) {
          failVerification(new Error('Recovery archive path or permissions do not match the Dev installation'))
          return
        }
        seen.add(name)
        if (expected.kind === 'directory' && entry.type === 'Directory') return
        if (expected.kind === 'link' && entry.type === 'SymbolicLink' && entry.linkpath === expected.value) return
        if (expected.kind === 'file' && entry.type === 'Link' && entry.linkpath &&
            tree.get(entry.linkpath)?.inode === expected.inode) return
        if (expected.kind === 'file' && entry.type === 'File') {
          const hash = createHash('sha256')
          entry.on('data', (bytes: Buffer) => hash.update(bytes))
          entry.on('end', () => {
            if (hash.digest('hex') !== expected.value) failVerification(new Error('Recovery archive file verification failed'))
          })
          return
        }
        failVerification(new Error('Recovery archive entry type does not match the Dev installation'))
      },
    })
    input.on('data', bytes => archiveHash.update(bytes))
    input.once('error', reject)
    parser.once('error', failVerification)
    parser.once('end', () => {
      if (seen.size !== tree.size) reject(new Error('Recovery archive is incomplete'))
      else resolveArchive()
    })
    input.pipe(parser)
  })
  return archiveHash.digest('hex')
}

function archiveIdentity(path: string): string {
  // SMB refreshes cached modification times when a closed write is next opened for reading.
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = fstatSync(descriptor, { bigint: true })
    if (!info.isFile()) throw new Error('Recovery archive is not a physical file')
    return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':')
  } finally {
    closeSync(descriptor)
  }
}

async function capture(options: DevRecoveryOptions, device: number, root: RootKey): Promise<ArchiveReceipt> {
  assertBatch(options, device)
  const source = options.paths[root]
  const archive = archivePath(options, root)
  const temporary = archive + '.partial'
  const descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
  try {
    if (fstatSync(descriptor).dev !== device) throw new Error('Recovery archive is outside its NAS volume')
    // Archive logical file bytes. The streaming verifier expects ordinary PAX
    // members, while libarchive otherwise substitutes GNU sparse paths.
    const tar = spawnSync('/usr/bin/tar', ['-c', '--format=pax', '--no-read-sparse', ...ARCHIVE_OPTIONS, '-f', '-', '-C', dirname(source), '--', basename(source)], {
      stdio: ['ignore', descriptor, 'ignore'],
    })
    if (tar.status !== 0) throw new Error('Could not archive stopped Dev on NAS', { cause: tar.error })
    fchmodSync(descriptor, 0o600)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  const tree = await readTree(source)
  const original = archiveIdentity(temporary)
  const sha256 = await verifyArchive(temporary, tree)
  if (archiveIdentity(temporary) !== original) throw new Error('Recovery archive changed during verification')
  assertBatch(options, device)
  renameSync(temporary, archive)
  syncFile(options.recoveryDir)
  return { root, sha256, content: treeHash(tree) }
}

function acquireUpgradeLock(paths: DevUpgradePaths, operation: string) {
  const directory = controlPath(paths)
  if (lstatSync(directory, { throwIfNoEntry: false })) physicalDirectory(directory)
  return acquireDesktopDataOperationLock(directory, operation)
}

function lock<T>(paths: DevUpgradePaths, operation: string, task: () => T): T {
  const lease = acquireUpgradeLock(paths, operation)
  try {
    return task()
  } finally {
    lease.release()
  }
}

async function lockAsync<T>(paths: DevUpgradePaths, operation: string, task: () => Promise<T>): Promise<T> {
  const lease = acquireUpgradeLock(paths, operation)
  try {
    return await task()
  } finally {
    lease.release()
  }
}

function ensureProfileGraph(options: DevUpgradeOptions): void {
  const { paths, profileDir, graph } = options
  if (profileDir !== join(paths.homeDir, 'profiles', 'omnimux') || graph.entries.length !== MANAGED_GRAPH_ENTRIES.length ||
      MANAGED_GRAPH_ENTRIES.some(name => !graph.entries.includes(name)) ||
      ROOT_KEYS.some(key => inside(paths[key], graph.candidateDir) || inside(graph.candidateDir, paths[key]))) {
    throw new Error('Refused an unsupported Dev dependency graph')
  }
  if (physicalDirectory(profileDir) !== physicalDirectory(graph.candidateDir)) {
    throw new Error('Candidate graph must be staged on the Dev Profile filesystem')
  }
  for (const entry of MANAGED_GRAPH_ENTRIES) {
    const info = lstatSync(join(graph.candidateDir, entry))
    const directory = entry === 'node_modules' || entry === '.materialize-snapshots'
    if (directory ? !info.isDirectory() : !info.isFile()) throw new Error('Candidate graph is incomplete')
  }
}

function removeActive(paths: DevUpgradePaths): void {
  rmSync(activePath(paths))
  syncFile(controlPath(paths))
}

export function inspectDevUpgrade(options: DevRecoveryOptions): { recoveryDir: string; availableBytes: string } {
  validatePaths(options, true)
  requireNoActiveTransaction(options.paths)
  assertNewRecoveryDirectory(options.recoveryDir)
  const volume = statfsSync(dirname(options.recoveryDir), { bigint: true })
  return { recoveryDir: options.recoveryDir, availableBytes: String(volume.bsize * volume.bavail) }
}

export async function upgradeDevWithRecovery(options: DevUpgradeOptions): Promise<void> {
  validatePaths(options, true)
  await lockAsync(options.paths, 'Dev profile upgrade', async () => {
    inspectDevUpgrade(options)
    options.confirmStopped()
    ensureProfileGraph(options)
    const { paths, recoveryDir, candidateApp, profileDir, graph } = options
    const checkApp = options.hooks?.verifyApp ?? verifyApp
    physicalDirectory(candidateApp)
    if (!candidateApp.endsWith('.app') || ROOT_KEYS.some(key => inside(paths[key], candidateApp) || inside(candidateApp, paths[key]))) {
      throw new Error('Candidate application must be an independent .app bundle')
    }
    checkApp(paths.appPath)
    const scratch = mkdtempSync(join(dirname(paths.appPath), '.omnimux-dev-candidate-'))
    try {
      const stagedApp = join(scratch, basename(paths.appPath))
      run('/usr/bin/ditto', [candidateApp, stagedApp])
      checkApp(stagedApp)
      options.confirmStopped()
      const device = validatePaths(options, true)
      try {
        mkdirSync(recoveryDir, { mode: 0o700 })
      } catch (cause) {
        throw new Error('Could not reserve a new NAS recovery directory', { cause })
      }
      const receipt: Receipt = {
        version: 1, id: randomUUID(), paths, phase: 'prepared', archives: [],
      }
      const archives: ArchiveReceipt[] = []
      const identities = new Map<RootKey, string>()
      for (const root of ROOT_KEYS) {
        archives.push(await capture(options, device, root))
        identities.set(root, archiveIdentity(archivePath(options, root)))
      }
      const captured = setPhase(options, device, { ...receipt, archives }, 'prepared')
      options.confirmStopped()
      ensureProfileGraph(options)
      if (validatePaths(options, true) !== device) throw new Error('Recovery share changed before cutover')
      assertBatch(options, device)
      if (ROOT_KEYS.some(root => archiveIdentity(archivePath(options, root)) !== identities.get(root))) {
        throw new Error('Recovery archive changed before cutover')
      }
      // The local pointer contains only transaction metadata. It blocks a second cutover until
      // acceptance or recovery even if the process dies after deleting the first live entry.
      writeRecord(activePath(paths), { id: receipt.id, recoveryDir })
      setPhase(options, device, captured, 'switching')
      // Leave the shared App path absent throughout publication. A Dock launch must not
      // open either shell against a hybrid Profile.
      rmSync(paths.appPath, { recursive: true })
      syncFile(dirname(paths.appPath))
      for (const name of MANAGED_GRAPH_ENTRIES) {
        const target = join(profileDir, name)
        rmSync(target, { recursive: true, force: true })
        renameSync(join(graph.candidateDir, name), target)
      }
      syncFile(profileDir)
      graph.verify(profileDir)
      options.confirmStopped()
      assertBatch(options, device)
      renameSync(stagedApp, paths.appPath)
      syncFile(dirname(paths.appPath))
      checkApp(paths.appPath)
      setPhase(options, device, captured, 'switched')
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })
}

export async function recoverDevFromArchive(options: DevRollbackOptions): Promise<void> {
  const device = validatePaths(options, false)
  await lockAsync(options.paths, 'Dev profile recovery', async () => {
    const receipt = readReceipt(options, device)
    if (receipt.phase === 'restored' && !readActive(options.paths)) return
    requireActiveBatch(options, receipt)
    options.confirmStopped()

    if (receipt.phase === 'prepared' || receipt.phase === 'restored') {
      setPhase(options, device, receipt, 'restored')
      removeActive(options.paths)
      return
    }
    if (receipt.phase === 'accepted') throw new Error('An accepted upgrade cannot be rolled back automatically')

    const staging: { scratch: string; source: string; target: string }[] = []
    try {
      for (const { root, sha256, content } of receipt.archives) {
        assertBatch(options, device)
        const archive = archivePath(options, root)
        const identity = archiveIdentity(archive)
        if (await fileHash(archive) !== sha256) throw new Error('NAS archive checksum differs from its receipt')
        const target = options.paths[root]
        const scratch = mkdtempSync(join(dirname(target), '.omnimux-dev-restore-'))
        const source = join(scratch, basename(target))
        staging.push({ scratch, source, target })
        run('/usr/bin/tar', ['-x', '-p', '-S', ...ARCHIVE_OPTIONS, '-f', archive, '-C', scratch])
        if (archiveIdentity(archive) !== identity) throw new Error('Recovery archive changed during restore')
        if (treeHash(await readTree(source)) !== content) throw new Error('Restored Dev data differs from the NAS archive')
        if (root === 'appPath') (options.hooks?.verifyApp ?? verifyApp)(source)
      }
      options.confirmStopped()
      if (validatePaths(options, false) !== device) throw new Error('Recovery share changed before restore')
      setPhase(options, device, receipt, 'recovering')
      const { appPath } = options.paths
      rmSync(appPath, { recursive: true, force: true })
      syncFile(dirname(appPath))
      for (const { source, target } of staging) {
        if (target === appPath) continue
        rmSync(target, { recursive: true, force: true })
        renameSync(source, target)
        syncFile(dirname(target))
      }
      const restoredApp = staging.find(({ target }) => target === appPath)!
      options.confirmStopped()
      assertBatch(options, device)
      renameSync(restoredApp.source, appPath)
      syncFile(dirname(appPath))
      setPhase(options, device, receipt, 'restored')
      removeActive(options.paths)
    } finally {
      for (const { scratch } of staging) rmSync(scratch, { recursive: true, force: true })
    }
  })
}

export function acceptDevUpgrade(options: DevRecoveryOptions): void {
  const device = validatePaths(options, true)
  lock(options.paths, 'Dev profile upgrade acceptance', () => {
    const receipt = readReceipt(options, device)
    if (receipt.phase === 'accepted' && !readActive(options.paths)) return
    requireActiveBatch(options, receipt)
    if (receipt.phase !== 'switched' && receipt.phase !== 'accepted') throw new Error('Dev upgrade has not completed its cutover')
    setPhase(options, device, receipt, 'accepted')
    removeActive(options.paths)
  })
}
