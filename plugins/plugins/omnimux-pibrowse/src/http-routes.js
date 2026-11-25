import { ROUTE_PREFIX } from './constants.js'
import { PibrowseError, httpStatusForError } from './errors.js'
import { containsLeakedSecret, redactAny, redactLogLine } from './redact.js'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024

function isAllowedOrigin(raw, expectedHost) {
  if (!raw) return true
  try {
    const parsed = new URL(raw)
    if (!LOCAL_HOSTS.has(parsed.hostname)) return false
    if (expectedHost && parsed.host.toLowerCase() !== String(expectedHost).toLowerCase()) {
      return false
    }
    return true
  } catch (err) {
    console.warn('omnimux-pibrowse: invalid origin header rejected', err instanceof Error ? err.message : String(err))
    return false
  }
}

export function assertLocalWrite(req) {
  const secFetchSite = String(req.secFetchSite || '').toLowerCase()
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
    throw new PibrowseError('not-local', 'Cross-site write requests are rejected')
  }
  if (req.origin && !isAllowedOrigin(req.origin, req.host)) {
    throw new PibrowseError('not-local', 'Non-local or cross-port Origin rejected')
  }
  if (req.referer && !isAllowedOrigin(req.referer, req.host)) {
    throw new PibrowseError('not-local', 'Non-local or cross-port Referer rejected')
  }
}

export function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  if (containsLeakedSecret(text)) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: false, error: 'secret-redaction-guard', message: 'Refused to emit secret material' }))
    return
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(text)
}

