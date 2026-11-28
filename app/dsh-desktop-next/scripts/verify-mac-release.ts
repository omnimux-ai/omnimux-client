/** Reuse the signed DMG verifier with Next's application identity, once for every package a release or smoke builds. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MACOS_UNIVERSAL_NATIVE_ENTRIES, macSmokeArchitecture } from './mac-universal.ts'
import { macReleaseArchitecture } from './release-mac.ts'
import { smokeMacApp } from './smoke-mac-app.ts'
import { verifyAppBuildInfo } from './verify-build-info.ts'
import { macDmgArch, macPackageCpus, macReleaseArchs, nextMacNativeEntries, type MacPackageArch } from './mac-runtime.ts'
import { macApplicationDirectory, macSmokeTarget } from './package-targets.ts'
import { verifyMacEntitlements, verifyNextMacEntitlements } from './verify-mac-entitlements.ts'
import { verifyDesktopMacRuntime, verifyNextMacRuntime } from './verify-mac-runtime.ts'

/** Injectable filesystem and command boundaries for release verification. */
export interface MacReleaseVerificationOptions {
  readonly archSlices?: readonly string[]
  readonly nativeEntries?: readonly { readonly arch: string; readonly path: string }[]
  readonly unpackedRoot?: (appPath: string) => string
  readonly distDir: string
  readonly productName: string
  readonly listDmgs: (distDir: string) => readonly string[]
  readonly makeMountPoint: () => string
  readonly run: (command: string, args: readonly string[]) => void
  readonly verifyEntitlements?: (appPath: string, productName: string) => void
  readonly verifyRuntime?: (appPath: string) => void
  readonly verifyBuildInfo?: (appPath: string) => void
  readonly smokeApp?: (appPath: string) => void | Promise<void>
  readonly removeMountPoint: (mountPoint: string) => void
  readonly detachRetryDelaysMs?: readonly number[]
  readonly sleep?: (milliseconds: number) => void
}

function listReleaseDmgs(distDir: string): readonly string[] {
  return readdirSync(distDir).filter(name => name.endsWith('.dmg')).map(name => join(distDir, name)).filter(path => statSync(path).isFile())
}

const VERIFY_COMMAND_TIMEOUT_MS = 10 * 60 * 1000

function runReleaseCommand(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit', timeout: VERIFY_COMMAND_TIMEOUT_MS })
  if (result.error !== undefined) throw result.error
  if (result.signal === 'SIGTERM') throw new Error(`${command} ${args.join(' ')} timed out after ${VERIFY_COMMAND_TIMEOUT_MS / 60000}m`)
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
}

