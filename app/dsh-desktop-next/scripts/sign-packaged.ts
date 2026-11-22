/** Electron Builder's signed Next release hook, after the prepared payload audit and thinning. */
import { execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { ProbedMacIdentity } from '../../dsh-plugin-desktop/scripts/mac-signing-probe.ts'
import { MacSignatureCache, type MacSignaturePolicy } from './mac-signature-cache.ts'
import { packagingCacheSummary, packagingStep, packagingStepSync } from './packaging-step.ts'
import { expectedNextVersion, primaryRuntimeDirectory, smokeNextRuntime, verifyNextRuntimeTree } from './prepare-runtime.ts'
import { isThinMachOExecutable, machOArchitectures } from './primary-runtime.ts'
import { assertMacRuntimeSignature, processSigningFiles, signMacOSRuntimeCode, signMacRuntime, withSigningTimestampRetry, type MacRuntimeSigningIdentity } from './sign-runtime.ts'

const CODESIGN = '/usr/bin/codesign'
const desktopRoot = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
type BuilderSigning = typeof import('app-builder-lib/out/codeSign/macCodeSign.js')
type SignOptions = Parameters<BuilderSigning['sign']>[0]

export function macSigningEnvironment(identity: ProbedMacIdentity): NodeJS.ProcessEnv {
  return { DSH_NEXT_SIGNING_IDENTITY: identity.identity, DSH_NEXT_SIGNING_LEAF_SHA1: identity.leafSha1, DSH_NEXT_SIGNING_LEAF_SHA256: identity.leafSha256 }
}

function signingPolicyDigest(): string {
  const hash = createHash('sha256')
  for (const file of ['sign-packaged.ts', 'sign-runtime.ts', 'mac-signature-cache.ts', 'primary-runtime.ts']) {
    hash.update(file).update('\0').update(readFileSync(join(import.meta.dirname, file)))
  }
  return hash.digest('hex')
}

/** Avoid pre-signing nested bundles. Electron Builder owns their executable, resources and identifier. */
export function unpackedMachOFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const files: string[] = []
  const visit = (path: string): void => {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
      const relative = join(path, entry.name)
      if (entry.isDirectory() && !/\.(?:app|appex|bundle|framework|plugin|xpc)$/iu.test(entry.name)) visit(relative)
      if (entry.isFile() && machOArchitectures(join(root, relative)).some(arch => arch === 'arm64' || arch === 'x64')) files.push(relative)
    }
  }
  visit('')
  return files
}

function codesign(args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(CODESIGN, args, { encoding: 'utf8', timeout: 120_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`codesign ${args[0]} failed during native signature verification: ${stderr.trim()}`))
      else resolve({ stdout, stderr })
    })
  })
}

function parsePlist(body: string): object {
  if (body.trim() === '') return {}
  return JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { input: body, encoding: 'utf8' })) as object
}

async function verifySignature(
  file: string, identity: MacRuntimeSigningIdentity, policy: MacSignaturePolicy, entitlements: object,
): Promise<void> {
  await codesign(['--verify', '--all-architectures', '--strict', file])
  const directory = await mkdtemp(join(tmpdir(), 'omnimux-signature-'))
  try {
    const prefix = join(directory, 'cert-')
    const architectures = machOArchitectures(file)
    for (const arch of architectures) {
      if (arch === 'other') throw new Error('Unsupported Mach-O architecture in release signing')
      const { stdout, stderr } = await codesign(['--display', '--verbose=4', '--arch', arch === 'x64' ? 'x86_64' : arch, `--extract-certificates=${prefix}`, '--entitlements', ':-', file])
      assertMacRuntimeSignature(stderr, identity)
      if (!stderr.split(/\r?\n/u).includes(`Identifier=${policy.identifier}`)) throw new Error('Code signing identifier mismatch')
      const fingerprint = createHash('sha256').update(await readFile(`${prefix}0`)).digest('hex')
      if (fingerprint !== policy.leafSha256) throw new Error('Code signing leaf certificate mismatch')
      if (!isDeepStrictEqual(parsePlist(stdout), entitlements)) throw new Error('Code signing entitlements mismatch')
    }
    if (architectures.length === 0) throw new Error('No Mach-O architecture found during release verification')
  } finally { await rm(directory, { recursive: true, force: true }) }
}

/** Ignore only exact paths for which pre-signing has already completed and verified. */
export function preSignedIgnore(original: SignOptions['ignore'], verified: ReadonlySet<string>): (file: string) => boolean {
  const originalFilters = Array.isArray(original) ? original : original === undefined ? [] : [original]
  return file => verified.has(file) || originalFilters.some(filter => typeof filter === 'function' ? filter(file) : file.match(filter) !== null)
}

