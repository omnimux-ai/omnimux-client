/**
 * Clear only the submitted attachment IDs after a matching Host admission.
 *
 * The composer chip is cleared here — not optimistically on click — because a
 * submission the Host rejects (prompt error) or loses must keep its attachments
 * so the user can retry. We only retire an attempt once the Host proves it
 * admitted the same request (`queue[].rpcId` or a `user/message` event whose
 * `source.kind === 'user'`), correlated to the submission that carried it.
 */

/** Best-effort attachment identity across the pending-submission row shape. */
function attachmentIdOf(item) {
  if (!item || typeof item !== 'object') return ''
  return String(item.attachmentId || item.id || item.entityId || '')
}

/**
 * Match one armed attempt to the pending submission it produced.
 *
 * Correlation is by attachment identity first (robust when the draft text is
 * empty or normalised differently), then by exact text, then — when there is
 * exactly one fresh submission — by elimination. Ambiguous matches stay unbound
 * so a concurrent second send can never retire the wrong attachment set.
 */
function correlate(attempt, fresh) {
  if (fresh.length === 0) return null
  const wanted = new Set(attempt.ids.map(String).filter(Boolean))
  if (wanted.size > 0) {
    const byAttachment = fresh.filter((row) => {
      const ids = (Array.isArray(row.attachments) ? row.attachments : []).map(attachmentIdOf).filter(Boolean)
      return ids.some((id) => wanted.has(id))
    })
    if (byAttachment.length === 1) return byAttachment[0]
  }
  const byText = fresh.filter((row) => String(row.text ?? '').trim() === attempt.text)
  if (byText.length === 1) return byText[0]
  if (fresh.length === 1) return fresh[0]
  return null
}

export function createAttachmentAdmission({ getSessions, store }) {
  const watching = new Map()

  function bindingFor(sessionId) {
    try {
      const sessions = getSessions()
      return sessions && typeof sessions.binding === 'function' ? sessions.binding(sessionId) : null
    } catch {
      return null
    }
  }

  function observe(sessionId, watch) {
    // The Host may swap the session binding (reconnect / session re-key); follow
    // it instead of staying subscribed to a dead snapshot that never fires.
    const current = bindingFor(sessionId)
    if (current && current !== watch.binding) {
      watch.stops.forEach((stop) => stop())
      watch.binding = current
      watch.stops = [current.session.subscribe(() => observe(sessionId, watch)),
        current.eventSource.subscribe(() => observe(sessionId, watch))]
    }
    const binding = watch.binding
    const snapshot = binding.session.getSnapshot()
    if (snapshot.removed) {
      disposeSession(sessionId)
      return
    }
    const admitted = new Set((snapshot.queue || []).map((row) => row.rpcId).filter(Boolean))
    for (const row of binding.eventSource.getSnapshot().entries) {
      const event = row.type === 'event' ? row.event : null
      if (event?.type === 'user/message' && event.data.source?.kind === 'user') {
        admitted.add(event.data.source.rpcId)
      }
    }
    const pending = Array.isArray(snapshot.pendingSubmissions) ? snapshot.pendingSubmissions : []
    for (const attempt of watch.attempts) {
      if (!attempt.requestId) {
        const fresh = pending.filter((row) => !attempt.baseline.has(row.requestId))
        const match = correlate(attempt, fresh)
        if (match) {
          attempt.requestId = match.requestId
          // Adopt the retired-submission id even if the row already left pending:
          // the requestId is the identity the admission set uses.
          attempt.baseline.add(match.requestId)
        }
      }
      if (!attempt.requestId || !admitted.has(attempt.requestId)) continue
      attempt.done = true
      for (const id of attempt.ids) store.removeAttachment(sessionId, id)
    }
    watch.attempts = watch.attempts.filter((attempt) => !attempt.done)
    if (watch.attempts.length === 0) disposeSession(sessionId)
  }

  function ensureWatch(sessionId) {
    const binding = bindingFor(sessionId)
    if (!binding) return null
    const existing = watching.get(sessionId)
    if (existing && existing.binding === binding) return existing
    if (existing) existing.stops.forEach((stop) => stop())
    const watch = { binding, attempts: [], stops: [] }
    watching.set(sessionId, watch)
    watch.stops = [binding.session.subscribe(() => observe(sessionId, watch)),
      binding.eventSource.subscribe(() => observe(sessionId, watch))]
    return watch
  }

  function arm(sessionId, text, attachments) {
    if (!attachments || attachments.length === 0) return
    const watch = ensureWatch(sessionId)
    // No live binding yet: leave the attachments in place (better a stale chip
    // than a silently dropped attachment). A later send re-arms with a binding.
    if (!watch) return
    const snapshot = watch.binding.session.getSnapshot()
    const attempt = {
      text: String(text ?? '').trim(),
      ids: attachments.map((item) => item.id).filter(Boolean),
      baseline: new Set((snapshot.pendingSubmissions || []).map((row) => row.requestId)),
    }
    // A new gesture supersedes an unbound gesture; in-flight requests retain identity.
    watch.attempts = watch.attempts.filter((item) => item.requestId)
    watch.attempts.push(attempt)
    // Reconcile immediately in case the admission landed before we subscribed.
    observe(sessionId, watch)
  }

  function disposeSession(id) {
    const watch = watching.get(id)
    watching.delete(id)
    watch?.stops.forEach((stop) => stop())
  }

  return { arm, dispose() { for (const id of watching.keys()) disposeSession(id) } }
}
