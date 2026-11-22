/** Electron Builder's beforePack hook: the Office package closure joins the archive unpack patterns. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { nextPackagingTarget, payloadDir } from './packaged-payload.ts'
import { officeUnpackPatterns } from './office-packages.ts'
import { applyWindowsUnpack } from './windows-asar-unpack.ts'
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
export function applyWindowsElectronChecksums(config: PackConfiguration): void {
  const manifest = require.resolve('electron/package.json')
  const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }
  const checksums = JSON.parse(readFileSync(join(dirname(manifest), 'checksums.json'), 'utf8')) as Record<string, string>
  const filename = `electron-v${version}-win32-x64.zip`
  if (version !== config.electronVersion || !/^[a-f0-9]{64}$/u.test(checksums[filename] ?? '')) {
    throw new Error('Windows Electron archive is missing the expected pinned SHA-256 checksum')
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
 * @param platform - Electron platform being packaged.
 * @returns The patterns this call added.
 */
export function applyOfficeUnpack(config: { asarUnpack?: unknown }, payloadRoot: string, platform: NodeJS.Platform): string[] {
  const existing = config.asarUnpack
  const patterns = typeof existing === 'string' ? [existing] : Array.isArray(existing) ? existing.filter((value): value is string => typeof value === 'string') : []
  const added = officeUnpackPatterns(payloadRoot, platform, nextPackagingTarget(platform).archs).filter(pattern => !patterns.includes(pattern))
  config.asarUnpack = [...patterns, ...added]
  return added
}

export default async function beforePack(context: PackContext): Promise<void> {
  const platform = context.electronPlatformName as NodeJS.Platform
  const dir = payloadDir(platform)
  const office = applyOfficeUnpack(context.packager.config, join(context.packager.projectDir, ...dir.split('/')), platform)
  if (office.length > 0) console.log(`Next ${context.electronPlatformName} payload unpacks the Office closure: ${String(office.length)} packages`)
  if (platform === 'win32') {
    packagingStepSync('cache:electron:checksums', () => applyWindowsElectronChecksums(context.packager.config))
    const files = packagingStepSync('builder:prepare-pe-unpack', () => applyWindowsUnpack(context.packager.config,
      context.packager.info.appDir, join(context.packager.projectDir, ...dir.split('/'))))
    console.log(`Next Windows payload unpacks ${String(files.length)} discovered PE files`)
  }
  await Promise.resolve()
}
