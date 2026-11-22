/** Exercise the installed builder so dependency upgrades cannot silently drop Desktop packaging policy. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { applyElectronChecksums } from '../scripts/prepare-pack.ts'
import { compareInstalledPayload } from '../scripts/verify-win-installer.ts'

const require = createRequire(import.meta.url)
require('app-builder-lib')
const builderRoot = dirname(require.resolve('app-builder-lib/package.json'))
const archive = require('app-builder-lib/out/targets/archive.js') as {
  archive: (format: string, file: string, source: string, options: Record<string, unknown>) => Promise<string>
  compute7zCompressArgs: (format: string, options: Record<string, unknown>) => string[]
}
const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget.js') as {
  NsisTarget: { prototype: { buildAppPackage: (source: string, arch: number) => Promise<{ path: string }> } }
}
const { Arch } = require('builder-util') as { Arch: { x64: number } }
const directories: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

it.each(['normal', 'store'].flatMap(compression => [true, false].map(enabled => ({ compression, enabled }))))('keeps fast NSIS options scoped to Next ($compression, enabled=$enabled)', async ({ compression, enabled }) => {
  vi.stubEnv('ELECTRON_BUILDER_COMPRESSION_LEVEL', undefined)
  vi.stubEnv('DSH_NEXT_WINDOWS_FAST_COMPRESSION', enabled ? '1' : undefined)
  const directory = mkdtempSync(join(tmpdir(), 'next-nsis-options-'))
  directories.push(directory)
  let effective: Record<string, unknown> | undefined
  vi.spyOn(archive, 'archive').mockImplementation(async (format, file, source, options) => {
    expect(format).toBe('7z')
    expect(source).toBe(join(directory, 'win-unpacked'))
    effective = options
    writeFileSync(file, 'archive fixture')
    return file
  })
  const options = { differentialPackage: false, useZip: false }
  const context = {
    options, isBuildDifferentialAware: false, outDir: directory,
    packager: { compression, appInfo: { sanitizedName: 'DSH-NEXT', version: '2.0.20-next' } },
    getPreCompressedFileExtensions: () => null,
  }
  const packaged = await NsisTarget.prototype.buildAppPackage.call(context, join(directory, 'win-unpacked'), Arch.x64)
  expect(packaged.path).toBe(join(directory, 'DSH-NEXT-2.0.20-next-x64.nsis.7z'))
  expect(options.differentialPackage).toBe(false)
  expect(effective).toMatchObject({ withoutDir: true, compression, installTimeDecodable: true })
  const args = archive.compute7zCompressArgs('7z', effective!)
  expect(args).toContain(compression === 'store' ? '-mx=0' : '-mx=9')
  if (enabled) {
    expect(effective).toMatchObject({ dictSize: 1, solid: false })
    expect(args).toEqual(expect.arrayContaining(['-md=1m', '-ms=off']))
  } else {
    expect(effective).not.toHaveProperty('dictSize')
    expect(effective).not.toHaveProperty('solid')
    expect(args).not.toContain('-md=1m')
    expect(args).not.toContain('-ms=off')
  }
  if (compression === 'normal') expect(args).toContain('-mf=BCJ')
})

it('passes the pinned Electron SHA-256 to the real Builder and uses NSIS-compatible BCJ at level 3', async () => {
  const { version } = require('electron/package.json') as { version: string }
  const config = { electronVersion: version, electronDownload: { unsafelyDisableChecksums: true } }
  applyElectronChecksums(config, 'win32', ['x64'])
  // Pinned Builder consumes these options after beforePack. In ElectronGetOptions mode
  // @electron/get validates against the supplied table, including cache hits.
  const modulePath = require.resolve('app-builder-lib/out/util/electronGet.js')
  const electronGet = createRequire(modulePath)('@electron/get')
  const directory = mkdtempSync(join(tmpdir(), 'next-electron-download-'))
  directories.push(directory)
  const fixture = join(directory, 'archive.zip')
  writeFileSync(fixture, 'fixture')
  const download = vi.spyOn(electronGet, 'downloadArtifact').mockResolvedValue(fixture)
  const { downloadElectronArtifactZip } = require(modulePath)
  await expect(downloadElectronArtifactZip({ electronDownload: config.electronDownload, platformName: 'win32', arch: 'x64', version, artifactName: 'electron' })).resolves.toBe(fixture)
  expect(download).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    unsafelyDisableChecksums: false, checksums: { ...require('electron/checksums.json') },
  }))
  expect(() => applyElectronChecksums({ electronVersion: '0.0.0' }, 'win32', ['x64'])).toThrow('lockfile-pinned Electron checksum table')
  vi.stubEnv('ELECTRON_BUILDER_COMPRESSION_LEVEL', '3')
  vi.stubEnv('ELECTRON_BUILDER_7Z_FILTER', 'BCJ')
  expect(archive.compute7zCompressArgs('7z', { installTimeDecodable: true, dictSize: 1, solid: false }))
    .toEqual(expect.arrayContaining(['-mx=3', '-mf=BCJ', '-md=1m', '-ms=off']))
})

it('requires the locked Electron checksums for both macOS ZIPs', () => {
  const { version } = require('electron/package.json') as { version: string }
  const config = { electronVersion: version, electronDownload: {} }
  applyElectronChecksums(config, 'darwin', ['arm64', 'x64'])
  expect(config.electronDownload).toMatchObject({
    unsafelyDisableChecksums: false,
    checksums: {
      [`electron-v${version}-darwin-arm64.zip`]: expect.stringMatching(/^[a-f0-9]{64}$/u),
      [`electron-v${version}-darwin-x64.zip`]: expect.stringMatching(/^[a-f0-9]{64}$/u),
    },
  })
  expect(() => applyElectronChecksums(config, 'darwin', ['ia32'])).toThrow('missing the expected pinned SHA-256 checksum')
})

it('checks NSIS-generated files separately and rejects missing, extra or changed app files', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'next-nsis-payload-'))
  directories.push(directory)
  const unpacked = join(directory, 'unpacked')
  const installed = join(directory, 'installed')
  const icon = join(directory, 'app-icon.ico')
  for (const root of [unpacked, installed]) {
    mkdirSync(join(root, 'resources'), { recursive: true })
    writeFileSync(join(root, 'resources', 'app.asar'), 'app payload')
    writeFileSync(join(root, 'resources', 'uninstallerIcon.ico'), 'app resource')
  }
  const uninstaller = Buffer.alloc(68)
  uninstaller.write('MZ')
  uninstaller.writeUInt32LE(64, 0x3c)
  uninstaller.write('PE\0\0', 64)
  writeFileSync(join(installed, 'Uninstall OmniMux.exe'), uninstaller)
  writeFileSync(join(installed, 'uninstallerIcon.ico'), 'icon')
  writeFileSync(icon, 'icon')
  await expect(compareInstalledPayload(unpacked, installed, icon)).resolves.toEqual({
    fileCount: 2,
    sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
  })

  writeFileSync(join(installed, 'resources', 'uninstallerIcon.ico'), 'changed app resource')
  await expect(compareInstalledPayload(unpacked, installed, icon)).rejects.toThrow('changed the contents')
  writeFileSync(join(installed, 'resources', 'uninstallerIcon.ico'), 'app resource')
  writeFileSync(join(installed, 'uninstallerIcon.ico'), 'changed installer icon')
  await expect(compareInstalledPayload(unpacked, installed, icon)).rejects.toThrow('does not match the configured icon')
  rmSync(join(installed, 'resources', 'app.asar'))
  writeFileSync(join(installed, 'extra.txt'), 'extra file')
  await expect(compareInstalledPayload(unpacked, installed, icon)).rejects.toThrow(/Missing \(1\).*app\.asar.*Unexpected \(1\).*extra\.txt/u)
})

it('retains long paths, scoped process detection, direct extraction and macOS keychain fixes after rollback', () => {
  expect(require('app-builder-lib/package.json').version).toBe('26.15.7')
  const template = (path: string): string => readFileSync(join(builderRoot, 'templates/nsis', path), 'utf8')
  for (const file of ['installer.nsi', 'portable.nsi']) expect(template(file)).toMatch(/^ManifestLongPathAware true\r?$/mu)
  const processes = template('include/allowOnlyOneInstallerInstance.nsh')
  expect(processes).toContain("[System.IO.Path]::GetFileName($$_.Path) -ieq '${_FILE}'")
  expect(processes).not.toContain("$$_.Path.StartsWith('$INSTDIR'")
  const extraction = template('include/extractAppPackage.nsh').split('!macro extractUsing7za FILE')[1]!.split('!macroend')[0]!
  expect(extraction).toContain('SetOutPath "$INSTDIR"')
  expect(extraction).toContain('Nsis7z::Extract "${FILE}"')
  expect(extraction).not.toContain('CopyFiles')
  expect(template('include/installUtil.nsh')).toContain('continuing with non-atomic in-place replacement')
  const signing = readFileSync(join(builderRoot, 'out/codeSign/macCodeSign.js'), 'utf8')
  expect(signing).toContain('importCerts(keychainFile, certPaths, cscPasswords, keychainPassword)')
  expect(signing).toContain('"set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", keychainPassword')
})
