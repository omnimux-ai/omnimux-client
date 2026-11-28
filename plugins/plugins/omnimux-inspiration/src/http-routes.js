import { createHash, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  handleAnalyze,
  handleBatchDelete,
  handleCancelAnalysis,
  handleCreate,
  handleDeleteItem,
  handleFetchMedia,
  handleGetItem,
  handleImportUrl,
  handleList,
  handlePatchItem,
  handleShare,
  handleTranslate,
} from './http-handlers.js'
import { handleCollectionRequest } from './collection-handlers.js'
import { handleCapture } from './capture-handler.js'
import {
  handleCaptureCommit,
  handleCaptureMediaChunk,
  handleCaptureMediaSession,
} from './capture-relay.js'
import { handleRadarKeywords, handleRadarMatch } from './radar/radar-handlers.js'
import { handleSaveCreationDraft, handlePrepareCreationReferences, handleMaterializeCreationReferences } from './creation-handlers.js'
import { detectPlatformFromUrl } from './url-normalizer.js'

export { detectPlatformFromUrl } from './url-normalizer.js'

export const LOCAL_PREFIX = '/omnimux/inspiration/local'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const EXTENSION_PROTOCOLS = new Set(['chrome-extension:', 'moz-extension:', 'safari-web-extension:'])
const EXTENSION_HOST_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i
const MEDIA_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "sandbox; default-src 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
}

const CODE_MESSAGES = {
  'needs-omnimux': '需要登录 OmniMux 账号，请在 设置 → 个人资料 中登录',
  'needs-provider': '分析服务尚未就绪，请在设置中确认已配置的模型服务',
  'headless-skill-unavailable': '无头技能执行引擎尚未就绪，请检查 omnimux 执行中枢插件',
  'headless-skill-not-found': '灵感分析技能未加载，请重启应用或重新同步插件',
  'headless-skill-schema-invalid': '模型输出格式异常，经自动修复仍未满足结构要求，请重试',
  'headless-skill-timeout': '分析超时，请检查网络或切换模型后重试',
  'headless-skill-cancelled': '分析已取消，可重新分析',
  'headless-skill-stale-input': '分析期间原始内容已变更，请重新分析',
  'headless-skill-transport-exceeded': '素材超过分析传输容量，未提交不完整分析，请选择具体素材或正文分析',
  'headless-skill-transport-unavailable': '视频较大，需要视频处理能力准备完整视频后再分析',
}

const MEDIA_TYPES = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

const COLLECTION_ROUTES = { GET: 'list', POST: 'create' }
const ITEM_ROUTES = { GET: 'get', PATCH: 'patch', DELETE: 'delete' }
const ROUTE_HANDLERS = {
  list: handleList,
  create: handleCreate,
  'import-url': handleImportUrl,
  'fetch-media': handleFetchMedia,
  capture: handleCapture,
  'capture-media-session': handleCaptureMediaSession,
  'capture-media-chunk': handleCaptureMediaChunk,
  'capture-commit': handleCaptureCommit,
  analyze: handleAnalyze,
  'analyze-cancel': handleCancelAnalysis,
  translate: handleTranslate,
  'creation-draft': handleSaveCreationDraft,
  'creation-reference': handlePrepareCreationReferences,
  'creation-attachments': handleMaterializeCreationReferences,
  share: handleShare,
  'batch-delete': handleBatchDelete,
  'radar-keywords': handleRadarKeywords,
  'radar-match': handleRadarMatch,
  get: handleGetItem,
  patch: handlePatchItem,
  delete: handleDeleteItem,
  collections: handleCollectionRequest,
}

function extractObjectMessage(obj) {
  const code = typeof obj.code === 'string' ? obj.code : ''
  let msg = ''
  if (typeof obj.message === 'string') msg = obj.message
  else if (typeof obj.error === 'string') msg = obj.error
  if (CODE_MESSAGES[code]) return CODE_MESSAGES[code]
  // Configuration errors can describe a pending service, a user provider or
  // official credentials. Keep the execution hub's cause instead of guessing
  // that every failure means an absent official API key.
  if (code.startsWith('official-') || ['omnimux-unconfigured', 'analysis-service-unconfigured'].includes(code)) {
    return msg || '分析服务尚未配置，请检查所选服务'
  }
  if (code && msg) return `[${code}] ${msg}`
  if (msg) return msg
  if (code) return `[${code}]`
  return stringifyUnknown(obj)
}

