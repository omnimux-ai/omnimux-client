/** Sign the bundled interpreter payloads before electron-builder signs the enclosing application; ported from upstream Desktop. */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { primaryRuntimePythonAliases, readPrimaryRuntime } from '@deepseek-ai/dsh-tool-workspace-dependencies'
import { isMachO } from './primary-runtime.ts'

/** The pinned upstream checkout owns the entitlement files the payload executables receive. */
export const UPSTREAM_DESKTOP_SCRIPTS = resolve(import.meta.dirname, '..', '..', 'deepseek-harness', 'apps', 'desktop', 'scripts')

/** A Developer ID Application identity as `security find-identity` prints it, and the keychain holding its key when that is not on the login search list. */
export interface MacRuntimeSigningIdentity {
  readonly identity: string
  readonly selector?: string
  readonly keychain?: string
}

/** Signs one file in place. */
export type SignRuntimeCode = (file: string, identifier: string, identity: MacRuntimeSigningIdentity, entitlements: string | undefined) => Promise<void>
/** Verifies one signed file. */
export type VerifyRuntimeCode = (file: string, identity: MacRuntimeSigningIdentity) => void

type RuntimeSigningTools = { readonly signVerified: SignRuntimeCode }
  | { readonly sign: SignRuntimeCode; readonly verify: VerifyRuntimeCode; readonly pause?: (attempt: number) => Promise<void> }

/**
 * Entitlements one payload file needs. The standalone Node runs V8 and needs JIT; its x64 build also
 * maps executable memory without signatures, including under Rosetta. Python and its extension
 * modules run without entitlements, as upstream Desktop signs them. The Office helper beside the
 * archive is signed by electron-builder with the inherited application entitlements.
 * @param path - Payload-relative POSIX path.
 * @param arch - Payload CPU.
 * @returns Entitlement plist, or undefined for a hardened-runtime signature without entitlements.
 */
export function runtimeEntitlements(path: string, arch: 'arm64' | 'x64'): string | undefined {
  if (path !== 'dependencies/node/bin/node') return undefined
  return join(UPSTREAM_DESKTOP_SCRIPTS, arch === 'x64' ? 'node-x64-entitlements.plist' : 'jit-entitlements.plist')
}

async function listFiles(root: string): Promise<string[]> {
  let hasManifest = false
  try { hasManifest = lstatSync(join(root, 'runtime.json')).isFile() } catch { /* fixtures without runtime.json */ }
  const aliases = hasManifest ? await primaryRuntimePythonAliases(root, await readPrimaryRuntime(root)) : new Map<string, string>()
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = directory === '' ? entry.name : `${directory}/${entry.name}`
      if (entry.isSymbolicLink()) {
        if (aliases.has(path)) continue
        throw new Error(`Next runtime signing: the payload must not contain links: ${path}`)
      }
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  visit('')
  return files
}

/** Attempts for one signature whose secure timestamp request fails; every signature asks Apple's timestamp service. */
export const TIMESTAMP_ATTEMPTS = 3

/**
 * Whether codesign reported a secure timestamp it could not obtain rather than a signature it could not make.
 * @param error - Failure of one signature.
 * @returns True for the timestamp service's failures; a payload path naming a timestamp only retries a failure.
 */
export function isTimestampFailure(error: unknown): boolean {
  return error instanceof Error && /timestamp/iu.test(error.message)
}

/** Wait before asking the timestamp service again. */
const timestampBackoff = (attempt: number): Promise<void> => new Promise(resolve => setTimeout(resolve, 2_000 * attempt))

/**
 * Sign and verify every Mach-O file of one payload in place, awaiting all signers on failure.
 * @param root - Self-contained payload without symlinks other than validated Python aliases.
 * @param appId - Release application identifier.
 * @param identity - Required signing identity.
 * @param arch - Payload CPU, independent of the signing host.
 * @param tools - Injectable signer and verifier, and the wait between timestamp attempts.
 * @returns Number of signed native files.
 */
export async function signMacRuntime(
  root: string, appId: string, identity: MacRuntimeSigningIdentity, arch: 'arm64' | 'x64',
  tools: RuntimeSigningTools = { sign: signMacOSRuntimeCode, verify: verifyMacOSRuntimeCode },
): Promise<number> {
  const files = (await listFiles(root)).filter(path => isMachO(join(root, path)))
  const signVerified: SignRuntimeCode = 'signVerified' in tools ? tools.signVerified : async (file, identifier, signer, entitlements) => {
    await withSigningTimestampRetry(() => tools.sign(file, identifier, signer, entitlements), tools.pause)
    tools.verify(file, signer)
  }
  await processSigningFiles(files, path => signVerified(join(root, path),
    `${appId}.runtime.${createHash('sha256').update(path).digest('hex')}`, identity, runtimeEntitlements(path, arch)))
  return files.length
}

