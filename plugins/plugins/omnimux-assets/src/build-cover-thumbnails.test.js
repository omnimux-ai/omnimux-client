import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
import { pruneCatalogRows } from '../scripts/prune-catalog-rows.mjs'

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

  it('enrichIndexRowsWithPageBytes 从 all/page-*.json 回填缺失的 meta.bytes，使 --max-bytes 精准生效', () => {
    const dir = makeTempDir()
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

  it('applyThumbManifest 幂等回填 index.json 与全部 page 分片，保留已有 thumb_url 并拒绝越界 key', () => {
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

  it('pruneCatalogRows 摘除死链视频并清空失效封面，重算 manifest/index/分片且清理多余尾页', () => {
    const dir = makeTempDir()
    const catalogDir = join(dir, 'catalog')
    mkdirSync(join(catalogDir, 'all'), { recursive: true })
    mkdirSync(join(catalogDir, 'character'), { recursive: true })
    mkdirSync(join(catalogDir, 'material', 'hook'), { recursive: true })
    mkdirSync(join(catalogDir, 'style', 'anime-2d'), { recursive: true })

    const rows = [
      { id: 'char-1', category: 'character', sub_category: 'digital-human', sub_categories: ['digital-human'], name: 'c1', description: '', media_type: 'video', media_url: 'https://assets.omnimux.ai/a.mp4', cover_url: 'https://assets.omnimux.ai/a.jpg', thumb_url: 'https://assets.omnimux.ai/thumbs/char-1.webp', tags: [], meta: { dims: { gender: 'female' } } },
      { id: 'mat-dead', category: 'material', sub_category: 'hook', sub_categories: ['hook'], name: 'dead', description: '', media_type: 'video', media_url: 'https://assets.omnimux.ai/dead.mp4', cover_url: '', tags: [] },
      { id: 'mat-ok-1', category: 'material', sub_category: 'hook', sub_categories: ['hook'], name: 'm1', description: '', media_type: 'video', media_url: 'https://assets.omnimux.ai/1.mp4', cover_url: '', thumb_url: 'https://assets.omnimux.ai/thumbs/mat-ok-1.webp', tags: [], meta: { bytes: 5000 } },
      { id: 'mat-ok-2', category: 'material', sub_category: 'hook', sub_categories: ['hook'], name: 'm2', description: '', media_type: 'video', media_url: 'https://assets.omnimux.ai/2.mp4', cover_url: '', thumb_url: 'https://assets.omnimux.ai/thumbs/mat-ok-2.webp', tags: [], meta: { bytes: 6000 } },
      { id: 'style-404', category: 'style', sub_category: 'anime-2d', sub_categories: ['anime-2d'], name: 's1', description: 'anime prompt', media_type: 'other', media_url: '', cover_url: 'https://assets.omnimux.ai/styles/anime-2d/missing.webp', tags: ['生图预设'] },
    ]
    const pageSize = 2
    const manifest = {
      version: 1,
      generatedAt: '2026-11-26T00:00:00.000Z',
      pageSize,
      totalAssets: rows.length,
      sourceRoot: '',
      categories: [
        { id: 'character', zh: '角色', total: 1, pages: 1, sub_categories: [{ id: 'character_filtered', total: 1, pages: 1 }] },
        { id: 'material', zh: '素材', total: 3, pages: 2, sub_categories: [{ id: 'hook', total: 3, pages: 2 }] },
        { id: 'style', zh: '风格', total: 1, pages: 1, sub_categories: [{ id: 'anime-2d', total: 1, pages: 1 }] },
      ],
    }
    const manifestBefore = `${JSON.stringify(manifest)}\n`
    writeFileSync(join(catalogDir, 'manifest.json'), manifestBefore)
    writeFileSync(join(catalogDir, 'index.json'), `${JSON.stringify(rows)}\n`)
    writeFileSync(join(catalogDir, 'character', 'page-0000.json'), `${JSON.stringify({ scope: 'character', page: 0, pageSize, total: 1, totalPages: 1, items: [rows[0]] })}\n`)
    // Untouched character marker file verifies untouched categories are preserved
    writeFileSync(join(catalogDir, 'all', 'page-0000.json'), `${JSON.stringify({ scope: 'all', page: 0, pageSize, total: 5, totalPages: 3, items: rows.slice(0, 2) })}\n`)
    writeFileSync(join(catalogDir, 'all', 'page-0001.json'), `${JSON.stringify({ scope: 'all', page: 1, pageSize, total: 5, totalPages: 3, items: rows.slice(2, 4) })}\n`)
    writeFileSync(join(catalogDir, 'all', 'page-0002.json'), `${JSON.stringify({ scope: 'all', page: 2, pageSize, total: 5, totalPages: 3, items: rows.slice(4, 5) })}\n`)
    writeFileSync(join(catalogDir, 'material', 'page-0000.json'), `${JSON.stringify({ scope: 'material', page: 0, pageSize, total: 3, totalPages: 2, items: [rows[1], rows[2]] })}\n`)
    writeFileSync(join(catalogDir, 'material', 'page-0001.json'), `${JSON.stringify({ scope: 'material', page: 1, pageSize, total: 3, totalPages: 2, items: [rows[3]] })}\n`)
    writeFileSync(join(catalogDir, 'material', 'hook', 'page-0000.json'), `${JSON.stringify({ scope: 'material/hook', page: 0, pageSize, total: 3, totalPages: 2, items: [rows[1], rows[2]] })}\n`)
    writeFileSync(join(catalogDir, 'material', 'hook', 'page-0001.json'), `${JSON.stringify({ scope: 'material/hook', page: 1, pageSize, total: 3, totalPages: 2, items: [rows[3]] })}\n`)
    writeFileSync(join(catalogDir, 'style', 'page-0000.json'), `${JSON.stringify({ scope: 'style', page: 0, pageSize, total: 1, totalPages: 1, items: [rows[4]] })}\n`)
    writeFileSync(join(catalogDir, 'style', 'anime-2d', 'page-0000.json'), `${JSON.stringify({ scope: 'style/anime-2d', page: 0, pageSize, total: 1, totalPages: 1, items: [rows[4]] })}\n`)

    // dryRun 零写入
    const dry = pruneCatalogRows({ catalogDir, dropIds: ['mat-dead'], clearCoverIds: ['style-404'], dryRun: true })
    assert.equal(dry.dropped, 1)
    assert.equal(dry.coversCleared, 1)
    assert.equal(dry.orphanPageFilesRemoved, 3)
    assert.equal(readFileSync(join(catalogDir, 'manifest.json'), 'utf8'), manifestBefore)

    const res = pruneCatalogRows({ catalogDir, dropIds: ['mat-dead'], clearCoverIds: ['style-404'] })
    assert.equal(res.totalBefore, 5)
    assert.equal(res.totalAfter, 4)
    assert.equal(res.dropped, 1)
    assert.equal(res.coversCleared, 1)
    assert.equal(res.orphanPageFilesRemoved, 3)

    // Excess tail page-0002 (all) & page-0001 (material, material/hook) are removed
    assert.equal(existsSync(join(catalogDir, 'all', 'page-0002.json')), false)
    assert.equal(existsSync(join(catalogDir, 'material', 'page-0001.json')), false)
    assert.equal(existsSync(join(catalogDir, 'material', 'hook', 'page-0001.json')), false)

    const updatedManifest = JSON.parse(readFileSync(join(catalogDir, 'manifest.json'), 'utf8'))
    assert.equal(updatedManifest.totalAssets, 4)
    assert.equal(updatedManifest.categories[1].total, 2)
    assert.equal(updatedManifest.categories[1].pages, 1)
    assert.equal(updatedManifest.categories[1].sub_categories[0].total, 2)

    const updatedIndex = JSON.parse(readFileSync(join(catalogDir, 'index.json'), 'utf8'))
    assert.deepEqual(updatedIndex.map((r) => r.id), ['char-1', 'mat-ok-1', 'mat-ok-2', 'style-404'])
    // indexEntryOf strips meta.bytes while preserving dims & prompt description
    assert.equal(updatedIndex.find((r) => r.id === 'mat-ok-1').meta, undefined)
    assert.deepEqual(updatedIndex.find((r) => r.id === 'char-1').meta, { dims: { gender: 'female' } })
    const styleIndexRow = updatedIndex.find((r) => r.id === 'style-404')
    assert.equal(styleIndexRow.cover_url, '')
    assert.equal(styleIndexRow.description, 'anime prompt')

    // 二次运行完全幂等
    const secondPrune = pruneCatalogRows({ catalogDir, dropIds: ['mat-dead'], clearCoverIds: ['style-404'] })
    assert.equal(secondPrune.dropped, 0)
    assert.equal(secondPrune.coversCleared, 0)
    assert.equal(secondPrune.pageFilesWritten, 0)
  })
})
