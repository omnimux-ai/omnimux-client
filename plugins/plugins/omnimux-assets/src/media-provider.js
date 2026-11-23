/**
 * `library-file` scope provider for the hub `mediaResolver` seam.
 *
 * Resolves managed creative asset files owned by `omnimux-assets`, verifies
 * containment and 256 KiB block-level SHA-256 integrity, and refuses SVG or
 * non-media files. Never exposes raw host paths to callers.
 */
import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { extOf } from './scanner.js'

const BLOCK_BYTES = 256 * 1024
const INTEGRITY_CACHE_CAPACITY = 128

const ALLOWED_MEDIA_MIME_BY_EXT = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.tiff': 'image/tiff',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.m4v': 'video/x-m4v',
  '.flv': 'video/x-flv',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.m4a': 'audio/mp4',
  '.aiff': 'audio/aiff',
})

function mediaError(code, message) {
  return Object.assign(new Error(message), { code })
}

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function fileIdentity(info) {
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}`
}

function sniffUnsupportedSvg(head) {
  if (!head || head.length === 0) return false
  const text = head.subarray(0, Math.min(head.length, 512)).toString('utf8').trimStart().toLowerCase()
  return text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))
}

async function readBlock(handle, start, size, signal) {
  const bytes = Buffer.allocUnsafe(Math.min(BLOCK_BYTES, size - start))
  let offset = 0
  while (offset < bytes.length) {
    signal?.throwIfAborted()
    const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, start + offset)
    if (!bytesRead) throw mediaError('media-changed', 'Library file changed while reading.')
    offset += bytesRead
  }
  signal?.throwIfAborted()
  return bytes
}

const integrityCache = new Map()

async function readFileIntegrity(realPath, signal) {
  signal?.throwIfAborted()
  const info = await stat(realPath, { bigint: true })
  signal?.throwIfAborted()
  if (!info.isFile()) throw mediaError('unsupported-media', 'Library media target is not a regular file.')
  const identity = fileIdentity(info)
  const cached = info.ino ? integrityCache.get(identity) : undefined
  if (cached) return cached

  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
  const handle = await open(realPath, flags)
  try {
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || fileIdentity(opened) !== identity) {
      throw mediaError('media-changed', 'Library file changed before digest completed.')
    }
    const size = Number(opened.size)
    const hash = createHash('sha256')
    const blocks = []
    let isSvg = false
    for (let start = 0; start < size; start += BLOCK_BYTES) {
      const block = await readBlock(handle, start, size, signal)
      if (start === 0) isSvg = sniffUnsupportedSvg(block)
      blocks.push(sha256Hex(block))
      hash.update(block)
    }
    if (fileIdentity(await handle.stat({ bigint: true })) !== identity) {
      throw mediaError('media-changed', 'Library file changed during digest calculation.')
    }
    const result = { digest: hash.digest('hex'), size, blocks, identity, isSvg }
    if (info.ino) {
      if (integrityCache.size >= INTEGRITY_CACHE_CAPACITY) {
        integrityCache.delete(integrityCache.keys().next().value)
      }
      integrityCache.set(identity, result)
    }
    return result
  } finally {
    await handle.close()
  }
}

async function* streamVerifiedBlocks(realPath, integrity, start, end, signal) {
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
  const handle = await open(realPath, flags)
  try {
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || fileIdentity(opened) !== integrity.identity) {
      throw mediaError('media-changed', 'Library file changed before streaming.')
    }
    if (integrity.size === 0 || start > end) return
    for (let index = Math.floor(start / BLOCK_BYTES); index * BLOCK_BYTES <= end; index++) {
      const blockStart = index * BLOCK_BYTES
      const block = await readBlock(handle, blockStart, integrity.size, signal)
      if (sha256Hex(block) !== integrity.blocks[index]) {
        throw mediaError('media-changed', 'Library file changed mid-stream.')
      }
      yield block.subarray(Math.max(start - blockStart, 0), end - blockStart + 1)
    }
  } finally {
    await handle.close()
  }
}

function classifyLibraryError(error) {
  const code = error?.code
  if (code === 'asset-not-found' || code === 'path-not-found' || code === 'ENOENT') return 'not_found'
  if (code === 'path-denied') return 'access_denied'
  if (code === 'path-not-dir' || code === 'path-unsupported' || code === 'unsupported-media') return 'unsupported'
  return null
}

/**
 * Build the `library-file` provider backed by an `omnimux-assets` library store.
 * @param {{ library: { resolveEntryPath: Function, getView?: Function } }} deps
 */
export function createLibraryMediaProvider({ library }) {
  async function inspectTarget(handle, signal) {
    let resolved
    try {
      resolved = library.resolveEntryPath(handle.libraryAssetId, handle.fileId)
    } catch (error) {
      const status = classifyLibraryError(error)
      if (status) return { status, error }
      throw error
    }
    if (!resolved || resolved.isDirectory) {
      return { status: 'unsupported', error: mediaError('unsupported-media', 'Library directories cannot be opened as media.') }
    }
    const realPath = await realpath(resolved.absolutePath)
    signal?.throwIfAborted()
    const displayName = basename(realPath)
    const mimeType = ALLOWED_MEDIA_MIME_BY_EXT[extOf(displayName)]
    if (!mimeType) {
      return { status: 'unsupported', error: mediaError('unsupported-media', 'Library file type is not supported raster image, audio, or video media.') }
    }
    const integrity = await readFileIntegrity(realPath, signal)
    if (integrity.isSvg || integrity.size <= 0) {
      return { status: 'unsupported', error: mediaError('unsupported-media', 'Library file is empty or an unsupported SVG payload.') }
    }
    const canonicalHandle = {
      v: 1,
      scope: 'library-file',
      libraryAssetId: handle.libraryAssetId,
      fileId: handle.fileId,
      sha256: integrity.digest,
    }
    if (handle.sha256 && handle.sha256 !== integrity.digest) {
      return {
        status: 'digest_mismatch',
        realPath,
        mimeType,
        displayName,
        integrity,
        canonicalHandle,
        error: mediaError('media-version-mismatch', 'Library media content digest no longer matches the requested version.'),
      }
    }
    return { status: 'ok', realPath, mimeType, displayName, integrity, canonicalHandle }
  }

  return {
    scope: 'library-file',

    async stat(handle, _auth = {}, signal) {
      const target = await inspectTarget(handle, signal)
      if (target.status === 'ok' || target.status === 'digest_mismatch') {
        return {
          status: target.status,
          exists: true,
          canonicalHandle: target.canonicalHandle,
          currentSha256: target.integrity.digest,
          size: target.integrity.size,
          mimeType: target.mimeType,
          displayName: target.displayName,
          immutable: false,
        }
      }
      return { status: target.status, exists: false }
    },

    async open(handle, _auth = {}, signal) {
      const target = await inspectTarget(handle, signal)
      if (target.status !== 'ok') {
        if (target.status === 'not_found') throw mediaError('media-not-found', 'Library media file was not found.')
        if (target.status === 'access_denied') throw mediaError('access-denied', 'Access to the library media file was denied.')
        if (target.status === 'digest_mismatch') throw target.error
        throw target.error ?? mediaError('unsupported-media', 'Library media file is unsupported.')
      }
      const { realPath, mimeType, displayName, integrity, canonicalHandle } = target
      return {
        canonicalHandle,
        sha256: integrity.digest,
        size: integrity.size,
        mimeType,
        displayName,
        openRange(start = 0, end = integrity.size - 1, rangeSignal) {
          const clampedStart = Math.max(0, Math.min(start, Math.max(0, integrity.size - 1)))
          const clampedEnd = Math.max(clampedStart, Math.min(end, Math.max(0, integrity.size - 1)))
          return streamVerifiedBlocks(realPath, integrity, clampedStart, clampedEnd, rangeSignal)
        },
      }
    },
  }
}
