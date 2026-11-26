import { createSidebarEntry } from 'dsh-ui-kit'

export const ENTRY_SELECTOR = '[data-omnimux-pibrowse-entry]'
export const PIBROWSE_TAB_ID = 'omnimux-pibrowse:workbench'
export const EXPLORE_ITEM_ID = 'pibrowse'

export const PIBROWSE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M5.2 8a2.8 2.8 0 0 1 5.6 0"/><path d="M6.8 8a1.2 1.2 0 1 1 2.4 0c0 1.4-.4 2.6-1.2 3.6"/><path d="M4.2 10.6c.4-1 .6-1.8.6-2.6"/></svg>'

function resolveWorkbenchTitle(t) {
  if (typeof t === 'function') {
    const val = t('nav')
    if (val && val !== 'nav') return val
  }
  return '指纹浏览器'
}

function createWorkbenchStageStore(t, tabId) {
  let store = null
  const ensure = () => {
    if (store) return store
    const api = typeof window !== 'undefined' ? window.__omnimuxWorkbench : undefined
    if (!api || typeof api.createSidebarStore !== 'function') return null
    store = api.createSidebarStore({
      tabId,
      title: () => resolveWorkbenchTitle(t),
    })
    return store
  }
  return {
    getSnapshot() {
      return Boolean(ensure()?.getSnapshot?.())
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {}
      const ready = ensure()
      if (ready && typeof ready.subscribe === 'function') return ready.subscribe(listener)
      let unsub = () => {}
      const started = Date.now()
      const timer = setInterval(() => {
        const next = ensure()
        if (next && typeof next.subscribe === 'function') {
          clearInterval(timer)
          unsub = next.subscribe(listener)
          listener()
          return
        }
        if (Date.now() - started > 8000) clearInterval(timer)
      }, 50)
      return () => {
        clearInterval(timer)
        unsub()
      }
    },
    open() {
      const s = ensure()
      if (!s) return
      s.open()
    },
    close() {
      ensure()?.close?.()
    },
    set(next) {
      if (next) this.open()
      else this.close()
    },
    readBox() {
      return ensure()?.readBox?.() || { top: 0, left: 0, width: 0, height: 0 }
    },
  }
}

/**
 * Register the Fingerprint Browser entry into the official sidebar "More" menu
 * via OmniMux's `window.__omnimuxSidebar.registerExploreItem` seam.
 * Retries briefly when `omnimux-pibrowse` loads ahead of the `omnimux` hub client.
 */
export function registerMoreMenuEntry(t) {
  if (typeof window === 'undefined') return () => {}
  let unregister = null
  let disposed = false
  let timer = null

  const tryRegister = () => {
    if (disposed || unregister) return true
    const sidebar = window.__omnimuxSidebar
    if (!sidebar || typeof sidebar.registerExploreItem !== 'function') return false
    const off = sidebar.registerExploreItem({
      id: EXPLORE_ITEM_ID,
      label: resolveWorkbenchTitle(t),
      iconSvg: PIBROWSE_ICON_SVG,
      tabId: PIBROWSE_TAB_ID,
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

  return () => {
    disposed = true
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    if (unregister) {
      unregister()
      unregister = null
    }
  }
}

export function mountSidebarEntry(_stage, t, locale) {
  const disposeMore = registerMoreMenuEntry(t)
  const disposeConverged = createSidebarEntry({
    id: 'omnimux-pibrowse',
    rank: 6.5,
    label: () => resolveWorkbenchTitle(t),
    iconSvg: PIBROWSE_ICON_SVG,
    stageStore: createWorkbenchStageStore(t, PIBROWSE_TAB_ID),
    locale,
    access: 'local',
    customClassName: 'omnimux-pibrowse-entry',
    datasetKey: 'data-omnimux-pibrowse-entry',
  })
  return () => {
    disposeMore?.()
    disposeConverged?.()
  }
}
