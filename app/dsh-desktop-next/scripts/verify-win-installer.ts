import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, createReadStream, existsSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertAppImage, assertDebArchive, assertElfExecutable } from './verify-linux-artifacts.ts'
import { packagingStep } from './packaging-step.ts'
import { linuxPackageTargets } from './package-targets.ts'

/** Verify a complete in-memory Windows PE image. */
export function assertPortableExecutableBuffer(data: Buffer, label: string, source: string): void {
  if (data.byteLength < 68 || data.subarray(0, 2).toString('ascii') !== 'MZ') {
    throw new Error(`${label} does not have a Windows PE header: ${source}`)
  }
  const peOffset = data.readUInt32LE(0x3c)
  if (peOffset > data.byteLength - 4) {
    throw new Error(`${label} has an invalid Windows PE offset: ${source}`)
  }
  if (!data.subarray(peOffset, peOffset + 4).equals(Buffer.from('PE\0\0'))) {
    throw new Error(`${label} does not have a Windows PE signature: ${source}`)
  }
}

/** Paths returned after Windows installer verification succeeds. */
export interface WindowsInstallerArtifacts {
  readonly installerPath: string
  readonly applicationPath: string
}

/** Injectable Windows installer verification boundary. */
export interface WindowsInstallerVerificationOptions {
  readonly desktopRoot: string
  readonly version: string
}

function readPackageVersion(desktopRoot: string): string {
  const manifest = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error(`desktop package at ${desktopRoot} has no valid version`)
  }
  return manifest.version
}

/** Verify that a generated Windows artifact has a valid PE header. */
export function assertPortableExecutable(path: string, label: string): void {
  const stat = statSync(path)
  if (!stat.isFile() || stat.size < 68) {
    throw new Error(`${label} is not a non-empty regular file: ${path}`)
  }
  const descriptor = openSync(path, 'r')
  const dosHeader = Buffer.alloc(64)
  try {
    const dosBytesRead = readSync(descriptor, dosHeader, 0, dosHeader.byteLength, 0)
    if (dosBytesRead !== dosHeader.byteLength || dosHeader.subarray(0, 2).toString('ascii') !== 'MZ') {
      throw new Error(`${label} does not have a Windows PE header: ${path}`)
    }
    const peOffset = dosHeader.readUInt32LE(0x3c)
    if (peOffset > stat.size - 4) {
      throw new Error(`${label} has an invalid Windows PE offset: ${path}`)
    }
    const signature = Buffer.alloc(4)
    const signatureBytesRead = readSync(descriptor, signature, 0, signature.byteLength, peOffset)
    if (signatureBytesRead !== signature.byteLength || !signature.equals(Buffer.from('PE\0\0'))) {
      throw new Error(`${label} does not have a Windows PE signature: ${path}`)
    }
  } finally {
    closeSync(descriptor)
  }
}

function defaultInstallerOptions(): WindowsInstallerVerificationOptions {
  const desktopRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  return { desktopRoot, version: readPackageVersion(desktopRoot) }
}

/** Verify the exact NSIS installer and unpacked application executable. */
export function verifyWindowsInstaller(
  options: WindowsInstallerVerificationOptions = defaultInstallerOptions(),
): WindowsInstallerArtifacts {
  const distDir = join(options.desktopRoot, 'dist')
  const installerPath = join(distDir, `OmniMux-${options.version}-x64-Setup.exe`)
  const applicationPath = join(distDir, 'win-unpacked', 'OmniMux.exe')
  assertPortableExecutable(installerPath, 'Windows NSIS installer')
  assertPortableExecutable(applicationPath, 'unpacked Windows application')
  return { installerPath, applicationPath }
}

const uninstallExecutable = 'Uninstall OmniMux.exe'
const uninstallIcon = 'uninstallerIcon.ico'
const sevenZipLicenses = ['7zip-installer-COPYING.txt', '7zip-installer-LICENSE.txt'] as const
const installerGeneratedFiles = new Set<string>([uninstallExecutable, uninstallIcon, ...sevenZipLicenses])

async function fileHash(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function payloadFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
    .map(entry => relative(directory, join(entry.parentPath, entry.name))).sort()
}

