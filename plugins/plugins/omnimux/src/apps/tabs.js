/**
 * Host-side sidebar tab records for opened Apps. Stored at
 * `$DSH_HOME/omnimux/apps/tabs.json` next to the catalog cache (mode 0600,
 * directory 0700). All fields are browser-safe; no secrets.
 *
 * Sorting (computed here, served sorted): pinned group first (key
 * `toppedAt ?? pinnedAt ?? lastOpenedAt`, descending), then the non-pinned
 * group (key `toppedAt ?? lastOpenedAt`, descending).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const TABS_SCHEMA = 1
export const MAX_TABS = 64

const TAB_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/
const TAB_FIELDS = Object.freeze(['id', 'pinned', 'pinnedAt', 'toppedAt', 'lastOpenedAt'])
const EMPTY = () => ({ schema: TABS_SCHEMA, tabs: [] })

/**
 * @param {string} id
 */
export function isValidTabId(id) {
  return typeof id === 'string' && id.length >= 2 && id.length <= 64 && TAB_ID.test(id)
}

/**
 * @param {unknown} value
 */
function isoOrNull(value) {
  if (value === null) return true
  return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value))
}

/**
 * Parse and validate a tabs document. Any rule violation rejects the whole
 * file (unknown fields, wrong types, more than MAX_TABS rows); a bad or
 * missing file is treated as an empty table and rebuilt on the next write.
 * @param {string} raw
 * @returns {{ schema: 1, tabs: Array<{ id: string, pinned: boolean, pinnedAt: string | null, toppedAt: string | null, lastOpenedAt: string }> }}
 */
export function parseTabs(raw) {
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    return EMPTY()
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return EMPTY()
  const row = /** @type {Record<string, unknown>} */ (body)
  if (row.schema !== TABS_SCHEMA) return EMPTY()
  if (!Array.isArray(row.tabs)) return EMPTY()
  if (row.tabs.length > MAX_TABS) return EMPTY()
  const extra = Object.keys(row).filter((key) => key !== 'schema' && key !== 'tabs')
  if (extra.length > 0) return EMPTY()
  const seen = new Set()
  /** @type {Array<{ id: string, pinned: boolean, pinnedAt: string | null, toppedAt: string | null, lastOpenedAt: string }>} */
  const tabs = []
  for (const item of row.tabs) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return EMPTY()
    const tab = /** @type {Record<string, unknown>} */ (item)
    const keys = Object.keys(tab)
    if (keys.length !== TAB_FIELDS.length || !TAB_FIELDS.every((field) => keys.includes(field))) return EMPTY()
    if (!isValidTabId(tab.id) || seen.has(tab.id)) return EMPTY()
    if (typeof tab.pinned !== 'boolean') return EMPTY()
    if (!isoOrNull(tab.pinnedAt) || !isoOrNull(tab.toppedAt)) return EMPTY()
    if (typeof tab.lastOpenedAt !== 'string' || tab.lastOpenedAt === '' || Number.isNaN(Date.parse(tab.lastOpenedAt))) return EMPTY()
    seen.add(tab.id)
    tabs.push({
      id: tab.id,
      pinned: tab.pinned,
      pinnedAt: tab.pinnedAt === null ? null : String(tab.pinnedAt),
      toppedAt: tab.toppedAt === null ? null : String(tab.toppedAt),
      lastOpenedAt: String(tab.lastOpenedAt),
    })
  }
  return { schema: TABS_SCHEMA, tabs }
}

/**
 * @param {string | null} value
 */
function timeOf(value) {
  if (typeof value !== 'string') return 0
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * @param {{ pinned: boolean, toppedAt: string | null, pinnedAt: string | null, lastOpenedAt: string }} tab
 */
function sortTime(tab) {
  if (tab.pinned) return timeOf(tab.toppedAt ?? tab.pinnedAt ?? tab.lastOpenedAt)
  return timeOf(tab.toppedAt ?? tab.lastOpenedAt)
}

/**
 * @param {{ pinned: boolean, toppedAt: string | null, pinnedAt: string | null, lastOpenedAt: string }} a
 * @param {{ pinned: boolean, toppedAt: string | null, pinnedAt: string | null, lastOpenedAt: string }} b
 */
function compareTabs(a, b) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  return sortTime(b) - sortTime(a)
}

