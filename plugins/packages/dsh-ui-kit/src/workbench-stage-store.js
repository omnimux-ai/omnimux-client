const EMPTY_STAGE_BOX = Object.freeze({ top: 0, left: 0, width: 0, height: 0 })
const WORKBENCH_POLL_INTERVAL_MS = 50
const WORKBENCH_POLL_TIMEOUT_MS = 8000

function resolveTitle(title) {
  return typeof title === 'function' ? title() : title
}

/**
 * Lazily adapts the Hub `window.__omnimuxWorkbench.createSidebarStore(...)` seam
 * into the six-method `StageStore` interface expected by `createSidebarEntry`.
 * Zero React/CSS/primitives dependencies so Node unit tests can import directly
 * via `dsh-ui-kit/workbench-stage-store`.
 *
 * @param {{ tabId: string, title: string | (() => string), path?: string }} options
 */
export function createWorkbenchStageStore(options) {
  const { tabId, title, path } = options
  let store = null

  const ensure = () => {
    if (store) return store
    const api = typeof window !== 'undefined' ? window.__omnimuxWorkbench : undefined
    if (!api || typeof api.createSidebarStore !== 'function') return null
    store = api.createSidebarStore({
      tabId,
      title: () => resolveTitle(title),
      ...(path ? { path } : {}),
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
      if (ready && typeof ready.subscribe === 'function') {
        return ready.subscribe(listener)
      }
      let unsub = () => {}
      let disposed = false
      const started = Date.now()
      const timer = setInterval(() => {
        if (disposed) {
          clearInterval(timer)
          return
        }
        const next = ensure()
        if (next && typeof next.subscribe === 'function') {
          clearInterval(timer)
          unsub = next.subscribe(listener)
          listener()
          return
        }
        if (Date.now() - started > WORKBENCH_POLL_TIMEOUT_MS) {
          clearInterval(timer)
        }
      }, WORKBENCH_POLL_INTERVAL_MS)
      return () => {
        disposed = true
        clearInterval(timer)
        if (typeof unsub === 'function') unsub()
      }
    },
    open() {
      const s = ensure()
      if (!s || typeof s.open !== 'function') return
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
      return ensure()?.readBox?.() || EMPTY_STAGE_BOX
    },
  }
}
