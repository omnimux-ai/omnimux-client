import { useEffect, useSyncExternalStore } from 'react'
import * as prefill from './session-prefill.js'

export const SESSION_PREFILL_SLOT = 'conversation.input.dock'

export function SessionPrefillConsumer(props) {
  const intent = useSyncExternalStore(prefill.subscribeSessionPrefill, prefill.getPendingSessionPrefill, prefill.getPendingSessionPrefill)
  const state = props.useInput?.(s => s)
  useEffect(() => {
    if (!state) return
    prefill.consumeSessionPrefill(intent, {
      sessionId: props.sessionId,
      draft: state.draft,
      phase: state.phase,
      protected: state.imageIds?.length > 0 || state.phase !== 'plain',
      inputActions: props.inputActions,
    })
  }, [intent, state, props.sessionId, props.inputActions])
  return null
}

/** Mounts the standalone cross-plugin session prefill seam (`window.__omnimuxSessionPrefill`). */
export function mountSessionPrefill(ctx) {
  ctx.effect(() => {
    window.__omnimuxSessionPrefill = prefill
    return () => {
      prefill.resetSessionPrefill()
      if (window.__omnimuxSessionPrefill === prefill) delete window.__omnimuxSessionPrefill
    }
  }, 'omnimux: session draft seam')
  ctx.slots.inject(SESSION_PREFILL_SLOT, () => ctx.slots.register({ name: SESSION_PREFILL_SLOT, id: 'omnimux:session-prefill', order: 100 }, SessionPrefillConsumer))
}
