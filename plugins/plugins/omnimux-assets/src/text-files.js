/**
 * Shared pure text-document classification & statistics helpers.
 * Safe for both Host (Node.js) and Client (browser) bundles — zero Node imports.
 */

export const MARKDOWN_EXTS = Object.freeze(new Set(['.md', '.markdown', '.mdx']))

export const EDITABLE_TEXT_EXTS = Object.freeze(new Set([
  '.md',
  '.markdown',
  '.mdx',
  '.txt',
  '.text',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.csv',
  '.tsv',
  '.srt',
  '.vtt',
  '.lrc',
  '.xml',
  '.toml',
  '.ini',
  '.conf',
  '.log',
]))

/** Maximum editable text file size in UTF-8 bytes (2 MiB). */
export const TEXT_FILE_MAX_BYTES = 2 * 1024 * 1024

/** Maximum version snapshots kept per managed text file (matches canvas TextStage). */
export const MAX_TEXT_VERSIONS = 50

/**
 * Extract lowercase extension including leading dot, or '' when absent.
 * Accepts either a file name/path or a bare extension like ".md" or "md".
 * @param {unknown} nameOrExt
 * @returns {string}
 */
export function textExtOf(nameOrExt) {
  const raw = typeof nameOrExt === 'string' ? nameOrExt.trim() : ''
  if (!raw) return ''
  const cleaned = raw.split(/[?#]/)[0].replace(/\/+$/, '')
  if (/^\.[a-z0-9]+$/i.test(cleaned)) return cleaned.toLowerCase()
  const slash = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'))
  const base = slash >= 0 ? cleaned.slice(slash + 1) : cleaned
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot).toLowerCase()
}

/**
 * @param {unknown} nameOrExt
 * @returns {boolean}
 */
export function isEditableTextExt(nameOrExt) {
  const ext = textExtOf(nameOrExt)
  return ext !== '' && EDITABLE_TEXT_EXTS.has(ext)
}

/**
 * @param {unknown} nameOrExt
 * @returns {boolean}
 */
export function isMarkdownExt(nameOrExt) {
  const ext = textExtOf(nameOrExt)
  return ext !== '' && MARKDOWN_EXTS.has(ext)
}

/**
 * Normalize a relative sub-path inside an asset folder ref.
 * @param {unknown} subPath
 * @returns {string}
 */
export function normalizeTextSubPath(subPath) {
  return String(subPath ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
}

/**
 * Calculate CJK characters + Latin words, total chars, and lines.
 * Mirrors canvas `calculateTextStats`.
 * @param {unknown} text
 * @returns {{ charCount: number, wordCount: number, lineCount: number }}
 */
export function calculateTextStats(text) {
  const value = typeof text === 'string' ? text : ''
  if (value === '') {
    return { charCount: 0, wordCount: 0, lineCount: 0 }
  }
  const charCount = value.length
  const lineCount = value.split(/\r\n|\r|\n/).length
  const cjkChars = (value.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || []).length
  const latinText = value.replace(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g, ' ')
  const latinWords = (latinText.match(/[a-zA-Z0-9_-]+/g) || []).length
  return {
    charCount,
    wordCount: cjkChars + latinWords,
    lineCount,
  }
}
