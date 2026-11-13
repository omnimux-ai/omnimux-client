import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { bucketOf, extOf, previewMimeOf, scanDir, statStatus } from './scanner.js'

let root
let dir

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'assets-scanner-'))
  dir = join(root, 'scan-target')
  mkdirSync(dir)
  writeFileSync(join(dir, 'hero.png'), 'png')
  writeFileSync(join(dir, 'notes.md'), 'notes')
  writeFileSync(join(dir, 'data.json'), '{}')
  writeFileSync(join(dir, 'noext'), 'x')
  writeFileSync(join(dir, '.DS_Store'), 'junk')
  mkdirSync(join(dir, 'sub'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('extOf / bucketOf', () => {
  it('extracts lowercase extensions and maps buckets', () => {
    assert.equal(extOf('a.PNG'), '.png')
    assert.equal(extOf('noext'), '')
    assert.equal(extOf('.hidden'), '')
    assert.equal(extOf('archive.tar.gz'), '.gz')
    assert.equal(bucketOf('.png'), 'image')
    assert.equal(bucketOf('.mp4'), 'video')
    assert.equal(bucketOf('.mp3'), 'audio')
    assert.equal(bucketOf('.md'), 'document')
    assert.equal(bucketOf('.html'), 'html')
    assert.equal(bucketOf('.json'), 'json')
    assert.equal(bucketOf('.weird'), 'other')
    assert.equal(previewMimeOf('a.PNG'), 'image/png')
    assert.equal(previewMimeOf('clip.mp4'), 'video/mp4')
    assert.equal(previewMimeOf('notes.md'), null)
  })
})

describe('statStatus', () => {
  it('marks existing directories ok and everything else invalid', () => {
    assert.equal(statStatus(dir), 'ok')
    assert.equal(statStatus(join(dir, 'hero.png')), 'invalid')
    assert.equal(statStatus(join(root, 'missing')), 'invalid')
  })
})

describe('scanDir', () => {
  it('scans one layer with metadata and ignores .DS_Store', () => {
    const files = scanDir(dir)
    const names = files.map((file) => file.name)
    // Directories sort before files (file-manager convention).
    assert.deepEqual(names, ['sub', 'data.json', 'hero.png', 'noext', 'notes.md'])
    assert.ok(!names.includes('.DS_Store'))

    const hero = files.find((file) => file.name === 'hero.png')
    assert.equal(hero.ext, '.png')
    assert.equal(hero.type, 'image')
    assert.equal(hero.is_dir, false)
    assert.equal(hero.size, 3)
    assert.ok(!Number.isNaN(Date.parse(hero.mtime)))
    assert.equal(hero.relative_path, 'hero.png')

    const sub = files.find((file) => file.name === 'sub')
    assert.equal(sub.is_dir, true)
    assert.equal(sub.type, 'other')
    assert.equal(sub.size, 0)
  })

  it('returns [] for missing or unreadable paths', () => {
    assert.deepEqual(scanDir(join(root, 'missing')), [])
  })

  it('truncates at maxEntries', () => {
    const big = join(root, 'big')
    mkdirSync(big)
    for (let index = 0; index < 5; index += 1) {
      writeFileSync(join(big, `f${index}.txt`), String(index))
    }
    const files = scanDir(big, { maxEntries: 2 })
    assert.equal(files.length, 2)
  })

  it('accepts injected read-only fs deps', () => {
    const fakeReaddir = () => ['only.txt']
    const fakeStat = () => ({ isDirectory: () => false, size: 7, mtimeMs: 0 })
    const files = scanDir(dir, {}, { readdir: fakeReaddir, stat: fakeStat })
    assert.equal(files.length, 1)
    assert.equal(files[0].name, 'only.txt')
    assert.equal(files[0].size, 7)
  })
})