function stringifyUnknown(obj) {
  try {
    const serialized = JSON.stringify(obj)
    if (serialized && serialized !== '{}') return serialized
  } catch {
    return ''
  }
  return ''
}

/** Format any thrown error / object safely without [object Object]. */
export function formatErrorMessage(err) {
  if (!err) return '未知错误'
  if (typeof err === 'string') return err
  if (typeof err === 'object') {
    const extracted = extractObjectMessage(err)
    if (extracted) return extracted
  }
  return String(err)
}


function parseJsonChunk(raw) {
  if (!raw.trim()) {
    return {}
  }
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Read a JSON body, releasing listeners even if its connection ends mid-upload.
 * @param {import('node:http').IncomingMessage} req
 * @param {{ signal?: AbortSignal }} [options]
 */
export async function readJsonBody(req, { signal } = {}) {
  return new Promise((resolve, reject) => {
    let raw = ''
    const finish = (value, error) => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(value)
    }
    const onAbort = () => finish(undefined, signal.reason)
    const onEnd = () => finish(parseJsonChunk(raw))
    const onError = () => finish(null)
    const onData = (chunk) => {
      raw += chunk
      if (raw.length > 2 * 1024 * 1024) finish(null)
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    req.setEncoding('utf8')
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Normalize an exact browser extension origin (`chrome-extension://<id>`, etc.).
 * Rejects wildcards, paths, ports, credentials, or non-extension origins.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeExtensionOrigin(raw) {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  if (!trimmed || trimmed === 'null' || trimmed.includes('*')) return ''
  let parsed
  try {
    parsed = new URL(trimmed)
  } catch {
    return ''
  }
  if (!EXTENSION_PROTOCOLS.has(parsed.protocol)) return ''
  if (parsed.username || parsed.password || parsed.port) return ''
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) return ''
  if (!EXTENSION_HOST_RE.test(parsed.hostname)) return ''
  return `${parsed.protocol}//${parsed.hostname.toLowerCase()}`
}

/**
 * Load explicitly allowlisted browser extension origins from options, env, and `$DSH_HOME/ext-allowed-origins.json`.
 * @param {{ allowedExtensionOrigins?: Iterable<string>, env?: NodeJS.ProcessEnv, dshHome?: string }} [options]
 * @returns {Set<string>}
 */
export function loadAllowedExtensionOrigins(options = {}) {
  const allowed = new Set()
  const addRaw = (value) => {
    const normalized = normalizeExtensionOrigin(value)
    if (normalized) allowed.add(normalized)
  }
  if (options.allowedExtensionOrigins) {
    for (const item of options.allowedExtensionOrigins) addRaw(item)
  }
  const env = options.env ?? process.env
  const envRaw = String(env?.OMNIMUX_ALLOWED_EXTENSION_ORIGINS || '').trim()
  if (envRaw) {
    for (const item of envRaw.split(',')) addRaw(item)
  }
  const home = options.dshHome || env?.DSH_HOME || ''
  if (home) {
    const file = join(home, 'ext-allowed-origins.json')
    try {
      const stat = lstatSync(file)
      if (!stat.isSymbolicLink() && stat.isFile() && stat.size <= 64 * 1024) {
        const parsed = JSON.parse(readFileSync(file, 'utf8'))
        const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.origins) ? parsed.origins : [])
        for (const item of list) addRaw(item)
      }
    } catch {}
  }
  return allowed
}

/**
 * Constant-time check for an authenticated paired-extension bridge token (`X-OmniMux-Bridge-Token` or `Authorization: Bearer`).
 * @param {{ headers?: Record<string, string | string[] | undefined> }} req
 * @param {{ dshHome?: string, env?: NodeJS.ProcessEnv, bridgeToken?: string }} [options]
 * @returns {boolean}
 */
export function hasValidBridgeToken(req, options = {}) {
  const headers = req?.headers ?? {}
  const direct = headers['x-omnimux-bridge-token']
  const authHeader = headers.authorization
  let presented = ''
  if (typeof direct === 'string' && direct.trim()) {
    presented = direct.trim()
  } else if (typeof authHeader === 'string') {
    const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim())
    if (match) presented = match[1]
  }
  if (presented.length < 16) return false

  let expected = typeof options.bridgeToken === 'string' ? options.bridgeToken.trim() : ''
  if (!expected) {
    const env = options.env ?? process.env
    const home = options.dshHome || env?.DSH_HOME || ''
    if (home) {
      const tokenFile = join(home, 'ext-bridge-token')
      try {
        const stat = lstatSync(tokenFile)
        if (!stat.isSymbolicLink() && stat.isFile() && stat.size <= 4096) {
          expected = readFileSync(tokenFile, 'utf8').trim()
        }
      } catch {}
    }
  }
  if (expected.length < 16) return false
  const a = createHash('sha256').update(presented).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * Determine the exact CORS origin allowed for a request, or `''` if denied.
 * Arbitrary `chrome-extension://*` / `moz-extension://*` origins are NOT reflected unless explicitly allowlisted or carrying a valid paired bridge token.
 * @param {{ headers?: Record<string, string | string[] | undefined>, socket?: { encrypted?: boolean } }} req
 * @param {{ allowedExtensionOrigins?: Iterable<string>, env?: NodeJS.ProcessEnv, dshHome?: string, bridgeToken?: string }} [options]
 * @returns {string}
 */
export function corsOriginFor(req, options = {}) {
  const raw = String(req?.headers?.origin || '').trim()
  if (!raw || raw === 'null') return ''
  const extOrigin = normalizeExtensionOrigin(raw)
  if (extOrigin) {
    const allowed = loadAllowedExtensionOrigins(options)
    if (allowed.has(extOrigin) || hasValidBridgeToken(req, options)) return extOrigin
    return ''
  }
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    if (raw !== parsed.origin) return ''
    if (!LOCAL_HOSTS.has(parsed.hostname)) return ''
    const host = String(req?.headers?.host || '').trim()
    if (!host) return ''
    const expected = new URL(`${req?.socket?.encrypted ? 'https' : 'http'}://${host}`)
    return parsed.origin === expected.origin ? parsed.origin : ''
  } catch {
    return ''
  }
}

