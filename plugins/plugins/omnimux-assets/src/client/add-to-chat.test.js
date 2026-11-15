import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isImageFile,
  isVideoFile,
  pickCoverFile,
  inferAssetExtension,
  buildAssetPayload,
  buildMediaPayload,
  addAssetToConversation,
  addMediaToConversation,
} from './add-to-chat.js'
import { normalizeCloudAsset } from './cloud-feed-helpers.js'

describe('add-to-chat helpers', () => {
  describe('isImageFile', () => {
    it('recognizes kind === image or type === image', () => {
      assert.equal(isImageFile({ kind: 'image' }), true)
      assert.equal(isImageFile({ type: 'image' }), true)
      assert.equal(isImageFile({ kind: 'video' }), false)
      assert.equal(isImageFile(null), false)
    })

    it('recognizes mime type starting with image/', () => {
      assert.equal(isImageFile({ mime: 'image/png' }), true)
      assert.equal(isImageFile({ mime: 'image/jpeg' }), true)
      assert.equal(isImageFile({ mime: 'video/mp4' }), false)
    })

    it('recognizes image extensions from filename or path', () => {
      assert.equal(isImageFile({ original_name: 'avatar.PNG' }), true)
      assert.equal(isImageFile({ name: 'photo.webp' }), true)
      assert.equal(isImageFile({ real_path: '/path/to/hero.jpg' }), true)
      assert.equal(isImageFile({ relative_path: 'sub/icon.svg' }), true)
      assert.equal(isImageFile({ name: 'document.pdf' }), false)
      assert.equal(isImageFile({ name: 'clip.mp4' }), false)
    })
  })

  describe('isVideoFile', () => {
    it('recognizes kind === video or type === video', () => {
      assert.equal(isVideoFile({ kind: 'video' }), true)
      assert.equal(isVideoFile({ type: 'video' }), true)
      assert.equal(isVideoFile({ kind: 'image' }), false)
      assert.equal(isVideoFile(null), false)
    })

    it('recognizes mime type starting with video/', () => {
      assert.equal(isVideoFile({ mime: 'video/mp4' }), true)
      assert.equal(isVideoFile({ mime: 'video/webm' }), true)
      assert.equal(isVideoFile({ mime: 'image/png' }), false)
    })

    it('recognizes video extensions from filename or path', () => {
      assert.equal(isVideoFile({ original_name: 'trailer.MP4' }), true)
      assert.equal(isVideoFile({ name: 'clip.mov' }), true)
      assert.equal(isVideoFile({ real_path: '/path/to/shot.webm' }), true)
      assert.equal(isVideoFile({ relative_path: 'sub/seq.mkv' }), true)
      assert.equal(isVideoFile({ name: 'document.pdf' }), false)
      assert.equal(isVideoFile({ name: 'photo.jpg' }), false)
    })
  })

  describe('pickCoverFile', () => {
    it('prefers asset.cover if it is an image', () => {
      const asset = {
        cover: { id: 'cov1', kind: 'image', name: 'thumb.jpg' },
        files: [
          { id: 'f1', kind: 'image', name: 'other.png' },
        ],
      }
      assert.equal(pickCoverFile(asset)?.id, 'cov1')
    })

    it('falls back to first image file in asset.files if cover is not an image', () => {
      const asset = {
        cover: { id: 'cov_doc', kind: 'file', name: 'doc.pdf' },
        files: [
          { id: 'f_audio', kind: 'audio', name: 'track.mp3' },
          { id: 'f_img', kind: 'image', name: 'preview.png' },
        ],
      }
      assert.equal(pickCoverFile(asset)?.id, 'f_img')
    })

    it('returns null if no image exists or files is non-array', () => {
      const asset = {
        cover: { id: 'cov_doc', kind: 'file', name: 'doc.pdf' },
        files: [
          { id: 'f_audio', kind: 'audio', name: 'track.mp3' },
        ],
      }
      assert.equal(pickCoverFile(asset), null)
      assert.equal(pickCoverFile({ files: null }), null)
      assert.equal(pickCoverFile({ files: 'not-an-array' }), null)
    })
  })

  describe('inferAssetExtension', () => {
    it('extracts extension from path or name in uppercase', () => {
      assert.equal(inferAssetExtension({ original_name: 'hero.png' }), 'PNG')
      assert.equal(inferAssetExtension({ relative_path: 'a/b/c.jpeg' }), 'JPEG')
      assert.equal(inferAssetExtension({ real_path: 'foo/bar.webp' }), 'WEBP')
    })

    it('falls back to title or ASSET', () => {
      assert.equal(inferAssetExtension(null, 'sample.jpg'), 'JPG')
      assert.equal(inferAssetExtension(null, 'My Asset'), 'ASSET')
      assert.equal(inferAssetExtension({}, ''), 'ASSET')
    })
  })

  describe('buildAssetPayload', () => {
    it('builds standard payload conforming to OmniMux attachment schema and infers image kind', () => {
      const asset = {
        id: 'ast_123',
        name: '赛博朋克主角',
        type: 'character',
        cover: { id: 'fil_1', kind: 'image', name: 'hero.png', relative_path: 'images/hero.png' },
        files: [
          { id: 'fil_1', kind: 'image', name: 'hero.png', relative_path: 'images/hero.png' },
        ],
      }
      const payload = buildAssetPayload(asset)
      assert.ok(payload)
      assert.equal(payload.sourcePlugin, 'omnimux-assets')
      assert.equal(payload.kind, 'image')
      assert.equal(payload.entityId, 'ast_123')
      assert.equal(payload.title, '赛博朋克主角')
      assert.equal(payload.extension, 'PNG')
      assert.equal(payload.relativePath, 'images/hero.png')
      assert.match(payload.previewUrl, /\/omnimux\/assets\/library\/preview\?id=ast_123&file=fil_1/)
      assert.deepEqual(payload.metadata, {
        asset_id: 'ast_123',
        type: 'character',
        files: asset.files,
      })
    })

    it('infers video kind for single video asset', () => {
      const asset = {
        id: 'ast_vid',
        name: '动作特效.mp4',
        type: 'video',
        files: [
          { id: 'f_v1', name: 'vfx.mp4', relative_path: 'videos/vfx.mp4' },
        ],
      }
      const payload = buildAssetPayload(asset)
      assert.ok(payload)
      assert.equal(payload.kind, 'video')
      assert.equal(payload.extension, 'MP4')
    })

    it('keeps kind as asset for multi-file composite packs or directories', () => {
      const multiAsset = {
        id: 'ast_multi',
        name: '角色贴图集合',
        type: 'character',
        files: [
          { id: 'f1', kind: 'image', name: 'tex1.png' },
          { id: 'f2', kind: 'image', name: 'tex2.png' },
        ],
      }
      const payloadMulti = buildAssetPayload(multiAsset)
      assert.ok(payloadMulti)
      assert.equal(payloadMulti.kind, 'asset')

      const dirAsset = {
        id: 'ast_dir',
        name: '模型文件夹',
        type: 'directory',
        files: [
          { id: 'd1', kind: 'directory', name: 'models' },
        ],
      }
      const payloadDir = buildAssetPayload(dirAsset)
      assert.ok(payloadDir)
      assert.equal(payloadDir.kind, 'asset')
    })

    it('handles asset without name and falls back to default title', () => {
      const payload = buildAssetPayload({ id: 'ast_noname', files: [] })
      assert.ok(payload)
      assert.equal(payload.title, '资产')
      assert.equal(payload.extension, 'ASSET')
      assert.equal(payload.kind, 'asset')
    })

    it('returns null for null or missing id asset', () => {
      assert.equal(buildAssetPayload(null), null)
      assert.equal(buildAssetPayload({}), null)
    })
  })

  describe('buildMediaPayload', () => {
    it('infers image kind for image mediaItem', () => {
      const mediaItem = {
        id: 'item_img',
        sourceAssetId: 'ast_1',
        title: '红发蓝眸女性.png',
        previewUrl: '/api/preview/img',
        relativePath: 'assets/hero.png',
        extension: 'PNG',
      }
      const payload = buildMediaPayload(mediaItem)
      assert.ok(payload)
      assert.equal(payload.sourcePlugin, 'omnimux-assets')
      assert.equal(payload.kind, 'image')
      assert.equal(payload.entityId, 'ast_1')
      assert.equal(payload.title, '红发蓝眸女性.png')
      assert.equal(payload.extension, 'PNG')
      assert.equal(payload.previewUrl, '/api/preview/img')
    })

    it('infers video kind for video mediaItem', () => {
      const mediaItem = {
        id: 'item_vid',
        sourceAssetId: 'ast_2',
        title: '分镜片段.mov',
        extension: 'MOV',
      }
      const payload = buildMediaPayload(mediaItem)
      assert.ok(payload)
      assert.equal(payload.kind, 'video')
      assert.equal(payload.extension, 'MOV')
    })

    it('retains asset kind for non-media / folder items', () => {
      const folderItem = {
        id: 'item_folder',
        sourceAssetId: 'ast_3',
        title: '未分类素材包',
        kind: 'folder',
      }
      const payload = buildMediaPayload(folderItem)
      assert.ok(payload)
      assert.equal(payload.kind, 'asset')
    })
  })

  describe('addAssetToConversation', () => {
    it('reveals conversation column, invokes store.addAttachment, and dispatches CustomEvent', () => {
      let collapsedState = null
      let focusMode = null
      let storeSessionId = null
      let storePayload = null
      let dispatchedEvent = null

      const fakeWorkbench = {
        setConversationCollapsed: (c) => { collapsedState = c },
        setFocus: (f) => { focusMode = f },
      }

      const fakeAttachmentsStore = {
        addAttachment: (sessionId, payload) => {
          storeSessionId = sessionId
          storePayload = payload
          return { ok: true }
        },
      }

      class FakeCustomEvent {
        constructor(type, init) {
          this.type = type
          this.detail = init?.detail
        }
      }

      const fakeWindow = {
        __omnimuxWorkbench: fakeWorkbench,
        __omnimuxAttachments: fakeAttachmentsStore,
        dispatchEvent: (evt) => {
          dispatchedEvent = evt
          return true
        },
      }

      const asset = {
        id: 'ast_456',
        name: '科幻飞船',
        type: 'prop',
        files: [{ id: 'f_ship', kind: 'image', name: 'ship.webp' }],
      }

      const res = addAssetToConversation(asset, {
        window: fakeWindow,
        CustomEvent: FakeCustomEvent,
      })

      assert.equal(res.ok, true)
      assert.equal(collapsedState, false)
      assert.equal(focusMode, 'split')
      assert.equal(storeSessionId, '')
      assert.ok(storePayload)
      assert.equal(storePayload.entityId, 'ast_456')
      assert.equal(storePayload.title, '科幻飞船')
      assert.equal(storePayload.extension, 'WEBP')
      assert.ok(dispatchedEvent)
      assert.equal(dispatchedEvent.type, 'omnimux:add-to-conversation')
      assert.equal(dispatchedEvent.detail.entityId, 'ast_456')
    })

    it('survives throwing workbench, store, or event dispatch errors gracefully', () => {
      const brokenWindow = {
        __omnimuxWorkbench: {
          setConversationCollapsed: () => { throw new Error('collapsed boom') },
          setFocus: () => { throw new Error('focus boom') },
        },
        __omnimuxAttachments: {
          addAttachment: () => { throw new Error('store boom') },
        },
        dispatchEvent: () => { throw new Error('dispatch boom') },
      }
      const res = addAssetToConversation({ id: 'ast_err', name: 'Fault Tolerant' }, { window: brokenWindow })
      assert.equal(res.ok, true)
      assert.equal(res.payload.entityId, 'ast_err')
    })

    it('returns error if asset has no id', () => {
      const res = addAssetToConversation({}, { window: {} })
      assert.equal(res.ok, false)
      assert.equal(res.error, 'no-asset')
    })

    it('builds payload and delivers unified reference for cloud assets with cover and media URLs', () => {
      let deliveredRef = null
      const fakeRefApi = {
        deliver: (ref) => { deliveredRef = ref },
      }
      const cloudAsset = {
        id: 'character-fantasy-genrex-2908f54b4d8c',
        name: 'Angel Influencer',
        category: 'character',
        sub_category: 'fantasy-genrex',
        cover_url: 'file:library/opc/free-ai-avatars/versions/v1/files/Fantasy_GenreX/Angel Influencer/Angel Influencer.png',
        media_url: 'file:library/opc/free-ai-avatars/versions/v1/files/Fantasy_GenreX/Angel Influencer/089-angel-influencer.wav',
        media_type: 'audio',
        meta: {
          source_cover_url: 'https://assets.omnimux.ai/avatars/free-ai-avatars/Fantasy_GenreX/Angel%20Influencer/Angel%20Influencer.png',
          source_media_url: 'https://assets.omnimux.ai/avatars/free-ai-avatars/Fantasy_GenreX/Angel%20Influencer/089-angel-influencer.wav',
        },
      }

      const res = addAssetToConversation(cloudAsset, {
        window: {
          __omnimuxReference: fakeRefApi,
        },
      })

      assert.equal(res.ok, true)
      assert.equal(res.payload.entityId, 'character-fantasy-genrex-2908f54b4d8c')
      assert.equal(res.payload.title, 'Angel Influencer')
      assert.equal(res.payload.metadata.is_cloud, true)
      assert.equal(res.payload.metadata.source_cover_url, cloudAsset.meta.source_cover_url)
      assert.equal(res.payload.metadata.source_media_url, cloudAsset.meta.source_media_url)
      assert.ok(res.payload.previewUrl.includes('Angel%20Influencer.png'))

      assert.ok(deliveredRef)
      assert.equal(deliveredRef.id, 'character-fantasy-genrex-2908f54b4d8c')
      assert.equal(deliveredRef.context.metadata.is_cloud, true)
      assert.match(deliveredRef.context.summary, /公共素材: Angel Influencer/)
    })
  })
})

