/**
 * 固定左侧导航轨的「更多」菜单快捷入口持久化、元信息与视觉令牌样式单一真源。
 *
 * 约定：
 *   1. 「更多」探索清单项直接使用其 `id`（如 `image-generation`、`clip`、`tiktok-selection`）；
 *   2. 官方面板（`schedules` / `plugins`）使用 `panel:<id>` 命名空间，避免与扩展清单重名；
 *   3. 启动读取时绝不主动删除未知 ID（支持异步 `registerExploreItem` 插件延后显现），
 *      显示层结合 `resolveExploreMenuItems()` 与宿主面板态按需过滤渲染；
 *   4. 所有异常均显式记录 `console.debug`，满足 `verify-silent-catch` 门禁。
 */

export const NAV_RAIL_PINNED_MORE_STORAGE_KEY = 'omnimux:nav-rail:pinned-more:v1'
export const PANEL_PIN_PREFIX = 'panel:'

/** 官方折叠面板通用图标：14×14 纯矢量描边矩形（与 explore-more-menu.jsx 共用同一真源）。 */
export const OFFICIAL_PANEL_ICON_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2"/><path d="M1.75 6.25h12.5"/></svg>'

/** 未固定悬停态：空心图钉 SVG（14×14 纯矢量）。 */
export const PIN_OUTLINE_ICON_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.6 2.4 13.6 6.4l-1.3 1.3-1-.2-2.7 2.7.2 1.8-1.2 1.2L5.3 10.9 2.5 13.7l-.2-.2 2.8-2.8L2.8 8.4 4 7.2l1.8.2 2.7-2.7-.2-1 1.3-1.3Z"/></svg>'

/** 已固定常显态：实心图钉 SVG（14×14 纯矢量）。 */
export const PIN_FILL_ICON_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M9.6 2.1a.65.65 0 0 1 .92 0l3.38 3.38a.65.65 0 0 1 0 .92l-1.15 1.15-.95-.2-2.45 2.45.22 1.68a.65.65 0 0 1-.18.55l-1.1 1.1a.65.65 0 0 1-.92 0L5.3 11.06 2.66 13.7a.55.55 0 1 1-.78-.78l2.64-2.64-2.07-2.07a.65.65 0 0 1 0-.92l1.1-1.1a.65.65 0 0 1 .55-.18l1.68.22 2.45-2.45-.2-.95 1.15-1.15Z"/></svg>'

/** 「更多」菜单行悬停固定按钮共用样式真源（供 sidebar-panel-chrome.js 与 styles.js 共同消费）。 */
export const EXPLORE_MORE_PIN_CSS = `
.omnimux-explore-more-row {
  position: relative;
}

.omnimux-explore-more-row > [class*="itemWrap"]:first-child > [role="separator"]:first-child,
.omnimux-explore-more-row > [class*="itemWrap"] > [role="separator"] {
  display: block;
}

.omnimux-explore-more-row > [class*="itemWrap"] > button[role="menuitem"],
.omnimux-explore-more-row > :first-child > button {
  padding-right: 34px !important;
}

.omnimux-explore-more-pin-anchor {
  position: absolute;
  right: 6px;
  bottom: 0;
  height: min(34px, 100%);
  display: flex;
  align-items: center;
  z-index: 2;
  opacity: 0;
  pointer-events: none;
}

.omnimux-explore-more-row:hover > [class*="itemWrap"] > button[role="menuitem"],
.omnimux-explore-more-row:hover > :first-child > button {
  background: var(--dsw-alias-interactive-bg-hover);
}

.omnimux-explore-more-row:hover .omnimux-explore-more-pin-anchor,
.omnimux-explore-more-row:focus-within .omnimux-explore-more-pin-anchor,
.omnimux-explore-more-row[data-pinned="true"] .omnimux-explore-more-pin-anchor {
  opacity: 1;
  pointer-events: auto;
}

.omnimux-explore-more-pin-btn {
  appearance: none;
  box-sizing: border-box;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: opacity var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),
              color var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),
              background-color var(--omnimux-motion-dur-fast, 140ms) var(--omnimux-motion-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}

.omnimux-explore-more-pin-btn svg {
  display: block;
  width: 14px;
  height: 14px;
  pointer-events: none;
}

.omnimux-explore-more-row[data-pinned="true"] .omnimux-explore-more-pin-btn {
  opacity: 1;
  pointer-events: auto;
  color: var(--dsw-alias-label-secondary);
}

.omnimux-explore-more-pin-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.omnimux-explore-more-pin-btn:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-label-primary));
  outline-offset: 1px;
}

@media (hover: none) and (pointer: coarse) {
  .omnimux-explore-more-pin-anchor {
    opacity: 1;
    pointer-events: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .omnimux-explore-more-pin-btn {
    transition: none !important;
  }
}
`

