import {
  OMNIMUX_CLIP_OPEN,
  OMNIMUX_CLIP_SAVE,
  OMNIMUX_CLIP_CLOSE,
  OMNIMUX_CLIP_PROGRESS,
  dispatchClipEvent,
  isOpenClipEditorPayload,
  isCloseClipEditorPayload,
} from './clip-events.js'

/**
 * CanvasBridge connects canvas events (from omnimux-workflow)
 * with the stage store and OpenReel editor lifecycle.
 *
 * @param {{
 *   stage: { openFromCanvas: (payload: any) => void, set: (open: boolean) => void, getSessionSnapshot: () => any },
 *   target?: EventTarget
 * }} options
 */
export function createAndMountCanvasBridge({ stage, target = window }) {
  if (!target || typeof target.addEventListener !== 'function') {
    return () => {}
  }

  const handleOpen = (event) => {
    const detail = event instanceof CustomEvent ? event.detail : undefined
    if (!isOpenClipEditorPayload(detail)) return
    if (detail.source === 'canvas') {
      stage.openFromCanvas(detail)
    }
  }

  const handleClose = (event) => {
    const detail = event instanceof CustomEvent ? event.detail : undefined
    if (!isCloseClipEditorPayload(detail)) return
    const session = stage.getSessionSnapshot()
    if (!detail.nodeId || (session && session.nodeId === detail.nodeId)) {
      stage.set(false)
    }
  }

  target.addEventListener(OMNIMUX_CLIP_OPEN, handleOpen)
  target.addEventListener(OMNIMUX_CLIP_CLOSE, handleClose)

  // Mark clip plugin ready in global window
  try {
    if (typeof window !== 'undefined') {
      window.__omnimuxClipReady = true
    }
  } catch {}

  return () => {
    target.removeEventListener(OMNIMUX_CLIP_OPEN, handleOpen)
    target.removeEventListener(OMNIMUX_CLIP_CLOSE, handleClose)
    try {
      if (typeof window !== 'undefined') {
        delete window.__omnimuxClipReady
      }
    } catch {}
  }
}

/**
 * Helper to emit save event back to canvas.
 * @param {{
 *   nodeId?: string,
 *   projectId?: string,
 *   schema?: unknown,
 *   createDownstreamNode?: boolean,
 *   output?: { videoPath: string, thumbnailPath?: string, durationMs?: number, width?: number, height?: number }
 * }} payload
 * @param {EventTarget | { target?: EventTarget }} [targetOrOpts]
 */
export function notifyCanvasSave(payload, targetOrOpts) {
  const opts = targetOrOpts && typeof targetOrOpts.addEventListener === 'function'
    ? { target: targetOrOpts }
    : (targetOrOpts || {})
  return dispatchClipEvent(OMNIMUX_CLIP_SAVE, payload, opts)
}

/**
 * Helper to emit progress event back to canvas.
 * @param {{ nodeId?: string, status?: string, renderProgress?: number }} payload
 * @param {EventTarget | { target?: EventTarget }} [targetOrOpts]
 */
export function notifyCanvasProgress(payload, targetOrOpts) {
  const opts = targetOrOpts && typeof targetOrOpts.addEventListener === 'function'
    ? { target: targetOrOpts }
    : (targetOrOpts || {})
  return dispatchClipEvent(OMNIMUX_CLIP_PROGRESS, payload, opts)
}

/**
 * Helper to emit close event back to canvas.
 * @param {{ nodeId?: string }} payload
 * @param {EventTarget | { target?: EventTarget }} [targetOrOpts]
 */
export function notifyCanvasClose(payload, targetOrOpts) {
  const opts = targetOrOpts && typeof targetOrOpts.addEventListener === 'function'
    ? { target: targetOrOpts }
    : (targetOrOpts || {})
  return dispatchClipEvent(OMNIMUX_CLIP_CLOSE, payload, opts)
}
