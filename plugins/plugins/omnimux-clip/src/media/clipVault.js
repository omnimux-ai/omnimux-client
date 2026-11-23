/**
 * Content-addressed Host media vault (`<DSH_HOME>/omnimux/clip/blobs/sha256/<ab>/<digest>`)
 * and `clip-vault` scope provider for the hub `mediaResolver` seam.
 *
 * Used for standalone Studio local imports, screen/audio recordings, and
 * unbound free-canvas local imports so browser IndexedDB stays a disposable L1
 * cache instead of the sole owner of media bytes.
 */
import { createHash } from 'node:crypto'
import {
  constants as fsConstants,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { ClipDomainError } from '../errors.js'
import { assertInsideClipRoot } from '../paths.js'

const BLOCK_BYTES = 256 * 1024
const INTEGRITY_CACHE_CAPACITY = 128

const MIME_BY_EXT = Object.freeze({
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
})

const EXT_BY_MIME = Object.freeze({
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/wav': '.wav',
  'audio/flac': '.flac',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
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

function sniffMime(head) {
  if (!head || head.length < 4) return undefined
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png'
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (head.length >= 6 && head.subarray(0, 6).toString('ascii').startsWith('GIF8')) return 'image/gif'
  if (head.length >= 12 && head.subarray(0, 4).toString('ascii') === 'RIFF') {
    const tag = head.subarray(8, 12).toString('ascii')
    if (tag === 'WEBP') return 'image/webp'
    if (tag === 'WAVE') return 'audio/wav'
    if (tag === 'AVI ') return 'video/x-msvideo'
  }
  if (head[0] === 0x42 && head[1] === 0x4d) return 'image/bmp'
  if (head.length >= 12 && head.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = head.subarray(8, 12).toString('ascii').toLowerCase()
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
    if (brand === 'm4a ') return 'audio/mp4'
    if (brand === 'qt  ') return 'video/quicktime'
    return 'video/mp4'
  }
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'video/webm'
  if (head.subarray(0, 3).toString('ascii') === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return 'audio/mpeg'
  if (head.subarray(0, 4).toString('ascii') === 'fLaC') return 'audio/flac'
  if (head.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg'
  return undefined
}

function looksLikeSvgOrHtml(head) {
  if (!head || !head.length) return false
  const text = head.subarray(0, Math.min(head.length, 512)).toString('utf8').trimStart().toLowerCase()
  return text.startsWith('<svg') || text.startsWith('<!doctype html') || text.startsWith('<html')
    || (text.startsWith('<?xml') && text.includes('<svg'))
}

function normalizeClaimedMime(value) {
  if (typeof value !== 'string') return undefined
  const base = value.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (!base || base === 'application/octet-stream' || base === 'image/svg+xml') return undefined
  if (/^(?:video|audio|image)\/[a-z0-9.+-]+$/i.test(base)) return base
  return undefined
}

function resolveMimeType(head, fileName, claimedMime) {
  if (looksLikeSvgOrHtml(head)) return undefined
  if (typeof fileName === 'string' && /\.svgz?$/iu.test(fileName)) return undefined
  const sniffed = sniffMime(head)
  if (sniffed) return sniffed
  const ext = typeof fileName === 'string' ? extname(fileName).toLowerCase() : ''
  const byExt = MIME_BY_EXT[ext]
  if (byExt) return byExt
  return normalizeClaimedMime(claimedMime)
}

export function sanitizeUploadFileName(rawName, mimeType) {
  const cleaned = typeof rawName === 'string'
    ? basename(rawName.replace(/[\x00-\x1f\x7f]/gu, '').replace(/\\/g, '/')).trim().slice(0, 180)
    : ''
  const ext = EXT_BY_MIME[mimeType] ?? '.bin'
  if (!cleaned || cleaned === '.' || cleaned === '..') return `media${ext}`
  if (extname(cleaned)) return cleaned
  return `${cleaned}${ext}`
}

async function readBlock(handle, start, size, signal) {
  const bytes = Buffer.allocUnsafe(Math.min(BLOCK_BYTES, size - start))
  let offset = 0
  while (offset < bytes.length) {
    signal?.throwIfAborted()
    const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, start + offset)
    if (!bytesRead) throw mediaError('media-changed', 'Media file changed while reading.')
    offset += bytesRead
  }
  signal?.throwIfAborted()
  return bytes
}

const vaultIntegrityCache = new Map()

async function readFileIntegrity(realPath, signal) {
  signal?.throwIfAborted()
  const info = await stat(realPath, { bigint: true })
  signal?.throwIfAborted()
  if (!info.isFile()) throw mediaError('unsupported-media', 'Vault target is not a regular file.')
  const identity = fileIdentity(info)
  const cached = info.ino ? vaultIntegrityCache.get(identity) : undefined
  if (cached) return cached

  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
  const fh = await open(realPath, flags)
  try {
    const opened = await fh.stat({ bigint: true })
    if (!opened.isFile() || fileIdentity(opened) !== identity) {
      throw mediaError('media-changed', 'Media file changed before digest completed.')
    }
    const size = Number(opened.size)
    const hash = createHash('sha256')
    const blocks = []
    let head
    for (let start = 0; start < size; start += BLOCK_BYTES) {
      const block = await readBlock(fh, start, size, signal)
      if (start === 0) head = block.subarray(0, Math.min(block.length, 512))
      blocks.push(sha256Hex(block))
      hash.update(block)
    }
    if (fileIdentity(await fh.stat({ bigint: true })) !== identity) {
      throw mediaError('media-changed', 'Media file changed during digest calculation.')
    }
    const result = { digest: hash.digest('hex'), size, blocks, identity, head }
    if (info.ino) {
      if (vaultIntegrityCache.size >= INTEGRITY_CACHE_CAPACITY) {
        vaultIntegrityCache.delete(vaultIntegrityCache.keys().next().value)
      }
      vaultIntegrityCache.set(identity, result)
    }
    return result
  } finally {
    await fh.close()
  }
}

async function* streamVerifiedBlocks(realPath, integrity, start, end, signal) {
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
  const fh = await open(realPath, flags)
  try {
    const opened = await fh.stat({ bigint: true })
    if (!opened.isFile() || fileIdentity(opened) !== integrity.identity) {
      throw mediaError('media-changed', 'Vault blob changed before streaming.')
    }
    if (integrity.size === 0 || start > end) return
    for (let index = Math.floor(start / BLOCK_BYTES); index * BLOCK_BYTES <= end; index++) {
      const blockStart = index * BLOCK_BYTES
      const block = await readBlock(fh, blockStart, integrity.size, signal)
      if (sha256Hex(block) !== integrity.blocks[index]) {
        throw mediaError('media-changed', 'Vault blob changed mid-stream.')
      }
      yield block.subarray(Math.max(start - blockStart, 0), end - blockStart + 1)
    }
  } finally {
    await fh.close()
  }
}

/**
 * Inspect a staged regular file inside `paths.tmpDir`, returning its verified
 * SHA-256 digest, size, sanitized filename, and validated non-SVG media MIME.
 */
export async function inspectStagedMedia({ paths, tempPath, fileName, claimedMimeType, signal }) {
  const tmpRoot = resolve(paths.tmpDir)
  if (typeof tempPath !== 'string' || !isAbsolute(tempPath) || dirname(resolve(tempPath)) !== tmpRoot) {
    throw ClipDomainError.pathDenied('Media upload must be staged inside the Clip temp directory.')
  }
  const staged = resolve(tempPath)
  const lstat = lstatSync(staged, { throwIfNoEntry: false })
  if (!lstat?.isFile() || lstat.isSymbolicLink()) {
    throw ClipDomainError.pathDenied('Staged upload is not a regular file.')
  }
  const integrity = await readFileIntegrity(staged, signal)
  if (integrity.size <= 0) {
    throw new ClipDomainError('unsupported-media', 'Media file cannot be empty.')
  }
  const mimeType = resolveMimeType(integrity.head, fileName, claimedMimeType)
  if (!mimeType) {
    throw new ClipDomainError('unsupported-media', 'Only raster image, audio, and video files are supported.')
  }
  const safeName = sanitizeUploadFileName(fileName, mimeType)
  return {
    stagedPath: staged,
    sha256: integrity.digest,
    size: integrity.size,
    mimeType,
    fileName: safeName,
  }
}

export function vaultBlobPath(paths, digest) {
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/u.test(digest)) {
    throw new ClipDomainError('invalid-media-handle', 'clip-vault digest must be 64 lowercase hex characters.')
  }
  const root = join(resolve(paths.blobsDir), 'sha256')
  return assertInsideClipRoot(root, join(root, digest.slice(0, 2), digest))
}

/**
 * Persist an already-inspected staged upload into content-addressed `clip-vault`.
 * Idempotent by SHA-256: identical content reuses the existing blob cleanly.
 */
export async function persistToClipVault({ paths, stagedPath, sha256, size, mimeType, signal }) {
  const dest = vaultBlobPath(paths, sha256)
  mkdirSync(dirname(dest), { recursive: true, mode: 0o700 })
  try {
    linkSync(stagedPath, dest)
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const existing = await readFileIntegrity(dest, signal)
      if (existing.digest !== sha256 || existing.size !== size) {
        renameSync(stagedPath, dest)
      }
    } else if (error?.code === 'EXDEV') {
      renameSync(stagedPath, dest)
    } else {
      throw error
    }
  }
  return {
    handle: { v: 1, scope: 'clip-vault', sha256, mimeType, size },
    sha256,
    size,
    mimeType,
  }
}

/**
 * Build the `clip-vault` scope provider registered on the hub `mediaResolver`.
 */
export function createClipVaultMediaProvider({ paths }) {
  const blobsRoot = join(resolve(paths.blobsDir), 'sha256')

  async function inspectVaultBlob(handle, signal) {
    const candidate = vaultBlobPath(paths, handle.sha256)
    let realPath
    try {
      const realRoot = await realpath(blobsRoot)
      realPath = await realpath(candidate)
      if (realPath === realRoot || !realPath.startsWith(`${realRoot}/`) && !realPath.startsWith(`${realRoot}\\`)) {
        return { status: 'access_denied', error: mediaError('access-denied', 'Vault path escapes blob root.') }
      }
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { status: 'not_found', error: mediaError('media-not-found', 'Vault media blob was not found.') }
      }
      throw error
    }
    const integrity = await readFileIntegrity(realPath, signal)
    if (integrity.digest !== handle.sha256) {
      return {
        status: 'digest_mismatch',
        realPath,
        integrity,
        error: mediaError('media-version-mismatch', 'Vault media content digest does not match expected SHA-256.'),
      }
    }
    const mimeType = resolveMimeType(integrity.head, undefined, handle.mimeType)
    if (!mimeType) {
      return { status: 'unsupported', error: mediaError('unsupported-media', 'Vault blob is not supported media.') }
    }
    return {
      status: 'ok',
      realPath,
      integrity,
      mimeType,
      canonicalHandle: { v: 1, scope: 'clip-vault', sha256: integrity.digest, mimeType, size: integrity.size },
    }
  }

  return {
    scope: 'clip-vault',

    async stat(handle, _auth = {}, signal) {
      const target = await inspectVaultBlob(handle, signal)
      if (target.status === 'ok' || target.status === 'digest_mismatch') {
        return {
          status: target.status,
          exists: true,
          canonicalHandle: target.canonicalHandle,
          currentSha256: target.integrity.digest,
          size: target.integrity.size,
          mimeType: target.mimeType,
          displayName: basename(target.realPath),
          immutable: true,
        }
      }
      return { status: target.status, exists: false }
    },

    async open(handle, _auth = {}, signal) {
      const target = await inspectVaultBlob(handle, signal)
      if (target.status !== 'ok') {
        throw target.error ?? mediaError('media-not-found', 'Vault media blob could not be opened.')
      }
      const { realPath, integrity, mimeType, canonicalHandle } = target
      return {
        canonicalHandle,
        sha256: integrity.digest,
        size: integrity.size,
        mimeType,
        displayName: basename(realPath),
        openRange(start = 0, end = integrity.size - 1, rangeSignal) {
          const clampedStart = Math.max(0, Math.min(start, Math.max(0, integrity.size - 1)))
          const clampedEnd = Math.max(clampedStart, Math.min(end, Math.max(0, integrity.size - 1)))
          return streamVerifiedBlocks(realPath, integrity, clampedStart, clampedEnd, rangeSignal)
        },
      }
    },
  }
}

/**
 * Scan saved Clip projects and `.backups/` to collect every referenced `clip-vault`
 * digest, then remove only unreferenced blobs older than `graceMs`.
 * Never throws on physical cleanup failures and never touches referenced blobs.
 */
export function collectUnreferencedBlobs({ paths, now = Date.now(), graceMs = 7 * 24 * 60 * 60 * 1000 }) {
  const referenced = new Set()
  const scanJsonDir = (dir) => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue
      try {
        const raw = JSON.parse(readFileSync(join(dir, name), 'utf8'))
        const items = raw?.project?.mediaLibrary?.items ?? raw?.mediaLibrary?.items ?? []
        if (!Array.isArray(items)) continue
        for (const item of items) {
          const handle = item?.omnimuxSource?.handle
          if (handle?.scope === 'clip-vault' && typeof handle.sha256 === 'string') {
            referenced.add(handle.sha256)
          }
        }
      } catch (error) {
        console.warn('[ClipVault] Skipping unreadable project record during GC scan.', name, error?.message ?? String(error))
      }
    }
  }
  scanJsonDir(paths.projectsDir)
  scanJsonDir(join(paths.projectsDir, '.backups'))

  const root = join(resolve(paths.blobsDir), 'sha256')
  if (!existsSync(root)) return { scanned: 0, removed: 0, kept: 0 }
  let scanned = 0
  let removed = 0
  let kept = 0
  for (const prefix of readdirSync(root)) {
    const sub = join(root, prefix)
    if (!statSync(sub).isDirectory()) continue
    for (const digest of readdirSync(sub)) {
      scanned++
      const file = join(sub, digest)
      if (referenced.has(digest)) { kept++; continue }
      try {
        const info = statSync(file)
        if (!info.isFile() || now - info.mtimeMs < graceMs) { kept++; continue }
        rmSync(file, { force: true })
        removed++
      } catch (error) {
        kept++
        console.warn('[ClipVault] Could not remove unreferenced blob.', digest.slice(0, 12), error?.message ?? String(error))
      }
    }
  }
  return { scanned, removed, kept }
}
