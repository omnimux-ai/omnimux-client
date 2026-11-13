/** In-process Apps catalog: resolve bundled/cache/memory and refresh remotely. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createAppsCache, isRefreshDue } from './cache.js'
import { resolveCatalogUrl } from './config.js'
import { fetchRemoteCatalog } from './fetch.js'
import { loadBundledCatalog, parseCatalog } from './parse.js'
import { resolveCatalog } from './resolve.js'
import { buildInstalledAppsView } from './view.js'

/**
 * @param {{
 *   home: string,
 *   profile: string,
 *   env?: NodeJS.ProcessEnv,
 *   apps: { remote: boolean, catalogUrl: string, ttlSeconds: number, timeoutMs: number },
 *   siteBaseUrl: string,
 *   hubVersion?: string,
 *   loadBundled?: typeof loadBundledCatalog,
 *   fetcher?: typeof fetch,
 *   now?: () => number,
 * }} deps
 */
export function createAppsStore(deps) {
  const cache = createAppsCache(deps.home)
  const loadBundled = deps.loadBundled ?? loadBundledCatalog
  const now = deps.now ?? Date.now
  const hubVersion = deps.hubVersion ?? readHubVersion()
  const siteHost = new URL(deps.siteBaseUrl).host
  let memory
  let memorySourceUrl
  let refresh = 'idle'
  let error = null
  let inFlight

  function snapshot() {
    const bundled = loadBundled()
    const disk = cache.readCatalog()
    const chosen = resolveCatalog({
      bundled,
      disk,
      memory,
      hubVersion,
    })
    if (chosen.drop.some((item) => item.kind === 'disk' && item.reason === 'older_than_bundled')) {
      cache.clearCatalog()
    }
    if (chosen.drop.some((item) => item.kind === 'memory')) memory = undefined
    const meta = cache.readMeta()
    const due = deps.apps.remote && isRefreshDue(meta, deps.apps.ttlSeconds, now())
    return {
      catalog: chosen.catalog,
      source: chosen.source,
      stale: due || refresh === 'running',
      fetched_at: typeof meta?.fetched_at === 'string' ? meta.fetched_at : null,
      refresh,
      error,
      due,
    }
  }

  function view() {
    const snap = snapshot()
    return buildInstalledAppsView({
      catalog: snap.catalog,
      home: deps.home,
      profile: deps.profile,
      env: deps.env,
      source: snap.source,
      stale: snap.stale,
      fetched_at: snap.fetched_at,
      refresh: snap.refresh,
      error: snap.error,
    })
  }

  async function refreshOnce(force = false) {
    if (!deps.apps.remote) return view()
    if (inFlight) return inFlight
    const snap = snapshot()
    if (!force && !snap.due) return view()
    refresh = 'running'
    inFlight = (async () => {
      const meta = cache.readMeta() ?? {}
      const fetched = await fetchRemoteCatalog({
        url: resolveCatalogUrl(deps.apps, deps.siteBaseUrl),
        siteHost,
        timeoutMs: deps.apps.timeoutMs,
        etag: typeof meta.etag === 'string' ? meta.etag : null,
        lastModified: typeof meta.last_modified === 'string' ? meta.last_modified : null,
        fetcher: deps.fetcher,
        now,
      })
      const fetchedAt = new Date(now()).toISOString()
      if (fetched.kind === 'not_modified') {
        cache.writeMeta({
          ...meta,
          source_url: resolveCatalogUrl(deps.apps, deps.siteBaseUrl),
          fetched_at: fetchedAt,
          status: 'not_modified',
          last_error: null,
        })
        refresh = 'idle'
        error = null
        return view()
      }
      if (fetched.kind === 'network' || fetched.kind === 'invalid') {
        cache.writeMeta({
          ...meta,
          source_url: resolveCatalogUrl(deps.apps, deps.siteBaseUrl),
          fetched_at: fetchedAt,
          status: fetched.kind,
          last_error: fetched.error,
        })
        refresh = 'failed'
        error = fetched.error
        return view()
      }
      try {
        const parsed = parseCatalog(fetched.raw)
        memory = parsed
        memorySourceUrl = resolveCatalogUrl(deps.apps, deps.siteBaseUrl)
        const chosen = resolveCatalog({ bundled: loadBundled(), disk: cache.readCatalog(), memory, hubVersion })
        if (chosen.source !== 'remote' && chosen.drop.some((item) => item.kind === 'memory')) {
          memory = undefined
          cache.writeMeta({
            ...meta,
            source_url: memorySourceUrl,
            fetched_at: fetchedAt,
            status: 'invalid',
            last_error: 'remote catalog rejected',
            etag: fetched.etag,
            last_modified: fetched.lastModified,
          })
          refresh = 'failed'
          error = 'remote catalog rejected'
          return view()
        }
        cache.writeCatalog(fetched.raw, {
          source_url: memorySourceUrl,
          etag: fetched.etag,
          last_modified: fetched.lastModified,
          fetched_at: fetchedAt,
          status: 'ok',
          last_error: null,
        })
        refresh = 'idle'
        error = null
        return view()
      } catch (caught) {
        cache.writeMeta({
          ...meta,
          source_url: resolveCatalogUrl(deps.apps, deps.siteBaseUrl),
          fetched_at: fetchedAt,
          status: 'invalid',
          last_error: caught instanceof Error ? caught.message : String(caught),
          etag: fetched.etag,
          last_modified: fetched.lastModified,
        })
        refresh = 'failed'
        error = caught instanceof Error ? caught.message : String(caught)
        return view()
      }
    })()
    try {
      return await inFlight
    } finally {
      inFlight = undefined
    }
  }

  function maybeRefresh() {
    if (!deps.apps.remote) return
    const snap = snapshot()
    if (snap.due && !inFlight) void refreshOnce(false)
  }

  function dispose() {
    memory = undefined
    refresh = 'idle'
    error = null
    inFlight = undefined
  }

  return { view, refreshOnce, maybeRefresh, snapshot, dispose }
}

function readHubVersion() {
  try {
    const raw = readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')
    const version = JSON.parse(raw).version
    return typeof version === 'string' ? version : '0.1.0'
  } catch {
    return '0.1.0'
  }
}
