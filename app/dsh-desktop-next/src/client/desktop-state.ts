import { useEffect, useSyncExternalStore } from 'react'
import type { DesktopState } from '../desktop-contract.ts'
import type { NextSettingsAdapter } from './settings-adapter.ts'

interface SharedPoll {
  refs: number
  timer: ReturnType<typeof setInterval>
}

const sharedPolls = new WeakMap<NextSettingsAdapter, SharedPoll>()

/**
 * Subscribe to the shared Desktop state adapter while ref-counting a single
 * 2-second poll interval per adapter instance across all mounted surfaces.
 */
export function useDesktopState(adapter: NextSettingsAdapter): DesktopState | undefined {
  const state = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot)
  useEffect(() => {
    void adapter.refresh().catch(() => {})
    let entry = sharedPolls.get(adapter)
    if (entry === undefined) {
      entry = {
        refs: 1,
        timer: setInterval(() => {
          if (typeof document === 'undefined' || !document.hidden) {
            void adapter.refresh().catch(() => {})
          }
        }, 2000),
      }
      sharedPolls.set(adapter, entry)
    } else {
      entry.refs += 1
    }
    return () => {
      const current = sharedPolls.get(adapter)
      if (!current) return
      current.refs -= 1
      if (current.refs <= 0) {
        clearInterval(current.timer)
        sharedPolls.delete(adapter)
      }
    }
  }, [adapter])
  return state
}