/**
 * Issue #3058：preview-only 用途的会话投递防御。
 * 卡片/详情已不渲染会话按钮，但公共入口本身仍要在投递前拒绝
 * official-voice-preview 行——隐藏按钮不等于关闭旁路。
 */
describe('add-to-chat - official voice preview guard (Issue #3058)', () => {
  it('refuses addAssetToConversation for purpose=official-voice-preview before any dispatch', () => {
    const res = addAssetToConversation({
      id: 'audio-voiceover-abc',
      name: '林潇 2.0',
      media_url: 'https://cdn.example.com/voice.mp3',
      media_type: 'audio',
      preview: { purpose: 'official-voice-preview', state: 'verified-file' },
      meta: { preview: { purpose: 'official-voice-preview', state: 'verified-file' } },
    }, { window: { dispatchEvent() { throw new Error('must not dispatch') } } })
    assert.equal(res.ok, false)
    assert.equal(res.error, 'voice-preview-only')
  })

  it('refuses addMediaToConversation when the preview item carries the purpose', () => {
    const res = addMediaToConversation({
      id: 'cloud:audio-voiceover-abc',
      title: '林潇 2.0',
      kind: 'audio',
      previewUrl: 'https://cdn.example.com/voice.mp3',
      preview: { purpose: 'official-voice-preview', state: 'verified-file' },
    }, { window: { dispatchEvent() { throw new Error('must not dispatch') } } })
    assert.equal(res.ok, false)
    assert.equal(res.error, 'voice-preview-only')
  })

  it('still delivers an ordinary cloud asset', () => {
    const delivered = []
    const res = addAssetToConversation({
      id: 'audio-bgm-1',
      name: 'beat',
      media_url: 'https://assets.omnimux.ai/audio/bgm/x.mp3',
      media_type: 'audio',
    }, { window: { dispatchEvent(evt) { delivered.push(evt) } } })
    assert.equal(res.ok, true)
    assert.equal(delivered.length, 1)
  })
})

