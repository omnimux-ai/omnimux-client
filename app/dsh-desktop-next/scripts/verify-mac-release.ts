/** Reuse the signed DMG verifier with Next's application identity, once for every package a release or smoke builds. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { macSmokeArchitecture } from '../../dsh-plugin-desktop/scripts/mac-universal.ts'
import { macReleaseArchitecture } from '../../dsh-plugin-desktop/scripts/release-mac.ts'
import { smokeMacApp } from '../../dsh-plugin-desktop/scripts/smoke-mac-app.ts'
import { verifyAppBuildInfo } from '../../dsh-plugin-desktop/scripts/verify-build-info.ts'
import { verifyMacRelease, type MacReleaseVerificationOptions } from '../../dsh-plugin-desktop/scripts/verify-mac-release.ts'
import { macDmgArch, macPackageCpus, macReleaseArchs, nextMacNativeEntries, type MacPackageArch } from './mac-runtime.ts'
import { macApplicationDirectory, macSmokeTarget } from './package-targets.ts'
import { verifyNextMacEntitlements } from './verify-mac-entitlements.ts'
import { verifyNextMacRuntime } from './verify-mac-runtime.ts'

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
