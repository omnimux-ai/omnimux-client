import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createWriteStream, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { finished } from 'node:stream/promises'
import { ClipDomainError, clipErrorStatus, clipErrorValue, isClipRevision, isClipToken } from '../errors.js'
import { readCanvasBinding, resolveWorkflowBinding, sameBinding } from '../live/command-broker.js'
import { MAX_RECEIPT_BYTES } from '../live/snapshot.js'
import { assertProjectId, ensureClipDirs, exportMp4Path } from '../paths.js'
import { inspectStagedMedia, persistToClipVault } from '../media/clipVault.js'
import { mapResolverError, reconcileProjectMedia, resolveProjectMediaStream } from '../media/reconcile.js'
import { isReferenceId } from '../timeline/nativeProjectFields.js'
import { analyzeProjectTranscript } from '../timeline/analyzeTranscript.js'
import { createProjectStore } from '../store/projectStore.js'
import { listClipTemplates } from '../templates/catalog.js'
import { requestRejection } from './request-authorization.js'

export const CLIP_API_PREFIX = '/omnimux-clip/api'
export const CLIP_VERSION = '0.1.0'
export const RAW_EXPORT_CONTENT_TYPE = 'application/octet-stream'
export const EXPORT_UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024
export const EXPORT_UPLOAD_PROOF_HEADER = 'x-clip-export-proof'
export const MEDIA_NAME_HEADER = 'x-clip-media-name'
export const MEDIA_MIME_HEADER = 'x-clip-media-mime'
export const MEDIA_BINDING_HEADER = 'x-clip-media-binding'

const DEFAULT_FS = { createWriteStream, renameSync, rmSync, statSync, writeFileSync }
const SAVE_EXPORT_PATH = /^\/projects\/[^/]+\/save-export$/
const EXPORT_UPLOAD_PATH = /^\/exports\/([1-9]\d{0,15})\/upload$/
const EXPORT_CANCEL_PATH = /^\/exports\/([1-9]\d{0,15})\/cancel$/
const MEDIA_BYTES_PATH = /^\/projects\/([^/]+)\/media\/([^/]+)\/bytes$/
const MEDIA_RECONCILE_PATH = /^\/projects\/([^/]+)\/media\/reconcile$/
const MEDIA_TRANSFER_PATH = /^\/media-transfer\/([A-Za-z0-9_-]{32,128})$/
const LIVE_PATH = /^\/live\/(lease|renew|release|claim|receipt)$/

function parseByteRange(header, size) {
  if (!header || typeof header !== 'string') return { kind: 'full', start: 0, end: Math.max(0, size - 1) }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!match || (match[1] === '' && match[2] === '')) return { kind: 'unsatisfiable' }
  if (size <= 0) return { kind: 'unsatisfiable' }
  let start
  let end
  if (match[1] === '') {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { kind: 'unsatisfiable' }
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
    return { kind: 'unsatisfiable' }
  }
  return { kind: 'partial', start, end }
}

function etagMatches(ifNoneMatch, sha256) {
  if (typeof ifNoneMatch !== 'string' || !sha256) return false
  const target = `"${sha256}"`
  return ifNoneMatch.split(',').some((token) => {
    const cleaned = token.trim().replace(/^W\//i, '')
    return cleaned === '*' || cleaned === target
  })
}

function routeUrl(rawPath) {
  const url = new URL(rawPath || CLIP_API_PREFIX, 'http://localhost')
  let path = url.pathname.replace(/\/+$/, '')
  if (path === CLIP_API_PREFIX || path.startsWith(`${CLIP_API_PREFIX}/`)) path = path.slice(CLIP_API_PREFIX.length)
  return { path: path || '/', searchParams: url.searchParams }
}

function errorResponse(error) {
  if (error instanceof ClipDomainError) {
    const { code, message, details } = clipErrorValue(error)
    return { status: clipErrorStatus(error), body: { error: code, message, ...(details ? { details } : {}) } }
  }
  if (error instanceof URIError || error instanceof SyntaxError) {
    return { status: 400, body: { error: 'invalid-json', message: 'The Clip request is invalid.' } }
  }
  return { status: 500, body: { error: 'internal', message: 'The Clip Host could not complete this request.' } }
}

export function sendJson(res, status, body) {
  const text = status === 204 ? '' : JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  })
  res.end(text)
}

