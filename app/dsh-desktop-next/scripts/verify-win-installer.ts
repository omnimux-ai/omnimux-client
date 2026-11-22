import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, createReadStream, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertAppImage, assertDebArchive, assertElfExecutable } from '../../dsh-plugin-desktop/scripts/verify-linux-artifacts.ts'
import { assertPortableExecutable } from '../../dsh-plugin-desktop/scripts/verify-win-installer.ts'
import { packagingStep } from './packaging-step.ts'

async function fileHash(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function payloadFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
    .map(entry => relative(directory, join(entry.parentPath, entry.name))).sort()
}

async function verifyInstalledPayload(installer: string, unpacked: string): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'omnimux-nsis-verify-'))
  const installed = join(scratch, 'OmniMux')
  try {
    // This runs on the disposable Windows PR runner under its test account. NSIS requires /D= last.
    const result = spawnSync(installer, ['/S', `/D=${installed}`], { windowsVerbatimArguments: true, timeout: 180_000, stdio: 'inherit' })
    if (result.error || result.status !== 0) throw result.error ?? new Error(`Next NSIS extraction failed with exit ${String(result.status)}`)
    const expected = payloadFiles(unpacked)
    const actual = payloadFiles(installed).filter(file => file !== 'Uninstall OmniMux.exe')
    if (expected.length !== actual.length || expected.some((file, index) => file !== actual[index])) {
      throw new Error('Next NSIS extracted file list differs from win-unpacked')
    }
    const payload = createHash('sha256')
    for (const path of expected) {
      const [before, after] = await Promise.all([fileHash(join(unpacked, path)), fileHash(join(installed, path))])
      if (before !== after) throw new Error(`Next NSIS changed the contents of ${path}`)
      payload.update(JSON.stringify([path.replaceAll('\\', '/'), before])).update('\n')
    }
    console.log(`NSIS extracted ${String(expected.length)} matching files (payload SHA-256 ${payload.digest('hex')}).`)
  } finally { rmSync(scratch, { recursive: true, force: true }) }
}

const root = fileURLToPath(new URL('..', import.meta.url))
const { version: sourceVersion } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
// `DSH_NEXT_BUILD_VERSION` lets a drill build a release whose version differs
// from the source tree (see scripts/package.ts); electron-builder names the
// artifact after that override, so the verifier must follow it too.
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
  assertAppImage(join(root, 'dist', `OmniMux-${version}-x86_64.AppImage`), 'Next AppImage')
  assertDebArchive(join(root, 'dist', `OmniMux-${version}-amd64.deb`), 'Next Debian package')
  assertElfExecutable(join(root, 'dist', 'linux-unpacked', 'dsh-desktop-next'), 'Next Linux application')
} else {
  const installer = join(root, 'dist', `OmniMux-${version}-x64-Setup.exe`)
  const unpacked = join(root, 'dist', 'win-unpacked')
  assertPortableExecutable(installer, 'Next NSIS installer')
  assertPortableExecutable(join(unpacked, 'OmniMux.exe'), 'Next application')
  if (process.env.DSH_WINDOWS_VERIFY_EXTRACTED === '1') {
    await packagingStep('verify:nsis-extracted-payload', () => verifyInstalledPayload(installer, unpacked))
  }
}
