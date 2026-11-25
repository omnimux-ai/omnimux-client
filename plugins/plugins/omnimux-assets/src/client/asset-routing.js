import { previewUrl } from './api.js'
import { inferAssetExtension, pickCoverFile } from './add-to-chat.js'
import { isEditableTextExt, isMarkdownExt, normalizeTextSubPath } from '../text-files.js'

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|heic|tiff)$/i
export const VIDEO_EXT = /\.(mp4|mov|avi|mkv|webm|m4v|flv)$/i

/**
 * Whether a normalized preview target should open in the text document editor modal.
 * Only local library files with a supported text extension qualify; cloud rows and
 * generated artifacts stay on the read-only preview modal.
 * @param {any} item
 * @returns {boolean}
 */
export function isEditableTextPreview(item) {
  return Boolean(
    item
    && item.editableText === true
    && !item.cloud
    && typeof item.assetId === 'string'
    && item.assetId !== ''
    && typeof item.fileId === 'string'
    && item.fileId !== ''
  )
}

/**
 * Check if a file descriptor or row reference is a directory.
 * @param {any} file
 * @returns {boolean}
 */
export function isDirectoryRef(file) {
  if (!file) return false
  return file.kind === 'directory' || file.is_dir === true || file.type === 'directory'
}

/**
 * Determine if an asset represents a folder (single directory ref or composite multiple files).
 * @param {any} asset
 * @returns {boolean}
 */
export function isFolderAsset(asset) {
  if (!asset) return false
  const files = Array.isArray(asset.files) ? asset.files : []
  if (files.length > 1) return true
  if (files.length === 1 && isDirectoryRef(files[0])) return true
  return false
}

/**
 * Determine if an asset is a single media item (not a folder/composite pack).
 * @param {any} asset
 * @returns {boolean}
 */
export function isMediaAsset(asset) {
  return Boolean(asset) && !isFolderAsset(asset)
}

/**
 * Detect media category from a row or file descriptor.
 * @param {any} row
 * @returns {'folder' | 'image' | 'video' | 'file'}
 */
export function detectMediaKind(row) {
  if (!row) return 'file'
  if (isDirectoryRef(row) || row.is_dir === true) return 'folder'
  const kind = String(row.kind || row.type || '')
  if (kind === 'image' || kind === 'video') return kind
  const name = String(row.name || row.original_name || row.real_path || row.relative_path || '')
  if (IMAGE_EXT.test(name)) return 'image'
  if (VIDEO_EXT.test(name)) return 'video'
  return 'file'
}

/**
 * Standardize an asset or child item into a normalized media preview model.
 *
 * @param {any} target - An asset object or a child directory entry
 * @param {{
 *   asset?: any,
 *   stack?: { file: any, path: string },
 *   pathInfo?: string,
 * }} [options]
 * @returns {{
 *   id: string,
 *   title: string,
 *   extension: string,
 *   kind: 'folder' | 'image' | 'video' | 'file',
 *   previewUrl: string,
 *   pathInfo: string,
 *   sourceAssetId: string,
 *   sourceAsset: any | null,
 *   rawItem: any,
 * }}
 */
export function resolveAssetMediaPreview(target, options = {}) {
  if (!target) {
    return {
      id: '',
      title: '',
      extension: 'FILE',
      kind: 'file',
      previewUrl: '',
      pathInfo: '',
      sourceAssetId: '',
      sourceAsset: null,
      rawItem: null,
    }
  }

  const parentAsset = options.asset || (target.files ? target : null)
  const isTopAsset = Boolean(target.id && !options.asset && Array.isArray(target.files))

  if (isTopAsset) {
    const coverFile = pickCoverFile(target) || (target.files ? target.files[0] : null)
    const ext = inferAssetExtension(coverFile, target.name)
    const kind = detectMediaKind(coverFile || target)
    const fileId = String(coverFile?.id ?? '')
    const pUrl = fileId
      ? previewUrl(target.id, fileId)
      : (typeof coverFile?.preview_url === 'string' ? coverFile.preview_url : '')
    const path = String(
      options.pathInfo ||
      coverFile?.relative_path ||
      coverFile?.real_path ||
      coverFile?.original_name ||
      coverFile?.name ||
      target.name ||
      ''
    )
    const nameCandidate = String(
      coverFile?.original_name ||
      coverFile?.name ||
      coverFile?.relative_path ||
      coverFile?.real_path ||
      target.name ||
      ''
    )
    const editableText = Boolean(
      target.id
      && fileId
      && kind === 'file'
      && !isFolderAsset(target)
      && isEditableTextExt(nameCandidate)
    )
    const markdown = editableText && isMarkdownExt(nameCandidate)

    return {
      id: String(target.id),
      title: target.name || '资产',
      extension: ext,
      kind,
      previewUrl: pUrl,
      pathInfo: path,
      sourceAssetId: String(target.id),
      sourceAsset: target,
      rawItem: target,
      assetId: String(target.id),
      fileId,
      subPath: '',
      editableText,
      markdown,
    }
  }

  // Target is a child entry (nested in browse)
  const sourceAssetId = String(parentAsset?.id || options.asset?.id || '')
  const title = String(target.name || target.original_name || '媒体')
  const ext = inferAssetExtension(target, title)
  const kind = detectMediaKind(target)

  let calculatedPath = options.pathInfo || ''
  if (!calculatedPath) {
    if (target.relative_path) {
      calculatedPath = target.relative_path
    } else if (options.stack) {
      calculatedPath = [options.stack.path, target.name].filter(Boolean).join('/')
    } else {
      calculatedPath = target.real_path || target.name || title
    }
  }

  let pUrl = ''
  let fileId = ''
  let subPath = ''
  if (options.stack && options.asset?.id && options.stack.file?.id) {
    fileId = String(options.stack.file.id)
    const sub = target.relative_path || [options.stack.path, target.name].filter(Boolean).join('/')
    subPath = normalizeTextSubPath(sub)
    pUrl = previewUrl(options.asset.id, fileId, sub)
  } else if (parentAsset?.id && target.id) {
    fileId = String(target.id)
    pUrl = previewUrl(parentAsset.id, fileId)
  } else if (typeof target.preview_url === 'string') {
    pUrl = target.preview_url
  }

  const itemId = String(target.id || (sourceAssetId ? `${sourceAssetId}:${calculatedPath}` : title))
  const nameCandidate = String(target.name || target.original_name || subPath || title)
  const editableText = Boolean(sourceAssetId && fileId && kind === 'file' && isEditableTextExt(nameCandidate))
  const markdown = editableText && isMarkdownExt(nameCandidate)

  return {
    id: itemId,
    title,
    extension: ext,
    kind,
    previewUrl: pUrl,
    pathInfo: calculatedPath,
    sourceAssetId,
    sourceAsset: parentAsset || null,
    rawItem: target,
    assetId: sourceAssetId,
    fileId,
    subPath,
    editableText,
    markdown,
  }
}