/** Retry Apple's secure timestamp request, keeping the normal failure behaviour for other errors. */
export async function withSigningTimestampRetry(action: () => Promise<void>, pause = timestampBackoff): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try { return await action() } catch (error) {
      if (attempt >= TIMESTAMP_ATTEMPTS || !isTimestampFailure(error)) throw error
      await pause(attempt)
    }
  }
}

/** Limit concurrent Apple timestamp requests and let in-flight work settle before unwinding. */
export async function processSigningFiles(files: readonly string[], sign: (file: string) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(4, files.length) }, async () => {
    for (;;) {
      const file = files[next++]
      if (file === undefined) return
      await sign(file)
    }
  })
  const outcomes = await Promise.allSettled(workers)
  const errors = outcomes.filter(result => result.status === 'rejected').map(result => result.reason as unknown)
  if (errors.length > 0) throw new AggregateError(errors, `Next runtime: native signing failed\n${errors.map(error => error instanceof Error ? error.message : String(error)).join('\n')}`)
}

/** Run codesign and return both streams: `--display` reports on stderr. */
function runCodesign(args: readonly string[]): string {
  const result = spawnSync('/usr/bin/codesign', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error !== undefined) throw new Error(`Next runtime signing: could not execute codesign: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`Next runtime signing: codesign ${args[0] ?? ''} ${result.signal ?? `exited with ${String(result.status)}`}: ${`${result.stdout}${result.stderr}`.trim()}`)
  }
  return `${result.stdout}${result.stderr}`
}

/**
 * Sign one Mach-O file with a hardened-runtime, timestamped signature.
 * @param file - Writable standalone Mach-O file.
 * @param identifier - Stable code-signing identifier derived from the release app ID and the payload path.
 * @param identity - Release identity and optional keychain.
 * @param entitlements - Optional entitlement plist for this executable.
 * @returns Resolves after codesign exits successfully.
 */
export function signMacOSRuntimeCode(file: string, identifier: string, identity: MacRuntimeSigningIdentity, entitlements: string | undefined): Promise<void> {
  const args = ['--force', '--sign', identity.selector ?? identity.identity, ...(identity.keychain === undefined ? [] : ['--keychain', identity.keychain]),
    '--identifier', identifier, '--timestamp', '--options', 'runtime', ...(entitlements === undefined ? [] : ['--entitlements', entitlements]), file]
  return new Promise((resolvePromise, reject) => {
    const child = spawn('/usr/bin/codesign', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { output += chunk })
    child.stderr.on('data', (chunk: string) => { output += chunk })
    child.once('error', error => { reject(new Error(`Next runtime signing: could not execute codesign: ${error.message}`)) })
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`Next runtime signing: codesign ${signal ?? `exited with ${String(code)}`} for ${file}${output.trim() === '' ? '' : `: ${output.trim()}`}`))
    })
  })
}

/**
 * Require the signature properties Apple validates for executable runtime content.
 * @param details - Output from `codesign --display --verbose=4`.
 * @param identity - Release identity.
 */
export function assertMacRuntimeSignature(details: string, identity: MacRuntimeSigningIdentity): void {
  const lines = details.split(/\r?\n/u).map(line => line.trim())
  const team = /\(([A-Z0-9]{10})\)\s*$/u.exec(identity.identity)?.[1]
  const expected = [`Authority=${identity.identity}`, ...(team === undefined ? [] : [`TeamIdentifier=${team}`])]
  const missing = expected.filter(field => !lines.includes(field))
  if (missing.length > 0) throw new Error(`Next runtime signing: signature does not match the release identity; missing ${missing.join(', ')}`)
  if (!lines.some(line => /^Timestamp=.+/u.test(line))) throw new Error('Next runtime signing: runtime signature has no secure timestamp')
  if (!lines.some(line => /\bflags=0x[0-9a-f]+\(runtime\)(?:\s|$)/iu.test(line))) throw new Error('Next runtime signing: runtime signature does not enable hardened runtime')
}

/**
 * Verify one signed payload file.
 * @param file - Mach-O file to inspect.
 * @param identity - Release identity.
 */
export function verifyMacOSRuntimeCode(file: string, identity: MacRuntimeSigningIdentity): void {
  runCodesign(['--verify', '--strict', '--verbose=2', file])
  assertMacRuntimeSignature(runCodesign(['--display', '--verbose=4', file]), identity)
}

/**
 * Read the entitlements a signed file carries.
 * @param file - Signed file.
 * @returns Entitlement keys and values; empty for a signature without entitlements.
 */
export function readSignedEntitlements(file: string): Record<string, unknown> {
  const result = spawnSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error !== undefined) throw new Error(`Next runtime signing: could not execute codesign: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`Next runtime signing: codesign -d ${result.signal ?? `exited with ${String(result.status)}`}: ${result.stderr.trim()}`)
  if (result.stdout.trim() === '') return {}
  return JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { input: result.stdout, encoding: 'utf8' })) as Record<string, unknown>
}
