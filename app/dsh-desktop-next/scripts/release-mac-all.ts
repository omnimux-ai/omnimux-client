/** Build arm64 and x64 macOS candidates from one shared release preflight. */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeMacRelease } from '../../dsh-plugin-desktop/scripts/mac-signing-probe.ts'
import { adaptMacReleaseEnvironment, withoutMacReleaseSecrets } from '../../dsh-plugin-desktop/scripts/release-preflight.ts'
import { assertReleaseSource, macReleaseArchitecture } from '../../dsh-plugin-desktop/scripts/release-mac.ts'
import { expectedNextVersion, type NextRuntimeArch } from './prepare-runtime.ts'
import { packagingStep, packagingStepSync, summarizePackagingJournal } from './packaging-step.ts'
import { verifyNextMacEntitlements } from './verify-mac-entitlements.ts'

const desktopRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const workspaceRoot = resolve(desktopRoot, '..')
const repoRoot = resolve(workspaceRoot, '..')
const version = expectedNextVersion(desktopRoot)
const archs: readonly NextRuntimeArch[] = ['arm64', 'x64']
const notaryProfile = process.env.APPLE_KEYCHAIN_PROFILE ?? 'AC_PASSWORD'
const candidate = process.env.DSH_MAC_RELEASE_CANDIDATE === '1'

interface CommandResult {
  readonly stdout: string
  readonly stderr: string
}

function childEnvironment(arch: NextRuntimeArch, outputRoot: string, runRoot: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DSH_AA_USE_VENDORED: '1',
    DSH_MARKET_USE_VENDORED: '1',
    DSH_MAC_RELEASE_ARCH: arch,
    DSH_MAC_RELEASE_OUTPUT: join(outputRoot, arch),
    DSH_DESKTOP_PACKAGING_RUN_DIR: join(runRoot, arch),
    DSH_MAC_RELEASE_COMMON_PREP: '1',
    DSH_PACKAGING_ARCH: arch,
  }
}

function commonEnvironment(runRoot: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DSH_AA_USE_VENDORED: '1',
    DSH_MARKET_USE_VENDORED: '1',
    DSH_DESKTOP_PACKAGING_RUN_DIR: runRoot,
  }
}

function runSync(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, label: string): void {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', timeout: 45 * 60 * 1000 })
  if (result.error !== undefined) throw new Error(`${label}: ${result.error.message}`, { cause: result.error })
  if (result.status !== 0) throw new Error(`${label}: ${command} ${args.join(' ')} exited with ${String(result.status)}`)
}

function runCapture(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, label: string): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', error => reject(new Error(`${label}: ${error.message}`, { cause: error })))
    child.on('close', status => {
      if (status === 0) resolvePromise({ stdout, stderr })
      else reject(new Error(`${label}: ${command} ${args.join(' ')} exited with ${String(status)}\n${stderr.trim()}`))
    })
  })
}

function runChild(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, label: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child: ChildProcess = spawn(command, args, { cwd, env, stdio: 'inherit' })
    child.on('error', error => reject(new Error(`${label}: ${error.message}`, { cause: error })))
    child.on('close', status => {
      if (status === 0) resolvePromise()
      else reject(new Error(`${label}: ${command} ${args.join(' ')} exited with ${String(status)}`))
    })
  })
}


function mergeEvents(runRoot: string): string {
  const files = [join(runRoot, 'events.jsonl'), ...archs.map(arch => join(runRoot, arch, 'events.jsonl'))]
  const events = new Map<string, Record<string, unknown>>()
  for (const file of files) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.trim() === '') continue
      try {
        const event = JSON.parse(line) as Record<string, unknown>
        events.set(`${String(event.stageId)}:${String(event.type)}`, event)
      } catch { /* An interrupted worker may leave a partial record. */ }
    }
  }
  const journal = [...events.values()].sort((left, right) => String(left.time ?? '').localeCompare(String(right.time ?? '')))
  const output = join(runRoot, 'events.jsonl')
  writeFileSync(output, `${journal.map(event => JSON.stringify(event)).join('\n')}${journal.length === 0 ? '' : '\n'}`)
  return output
}