export async function readJsonBody(req) {
  const chunks = []
  let totalBytes = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buf.length
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new PibrowseError('invalid-input', 'Request body exceeds 2 MiB limit')
    }
    chunks.push(buf)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch (err) {
    throw new PibrowseError('invalid-json', `Malformed JSON request body: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function queryToObject(searchParams) {
  const out = {}
  for (const [k, v] of searchParams.entries()) {
    if (v === 'true') out[k] = true
    else if (v === 'false') out[k] = false
    else out[k] = v
  }
  return out
}

export function createHttpHandler(dispatcher, logger) {
  async function dispatch(req) {
    try {
      const method = String(req.method || 'GET').toUpperCase()
      const parsedUrl = new URL(req.url || `${ROUTE_PREFIX}/overview`, 'http://127.0.0.1')
      const pathname = parsedUrl.pathname.startsWith(ROUTE_PREFIX)
        ? parsedUrl.pathname.slice(ROUTE_PREFIX.length) || '/'
        : parsedUrl.pathname
      const query = queryToObject(parsedUrl.searchParams)
      const body = req.body && typeof req.body === 'object' ? req.body : {}

      if (method !== 'GET' && method !== 'HEAD') {
        assertLocalWrite(req)
      }

      // Overview & Runtime
      if (method === 'GET' && (pathname === '/overview' || pathname === '/status')) {
        return { status: 200, body: await dispatcher.getOverview() }
      }
      if (method === 'POST' && pathname === '/runtime') {
        const res = await dispatcher.manageRuntime(body)
        return { status: res?.ok === false && res?.error === 'confirmation-required' ? 400 : 200, body: res }
      }

      // Profiles & Personas
      if (method === 'GET' && pathname === '/profiles') {
        return { status: 200, body: await dispatcher.listProfiles(query) }
      }
      if (method === 'GET' && pathname === '/personas') {
        return { status: 200, body: await dispatcher.listPersonas() }
      }
      if (method === 'POST' && pathname === '/profiles') {
        return { status: 200, body: await dispatcher.upsertProfile(body) }
      }
      if (method === 'POST' && pathname === '/profiles/batch') {
        return { status: 200, body: await dispatcher.batchCreateProfiles(body) }
      }
      if (method === 'POST' && pathname === '/profiles/manage') {
        const res = await dispatcher.manageProfiles(body)
        return { status: res?.ok === false && res?.error === 'confirmation-required' ? 400 : 200, body: res }
      }
      const launchMatch = /^\/profiles\/([^/]+)\/launch$/.exec(pathname)
      if (method === 'POST' && launchMatch) {
        return {
          status: 200,
          body: await dispatcher.launchProfile({ ...body, id: decodeURIComponent(launchMatch[1]) }),
        }
      }
      const stopMatch = /^\/profiles\/([^/]+)\/stop$/.exec(pathname)
      if (method === 'POST' && stopMatch) {
        return {
          status: 200,
          body: await dispatcher.stopProfile({ id: decodeURIComponent(stopMatch[1]) }),
        }
      }

      // Proxies
      if (method === 'GET' && pathname === '/proxies') {
        return { status: 200, body: await dispatcher.listProxies() }
      }
      if (method === 'POST' && pathname === '/proxies') {
        return { status: 200, body: await dispatcher.upsertProxy(body) }
      }
      if (method === 'POST' && pathname === '/proxies/import') {
        return { status: 200, body: await dispatcher.importProxies(body) }
      }
      if (method === 'POST' && pathname === '/proxies/check') {
        return { status: 200, body: await dispatcher.checkProxy(body) }
      }
      if (method === 'POST' && pathname === '/proxies/delete') {
        const res = await dispatcher.deleteProxy(body)
        return { status: res?.ok === false && res?.error === 'confirmation-required' ? 400 : 200, body: res }
      }

      // Blocklists
      if (method === 'GET' && pathname === '/blocklists') {
        return { status: 200, body: await dispatcher.manageBlocklists({ action: 'list' }) }
      }
      const blGetMatch = /^\/blocklists\/([^/]+)$/.exec(pathname)
      if (method === 'GET' && blGetMatch) {
        return {
          status: 200,
          body: await dispatcher.manageBlocklists({ action: 'get', name: decodeURIComponent(blGetMatch[1]) }),
        }
      }
      if (method === 'POST' && pathname === '/blocklists') {
        const res = await dispatcher.manageBlocklists(body)
        return { status: res?.ok === false && res?.error === 'confirmation-required' ? 400 : 200, body: res }
      }

      // Extensions & Mirror
      if (method === 'GET' && pathname === '/extensions') {
        return { status: 200, body: await dispatcher.manageExtensionsAndMirror({ action: 'list_extensions' }) }
      }
      if (method === 'POST' && pathname === '/extensions') {
        const res = await dispatcher.manageExtensionsAndMirror(body)
        return { status: res?.ok === false && res?.error === 'confirmation-required' ? 400 : 200, body: res }
      }

      // Team Server (Phase 3)
      if (method === 'GET' && pathname === '/team/status') {
        return { status: 200, body: await dispatcher.manageTeamSync({ action: 'status' }) }
      }
      if (method === 'POST' && pathname === '/team/login') {
        return { status: 200, body: await dispatcher.teamLogin(body) }
      }
      if (method === 'POST' && pathname === '/team/signup') {
        return { status: 200, body: await dispatcher.teamSignup(body) }
      }
      if (method === 'POST' && pathname === '/team/unlock') {
        return { status: 200, body: await dispatcher.teamUnlock(body.password) }
      }
      if (method === 'POST' && pathname === '/team/sync') {
        const res = await dispatcher.manageTeamSync(body)
        return { status: res?.ok === false && res?.error === 'confirmation-required' ? 400 : 200, body: res }
      }

      return { status: 404, body: { ok: false, error: 'not-found', message: `Unknown route: ${method} ${pathname}` } }
    } catch (err) {
      const status = httpStatusForError(err)
      const safeMessage = redactLogLine(err instanceof Error ? err.message : 'Internal error')
      if (status >= 500) {
        logger?.warn?.('omnimux-pibrowse: HTTP dispatch error', {
          error: safeMessage,
        })
      }
      return {
        status,
        body: {
          ok: false,
          error: err instanceof PibrowseError ? err.code : 'internal',
          message: safeMessage,
          ...(err instanceof PibrowseError && err.details ? { details: redactAny(err.details) } : {}),
        },
      }
    }
  }

  return { dispatch }
}

function headerOf(req, name) {
  const val = req.headers?.[name]
  return Array.isArray(val) ? val[0] : val
}

export function registerPibrowseRoutes(webServer, dispatcher, logger) {
  const handler = createHttpHandler(dispatcher, logger)
  const dispose = webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    auth: 'required',
    async handler(req, res) {
      try {
        const method = String(req.method || 'GET').toUpperCase()
        const body = method === 'POST' || method === 'PUT' || method === 'DELETE' ? await readJsonBody(req) : undefined
        const result = await handler.dispatch({
          method,
          url: req.url || `${ROUTE_PREFIX}/overview`,
          host: headerOf(req, 'host'),
          origin: headerOf(req, 'origin'),
          referer: headerOf(req, 'referer'),
          secFetchSite: headerOf(req, 'sec-fetch-site'),
          body,
        })
        sendJson(res, result.status, result.body)
      } catch (err) {
        const safeMessage = redactLogLine(err instanceof Error ? err.message : 'Internal error')
        logger?.warn?.('omnimux-pibrowse: request failed', {
          error: safeMessage,
        })
        sendJson(res, httpStatusForError(err), {
          ok: false,
          error: err instanceof PibrowseError ? err.code : 'internal',
          message: safeMessage,
        })
      }
    },
  })
  return () => {
    dispose()
  }
}