/**
 * @param {Array<{ id: string, pinned: boolean, pinnedAt: string | null, toppedAt: string | null, lastOpenedAt: string }>} tabs
 */
function sorted(tabs) {
  return [...tabs].sort(compareTabs)
}

/**
 * @param {{
 *   home: string,
 *   now?: () => number,
 * }} deps
 */
export function createTabsStore(deps) {
  const dir = join(deps.home, 'omnimux', 'apps')
  const path = join(dir, 'tabs.json')
  const now = deps.now ?? Date.now
  const stamp = () => new Date(now()).toISOString()

  function read() {
    try {
      return parseTabs(readFileSync(path, 'utf8'))
    } catch {
      return EMPTY()
    }
  }

  /**
   * @param {Array<{ id: string, pinned: boolean, pinnedAt: string | null, toppedAt: string | null, lastOpenedAt: string }>} tabs
   */
  function write(tabs) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(path, `${JSON.stringify({ schema: TABS_SCHEMA, tabs: sorted(tabs) }, undefined, 2)}\n`, { mode: 0o600 })
  }

  /**
   * Full sorted table (all rows, every field). No filtering.
   */
  function list() {
    return { schema: TABS_SCHEMA, tabs: sorted(read().tabs) }
  }

  /**
   * Browser-safe view: only rows whose app is installed (or one update
   * away), with the catalog title attached. Data for hidden rows is kept on
   * disk so a re-publish restores the tab.
   * @param {{ apps?: Array<{ id: string, title: string, state: string }> }} [opts]
   */
  function view(opts = {}) {
    const apps = Array.isArray(opts.apps) ? opts.apps : []
    const byId = new Map(apps.map((app) => [app.id, app]))
    const tabs = []
    for (const tab of list().tabs) {
      const app = byId.get(tab.id)
      if (!app || (app.state !== 'installed' && app.state !== 'update')) continue
      tabs.push({ id: tab.id, title: app.title, pinned: tab.pinned, lastOpenedAt: tab.lastOpenedAt })
    }
    return { schema: TABS_SCHEMA, tabs }
  }

  /**
   * Record an open: refresh lastOpenedAt, clear the one-shot toppedAt, and
   * create the row on first open. Evicts the least-recent non-pinned row
   * (then the last row) past MAX_TABS.
   * @param {string} id
   */
  function upsert(id) {
    const doc = read()
    const tabs = sorted(doc.tabs.filter((tab) => tab.id !== id))
    tabs.unshift({ id, pinned: false, pinnedAt: null, toppedAt: null, lastOpenedAt: stamp() })
    while (tabs.length > MAX_TABS) {
      let index = tabs.map((tab) => tab.pinned).lastIndexOf(false)
      if (index === -1) index = tabs.length - 1
      tabs.splice(index, 1)
    }
    write(tabs)
    return list()
  }

  /**
   * @param {string} id
   * @param {{ pinned?: boolean, order?: 'top' }} change
   * @returns {{ schema: 1, tabs: Array<object> } | null} null when no row matches the id
   */
  function patch(id, change) {
    const doc = read()
    const index = doc.tabs.findIndex((tab) => tab.id === id)
    if (index === -1) return null
    const tab = { ...doc.tabs[index] }
    if (change && typeof change.pinned === 'boolean') {
      tab.pinned = change.pinned
      tab.pinnedAt = change.pinned ? stamp() : null
    } else if (change && change.order === 'top') {
      tab.toppedAt = stamp()
    }
    doc.tabs[index] = tab
    write(doc.tabs)
    return list()
  }

  /**
   * @param {string} id
   * @returns {{ schema: 1, tabs: Array<object> } | null} null when no row matched
   */
  function remove(id) {
    const doc = read()
    const next = doc.tabs.filter((tab) => tab.id !== id)
    if (next.length === doc.tabs.length) return null
    write(next)
    return list()
  }

  return { path, list, view, upsert, patch, remove }
}