const DEFAULT_OFFICIAL_PANEL_LABELS = Object.freeze({
  schedules: '自动化任务',
  plugins: '插件',
})

const OFFICIAL_PANEL_META_CACHE = new Map()
const PIN_LISTENERS = new Set()
let memoryPinnedIds = []
let storageListenerBound = false
let boundStorageWindow = null

export function normalizePinnedMoreId(id) {
  return typeof id === 'string' ? id.trim() : ''
}

export function panelPinId(panelId) {
  const normalized = normalizePinnedMoreId(panelId)
  return normalized ? `${PANEL_PIN_PREFIX}${normalized}` : ''
}

export function parsePanelPinId(pinId) {
  const normalized = normalizePinnedMoreId(pinId)
  if (!normalized.startsWith(PANEL_PIN_PREFIX)) return null
  const panelId = normalized.slice(PANEL_PIN_PREFIX.length).trim()
  return panelId || null
}

/**
 * 缓存宿主「更多」菜单传入的官方面板本地化标题。
 * @param {{ id?: unknown, label?: unknown } | null | undefined} entry
 */
export function rememberOfficialPanelMeta(entry) {
  if (!entry || typeof entry !== 'object') return
  const id = normalizePinnedMoreId(entry.id)
  const label = typeof entry.label === 'string' ? entry.label.trim() : ''
  if (!id || !label) return
  OFFICIAL_PANEL_META_CACHE.set(id, { id, label })
}

/**
 * 解析官方面板在左侧固定轨上的显示元信息（优先菜单缓存 → 隐藏 panelList DOM → 默认中文标题）。
 * @param {string} panelId
 * @param {Document | null | undefined} [doc]
 * @returns {{ id: string, label: string, iconSvg: string, remembered: boolean, inDom: boolean }}
 */
export function resolveOfficialPanelMeta(panelId, doc) {
  const id = normalizePinnedMoreId(panelId)
  const cached = OFFICIAL_PANEL_META_CACHE.get(id)
  let domLabel = ''
  let inDom = false
  if (id && doc && typeof doc.querySelector === 'function') {
    try {
      const entryRow = doc.querySelector(`nav[class*="panelList"] [data-entry="${id}"] [class*="panelRow"], nav[class*="panelList"] [data-panel-id="${id}"] [class*="panelRow"]`)
        || doc.querySelector(`[data-entry="${id}"] [class*="panelRow"]`)
      if (entryRow) {
        inDom = true
        domLabel = String(entryRow.getAttribute?.('aria-label') || entryRow.textContent || '').trim()
      }
    } catch (error) {
      console.debug('[omnimux-nav-rail-pins] resolveOfficialPanelMeta DOM lookup failed', error)
    }
  }
  const label = cached?.label || domLabel || DEFAULT_OFFICIAL_PANEL_LABELS[id] || id
  return {
    id,
    label,
    iconSvg: OFFICIAL_PANEL_ICON_SVG,
    remembered: Boolean(cached),
    inDom,
  }
}

