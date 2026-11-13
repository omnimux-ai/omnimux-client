import {
  OMNIMUX_CLIP_CLOSE,
  OMNIMUX_CLIP_OPEN,
  OMNIMUX_CLIP_PROGRESS,
  OMNIMUX_CLIP_SAVE,
  OMNIMUX_CLIP_RELOAD,
  dispatchClipEvent,
  isCloseClipEditorPayload,
  isOpenClipEditorPayload,
  isProgressClipEditorPayload,
  isSaveClipEditorPayload,
} from './clip-events.js'

/**
 * JSON-only window hub for omnimux-clip.
 *
 * Canvas / sidebar / agent dispatch `omnimux-clip-open`. The overlay
 * listens, then replies with save / close / progress / reload. Nothing in this
 * module holds a React element, ref, or context.
 *
 * @param {{
 *   target?: EventTarget,
 *   onOpen?: (payload: object, event: Event) => void,
 *   onSave?: (payload: object, event: Event) => void,
 *   onClose?: (payload: object, event: Event) => void,
 *   onProgress?: (payload: object, event: Event) => void,
 *   onReload?: (payload: object, event: Event) => void,
 * }} [opts]
 */
export function createClipBridge(opts = {}) {
  const target = opts.target
    || (typeof window !== 'undefined' ? window : undefined)
  if (!target || typeof target.addEventListener !== 'function') {
    throw new Error('ClipBridge requires a DOM EventTarget')
  }

  /** @type {Array<[string, EventListener]>} */
  const bindings = []

  function bind(type, guard, handler) {
    if (typeof handler !== 'function') return
    /** @type {EventListener} */
    const listener = (event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined
      if (guard && !guard(detail)) return
      handler(detail, event)
    }
    target.addEventListener(type, listener)
    bindings.push([type, listener])
  }

  bind(OMNIMUX_CLIP_OPEN, isOpenClipEditorPayload, opts.onOpen)
  bind(OMNIMUX_CLIP_SAVE, isSaveClipEditorPayload, opts.onSave)
  bind(OMNIMUX_CLIP_CLOSE, isCloseClipEditorPayload, opts.onClose)
  bind(OMNIMUX_CLIP_PROGRESS, isProgressClipEditorPayload, opts.onProgress)
  bind(OMNIMUX_CLIP_RELOAD, () => true, opts.onReload)

  return {
    target,
    /**
     * @param {object} payload
     */
    open(payload) {
      return dispatchClipEvent(OMNIMUX_CLIP_OPEN, payload, { target })
    },
    /**
     * @param {object} payload
     */
    save(payload) {
      return dispatchClipEvent(OMNIMUX_CLIP_SAVE, payload, { target })
    },
    /**
     * @param {object} payload
     */
    close(payload) {
      return dispatchClipEvent(OMNIMUX_CLIP_CLOSE, payload, { target })
    },
    /**
     * @param {object} payload
     */
    progress(payload) {
      return dispatchClipEvent(OMNIMUX_CLIP_PROGRESS, payload, { target })
    },
    /**
     * @param {object} payload
     */
    reload(payload) {
      return dispatchClipEvent(OMNIMUX_CLIP_RELOAD, payload, { target })
    },
    dispose() {
      for (const [type, listener] of bindings) {
        target.removeEventListener(type, listener)
      }
      bindings.length = 0
    },
  }
}

/**
 * Overlay-side helper: listen for open, reply with save / close.
 * @param {{
 *   target?: EventTarget,
 *   onOpen: (payload: object, event: Event) => void,
 * }} opts
 */
export function listenForClipOpen(opts) {
  return createClipBridge({
    target: opts.target,
    onOpen: opts.onOpen,
  })
}