function detachImage(options: MacReleaseVerificationOptions, mountPoint: string): void {
  const busyFailure = (cause: unknown): boolean => /(?:resource busy|couldn't unmount|资源忙)/iu.test(cause instanceof Error ? cause.message : String(cause))
  const delays = options.detachRetryDelaysMs ?? [1_000, 2_000, 4_000]
  const sleep = options.sleep ?? (milliseconds => { spawnSync('sleep', [String(milliseconds / 1_000)], { stdio: 'ignore' }) })
  const failures: unknown[] = []
  for (const [index, delay] of [0, ...delays].entries()) {
    if (index > 0) sleep(delay)
    try { options.run('hdiutil', ['detach', mountPoint]); return } catch (cause) {
      if (!busyFailure(cause)) throw cause
      failures.push(cause)
    }
  }
  try { options.run('diskutil', ['eject', mountPoint]); return } catch (cause) {
    failures.push(cause)
    throw new AggregateError(failures, `hdiutil detach and diskutil eject failed for ${mountPoint}`)
  }
}

function defaultReleaseOptions(): MacReleaseVerificationOptions {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  return {
    distDir: process.argv[2] === undefined ? join(packageRoot, 'dist', 'mac-release') : resolve(process.argv[2]),
    productName: 'OmniMux',
    listDmgs: listReleaseDmgs,
    makeMountPoint: () => mkdtempSync(join(tmpdir(), 'omnimux-dmg-')),
    run: runReleaseCommand,
    verifyEntitlements: verifyMacEntitlements,
    verifyRuntime: appPath => verifyDesktopMacRuntime(appPath, true),
    verifyBuildInfo: appPath => verifyAppBuildInfo(appPath, { packageDir: 'dsh-desktop-next' }),
    smokeApp: appPath => smokeMacApp(appPath),
    removeMountPoint: mountPoint => rmdirSync(mountPoint),
  }
}

/**
 * Mount and verify the application contained in the unique release DMG.
 * @param options - Filesystem and command boundaries.
 * @returns The verified DMG and application paths.
 */
export async function verifyMacRelease(
  options: MacReleaseVerificationOptions = defaultReleaseOptions(),
): Promise<{ readonly appPath: string; readonly dmgPath: string }> {
  const dmgs = options.listDmgs(options.distDir)
  if (dmgs.length !== 1) {
    throw new Error(`macOS release verification requires exactly one DMG in ${options.distDir}; found ${String(dmgs.length)}`)
  }
  const dmgPath = dmgs[0]!
  const mountPoint = options.makeMountPoint()
  const appPath = join(mountPoint, `${options.productName}.app`)
  let mounted = false
  let failure: unknown
  try {
    options.run('hdiutil', ['attach', dmgPath, '-mountpoint', mountPoint, '-nobrowse', '-readonly'])
    mounted = true
    const executablePath = join(appPath, 'Contents', 'MacOS', options.productName)
    for (const slice of options.archSlices ?? ['x86_64', 'arm64']) {
      console.log(`[verify-mac] lipo executable ${slice}`)
      options.run('lipo', [executablePath, '-verify_arch', slice])
    }
    const unpackedRoot = options.unpackedRoot === undefined ? join(appPath, 'Contents', 'Resources', 'app') : options.unpackedRoot(appPath)
    for (const entry of options.nativeEntries ?? MACOS_UNIVERSAL_NATIVE_ENTRIES) {
      console.log(`[verify-mac] lipo native ${entry.arch} ${entry.path}`)
      options.run('lipo', [join(unpackedRoot, entry.path), '-verify_arch', entry.arch])
      if (entry.path.endsWith('/bin/uv')) {
        options.run('/bin/test', ['-x', join(unpackedRoot, entry.path)])
        if (entry.arch === (process.arch === 'x64' ? 'x86_64' : process.arch)) {
          console.log(`[verify-mac] exec uv --version`)
          options.run(join(unpackedRoot, entry.path), ['--version'])
        }
      }
    }
    console.log(`[verify-mac] codesign --verify --deep app`)
    options.run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
    console.log(`[verify-mac] entitlements`)
    options.verifyEntitlements?.(appPath, options.productName)
    console.log(`[verify-mac] runtime payload`)
    options.verifyRuntime?.(appPath)
    console.log(`[verify-mac] build-info`)
    options.verifyBuildInfo?.(appPath)
    console.log(`[verify-mac] gui smoke`)
    await options.smokeApp?.(appPath)
    console.log(`[verify-mac] spctl assess`)
    options.run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath])
    console.log(`[verify-mac] stapler validate`)
    options.run('xcrun', ['stapler', 'validate', appPath])
  } catch (cause) {
    failure = cause
  }
  const cleanupFailures: unknown[] = []
  if (mounted) {
    try { detachImage(options, mountPoint) } catch (cause) { cleanupFailures.push(cause) }
  }
  try { options.removeMountPoint(mountPoint) } catch (cause) { cleanupFailures.push(cause) }
  if (failure !== undefined || cleanupFailures.length > 0) {
    const failures = failure === undefined ? cleanupFailures : [failure, ...cleanupFailures]
    throw new AggregateError(failures, `failed to verify macOS release DMG ${basename(dmgPath)}`)
  }
  return { appPath, dmgPath }
}

function execute(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 10 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.signal === 'SIGTERM') throw new Error(`Artifact verification timed out after 10m: ${command} ${args.join(' ')}`)
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`Artifact verification failed: ${command} ${args.join(' ')}${result.stderr ? `: ${result.stderr.trim()}` : ''}`)
  }
}

