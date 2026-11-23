import { createSidebarEntry } from 'dsh-ui-kit'

export const ENTRY_SELECTOR = '[data-omnimux-tiktok-selection-entry]'
export const SELECTION_TAB_ID = 'omnimux-tiktok-selection:workbench'

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" role="presentation" aria-hidden="true"><path d="M4 19h16"/><path d="M7 15l3.5-4.5 3 2.5L18 7"/><path d="M14.5 7H18v3.5"/></svg>'

function resolveWorkbenchTitle(t) {
  if (typeof t === 'function') {
    const val = t('nav')
    if (val && val !== 'nav') return val
  }
  return '跟爆选品'
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

export function mountSidebarEntry(_stage, t, locale) {
  return createSidebarEntry({
    id: 'omnimux-tiktok-selection',
    rank: 6,
    label: () => resolveWorkbenchTitle(t),
    iconSvg: ICON,
    stageStore: createWorkbenchStageStore(t, SELECTION_TAB_ID),
    locale,
    access: 'local',
    customClassName: 'omnimux-tiktok-selection-entry',
    datasetKey: 'data-omnimux-tiktok-selection-entry',
  })
}
