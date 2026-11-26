/** Official webServer routes; domain operations live in the shared dispatcher. */
import { PublishError } from './publish-error.js'
import { STATUS_BY_CODE, sendJson, readJsonBody, readRawBody, assertLocalWrite, header, messageOf } from './http-helpers.js'
import { SAFE_INLINE_MEDIA_TYPES, contentTypeOf, isAllowedHttpUploadMedia, normalizeMediaContentType } from './media.js'
export { createPublishDispatcher } from './publish-dispatcher.js'
export { sendJson, readJsonBody, readRawBody, assertLocalWrite } from './http-helpers.js'

const MEDIA_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "sandbox; default-src 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
}

/**
 * Build a strictly valid RFC 6266 / RFC 5987 Content-Disposition header value so
 * non-ASCII or control characters in filenames never trigger Node ERR_INVALID_CHAR.
 * @param {string | undefined} raw
 */
function buildSafeAttachmentDisposition(raw) {
  const cleaned = String(raw || 'media.bin').replace(/[\u0000-\u001f\u007f"\\/]+/g, '_').trim() || 'media.bin'
  const ascii = cleaned.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '') || 'media.bin'
  if (ascii === cleaned) {
    return `attachment; filename="${ascii}"`
  }
  const encoded = encodeURIComponent(cleaned).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/**
 * Build a consistent wire error payload for PublishError, surfacing structured
 * TikTok social error fields (`code`, `upstream_code`, `upstream_log_id`) when present.
 * @param {PublishError} error
 */
function errorPayload(error) {
  /** @type {Record<string, unknown>} */
  const body = { error: error.code, message: error.message }
  if (error.details && typeof error.details === 'object') {
    body.details = error.details
    if (typeof error.details.code === 'string' && error.details.code !== '') body.code = error.details.code
    if (typeof error.details.upstream_code === 'string' && error.details.upstream_code !== '') body.upstream_code = error.details.upstream_code
    if (typeof error.details.upstream_log_id === 'string' && error.details.upstream_log_id !== '') body.upstream_log_id = error.details.upstream_log_id
  } else if (typeof error.code === 'string' && error.code.startsWith('SOCIAL_TIKTOK_')) {
    body.code = error.code
  }
  return body
}

/** @param {string} pathname */
function extractSubPath(pathname) {
  if (pathname.startsWith('/omnimux/publish')) return pathname.slice('/omnimux/publish'.length) || '/'
  if (pathname.startsWith('/dsh-publish')) return pathname.slice('/dsh-publish'.length) || '/'
  return pathname
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {(() => { requestRejection?: (req: import('node:http').IncomingMessage) => number | undefined } | null | undefined) | undefined} getConnection
 * @param {unknown} peer
 * @returns {number | undefined}
 */
function hostRequestRejection(req, getConnection, peer) {
  if (peer !== undefined && peer !== null && typeof peer === 'object') return undefined
  try {
    const connection = getConnection?.()
    if (typeof connection?.requestRejection !== 'function') return 503
    const rejection = connection.requestRejection(req)
    return rejection === undefined ? undefined : (Number.isInteger(rejection) && rejection >= 400 && rejection <= 599 ? rejection : 403)
  } catch {
    return 503
  }
}

/**
 * Mount primary and existing legacy prefixes on the official webServer seat.
 * @param {import('./http-helpers.js').WebServer} webServer
 * @param {ReturnType<typeof import('./publish-dispatcher.js').createPublishDispatcher>} dispatcher
 * @param {{ getConnection?: () => { requestRejection?: (req: import('node:http').IncomingMessage) => number | undefined } | null | undefined }} [deps]
 * @returns {() => void}
 */
export function registerPublishRoutes(webServer, dispatcher, deps = {}) {
  /** @type {import('./http-helpers.js').RouteHandler} */
  const handler = async (req, res, peer) => {
    try {
      const rejection = hostRequestRejection(req, deps.getConnection, peer)
      if (rejection !== undefined) {
        sendJson(res, rejection, { error: 'request-denied', message: 'Host authentication required' })
        return
      }
      const method = (req.method || 'GET').toUpperCase()
      const url = new URL(req.url || '/omnimux/publish/state', 'http://127.0.0.1')
      const subPath = extractSubPath(url.pathname)
      if (method === 'POST') {
        try {
          assertLocalWrite({ origin: header(req, 'origin'), referer: header(req, 'referer'), secFetchSite: header(req, 'sec-fetch-site'), host: header(req, 'host'), secure: Boolean(/** @type {{ encrypted?: boolean } | undefined} */ (req.socket)?.encrypted) })
        } catch {
          sendJson(res, 403, { error: 'not-local', message: 'cross-origin write refused' })
          return
        }
      }
      if (method === 'GET' && subPath === '/state') {
        const revRaw = url.searchParams.get('rev')
        sendJson(res, 200, dispatcher.state(revRaw == null || revRaw === '' ? NaN : Number(revRaw)))
        return
      }
      if (method === 'GET' && subPath === '/records') {
        sendJson(res, 200, dispatcher.listRecords({
          status_filter: url.searchParams.get('status') || 'all', type: url.searchParams.get('type') || '',
          page: Number(url.searchParams.get('page')) || 1,
        }))
        return
      }
      if (method === 'GET' && subPath === '/records/detail') {
        sendJson(res, 200, await dispatcher.getRecord({ record_id: url.searchParams.get('id') || '', refresh: false }))
        return
      }
      if (method === 'GET' && subPath === '/creator-info') {
        try {
          const forceParam = (url.searchParams.get('force') || '').trim().toLowerCase()
          const force = forceParam === '1' || forceParam === 'true'
          sendJson(res, 200, await dispatcher.creatorInfo({ account_id: url.searchParams.get('id') || '', force }))
        } catch (error) {
          if (error instanceof PublishError) sendJson(res, STATUS_BY_CODE[error.code] ?? 400, errorPayload(error))
          else sendJson(res, 500, { error: 'internal', message: messageOf(error) })
        }
        return
      }
      if (method === 'GET' && subPath === '/capabilities') {
        sendJson(res, 200, dispatcher.capabilities())
        return
      }
      if (method === 'GET' && subPath === '/media/content') {
        try {
          const { buffer, meta } = dispatcher.openMedia(url.searchParams.get('id') || '')
          const normalizedType = normalizeMediaContentType(meta.content_type)
          const inlineSafe = SAFE_INLINE_MEDIA_TYPES.has(normalizedType)
          /** @type {Record<string, string>} */
          const headers = {
            ...MEDIA_SECURITY_HEADERS,
            'Content-Type': inlineSafe ? normalizedType : 'application/octet-stream',
            'Content-Length': String(buffer.length),
            'Cache-Control': 'private, max-age=86400',
          }
          if (!inlineSafe) {
            headers['Content-Disposition'] = buildSafeAttachmentDisposition(meta.filename)
          }
          res.writeHead(200, headers)
          res.end(buffer)
        } catch (error) {
          if (error instanceof PublishError) sendJson(res, STATUS_BY_CODE[error.code] ?? 404, { error: error.code, message: error.message })
          else sendJson(res, 500, { error: 'internal', message: messageOf(error) })
        }
        return
      }
      if (method === 'POST' && subPath === '/media') {
        const filename = url.searchParams.get('filename') || undefined
        const reqContentType = header(req, 'content-type') || undefined
        if (!isAllowedHttpUploadMedia(reqContentType, filename)) {
          sendJson(res, 415, { error: 'unsupported-media-type', message: 'only safe image, video, and audio media uploads are allowed' })
          return
        }
        const normalizedReqType = normalizeMediaContentType(reqContentType)
        const effectiveContentType = (!normalizedReqType || normalizedReqType === 'application/octet-stream') && filename
          ? contentTypeOf(filename)
          : (normalizedReqType || undefined)
        const buffer = await readRawBody(req)
        sendJson(res, 200, dispatcher.importMedia(buffer, {
          filename, content_type: effectiveContentType,
        }))
        return
      }
      const body = await readJsonBody(req)
      if (body === null) {
        sendJson(res, 400, { error: 'invalid-json', message: 'request body is not valid JSON' })
        return
      }
      if (typeof body !== 'object' || Array.isArray(body)) {
        sendJson(res, 400, { error: 'invalid-json', message: 'request body must be a JSON object' })
        return
      }
      const json = /** @type {Record<string, unknown>} */ (body)
      if (method === 'POST' && subPath === '/drafts') {
        sendJson(res, 200, await dispatcher.createDraft({
          type: json.type, payload: json.payload, account_ids: Array.isArray(json.account_ids) ? json.account_ids : undefined,
        }))
        return
      }
      if (method === 'POST' && subPath === '/drafts/update') {
        sendJson(res, 200, await dispatcher.updateDraft({ draft_id: String(json.draft_id || json.id || ''), patch: json.patch }))
        return
      }
      if (method === 'POST' && subPath === '/drafts/delete') {
        sendJson(res, 200, dispatcher.deleteDraft({ draft_id: String(json.draft_id || json.id || ''), confirm: json.confirm === true }))
        return
      }
      if (method === 'POST' && subPath === '/records/submit') {
        const recordId = String(json.record_id || json.id || '')
        // Validation errors are returned before dispatch starts in the background.
        await dispatcher.submitPrepare({ record_id: recordId })
        dispatcher.submitDispatch({ record_id: recordId }).catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          try {
            dispatcher.setRecordError(recordId, `submit runner failed: ${message}`)
          } catch {
            console.error('[omnimux-publish] submit runner failed without a ledger row:', message)
          }
        })
        sendJson(res, 200, { started: true, record_id: recordId })
        return
      }
      if (method === 'POST' && subPath === '/records/refresh') {
        sendJson(res, 200, await dispatcher.getRecord({ record_id: String(json.record_id || json.id || ''), refresh: true }))
        return
      }
      if (method === 'POST' && subPath === '/tasks/retry') {
        sendJson(res, 200, await dispatcher.retryTask({ task_id: String(json.task_id || json.id || '') }))
        return
      }
      sendJson(res, 404, { error: 'not-found', message: 'unknown route' })
    } catch (error) {
      if (error instanceof PublishError) {
        sendJson(res, STATUS_BY_CODE[error.code] ?? 500, errorPayload(error))
        return
      }
      sendJson(res, 500, { error: 'internal', message: messageOf(error) })
    }
  }
  const disposePrimary = webServer.register({ kind: 'prefix', path: '/omnimux/publish', auth: 'required', handler })
  const disposeLegacy = webServer.register({ kind: 'prefix', path: '/dsh-publish', auth: 'required', handler })
  return () => { disposePrimary?.(); disposeLegacy?.() }
}