const EMPTY_SNAPSHOT = Object.freeze([])
let cachedStorage = null
let cachedRawText = null
let cachedSnapshot = EMPTY_SNAPSHOT

function arraysEqual(a, b) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function resolveStorage(explicitStorage) {
  if (explicitStorage && typeof explicitStorage.getItem === 'function' && typeof explicitStorage.setItem === 'function') {
    return explicitStorage
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.getItem === 'function') {
      return window.localStorage
    }
    if (typeof globalThis !== 'undefined' && globalThis.localStorage && typeof globalThis.localStorage.getItem === 'function') {
      return globalThis.localStorage
    }
  } catch (error) {
    console.debug('[omnimux-nav-rail-pins] localStorage lookup failed', error)
  }
  return null
}

function sanitizePinnedList(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const result = []
  for (const item of raw) {
    const id = normalizePinnedMoreId(item)
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

/**
 * 读取已固定「更多」菜单入口 ID 列表（按用户固定先后顺序，缺失或损坏时安全返回空数组）。
 * @param {Storage | null} [storage]
 * @returns {string[]}
 */
export function readPinnedMoreIds(storage) {
  const store = resolveStorage(storage)
  if (!store) return [...memoryPinnedIds]
  try {
    const rawText = store.getItem(NAV_RAIL_PINNED_MORE_STORAGE_KEY)
    if (!rawText) return []
    const parsed = JSON.parse(rawText)
    return sanitizePinnedList(parsed)
  } catch (error) {
    console.debug('[omnimux-nav-rail-pins] readPinnedMoreIds parse failed', error)
    return []
  }
}

/**
 * 返回引用稳定的只读快照（供 React `useSyncExternalStore` 使用，未变更时保持 `Object.is` 同一引用）。
 * @param {Storage | null} [storage]
 * @returns {readonly string[]}
 */
export function getPinnedMoreSnapshot(storage) {
  const store = resolveStorage(storage)
  if (!store) {
    if (cachedStorage !== null || !arraysEqual(cachedSnapshot, memoryPinnedIds)) {
      cachedStorage = null
      cachedRawText = null
      cachedSnapshot = memoryPinnedIds.length === 0 ? EMPTY_SNAPSHOT : Object.freeze([...memoryPinnedIds])
    }
    return cachedSnapshot
  }
  let rawText = ''
  try {
    rawText = store.getItem(NAV_RAIL_PINNED_MORE_STORAGE_KEY) || ''
  } catch (error) {
    console.debug('[omnimux-nav-rail-pins] getPinnedMoreSnapshot read failed', error)
    return EMPTY_SNAPSHOT
  }
  if (store === cachedStorage && rawText === cachedRawText) {
    return cachedSnapshot
  }
  cachedStorage = store
  cachedRawText = rawText
  if (!rawText) {
    cachedSnapshot = EMPTY_SNAPSHOT
    return cachedSnapshot
  }
  try {
    const parsed = JSON.parse(rawText)
    const next = sanitizePinnedList(parsed)
    cachedSnapshot = next.length === 0 ? EMPTY_SNAPSHOT : Object.freeze(next)
  } catch (error) {
    console.debug('[omnimux-nav-rail-pins] getPinnedMoreSnapshot parse failed', error)
    cachedSnapshot = EMPTY_SNAPSHOT
  }
  return cachedSnapshot
}

function notifyPinnedListeners(ids) {
  const snapshot = [...ids]
  for (const listener of [...PIN_LISTENERS]) {
    try {
      listener([...snapshot])
    } catch (error) {
      console.debug('[omnimux-nav-rail-pins] subscriber threw', error)
    }
  }
}

/**
 * 写入已固定列表（去重保序）并广播订阅通知。
 * @param {readonly string[]} ids
 * @param {Storage | null} [storage]
 * @returns {string[]}
 */
export function writePinnedMoreIds(ids, storage) {
  const next = sanitizePinnedList(ids)
  memoryPinnedIds = [...next]
  const nextSnapshot = next.length === 0 ? EMPTY_SNAPSHOT : Object.freeze([...next])
  const store = resolveStorage(storage)
  if (store) {
    try {
      let serialized = ''
      if (next.length === 0 && typeof store.removeItem === 'function') {
        store.removeItem(NAV_RAIL_PINNED_MORE_STORAGE_KEY)
      } else {
        serialized = JSON.stringify(next)
        store.setItem(NAV_RAIL_PINNED_MORE_STORAGE_KEY, serialized)
      }
      cachedStorage = store
      cachedRawText = serialized
      cachedSnapshot = nextSnapshot
    } catch (error) {
      cachedStorage = null
      cachedRawText = null
      cachedSnapshot = nextSnapshot
      console.debug('[omnimux-nav-rail-pins] writePinnedMoreIds persist failed', error)
    }
  } else {
    cachedStorage = null
    cachedRawText = null
    cachedSnapshot = nextSnapshot
  }
  notifyPinnedListeners(next)
  return next
}

export function isMoreItemPinned(id, storage) {
  const target = normalizePinnedMoreId(id)
  if (!target) return false
  return readPinnedMoreIds(storage).includes(target)
}

export function setPinnedMoreItem(id, pinned, storage) {
  const target = normalizePinnedMoreId(id)
  if (!target) return readPinnedMoreIds(storage)
  const current = readPinnedMoreIds(storage)
  const exists = current.includes(target)
  if (Boolean(pinned) === exists) return current
  const next = pinned ? [...current, target] : current.filter((entry) => entry !== target)
  return writePinnedMoreIds(next, storage)
}

export function togglePinnedMoreItem(id, storage) {
  const target = normalizePinnedMoreId(id)
  if (!target) return readPinnedMoreIds(storage)
  const current = readPinnedMoreIds(storage)
  const next = current.includes(target)
    ? current.filter((entry) => entry !== target)
    : [...current, target]
  return writePinnedMoreIds(next, storage)
}

function onWindowStorage(event) {
  if (event?.key && event.key !== NAV_RAIL_PINNED_MORE_STORAGE_KEY) return
  notifyPinnedListeners(readPinnedMoreIds())
}

function bindStorageListener() {
  if (storageListenerBound || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
  window.addEventListener('storage', onWindowStorage)
  boundStorageWindow = window
  storageListenerBound = true
}

function unbindStorageListenerIfIdle() {
  if (!storageListenerBound || PIN_LISTENERS.size > 0) return
  try {
    if (boundStorageWindow && typeof boundStorageWindow.removeEventListener === 'function') {
      boundStorageWindow.removeEventListener('storage', onWindowStorage)
    } else if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('storage', onWindowStorage)
    }
  } catch (error) {
    console.debug('[omnimux-nav-rail-pins] unbind storage listener failed', error)
  }
  boundStorageWindow = null
  storageListenerBound = false
}

/**
 * 订阅「更多」菜单固定列表变化（同一标签页写入 + 跨标签页 storage 同步）。
 * @param {(ids: string[]) => void} listener
 * @returns {() => void}
 */
export function subscribePinnedMoreItems(listener) {
  if (typeof listener !== 'function') return () => {}
  PIN_LISTENERS.add(listener)
  bindStorageListener()
  return () => {
    PIN_LISTENERS.delete(listener)
    unbindStorageListenerIfIdle()
  }
}

export function resetNavRailPinsForTests() {
  OFFICIAL_PANEL_META_CACHE.clear()
  PIN_LISTENERS.clear()
  memoryPinnedIds = []
  cachedStorage = null
  cachedRawText = null
  cachedSnapshot = EMPTY_SNAPSHOT
  unbindStorageListenerIfIdle()
}
