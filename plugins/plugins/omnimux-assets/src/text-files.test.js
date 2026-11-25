import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  EDITABLE_TEXT_EXTS,
  MARKDOWN_EXTS,
  MAX_TEXT_VERSIONS,
  TEXT_FILE_MAX_BYTES,
  calculateTextStats,
  isEditableTextExt,
  isMarkdownExt,
  normalizeTextSubPath,
  textExtOf,
} from './text-files.js'

describe('text-files shared rules', () => {
  it('recognizes markdown and plain-text extensions case-insensitively and rejects binaries', () => {
    assert.equal(textExtOf('SKILL.MD'), '.md')
    assert.equal(textExtOf('nested/dir/Notes.TxT'), '.txt')
    assert.equal(textExtOf('.md'), '.md')
    assert.equal(textExtOf('no-ext'), '')
    assert.equal(textExtOf('dir/.hidden'), '')

    for (const ext of MARKDOWN_EXTS) {
      assert.equal(isMarkdownExt(`doc${ext}`), true, ext)
      assert.equal(isEditableTextExt(`doc${ext}`), true, ext)
    }

    for (const ext of EDITABLE_TEXT_EXTS) {
      assert.equal(isEditableTextExt(`file${ext}`), true, ext)
    }

    assert.equal(isMarkdownExt('notes.txt'), false)
    assert.equal(isMarkdownExt('config.json'), false)
    assert.equal(isEditableTextExt('manual.pdf'), false)
    assert.equal(isEditableTextExt('report.docx'), false)
    assert.equal(isEditableTextExt('hero.png'), false)
    assert.equal(isEditableTextExt('clip.mp4'), false)
    assert.equal(isEditableTextExt('voice.mp3'), false)
    assert.equal(isEditableTextExt('archive.zip'), false)
    assert.equal(isEditableTextExt(''), false)
  })

  it('normalizes relative sub-paths cleanly across slash styles', () => {
    assert.equal(normalizeTextSubPath(''), '')
    assert.equal(normalizeTextSubPath('docs\\SKILL.md'), 'docs/SKILL.md')
    assert.equal(normalizeTextSubPath('/docs/notes.txt/'), 'docs/notes.txt')
    assert.equal(normalizeTextSubPath(null), '')
  })

  it('counts CJK characters, Latin words, total characters, and lines', () => {
    assert.deepEqual(calculateTextStats(''), { wordCount: 0, charCount: 0, lineCount: 0 })
    const mixed = calculateTextStats('# 标题\nHello world 你好世界')
    assert.equal(mixed.lineCount, 2)
    assert.equal(mixed.charCount, '# 标题\nHello world 你好世界'.length)
    // 2 CJK chars in line 1 + 4 CJK chars in line 2 + 2 Latin words ("Hello", "world") = 8
    assert.equal(mixed.wordCount, 8)
    assert.equal(TEXT_FILE_MAX_BYTES, 2 * 1024 * 1024)
    assert.equal(MAX_TEXT_VERSIONS, 50)
  })
})