export function expectedMacDmgs(dmgs: readonly string[], expected: readonly MacPackageArch[]): [MacPackageArch, string][] {
  const found = dmgs.map(dmg => [macDmgArch(dmg), dmg] as const)
  const unnamed = found.filter(([arch]) => arch === undefined).map(([, dmg]) => basename(dmg))
  if (unnamed.length > 0) throw new Error(`macOS DMGs must end in -arm64, -x64 or -universal: ${unnamed.join(', ')}`)
  const archs = found.map(([arch]) => arch!).sort()
  if (archs.join(',') !== [...expected].sort().join(',')) {
    throw new Error(`Expected one macOS DMG each for ${expected.join(', ')}; found ${archs.join(', ') || 'none'}`)
  }
  return found as [MacPackageArch, string][]
}

export function nextMacVerification(signed: boolean, distDir: string, env: NodeJS.ProcessEnv = process.env,
  run: (command: string, args: readonly string[]) => void = execute, dmg?: { arch: MacPackageArch; path: string }): MacReleaseVerificationOptions {
  const arch = dmg?.arch ?? (signed ? macReleaseArchitecture(env) : macSmokeArchitecture(env))
  const cpus = macPackageCpus(arch)
  const slices: string[] = cpus.map(cpu => cpu === 'x64' ? 'x86_64' : 'arm64')
  const inPlace = !signed && dmg === undefined && macSmokeTarget(env) === 'dir' ? join(distDir, macApplicationDirectory(arch)) : undefined
  const notarized = signed && env.DSH_MAC_SKIP_NOTARIZATION !== '1'
  return { distDir, productName: 'OmniMux', nativeEntries: nextMacNativeEntries(cpus),
    unpackedRoot: appPath => join(appPath, 'Contents', 'Resources', 'app.asar.unpacked'),
    listDmgs: inPlace !== undefined ? () => [inPlace]
      : dmg !== undefined ? () => [dmg.path]
      : path => readdirSync(path).filter(name => name.endsWith('.dmg')).map(name => join(path, name)).filter(path => statSync(path).isFile()),
    makeMountPoint: inPlace !== undefined ? () => inPlace : () => mkdtempSync(join(tmpdir(), 'dsh-next-release-')),
    removeMountPoint: inPlace !== undefined ? () => undefined : path => rmdirSync(path),
    verifyRuntime: appPath => verifyNextMacRuntime(appPath, signed, cpus),
    ...(signed ? {
      verifyBuildInfo: appPath => verifyAppBuildInfo(appPath, { packageDir: 'dsh-desktop-next', allowNonOriginMain: env.DSH_MAC_RELEASE_CANDIDATE === '1' }),
      smokeApp: async appPath => {
        if (process.arch === 'arm64' && slices.length === 1 && slices[0] === 'x86_64') {
          console.log('[verify-mac] warming x64 GUI under Rosetta')
          await smokeMacApp(appPath, { settleMs: 60_000 })
        }
        await smokeMacApp(appPath)
      },
    } : {}),
    run: (command, args) => {
      if (inPlace !== undefined && command === 'hdiutil') return
      if (!signed && ['codesign', 'spctl', 'xcrun'].includes(command)) return
      if (signed && !notarized && ['spctl', 'xcrun'].includes(command)) return
      if (command === 'lipo' && args[1] === '-verify_arch' && args[0]?.includes('/Contents/MacOS/') && !slices.includes(args[2]!)) return
      run(command, args)
      if (signed && command === 'codesign' && args.includes('--verify')) verifyNextMacEntitlements(args.at(-1)!, undefined, slices)
    } }
}

export async function verifyNextMac(signed: boolean): Promise<void> {
  const distDir = resolve(process.argv[2] ?? `dist/${signed ? 'mac-release' : 'mac-smoke'}`)
  if (!signed && macSmokeTarget(process.env) === 'dir') {
    await verifyMacRelease(nextMacVerification(signed, distDir))
    return
  }
  const dmgs = readdirSync(distDir).filter(name => name.endsWith('.dmg')).map(name => join(distDir, name)).filter(path => statSync(path).isFile())
  for (const [arch, path] of expectedMacDmgs(dmgs, signed ? macReleaseArchs(process.env) : [macSmokeArchitecture(process.env)])) {
    await verifyMacRelease(nextMacVerification(signed, distDir, process.env, execute, { arch, path }))
    console.log(`Verified the ${arch} macOS ${signed ? 'release' : 'smoke'} ${basename(path)}`)
  }
}
if (process.argv[1]?.endsWith('/verify-mac-release.ts')) await verifyNextMac(true)
