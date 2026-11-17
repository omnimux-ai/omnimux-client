/**
 * Attach one inspiration card to the user's current conversation.
 *
 * Shared attachment seam for「立即复刻」and the future「用 Agent 分析」entry:
 * both must hand the same inspiration payload to the same composer attachment
 * store — never two parallel implementations.
 *
 * The only side effect here is the attachment write. Revealing the conversation
 * and prefilling a draft stay with the caller, so a caller that only analyses
 * can attach without mutating the draft.
 */
import { buildInspirationPayload } from './inspiration-payload.js'
import { normalizeSessionId, resolveCurrentSessionId } from './current-session.js'

function resolveDoc(io) {
  if (io.document) return io.document
  return typeof document !== 'undefined' ? document : null
}

function resolveWindow(io, doc) {
  if (io.window) return io.window
  if (doc && doc.defaultView) return doc.defaultView
  if (typeof window !== 'undefined') return window
  return undefined
}

function defaultAddAttachment(win) {
  return (sessionId, payload) => {
    const store = win && win.__omnimuxAttachments
    if (store && typeof store.addAttachment === 'function') {
      return store.addAttachment(sessionId || '', payload)
    }
    return { ok: false, reason: 'invalid-payload' }
  }
}

/**
 * @param {object} row Inspiration row.
 * @param {{
 *   document?: unknown,
 *   window?: unknown,
 *   sessionId?: string,
 *   addAttachment?: (sessionId: string, payload: object) => { ok?: boolean, reason?: string, attachment?: { id?: string } },
 * }} [io]
 * @returns {{ ok: true, sessionId: string, attachmentId?: string, duplicate?: boolean } | { ok: false, error: 'noSession' | 'attachFailed' | 'attachFull' }}
 */
export function attachInspirationToCurrentSession(row, io = {}) {
  const doc = resolveDoc(io)
  const win = resolveWindow(io, doc)
  const sessionId = normalizeSessionId(io.sessionId) || resolveCurrentSessionId(win)
  if (!sessionId) return { ok: false, error: 'noSession' }

  const addAttachment = typeof io.addAttachment === 'function'
    ? io.addAttachment
    : defaultAddAttachment(win)
  try {
    const result = addAttachment(sessionId, buildInspirationPayload(row))
    if (result?.reason === 'duplicate') return { ok: true, sessionId, duplicate: true }
    if (result?.ok !== true) {
      return { ok: false, error: result?.reason === 'quota-exceeded' ? 'attachFull' : 'attachFailed' }
    }
    return {
      ok: true,
      sessionId,
      ...(typeof result.attachment?.id === 'string' && result.attachment.id
        ? { attachmentId: result.attachment.id }
        : {}),
    }
  } catch {
    return { ok: false, error: 'attachFailed' }
  }
}