/** @param {string} corsOrigin */
function corsHeadersFor(corsOrigin) {
  /** @type {Record<string, string>} */
  const headers = {}
  if (corsOrigin !== '' && corsOrigin !== '*') {
    headers['Access-Control-Allow-Origin'] = corsOrigin
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-OmniMux-Bridge-Token'
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, DELETE, OPTIONS'
    headers['Vary'] = 'Origin'
  }
  return headers
}

/** Send an empty 204 No Content response (RFC 9110 §8.6 compliant, no Content-Length/body). */
export function sendNoContent(res, corsOrigin = '') {
  res.writeHead(204, corsHeadersFor(corsOrigin))
  res.end()
}

/** Send JSON HTTP response. Local inspiration data is same-origin or explicitly authorized extension only. */
export function sendJson(res, status, payload, corsOrigin = '') {
  if (status === 204) {
    sendNoContent(res, corsOrigin)
    return
  }
  const json = JSON.stringify(payload)
  /** @type {Record<string, string>} */
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(json)),
    ...corsHeadersFor(corsOrigin),
  }
  res.writeHead(status, headers)
  res.end(json)
}

/**
 * Reject foreign, same-site, and unallowlisted browser-extension requests before they reach the local
 * library. Missing Origin stays valid for native/curl callers; a browser request from another localhost
 * port (`Sec-Fetch-Site: same-site`) or an unauthorized browser extension is refused.
 * @param {{ headers?: Record<string, string | string[] | undefined>, socket?: { encrypted?: boolean } }} req
 * @param {{ allowedExtensionOrigins?: Iterable<string>, env?: NodeJS.ProcessEnv, dshHome?: string, bridgeToken?: string }} [options]
 */
export function assertLocalWrite(req, options = {}) {
  const headers = req?.headers ?? {}
  const site = String(headers['sec-fetch-site'] || '').toLowerCase()
  const hasOriginHeader = typeof headers.origin === 'string' && headers.origin.trim() !== ''
  const rawOrigin = hasOriginHeader ? headers.origin.trim() : (typeof headers.referer === 'string' ? headers.referer.trim() : '')
  if (!rawOrigin) {
    if (site === 'cross-site' || site === 'same-site') throw new Error('cross-origin write refused')
    return
  }
  if (rawOrigin === 'null') throw new Error('cross-origin write refused')
  let actual
  try {
    actual = new URL(rawOrigin)
  } catch {
    throw new Error('cross-origin write refused')
  }
  if (EXTENSION_PROTOCOLS.has(actual.protocol)) {
    const extOrigin = hasOriginHeader
      ? normalizeExtensionOrigin(rawOrigin)
      : normalizeExtensionOrigin(`${actual.protocol}//${actual.hostname}`)
    if (!extOrigin) throw new Error('cross-origin write refused')
    const allowed = loadAllowedExtensionOrigins(options)
    if (allowed.has(extOrigin) || hasValidBridgeToken(req, options)) return
    throw new Error('cross-origin write refused')
  }
  if (site === 'cross-site' || site === 'same-site') throw new Error('cross-origin write refused')
  if (actual.protocol !== 'http:' && actual.protocol !== 'https:') throw new Error('cross-origin write refused')
  if (hasOriginHeader && rawOrigin !== actual.origin) throw new Error('cross-origin write refused')
  if (!LOCAL_HOSTS.has(actual.hostname)) throw new Error('cross-origin write refused')
  const host = headers.host
  if (host) {
    let expected
    try {
      expected = new URL(`${req.socket?.encrypted ? 'https' : 'http'}://${host}`)
    } catch {
      throw new Error('cross-origin write refused')
    }
    if (actual.origin !== expected.origin) throw new Error('cross-origin write refused')
  }
}

