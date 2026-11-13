import { jsonRequest } from './api-json.js'

const APP_KEYS = [
  'schema', 'source', 'stale', 'fetched_at', 'refresh', 'error', 'apps',
]

const APP_ROW_KEYS = [
  'id', 'title', 'summary', 'kind', 'capabilities', 'client', 'spec', 'state', 'install_spec',
]

/**
 * @param {unknown} raw
 */
export function pickAppsView(raw) {
  const row = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const key of APP_KEYS) {
    if (key in row) out[key] = row[key]
  }
  if (Array.isArray(out.apps)) {
    out.apps = out.apps.map((item) => {
      const app = item && typeof item === 'object' ? /** @type {Record<string, unknown>} */ (item) : {}
      /** @type {Record<string, unknown>} */
      const next = {}
      for (const key of APP_ROW_KEYS) {
        if (key in app) next[key] = app[key]
      }
      return next
    })
  }
  return out
}

/**
 * @param {string} path
 * @param {{ method?: string }} [opts]
 */
export function appsRequest(path, opts = {}) {
  return jsonRequest(path, {
    ...opts,
    pick: pickAppsView,
    requireJson: true,
    notMounted: 'apps routes not mounted',
  })
}

export function getApps() {
  return appsRequest('/omnimux/apps')
}

export function refreshApps() {
  return appsRequest('/omnimux/apps/refresh', { method: 'POST' })
}

const TABS_KEYS = [
  'schema', 'tabs', 'error',
]

const TAB_ROW_KEYS = [
  'id', 'title', 'pinned', 'lastOpenedAt',
]

/**
 * Whitelist picker for the tabs view. Response parsing drops unknown keys.
 * @param {unknown} raw
 */
export function pickTabsView(raw) {
  const row = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const key of TABS_KEYS) {
    if (key in row) out[key] = row[key]
  }
  if (Array.isArray(out.tabs)) {
    out.tabs = out.tabs.map((item) => {
      const tab = item && typeof item === 'object' ? /** @type {Record<string, unknown>} */ (item) : {}
      /** @type {Record<string, unknown>} */
      const next = {}
      for (const key of TAB_ROW_KEYS) {
        if (key in tab) next[key] = tab[key]
      }
      return next
    })
  }
  return out
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [opts]
 */
export function tabsRequest(path, opts = {}) {
  return jsonRequest(path, { ...opts, pick: pickTabsView })
}

export function getAppTabs() {
  return tabsRequest('/omnimux/apps/tabs')
}

/**
 * @param {string} id
 */
export function upsertAppTab(id) {
  return tabsRequest(`/omnimux/apps/tabs/${encodeURIComponent(id)}`, { method: 'POST' })
}

/**
 * @param {string} id
 * @param {{ pinned?: boolean, order?: 'top' }} body
 */
export function patchAppTab(id, body) {
  return tabsRequest(`/omnimux/apps/tabs/${encodeURIComponent(id)}`, { method: 'PATCH', body })
}

/**
 * @param {string} id
 */
export function removeAppTab(id) {
  return tabsRequest(`/omnimux/apps/tabs/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/**
 * @param {string} spec
 */
export function installApp(spec) {
  return jsonRequest('/omnimux/plugins', { method: 'POST', body: { spec } })
}

/**
 * @param {string} name
 */
export function uninstallApp(name) {
  return jsonRequest(`/omnimux/plugins/${encodeURIComponent(name)}`, { method: 'DELETE' })
}
