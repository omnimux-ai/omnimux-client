import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isDirectoryRef,
  isEditableTextPreview,
  isFolderAsset,
  isMediaAsset,
  detectMediaKind,
  resolveAssetMediaPreview,
} from './asset-routing.js'

describe('asset-routing pure functions and preview resolution contract', () => {
  describe('isDirectoryRef', () => {
    it('identifies directory references correctly', () => {
      assert.equal(isDirectoryRef(null), false)
      assert.equal(isDirectoryRef(undefined), false)
      assert.equal(isDirectoryRef({}), false)
      assert.equal(isDirectoryRef({ kind: 'directory' }), true)
      assert.equal(isDirectoryRef({ type: 'directory' }), true)
      assert.equal(isDirectoryRef({ is_dir: true }), true)
      assert.equal(isDirectoryRef({ is_dir: false }), false)
      assert.equal(isDirectoryRef({ kind: 'file' }), false)
    })
  })

  describe('isFolderAsset and isMediaAsset', () => {
    it('considers composite multi-file assets as folders', () => {
      const composite = {
        id: 'ast_multi',
        name: '角色图包',
        files: [
          { id: 'f1', name: 'front.png' },
          { id: 'f2', name: 'side.png' },
        ],
      }
      assert.equal(isFolderAsset(composite), true)
      assert.equal(isMediaAsset(composite), false)
    })

    it('considers single directory assets as folders', () => {
      const folderAsset = {
        id: 'ast_dir',
        name: '场景贴图库',
        files: [
          { id: 'f_dir', name: 'textures', is_dir: true },
        ],
      }
      assert.equal(isFolderAsset(folderAsset), true)
      assert.equal(isMediaAsset(folderAsset), false)
    })

    it('considers single file / media assets as media (not folder)', () => {
      const singleImage = {
        id: 'ast_single_img',
        name: '主角定妆照',
        files: [
          { id: 'f_img', name: 'hero.png', kind: 'image' },
        ],
      }
      assert.equal(isFolderAsset(singleImage), false)
      assert.equal(isMediaAsset(singleImage), true)

      const singleDoc = {
        id: 'ast_single_doc',
        name: '设定集',
        files: [
          { id: 'f_doc', name: 'story.pdf' },
        ],
      }
      assert.equal(isFolderAsset(singleDoc), false)
      assert.equal(isMediaAsset(singleDoc), true)
    })

    it('handles empty or missing files array gracefully', () => {
      assert.equal(isFolderAsset(null), false)
      assert.equal(isMediaAsset(null), false)
      assert.equal(isFolderAsset({ files: [] }), false)
      assert.equal(isMediaAsset({ files: [] }), true)
      assert.equal(isFolderAsset({ files: null }), false)
      assert.equal(isMediaAsset({ files: null }), true)
    })
  })

  describe('detectMediaKind', () => {
    it('detects folders from is_dir or directory kind', () => {
      assert.equal(detectMediaKind({ is_dir: true }), 'folder')
      assert.equal(detectMediaKind({ kind: 'directory' }), 'folder')
    })

    it('detects images from explicit kind or file extensions', () => {
      assert.equal(detectMediaKind({ kind: 'image' }), 'image')
      assert.equal(detectMediaKind({ type: 'image' }), 'image')
      assert.equal(detectMediaKind({ name: 'shot.PNG' }), 'image')
      assert.equal(detectMediaKind({ original_name: 'avatar.webp' }), 'image')
      assert.equal(detectMediaKind({ real_path: '/disk/poster.jpeg' }), 'image')
    })

    it('detects videos from explicit kind or video extensions', () => {
      assert.equal(detectMediaKind({ kind: 'video' }), 'video')
      assert.equal(detectMediaKind({ type: 'video' }), 'video')
      assert.equal(detectMediaKind({ name: 'sample.mp4' }), 'video')
      assert.equal(detectMediaKind({ relative_path: 'clips/hook.mov' }), 'video')
      assert.equal(detectMediaKind({ original_name: 'cut.webm' }), 'video')
    })

    it('falls back to file for unknown extensions', () => {
      assert.equal(detectMediaKind({ name: 'script.docx' }), 'file')
      assert.equal(detectMediaKind({ name: 'data.json' }), 'file')
      assert.equal(detectMediaKind(null), 'file')
    })
  })

  describe('resolveAssetMediaPreview', () => {
    it('standardizes top-level single image asset', () => {
      const asset = {
        id: 'ast_img_1',
        name: '赛博主角',
        files: [
          { id: 'file_1', name: 'hero.png', relative_path: 'images/hero.png' },
        ],
      }
      const model = resolveAssetMediaPreview(asset)
      assert.equal(model.id, 'ast_img_1')
      assert.equal(model.title, '赛博主角')
      assert.equal(model.extension, 'PNG')
      assert.equal(model.kind, 'image')
      assert.equal(model.previewUrl, '/omnimux/assets/library/preview?id=ast_img_1&file=file_1')
      assert.equal(model.pathInfo, 'images/hero.png')
      assert.equal(model.sourceAssetId, 'ast_img_1')
      assert.equal(model.sourceAsset, asset)
      assert.equal(model.rawItem, asset)
    })

    it('standardizes top-level single video asset', () => {
      const asset = {
        id: 'ast_vid_1',
        name: '开场实拍',
        files: [
          { id: 'vid_file', name: 'intro.mp4', relative_path: 'video/intro.mp4' },
        ],
      }
      const model = resolveAssetMediaPreview(asset)
      assert.equal(model.kind, 'video')
      assert.equal(model.extension, 'MP4')
      assert.equal(model.previewUrl, '/omnimux/assets/library/preview?id=ast_vid_1&file=vid_file')
    })

    it('standardizes child nested entry inside AssetBrowse with stack', () => {
      const parentAsset = {
        id: 'ast_pack_100',
        name: '全套场景素材',
      }
      const stack = {
        file: { id: 'root_dir', name: 'textures' },
        path: 'interior/living_room',
      }
      const entry = {
        name: 'wall.jpg',
        relative_path: 'interior/living_room/wall.jpg',
      }

      const model = resolveAssetMediaPreview(entry, { asset: parentAsset, stack })
      assert.equal(model.title, 'wall.jpg')
      assert.equal(model.kind, 'image')
      assert.equal(model.extension, 'JPG')
      assert.equal(model.sourceAssetId, 'ast_pack_100')
      assert.equal(model.sourceAsset, parentAsset)
      assert.equal(model.rawItem, entry)
      assert.equal(model.pathInfo, 'interior/living_room/wall.jpg')
      assert.equal(
        model.previewUrl,
        '/omnimux/assets/library/preview?id=ast_pack_100&file=root_dir&path=interior%2Fliving_room%2Fwall.jpg',
      )
    })

    it('handles null gracefully', () => {
      const model = resolveAssetMediaPreview(null)
      assert.equal(model.id, '')
      assert.equal(model.title, '')
      assert.equal(model.kind, 'file')
      assert.equal(model.previewUrl, '')
    })

    it('marks local .md / .txt / .json files as editable text while keeping images, pdfs, and cloud items on preview modal', () => {
      const singleMd = {
        id: 'ast_md_1',
        name: 'SKILL.md',
        files: [{ id: 'f_md', name: 'SKILL.md', original_name: 'SKILL.md', relative_path: 'data/files/ast_md_1/SKILL.md' }],
      }
      const mdModel = resolveAssetMediaPreview(singleMd)
      assert.equal(mdModel.editableText, true)
      assert.equal(mdModel.markdown, true)
      assert.equal(mdModel.assetId, 'ast_md_1')
      assert.equal(mdModel.fileId, 'f_md')
      assert.equal(mdModel.subPath, '')
      assert.equal(isEditableTextPreview(mdModel), true)

      const nestedTxt = resolveAssetMediaPreview(
        { name: 'notes.txt', relative_path: 'sub/notes.txt' },
        { asset: { id: 'ast_pack', name: '知识包' }, stack: { file: { id: 'f_dir', name: 'pack' }, path: 'sub' } },
      )
      assert.equal(nestedTxt.editableText, true)
      assert.equal(nestedTxt.markdown, false)
      assert.equal(nestedTxt.assetId, 'ast_pack')
      assert.equal(nestedTxt.fileId, 'f_dir')
      assert.equal(nestedTxt.subPath, 'sub/notes.txt')
      assert.equal(isEditableTextPreview(nestedTxt), true)

      const singlePdf = resolveAssetMediaPreview({
        id: 'ast_pdf_1',
        name: '手册.pdf',
        files: [{ id: 'f_pdf', name: '手册.pdf' }],
      })
      assert.equal(singlePdf.editableText, false)
      assert.equal(isEditableTextPreview(singlePdf), false)

      const cloudDoc = { ...mdModel, cloud: true }
      assert.equal(isEditableTextPreview(cloudDoc), false)
    })
  })
})
