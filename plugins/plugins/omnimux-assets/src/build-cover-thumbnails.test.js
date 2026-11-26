import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  buildThumbnails,
  enrichIndexRowsWithPageBytes,
  extractVideoFirstFrame,
  needsThumbnail,
  needsVideoPoster,
  planThumbs,
  RECOMMENDED_MAX_COVER_BYTES,
  validateVideoSourceUrl,
} from '../scripts/build-cover-thumbnails.mjs'
import { applyThumbManifest, resolveThumbPublicUrl } from '../scripts/apply-thumb-manifest.mjs'

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

  it('extractVideoFirstFrame 拒绝选项注入与非 HTTP(S) 协议，并固定 -nostdin 与 -protocol_whitelist', async () => {
    const badInputs = [
      '',
      '-i',
      '-protocol_whitelist',
      'file:///etc/passwd',
      '/etc/passwd',
      'concat:a.mp4|b.mp4',
      'lavfi:testsrc',
      'ftp://assets.omnimux.ai/a.mp4',
    ]
    for (const bad of badInputs) {
      assert.throws(() => validateVideoSourceUrl(bad))
      await assert.rejects(() => extractVideoFirstFrame(bad, {
        execFileImpl: () => {
          throw new Error('must not spawn ffmpeg for rejected input')
        },
      }))
    }

    let capturedBin = ''
    let capturedArgs = []
    const frame = await extractVideoFirstFrame('https://assets.omnimux.ai/elements/hooks/clip.mp4', {
      ffmpegBin: '/custom/ffmpeg',
      execFileImpl: (bin, args, _opts, cb) => {
        capturedBin = bin
        capturedArgs = args
        cb(null, Buffer.from('PNG_FRAME'))
      },
    })
    assert.equal(frame.toString('utf8'), 'PNG_FRAME')
    assert.equal(capturedBin, '/custom/ffmpeg')
    assert.ok(capturedArgs.includes('-nostdin'))
    const wlIdx = capturedArgs.indexOf('-protocol_whitelist')
    assert.ok(wlIdx >= 0)
    assert.equal(capturedArgs[wlIdx + 1], 'https,http,tcp,tls')
    const iIdx = capturedArgs.indexOf('-i')
    assert.equal(capturedArgs[iIdx + 1], 'https://assets.omnimux.ai/elements/hooks/clip.mp4')
  })

  it('enrichIndexRowsWithPageBytes 从 all/page-*.json 回填缺失的 meta.bytes，使 --max-bytes 精准生效', async () => {
    const dir = makeTempDir()
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(dir, 'all'), { recursive: true })
    writeFileSync(join(dir, 'all', 'page-0000.json'), JSON.stringify({
      items: [
        { id: 'scene-big', meta: { bytes: 512_000 } },
        { id: 'scene-small', meta: { bytes: 42_000 } },
      ],
    }))
    const enriched = enrichIndexRowsWithPageBytes(dir, [
      { id: 'scene-big', category: 'scene', media_type: 'image', cover_url: 'https://assets.omnimux.ai/scenes/big.jpg', media_url: 'https://assets.omnimux.ai/scenes/big.jpg', meta: {} },
      { id: 'scene-small', category: 'scene', media_type: 'image', cover_url: 'https://assets.omnimux.ai/scenes/small.jpg', media_url: 'https://assets.omnimux.ai/scenes/small.jpg', meta: {} },
    ])
    assert.equal(enriched[0].meta.bytes, 512_000)
    assert.equal(enriched[1].meta.bytes, 42_000)
    assert.equal(needsThumbnail(enriched[0], { maxBytes: 300 * 1024 }), true)
    assert.equal(needsThumbnail(enriched[1], { maxBytes: 300 * 1024 }), false)
  })

  it('applyThumbManifest 幂等回填 index.json 与全部 page 分片，保留已有 thumb_url 并拒绝越界 key', async () => {
    assert.throws(() => resolveThumbPublicUrl('../escape.webp'))
    assert.throws(() => resolveThumbPublicUrl('other/a.webp'))
    assert.throws(() => resolveThumbPublicUrl('thumbs/'))
    assert.throws(() => resolveThumbPublicUrl('/thumbs/a.webp'))
    assert.throws(() => resolveThumbPublicUrl('thumbs/%2e%2e/a.webp'))
    assert.throws(() => resolveThumbPublicUrl('thumbs/..a.webp'))
    assert.throws(() => resolveThumbPublicUrl('thumbs/sub/a.webp'))
    assert.throws(() => resolveThumbPublicUrl('thumbs/a.webp?q=1'))
    assert.throws(() => resolveThumbPublicUrl('thumbs/a.webp#frag'))
    assert.throws(() => resolveThumbPublicUrl('thumbs/a.png'))
    assert.throws(() => resolveThumbPublicUrl('thumbs/demo.webp', 'http://assets.omnimux.ai'))
    assert.throws(() => resolveThumbPublicUrl('thumbs/demo.webp', 'https://assets.omnimux.ai?q=1'))
    assert.throws(() => resolveThumbPublicUrl('thumbs/demo.webp', ''))
    assert.equal(
      resolveThumbPublicUrl('thumbs/demo.webp'),
      'https://assets.omnimux.ai/thumbs/demo.webp',
    )

    const dir = makeTempDir()
    const catalogDir = join(dir, 'catalog')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(catalogDir, 'all'), { recursive: true })
    mkdirSync(join(catalogDir, 'material'), { recursive: true })

    const initialIndexText = JSON.stringify([
      { id: 'existing-row', category: 'character', thumb_url: 'https://assets.omnimux.ai/thumbs/existing-row.webp' },
      { id: 'hook-1', category: 'material', cover_url: '', media_type: 'video' },
      { id: 'replace-row', category: 'scene', thumb_url: 'https://assets.omnimux.ai/thumbs/old-replace-row.webp' },
    ])
    writeFileSync(join(catalogDir, 'index.json'), initialIndexText)
    writeFileSync(join(catalogDir, 'all', 'page-0000.json'), JSON.stringify({
      scope: 'all',
      items: [
        { id: 'existing-row', category: 'character', thumb_url: 'https://assets.omnimux.ai/thumbs/existing-row.webp' },
        { id: 'hook-1', category: 'material', cover_url: '', media_type: 'video' },
        { id: 'replace-row', category: 'scene', thumb_url: 'https://assets.omnimux.ai/thumbs/old-replace-row.webp' },
      ],
    }))
    writeFileSync(join(catalogDir, 'material', 'page-0000.json'), JSON.stringify({
      scope: 'material',
      items: [{ id: 'hook-1', category: 'material', cover_url: '', media_type: 'video' }],
    }))
    const manifestPath = join(dir, 'thumb-manifest.json')
    writeFileSync(manifestPath, JSON.stringify({
      schema: 1,
      rows: [
        { id: 'hook-1', key: 'thumbs/hook-1.webp', bytes: 22_000, sha256: 'abc' },
        { id: 'replace-row', key: 'thumbs/replace-row.webp', bytes: 30_000, sha256: 'def' },
      ],
    }))

    // dryRun 仅统计，不修改任何磁盘文件
    const preview = applyThumbManifest({ manifestPath, catalogDir, dryRun: true })
    assert.equal(preview.dryRun, true)
    assert.equal(preview.indexAdded, 1)
    assert.equal(preview.indexUpdated, 1)
    assert.equal(preview.indexPreserved, 1)
    assert.equal(readFileSync(join(catalogDir, 'index.json'), 'utf8'), initialIndexText)

    const first = applyThumbManifest({ manifestPath, catalogDir })
    assert.equal(first.indexAdded, 1)
    assert.equal(first.indexUpdated, 1)
    assert.equal(first.indexPreserved, 1)
    assert.equal(first.indexTotalWithThumb, 3)
    assert.equal(first.pagesTouched, 2)
    assert.equal(first.pageItemsAttached, 3)

    const updatedIndex = JSON.parse(readFileSync(join(catalogDir, 'index.json'), 'utf8'))
    assert.equal(updatedIndex[0].thumb_url, 'https://assets.omnimux.ai/thumbs/existing-row.webp')
    assert.equal(updatedIndex[1].thumb_url, 'https://assets.omnimux.ai/thumbs/hook-1.webp')
    assert.equal(updatedIndex[2].thumb_url, 'https://assets.omnimux.ai/thumbs/replace-row.webp')
    const updatedMatPage = JSON.parse(readFileSync(join(catalogDir, 'material', 'page-0000.json'), 'utf8'))
    assert.equal(updatedMatPage.items[0].thumb_url, 'https://assets.omnimux.ai/thumbs/hook-1.webp')

    // 二次运行应完全幂等（0 新增、0 更新、0 分片重写）
    const second = applyThumbManifest({ manifestPath, catalogDir })
    assert.equal(second.indexAdded, 0)
    assert.equal(second.indexUpdated, 0)
    assert.equal(second.pagesTouched, 0)
  })
})
