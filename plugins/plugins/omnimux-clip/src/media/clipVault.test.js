import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { resolveClipPaths } from '../paths.js'
import {
  collectUnreferencedBlobs,
  createClipVaultMediaProvider,
  inspectStagedMedia,
  persistToClipVault,
  vaultBlobPath,
} from './clipVault.js'

const temps = []
afterEach(() => {
  while (temps.length) rmSync(temps.pop(), { recursive: true, force: true })
})

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

async function readStream(iterable) {
  const chunks = []
  for await (const chunk of iterable) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function makeVault() {
  const home = mkdtempSync(join(tmpdir(), 'clip-vault-test-'))
  temps.push(home)
  const paths = resolveClipPaths({ homeDir: home })
  mkdirSync(paths.tmpDir, { recursive: true })
  mkdirSync(paths.projectsDir, { recursive: true })
  return { home, paths }
}

describe('clipVault', () => {
  it('inspects valid staged media and rejects SVG, HTML, empty files, and path escapes', async () => {
    const { home, paths } = makeVault()
    const mp4Bytes = Buffer.from('\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom-clip-vault')
    const stagedMp4 = join(paths.tmpDir, 'upload.bin')
    writeFileSync(stagedMp4, mp4Bytes)

    const inspected = await inspectStagedMedia({ paths, tempPath: stagedMp4, fileName: 'my clip.mp4' })
    assert.equal(inspected.sha256, sha256(mp4Bytes))
    assert.equal(inspected.size, mp4Bytes.length)
    assert.equal(inspected.mimeType, 'video/mp4')
    assert.equal(inspected.fileName, 'my clip.mp4')

    const svgPath = join(paths.tmpDir, 'bad.svg')
    writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    await assert.rejects(
      () => inspectStagedMedia({ paths, tempPath: svgPath, fileName: 'bad.svg', claimedMimeType: 'image/svg+xml' }),
      err => err.code === 'unsupported-media',
    )

    const htmlPath = join(paths.tmpDir, 'bad.png')
    writeFileSync(htmlPath, '<!doctype html><html><body>not a png</body></html>')
    await assert.rejects(
      () => inspectStagedMedia({ paths, tempPath: htmlPath, fileName: 'bad.png', claimedMimeType: 'image/png' }),
      err => err.code === 'unsupported-media',
    )

    const emptyPath = join(paths.tmpDir, 'empty.mp4')
    writeFileSync(emptyPath, Buffer.alloc(0))
    await assert.rejects(
      () => inspectStagedMedia({ paths, tempPath: emptyPath, fileName: 'empty.mp4' }),
      err => err.code === 'unsupported-media',
    )

    const outsidePath = join(home, 'outside.mp4')
    writeFileSync(outsidePath, mp4Bytes)
    await assert.rejects(
      () => inspectStagedMedia({ paths, tempPath: outsidePath, fileName: 'outside.mp4' }),
      err => err.code === 'path-denied',
    )
  })

  it('persists content-addressed blobs idempotently and streams verified byte ranges', async () => {
    const { paths } = makeVault()
    const payload = Buffer.concat([
      Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt '),
      Buffer.alloc(300 * 1024, 0x2a),
    ])
    const digest = sha256(payload)
    const staged1 = join(paths.tmpDir, 'rec1.bin')
    const staged2 = join(paths.tmpDir, 'rec2.bin')
    writeFileSync(staged1, payload)
    writeFileSync(staged2, payload)

    const info1 = await inspectStagedMedia({ paths, tempPath: staged1, fileName: 'voice.wav' })
    const saved1 = await persistToClipVault({ paths, ...info1 })
    assert.deepEqual(saved1.handle, {
      v: 1,
      scope: 'clip-vault',
      sha256: digest,
      mimeType: 'audio/wav',
      size: payload.length,
    })

    // Second identical upload deduplicates onto the exact same vault blob path
    const info2 = await inspectStagedMedia({ paths, tempPath: staged2, fileName: 'voice-copy.wav' })
    const saved2 = await persistToClipVault({ paths, ...info2 })
    assert.equal(saved2.sha256, digest)
    assert.equal(existsSync(vaultBlobPath(paths, digest)), true)

    const provider = createClipVaultMediaProvider({ paths })
    const st = await provider.stat(saved1.handle)
    assert.equal(st.status, 'ok')
    assert.equal(st.currentSha256, digest)
    assert.equal(st.mimeType, 'audio/wav')

    const opened = await provider.open(saved1.handle)
    const slice = await readStream(opened.openRange(10, 265 * 1024))
    assert.deepEqual(slice, payload.subarray(10, 265 * 1024 + 1))

    // Corrupting the blob on disk is rejected with digest_mismatch / media-version-mismatch
    writeFileSync(vaultBlobPath(paths, digest), Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt tampered'))
    const badStat = await provider.stat(saved1.handle)
    assert.equal(badStat.status, 'digest_mismatch')
    await assert.rejects(() => provider.open(saved1.handle), err => err.code === 'media-version-mismatch')

    const missingStat = await provider.stat({ v: 1, scope: 'clip-vault', sha256: '0'.repeat(64) })
    assert.equal(missingStat.status, 'not_found')
  })

  it('GC keeps blobs referenced in projects and .backups and recent unreferenced blobs, removing only stale orphans', async () => {
    const { paths } = makeVault()
    const makeBlob = async (tag) => {
      const buf = Buffer.from(`ID3\x03\x00\x00\x00\x00\x00\x00payload-${tag}`)
      const p = join(paths.tmpDir, `${tag}.mp3`)
      writeFileSync(p, buf)
      const info = await inspectStagedMedia({ paths, tempPath: p, fileName: `${tag}.mp3` })
      const saved = await persistToClipVault({ paths, ...info })
      return { digest: saved.sha256, file: vaultBlobPath(paths, saved.sha256) }
    }

    const active = await makeBlob('active')
    const backedUp = await makeBlob('backup')
    const recentOrphan = await makeBlob('recent-orphan')
    const staleOrphan = await makeBlob('stale-orphan')

    writeFileSync(join(paths.projectsDir, 'p1.json'), JSON.stringify({
      project: { mediaLibrary: { items: [{ id: 'm1', omnimuxSource: { handle: { v: 1, scope: 'clip-vault', sha256: active.digest } } }] } },
    }))
    mkdirSync(join(paths.projectsDir, '.backups'), { recursive: true })
    writeFileSync(join(paths.projectsDir, '.backups', 'p2-old.json'), JSON.stringify({
      project: { mediaLibrary: { items: [{ id: 'm2', omnimuxSource: { handle: { v: 1, scope: 'clip-vault', sha256: backedUp.digest } } }] } },
    }))

    const now = Date.now()
    const oldTime = new Date(now - 10 * 24 * 60 * 60 * 1000)
    utimesSync(staleOrphan.file, oldTime, oldTime)
    utimesSync(active.file, oldTime, oldTime)
    utimesSync(backedUp.file, oldTime, oldTime)

    const report = collectUnreferencedBlobs({ paths, now, graceMs: 7 * 24 * 60 * 60 * 1000 })
    assert.deepEqual(report, { scanned: 4, removed: 1, kept: 3 })
    assert.equal(existsSync(active.file), true)
    assert.equal(existsSync(backedUp.file), true)
    assert.equal(existsSync(recentOrphan.file), true)
    assert.equal(existsSync(staleOrphan.file), false)
  })
})
