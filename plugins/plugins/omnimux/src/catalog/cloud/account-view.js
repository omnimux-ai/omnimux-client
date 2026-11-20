import { createHash } from 'node:crypto'
import { createLiveCatalog } from './live.js'
import { createCatalogRefresher } from './refresh.js'
import { resolvePricingUrl } from './config.js'

/** Keep public and member prices in distinct views, including during an in-flight refresh. */
export function createAccountCatalog(deps) {
  const canonicalUrl = resolvePricingUrl({}, deps.siteBaseUrl)
  const canAuthenticate = deps.remote && deps.url === canonicalUrl && canonicalUrl.startsWith('https://')
  let active

  function accountId() {
    if (!canAuthenticate) return ''
    const identity = deps.identity.getSnapshot()
    return identity.logged_in && identity.id != null ? String(identity.id) : ''
  }

  function current() {
    const id = accountId()
    if (active?.id === id) return active
    const changed = Boolean(active)
    const viewKey = id ? `member-${createHash('sha256').update(`${canonicalUrl}\n${id}`).digest('hex')}` : undefined
    const live = createLiveCatalog({ home: deps.home, bundledDir: deps.bundledDir, viewKey })
    const buildView = (denied = false) => {
      const view = live.resolve()
      return {
        ...view,
        ...(denied ? {
          stale: true,
          digest: null,
          snapshot: view.snapshot && { ...view.snapshot, models: [], groups: { ratio: {}, usable: {}, auto: [] } },
        } : {}),
        ...(viewKey ? { accountViewKey: viewKey } : {}),
        ...(id && deps.resolveCatalogKey ? {
          resolveGenerationKey: (request) => deps.resolveCatalogKey({ ...request, accountId: id }),
        } : {}),
      }
    }
    const denied = Boolean(id) && live.store.read()?.meta?.staleReason === 'access-denied'
    const entry = { id, view: buildView(denied), denied, refresher: null }
    active = entry
    const isCurrent = () => active === entry && accountId() === id
    entry.refresher = createCatalogRefresher({
      live,
      url: deps.url,
      ttlSeconds: deps.ttlSeconds,
      timeoutMs: deps.timeoutMs,
      origin: deps.siteBaseUrl,
      fetchImpl: deps.fetchImpl,
      isCurrent,
      accountScoped: Boolean(id),
      authorizationHeaders: id ? async () => {
        const token = await deps.store.resolve()
        if (!token || !isCurrent()) throw new Error('catalog account changed')
        return { Authorization: `Bearer ${token}`, 'New-Api-User': id }
      } : undefined,
      onDenied: () => {
        if (entry.denied) return
        entry.denied = true
        entry.view = buildView(true)
        deps.onChanged?.()
      },
      onChanged: () => {
        entry.denied = false
        entry.view = buildView()
        deps.onChanged?.()
      },
      onUnchanged: () => {
        const wasDenied = entry.denied
        entry.denied = false
        entry.view = buildView()
        if (wasDenied) deps.onChanged?.()
      },
    })
    if (changed && deps.remote) {
      queueMicrotask(() => {
        if (!isCurrent()) return
        deps.onChanged?.()
        entry.refresher.refreshOnce(true).catch(deps.onError)
      })
    }
    return entry
  }

  return {
    resolve: () => current().view,
    isAccountScoped: () => Boolean(current().id),
    diagnosticsView: () => current().view,
    state: () => current().refresher.state(),
    refreshOnce: (force) => current().refresher.refreshOnce(force),
    maybeRefresh: () => current().refresher.maybeRefresh(),
  }
}