export default async function signPackagedApp(options: SignOptions): Promise<void> {
  const name = process.env.DSH_NEXT_SIGNING_IDENTITY
  const sha1 = process.env.DSH_NEXT_SIGNING_LEAF_SHA1
  const sha256 = process.env.DSH_NEXT_SIGNING_LEAF_SHA256
  if (options.platform !== 'darwin' || options.type !== 'distribution' || !name?.startsWith('Developer ID Application: ')
    || sha1 === undefined || !/^[0-9A-F]{40}$/u.test(sha1) || sha1 !== options.identity?.toUpperCase()
    || sha256 === undefined || !/^[0-9a-f]{64}$/u.test(sha256)) {
    throw new Error('Electron Builder did not select the probed Developer ID Application certificate. Check CSC_NAME and the signing Keychain.')
  }
  const identity = { identity: name, selector: sha1, keychain: options.keychain }
  const cacheRoot = process.env.DSH_MAC_SIGNATURE_CACHE_DIR ?? join(homedir(), 'Library', 'Caches', 'omnimux-desktop-signatures')
  if (!isAbsolute(cacheRoot)) throw new Error('DSH_MAC_SIGNATURE_CACHE_DIR must be an absolute path')
  const cache = new MacSignatureCache(cacheRoot)
  const defaults = await packagingStep('cache:mac-signatures:prepare', async () => {
    await cache.prepare()
    return {
      mode: 'developer-id-hardened-timestamped' as const,
      leafSha256: sha256,
      codesignSha256: createHash('sha256').update(readFileSync(CODESIGN)).digest('hex'),
      policySha256: signingPolicyDigest(),
      macOSVersion: execFileSync('/usr/bin/sw_vers', { encoding: 'utf8' }).trim(),
    }
  })
  const entitlementPolicies = new Map<string, { readonly digest: string; readonly values: object }>()
  const signNative = (file: string, identifier: string, entitlementFile: string | undefined): Promise<void> => {
    if (entitlementFile !== undefined && !entitlementPolicies.has(entitlementFile)) {
      const contents = readFileSync(entitlementFile, 'utf8')
      entitlementPolicies.set(entitlementFile, { digest: createHash('sha256').update(contents).digest('hex'), values: parsePlist(contents) })
    }
    const entitlements = entitlementFile === undefined ? undefined : entitlementPolicies.get(entitlementFile)
    const policy = { ...defaults, identifier, entitlementsSha256: entitlements?.digest ?? null }
    return cache.sign(file, policy, candidate => withSigningTimestampRetry(() => signMacOSRuntimeCode(candidate, identifier, identity, entitlementFile)),
      candidate => verifySignature(candidate, identity, policy, entitlements?.values ?? {}), machOArchitectures(file).length === 1)
  }
  const appId = (JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as { build: { appId: string } }).build.appId
  const resources = join(options.app, 'Contents', 'Resources')
  const runtime = join(resources, 'runtime')
  const unpacked = join(resources, 'app.asar.unpacked')
  const verified = new Set<string>()
  try {
    await packagingStep('sign:primary-runtime', async () => {
      for (const { arch } of verifyNextRuntimeTree(runtime, 'darwin', expectedNextVersion(desktopRoot))) {
        if (arch !== 'arm64' && arch !== 'x64') throw new Error('Unexpected Mac runtime architecture')
        await signMacRuntime(primaryRuntimeDirectory(runtime, arch), appId, identity, arch, {
          signVerified: (file, identifier, _signer, entitlementFile) => signNative(file, identifier, entitlementFile),
        })
      }
    })
    packagingStepSync('sign:verify-runtime-smoke', () => smokeNextRuntime(runtime, 'darwin'))
    await packagingStep('sign:asar-unpacked', async () => {
      const shouldIgnore = preSignedIgnore(options.ignore, verified)
      await processSigningFiles(unpackedMachOFiles(unpacked), async (path) => {
        const file = join(unpacked, path)
        const policy = options.optionsForFile?.(file)
        // If Builder changes the per-file policy, leave that file with the default signer.
        if (shouldIgnore(file) || machOArchitectures(file).length !== 1 || policy?.hardenedRuntime !== true
          || typeof policy.entitlements !== 'string' || policy.timestamp || policy.requirements || policy.signatureFlags || policy.additionalArguments?.length) return
        const identifier = `${appId}.unpacked.${createHash('sha256').update(path).digest('hex')}`
        // macOS preserves the inherited plist on executables only. Builder's dylib and .node signatures have no entitlements.
        await signNative(file, identifier, isThinMachOExecutable(file) ? policy.entitlements : undefined)
        verified.add(file)
      })
    })
  } finally {
    await packagingStep('cache:mac-signatures:prune', () => cache.prune())
    packagingCacheSummary('cache:mac-signatures', cache)
  }
  console.log(`Verified ${String(verified.size)} pre-signed unpacked Mach-O files (${String(cache.hits)} cache hits, ${String(cache.misses)} misses in total).`)
  const { sign } = require('app-builder-lib/out/codeSign/macCodeSign.js') as BuilderSigning
  await packagingStep('sign:app', () => sign({ ...options, ignore: preSignedIgnore(options.ignore, verified) }))
}
