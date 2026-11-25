/**
 * ProductsDispatcher: one request in, one result out.
 *
 * Writes (POST / PUT / DELETE) all run assertLocalWrite. Assets only
 * gated POST — do not copy that shortcut.
 */
import { createReadStream } from 'node:fs'
import { createDraftMediaRegistry } from './draft-media.js'
import { LinkImportError, importProductFromUrl } from './link-importer.js'
import { PRODUCT_KINDS, listViewOf, ProductsError } from './library.js'
import { mediaDirOf } from './paths.js'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const PREFIX = '/omnimux/products'

const STATUS_BY_CODE = {
  'invalid-json': 400,
  'path-not-found': 400,
  'path-unsupported': 400,
  'name-required': 400,
  'name-invalid': 400,
  'kind-invalid': 400,
  'text-too-long': 400,
  'categories-invalid': 400,
  'media-invalid': 400,
  'media-path-invalid': 400,
  'media-path-unavailable': 400,
  'content-required': 400,
  'brand-strategy-invalid': 400,
  'invalid-url': 400,
  'link-import-empty': 422,
  'link-import-failed': 502,
  'library-corrupt': 500,
  'picker-invalid-kind': 400,
  'picker-unsupported': 501,
  'picker-failed': 500,
  'picker-unavailable': 503,
  'product-not-found': 404,
  'draft-media-not-found': 404,
  'name-conflict': 409,
  'not-local': 403,
}

/**
 * Read-only media stream. Never writes user files.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {{ absolutePath: string, mime: string, size?: number }} stream
 */
export function sendPreview(res, status, stream) {
  res.writeHead(status, {
    'Content-Type': stream.mime,
    'X-Content-Type-Options': 'nosniff',
    ...(stream.mime.split(';')[0].trim().toLowerCase() === 'image/svg+xml'
      ? { 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:" } : {}),
    ...(Number.isFinite(stream.size) ? { 'Content-Length': String(stream.size) } : {}),
    'Cache-Control': 'private, max-age=30',
  })
  createReadStream(stream.absolutePath).on('error', () => {
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'internal', message: 'preview stream failed' })
      return
    }
    res.destroy()
  }).pipe(res)
}

/**
 * A key shape, not the two letters `sk`. An import now answers page-derived and
 * model-authored copy, where `risk-free` / `task-focused` are ordinary English;
 * matching those would fail a good import with a 500.
 */
const SECRET_PATTERN = /access_token|sk-[A-Za-z0-9_-]{16,}/

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

/**
 * Parse a request body as JSON. Empty body = {}. Bad JSON = null.
 * @param {import('node:http').IncomingMessage} req
 */
export async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    return null
  }
}

/**
 * Write routes only accept same-machine browser calls.
 * @param {{ origin?: string, referer?: string, secFetchSite?: string, host?: string, secure?: boolean }} headers
 */
export function assertLocalWrite(headers = {}) {
  const site = String(headers.secFetchSite || '').toLowerCase()
  if (site === 'cross-site' || site === 'same-site') throw new Error('cross-origin write refused')
  const origin = headers.origin || originFromReferer(headers.referer)
  if (!origin) return
  let parsed
  try {
    parsed = new URL(origin)
  } catch {
    throw new Error('cross-origin write refused')
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) throw new Error('cross-origin write refused')
  if (headers.host) {
    let expected
    try {
      expected = new URL(`${headers.secure === true ? 'https' : 'http'}://${headers.host}`).origin
    } catch {
      throw new Error('cross-origin write refused')
    }
    if (parsed.origin !== expected) throw new Error('cross-origin write refused')
  }
}

/**
 * @param {string | undefined} referer
 */
function originFromReferer(referer) {
  if (!referer) return ''
  try {
    return new URL(referer).origin
  } catch {
    return ''
  }
}

/**
 * @param {{ headers?: Record<string, string | string[] | undefined> } | undefined} req
 * @param {string} name
 */