function findDirectories(root: string, suffix: string): string[] {
  if (!existsSync(root)) return []
  const found: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (!statSync(path).isDirectory()) continue
    if (entry.name.endsWith(suffix)) found.push(path)
    else found.push(...findDirectories(path, suffix))
  }
  return found
}

async function prepareCommon(runRoot: string): Promise<void> {
  const env = commonEnvironment(runRoot)
  const safeEnv = withoutMacReleaseSecrets(env)
  await packagingStep('sign:probe', () => probeMacRelease(env))
  if (!candidate) packagingStepSync('release:source-check', () => assertReleaseSource(repoRoot))
  packagingStepSync('prepare:once:aa', () => {
    runSync('yarn', ['aa:prepare-release'], workspaceRoot, safeEnv, 'AA prepare')
    runSync(process.execPath, ['scripts/prepare-agents-anywhere-release.mjs', '--verify-release'], workspaceRoot, safeEnv, 'AA verify')
  })
  packagingStepSync('prepare:once:market', () => {
    runSync('yarn', ['workspace', 'dsh-community-market', 'build'], workspaceRoot, safeEnv, 'market build')
    runSync(process.execPath, ['scripts/prepare-dsh-market.mjs', '--check'], workspaceRoot, safeEnv, 'market check')
  })
  packagingStepSync('prepare:once:plugins', () => {
    runSync(process.execPath, [resolve(repoRoot, 'scripts', 'prepare-local-plugins.mjs')], repoRoot, safeEnv, 'plugin build')
  })
  packagingStepSync('prepare:once:check', () => {
    // The packaging gate runs the full workspace check once. Keep Vitest serial so the
    // large temporary Asar fixtures cannot race each other under the release build load.
    runSync('yarn', ['run', 'check'], workspaceRoot, { ...safeEnv, VITEST_MAX_THREADS: '1' }, 'workspace check')
  })
}

async function buildApp(arch: NextRuntimeArch, outputRoot: string, runRoot: string): Promise<string> {
  const outputDir = join(outputRoot, arch)
  const childEnv = childEnvironment(arch, outputRoot, runRoot)
  await runChild(process.execPath, ['scripts/package.ts', 'mac-app'], desktopRoot, childEnv, `build ${arch} app`)
  const app = findDirectories(outputDir, '.app').find(path => existsSync(join(path, 'Contents', 'MacOS', 'OmniMux')))
  if (app === undefined) throw new Error(`build ${arch} app: no OmniMux.app found below ${outputDir}`)
  const slices = arch === 'arm64' ? ['arm64'] : ['x86_64']
  await packagingStep(`sign:verify-app:${arch}`, async () => {
    runSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], desktopRoot, childEnv, `verify ${arch} signature`)
    verifyNextMacEntitlements(app, undefined, slices)
  })
  console.log(`Verified ${arch} signed application and entitlements: ${app}`)
  return app
}

async function submitAndWait(arch: NextRuntimeArch, appPath: string, outputDir: string, env: NodeJS.ProcessEnv): Promise<{ readonly submissionId: string; readonly zip: string }> {
  const zip = join(outputDir, `OmniMux-${version}-${arch}.zip`)
  runSync('ditto', ['-c', '-k', '--keepParent', appPath, zip], desktopRoot, env, `zip ${arch}`)
  const submitted = await packagingStep(`notary:submit:${arch}`, () => runCapture('xcrun', ['notarytool', 'submit', '--no-wait', '--output-format', 'json', zip,
    '--keychain-profile', notaryProfile], desktopRoot, env, `notarize submit ${arch}`))
  let submissionId: string
  try {
    const parsed = JSON.parse(submitted.stdout) as { id?: unknown }
    if (typeof parsed.id !== 'string' || parsed.id.length === 0) throw new Error('missing id')
    submissionId = parsed.id
  } catch (error) {
    throw new Error(`notarize submit ${arch}: unexpected notarytool output: ${submitted.stdout.trim()}`, { cause: error })
  }
  console.log(`Notarization submitted for ${arch}: ${submissionId}`)
  await packagingStep(`notary:wait:${arch}`, async () => {
    const result = await runCapture('xcrun', ['notarytool', 'wait', submissionId, '--keychain-profile', notaryProfile,
      '--output-format', 'json'], desktopRoot, env, `notarize wait ${arch}`)
    if ((JSON.parse(result.stdout) as { status?: string }).status !== 'Accepted') {
      throw new Error(`Apple did not accept ${arch} notarization. Inspect notarytool log for submission ${submissionId}.`)
    }
  })
  await packagingStep(`notary:staple:${arch}`, async () => {
    runSync('xcrun', ['stapler', 'staple', appPath], desktopRoot, env, `staple ${arch}`)
  })
  return { submissionId, zip }
}