describe('buildAssetPayload — 类型判定（视频优先 / 纯音频封面不误判 / 真多模态图像）', () => {
  it('视频 + 图片封面（poster）判为 video，不被封面拉成 image', () => {
    const payload = buildAssetPayload({
      id: 'vid-1', name: 'clip', category: 'video', media_type: 'video',
      cover_url: 'https://cdn.example.test/poster.jpg',
      media_url: 'https://cdn.example.test/clip.mp4',
    })
    assert.equal(payload.kind, 'video')
    assert.equal(payload.extension, 'VIDEO')
  })

  it('纯音频 + 真实装饰封面仍是音频（asset/AUDIO），不判 image', () => {
    const payload = buildAssetPayload({
      id: 'audio-2', name: 'song', category: 'audio', media_type: 'audio',
      cover_url: 'https://cdn.example.test/album-cover.png',
      media_url: 'https://cdn.example.test/song.mp3',
    })
    assert.equal(payload.kind, 'asset')
    assert.equal(payload.extension, 'AUDIO')
  })

  it('真·图片+音频多模态（并存图片媒体与音频媒体）判为 image', () => {
    const payload = buildAssetPayload({
      id: 'mm-1', name: 'Elf Archer', category: 'audio', media_type: 'audio',
      media_url: 'https://cdn.example.test/voice.mp3',
      meta: { source_media_url: 'https://cdn.example.test/thumb.png' },
    })
    assert.equal(payload.kind, 'image')
    assert.equal(payload.extension, 'IMAGE')
  })

  // AC5 真机回归：CloudAssetCard 传给 addAssetToConversation 的是
  // normalizeCloudAsset() 的 camelCase 结果，不是目录 raw 行。这条用例必须
  // 覆盖真实入参形状（thumbUrl/coverUrl/hasCover/mediaType），否则单测全绿
  // 但真机仍落回 ASSET/AUDIO pill（PR #18 的漏点）。
  it('云端真实 Elf Archer 行经 normalizeCloudAsset 后判为 image/IMAGE', () => {
    const elfArcherRow = {
      id: 'character-fantasy-genrex-999c40067350',
      category: 'character',
      sub_category: 'fantasy-genrex',
      name: 'Elf Archer',
      media_type: 'audio',
      cover_url: 'https://assets.omnimux.ai/avatars/free-ai-avatars/Fantasy_GenreX/Elf%20Archer/Elf%20Archer.png',
      media_url: 'https://assets.omnimux.ai/avatars/free-ai-avatars/Fantasy_GenreX/Elf%20Archer/087-elf-archer.wav',
      thumb_url: 'https://assets.omnimux.ai/thumbs/character-fantasy-genrex-999c40067350.webp',
      tags: ['AI数字人', 'Fantasy_GenreX', 'Elf Archer'],
      meta: { source: 'free-ai-avatars', duration: 9.76 },
    }
    const normalized = normalizeCloudAsset(elfArcherRow)
    const payload = buildAssetPayload(normalized)
    assert.equal(normalized.mediaType, 'audio')
    assert.equal(normalized.hasCover, true)
    assert.equal(payload.kind, 'image')
    assert.equal(payload.extension, 'IMAGE')
    assert.match(payload.previewUrl, /thumbs\/character-fantasy-genrex-999c40067350\.webp$/)
  })

  it('云端纯 audio 类目（带封面）经 normalizeCloudAsset 后仍是 asset/AUDIO', () => {
    const normalized = normalizeCloudAsset({
      id: 'audio-voice-1',
      category: 'audio',
      name: '旁白音色',
      media_type: 'audio',
      cover_url: 'https://cdn.example.test/album-cover.png',
      media_url: 'https://cdn.example.test/voice.mp3',
      thumb_url: 'https://cdn.example.test/album-cover-thumb.webp',
    })
    const payload = buildAssetPayload(normalized)
    assert.equal(payload.kind, 'asset')
    assert.equal(payload.extension, 'AUDIO')
  })

  it('云端视频行经 normalizeCloudAsset 后仍是 video/VIDEO', () => {
    const normalized = normalizeCloudAsset({
      id: 'video-1',
      category: 'video',
      name: '片段',
      media_type: 'video',
      cover_url: 'https://cdn.example.test/poster.jpg',
      media_url: 'https://cdn.example.test/clip.mp4',
      thumb_url: 'https://cdn.example.test/poster-thumb.webp',
    })
    const payload = buildAssetPayload(normalized)
    assert.equal(payload.kind, 'video')
    assert.equal(payload.extension, 'VIDEO')
  })

  it('云端文件/表格行经 normalizeCloudAsset 后不因封面误出图像缩略', () => {
    const normalized = normalizeCloudAsset({
      id: 'doc-1',
      category: 'document',
      name: '合同.pdf',
      media_type: 'other',
      cover_url: 'https://cdn.example.test/doc-cover.png',
      thumb_url: 'https://cdn.example.test/doc-cover-thumb.webp',
    })
    const payload = buildAssetPayload(normalized)
    assert.equal(payload.kind, 'asset')
    assert.notEqual(payload.extension, 'IMAGE')
    assert.doesNotMatch(payload.previewUrl, /\.(png|webp)(?:[?#]|$)/i)
  })
})