export async function readJsonBody(req, { maxBytes = 8 * 1024 * 1024 } = {}) {
  const chunks = []
  let size = 0
  const input = req.iterator?.({ destroyOnReturn: false }) ?? req
  for await (const chunk of input) {
    size += chunk.length
    if (size > maxBytes) {
      req.resume?.()
      throw new ClipDomainError('schema-too-large', 'The Clip request exceeds its size limit.')
    }
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

export function decodeExportPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw ClipDomainError.invalidJson('The export body must be a JSON object.')
  }
  if (body.path !== undefined) throw ClipDomainError.pathDenied('Export requests must upload their video bytes.')
  const raw = [body.base64, body.data, body.blob].find((value) => typeof value === 'string' && value)
  if (!raw) throw ClipDomainError.invalidJson('The export body needs base64 video bytes.')
  const encoded = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw ClipDomainError.invalidJson('Invalid export base64.')
  return Buffer.from(encoded, 'base64')
}

function persistExportBytes(body, paths, fs, dest, tempPath) {
  if (tempPath) {
    if (dirname(resolve(tempPath)) !== resolve(paths.tmpDir)) throw ClipDomainError.pathDenied()
    fs.renameSync(tempPath, dest)
    return fs.statSync(dest).size
  }
  const bytes = decodeExportPayload(body)
  fs.writeFileSync(dest, bytes, { mode: 0o600 })
  return bytes.length
}

export function exportFileRevision(file, fs = DEFAULT_FS) {
  const stat = fs.statSync(file)
  return `${stat.mtimeMs}:${stat.size}`
}

function hasRawExportContent(req) {
  return String(req.headers?.['content-type'] || '').split(';', 1)[0].trim().toLowerCase() === RAW_EXPORT_CONTENT_TYPE
}

async function writeRawUpload(req, tmpDir, fs) {
  const tempPath = join(tmpDir, `upload-${randomUUID()}.bin`)
  const out = fs.createWriteStream(tempPath, { flags: 'wx', mode: 0o600 })
  const persisted = finished(out, { cleanup: true })
  // The stream can fail while the request is still between chunks.
  void persisted.catch(() => undefined)
  let size = 0
  try {
    const input = req.iterator?.({ destroyOnReturn: false }) ?? req
    for await (const chunk of input) {
      size += chunk.length
      if (size > EXPORT_UPLOAD_MAX_BYTES) {
        req.resume?.()
        throw new ClipDomainError('schema-too-large', 'The MP4 upload exceeds its size limit.')
      }
      if (out.errored) throw out.errored
      if (!out.write(chunk)) await once(out, 'drain')
    }
    out.end()
    await persisted
  } catch (error) {
    out.destroy()
    await persisted.catch(() => undefined)
    fs.rmSync(tempPath, { force: true })
    if (error instanceof ClipDomainError) throw error
    throw new ClipDomainError('export-upload-failed', 'The Host could not read or stage the export upload.')
  }
  return tempPath
}

function objectBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw ClipDomainError.invalidJson('The Clip request needs a JSON object.')
  return body
}

