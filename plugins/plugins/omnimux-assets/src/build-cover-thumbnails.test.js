import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  buildThumbnails,
  needsThumbnail,
  needsVideoPoster,
  planThumbs,
  RECOMMENDED_MAX_COVER_BYTES,
} from '../scripts/build-cover-thumbnails.mjs'

const temps = []
function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'assets-thumbs-test-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop(), { recursive: true, force: true })
  }
})

const SAMPLE_ROWS = [
  {
    id: 'character-animal-1',
    category: 'character',
    media_type: 'audio',
    cover_url: 'https://assets.omnimux.ai/avatars/owl.png',
    media_url: 'https://assets.omnimux.ai/avatars/owl.wav',
    meta: { bytes: 420_000 },
  },
  {
    id: 'character-pippit-1',
    category: 'character',
    media_type: 'video',
    cover_url: 'https://assets.omnimux.ai/public-avatars/pippit/cover.jpg',
    media_url: 'https://assets.omnimux.ai/public-avatars/pippit/video.mp4',
    meta: { bytes: 3_200_000 },
  },
  {
    id: 'scene-small-jpg',
    category: 'scene',
    media_type: 'image',
    cover_url: 'https://assets.omnimux.ai/scenes/small.jpg',
    media_url: 'https://assets.omnimux.ai/scenes/small.jpg',
    meta: { bytes: 48_000 },
  },
  {
    id: 'scene-big-jpg',
    category: 'scene',
    media_type: 'image',
    cover_url: 'https://assets.omnimux.ai/scenes/big.jpg',
    media_url: 'https://assets.omnimux.ai/scenes/big.jpg',
    meta: { bytes: 650_000 },
  },
  {
    id: 'style-already-webp',
    category: 'style',
    media_type: 'image',
    cover_url: 'https://assets.omnimux.ai/styles/a.webp',
    media_url: 'https://assets.omnimux.ai/styles/a.webp',
    meta: { bytes: 250_000 },
  },
  {
    id: 'material-hook-video',
    category: 'material',
    media_type: 'video',
    cover_url: '',
    media_url: 'https://assets.omnimux.ai/elements/hooks/clip.mp4',
    meta: { bytes: 10_900_000 },
  },
  {
    id: 'legacy-file-row',
    category: 'character',
    media_type: 'image',
    cover_url: 'file:local/a.png',
    media_url: 'file:local/a.png',
    meta: { bytes: 500_000 },
  },
]

describe('build-cover-thumbnails: 扩展角色 JPG、大图阈值与无封面视频首帧提取 (Issue #324)', () => {
  it('默认参数保持向后兼容，仅选中远程 .png 封面', () => {
    const plan = planThumbs(SAMPLE_ROWS)
    assert.deepEqual(plan.map((r) => r.id), ['character-animal-1'])
    assert.equal(plan[0].sourceKind, 'cover')
  })

  it('--include-categories=character 与 --max-bytes 精准选中角色 JPG 与超大场景 JPG，跳过小图与已有 webp', () => {
    assert.equal(needsThumbnail(SAMPLE_ROWS[1], { includeCategories: 'character' }), true)
    assert.equal(needsThumbnail(SAMPLE_ROWS[2], { maxBytes: RECOMMENDED_MAX_COVER_BYTES }), false)
    assert.equal(needsThumbnail(SAMPLE_ROWS[3], { maxBytes: RECOMMENDED_MAX_COVER_BYTES }), true)
    assert.equal(needsThumbnail(SAMPLE_ROWS[4], { maxBytes: RECOMMENDED_MAX_COVER_BYTES }), false)
    assert.equal(needsVideoPoster(SAMPLE_ROWS[5], { videoPosters: true }), true)
    assert.equal(needsVideoPoster(SAMPLE_ROWS[1], { videoPosters: true }), false)

    const plan = planThumbs(SAMPLE_ROWS, {
      includeCategories: 'character',
      maxBytes: RECOMMENDED_MAX_COVER_BYTES,
      videoPosters: true,
    })
    assert.deepEqual(
      plan.map((r) => [r.id, r.sourceKind]),
      [
        ['character-animal-1', 'cover'],
        ['character-pippit-1', 'cover'],
        ['material-hook-video', 'video-poster'],
        ['scene-big-jpg', 'cover'],
      ],
    )
  })

  it('buildThumbnails --recommended 协同封面下载与视频抽帧，产出确定性 thumb-manifest.json', async () => {
    const dir = makeTempDir()
    const catalogDir = join(dir, 'catalog')
    const outDir = join(dir, 'out')
    writeFileSync(join(dir, 'noop'), '')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(catalogDir, { recursive: true })
    writeFileSync(join(catalogDir, 'index.json'), JSON.stringify(SAMPLE_ROWS))

    const fetchedCovers = []
    const extractedVideos = []
    const fakeSharp = (buf) => ({
      resize() { return this },
      webp() { return this },
      async toBuffer() { return Buffer.concat([Buffer.from('WEBP:'), buf]) },
    })

    const res = await buildThumbnails({
      catalogDir,
      outDir,
      recommended: true,
      generatedAt: '2026-11-26T00:00:00.000Z',
      sharp: fakeSharp,
      fetchImpl: async (url) => {
        fetchedCovers.push(url)
        return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(`img:${url}`).buffer }
      },
      extractFrameImpl: async (url) => {
        extractedVideos.push(url)
        return Buffer.from(`frame:${url}`)
      },
      log: () => {},
    })

    assert.equal(res.written, 4)
    assert.equal(res.skipped, 0)
    assert.equal(fetchedCovers.length, 3)
    assert.deepEqual(extractedVideos, ['https://assets.omnimux.ai/elements/hooks/clip.mp4'])
    assert.equal(existsSync(join(outDir, 'thumbs', 'material-hook-video.webp')), true)
    const manifest = JSON.parse(readFileSync(join(outDir, 'thumb-manifest.json'), 'utf8'))
    assert.equal(manifest.scope, 'recommended')
    assert.equal(manifest.total, 4)
    assert.deepEqual(
      manifest.rows.map((r) => r.id),
      ['character-animal-1', 'character-pippit-1', 'material-hook-video', 'scene-big-jpg'],
    )
  })
})
