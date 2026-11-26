/** Keep upstream HTTP routing while requiring Host credentials for Market routes. */
import { hostLog, hostOperation } from './host/logging.ts'
import type { IncomingHttpHeaders } from 'node:http'
import WebServer, { type WebRoute, type WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import { expireSurplusSessions, surplusSessionExpiries } from './browser-sessions.ts'
import { decideDesktopBrowserAccess, nextBrowserAccess } from './desktop-browser-access.ts'
import { wrapFallback, wrapRegistration, type ResponderWrappers, type WebFallback, type WebRegistration } from './upstream-family.ts'
import type { Duplex } from 'node:stream'

const MARKET_ROUTE = '/api/community-market'
const isMarketRoute = (path: string): boolean => path === MARKET_ROUTE || path.startsWith(`${MARKET_ROUTE}/`)

type RouteAuthMode = 'anonymous' | 'required' | 'deny'

function routeAuthMode(route: object): RouteAuthMode | undefined {
  const auth = (route as { readonly auth?: unknown }).auth
  if (auth === undefined) return undefined
  return auth === 'anonymous' || auth === 'required' || auth === 'deny' ? auth : 'deny'
}

function upgradeRejectionResponse(status: number): string {
  const reason = status === 401 ? 'Unauthorized' : status === 503 ? 'Service Unavailable' : 'Forbidden'
  return `HTTP/1.1 ${String(status)} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
}

export default class NextWebServer extends WebServer {
  static override Config = WebServer.Config
  private readonly browserSockets = new Set<Duplex>()

  /** Revoke existing browser streams as well as new requests; native streams stay alive. */
  setBrowserAccess(enabled: boolean): void {
    const access = nextBrowserAccess()
    if (!access) throw new Error('Native browser-access policy is unavailable')
    access.setOrdinaryBrowserEnabled(enabled)
    if (!enabled) {
      for (const socket of this.browserSockets) socket.destroy()
      this.browserSockets.clear()
    }
  }

  private permits(request: Parameters<WebRoute['handler']>[0]): boolean {
    const access = nextBrowserAccess()
    return !access || decideDesktopBrowserAccess(access, request) !== 'denied'
  }

  /** The same decision for a Fetch request, which carries the client's headers but no socket. */
  private permitsFetch(request: Request): boolean {
    const access = nextBrowserAccess()
    return !access || decideDesktopBrowserAccess(access, { headers: Object.fromEntries(request.headers), url: request.url }) !== 'denied'
  }

  private authRejection(request: { readonly headers: IncomingHttpHeaders }): number | undefined {
    try {
      const connection = this.ctx.get('connection')
      if (typeof connection?.requestRejection !== 'function') return 503
      const rejection = connection.requestRejection(request)
      if (rejection === undefined) return undefined
      return Number.isInteger(rejection) && rejection >= 400 && rejection <= 599 ? rejection : 403
    } catch {
      return 503
    }
  }

  override register(route: WebRegistration): () => void {
    return super.register(wrapRegistration(route, this.policy(route.path, routeAuthMode(route))))
  }

  override registerFallback(fallback: WebFallback): () => void {
    return super.registerFallback(wrapFallback(fallback, this.policy('fallback')))
  }

  private policy(route: string, auth?: RouteAuthMode): ResponderWrappers {
    const market = isMarketRoute(route)
    const requiresAuth = market || auth === 'required'
    return {
      handler: inner => this.observeHttp(route, async (request, response) => {
        if (!this.permits(request)) { response.writeHead(403, { 'cache-control': 'no-store' }); response.end('Browser access is disabled'); return }
        // A token exchange's own writeHead replaces these; the request its redirect causes expires them instead.
        const expiries = surplusSessionExpiries(request.headers.cookie, request.headers.host)
        if (expiries.length > 0) response.setHeader('set-cookie', expiries)
        if (auth === 'deny') {
          response.writeHead(403, { 'cache-control': 'no-store' })
          response.end('Route access denied')
          return
        }
        if (!requiresAuth) {
          await inner(request, response); return
        }
        const rejection = this.authRejection(request)
        if (rejection !== undefined) {
          response.writeHead(rejection, { 'cache-control': 'no-store' })
          response.end(market ? 'Market request authentication required' : 'Request authentication required')
          return
        }
        await inner(request, response)
      }),
      resource: (inner) => {
        // Market credentials are checked on the request socket, which only a handler sees.
        if (market) throw new Error(`Market route ${route} must be a handler`)
        return async (request, peer) => {
          const end = hostOperation('host.http', 'request', { route, method: request.method }, true)
          try {
            // An HTTP request arrives without a Peer; an in-process read was admitted by its caller.
            if (peer === undefined && !this.permitsFetch(request)) {
              end(undefined, { status: 403 })
              return new Response('Browser access is disabled', { status: 403, headers: { 'cache-control': 'no-store' } })
            }
            if (peer === undefined && auth === 'deny') {
              end(undefined, { status: 403 })
              return new Response('Route access denied', { status: 403, headers: { 'cache-control': 'no-store' } })
            }
            if (peer === undefined && auth === 'required') {
              const rejection = this.authRejection({ headers: Object.fromEntries(request.headers) })
              if (rejection !== undefined) {
                end(undefined, { status: rejection })
                return new Response('Request authentication required', { status: rejection, headers: { 'cache-control': 'no-store' } })
              }
            }
            const response = await inner(request, peer)
            end(undefined, { status: response.status })
            return peer === undefined ? expireSurplusSessions(request, response) : response
          } catch (error) { end(error); throw error }
        }
      },
    }
  }

  private observeHttp(route: string, handler: WebRoute['handler']): WebRoute['handler'] {
    return async (request, response) => {
      const end = hostOperation('host.http', 'request', { route, method: request.method ?? '' }, true)
      const finish = () => { end(undefined, { status: response.statusCode, aborted: !response.writableFinished }); response.off('finish', finish); response.off('close', finish) }
      response.once('finish', finish); response.once('close', finish)
      try { await handler(request, response) } catch (error) { response.off('finish', finish); response.off('close', finish); end(error); throw error }
    }
  }

  override registerUpgrade(route: WebUpgradeRoute): () => void {
    const auth = routeAuthMode(route)
    return super.registerUpgrade({ ...route, handler: (request, socket, head) => {
      hostLog({ source: 'host.http', event: 'upgrade', fields: { route: route.path }, developer: true })
      if (!this.permits(request)) { socket.end(upgradeRejectionResponse(403)); return }
      if (auth === 'deny') { socket.end(upgradeRejectionResponse(403)); return }
      if (auth === 'required') {
        const rejection = this.authRejection(request)
        if (rejection !== undefined) { socket.end(upgradeRejectionResponse(rejection)); return }
      }
      const access = nextBrowserAccess()
      if (access && decideDesktopBrowserAccess(access, request) === 'browser') {
        this.browserSockets.add(socket)
        socket.once('close', () => this.browserSockets.delete(socket))
      }
      return route.handler(request, socket, head)
    } })
  }
}
