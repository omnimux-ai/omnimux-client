import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { createLibraryStore } from './library.js'
import { createLibraryMediaProvider } from './media-provider.js'
import { resolveAssetsPaths } from './paths.js'

const temps = []
afterEach(() => {
  while (temps.length) rmSync(temps.pop(), { recursive: true, force: true })
})

function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'omnimux-assets-media-provider-'))
  temps.push(dir)
  const paths = resolveAssetsPaths({ homeDir: dir })
  const library = createLibraryStore({ paths })
  return { dir, library, provider: createLibraryMediaProvider({ library }) }
}

async function collectBytes(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

describe('omnimux-assets library-file media provider', () => {
  it('stats and streams verified video, audio, and raster image files with exact range slicing', async () => {
    const { dir, library, provider } = makeWorkspace()
    const payload = Buffer.from('fake-mp3-audio-bytes-for-range-check')
    const expectedSha = createHash('sha256').update(payload).digest('hex')
    const sourcePath = join(dir, 'bgm.mp3')
    writeFileSync(sourcePath, payload)

    const asset = await library.add({
      name: 'Demo BGM',
      type: 'custom',
      files: [{ real_path: sourcePath, original_name: 'bgm.mp3' }],
    })
    const fileId = asset.files[0].id
    const handle = { v: 1, scope: 'library-file', libraryAssetId: asset.id, fileId }

    const st = await provider.stat(handle)
    assert.equal(st.status, 'ok')
    assert.equal(st.exists, true)
    assert.equal(st.currentSha256, expectedSha)
    assert.equal(st.mimeType, 'audio/mpeg')
    assert.deepEqual(st.canonicalHandle, { ...handle, sha256: expectedSha })

    const opened = await provider.open({ ...handle, sha256: expectedSha })
    assert.equal(opened.sha256, expectedSha)
    assert.equal(opened.size, payload.length)
    assert.deepEqual(await collectBytes(opened.openRange(5, 13)), payload.subarray(5, 14))
  })

  it('reports digest_mismatch and refuses open when requested sha256 differs from bytes on disk', async () => {
    const { dir, library, provider } = makeWorkspace()
    const sourcePath = join(dir, 'frame.png')
    writeFileSync(sourcePath, Buffer.from('\x89PNG\r\n\x1a\n0123456789'))
    const asset = await library.add({
      name: 'Hero Frame',
      type: 'scene',
      files: [{ real_path: sourcePath, original_name: 'frame.png' }],
    })
    const fileId = asset.files[0].id
    const wrongHandle = { v: 1, scope: 'library-file', libraryAssetId: asset.id, fileId, sha256: '0'.repeat(64) }

    const st = await provider.stat(wrongHandle)
    assert.equal(st.status, 'digest_mismatch')
    assert.equal(st.exists, true)
    await assert.rejects(() => provider.open(wrongHandle), (err) => err.code === 'media-version-mismatch')
  })

  it('rejects SVG files and deleted or missing assets', async () => {
    const { dir, library, provider } = makeWorkspace()
    const svgPath = join(dir, 'vector.svg')
    writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    const svgAsset = await library.add({
      name: 'Vector Icon',
      type: 'prop',
      files: [{ real_path: svgPath, original_name: 'vector.svg' }],
    })
    const svgHandle = { v: 1, scope: 'library-file', libraryAssetId: svgAsset.id, fileId: svgAsset.files[0].id }
    assert.equal((await provider.stat(svgHandle)).status, 'unsupported')
    await assert.rejects(() => provider.open(svgHandle), (err) => err.code === 'unsupported-media')

    const missingHandle = { v: 1, scope: 'library-file', libraryAssetId: 'ast_missing', fileId: 'f_missing' }
    assert.equal((await provider.stat(missingHandle)).status, 'not_found')
    await assert.rejects(() => provider.open(missingHandle), (err) => err.code === 'media-not-found')
  })
})