export async function compareInstalledPayload(unpacked: string, installed: string, sourceIcon: string): Promise<{ fileCount: number; sha256: string }> {
  const expected = new Set(payloadFiles(unpacked))
  const actual = new Set(payloadFiles(installed).filter(file => !installerGeneratedFiles.has(file)))
  const missing = [...expected].filter(file => !actual.has(file))
  const extra = [...actual].filter(file => !expected.has(file))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`Next NSIS extracted file list differs from win-unpacked. Missing (${missing.length}): ${JSON.stringify(missing.slice(0, 8))}. Unexpected (${extra.length}): ${JSON.stringify(extra.slice(0, 8))}.`)
  }
  assertPortableExecutable(join(installed, uninstallExecutable), 'Next NSIS uninstaller')
  if (await fileHash(join(installed, uninstallIcon)) !== await fileHash(sourceIcon)) {
    throw new Error('Next NSIS uninstaller icon does not match the configured icon')
  }
  for (const license of sevenZipLicenses) {
    const file = join(installed, license)
    if (existsSync(file) && statSync(file).size === 0) {
      throw new Error(`Next NSIS emitted an empty 7-Zip license file: ${license}`)
    }
  }
  const payload = createHash('sha256')
  for (const path of expected) {
    const [before, after] = await Promise.all([fileHash(join(unpacked, path)), fileHash(join(installed, path))])
    if (before !== after) throw new Error(`Next NSIS changed the contents of ${path}`)
    payload.update(JSON.stringify([path.replaceAll('\\', '/'), before])).update('\n')
  }
  return { fileCount: expected.size, sha256: payload.digest('hex') }
}

async function verifyInstalledPayload(installer: string, unpacked: string, sourceIcon: string): Promise<void> {
  const scratch = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'omx-'))
  const installed = join(scratch, 'app')
  try {
    // This runs on the disposable Windows PR runner under its test account. NSIS requires /D= last.
    const result = spawnSync(installer, ['/S', `/D=${installed}`], { windowsVerbatimArguments: true, timeout: 180_000, stdio: 'inherit' })
    if (result.error || result.status !== 0) throw result.error ?? new Error(`Next NSIS extraction failed with exit ${String(result.status)}`)
    const { fileCount, sha256 } = await compareInstalledPayload(unpacked, installed, sourceIcon)
    console.log(`NSIS extracted ${String(fileCount)} matching files (payload SHA-256 ${sha256}).`)
  } finally { rmSync(scratch, { recursive: true, force: true }) }
}

async function verifyArtifacts(): Promise<void> {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const { version: sourceVersion } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  // `DSH_NEXT_BUILD_VERSION` lets a drill build a release whose version differs
  // from the source tree (see scripts/package.ts); the verifier follows the artifact name.
  const version = process.env.DSH_NEXT_BUILD_VERSION ?? sourceVersion
  const verifyMode = process.env.DSH_PACKAGE_VERIFY_MODE ?? 'win'
  if (verifyMode === 'win-portable') {
    const archivePath = join(root, 'dist', `OmniMux-${version}-x64-Portable.zip`)
    const fd = openSync(archivePath, 'r')
    const header = Buffer.alloc(4)
    try {
      readSync(fd, header, 0, 4, 0)
    } finally {
      closeSync(fd)
    }
    if (!header.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error(`Next portable archive is not a ZIP archive: ${archivePath}`)
    assertPortableExecutable(join(root, 'dist', 'win-unpacked', 'OmniMux.exe'), 'Next application')
  } else if (verifyMode === 'linux') {
    const arm64 = process.arch === 'arm64'
    const targets = linuxPackageTargets(process.env)
    if (targets.includes('AppImage')) assertAppImage(join(root, 'dist', `OmniMux-${version}-${arm64 ? 'arm64' : 'x86_64'}.AppImage`), 'Next AppImage')
    if (targets.includes('deb')) assertDebArchive(join(root, 'dist', `OmniMux-${version}-${arm64 ? 'arm64' : 'amd64'}.deb`), 'Next Debian package')
    assertElfExecutable(join(root, 'dist', arm64 ? 'linux-arm64-unpacked' : 'linux-unpacked', 'dsh-desktop-next'), 'Next Linux application')
  } else {
    const installer = join(root, 'dist', `OmniMux-${version}-x64-Setup.exe`)
    const unpacked = join(root, 'dist', 'win-unpacked')
    assertPortableExecutable(installer, 'Next NSIS installer')
    assertPortableExecutable(join(unpacked, 'OmniMux.exe'), 'Next application')
    if (process.env.DSH_WINDOWS_VERIFY_EXTRACTED === '1') {
      await packagingStep('verify:nsis-extracted-payload', () => verifyInstalledPayload(installer, unpacked, join(root, 'build', 'app-icon.ico')))
    }
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyArtifacts()
}