function isCollectionPath(path) {
  return path === LOCAL_PREFIX || path === `${LOCAL_PREFIX}/`
}

function parseActionId(path, action) {
  const suffix = `/${action}`
  if (!path.startsWith(`${LOCAL_PREFIX}/`) || !path.endsWith(suffix)) return ''
  return decodeURIComponent(path.slice(`${LOCAL_PREFIX}/`.length, -suffix.length))
}

function parseItemId(path) {
  if (!path.startsWith(`${LOCAL_PREFIX}/`) || path === LOCAL_PREFIX) return ''
  const id = decodeURIComponent(path.slice(`${LOCAL_PREFIX}/`.length))
  if (!id || id.includes('/')) return ''
  return id
}

function notFoundRoute() {
  return { name: 'not-found' }
}

function matchCollection(method, path) {
  if (!isCollectionPath(path)) return null
  const name = COLLECTION_ROUTES[method]
  return name ? { name } : notFoundRoute()
}

const SPECIAL_PATHS = {
  [`${LOCAL_PREFIX}/import-url`]: { POST: 'import-url' },
  [`${LOCAL_PREFIX}/fetch-media`]: { POST: 'fetch-media' },
  [`${LOCAL_PREFIX}/capture`]: { POST: 'capture' },
  [`${LOCAL_PREFIX}/capture-media-session`]: { POST: 'capture-media-session' },
  [`${LOCAL_PREFIX}/capture-media-chunk`]: { POST: 'capture-media-chunk' },
  [`${LOCAL_PREFIX}/capture-commit`]: { POST: 'capture-commit' },
  [`${LOCAL_PREFIX}/batch-delete`]: { POST: 'batch-delete', DELETE: 'batch-delete' },
  [`${LOCAL_PREFIX}/radar/keywords`]: { POST: 'radar-keywords' },
  [`${LOCAL_PREFIX}/radar/match`]: { POST: 'radar-match' },
}

function matchAnalyze(method, path) {
  if (method !== 'POST') return null
  for (const name of ['creation-draft', 'creation-reference', 'creation-attachments']) {
    const id = parseActionId(path, name)
    if (id) return { name, id }
  }
  const cancelAnalyzeId = parseActionId(path, 'analyze/cancel')
  if (cancelAnalyzeId) return { name: 'analyze-cancel', id: cancelAnalyzeId }
  const analyzeId = parseActionId(path, 'analyze')
  if (analyzeId) return { name: 'analyze', id: analyzeId }
  const translateId = parseActionId(path, 'translate')
  if (translateId) return { name: 'translate', id: translateId }
  const shareId = parseActionId(path, 'share')
  if (shareId) return { name: 'share', id: shareId }
  return null
}

function matchSpecial(method, path) {
  const table = SPECIAL_PATHS[path]
  if (table) {
    const name = table[method]
    return name ? { name } : notFoundRoute()
  }
  return matchAnalyze(method, path)
}

function matchItem(method, path) {
  const id = parseItemId(path)
  const name = id ? ITEM_ROUTES[method] : ''
  if (!name) return notFoundRoute()
  return { name, id }
}

function matchRoute(method, path) {
  const prefix = `${LOCAL_PREFIX}/collections`
  if (path === prefix || path.startsWith(`${prefix}/`)) return { name: 'collections' }
  return matchCollection(method, path) || matchSpecial(method, path) || matchItem(method, path)
}

