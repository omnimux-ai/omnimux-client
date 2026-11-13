import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { contentTypeOf, createMediaStore, mediaKindOf } from './media.js'
import { PublishError } from './store.js'

/** @type {string} */
let dir = ''
/** @type {ReturnType<typeof createMediaStore>} */
let media = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-publish-media-'))
  media = createMediaStore({
    paths: { mediaIndexFile: join(dir, 'media.json'), mediaDir: join(dir, 'media') },
    maxBytes: 1024,
  })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('MediaStore content addressing', () => {
  it('importBuffer stores bytes at media/<sha256> with 0600 and indexes the row', () => {
    const { media: row } = media.importBuffer(Buffer.from('hello'), { filename: 'a.txt' })
    assert.equal(row.sha256.length, 64)
    assert.equal(row.filename, 'a.txt')
    assert.equal(row.size, 5)
    const file = join(dir, 'media', row.sha256)
    assert.ok(existsSync(file))
    assert.equal(statSync(file).mode & 0o777, 0o600)
    const opened = media.open(row.id)
    assert.equal(opened.buffer.toString(), 'hello')
  })

  it('deduplicates identical content (sha256 addressing)', () => {
    const first = media.importBuffer(Buffer.from('same-bytes'), { filename: 'one.png', content_type: 'image/png' })
    const second = media.importBuffer(Buffer.from('same-bytes'), { filename: 'two.png', content_type: 'image/png' })
    assert.equal(first.deduplicated, false)
    assert.equal(second.deduplicated, true)
    assert.equal(first.media.id, second.media.id)
    assert.equal(media.list().length, 1)
  })

  it('importPath copies a local file without touching the source', () => {
    const src = join(dir, 'source.bin')
    writeFileSync(src, Buffer.from('from-disk'))
    const { media: row } = media.importPath(src)
    assert.equal(row.filename, 'source.bin')
    assert.equal(media.open(row.id).buffer.toString(), 'from-disk')
    assert.ok(existsSync(src)) // 源文件不动
  })

  it('importPath rejects missing paths and non-files', () => {
    assert.throws(() => media.importPath(join(dir, 'nope.bin')), (e) => e instanceof PublishError && e.code === 'path-not-found')
    assert.throws(() => media.importPath(dir), (e) => e.code === 'path-not-found')
  })

  it('enforces the size limit (大小限额)', () => {
    assert.throws(
      () => media.importBuffer(Buffer.alloc(2048)),
      (e) => e instanceof PublishError && e.code === 'media-too-large',
    )
  })

  it('open() flags missing content under an existing index row', () => {
    const { media: row } = media.importBuffer(Buffer.from('x'))
    rmSync(join(dir, 'media', row.sha256))
    assert.throws(() => media.open(row.id), (e) => e.code === 'media-not-found')
  })

  it('empty buffer rejected', () => {
    assert.throws(() => media.importBuffer(Buffer.alloc(0)), (e) => e.code === 'invalid-arguments')
  })
})

describe('kind and content-type helpers', () => {
  it('derives kind from content type', () => {
    assert.equal(mediaKindOf('image/png'), 'image')
    assert.equal(mediaKindOf('video/mp4'), 'video')
    assert.equal(mediaKindOf('application/pdf'), 'other')
  })

  it('derives content type from extension', () => {
    assert.equal(contentTypeOf('a.mp4'), 'video/mp4')
    assert.equal(contentTypeOf('b.JPG'.toLowerCase()), 'image/jpeg')
    assert.equal(contentTypeOf('c.xyz'), 'application/octet-stream')
  })

  it('video/image kinds flow through import', () => {
    const video = media.importBuffer(Buffer.from('v'), { filename: 'v.mp4' }).media
    const image = media.importBuffer(Buffer.from('i'), { filename: 'i.png' }).media
    assert.equal(video.kind, 'video')
    assert.equal(image.kind, 'image')
  })
})
