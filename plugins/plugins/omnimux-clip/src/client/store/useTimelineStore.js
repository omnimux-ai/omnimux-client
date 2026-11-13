import { useSyncExternalStore } from 'react'
import { timelineStore, selectedClipOf } from './timelineStore.js'

export { timelineStore, selectedClipOf }

export function useTimelineStore(selector = (s) => s) {
  return useSyncExternalStore(
    timelineStore.subscribe,
    () => selector(timelineStore.getState()),
    () => selector(timelineStore.getState()),
  )
}
