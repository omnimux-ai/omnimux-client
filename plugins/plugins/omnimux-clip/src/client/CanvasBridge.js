import {
  OMNIMUX_CLIP_OPEN,
  OMNIMUX_CLIP_SAVE,
  OMNIMUX_CLIP_CLOSE,
  OMNIMUX_CLIP_PROGRESS,
  dispatchClipEvent,
  isOpenClipEditorPayload,
  isCloseClipEditorPayload,
} from './clip-events.js'
import { getActiveClipStageStore } from './stage-store.js'
import { findCanvasHost } from './findCanvasHost.js'

/**
 * CanvasBridge connects canvas events (from omnimux-workflow)
 * with the stage store and OpenReel editor lifecycle.
 *
 * @param {{
 *   stage: { openFromCanvas: (payload: any) => void, set: (open: boolean) => void, getSessionSnapshot: () => any },
 *   target?: EventTarget,
 *   root?: Document
 * }} options
 */
export function createAndMountCanvasBridge({ stage, target = window, root = globalThis.document }) {
  if (!target || typeof target.addEventListener !== 'function') {
    return () => {}
  }

  const handleOpen = (event) => {
    const detail = event instanceof CustomEvent ? event.detail : undefined
    if (!isOpenClipEditorPayload(detail) || detail.source !== 'canvas') return
    if (!findCanvasHost(root, detail.workspaceId)) return
    stage.openFromCanvas(detail)
  }

  const handleClose = (event) => {
    const detail = event instanceof CustomEvent ? event.detail : undefined
    if (!isCloseClipEditorPayload(detail)) return
    const session = stage.getSessionSnapshot()
    if (session?.source === 'canvas'
      && session.workspaceId === detail.workspaceId
      && session.nodeId === detail.nodeId
      && session.projectId === detail.projectId) {
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

function notifyCanvas(type, payload, targetOrOpts) {
  const detail = getActiveClipStageStore()?.resolveCanvasReply(type, payload)
  if (!detail) return false
  const opts = targetOrOpts && typeof targetOrOpts.dispatchEvent === 'function'
    ? { target: targetOrOpts }
    : (targetOrOpts || {})
  return dispatchClipEvent(type, detail, opts)
}

/**
 * Helper to emit save event back to canvas.
 * @param {{
 *   nodeId: string,
 *   workspaceId?: string,
 *   projectId?: string,
 *   schema?: unknown,
 *   createDownstreamNode?: boolean,
 *   output?: { videoPath: string, thumbnailPath?: string, durationMs?: number, width?: number, height?: number, revision?: string }
 * }} payload
 * @param {EventTarget | { target?: EventTarget }} [targetOrOpts]
 */
export function notifyCanvasSave(payload, targetOrOpts) {
  return notifyCanvas(OMNIMUX_CLIP_SAVE, payload, targetOrOpts)
}

/**
 * Helper to emit progress event back to canvas.
 * @param {{ nodeId: string, workspaceId?: string, projectId?: string, status?: string, renderProgress?: number }} payload
 * @param {EventTarget | { target?: EventTarget }} [targetOrOpts]
 */
export function notifyCanvasProgress(payload, targetOrOpts) {
  return notifyCanvas(OMNIMUX_CLIP_PROGRESS, payload, targetOrOpts)
}

/**
 * Helper to emit close event back to canvas.
 * @param {{ nodeId: string, workspaceId?: string, projectId?: string }} payload
 * @param {EventTarget | { target?: EventTarget }} [targetOrOpts]
 */
export function notifyCanvasClose(payload, targetOrOpts) {
  // The toolbar reads the active session and closes it in the same callback.
  return notifyCanvas(OMNIMUX_CLIP_CLOSE, payload, targetOrOpts)
}
