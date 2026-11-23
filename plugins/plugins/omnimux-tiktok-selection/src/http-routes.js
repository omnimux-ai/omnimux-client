import { SelectionError, httpStatusForError } from './errors.js'

export const ROUTE_PREFIX = '/omnimux/tiktok-selection'
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
// Only block actual secret-looking values, not the mere presence of a field
// name like "access_token" in a legitimate payload.
const SECRET_PATTERN =
  /sk-[A-Za-z0-9_-]{16,}|(?:access_token|refresh_token|api[_-]?key|client_secret|authorization)\s*["']?\s*[:=]\s*["']?[A-Za-z0-9._-]{16,}/i

function isLocalOrigin(raw) {
  if (!raw) return true
  try {
    const u = new URL(raw)
    return LOCAL_HOSTS.has(u.hostname)
  } catch (err) {
    return false
  }
}

export function assertLocalWrite(req) {
  const secFetchSite = String(req.secFetchSite || '').toLowerCase()
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'same-site' && secFetchSite !== 'none') {
    throw new SelectionError('not-local', 'Cross-site write requests are rejected')
  }
  if (req.origin && !isLocalOrigin(req.origin)) {
    throw new SelectionError('not-local', 'Non-local Origin rejected')
  }
  if (req.referer && !isLocalOrigin(req.referer)) {
    throw new SelectionError('not-local', 'Non-local Referer rejected')
  }
}

export function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  if (SECRET_PATTERN.test(text)) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'refused to emit a secret' }))
    return
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(text)
}

export async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch (err) {
    throw new SelectionError('invalid-json', `Malformed JSON request body: ${err.message}`)
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

      if (method === 'GET' && (pathname === '/overview' || pathname === '/state')) {
        return { status: 200, body: await dispatcher.getOverview() }
      }
      if (method === 'POST' && pathname === '/discovery/rank') {
        return { status: 200, body: await dispatcher.queryRank(body) }
      }
      if (method === 'POST' && pathname === '/discovery/search') {
        return { status: 200, body: await dispatcher.searchProducts(body) }
      }
      if (method === 'POST' && pathname === '/discovery/import') {
        return { status: 200, body: await dispatcher.importSnapshot(body) }
      }
      if (method === 'POST' && pathname === '/discovery/detail') {
        return { status: 200, body: await dispatcher.getProductDetail(body) }
      }
      if (method === 'POST' && pathname === '/gate/dry-run') {
        return { status: 200, body: await dispatcher.gateDryRun(body) }
      }
      if (method === 'GET' && pathname === '/tasks') {
        return { status: 200, body: await dispatcher.listTasks(query) }
      }
      if (method === 'POST' && pathname === '/tasks') {
        return { status: 200, body: await dispatcher.createTask(body) }
      }
      const taskDetailMatch = /^\/tasks\/([^/]+)$/.exec(pathname)
      if (method === 'GET' && taskDetailMatch) {
        return { status: 200, body: await dispatcher.getTask({ taskId: decodeURIComponent(taskDetailMatch[1]) }) }
      }
      const taskCtrlMatch = /^\/tasks\/([^/]+)\/control$/.exec(pathname)
      if (method === 'POST' && taskCtrlMatch) {
        return { status: 200, body: await dispatcher.controlTask({ ...body, taskId: decodeURIComponent(taskCtrlMatch[1]) }) }
      }
      if (method === 'GET' && pathname === '/library') {
        return { status: 200, body: await dispatcher.listLibrary(query) }
      }
      if (method === 'POST' && pathname === '/library/ingest') {
        return { status: 200, body: await dispatcher.ingestProducts(body) }
      }
      if (method === 'POST' && pathname === '/library/status') {
        return { status: 200, body: await dispatcher.updateStatus(body) }
      }
      if (method === 'POST' && pathname === '/library/remove') {
        const res = await dispatcher.removeProducts(body)
        return { status: res?.ok === false ? 400 : 200, body: res }
      }
      if (method === 'POST' && pathname === '/assets/generate') {
        return { status: 200, body: await dispatcher.generateAssets(body) }
      }
      if (method === 'GET' && pathname === '/schedules') {
        return { status: 200, body: await dispatcher.manageSchedule({ action: 'list' }) }
      }
      if (method === 'POST' && pathname === '/schedules') {
        const res = await dispatcher.manageSchedule(body)
        return { status: res?.ok === false ? 400 : 200, body: res }
      }
      if (method === 'GET' && pathname === '/runs') {
        return { status: 200, body: await dispatcher.listRuns(query) }
      }
      if (method === 'GET' && pathname === '/risk-words') {
        return { status: 200, body: await dispatcher.manageRiskWords({ action: 'list', ...query }) }
      }
      if (method === 'POST' && pathname === '/risk-words') {
        const res = await dispatcher.manageRiskWords(body)
        return { status: res?.ok === false ? 400 : 200, body: res }
      }
      if (method === 'GET' && pathname === '/settings') {
        return { status: 200, body: await dispatcher.manageSettings({ action: 'get' }) }
      }
      if (method === 'POST' && pathname === '/settings') {
        return { status: 200, body: await dispatcher.manageSettings(body) }
      }

      return { status: 404, body: { error: 'not-found', message: `Unknown route: ${method} ${pathname}` } }
    } catch (err) {
      const status = httpStatusForError(err)
      if (status >= 500) {
        logger?.warn?.('omnimux-tiktok-selection: HTTP dispatch error', { error: err?.message })
      }
      return {
        status,
        body: {
          error: err?.code || 'internal',
          message: err?.message || 'Internal error',
          ...(err?.details ? { details: err.details } : {}),
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

export function registerSelectionRoutes(webServer, dispatcher, logger) {
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
          origin: headerOf(req, 'origin'),
          referer: headerOf(req, 'referer'),
          secFetchSite: headerOf(req, 'sec-fetch-site'),
          body,
        })
        sendJson(res, result.status, result.body)
      } catch (err) {
        logger?.warn?.('omnimux-tiktok-selection: request failed', { error: err?.message })
        sendJson(res, httpStatusForError(err), { error: err?.code || 'internal', message: err?.message || 'internal error' })
      }
    },
  })
  return () => {
    dispose()
  }
}