function header(req, name) {
  const value = req?.headers?.[name] ?? req?.headers?.[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

/**
 * @param {unknown} error
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Read one seat off the host context. A seat that is absent, or that throws on
 * lookup, reads as "missing" — never as a request failure.
 *
 * @param {unknown} ctx
 * @param {string} name
 * @returns {unknown}
 */
function readSeat(ctx, name) {
  if (!ctx || typeof ctx !== 'object') return undefined
  const getter = /** @type {{ get?: Function }} */ (ctx).get
  if (typeof getter !== 'function') return undefined
  try {
    return getter.call(ctx, name)
  } catch {
    return undefined
  }
}

/**
 * Wrap the hub capabilities this vertical consumes, resolved lazily at call time
 * (load order between plugins is not this plugin's contract):
 *
 * - `headlessSkill` — the Hub shared headless skill runner (`ctx.get('headlessSkill')`);
 * - `pageFetch` — the Hub reader seam (`ctx.get('pageFetch')`, OmniMux Jina Reader);
 * - `socialData` — the Hub social-data seam (`ctx.get('socialData')`, incl. TikTok Shop).
 *
 * Tool definitions are never executed from this plugin: reading
 * `ctx.tools.get(name)` and calling `execute` would skip the tool pipeline
 * (pre-execute policy, guards, result audit). See
 * docs/contracts/headless-skill-execution.md.
 *
 * @param {unknown} ctx
 * @param {{ headlessSkill?: { run: Function, cancel?: Function, getJob?: Function, listJobs?: Function } }} [deps] test seam override
 * @returns {{ headlessSkill: { run: Function, cancel: Function, getJob: Function, listJobs: Function }, pageFetch: Function, socialData: Function } | null}
 */
export function createHubSeams(ctx, deps) {
  if (!ctx || typeof ctx !== 'object') return null
  const overrides = deps && typeof deps === 'object' ? deps : {}
  const injectedHeadless = overrides.headlessSkill && typeof overrides.headlessSkill.run === 'function'
    ? overrides.headlessSkill
    : null

  function resolveHeadlessSkill() {
    if (injectedHeadless) return injectedHeadless
    const service = /** @type {{ run?: Function, cancel?: Function, getJob?: Function, listJobs?: Function } | undefined} */ (readSeat(ctx, 'headlessSkill'))
    return service && typeof service.run === 'function' ? service : null
  }

  const seams = {
    headlessSkill: {
      /**
       * @param {Record<string, unknown>} request
       * @returns {Promise<unknown>}
       */
      async run(request) {
        const service = resolveHeadlessSkill()
        if (!service) {
          throw Object.assign(
            new Error('headlessSkill unavailable: hub is not loaded or headlessSkill seam is disabled'),
            { code: 'headless-skill-unavailable' },
          )
        }
        return service.run(request)
      },
      /**
       * @param {string} jobId
       * @param {string} [reason]
       */
      cancel(jobId, reason) {
        const service = resolveHeadlessSkill()
        return typeof service?.cancel === 'function' ? service.cancel(jobId, reason) : false
      },
      /**
       * @param {string} jobId
       */
      getJob(jobId) {
        const service = resolveHeadlessSkill()
        return typeof service?.getJob === 'function' ? service.getJob(jobId) : undefined
      },
      /**
       * @param {Record<string, unknown>} [filter]
       */
      listJobs(filter) {
        const service = resolveHeadlessSkill()
        return typeof service?.listJobs === 'function' ? service.listJobs(filter) : []
      },
    },

    /**
     * @param {string} url
     * @returns {Promise<unknown>}
     */
    async pageFetch(url) {
      const seam = /** @type {{ fetch?: Function } | undefined} */ (readSeat(ctx, 'pageFetch'))
      if (!seam || typeof seam.fetch !== 'function') {
        throw new Error('omnimux_page_fetch unavailable: hub is not loaded or the reader is disabled')
      }
      return seam.fetch({ url })
    },

    /**
     * Official social / shop data via the hub `socialData` seam (TikTok Shop models included).
     * @param {Record<string, unknown>} args
     * @param {{ signal?: AbortSignal }} [exec]
     */
    async socialData(args, exec) {
      const seam = /** @type {{ fetch?: Function } | undefined} */ (readSeat(ctx, 'socialData'))
      if (!seam || typeof seam.fetch !== 'function') {
        throw new Error('omnimux_social_data unavailable: hub is not loaded or the tool is disabled')
      }
      return seam.fetch(args, exec)
    },
  }
  return seams
}

/**
 * @param {string} pathname
 */
function parseProductPath(pathname) {
  if (pathname === PREFIX || pathname === `${PREFIX}/`) return { kind: 'collection' }
  if (pathname === `${PREFIX}/state`) return { kind: 'state' }
  if (pathname === `${PREFIX}/pick`) return { kind: 'pick' }
  if (pathname === `${PREFIX}/import-from-link`) return { kind: 'import-from-link' }
  if (!pathname.startsWith(`${PREFIX}/`)) return { kind: 'unknown' }
  const rest = pathname.slice(`${PREFIX}/`.length)
  const draft = rest.match(/^draft-media\/(.+)$/)
  if (draft) return { kind: 'draft-media', id: decodeURIComponent(draft[1]) }
  const mediaItem = rest.match(/^([^/]+)\/media\/([^/]+)$/)
  if (mediaItem) {
    return { kind: 'media-item', id: decodeURIComponent(mediaItem[1]), mediaId: decodeURIComponent(mediaItem[2]) }
  }
  const media = rest.match(/^([^/]+)\/media$/)
  if (media) return { kind: 'media', id: decodeURIComponent(media[1]) }
  if (!rest.includes('/')) return { kind: 'item', id: decodeURIComponent(rest) }
  return { kind: 'unknown' }
}

const PICKER_PROMPTS = Object.freeze({
  file: '选择要挂到产品的文件',
  directory: '选择要挂到产品的文件夹',
})

/**
 * The shared macOS chooser lives in the hub (`nativeFilePicker`); products only
 * supplies its own copy. Missing seam is an explicit 503, never a fake path.
 * @param {((name: string) => unknown) | undefined} getService
 */
function nativePickerFromSeam(getService) {
  return async (kind) => {
    const seam = getService?.('nativeFilePicker')
    if (!seam || typeof seam.pick !== 'function') {
      throw Object.assign(new Error('nativeFilePicker seam is unavailable'), { code: 'picker-unavailable' })
    }
    return seam.pick(kind, { prompt: PICKER_PROMPTS[kind] ?? PICKER_PROMPTS.file })
  }
}

/** @param {unknown} error */
function isPickerCode(error) {
  const code = (/** @type {{ code?: unknown } | null} */ (error))?.code
  return typeof code === 'string' && code.startsWith('picker-')
}

/**
 * @param {{
 *   library: ReturnType<typeof import('./library.js').createLibraryStore>,
 *   ctx?: unknown,
 *   hub?: { headlessSkill?: { run: Function }, pageFetch?: Function, socialData?: Function } | null,
 *   picker?: (kind: 'file' | 'directory', options?: { prompt?: string }) => Promise<{ path: string | null, paths?: string[] }>,
 *   getService?: (name: string) => unknown,
 *   importFromUrl?: (args: { url: unknown, kind?: 'physical' | 'digital', hub?: object | null }) => Promise<object>,
 *   headlessSkill?: { run: Function, cancel?: Function, getJob?: Function, listJobs?: Function },
 * }} deps
 */
export function createProductsDispatcher(deps) {
  const { library } = deps
  const picker = deps.picker ?? nativePickerFromSeam(deps.getService)
  const importFromUrl = deps.importFromUrl ?? importProductFromUrl
  // 草稿媒体只读通路：导入写盘后登记 id → 路径，创建态就能看截图。
  const drafts = deps.draftMedia ?? createDraftMediaRegistry({
    mediaDir: deps.mediaDir ?? mediaDirOf(deps.paths),
  })
  // Hub seams are optional: without a hub the importer still answers from its own
  // page read and the heuristics, and reports the degradation in-band.
  const hub = deps.hub ?? createHubSeams(deps.ctx, {
    headlessSkill: deps.headlessSkill,
  })

  /**
   * @param {{ body?: unknown }} req
   */
  function jsonBodyProblem(req) {
    if (req.body === null) {
      return { status: 400, body: { error: 'invalid-json', message: 'request body is not valid JSON' } }
    }
    if (req.body === undefined || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return { status: 400, body: { error: 'invalid-json', message: 'request body must be a JSON object' } }
    }
    return null
  }

  /**
   * GET /omnimux/products/state?prev=<n>
   * Single revision. Matching prev answers `unchanged: true` with no products.
   */
  function stateRoute(url) {
    const current = library.revision()
    const prevRaw = url.searchParams.get('prev')
    const prev = prevRaw == null || prevRaw === '' ? NaN : Number(prevRaw)
    if (Number.isFinite(prev) && prev === current) {
      return { status: 200, body: { revision: current, unchanged: true } }
    }
    return {
      status: 200,
      body: {
        revision: current,
        unchanged: false,
        products: library.list().map(listViewOf),
      },
    }
  }

  /**
   * @param {{ method: string, url: string, origin?: string, referer?: string, secFetchSite?: string, body?: unknown }} req
   * @returns {Promise<{ status: number, body?: unknown, stream?: unknown }>}
   */
  async function dispatch(req) {
    try {
      const url = new URL(req.url, 'http://127.0.0.1')
      const method = (req.method || 'GET').toUpperCase()
      const parsed = parseProductPath(url.pathname)

      if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
        try {
          assertLocalWrite(req)
        } catch {
          return { status: 403, body: { error: 'not-local', message: 'cross-origin write refused' } }
        }
      }

      if (method === 'GET' && parsed.kind === 'state') {
        return stateRoute(url)
      }

      if (method === 'POST' && parsed.kind === 'pick') {
        const problem = jsonBodyProblem(req)
        if (problem) return problem
        const body = /** @type {{ kind?: string }} */ (req.body)
        const kind = body.kind === 'directory' ? 'directory' : 'file'
        const result = await picker(kind)
        const paths = Array.isArray(result?.paths)
          ? result.paths.filter((row) => typeof row === 'string' && row !== '')
          : (typeof result?.path === 'string' && result.path !== '' ? [result.path] : [])
        return { status: 200, body: { path: paths[0] ?? result?.path ?? null, paths } }
      }

      /**
       * POST /omnimux/products/import-from-link
       * Read a landing page and answer a product draft. Local-only (the write
       * guard above), and the importer re-validates every url it fetches. The
       * vertical scrapes the page itself and borrows the hub only for the model
       * call and the reader: no OmniMux client, no credential.
       */
      if (method === 'POST' && parsed.kind === 'import-from-link') {
        const problem = jsonBodyProblem(req)
        if (problem) return problem
        const body = /** @type {{ url?: unknown, kind?: unknown, model?: unknown, language?: unknown }} */ (req.body)
        if (body.kind !== undefined && !PRODUCT_KINDS.includes(/** @type {'physical' | 'digital'} */ (body.kind))) {
          throw new ProductsError('kind-invalid', `kind must be one of ${PRODUCT_KINDS.join(', ')}`)
        }
        const data = await importFromUrl({
          url: body.url,
          kind: body.kind === 'digital' ? 'digital' : 'physical',
          model: typeof body.model === 'string' ? body.model : undefined,
          language: typeof body.language === 'string' ? body.language : undefined,
          hub,
        })
        // 登记本次携带 id 的媒体行，让创建态在保存前也能取自截图。
        drafts.register(data?.media)
        return { status: 200, body: { success: true, data } }
      }

      if (method === 'GET' && parsed.kind === 'collection') {
        const query = url.searchParams.get('q') || url.searchParams.get('query') || ''
        return {
          status: 200,
          body: {
            revision: library.revision(),
            products: library.list({ query }).map(listViewOf),
          },
        }
      }

      if (method === 'POST' && parsed.kind === 'collection') {
        const problem = jsonBodyProblem(req)
        if (problem) return problem
        const body = /** @type {Record<string, unknown>} */ (req.body)
        const product = library.add(body)
        return { status: 200, body: { product, revision: library.revision() } }
      }

      if (method === 'GET' && parsed.kind === 'media') {
        const product = library.getView(parsed.id)
        if (!product) throw new ProductsError('product-not-found', 'product not found')
        return { status: 200, body: { product, media: product.media } }
      }

      if (method === 'GET' && parsed.kind === 'media-item') {
        const stream = library.resolvePreview(parsed.id, parsed.mediaId)
        return { status: 200, stream }
      }

      /**
       * GET /omnimux/products/draft-media/{mediaId}
       * 只读，无副作用。创建态下产品记录还不存在，走不了 `?preview=`；
       * 这里按登记表解析路径，并且只放行本插件媒体目录内的文件。
       */
      if (method === 'GET' && parsed.kind === 'draft-media') {
        const stream = drafts.resolvePreview(parsed.id)
        if (!stream) throw new ProductsError('draft-media-not-found', 'draft media not found')
        return { status: 200, stream }
      }

      if (method === 'GET' && parsed.kind === 'item') {
        const preview = url.searchParams.get('preview')
        if (preview) {
          const stream = library.resolvePreview(parsed.id, preview)
          return { status: 200, stream }
        }
        // Editing must retain persisted references even when files are currently unavailable.
        const product = url.searchParams.get('view') === 'edit'
          ? library.get(parsed.id)
          : library.getView(parsed.id)
        if (!product) throw new ProductsError('product-not-found', 'product not found')
        return { status: 200, body: { product } }
      }

      if (method === 'PUT' && parsed.kind === 'item') {
        const problem = jsonBodyProblem(req)
        if (problem) return problem
        const body = /** @type {Record<string, unknown>} */ (req.body)
        const product = library.update(parsed.id, body)
        return { status: 200, body: { product, revision: library.revision() } }
      }

      if (method === 'DELETE' && parsed.kind === 'item') {
        library.remove(parsed.id)
        return { status: 200, body: { revision: library.revision() } }
      }

      return { status: 404, body: { error: 'not-found', message: 'unknown route' } }
    } catch (error) {
      if (error instanceof ProductsError || isPickerCode(error) || error instanceof LinkImportError) {
        return {
          status: STATUS_BY_CODE[error.code] ?? 400,
          body: { error: error.code, message: error.message },
        }
      }
      return { status: 500, body: { error: 'internal', message: messageOf(error) } }
    }
  }

  return { dispatch }
}

/**
 * Mount the products prefix on the official webServer seat.
 * @param {{ register: (route: { kind: string, path: string, handler: Function }) => () => void }} webServer
 * @param {{ dispatch: (req: object) => Promise<{ status: number, body?: unknown, stream?: unknown }> }} dispatcher
 * @returns {() => void} disposer
 */
export function registerProductsRoutes(webServer, dispatcher) {
  const dispose = webServer.register({
    kind: 'prefix',
    path: PREFIX,
    auth: 'required',
    async handler(req, res) {
      try {
        const method = (req.method || 'GET').toUpperCase()
        const body = method === 'POST' || method === 'PUT' ? await readJsonBody(req) : undefined
        const result = await dispatcher.dispatch({
          method,
          url: req.url || `${PREFIX}/state`,
          origin: header(req, 'origin'),
          referer: header(req, 'referer'),
          secFetchSite: header(req, 'sec-fetch-site'),
          host: header(req, 'host'),
          secure: Boolean(req.socket?.encrypted),
          body,
        })
        if (result.stream) {
          sendPreview(res, result.status, result.stream)
          return
        }
        sendJson(res, result.status, result.body)
      } catch {
        sendJson(res, 500, { error: 'internal', message: 'internal error' })
      }
    },
  })
  return () => {
    dispose()
  }
}
