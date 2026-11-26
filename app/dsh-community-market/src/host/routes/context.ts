/** What the market's route groups share within one registration, and the services the embedding Desktop provides. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { MarketCatalogResponse } from '../../api-types.js'
import type { CatalogFetchScope, CatalogFullIndex, DefaultCatalogService } from '../../catalog/service.js'
import type { MarketStateStore } from '../../catalog/state-store.js'
import type { MarketInstallService } from '../../install/service.js'
import type { MarketMediaService } from '../../media/types.js'
import { sendJson } from '../http.js'
import { connectionRejection } from '../request-authority.js'
import type { createMarketSourceMutator } from '../source-mutations.js'

export interface MarketInstallServiceProvider {
  get(): MarketInstallService | undefined
}

export interface MarketDesktopActions {
  openTerminal?(): void
}

export interface MarketDesktopActionsProvider {
  get(): MarketDesktopActions | undefined
}

/** One registration of the market routes: its services, its lifetime and the catalog response it builds. */
export interface MarketRouteContext {
  readonly ctx: Context
  readonly state: MarketStateStore
  /** The Web server port that requests must name; undefined before it listens. */
  readonly expectedPort: number | undefined
  /** Aborted when this registration is disposed; every request in flight observes it. */
  readonly generationController: AbortController
  readonly media: MarketMediaService
  readonly service: DefaultCatalogService
  /** Catalog previews already answered from the persisted cache, keyed by `catalogPreviewKey`. */
  readonly servedCatalogPreviews: Set<string>
  readonly catalogPreviewKey: (sourceRecordId: string, locale: string) => string
  readonly mutateSource: ReturnType<typeof createMarketSourceMutator>
  readonly buildCatalogResponse: (
    index: CatalogFullIndex | undefined,
    query: Record<string, unknown>,
    fetchScope: CatalogFetchScope | undefined,
  ) => MarketCatalogResponse
  readonly persistCatalogResponse: (response: MarketCatalogResponse, sourceRecordId: string, locale: string) => Promise<void>
  readonly desktopActionsProvider: MarketDesktopActionsProvider | undefined
}

type AuthenticatedMarketRoute = WebRoute & { readonly auth: 'required' }
type PeerAwareHandler = (req: IncomingMessage, res: ServerResponse, peer?: unknown) => void | Promise<void>

/** Register an exact Community Market route with both route-level auth metadata and in-handler Host session checks. */
export function registerAuthenticatedMarketRoute(
  ctx: Context,
  path: string,
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
): () => void {
  const guarded: PeerAwareHandler = async (req, res, peer) => {
    const rejection = connectionRejection(ctx as { get?(name: string): unknown }, req, peer)
    if (rejection !== undefined) {
      sendJson(res, rejection, { error: 'market request authentication required' })
      return
    }
    await handler(req, res)
  }
  const route: AuthenticatedMarketRoute = {
    kind: 'exact',
    path,
    auth: 'required',
    handler: guarded as WebRoute['handler'],
  }
  return ctx.webServer.register(route)
}
