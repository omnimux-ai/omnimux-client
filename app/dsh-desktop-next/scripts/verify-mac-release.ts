/** Reuse the signed universal DMG verifier with Next's application identity. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { macSmokeArchitecture, macSmokeExecutableSlices, type MacUniversalArch } from '../../dsh-plugin-desktop/scripts/mac-universal.ts'
import { macReleaseArchitecture } from '../../dsh-plugin-desktop/scripts/release-mac.ts'
import { smokeMacApp } from '../../dsh-plugin-desktop/scripts/smoke-mac-app.ts'
import { verifyAppBuildInfo } from '../../dsh-plugin-desktop/scripts/verify-build-info.ts'
import { verifyMacRelease } from '../../dsh-plugin-desktop/scripts/verify-mac-release.ts'
import { NEXT_MAC_NATIVE_ENTRIES } from './mac-runtime.ts'
import { verifyNextMacEntitlements } from './verify-mac-entitlements.ts'
import { verifyNextMacRuntime } from './verify-mac-runtime.ts'

export async function verifyNextMac(signed: boolean): Promise<void> {
  const smokeSlices = signed ? undefined : macSmokeExecutableSlices(macSmokeArchitecture(process.env))
  // A signed release packages one architecture unless it is explicitly universal; the
  // mounted executable and unpacked native modules must carry exactly those slices.
  const releaseArch = macReleaseArchitecture(process.env)
  const archSlices = smokeSlices ?? (releaseArch === 'universal' ? ['x86_64', 'arm64']
    : [releaseArch === 'arm64' ? 'arm64' : 'x86_64'])
  const nativeEntries = NEXT_MAC_NATIVE_ENTRIES.filter(entry => archSlices.includes(entry.arch))
  await verifyMacRelease({ distDir: resolve(process.argv[2] ?? `dist/${signed ? 'mac-release' : 'mac-smoke'}`), productName: 'OmniMux', nativeEntries, archSlices,
    // Next archives its application; native files live beside the archive.
    unpackedRoot: appPath => join(appPath, 'Contents', 'Resources', 'app.asar.unpacked'),
    listDmgs: path => readdirSync(path).filter(name => name.endsWith('.dmg')).map(name => join(path, name)).filter(path => statSync(path).isFile()),
    makeMountPoint: () => mkdtempSync(join(tmpdir(), 'dsh-next-release-')), removeMountPoint: path => rmdirSync(path),
    // The interpreter payloads beside the archive: both CPUs present, the host's CPU executed, release signatures checked.
    verifyRuntime: appPath => verifyNextMacRuntime(appPath, signed),
    ...(signed ? {
      verifyBuildInfo: appPath => verifyAppBuildInfo(appPath, { packageDir: 'dsh-desktop-next', allowNonOriginMain: process.env.DSH_MAC_RELEASE_CANDIDATE === '1' }),
      smokeApp: async appPath => {
        // The x64 app runs through Rosetta on the release machine. Its first launch from a
        // mounted DMG also pays the OS signature/Rosetta cache cost; one warm-up under a
        // separate budget keeps the actual readiness gate at the documented 20s ceiling.
        if (process.arch === 'arm64' && archSlices.length === 1 && archSlices[0] === 'x86_64') {
          console.log('[verify-mac] warming x64 GUI under Rosetta')
          await smokeMacApp(appPath, { settleMs: 60_000 })
        }
        await smokeMacApp(appPath)
      },
    } : {}),
    run: (command, args) => {
      if (!signed && ['codesign', 'spctl', 'xcrun'].includes(command)) return
      if (smokeSlices !== undefined && command === 'lipo' && args[1] === '-verify_arch' && args[0]?.includes('/Contents/MacOS/') && !smokeSlices.includes(args[2] as MacUniversalArch)) return
      const result = spawnSync(command, args, { encoding: 'utf8', timeout: 10 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 })
      if (result.stdout) process.stdout.write(result.stdout)
      if (result.stderr) process.stderr.write(result.stderr)
      if (result.signal === 'SIGTERM') throw new Error(`Artifact verification timed out after 10m: ${command} ${args.join(' ')}`)
      if (result.error || result.status !== 0) {
        throw result.error ?? new Error(`Artifact verification failed: ${command} ${args.join(' ')}${result.stderr ? `: ${result.stderr.trim()}` : ''}`)
      }
      if (signed && command === 'codesign' && args.includes('--verify')) verifyNextMacEntitlements(args.at(-1)!, undefined, archSlices)
    } })
}
if (process.argv[1]?.endsWith('/verify-mac-release.ts')) await verifyNextMac(true)
