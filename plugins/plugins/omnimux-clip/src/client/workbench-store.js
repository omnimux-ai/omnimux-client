/**
 * Thin StageStore adapter for the clip sidebar row.
 * Constants stay local (ADR Q12); six-pack lives in hub
 * `window.__omnimuxWorkbench.createSidebarStore`.
 * Lazily acquires the factory so hub/vertical load order stays safe.
 */
export const CLIP_TAB_ID = 'omnimux-clip:studio'
export const CLIP_SENTINEL_PATH = 'omnimux-clip:studio'

function resolveClipTitle(t) {
  try {
    const val = typeof t === 'function' ? t('tab.title') : undefined
    if (val && val !== 'tab.title') return val
  } catch {}
  return '视频剪辑'
}

/**
 * @param {(key: string) => string} [t]
 */
export function createClipWorkbenchStore(t) {
  let store = null
  const ensure = () => {
    if (store) return store
    const api = typeof window !== 'undefined' ? window.__omnimuxWorkbench : undefined
    if (!api || typeof api.createSidebarStore !== 'function') return null
    store = api.createSidebarStore({
      tabId: CLIP_TAB_ID,
      path: CLIP_SENTINEL_PATH,
      title: () => resolveClipTitle(t),
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
      ensure()?.open?.()
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