export function createClipDispatcher({ paths, store, fs = DEFAULT_FS, broker, exportJobs, getWorkflowClip, getMediaResolver, getAssetLibrary, mediaTransfers }) {
  ensureClipDirs(paths)
  store ??= createProjectStore({ paths, fs })

  function getWorkflow(binding, sessionId) {
    if (!sessionId) throw new ClipDomainError('WINDOW_UNAUTHORIZED', 'An authenticated Clip window in the canvas conversation is required.')
    const workflow = getWorkflowClip?.()
    const target = resolveWorkflowBinding(workflow, binding, sessionId)
    if (typeof workflow.saveDraft !== 'function') throw new ClipDomainError('needs-workflow-clip', 'The canvas draft service is unavailable.')
    return { workflow, target }
  }

  function updateDraft(workflow, binding, revision) {
    if (!binding) return
    try {
      workflow.saveDraft({ ...binding, revision })
    } catch {
      throw new ClipDomainError('draft-link-failed', 'The Clip draft was saved. Retry this save to update its canvas node.', { currentRevision: revision })
    }
  }

  function saveProject(id, input, sessionId) {
    assertProjectId(id)
    const { project, expectedRevision, revision, binding: rawBinding, backupCurrent } = objectBody(input)
    if (!isClipRevision(expectedRevision) || !isClipRevision(revision) || revision <= expectedRevision) {
      throw ClipDomainError.invalidJson('expectedRevision and a greater revision are required to save a project.')
    }
    objectBody(project)
    if (backupCurrent !== undefined && typeof backupCurrent !== 'boolean') throw ClipDomainError.invalidJson('backupCurrent must be a boolean.')
    const previous = store.exists(id) ? store.load(id) : undefined
    const binding = rawBinding === undefined ? previous?.binding : readCanvasBinding(id, rawBinding)
    if (previous?.binding && !sameBinding(previous.binding, binding)) {
      throw new ClipDomainError('clip-binding-mismatch', 'The Clip project belongs to another composition node.')
    }
    if (!binding && id.startsWith('clip_node_')) throw ClipDomainError.projectNotMaterialized(id)
    const workflow = binding ? getWorkflow(binding, sessionId).workflow : undefined
    const envelope = store.save(id, project, { expectedRevision, revision, binding, backupCurrent })
    updateDraft(workflow, binding, envelope.revision)
    return envelope
  }

  function materializeProject(id, input, sessionId) {
    const { binding: rawBinding, draftSchema, title } = objectBody(input)
    const binding = readCanvasBinding(id, rawBinding)
    if (title !== undefined && (typeof title !== 'string' || title.length > 256)) throw ClipDomainError.invalidJson('title must be text up to 256 characters.')
    const { workflow, target } = getWorkflow(binding, sessionId)
    const envelope = store.materialize(id, { binding, draftSchema, title: title || target.title })
    updateDraft(workflow, binding, envelope.revision)
    return envelope
  }

  function reserveCanvasExport(input, window) {
    if (!window?.isAlive?.() || !isClipToken(window.windowInstanceId)) {
      throw new ClipDomainError('WINDOW_UNAUTHORIZED', 'An authenticated Clip window is required.')
    }
    if (!exportJobs) throw ClipDomainError.exportEncodeFailed('The Clip export service is unavailable.')
    const { requestId, binding: proposed, editorInstanceId, tabInstanceId, projectRevision, revisionEpoch } = objectBody(input)
    if (!isClipToken(requestId) || !isClipToken(editorInstanceId) || !isClipToken(tabInstanceId) || !isClipRevision(projectRevision)
      || (revisionEpoch !== undefined && !isClipRevision(revisionEpoch))) {
      throw ClipDomainError.invalidJson('The export needs a request ID, editor identity and project revision.')
    }
    const binding = readCanvasBinding(proposed?.projectId, proposed)
    const viewport = window.getViewport()
    const clip = viewport?.view?.extra?.clip
    const surface = viewport?.surface
    if (viewport?.ok !== true || !viewport.sessionId || viewport.sessionId === 'default' || surface?.panelOpen !== true
      || surface.tabId !== 'omnimux-workflow:canvas' || surface.instanceId !== tabInstanceId
      || clip?.mode !== 'canvas' || clip.visible === false || clip.conflict === true || clip.editorInstanceId !== editorInstanceId
      || viewport.view.extra.workspaceId !== binding.workspaceId || !sameBinding(clip, binding)) {
      throw new ClipDomainError('EDITOR_NOT_VISIBLE', 'The export must start in the original canvas editor.')
    }
    resolveWorkflowBinding(getWorkflowClip?.(), binding, viewport.sessionId)
    const saved = store.load(binding.projectId)
    if (!sameBinding(saved.binding, binding)) {
      throw new ClipDomainError('clip-binding-mismatch', 'The saved Clip project belongs to another canvas node.')
    }
    const currentEpoch = isClipRevision(clip.revisionEpoch) ? clip.revisionEpoch : undefined
    if (clip.revision !== projectRevision || projectRevision < saved.revision || (revisionEpoch ?? 0) !== (currentEpoch ?? 0)) {
      throw ClipDomainError.revisionConflict(
        Math.max(saved.revision, isClipRevision(clip.revision) ? clip.revision : 0),
        'The Clip revision changed. Review the current project before exporting.', currentEpoch)
    }
    return exportJobs.begin({ requestId, projectId: binding.projectId, projectRevision: clip.revision, revisionEpoch: currentEpoch,
      editorInstanceId, draftWriterId: clip.draftWriterId, binding, manualWindowId: window.windowInstanceId })
  }

  async function dispatch(req) {
    const method = (req.method || 'GET').toUpperCase()
    try {
      const { path, searchParams } = routeUrl(req.url)
      if (method === 'OPTIONS') return { status: 204, body: {} }
      if (method === 'GET' && path === '/health') return { status: 200, body: { clip: true, version: CLIP_VERSION } }
      if (method === 'GET' && path === '/projects') return { status: 200, body: store.list() }
      if (method === 'GET' && path === '/templates') {
        const includeRaw = searchParams.get('includeAssetLibrary')
        if (includeRaw !== null && includeRaw !== 'true' && includeRaw !== 'false' && includeRaw !== '1' && includeRaw !== '0') {
          throw ClipDomainError.invalidJson('includeAssetLibrary must be a boolean.')
        }
        const templates = await listClipTemplates({
          kind: searchParams.get('kind') ?? 'all',
          ...(searchParams.has('category') ? { category: searchParams.get('category') } : {}),
          ...(searchParams.has('templateId') ? { templateId: searchParams.get('templateId') } : {}),
          includeAssetLibrary: includeRaw === 'true' || includeRaw === '1',
        }, { getAssetLibrary })
        return { status: 200, body: templates }
      }

      const live = path.match(LIVE_PATH)
      if (live && method === 'POST') {
        if (!req.window?.isAlive?.()) throw new ClipDomainError('WINDOW_UNAUTHORIZED', 'An authenticated Clip window is required.')
        if (!broker) throw new ClipDomainError('EDITOR_OFFLINE', 'The Clip Host is offline.')
        return { status: 200, body: await broker[live[1]](req.window, objectBody(req.body)) }
      }

      const mediaTransfer = path.match(MEDIA_TRANSFER_PATH)
      if (mediaTransfer && (method === 'GET' || method === 'HEAD')) {
        if (!req.window?.isAlive?.()) throw new ClipDomainError('WINDOW_UNAUTHORIZED', 'An authenticated Clip window is required.')
        if (!mediaTransfers) throw new ClipDomainError('media-resolver-unavailable', 'Host media transfer service is unavailable.')
        const sessionId = req.window.getViewport()?.sessionId
        const ticket = mediaTransfers.resolve({ token: mediaTransfer[1], sessionId })
        const resolver = getMediaResolver?.()
        if (!resolver || typeof resolver.open !== 'function') {
          throw new ClipDomainError('media-resolver-unavailable', 'Host media resolver is unavailable.')
        }
        let stream
        try {
          stream = await resolver.open(ticket.handle, { sessionId, projectBinding: ticket.binding }, req.signal)
        } catch (error) {
          throw mapResolverError(error)
        }
        const baseHeaders = {
          'Content-Type': stream.mimeType,
          'Accept-Ranges': 'bytes',
          ETag: `"${stream.sha256}"`,
          'X-Content-SHA256': stream.sha256,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, no-cache',
        }
        if (etagMatches(req.headers?.['if-none-match'], stream.sha256)) {
          return { status: 304, headers: baseHeaders }
        }
        const range = parseByteRange(req.headers?.range, stream.size)
        if (range.kind === 'unsatisfiable') {
          return { status: 416, headers: { ...baseHeaders, 'Content-Range': `bytes */${stream.size}`, 'Content-Length': '0' } }
        }
        const length = stream.size > 0 ? range.end - range.start + 1 : 0
        const headers = {
          ...baseHeaders,
          'Content-Length': String(length),
          ...(range.kind === 'partial' ? { 'Content-Range': `bytes ${range.start}-${range.end}/${stream.size}` } : {}),
        }
        return {
          status: range.kind === 'partial' ? 206 : 200,
          headers,
          mediaStream: {
            openRange: stream.openRange,
            start: range.start,
            end: range.end,
            size: stream.size,
            sha256: stream.sha256,
            mimeType: stream.mimeType,
            method,
          },
        }
      }

      if (path === '/exports/reserve' && method === 'POST') {
        return { status: 200, body: reserveCanvasExport(req.body, req.window) }
      }
      const exportCancel = path.match(EXPORT_CANCEL_PATH)
      if (exportCancel && method === 'POST') {
        if (!exportJobs || !req.exportProof || !searchParams.has('projectId')) {
          throw ClipDomainError.pathDenied('Export upload authorization is required.')
        }
        const body = exportJobs.cancel({
          exportJobId: exportCancel[1], uploadToken: req.exportProof, projectId: assertProjectId(searchParams.get('projectId')),
        })
        return { status: 200, body }
      }
      const exportUpload = path.match(EXPORT_UPLOAD_PATH)
      if (exportUpload && method === 'POST') {
        if (!exportJobs || !req.exportUpload || !req.tempPath) throw ClipDomainError.pathDenied('Export upload authorization is required.')
        const body = await exportJobs.upload({ ...req.exportUpload, exportJobId: exportUpload[1], tempPath: req.tempPath })
        return { status: 200, body }
      }

      const mediaBytes = path.match(MEDIA_BYTES_PATH)
      if (mediaBytes && method === 'PUT') {
        const id = assertProjectId(decodeURIComponent(mediaBytes[1]))
        const mediaId = decodeURIComponent(mediaBytes[2])
        if (!isReferenceId(mediaId)) throw ClipDomainError.invalidId('invalid media id')
        if (!req.tempPath) throw ClipDomainError.invalidJson('Media bytes upload body is required.')
        let envelope
        try {
          envelope = store.load(id)
        } catch (error) {
          if (error?.code !== 'not-found') throw error
          envelope = null
        }
        const sessionId = req.window?.getViewport()?.sessionId
        let binding = envelope?.binding
        if (!envelope && typeof req.headers?.[MEDIA_BINDING_HEADER] === 'string' && req.headers[MEDIA_BINDING_HEADER]) {
          let parsed
          try {
            parsed = JSON.parse(req.headers[MEDIA_BINDING_HEADER])
          } catch {
            throw ClipDomainError.invalidJson('Invalid x-clip-media-binding header.')
          }
          binding = parsed && typeof parsed === 'object' ? { ...parsed, projectId: id } : undefined
        }
        const workflow = binding ? getWorkflow(binding, sessionId).workflow : undefined
        const rawNameHeader = req.headers?.[MEDIA_NAME_HEADER]
        const fileName = typeof rawNameHeader === 'string' && rawNameHeader
          ? (/%(?![0-9A-Fa-f]{2})/.test(rawNameHeader) ? rawNameHeader : decodeURIComponent(rawNameHeader))
          : undefined
        const claimedMimeType = typeof req.headers?.[MEDIA_MIME_HEADER] === 'string' ? req.headers[MEDIA_MIME_HEADER] : undefined
        const staged = await inspectStagedMedia({ paths, tempPath: req.tempPath, fileName, claimedMimeType, signal: req.signal })
        if (binding && typeof workflow?.ingestClipMedia === 'function') {
          const ingested = await workflow.ingestClipMedia(
            binding,
            { tempPath: staged.stagedPath, fileName: staged.fileName, mimeType: staged.mimeType, sha256: staged.sha256 },
            sessionId,
            req.signal,
          )
          if (ingested) {
            return {
              status: 200,
              body: {
                handle: ingested.handle,
                sha256: ingested.sha256,
                size: ingested.size || staged.size,
                mimeType: ingested.mimeType,
                url: ingested.url,
              },
            }
          }
        }
        const vaulted = await persistToClipVault({ paths, ...staged, signal: req.signal })
        return { status: 200, body: vaulted }
      }
      if (mediaBytes && (method === 'GET' || method === 'HEAD')) {
        const id = assertProjectId(decodeURIComponent(mediaBytes[1]))
        const mediaId = decodeURIComponent(mediaBytes[2])
        const sessionId = req.window?.getViewport()?.sessionId
        const { stream } = await resolveProjectMediaStream(
          { store, getMediaResolver, getWorkflowClip },
          { projectId: id, mediaId, sessionId, signal: req.signal },
        )
        const baseHeaders = {
          'Content-Type': stream.mimeType,
          'Accept-Ranges': 'bytes',
          ETag: `"${stream.sha256}"`,
          'X-Content-SHA256': stream.sha256,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, no-cache',
        }
        if (etagMatches(req.headers?.['if-none-match'], stream.sha256)) {
          return { status: 304, headers: baseHeaders }
        }
        const range = parseByteRange(req.headers?.range, stream.size)
        if (range.kind === 'unsatisfiable') {
          return { status: 416, headers: { ...baseHeaders, 'Content-Range': `bytes */${stream.size}`, 'Content-Length': '0' } }
        }
        const length = stream.size > 0 ? range.end - range.start + 1 : 0
        const headers = {
          ...baseHeaders,
          'Content-Length': String(length),
          ...(range.kind === 'partial' ? { 'Content-Range': `bytes ${range.start}-${range.end}/${stream.size}` } : {}),
        }
        return {
          status: range.kind === 'partial' ? 206 : 200,
          headers,
          mediaStream: {
            openRange: stream.openRange,
            start: range.start,
            end: range.end,
            size: stream.size,
            sha256: stream.sha256,
            mimeType: stream.mimeType,
            method,
          },
        }
      }

      const mediaReconcile = path.match(MEDIA_RECONCILE_PATH)
      if (mediaReconcile && method === 'POST') {
        const id = assertProjectId(decodeURIComponent(mediaReconcile[1]))
        const sessionId = req.window?.getViewport()?.sessionId
        const body = await reconcileProjectMedia(
          { store, getMediaResolver, getWorkflowClip },
          { projectId: id, ...objectBody(req.body), sessionId, signal: req.signal },
        )
        return { status: 200, body }
      }

      const transcriptRoute = path.match(/^\/projects\/([^/]+)\/transcript$/)
      if (transcriptRoute && method === 'GET') {
        const id = assertProjectId(decodeURIComponent(transcriptRoute[1]))
        const parseOptNumber = (key) => {
          if (!searchParams.has(key)) return undefined
          const raw = searchParams.get(key)
          if (raw === null || !raw.trim()) throw ClipDomainError.invalidJson(`${key} must be a finite number.`)
          const value = Number(raw)
          if (!Number.isFinite(value)) throw ClipDomainError.invalidJson(`${key} must be a finite number.`)
          return value
        }
        const loaded = store.load(id)
        const fillers = searchParams.has('fillerPhrases') ? searchParams.getAll('fillerPhrases') : undefined
        const analysis = analyzeProjectTranscript(loaded.project, {
          ...(searchParams.has('captionTrackId') ? { captionTrackId: searchParams.get('captionTrackId') } : {}),
          minPauseSec: parseOptNumber('minPauseSec'),
          keepPauseSec: parseOptNumber('keepPauseSec'),
          ...(fillers !== undefined ? { fillerPhrases: fillers } : {}),
          ...(searchParams.has('query') ? { query: searchParams.get('query') } : {}),
        })
        return {
          status: 200,
          body: {
            projectId: id,
            revision: loaded.revision,
            revisionEpoch: 0,
            mode: 'transcript',
            durationSec: loaded.project.timeline.duration,
            ...analysis,
          },
        }
      }

      const project = path.match(/^\/projects\/([^/]+)(?:\/(save-export|materialize))?$/)
      if (project) {
        const id = assertProjectId(decodeURIComponent(project[1]))
        const action = project[2]
        const sessionId = req.window?.getViewport()?.sessionId
        if (!action && method === 'GET') return { status: 200, body: store.load(id) }
        if (!action && method === 'PUT') return { status: 200, body: saveProject(id, req.body, sessionId) }
        if (action === 'materialize' && method === 'POST') return { status: 200, body: materializeProject(id, req.body, sessionId) }
        if (action === 'save-export' && method === 'POST') {
          const dest = exportMp4Path(paths, id)
          const bytes = persistExportBytes(req.body, paths, fs, dest, req.tempPath)
          return { status: 200, body: { id, saved: true, path: dest, bytes, revision: exportFileRevision(dest, fs) } }
        }
      }
      return { status: 404, body: { error: 'not-found', message: 'Unknown Clip route.' } }
    } catch (error) {
      return errorResponse(error)
    }
  }

  function authorizeExportUpload(exportJobId, uploadToken, projectId) {
    if (!exportJobs?.authorizeUpload || !projectId || typeof uploadToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(uploadToken)) {
      throw ClipDomainError.pathDenied('Export upload authorization is invalid or expired.')
    }
    exportJobs.authorizeUpload({ exportJobId, uploadToken, projectId: assertProjectId(projectId) })
    return { uploadToken, projectId }
  }

  return { dispatch, paths, authorizeExportUpload }
}