async function dispatchRequest(ctx, req) {
  const method = (req.method || 'GET').toUpperCase()
  const rawPath = req.url || LOCAL_PREFIX
  const url = new URL(rawPath, 'http://127.0.0.1')
  // The rival prefix lives *under* `LOCAL_PREFIX`, so it has to be claimed
  // before the inspiration route table runs: `matchItem` reads the segment
  // after `/local/` as an item id, so every `/rival-accounts...` path would
  // resolve to the item route's `not found`.
  if (typeof ctx.rivalDispatcher?.dispatch === 'function' && ctx.rivalDispatcher.owns?.(url.pathname) === true) {
    return ctx.rivalDispatcher.dispatch({ method, url, body: req.body })
  }
  const route = matchRoute(method, url.pathname)
  const args = { ...ctx, req, url, id: route.id, signal: req.signal }
  try {
    return await runRoute(route.name, args)
  } catch (error) {
    if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
      return { status: 499, body: { error: 'aborted' } }
    }
    const status = error.status || 500
    const message = error.message || String(error)
    return { status, body: { error: message } }
  }
}

function createDispatch(ctx) {
  return (req) => dispatchRequest(ctx, req)
}

async function streamLocalMedia(paths, req, res) {
  const url = new URL(req.url || LOCAL_PREFIX, 'http://127.0.0.1')
  const prefix = `${LOCAL_PREFIX}/media/`
  if (!url.pathname.startsWith(prefix)) {
    sendJson(res, 404, { error: 'not found' })
    return
  }
  let subpath
  try {
    subpath = decodeURIComponent(url.pathname.slice(prefix.length))
  } catch {
    sendJson(res, 400, { error: 'invalid path' })
    return
  }
  if (!subpath || subpath.includes('\0') || subpath.includes('\\') || subpath.startsWith('/') || subpath.split('/').includes('..')) {
    sendJson(res, 400, { error: 'invalid path' })
    return
  }
  if (!existsSync(paths.mediaDir)) {
    sendJson(res, 404, { error: 'file not found' })
    return
  }
  const mediaRootReal = realpathSync(paths.mediaDir)
  const filePath = resolve(paths.mediaDir, subpath)
  const lexicalRel = relative(resolve(paths.mediaDir), filePath)
  if (!lexicalRel || lexicalRel === '..' || lexicalRel.startsWith(`..${sep}`) || isAbsolute(lexicalRel)) {
    sendJson(res, 400, { error: 'invalid path' })
    return
  }
  let stat
  try {
    stat = lstatSync(filePath)
  } catch {
    sendJson(res, 404, { error: 'file not found' })
    return
  }
  if (stat.isSymbolicLink()) {
    sendJson(res, 403, { error: 'forbidden path' })
    return
  }
  if (!stat.isFile()) {
    sendJson(res, 400, { error: 'invalid path' })
    return
  }
  let fileReal
  try {
    fileReal = realpathSync(filePath)
  } catch {
    sendJson(res, 404, { error: 'file not found' })
    return
  }
  const realRel = relative(mediaRootReal, fileReal)
  if (!realRel || realRel === '..' || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) {
    sendJson(res, 403, { error: 'forbidden path' })
    return
  }
  pipeMedia(req, res, fileReal)
}

function createStreamer(paths) {
  return (req, res) => streamLocalMedia(paths, req, res)
}

async function runRoute(name, args) {
  const handler = ROUTE_HANDLERS[name]
  if (!handler) return { status: 404, body: { error: 'not found' } }
  return handler(args)
}

