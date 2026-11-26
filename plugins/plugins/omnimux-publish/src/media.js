/**
 * MediaStore: sha256 内容寻址媒体仓（`media/<sha256>` + `media.json` 索引）。
 * UI 拾取的文件字节与 agent 引用的本地路径统一入库一份（去重），
 * draft 只引用 media_id —— 保证 A4「重开完整恢复」不依赖浏览器内存，
 * 也保证未登录可建草稿（媒体不能在拾取时就上云，presign 需要登录态）。
 */
import { createHash } from 'node:crypto'
import { copyFileSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { PublishError } from './publish-error.js'
import { isObject } from './shared/values.js'
import { isMediaRecord } from './media-types.js'
import { probeVideoDurationSec } from './media-duration.js'
/** @typedef {import('./media-types.js').MediaRecord} MediaRecord */
/** @typedef {{ schema: number, revision: number, media: MediaRecord[] }} MediaState */

/** @typedef {Pick<typeof import('node:fs'), 'copyFileSync' | 'lstatSync' | 'mkdirSync' | 'readFileSync' | 'realpathSync' | 'renameSync' | 'statSync' | 'writeFileSync'>} MediaFs */
/** @type {MediaFs} */
const DEFAULT_FS = { copyFileSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync }

const BLOCKED_IMPORT_EXTENSIONS = new Set([
  '.svg', '.svgz', '.html', '.htm', '.xhtml', '.xml', '.js', '.mjs', '.cjs', '.ts',
  '.sh', '.bash', '.zsh', '.plist', '.pem', '.key', '.p12', '.pfx', '.env', '.sqlite', '.db',
])

const BLOCKED_PATH_SEGMENTS = new Set([
  '.ssh', '.gnupg', '.aws', '.kube', '.docker', '.npm', '.pypirc', 'keychains',
])

const BLOCKED_BASENAMES = new Set([
  '.env', '.npmrc', '.netrc', '.git-credentials', 'id_rsa', 'id_ed25519', 'id_ecdsa',
  'ext-bridge-token', 'credentials', 'credentials.json', 'secrets.json', 'auth.json', 'passwd', 'shadow',
])

const BLOCKED_SYSTEM_PREFIXES = ['/etc', '/private/etc', '/proc', '/sys', '/var/run', '/private/var/run']
const WINDOWS_SYSTEM_PREFIX_RE = /^[a-z]:\/(?:windows|programdata|system volume information)(?:\/|$)/i
const UNC_OR_DEVICE_PATH_RE = /^(?:\\\\|\/\/)/
const MANAGED_DSH_SUBTREES = [
  'omnimux/assets/',
  'omnimux/inspirations/media/',
  'omnimux/publish/media/',
  'publish/media/',
]

const ACTIVE_DOCUMENT_PREFIX_RE = /^\s*(?:<\?xml\b|<!doctype\s+html\b|<html\b|<svg\b|<script\b|<iframe\b|<object\b|<embed\b)/i

/**
 * Resolve canonical filesystem casing when available (`realpathSync.native` on macOS/Windows),
 * falling back cleanly to `fs.realpathSync` (including injected test doubles).
 * @param {MediaFs} fs
 * @param {string} targetPath
 * @returns {string}
 */
function resolveRealPath(fs, targetPath) {
  const realpathFn = /** @type {typeof realpathSync & { native?: typeof realpathSync }} */ (fs.realpathSync)
  if (typeof realpathFn?.native === 'function') return realpathFn.native(targetPath)
  if (typeof realpathFn === 'function') return realpathFn(targetPath)
  return targetPath
}

/**
 * @param {string} rootReal
 * @param {string} candidateReal
 */
function isContainedPath(rootReal, candidateReal) {
  const normalizeCase = process.platform === 'darwin' || process.platform === 'win32'
  const rootCmp = normalizeCase ? rootReal.toLowerCase() : rootReal
  const candidateCmp = normalizeCase ? candidateReal.toLowerCase() : candidateReal
  const rel = relative(rootCmp, candidateCmp)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/**
 * @param {string} relSlashLower
 */
function isAllowedManagedDshSubtree(relSlashLower) {
  return MANAGED_DSH_SUBTREES.some((prefix) => relSlashLower.startsWith(prefix))
}

/**
 * @param {string} realPath
 * @param {string} mediaDirReal
 * @param {string} [dshHomeReal]
 */
function isSensitiveSystemOrCredentialPath(realPath, mediaDirReal, dshHomeReal = '') {
  const normalized = realPath.replace(/\\/g, '/')
  const lower = normalized.toLowerCase()
  if (UNC_OR_DEVICE_PATH_RE.test(realPath) || WINDOWS_SYSTEM_PREFIX_RE.test(lower)) return true
  for (const prefix of BLOCKED_SYSTEM_PREFIXES) {
    if (lower === prefix || lower.startsWith(`${prefix}/`)) return true
  }
  if (dshHomeReal && isContainedPath(dshHomeReal, realPath)) {
    if (!(mediaDirReal && isContainedPath(mediaDirReal, realPath))) {
      const relLower = relative(
        (process.platform === 'darwin' || process.platform === 'win32') ? dshHomeReal.toLowerCase() : dshHomeReal,
        (process.platform === 'darwin' || process.platform === 'win32') ? realPath.toLowerCase() : realPath,
      ).replace(/\\/g, '/')
      if (!isAllowedManagedDshSubtree(relLower)) return true
    }
  }
  const segments = lower.split('/').filter(Boolean)
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]
    if (BLOCKED_PATH_SEGMENTS.has(seg)) return true
    if (seg === '.config' && segments[i + 1] === 'gh') return true
    if (seg === '.dsh' || seg === '.ds-bot' || seg === '.omnimux' || seg.startsWith('.omnimux-')) {
      // Allow managed media/assets subdirectories inside DSH home; block auth/token/config files.
      if (mediaDirReal && isContainedPath(mediaDirReal, realPath)) continue
      const rest = segments.slice(i + 1).join('/')
      if (!isAllowedManagedDshSubtree(rest)) return true
    }
  }
  const name = basename(realPath).toLowerCase()
  if (BLOCKED_BASENAMES.has(name) || name.startsWith('.env.')) return true
  return false
}