export function registerClipRoutes(webServer, dispatcher, deps = {}) {
  const paths = deps.paths ?? dispatcher.paths
  const fs = deps.fs ?? DEFAULT_FS
  return webServer.register({
    kind: 'prefix',
    path: CLIP_API_PREFIX,
    auth: 'required',
    async handler(req, res, peer) {
      let tempPath
      const abort = new AbortController()
      const onClose = () => { if (!res.writableEnded) abort.abort() }
      res.on?.('close', onClose)
      try {
        const rejection = requestRejection(req, deps.getConnection, peer)
        if (rejection !== undefined) return sendJson(res, rejection, { error: 'request-denied' })
        const method = (req.method || 'GET').toUpperCase()
        const { path, searchParams } = routeUrl(req.url)
        const window = deps.getHubEvents?.()?.authorizeWindow?.(req)
        if (path.startsWith('/live/') && !window?.isAlive?.()) {
          throw new ClipDomainError('WINDOW_UNAUTHORIZED', 'An authenticated Clip window is required.')
        }
        const versioned = method === 'POST' && path.match(EXPORT_UPLOAD_PATH)
        const mediaUpload = method === 'PUT' && MEDIA_BYTES_PATH.test(path)
        let exportUpload
        if (versioned) {
          if (!hasRawExportContent(req)) {
            return sendJson(res, 415, { error: 'invalid-export-media', message: 'Upload the MP4 as application/octet-stream.' })
          }
          exportUpload = dispatcher.authorizeExportUpload(versioned[1], req.headers?.[EXPORT_UPLOAD_PROOF_HEADER], searchParams.get('projectId'))
        }
        if (mediaUpload && !hasRawExportContent(req)) {
          return sendJson(res, 415, { error: 'unsupported-media', message: 'Upload media bytes as application/octet-stream.' })
        }
        if (versioned || mediaUpload || (method === 'POST' && hasRawExportContent(req) && SAVE_EXPORT_PATH.test(path))) {
          tempPath = await writeRawUpload(req, paths.tmpDir, fs)
        }
        const wantsBody = !tempPath && (method === 'POST' || method === 'PUT')
        const body = wantsBody ? await readJsonBody(req, path === '/live/receipt' ? { maxBytes: MAX_RECEIPT_BYTES } : {}) : undefined
        if (wantsBody && body === null) throw ClipDomainError.invalidJson()
        const result = await dispatcher.dispatch({
          method, url: req.url, body, window, tempPath, exportUpload,
          headers: req.headers, signal: abort.signal,
          exportProof: req.headers?.[EXPORT_UPLOAD_PROOF_HEADER],
        })
        if (result.mediaStream) {
          res.writeHead(result.status, result.headers)
          if (method === 'HEAD') {
            res.end()
            return
          }
          for await (const chunk of result.mediaStream.openRange(result.mediaStream.start, result.mediaStream.end, abort.signal)) {
            if (abort.signal.aborted) break
            if (!res.write(chunk)) await once(res, 'drain')
          }
          if (!res.writableEnded) res.end()
          return
        }
        if ((result.status === 304 || result.status === 416) && result.headers) {
          res.writeHead(result.status, result.headers)
          res.end()
          return
        }
        sendJson(res, result.status, result.body)
      } catch (error) {
        if (res.headersSent) {
          res.destroy?.()
          return
        }
        const result = errorResponse(error)
        sendJson(res, result.status, result.body)
      } finally {
        res.off?.('close', onClose)
        if (tempPath) fs.rmSync(tempPath, { force: true })
      }
    },
  })
}

export function clipStorageHint(paths) {
  return dirname(paths.dir)
}
