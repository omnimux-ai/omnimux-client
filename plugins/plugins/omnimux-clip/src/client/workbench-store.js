/**
 * Thin StageStore adapter for the clip sidebar row.
 * Constants stay local (ADR Q12); six-pack delegates to dsh-ui-kit
 * `createWorkbenchStageStore` (lazily backed by `window.__omnimuxWorkbench`).
 */
import { createWorkbenchStageStore } from 'dsh-ui-kit/workbench-stage-store'

export const CLIP_TAB_ID = 'omnimux-clip:studio'
export const CLIP_SENTINEL_PATH = 'omnimux-clip:studio'

function resolveClipTitle(t) {
  const val = typeof t === 'function' ? t('tab.title') : undefined
  return val && val !== 'tab.title' ? val : '视频剪辑'
}

/**
 * @param {(key: string) => string} [t]
 */
export function createClipWorkbenchStore(t) {
  return createWorkbenchStageStore({
    tabId: CLIP_TAB_ID,
    path: CLIP_SENTINEL_PATH,
    title: () => resolveClipTitle(t),
  })
}
