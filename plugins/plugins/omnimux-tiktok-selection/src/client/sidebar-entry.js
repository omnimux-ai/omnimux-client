import { createWorkbenchSidebarEntry } from 'dsh-ui-kit'

export const ENTRY_SELECTOR = '[data-omnimux-tiktok-selection-entry]'
export const SELECTION_TAB_ID = 'omnimux-tiktok-selection:workbench'
export const EXPLORE_ITEM_ID = 'tiktok-selection'

export const SELECTION_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5.5h10l-.8 8a1.5 1.5 0 0 1-1.5 1.3H5.3a1.5 1.5 0 0 1-1.5-1.3L3 5.5Z"/><path d="M5.5 5.5V4.2a2.5 2.5 0 0 1 5 0v1.3"/><path d="M6 10.8 7.6 9.2l1.2 1.2L10.6 8.2"/></svg>'

function resolveWorkbenchTitle(t) {
  if (typeof t === 'function') {
    const val = t('nav')
    if (val && val !== 'nav') return val
  }
  return '跟爆选品'
}

/**
 * Register the TikTok Selection entry into the official sidebar "More" menu
 * via OmniMux's `window.__omnimuxSidebar.registerExploreItem` seam.
 * Retries briefly when `omnimux-tiktok-selection` loads ahead of the `omnimux` hub client,
 * and re-registers on locale changes so the menu label tracks language switches.
 */
export function registerMoreMenuEntry(t, locale) {
  if (typeof window === 'undefined') return () => {}
  let unregister = null
  let disposed = false
  let timer = null

  const tryRegister = () => {
    if (disposed) return true
    const sidebar = window.__omnimuxSidebar
    if (!sidebar || typeof sidebar.registerExploreItem !== 'function') return false
    const off = sidebar.registerExploreItem({
      id: EXPLORE_ITEM_ID,
      label: resolveWorkbenchTitle(t),
      iconSvg: SELECTION_ICON_SVG,
      tabId: SELECTION_TAB_ID,
    })
    unregister = typeof off === 'function' ? off : () => {}
    return true
  }

  if (!tryRegister()) {
    const started = Date.now()
    timer = setInterval(() => {
      if (tryRegister() || Date.now() - started > 8000) {
        clearInterval(timer)
        timer = null
      }
    }, 50)
  }

  const unsubscribeLocale = typeof locale?.subscribe === 'function'
    ? locale.subscribe(() => {
        if (!disposed) tryRegister()
      })
    : () => {}

  return () => {
    disposed = true
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    unsubscribeLocale()
    if (unregister) {
      unregister()
      unregister = null
    }
  }
}

export function mountSidebarEntry(_stage, t, locale) {
  const disposeMore = registerMoreMenuEntry(t, locale)
  const disposeConverged = createWorkbenchSidebarEntry({
    id: 'omnimux-tiktok-selection',
    rank: 6,
    tabId: SELECTION_TAB_ID,
    label: () => resolveWorkbenchTitle(t),
    iconSvg: SELECTION_ICON_SVG,
    locale,
    access: 'local',
    customClassName: 'omnimux-tiktok-selection-entry',
    datasetKey: 'data-omnimux-tiktok-selection-entry',
  })
  return () => {
    disposeMore?.()
    disposeConverged?.()
  }
}