/**
 * @param {Buffer} buffer
 */
function looksLikeActiveDocument(buffer) {
  const sample = buffer.subarray(0, 512).toString('utf8').replace(/^\uFEFF/, '')
  return ACTIVE_DOCUMENT_PREFIX_RE.test(sample)
}

/** @type {Record<string, string>} */
const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif', '.heic': 'image/heic',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
  '.webm': 'video/webm', '.m4v': 'video/mp4', '.flv': 'video/x-flv',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
}

/** Safe non-active media MIME types permitted for inline delivery on the Host origin. */
export const SAFE_INLINE_MEDIA_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/avif',
  'image/heic',
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/webm',
  'video/x-flv',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
])

const ACTIVE_DOCUMENT_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
  'text/javascript',
  'application/javascript',
  'application/ecmascript',
  'text/css',
])

const ACTIVE_DOCUMENT_EXTENSIONS = new Set([
  '.svg',
  '.svgz',
  '.html',
  '.htm',
  '.xhtml',
  '.xml',
  '.js',
  '.mjs',
  '.cjs',
  '.css',
])

/**
 * Strip parameters and lowercase a Content-Type header/value.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeMediaContentType(raw) {
  if (typeof raw !== 'string') return ''
  return (raw.split(';')[0] || '').trim().toLowerCase()
}

/**
 * Whether a media MIME type represents active document/script content that must be rejected.
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isActiveDocumentContentType(raw) {
  const mime = normalizeMediaContentType(raw)
  if (!mime) return false
  if (ACTIVE_DOCUMENT_TYPES.has(mime)) return true
  return mime.endsWith('+xml') || mime.includes('html') || mime.includes('script')
}

/**
 * Whether an HTTP upload's Content-Type / filename resolves to an allowed safe media type.
 * @param {string | undefined} rawContentType
 * @param {string | undefined} filename
 * @returns {boolean}
 */
export function isAllowedHttpUploadMedia(rawContentType, filename) {
  const normalized = normalizeMediaContentType(rawContentType)
  if (normalized && isActiveDocumentContentType(normalized)) return false
  if (normalized && SAFE_INLINE_MEDIA_TYPES.has(normalized)) return true
  if (!normalized || normalized === 'application/octet-stream') {
    const inferred = filename ? contentTypeOf(filename) : ''
    return SAFE_INLINE_MEDIA_TYPES.has(inferred)
  }
  return false
}

/**
 * @param {string} filename
 * @returns {string}
 */
export function contentTypeOf(filename) {
  return MIME_BY_EXT[extname(filename).toLowerCase()] || 'application/octet-stream'
}

/**
 * @param {string} contentType
 * @returns {'image' | 'video' | 'other'}
 */
export function mediaKindOf(contentType) {
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('video/')) return 'video'
  return 'other'
}

/**
 * @param {MediaFs} io
 * @param {string} file
 * @param {string} text
 */