async function buildDmg(arch: NextRuntimeArch, appPath: string, outputDir: string, env: NodeJS.ProcessEnv): Promise<string> {
  const dmg = join(outputDir, `OmniMux-${version}-${arch}.dmg`)
  const staging = mkdtempSync(join(tmpdir(), `omnimux-dmg-stage-${arch}-`))
  const writable = join(outputDir, `.OmniMux-${version}-${arch}.rw.dmg`)
  const mountPoint = mkdtempSync(join(tmpdir(), `omnimux-dmg-mount-${arch}-`))
  const icon = join(desktopRoot, 'build', 'app-icon.icns')
  let mounted = false
  await packagingStep(`dmg:build:${arch}`, async () => {
    try {
      // Match electron-builder's default DMG presentation: the application, the
      // Applications shortcut and a volume icon. `hdiutil -srcfolder app` alone
      // produces a bare app-only image and changes the install experience.
      runSync('ditto', [appPath, join(staging, 'OmniMux.app')], desktopRoot, env, `dmg staging ${arch}`)
      symlinkSync('/Applications', join(staging, 'Applications'), 'dir')
      if (existsSync(icon)) copyFileSync(icon, join(staging, '.VolumeIcon.icns'))
      runSync('hdiutil', ['create', '-volname', 'OmniMux', '-srcfolder', staging, '-ov', '-format', 'UDRW', '-fs', 'HFS+', writable], desktopRoot, env, `dmg rw image ${arch}`)
      runSync('hdiutil', ['attach', writable, '-mountpoint', mountPoint, '-nobrowse'], desktopRoot, env, `dmg mount ${arch}`)
      mounted = true
      runSync('SetFile', ['-a', 'C', mountPoint], desktopRoot, env, `dmg icon flag ${arch}`)
      runSync('hdiutil', ['detach', mountPoint], desktopRoot, env, `dmg detach ${arch}`)
      mounted = false
      packagingStepSync(`dmg:compress:${arch}`, () => runSync('hdiutil', ['convert', writable, '-format', 'ULFO', '-o', dmg], desktopRoot, env, `dmg convert ${arch}`))
    } finally {
      if (mounted) {
        try { runSync('hdiutil', ['detach', mountPoint], desktopRoot, env, `dmg cleanup detach ${arch}`) } catch { /* preserve the original failure */ }
      }
      rmSync(staging, { recursive: true, force: true })
      rmSync(mountPoint, { recursive: true, force: true })
      rmSync(writable, { force: true })
    }
  })
  return dmg
}

async function verifyDmg(arch: NextRuntimeArch, outputDir: string, env: NodeJS.ProcessEnv): Promise<void> {
  // The final verifier launches a real GUI. Run the two mounted-app smokes one at a
  // time: on an Apple Silicon host the x64 app runs through Rosetta, and two cold
  // GUI launches can exceed the per-package 20s readiness budget when overlapped.
  await packagingStep(`verify:mac:${arch}`, () => runChild(process.execPath, ['scripts/verify-mac-release.ts', outputDir], desktopRoot, env, `verify ${arch} dmg`))
}

