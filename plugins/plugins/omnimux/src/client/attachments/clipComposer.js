import { clipContextFromEnvelope } from '../../workbench/contract.js'
import { COMPOSER_EDITOR_SELECTOR, focusEditorElement } from './focusEditorElement.ts'

const COMPOSER_SEAT = '[data-composer-seat]'
const COMPOSER_CARD = '[data-composer-card]'
const EDITABLE = '[contenteditable="true"], textarea:enabled:not([readonly]), input:enabled:not([readonly])'
const FOCUS_ATTR = 'data-omnimux-clip-focus'
const MOUNT_WAIT_MS = 2000
const FOCUS_MS = 700

/** Clip supplies the active editor identity. Workbench owns the projection and Composer placement. */
export function createClipComposer(win, workbench) {
  const { document } = win
  const anchors = new Map()
  const listeners = new Set()
  let request = null
  let snapshot = null
  let stopWaiting, stopFocus

  function publish(value) {
    if (value === snapshot) return
    snapshot = value
    for (const notify of listeners) notify()
  }

  function clear() {
    stopWaiting?.()
    stopFocus?.()
    request?.signal.removeEventListener('abort', clear)
    request = null
    publish(null)
  }

  function focus(card) {
    stopFocus?.()
    focusEditorElement(card)
    if (!card.contains(document.activeElement)) return
    card.setAttribute(FOCUS_ATTR, '')
    const timer = win.setTimeout(() => stopFocus?.(), FOCUS_MS)
    stopFocus = () => {
      win.clearTimeout(timer)
      card.removeAttribute(FOCUS_ATTR)
      stopFocus = undefined
    }
  }

  function place() {
    if (!request) return false
    if (workbench.getCurrentSessionId() !== request.sessionId) {
      clear()
      return false
    }
    const candidates = []
    for (const [anchor, sessionId] of anchors) {
      if (sessionId !== request.sessionId || !anchor.isConnected) continue
      const card = anchor.closest(COMPOSER_CARD)
      if (!card?.closest(COMPOSER_SEAT) || card.closest('[hidden], [inert], [aria-hidden="true"]')) continue
      const editor = card.querySelector(COMPOSER_EDITOR_SELECTOR)
      if (!editor?.matches(EDITABLE) || editor.getAttribute('aria-disabled') === 'true') continue
      if (editor.getClientRects().length && win.getComputedStyle(editor).visibility === 'visible') candidates.push({ anchor, card })
    }
    if (candidates.length !== 1) return false
    const { anchor, card } = candidates[0]
    stopWaiting?.()
    publish({ anchor, clip: request.clip })
    focus(card)
    return true
  }

  function attachClipContext({ sessionId, editorInstanceId, signal }) {
    if (!sessionId || sessionId === 'default' || !editorInstanceId || !signal || signal.aborted
      || sessionId !== workbench.getCurrentSessionId()) return
    const envelope = workbench.getUiContext()
    const source = envelope.view?.extra?.clip
    if (envelope.sessionId !== sessionId || source?.editorInstanceId !== editorInstanceId || source.conflict) return
    const clip = clipContextFromEnvelope(envelope)
    if (!clip) return

    stopWaiting?.()
    request?.signal.removeEventListener('abort', clear)
    request = { sessionId, signal, clip }
    signal.addEventListener('abort', clear, { once: true })
    if (place() || !request) return
    publish(null)
    const observer = new win.MutationObserver(place)
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'inert', 'style', 'aria-hidden', 'aria-disabled', 'contenteditable', 'disabled', 'readonly',
        'data-phase', 'data-sidebar-right-panel', 'data-omnimux-conversation-collapsed'],
    })
    const timer = win.setTimeout(clear, MOUNT_WAIT_MS)
    stopWaiting = () => {
      win.clearTimeout(timer)
      observer.disconnect()
      stopWaiting = undefined
    }
  }

  return {
    install() {
      workbench.attachClipContext = attachClipContext
      const stop = workbench.subscribe(() => {
        if (request && workbench.getCurrentSessionId() !== request.sessionId) clear()
      })
      return () => {
        stop()
        clear()
        if (workbench.attachClipContext === attachClipContext) delete workbench.attachClipContext
      }
    },
    subscribe(notify) {
      listeners.add(notify)
      return () => listeners.delete(notify)
    },
    getSnapshot: () => snapshot,
    register(anchor, sessionId) {
      anchors.set(anchor, sessionId)
      if (stopWaiting) place()
      return () => {
        anchors.delete(anchor)
        if (snapshot?.anchor === anchor) clear()
      }
    },
    dismiss(anchor) {
      if (snapshot?.anchor !== anchor) return
      clear()
      focusEditorElement(anchor.closest(COMPOSER_CARD))
    },
  }
}
