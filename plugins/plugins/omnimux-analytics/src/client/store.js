/**
 * Lightweight Zustand-style store for the analytics stage.
 *
 * - 5s in-memory TTL cache keyed by platform/profile/source/timeRange
 * - 300ms debounce on filter patches (search is client-side, still debounced)
 * - `syncNow` incremental scheduler that keeps the last successful snapshot
 *   on network failure (contract §11.1)
 */
import { useCallback, useSyncExternalStore } from 'react'
import { CACHE_TTL_MS, DEFAULT_QUERY, FILTER_DEBOUNCE_MS } from './defaults.js'
import { fetchDashboard, syncNow as requestSync } from './api.js'
import { applyDashboardQuery, cacheKey, patchNeedsFetch } from './query.js'

/**
 * @typedef {{
 *   query: typeof DEFAULT_QUERY,
 *   payload: Record<string, unknown> | null,
 *   snapshot: Record<string, unknown> | null,
 *   phase: 'idle' | 'loading' | 'ready' | 'empty' | 'error',
 *   syncing: boolean,
 *   lastError: string | null,
 *   theme: 'light' | 'dark' | 'system',
 * }} AnalyticsState
 */

/** @type {AnalyticsState} */
const initialState = {
  query: { ...DEFAULT_QUERY },
  payload: null,
  snapshot: null,
  phase: 'idle',
  syncing: false,
  lastError: null,
  theme: 'system',
}

const listeners = new Set()
/** @type {Map<string, { at: number, payload: Record<string, unknown> }>} */
const cache = new Map()

let state = initialState
/** @type {ReturnType<typeof setTimeout> | null} */
let debounceTimer = null
/** @type {number} */
let fetchSeq = 0

function emit() {
  for (const listener of listeners) listener()
}

function setState(patch) {
  state = { ...state, ...patch }
  emit()
}

function subscribe(listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot() {
  return state
}

/**
 * Keep query object identity when field values did not change.
 * Callers that mistakenly put `state.query` in a React effect dependency
 * array must not see a new reference on every refresh (React #185).
 * @param {Partial<typeof DEFAULT_QUERY>} query
 */
function normalizeQuery(query) {
  const next = { ...DEFAULT_QUERY, ...query }
  const cur = state.query
  if (
    cur.tab === next.tab
    && cur.platform === next.platform
    && cur.profileId === next.profileId
    && cur.source === next.source
    && cur.timeRange === next.timeRange
    && cur.searchQuery === next.searchQuery
  ) {
    return cur
  }
  return next
}

/**
 * @param {Record<string, unknown>} payload
 * @param {typeof DEFAULT_QUERY} query
 */
function commitPayload(payload, query) {
  const applied = applyDashboardQuery(payload, query)
  const code = applied.emptyState && applied.emptyState.code
  const empty = code === 'no_accounts' || code === 'unauthorized' || code === 'fetch_failed'
  if (!empty) cache.set(cacheKey(query), { at: Date.now(), payload })
  setState({
    payload: applied,
    snapshot: empty ? state.snapshot : payload,
    phase: empty ? 'empty' : 'ready',
    lastError: payload.syncStatus?.lastError ?? null,
    syncing: Boolean(payload.syncStatus?.syncing),
  })
}

/**
 * @param {Partial<typeof DEFAULT_QUERY>} query
 * @param {{ force?: boolean, now?: number }} [opts]
 */
export async function loadDashboard(query = state.query, opts = {}) {
  const nextQuery = normalizeQuery(query)
  const key = cacheKey(nextQuery)
  const hit = cache.get(key)
  const now = opts.now ?? Date.now()
  if (!opts.force && hit && now - hit.at < CACHE_TTL_MS) {
    commitPayload(hit.payload, nextQuery)
    return hit.payload
  }
  const seq = ++fetchSeq
  if (!state.payload) {
    setState(nextQuery === state.query
      ? { phase: 'loading' }
      : { phase: 'loading', query: nextQuery })
  } else if (nextQuery !== state.query) {
    setState({ query: nextQuery })
  }
  try {
    const payload = await fetchDashboard(nextQuery, { now })
    if (seq !== fetchSeq) return payload
    commitPayload(payload, nextQuery)
    return payload
  } catch (caught) {
    if (seq !== fetchSeq) return state.payload
    const message = caught instanceof Error ? caught.message : String(caught)
    const keep = state.snapshot
    setState({
      phase: keep ? 'ready' : 'error',
      lastError: message,
      payload: keep ? applyDashboardQuery(keep, nextQuery) : state.payload,
    })
    return state.payload
  }
}

/**
 * @param {Partial<typeof DEFAULT_QUERY>} patch
 * @param {{ debounceMs?: number }} [opts]
 */
export function setQuery(patch, opts = {}) {
  const nextQuery = normalizeQuery({ ...state.query, ...patch })
  if (nextQuery !== state.query) setState({ query: nextQuery })
  if (state.snapshot) {
    setState({ payload: applyDashboardQuery(state.snapshot, nextQuery) })
  }
  if (!patchNeedsFetch(patch) && state.snapshot) return
  const delay = opts.debounceMs ?? FILTER_DEBOUNCE_MS
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void loadDashboard(nextQuery)
  }, delay)
}

export function refresh() {
  return loadDashboard(state.query, { force: true })
}

export async function syncNow() {
  const seq = ++fetchSeq
  setState({ syncing: true, lastError: null })
  try {
    const payload = await requestSync(state.query)
    if (seq !== fetchSeq) return payload
    commitPayload(payload, state.query)
    setState({ syncing: false })
    return payload
  } catch (caught) {
    if (seq !== fetchSeq) return state.payload
    const message = caught instanceof Error ? caught.message : String(caught)
    const keep = state.snapshot
    setState({
      syncing: false,
      lastError: message,
      payload: keep ? applyDashboardQuery(keep, state.query) : state.payload,
      phase: keep ? 'ready' : 'error',
    })
    return state.payload
  }
}

/**
 * @param {'light' | 'dark' | 'system'} theme
 */
export function setTheme(theme) {
  setState({ theme })
}

export function resetStore() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  fetchSeq += 1
  cache.clear()
  state = { ...initialState, query: { ...DEFAULT_QUERY } }
  emit()
}

export function getStoreState() {
  return state
}

/**
 * React hook bound to the module store. Filters / chart zoom survive the
 * first-level page being hidden because the store is not unmounted with
 * the overlay (the overlay itself stays mounted after first open).
 */
export function useAnalyticsStore() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const setQueryStable = useCallback((patch, opts) => setQuery(patch, opts), [])
  const refreshStable = useCallback(() => refresh(), [])
  const syncNowStable = useCallback(() => syncNow(), [])
  const loadStable = useCallback((query, opts) => loadDashboard(query, opts), [])
  const setThemeStable = useCallback((theme) => setTheme(theme), [])
  return {
    ...snap,
    setQuery: setQueryStable,
    refresh: refreshStable,
    syncNow: syncNowStable,
    load: loadStable,
    setTheme: setThemeStable,
  }
}

export const analyticsStore = {
  subscribe,
  getSnapshot,
  loadDashboard,
  setQuery,
  refresh,
  syncNow,
  setTheme,
  reset: resetStore,
  cache,
}