function pipeMedia(req, res, filePath) {
  const stat = statSync(filePath)
  const fileSize = stat.size
  const mtimeMs = Math.floor(stat.mtimeMs || (stat.mtime ? stat.mtime.getTime() : 0))
  const etag = `W/"${fileSize.toString(16)}-${mtimeMs.toString(16)}"`
  const range = req.headers?.range || req.headers?.Range
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const contentType = MEDIA_TYPES[ext] || 'application/octet-stream'

  const ifNoneMatch = req.headers?.['if-none-match'] || req.headers?.['If-None-Match']
  if (ifNoneMatch && ifNoneMatch === etag) {
    res.writeHead(304, {
      ...MEDIA_SECURITY_HEADERS,
      ETag: etag,
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
    res.end()
    return
  }

  if (typeof range === 'string') {
    pipeRange({ res, filePath, fileSize, range, contentType, etag })
    return
  }
  res.writeHead(200, {
    ...MEDIA_SECURITY_HEADERS,
    'Content-Length': fileSize,
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Cache-Control': 'public, max-age=31536000, immutable',
  })
  createReadStream(filePath).pipe(res)
}

function pipeRange(opts) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(opts.range.trim())
  if (!match || opts.fileSize <= 0) {
    opts.res.writeHead(416, { ...MEDIA_SECURITY_HEADERS, 'Content-Range': `bytes */${opts.fileSize}` })
    opts.res.end()
    return
  }
  const start = match[1] ? parseInt(match[1], 10) : Math.max(0, opts.fileSize - parseInt(match[2] || '0', 10))
  const end = match[2] && match[1] ? Math.min(parseInt(match[2], 10), opts.fileSize - 1) : opts.fileSize - 1
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= opts.fileSize) {
    opts.res.writeHead(416, { ...MEDIA_SECURITY_HEADERS, 'Content-Range': `bytes */${opts.fileSize}` })
    opts.res.end()
    return
  }
  const file = createReadStream(opts.filePath, { start, end })
  const headers = {
    ...MEDIA_SECURITY_HEADERS,
    'Content-Range': `bytes ${start}-${end}/${opts.fileSize}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': (end - start) + 1,
    'Content-Type': opts.contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
  }
  if (opts.etag) headers.ETag = opts.etag
  opts.res.writeHead(206, headers)
  file.pipe(opts.res)
}

/**
 * Create dispatcher for inspiration local endpoints.
 *
 * `deps.rivalDispatcher` is the module that owns the rival prefix. It is
 * consulted *first* (see `dispatchRequest`) and needs a `owns(pathname)`
 * predicate plus a `dispatch({ method, url, body })` method; passing it in
 * keeps this file free of any import from the rival module while still making
 * this dispatcher the single router for everything under `LOCAL_PREFIX`.
 * @param {{
 *   localStore: any,
 *   socialFetcher?: Function,
 *   videoAnalyzeTool?: any,
 *   textComplete?: any,
 *   headlessSkill?: (() => { run: Function, listJobs?: Function, getJob?: Function, cancel?: Function } | undefined) | { run: Function, listJobs?: Function, getJob?: Function, cancel?: Function },
 *   videoProcess?: (() => {execute: Function} | undefined) | {execute: Function},
 *   composerAttachments?: (() => object | undefined) | object,
 *   fetcher?: typeof fetch,
 *   resolver?: Function,
 *   analyzeInspiration?: Function,
 *   rivalDispatcher?: { owns: (pathname: string) => boolean, dispatch: Function },
 *   inspirationShare?: () => { publishLocal: Function } | undefined,
 *   inspirationCatalog?: () => { getItem: Function, fetchMedia: Function } | undefined,
 * }} deps
 */
export function createLocalInspirationDispatcher(deps) {
  const store = deps.localStore
  const paths = store.paths
  const fetcher = deps.fetcher
  const ctx = {
    store,
    paths,
    socialFetcher: deps.socialFetcher,
    videoAnalyzeTool: deps.videoAnalyzeTool,
    textComplete: deps.textComplete,
    headlessSkill: deps.headlessSkill,
    videoProcess: deps.videoProcess,
    composerAttachments: deps.composerAttachments,
    fetcher,
    // Forwarded to the download target check. Left undefined in production so the
    // real `dns.lookup` is used; tests inject a stub to stay offline.
    resolver: deps.resolver,
    // Export destination and the audio extractor, both left undefined in
    // production: the platform Downloads folder and the real ffmpeg are the
    // correct defaults, and a test that reached either one would be writing to
    // the developer's own machine.
    downloadsDir: deps.downloadsDir,
    runFfmpeg: deps.runFfmpeg,
    // Also undefined in production, where `maybeAnalyze` calls the real analyzer.
    // The analyzer degrades to a local breakdown instead of reporting failure, so
    // its failure branch is unreachable from a test through any other seam — an
    // injected one is the only way to hold the "stored item keeps its video and
    // records the reason" contract.
    analyzeInspiration: deps.analyzeInspiration,
    rivalDispatcher: deps.rivalDispatcher,
    // The hub's publish capability, resolved per request: a plugin loaded after
    // this one still gets picked up, and a missing one is reported instead of
    // silently skipping the share.
    inspirationShare: deps.inspirationShare,
    inspirationCatalog: deps.inspirationCatalog,
    detectPlatformFromUrl,
    formatErrorMessage,
  }
  return {
    dispatch: createDispatch(ctx),
    streamLocalMedia: createStreamer(paths),
  }
}