function atomicWrite(io, file, text) {
  io.mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp`
  io.writeFileSync(tmp, text, { mode: 0o600 })
  io.renameSync(tmp, file)
}

/**
 * @param {{ paths?: { mediaIndexFile: string, mediaDir: string }, fs?: Partial<typeof DEFAULT_FS>, maxBytes?: number, allowedRoots?: string[], createHash?: typeof createHash, now?: () => string }} [opts]
 */
export function createMediaStore(opts = {}) {
  const fs = { ...DEFAULT_FS, ...(opts.fs ?? {}) }
  if (!opts.paths) throw new PublishError('invalid-arguments', 'mediaIndexFile and mediaDir are required')
  const paths = opts.paths
  const maxBytes = typeof opts.maxBytes === 'number' && opts.maxBytes > 0 ? opts.maxBytes : 512 * 1024 * 1024
  const allowedRoots = Array.isArray(opts.allowedRoots)
    ? opts.allowedRoots.filter((entry) => typeof entry === 'string' && entry.trim() !== '').map((entry) => resolve(entry.trim()))
    : []
  const hashOf = opts.createHash ?? createHash
  const now = typeof opts.now === 'function' ? opts.now : () => new Date().toISOString()

  /** @returns {MediaState} */
  function loadState() {
    /** @type {unknown} */
    let raw
    try {
      raw = JSON.parse(fs.readFileSync(paths.mediaIndexFile, 'utf8'))
    } catch {
      return { schema: 1, revision: 0, media: [] }
    }
    if (!isObject(raw) || !Array.isArray(raw.media)) return { schema: 1, revision: 0, media: [] }
    if (!raw.media.every(isMediaRecord)) {
      throw new PublishError('invalid-media', 'media.json contains an incomplete or invalid row; original data was not modified')
    }
    return { schema: 1, revision: Number(raw.revision) || 0, media: raw.media }
  }

  let state = loadState()

  function persist() {
    atomicWrite(fs, paths.mediaIndexFile, `${JSON.stringify(state, null, 2)}\n`)
  }

  /**
   * @param {string} sha256
   */
  function findRow(sha256) {
    return state.media.find((row) => row.sha256 === sha256) || null
  }

  /**
   * 字节入库（内容寻址去重）。同一 sha256 二次入库只刷新 filename/时间戳。
   * @param {Buffer} buffer
   * @param {{ filename?: string, content_type?: string }} [meta]
   */
  function importBuffer(buffer, meta = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new PublishError('invalid-arguments', 'media buffer is empty')
    }
    if (buffer.length > maxBytes) {
      throw new PublishError('media-too-large', `media exceeds the ${Math.round(maxBytes / 1024 / 1024)}MB limit (${buffer.length} bytes)`)
    }
    const sha256 = hashOf('sha256').update(buffer).digest('hex')
    const filename = typeof meta.filename === 'string' && meta.filename.trim() !== '' ? meta.filename.trim() : `${sha256.slice(0, 12)}.bin`
    const fileExt = extname(filename).toLowerCase()
    if (ACTIVE_DOCUMENT_EXTENSIONS.has(fileExt)) {
      throw new PublishError('unsupported-media-type', `unsupported active media extension: ${fileExt}`)
    }
    const providedType = typeof meta.content_type === 'string' && meta.content_type.trim() !== ''
      ? normalizeMediaContentType(meta.content_type)
      : ''
    if (isActiveDocumentContentType(providedType)) {
      throw new PublishError('unsupported-media-type', `unsupported active media content-type: ${providedType}`)
    }
    const inferredType = contentTypeOf(filename)
    const contentType = (!providedType || (providedType === 'application/octet-stream' && SAFE_INLINE_MEDIA_TYPES.has(inferredType)))
      ? inferredType
      : providedType
    const kind = mediaKindOf(contentType)
    const durationSec = kind === 'video' ? probeVideoDurationSec(buffer, contentType, filename) : undefined
    const existing = findRow(sha256)
    const target = join(paths.mediaDir, sha256)
    if (!existing) {
      fs.mkdirSync(paths.mediaDir, { recursive: true, mode: 0o700 })
      const tmp = `${target}.tmp`
      fs.writeFileSync(tmp, buffer, { mode: 0o600 })
      fs.renameSync(tmp, target)
      /** @type {MediaRecord} */
      const row = {
        id: sha256,
        sha256,
        filename,
        content_type: contentType,
        kind,
        size: buffer.length,
        created_at: now(),
        ...(kind === 'video' ? { duration_sec: durationSec ?? null } : {}),
      }
      state.media.push(row)
      state.revision += 1
      persist()
      return { media: { ...row }, deduplicated: false }
    }
    existing.filename = filename
    existing.content_type = contentType
    existing.kind = kind
    if (kind === 'video' && (existing.duration_sec === undefined || existing.duration_sec === null)) {
      existing.duration_sec = durationSec ?? null
    }
    state.revision += 1
    persist()
    return { media: { ...existing }, deduplicated: true }
  }

  /**
   * 本地路径导入（agent 引用 ~/Desktop/a.jpg / omnimux-assets 产物路径）。
   * 只读源文件，拷贝进媒体仓，源文件永不动。
   * @param {string} filePath
   * @param {{ filename?: string, content_type?: string }} [meta]
   */
  function importPath(filePath, meta = {}) {
    const rawPath = typeof filePath === 'string' ? filePath.trim() : ''
    if (!rawPath) throw new PublishError('path-not-found', 'media path is required')
    if (rawPath.includes('\0') || UNC_OR_DEVICE_PATH_RE.test(rawPath) || !isAbsolute(rawPath)) {
      throw new PublishError('path-not-allowed', 'media path must be a clean absolute path')
    }
    const normalizedPath = resolve(rawPath)
    let info
    try {
      info = typeof fs.lstatSync === 'function' ? fs.lstatSync(normalizedPath) : fs.statSync(normalizedPath)
    } catch {
      throw new PublishError('path-not-found', `media path does not exist: ${rawPath}`)
    }
    if (typeof info.isSymbolicLink === 'function' && info.isSymbolicLink()) {
      throw new PublishError('path-not-allowed', 'symbolic links cannot be imported as media')
    }
    if (!info.isFile()) throw new PublishError('path-not-found', `media path is not a file: ${rawPath}`)
    let realPath = normalizedPath
    try {
      realPath = resolveRealPath(fs, normalizedPath)
    } catch {
      throw new PublishError('path-not-found', `media path does not exist: ${rawPath}`)
    }
    let mediaDirReal = ''
    try {
      mediaDirReal = resolveRealPath(fs, paths.mediaDir)
    } catch {
      mediaDirReal = resolve(paths.mediaDir)
    }
    let dshHomeReal = ''
    const rawDshHome = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
    if (rawDshHome) {
      try {
        dshHomeReal = resolveRealPath(fs, rawDshHome)
      } catch {
        dshHomeReal = resolve(rawDshHome)
      }
    }
    if (isSensitiveSystemOrCredentialPath(realPath, mediaDirReal, dshHomeReal)) {
      throw new PublishError('path-not-allowed', 'importing system or credential files is not allowed')
    }
    if (allowedRoots.length > 0) {
      const permitted = allowedRoots.some((root) => {
        let rootReal = root
        try {
          rootReal = resolveRealPath(fs, root)
        } catch {
          return false
        }
        return isContainedPath(rootReal, realPath)
      })
      if (!permitted) {
        throw new PublishError('path-not-allowed', 'media path is outside allowed directories')
      }
    }
    const ext = extname(realPath).toLowerCase()
    if (BLOCKED_IMPORT_EXTENSIONS.has(ext)) {
      throw new PublishError('unsupported-media-type', `unsupported media file extension: ${ext}`)
    }
    if (info.size > maxBytes) {
      throw new PublishError('media-too-large', `media exceeds the ${Math.round(maxBytes / 1024 / 1024)}MB limit (${info.size} bytes)`)
    }
    const buffer = fs.readFileSync(realPath)
    if (looksLikeActiveDocument(buffer)) {
      throw new PublishError('unsupported-media-type', 'active document files cannot be imported as media')
    }
    return importBuffer(buffer, {
      filename: meta.filename || basename(realPath),
      content_type: meta.content_type,
    })
  }

  /**
   * @param {string} id
   */
  function get(id) {
    const row = findRow(String(id))
    return row ? { ...row } : null
  }

  /**
   * 读出字节（SubmitService 上传用）。
   * @param {string} id
   * @returns {{ buffer: Buffer, meta: MediaRecord }}
   */
  function open(id) {
    const row = findRow(String(id))
    if (!row) throw new PublishError('media-not-found', `media ${id} not found`)
    let buffer
    try {
      buffer = fs.readFileSync(join(paths.mediaDir, row.sha256))
    } catch {
      throw new PublishError('media-not-found', `media content missing for ${id} (index row exists, file does not)`)
    }
    return { buffer, meta: { ...row } }
  }

  /**
   * 懒补探历史视频记录缺失的 duration_sec 并落盘，避免老草稿绕过时长校验。
   * @param {string} id
   * @returns {MediaRecord | null}
   */
  function probeDuration(id) {
    const row = findRow(String(id))
    if (!row) return null
    if (row.kind !== 'video' || row.duration_sec !== undefined) return { ...row }
    let probed = null
    try {
      const buffer = fs.readFileSync(join(paths.mediaDir, row.sha256))
      probed = probeVideoDurationSec(buffer, row.content_type, row.filename)
    } catch {
      probed = null
    }
    row.duration_sec = probed
    state.revision += 1
    try {
      persist()
    } catch {
      // Read-only / stubbed filesystem still returns the probed duration in memory.
    }
    return { ...row }
  }

  function list() {
    return state.media.map((row) => ({ ...row })).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  }

  function revision() {
    return state.revision
  }

  return { importBuffer, importPath, get, open, probeDuration, list, revision }
}
