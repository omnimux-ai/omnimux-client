/** Prove that the release identity can actually sign before preparing any build inputs. */
import { spawnSync } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adaptMacReleaseEnvironment, assertMacReleaseReady, withoutMacReleaseSecrets, type MacReleasePreflightResult } from './release-preflight.ts'
import { withMacSigningIdentity, type RunAppleCommand } from './sign-runtime.ts'

const SECURITY = '/usr/bin/security'
const CODESIGN = '/usr/bin/codesign'
const PROBE_BUDGET_MS = 1_500
const CLEANUP_BUDGET_MS = 175
const DEVELOPER_ID_PREFIX = 'Developer ID Application: '

interface Identity {
  readonly sha1: string
  readonly name: string
  readonly status?: string
}

export interface ProbedMacIdentity extends MacReleasePreflightResult {
  readonly leafSha1: string
  readonly leafSha256: string
}

function identities(output: string): Identity[] {
  return Array.from(output.matchAll(/^\s*\d+\)\s+([0-9a-f]{40})\s+"(Developer ID Application: [^"]+)"(?:\s+\(([^)]+)\))?/gimu), match => ({
    sha1: match[1]!.toUpperCase(), name: match[2]!, ...(match[3] === undefined ? {} : { status: match[3] }),
  }))
}

function readIdentities(run: RunAppleCommand, name?: string, keychain?: string): Identity[] {
  const output = run(SECURITY, ['find-identity', '-p', 'codesigning', ...(keychain === undefined ? [] : [keychain])])
  const validOutput = output.split(/^[ \t]*Valid identities only:?[ \t]*$/mu)[1] ?? ''
  const valid = identities(validOutput).filter(identity => identity.status === undefined && (name === undefined || identity.name === name))
  if (valid.length > 0) return valid
  if (identities(output).some(identity => (name === undefined || identity.name === name) && /CERT_EXPIRED|expired/iu.test(identity.status ?? ''))) {
    throw new Error('The Developer ID Application certificate has expired. Install a renewed certificate and private key, then retry.')
  }
  throw new Error('No usable Developer ID Application identity was found. Check CSC_NAME and install its certificate and private key in an unlocked Keychain.')
}

function runBefore(deadline: () => number, env: NodeJS.ProcessEnv): RunAppleCommand {
  return (command, args) => {
    const remaining = Math.ceil(deadline() - performance.now())
    if (remaining <= 0) throw new Error('macOS signing probe timed out. Unlock the signing Keychain and allow codesign to use the private key.')
    const result = spawnSync(command, args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: remaining, killSignal: 'SIGKILL' })
    if (result.error !== undefined && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
      throw new Error('macOS signing probe timed out. Unlock the signing Keychain and allow codesign to use the private key.')
    }
    if (result.status !== 0) {
      const diagnostic = `${result.stdout ?? ''}${result.stderr ?? ''}`
      if (/interaction is not allowed|keychain is locked|errSecInteractionNotAllowed|errSecInternalComponent/iu.test(diagnostic)) {
        throw new Error('The signing Keychain is locked or codesign cannot access the private key. Unlock the Keychain and check the key’s access controls.')
      }
      if (/CERT_EXPIRED|certificate has expired/iu.test(diagnostic)) {
        throw new Error('The Developer ID Application certificate has expired. Install a renewed certificate and private key, then retry.')
      }
      // Raw command and output can include signing credentials from security import.
      throw new Error(`macOS signing probe failed in ${command === SECURITY ? `security ${args[0]}` : 'codesign'}. Check the signing certificate, its private key, and Keychain access.`)
    }
    return result.stdout
  }
}

/** Test the selected identity without an Apple timestamp request. Release artifacts still require secure timestamps. */
export async function probeMacRelease(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  execute?: RunAppleCommand,
): Promise<ProbedMacIdentity> {
  const deadline = performance.now() + PROBE_BUDGET_MS
  const env = adaptMacReleaseEnvironment(environment)
  const safeEnv = { ...withoutMacReleaseSecrets(env), LC_ALL: 'C' }
  const run = execute ?? runBefore(() => deadline, safeEnv)
  let selected: Identity | undefined
  const configuredName = env.CSC_NAME?.trim()
  const ready = assertMacReleaseReady({
    env, platform,
    listCodeSigningIdentities: () => {
      selected = readIdentities(run, configuredName ? `${DEVELOPER_ID_PREFIX}${configuredName}` : undefined)[0]
      return selected === undefined ? '' : `"${selected.name}"`
    },
  })
  let cleanupBy: number | undefined
  const cleanup = execute ?? runBefore(() => cleanupBy ??= performance.now() + CLEANUP_BUDGET_MS, safeEnv)
  return withMacSigningIdentity(env, ready.identity, async ({ keychain }) => {
    const identity = selected ?? readIdentities(run, ready.identity, keychain)[0]!
    const directory = mkdtempSync(join(tmpdir(), 'omnimux-signing-probe-'))
    try {
      const file = join(directory, 'true')
      const certificatePrefix = join(directory, 'leaf-')
      copyFileSync('/usr/bin/true', file)
      run(CODESIGN, ['--force', '--sign', identity.sha1, ...(keychain === undefined ? [] : ['--keychain', keychain]), '--timestamp=none', '--options', 'runtime', file])
      run(CODESIGN, ['--verify', '--strict', file])
      run(CODESIGN, ['--display', `--extract-certificates=${certificatePrefix}`, file])
      const certificate = new X509Certificate(readFileSync(`${certificatePrefix}0`))
      if (certificate.validToDate.getTime() <= Date.now()) throw new Error('The Developer ID Application certificate has expired. Install a renewed certificate and private key, then retry.')
      if (certificate.validFromDate.getTime() > Date.now()) throw new Error('The Developer ID Application certificate is not valid yet. Check the system clock and certificate dates.')
      if (certificate.fingerprint.replaceAll(':', '') !== identity.sha1) throw new Error('codesign selected a different certificate. Check CSC_NAME and remove ambiguity in the signing Keychain.')
      return { ...ready, leafSha1: identity.sha1, leafSha256: certificate.fingerprint256.replaceAll(':', '').toLowerCase() }
    } finally { rmSync(directory, { recursive: true, force: true }) }
  }, run, { probe: false, cleanup })
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    const { signing, notarization } = await probeMacRelease()
    console.log(`macOS signing probe passed (${signing}, ${notarization}).`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
