/** Electron Builder's beforePack hook: the Office package closure joins the archive unpack patterns. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { nextPackagingTarget, payloadDir, preparedPackagingTarget } from './packaged-payload.ts'
import type { NextPackagingTarget } from './runtime-file-policy.ts'
import { officeUnpackPatterns } from './office-packages.ts'
import { applyWindowsUnpack } from './windows-asar-unpack.ts'
import { installWindowsDirectoryInstaller } from './windows-directory-installer.ts'
import { packagingStepSync } from './packaging-step.ts'

const require = createRequire(import.meta.url)

interface PackConfiguration {
  asarUnpack?: unknown
  electronVersion?: string
  electronDownload?: Record<string, unknown>
}

interface PackContext {
  electronPlatformName: string
  packager: { projectDir: string; info: { appDir: string }; config: PackConfiguration }
}

/** Use the checksums shipped by the lockfile-pinned Electron npm release. */
export function applyElectronChecksums(config: PackConfiguration, platform: 'darwin' | 'win32', archs: readonly string[]): void {
  const manifest = require.resolve('electron/package.json')
  const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }
  const checksums = JSON.parse(readFileSync(join(dirname(manifest), 'checksums.json'), 'utf8')) as Record<string, string>
  if (version !== config.electronVersion) {
    throw new Error('Electron Builder version does not match the lockfile-pinned Electron checksum table')
  }
  for (const arch of archs) {
    const filename = `electron-v${version}-${platform}-${arch}.zip`
    if (!/^[a-f0-9]{64}$/u.test(checksums[filename] ?? '')) {
      throw new Error(`Electron archive ${filename} is missing the expected pinned SHA-256 checksum`)
    }
  }
  // The explicit flag selects ElectronGetOptions in the pinned Builder. @electron/get
  // writes its own SHASUMS256.txt from this map and checks fresh and cached archives.
  config.electronDownload = { ...config.electronDownload, checksums, unsafelyDisableChecksums: false }
}

/**
 * Unpack the Office package closure of every CPU the package carries. The bundled standalone Node
 * runs the LibreOffice Kit CLI and its JavaScript dependencies from physical files, so the closure
 * resolved from the prepared payload joins `asarUnpack`; each pattern is added once. The patterns
 * start with `**`, so they match below the prepared directory electron-builder archives.
 * @param config - electron-builder configuration being packed.
 * @param payloadRoot - Prepared payload directory.
 * @param target - Platform and CPUs of the prepared payload.
 * @returns The patterns this call added.
 */
export function applyOfficeUnpack(config: { asarUnpack?: unknown }, payloadRoot: string, target: NextPackagingTarget): string[] {
  const existing = config.asarUnpack
  const patterns = typeof existing === 'string' ? [existing] : Array.isArray(existing) ? existing.filter((value): value is string => typeof value === 'string') : []
  const added = officeUnpackPatterns(payloadRoot, target.platform, target.archs).filter(pattern => !patterns.includes(pattern))
  config.asarUnpack = [...patterns, ...added]
  return added
}

export default async function beforePack(context: PackContext): Promise<void> {
  const platform = context.electronPlatformName as NodeJS.Platform
  const dir = payloadDir(platform)
  const target = preparedPackagingTarget(context.packager.projectDir, platform)
  if (target.platform !== platform) throw new Error(`Next payload was prepared for ${target.platform}, not for the ${platform} package being built`)
  const office = applyOfficeUnpack(context.packager.config, join(context.packager.projectDir, ...dir.split('/')), target)
  if (office.length > 0) console.log(`Next ${context.electronPlatformName} payload unpacks the Office closure: ${String(office.length)} packages`)
  if (platform === 'darwin' || platform === 'win32') {
    packagingStepSync('cache:electron:checksums', () => applyElectronChecksums(context.packager.config, platform, nextPackagingTarget(platform).archs))
  }
  if (platform === 'win32') {
    const files = packagingStepSync('builder:prepare-pe-unpack', () => applyWindowsUnpack(context.packager.config,
      context.packager.info.appDir, join(context.packager.projectDir, ...dir.split('/'))))
    console.log(`Next Windows payload unpacks ${String(files.length)} discovered PE files`)
    // The NSIS installer replaces the installation through staged directories.
    installWindowsDirectoryInstaller()
  }
  await Promise.resolve()
}
