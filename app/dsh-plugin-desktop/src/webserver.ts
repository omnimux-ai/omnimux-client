/** Desktop-owned WebServer wrapper with bounded bind-conflict retry. */

import { diagnosticOperation } from './developer-logging.ts'
import type { IncomingHttpHeaders, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import WebServer, {
  type Config,
  type WebRoute,
  type WebUpgradeRoute,
} from '@deepseek-ai/dsh-host-webserver'
import { decideDesktopBrowserAccess } from './desktop-browser-access.ts'
import { DESKTOP_WEB_PORT_RETRY_LIMIT } from './desktop-port.ts'

const MARKET_ROUTE = '/api/community-market'
const isMarketRoute = (path: string): boolean => path === MARKET_ROUTE || path.startsWith(`${MARKET_ROUTE}/`)

type RouteAuthMode = 'anonymous' | 'required' | 'deny'

function routeAuthMode(route: object): RouteAuthMode | undefined {
  const auth = (route as { readonly auth?: unknown }).auth
  return auth === 'anonymous' || auth === 'required' || auth === 'deny' ? auth : undefined
}

/**
 * Bind failures that mean "this port is unavailable", not "binding is broken".
 * Windows reports ports inside Hyper-V/WinNAT excluded ranges as `EACCES` even
 * though no process owns them (`netsh interface ipv4 show excludedportrange`).
 */
function isPortUnavailable(cause: unknown): boolean {
  const code = (cause as NodeJS.ErrnoException | null)?.code
  return code === 'EADDRINUSE' || code === 'EACCES'
}

/** Close an unbound server left behind by a failed listen attempt. */
function closeFailedServer(instance: unknown): void {
  const server = (instance as { server?: { close?: (callback?: (error?: Error) => void) => void } } | null)?.server
  if (typeof server?.close !== 'function') return
  try {
    server.close(() => {})
  } catch {
    // The failed server is already unbound; preserve the original bind error.
  }
}

function rejectStatusRequest(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(body)
}

function rejectStatusUpgrade(socket: Duplex, status: number, body: string): void {
  const reason = status === 401 ? 'Unauthorized' : status === 503 ? 'Service Unavailable' : 'Forbidden'
  socket.end([
    `HTTP/1.1 ${String(status)} ${reason}`,
    'Connection: close',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Length: ${String(Buffer.byteLength(body))}`,
    '',
    body,
  ].join('\r\n'))
}

function rejectBrowserRequest(res: ServerResponse): void {
  rejectStatusRequest(res, 403, 'forbidden')
}

function rejectBrowserUpgrade(socket: Duplex): void {
  rejectStatusUpgrade(socket, 403, 'forbidden')
}

/** Reuse the upstream WebServer while retrying only real bind collisions. */
export class DesktopWebServer extends WebServer {
  static override Config = WebServer.Config

  private readonly desktopConfig: Config

  constructor(ctx: ConstructorParameters<typeof WebServer>[0], config: Config) {
    if (config.host !== '127.0.0.1') {
      throw new Error('dsh-plugin-desktop: Desktop WebServer requires loopback until LAN HTTPS is available')
    }
    super(ctx, config)
    this.desktopConfig = config
  }

  private permits(request: Parameters<WebRoute['handler']>[0]): boolean {
    const access = this.ctx.get('desktopBrowserAccess')
    // The Desktop-owned server remains usable in an ordinary `dsh` launch,
    // where the Electron launcher capability is intentionally absent.
    return access === undefined || decideDesktopBrowserAccess(access, request) !== 'denied'
  }

  private traceHttp(route: string, handler: WebRoute['handler']): WebRoute['handler'] {
    return async (req, res) => {
      const end = diagnosticOperation('host.http', 'request', { route, method: req.method })
      const finish = () => { cleanup(); end(undefined, { status: res.statusCode, aborted: !res.writableFinished }) }
      const cleanup = () => { res.removeListener('finish', finish); res.removeListener('close', finish) }
      res.once('finish', finish)
      res.once('close', finish)
      try { await handler(req, res) } catch (error) { cleanup(); end(error); throw error }
    }
  }

  private authRejection(request: { readonly headers: IncomingHttpHeaders }): number | undefined {
    const connection = this.ctx.get('connection')
    return connection === undefined ? 503 : connection.requestRejection(request)
  }

  override register(route: WebRoute): () => void {
    const auth = routeAuthMode(route)
    const market = isMarketRoute(route.path)
    const requiresAuth = market || auth === 'required'
    return super.register({
      ...route,
      handler: this.traceHttp(String(route.path), async (req, res) => {
        if (!this.permits(req)) return rejectBrowserRequest(res)
        if (auth === 'deny') return rejectStatusRequest(res, 403, 'forbidden')
        if (requiresAuth) {
          const rejection = this.authRejection(req)
          if (rejection !== undefined) {
            return rejectStatusRequest(res, rejection, market ? 'Market request authentication required' : 'Request authentication required')
          }
        }
        await route.handler(req, res)
      }),
    })
  }

  override registerFallback(handler: WebRoute['handler']): () => void {
    return super.registerFallback(this.traceHttp('fallback', async (req, res) => {
      if (!this.permits(req)) return rejectBrowserRequest(res)
      await handler(req, res)
    }))
  }

  override registerUpgrade(route: WebUpgradeRoute): () => void {
    const auth = routeAuthMode(route)
    return super.registerUpgrade({
      ...route,
      handler: (req, socket, head) => {
        if (!this.permits(req)) return rejectBrowserUpgrade(socket)
        if (auth === 'deny') return rejectStatusUpgrade(socket, 403, 'forbidden')
        if (auth === 'required') {
          const rejection = this.authRejection(req)
          if (rejection !== undefined) return rejectStatusUpgrade(socket, rejection, 'authentication required')
        }
        return route.handler(req, socket, head)
      },
    })
  }

  override async [Service.init](): Promise<void> {
    const requestedPort = this.desktopConfig.port
    if (requestedPort === 0) {
      await super[Service.init]()
      return
    }
    for (let attempt = 0; ; attempt += 1) {
      try {
        await super[Service.init]()
        return
      } catch (cause) {
        if (!isPortUnavailable(cause)) throw cause
        closeFailedServer(this)
        const nextPort = requestedPort + attempt + 1
        if (attempt >= DESKTOP_WEB_PORT_RETRY_LIMIT || nextPort > 65_535) {
          // A Windows excluded range is usually wider than the sequential
          // window, so finish with one OS-assigned port instead of failing
          // startup; Electron reads the bound port from the Host either way.
          this.desktopConfig.port = 0
          await super[Service.init]()
          return
        }
        this.desktopConfig.port = nextPort
      }
    }
  }
}

export default DesktopWebServer