async function packageArchitectures(outputRoot: string, runRoot: string): Promise<object> {
  await prepareCommon(runRoot)
  const buildResults: PromiseSettledResult<string>[] = []
  if (adaptMacReleaseEnvironment(process.env).CSC_LINK) {
    // Builder temporarily updates the user keychain search list when importing a P12.
    for (const arch of archs) buildResults.push(...await Promise.allSettled([buildApp(arch, outputRoot, runRoot)]))
  } else {
    buildResults.push(...await Promise.allSettled(archs.map(arch => buildApp(arch, outputRoot, runRoot))))
  }
  const buildFailures = buildResults.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (buildFailures.length > 0) {
    throw new AggregateError(buildFailures.map(result => result.reason), 'one or more macOS app builds failed')
  }
  const apps = new Map<NextRuntimeArch, string>()
  archs.forEach((arch, index) => {
    const result = buildResults[index]
    if (result?.status !== 'fulfilled') throw new Error(`missing ${arch} build result`)
    apps.set(arch, result.value)
  })
  // Submit and wait are separate phases so upload time and Apple wait time are both visible.
  const notaryResults = await Promise.allSettled(archs.map(arch => {
    const app = apps.get(arch)
    if (app === undefined) throw new Error(`missing ${arch} application`)
    return submitAndWait(arch, app, join(outputRoot, arch), childEnvironment(arch, outputRoot, runRoot))
  }))
  const notaryFailures = notaryResults.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (notaryFailures.length > 0) {
    throw new AggregateError(notaryFailures.map(result => result.reason), 'one or more notarization submissions failed')
  }
  const dmgResults = await Promise.allSettled(archs.map(arch => {
    const app = apps.get(arch)
    if (app === undefined) throw new Error(`missing ${arch} application`)
    return buildDmg(arch, app, join(outputRoot, arch), childEnvironment(arch, outputRoot, runRoot))
  }))
  const dmgFailures = dmgResults.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (dmgFailures.length > 0) {
    throw new AggregateError(dmgFailures.map(result => result.reason), 'one or more macOS DMG builds failed')
  }
  const dmgs = new Map<NextRuntimeArch, string>()
  archs.forEach((arch, index) => {
    const result = dmgResults[index]
    if (result?.status !== 'fulfilled') throw new Error(`missing ${arch} DMG result`)
    dmgs.set(arch, result.value)
  })
  const verifyFailures: unknown[] = []
  for (const arch of archs) {
    try {
      await verifyDmg(arch, join(outputRoot, arch), childEnvironment(arch, outputRoot, runRoot))
    } catch (error) {
      verifyFailures.push(error)
    }
  }
  if (verifyFailures.length > 0) {
    throw new AggregateError(verifyFailures, 'one or more macOS DMG verifications failed')
  }
  return Object.fromEntries(archs.map(arch => [arch, { app: apps.get(arch), dmg: dmgs.get(arch) }]))
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('release:mac:all must be built on macOS')
  if (macReleaseArchitecture(process.env) !== 'universal') throw new Error('release:mac:all uses per-architecture builds; do not set DSH_MAC_RELEASE_ARCH')
  const runRoot = resolve(desktopRoot, process.env.DSH_DESKTOP_PACKAGING_RUN_DIR ?? join('dist', 'release-runs', `${version}-${new Date().toISOString().replaceAll(/[:.]/gu, '-')}`))
  const outputRoot = resolve(desktopRoot, process.env.DSH_MAC_RELEASE_OUTPUT_ROOT ?? join('dist', 'release-assets'))
  mkdirSync(runRoot, { recursive: true })
  mkdirSync(outputRoot, { recursive: true })
  process.env.DSH_DESKTOP_PACKAGING_RUN_DIR = runRoot
  console.log(`release:mac:all ${candidate ? 'candidate' : 'release'} version ${version}; output ${outputRoot}; run ${runRoot}`)
  let artifacts: object | undefined
  try {
    artifacts = await packageArchitectures(outputRoot, runRoot)
  } finally {
    const events = mergeEvents(runRoot)
    const summary = {
      version, candidate, success: artifacts !== undefined,
      sourceCommit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim(),
      outputRoot, runRoot, events, archs: artifacts, timing: summarizePackagingJournal(events),
    }
    writeFileSync(join(runRoot, 'summary.json'), `${JSON.stringify(summary, undefined, 2)}\n`)
    console.log(`release:mac:all timings saved to ${join(runRoot, 'summary.json')}`)
  }
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
}
