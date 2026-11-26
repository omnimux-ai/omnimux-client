import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PINNED_UPSTREAM } from './constants.js'
import { createConfigStore } from './config-store.js'
import { createInstaller, downloadAndVerifyFile, parseHdiutilMountPoint } from './installer.js'
import { resolvePibrowsePaths } from './paths.js'

function mockFetchBytes(bytes) {
  return async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': String(bytes.length) }),
    body: (async function* () {
      yield bytes.subarray(0, Math.floor(bytes.length / 2))
      yield bytes.subarray(Math.floor(bytes.length / 2))
    })(),
  })
}

test('downloadAndVerifyFile succeeds on matching SHA-256 and deletes temp file on mismatch', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'pb-dl-'))
  try {
    const payload = Buffer.from('authentic-pibrowse-binary-payload')
    const expectedHash = createHash('sha256').update(payload).digest('hex')
    const dest = join(tmp, 'asset.bin')

    const progressEvents = []
    const okRes = await downloadAndVerifyFile({
      url: 'https://example.invalid/asset.bin',
      destPath: dest,
      expectedSha256: expectedHash,
      fetchImpl: mockFetchBytes(payload),
      onProgress: (p) => progressEvents.push(p),
    })
    assert.equal(okRes.sha256, expectedHash)
    assert.equal((await readFile(dest)).toString('utf8'), payload.toString('utf8'))
    assert.ok(progressEvents.length >= 1)

    const badDest = join(tmp, 'tampered.bin')
    await assert.rejects(
      () =>
        downloadAndVerifyFile({
          url: 'https://example.invalid/tampered.bin',
          destPath: badDest,
          expectedSha256: '0'.repeat(64),
          fetchImpl: mockFetchBytes(Buffer.from('tampered')),
        }),
      (err) => err.code === 'checksum-mismatch',
    )
    const files = await readdir(tmp)
    assert.equal(files.some((f) => f.includes('tampered')), false, 'tampered temp file must be removed')
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('parseHdiutilMountPoint extracts mount-point from plist XML', () => {
  const xml = `<?xml version="1.0"?><plist><dict><array><dict><key>mount-point</key><string>/Volumes/PiBrowse 0.5.5</string></dict></array></dict></plist>`
  assert.equal(parseHdiutilMountPoint(xml), '/Volumes/PiBrowse 0.5.5')
})

test('extractAgentFromDmg extracts binary with 0755 and always detaches DMG even on failure', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'pb-dmg-'))
  try {
    const paths = resolvePibrowsePaths({ rootDir: join(tmp, 'root'), platform: 'darwin' })
    const configStore = createConfigStore({ configFile: paths.configFile })
    const mountDir = join(tmp, 'mounted-vol')
    const agentInDmg = join(mountDir, 'PiBrowse.app', 'Contents', 'MacOS', 'fury-agent')
    await mkdir(join(mountDir, 'PiBrowse.app', 'Contents', 'MacOS'), { recursive: true })
    await writeFile(agentInDmg, '#!/bin/sh\necho fury-agent-ok\n')

    const calls = []
    const installer = createInstaller({
      paths,
      configStore,
      platform: 'darwin',
      arch: 'arm64',
      execFileImpl: async (file, args) => {
        calls.push([file, ...args])
        if (file === 'hdiutil' && args[0] === 'attach') {
          return {
            stdout: `<plist><dict><key>mount-point</key><string>${mountDir}</string></dict></plist>`,
            stderr: '',
          }
        }
        return { stdout: '', stderr: '' }
      },
    })

    const out = await installer.extractAgentFromDmg(
      join(tmp, 'fake.dmg'),
      PINNED_UPSTREAM.assets['darwin-arm64'].dmg.appRelativeAgentPath,
      paths.managedAgentPath,
    )
    assert.equal(out, paths.managedAgentPath)
    assert.ok(calls.some((c) => c[0] === 'hdiutil' && c[1] === 'detach' && c[2] === mountDir))

    // Failure case: missing relative binary inside mounted DMG must still detach
    calls.length = 0
    await assert.rejects(
      () => installer.extractAgentFromDmg(join(tmp, 'fake.dmg'), 'NonExistent/fury-agent', paths.managedAgentPath),
      (err) => err.code === 'install-failed',
    )
    assert.ok(calls.some((c) => c[0] === 'hdiutil' && c[1] === 'detach' && c[2] === mountDir))
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('installer blocks unsupported platforms, detects Gatekeeper SIGKILL, and clears cache safely', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'pb-inst-'))
  try {
    const paths = resolvePibrowsePaths({ rootDir: tmp, platform: 'linux' })
    const configStore = createConfigStore({ configFile: paths.configFile })
    const linuxInstaller = createInstaller({
      paths,
      configStore,
      platform: 'linux',
      arch: 'x64',
    })
    await assert.rejects(() => linuxInstaller.installAgent(), (err) => err.code === 'unsupported-platform')

    const binPath = join(tmp, 'blocked-agent')
    await writeFile(binPath, '#!/bin/sh\n', { mode: 0o755 })
    const macInstaller = createInstaller({
      paths,
      configStore,
      platform: 'darwin',
      arch: 'arm64',
      execFileImpl: async () => {
        const err = new Error('Command failed: killed')
        err.signal = 'SIGKILL'
        throw err
      },
    })
    const probe = await macInstaller.probeAgentBinary(binPath)
    assert.equal(probe.ok, false)
    assert.equal(probe.code, 'gatekeeper-blocked')
    assert.equal(probe.gatekeeperBlocked, true)

    await mkdir(join(paths.downloadsDir), { recursive: true })
    await mkdir(join(paths.dataDir, 'core'), { recursive: true })
    await mkdir(join(paths.dataDir, 'profiles', 'p1'), { recursive: true })
    await writeFile(join(paths.downloadsDir, 'old.dmg'), 'x')
    await writeFile(join(paths.dataDir, 'core', 'dummy'), 'y')
    await writeFile(join(paths.dataDir, 'profiles', 'p1', 'keep.txt'), 'keep')

    await macInstaller.clearCache()
    await assert.rejects(() => access(join(paths.dataDir, 'core', 'dummy')))
    assert.equal(await readFile(join(paths.dataDir, 'profiles', 'p1', 'keep.txt'), 'utf8'), 'keep')
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('real createInstaller.installCore transitions synchronously to downloading, deduplicates concurrent calls, and handles missing agent', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'pb-core-inst-'))
  try {
    const paths = resolvePibrowsePaths({ rootDir: tmp, platform: 'darwin' })
    const configStore = createConfigStore({ configFile: paths.configFile })
    const fakeAgent = join(tmp, 'fury-agent')
    await writeFile(fakeAgent, '#!/bin/sh\necho ok\n', { mode: 0o755 })

    let fetchCalls = 0
    let releaseFetch = null
    const installer = createInstaller({
      paths,
      configStore,
      platform: 'darwin',
      arch: 'arm64',
      fetchImpl: () => {
        fetchCalls += 1
        return new Promise((resolve) => {
          releaseFetch = () =>
            resolve({
              ok: true,
              status: 200,
              headers: new Headers({ 'content-length': '8' }),
              body: (async function* () {
                yield Buffer.from('mismatch')
              })(),
            })
        })
      },
    })

    // 1. Calling with undefined rejects cleanly rather than throwing synchronously
    await assert.rejects(() => installer.installCore(), (err) => err.code === 'agent-not-installed')

    // 2. Synchronous transition to downloading before any microtask resolves + concurrent dedup
    const p1 = installer.installCore({ agentBinaryPath: fakeAgent })
    assert.equal(installer.getStatus().core.status, 'downloading')
    const p2 = installer.installCore({ agentBinaryPath: fakeAgent })
    assert.equal(p1, p2, 'concurrent installCore calls must share in-flight promise')

    // Wait one tick for pathAccessible -> fetchImpl
    for (let i = 0; i < 20 && !releaseFetch; i += 1) {
      await new Promise((r) => setTimeout(r, 5))
    }
    assert.equal(fetchCalls, 1)
    releaseFetch()

    await assert.rejects(() => p1, (err) => err.code === 'checksum-mismatch')
    assert.equal(installer.getStatus().core.status, 'error')
    assert.match(installer.getStatus().core.error, /SHA-256/)

    // 3. Missing agentBinaryPath rejects with agent-not-installed and records error status
    await assert.rejects(
      () => installer.installCore({ agentBinaryPath: join(tmp, 'does-not-exist') }),
      (err) => err.code === 'agent-not-installed',
    )
    assert.equal(installer.getStatus().core.status, 'error')
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
