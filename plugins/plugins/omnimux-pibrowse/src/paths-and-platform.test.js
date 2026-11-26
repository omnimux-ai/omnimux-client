import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { computeSocketPath, resolvePibrowsePaths, validateUserPath } from './paths.js'
import { getPlatformInfo, probeCoreInstallation, probeWidevineCdm, resolveAgentBinary } from './platform.js'

test('resolvePibrowsePaths isolates data under $DSH_HOME/omnimux/pibrowse and keeps Unix socket < 104B', () => {
  const deepHome = '/tmp/' + 'nested-directory-segment/'.repeat(8)
  const paths = resolvePibrowsePaths({ home: deepHome, platform: 'darwin' })

  assert.ok(paths.dataDir.endsWith(join('omnimux', 'pibrowse', 'data')))
  assert.ok(!paths.dataDir.includes('Application Support/Fury'))
  assert.ok(Buffer.byteLength(paths.socketPath, 'utf8') < 104, `socketPath too long: ${paths.socketPath}`)

  const winSocket = computeSocketPath(paths.dataDir, { platform: 'win32' })
  assert.match(winSocket, /^\\\\\.\\pipe\\omx-pibrowse-[a-f0-9]{8}$/)
})

test('validateUserPath rejects traversal, null bytes, empty strings, and relative paths', () => {
  assert.throws(() => validateUserPath('../etc/passwd'), /parent traversal/)
  assert.throws(() => validateUserPath('/tmp/a/../b'), /parent traversal/)
  assert.throws(() => validateUserPath('/tmp/a\0b'), /null byte/)
  assert.throws(() => validateUserPath('relative/path'), /absolute path/)
  assert.throws(() => validateUserPath('   '), /empty/)
  assert.equal(validateUserPath('/tmp/pibrowse/bin/fury-agent'), '/tmp/pibrowse/bin/fury-agent')
})

test('getPlatformInfo reports prebuilt support accurately for darwin-arm64 vs unsupported targets', () => {
  const armMac = getPlatformInfo({ platform: 'darwin', arch: 'arm64' })
  assert.equal(armMac.prebuiltSupported, true)
  assert.equal(armMac.prebuiltReleaseTag, 'v0.5.5')
  assert.ok(armMac.prebuiltAssets?.dmg?.sha256)
  assert.equal(armMac.unsupportedGuidance, null)

  const linuxX64 = getPlatformInfo({ platform: 'linux', arch: 'x64' })
  assert.equal(linuxX64.prebuiltSupported, false)
  assert.equal(linuxX64.prebuiltAssets, null)
  assert.match(linuxX64.unsupportedGuidance, /darwin-arm64/)
})

test('probeWidevineCdm detects Chrome CDM read-only and returns honest warning when absent', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'pb-wv-'))
  try {
    const emptyRes = await probeWidevineCdm({ candidateRoots: [join(tmp, 'missing')] })
    assert.equal(emptyRes.available, false)
    assert.match(emptyRes.warning, /Widevine CDM/i)

    const verDir = join(tmp, 'WidevineCdm', '4.10.2891.0')
    await mkdir(verDir, { recursive: true })
    await writeFile(join(verDir, 'manifest.json'), '{"version":"4.10.2891.0"}')

    const foundRes = await probeWidevineCdm({ candidateRoots: [join(tmp, 'WidevineCdm')] })
    assert.equal(foundRes.available, true)
    assert.equal(foundRes.version, '4.10.2891.0')
    assert.equal(foundRes.warning, null)

    const frameworkRoot = join(tmp, 'FrameworkWidevineCdm')
    await mkdir(frameworkRoot, { recursive: true })
    await writeFile(join(frameworkRoot, 'manifest.json'), '{"version":"4.10.2934.0"}')
    const directRes = await probeWidevineCdm({ candidateRoots: [frameworkRoot] })
    assert.equal(directRes.available, true)
    assert.equal(directRes.version, '4.10.2934.0')
    assert.equal(directRes.sourcePath, frameworkRoot)

    // Bidirectional TCC regression: darwin default lookup must NEVER probe ~/Library/Application Support/Google/Chrome
    const fakeUserChromeCdm = join(tmp, 'Library', 'Application Support', 'Google', 'Chrome', 'WidevineCdm', '4.10.9999.0')
    await mkdir(fakeUserChromeCdm, { recursive: true })
    await writeFile(join(fakeUserChromeCdm, 'manifest.json'), '{"version":"4.10.9999.0"}')
    const darwinDefault = await probeWidevineCdm({ platform: 'darwin', home: tmp })
    assert.equal(
      Boolean(darwinDefault.sourcePath && darwinDefault.sourcePath.startsWith(tmp)),
      false,
      'darwin default Widevine lookup must never read ~/Library/Application Support/Google/Chrome (triggers macOS TCC alert)',
    )
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('resolveAgentBinary and probeCoreInstallation detect managed, custom, and standalone paths', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'pb-bin-'))
  try {
    const paths = resolvePibrowsePaths({ rootDir: tmp, platform: 'darwin' })
    const standalonePath = join(tmp, 'standalone-fury-agent')
    await writeFile(standalonePath, '#!/bin/sh\necho ok\n', { mode: 0o755 })

    const missing = await resolveAgentBinary({
      paths,
      config: {},
      platform: 'darwin',
      standaloneCandidates: [standalonePath],
    })
    assert.equal(missing.installed, false)
    assert.equal(missing.standaloneCandidate, standalonePath)

    await mkdir(paths.binDir, { recursive: true })
    await writeFile(paths.managedAgentPath, '#!/bin/sh\necho ok\n', { mode: 0o755 })
    const managed = await resolveAgentBinary({ paths, config: {}, platform: 'darwin' })
    assert.equal(managed.installed, true)
    assert.equal(managed.source, 'managed')

    const coreMissing = await probeCoreInstallation({ dataDir: paths.dataDir, platform: 'darwin' })
    assert.equal(coreMissing.installed, false)

    const fakeCoreApp = join(paths.dataDir, 'core', 'FuryCore.app')
    await mkdir(fakeCoreApp, { recursive: true })
    const coreFound = await probeCoreInstallation({ dataDir: paths.dataDir, platform: 'darwin' })
    assert.equal(coreFound.installed, true)
    assert.equal(coreFound.path, fakeCoreApp)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
