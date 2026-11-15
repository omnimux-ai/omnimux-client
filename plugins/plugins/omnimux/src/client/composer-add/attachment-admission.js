/**
 * Clear only the submitted attachment IDs after a matching Host admission.
 *
 * The composer chip is cleared here — not optimistically on click — because a
 * submission the Host rejects (prompt error) or loses must keep its attachments
 * so the user can retry. We only retire an attempt once the Host proves it
 * admitted the request (`queue[].rpcId` or a `user/message` event whose
 * `source.kind === 'user'`), correlated to the submission that carried it.
 *
 * The Host `sessions` handle can arrive after the send (the plugin's sessions
 * inject is async, and `commandUi` may not be mounted). When `arm()` runs without
 * a binding we keep the attachments and retry a bounded number of times until the
 * binding is ready, then reconcile — so a chip is never silently stranded.
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

export function createAttachmentAdmission({
  getSessions,
  store,
  setTimeout: setT = (fn, ms) => setTimeout(fn, ms),
  clearTimeout: clearT = (id) => clearTimeout(id),
  retryMs = 100,
  maxRetries = 20,
}) {
  const watching = new Map()
  /** Sessions whose attempt arrived before the Host binding was ready. */
  const detached = new Map()

  function bindingFor(sessionId) {
    try {
      const sessions = getSessions()
      return sessions && typeof sessions.binding === 'function' ? sessions.binding(sessionId) : null
    } catch {
      return null
    }
  }

  function observe(sessionId, watch) {
    // The Host may swap the underlying session/event sources (reconnect / re-key);
    // follow it instead of staying subscribed to a dead snapshot. Compare by the
    // sources, not the binding wrapper identity (which may be a fresh object each
    // call), so a stable session is never needlessly re-subscribed.
    const current = bindingFor(sessionId)
    if (current && (current.session !== watch.binding.session || current.eventSource !== watch.binding.eventSource)) {
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
    if (existing && existing.binding.session === binding.session
      && existing.binding.eventSource === binding.eventSource) return existing
    if (existing) existing.stops.forEach((stop) => stop())
    const watch = { binding, attempts: [], stops: [] }
    watching.set(sessionId, watch)
    watch.stops = [binding.session.subscribe(() => observe(sessionId, watch)),
      binding.eventSource.subscribe(() => observe(sessionId, watch))]
    return watch
  }

  function flushDetached(sessionId) {
    const queued = detached.get(sessionId)
    const watch = ensureWatch(sessionId)
    if (!queued || !watch) return false
    if (queued.timer) { clearT(queued.timer); queued.timer = null }
    detached.delete(sessionId)
    for (const attempt of queued.attempts) watch.attempts.push(attempt)
    observe(sessionId, watch)
    return true
  }

  function scheduleRetry(sessionId) {
    const queued = detached.get(sessionId)
    if (!queued || queued.timer) return
    let timerId = null
    timerId = setT(() => {
      if (timerId !== null) clearT(timerId)
      if (queued.timer === timerId) queued.timer = null
      if (!detached.has(sessionId)) return
      if (flushDetached(sessionId)) return
      queued.tries += 1
      if (queued.tries >= maxRetries) { detached.delete(sessionId); return }
      scheduleRetry(sessionId)
    }, retryMs)
    queued.timer = timerId
  }

  function arm(sessionId, text, attachments) {
    if (!attachments || attachments.length === 0) return
    const attempt = {
      text: String(text ?? '').trim(),
      ids: attachments.map((item) => item.id).filter(Boolean),
      baseline: new Set(),
    }
    const watch = ensureWatch(sessionId)
    if (watch) {
      flushDetached(sessionId)
      attempt.baseline = new Set((watch.binding.session.getSnapshot().pendingSubmissions || []).map((row) => row.requestId))
      // A new gesture supersedes an unbound gesture; in-flight requests retain identity.
      watch.attempts = watch.attempts.filter((item) => item.requestId)
      watch.attempts.push(attempt)
      observe(sessionId, watch)
      return
    }
    // No live binding yet: keep the attachments and retry until the Host sessions
    // handle is ready (bounded), then reconcile. Never drop the attachment.
    const queued = detached.get(sessionId) || { attempts: [], tries: 0, timer: null }
    queued.attempts.push(attempt)
    detached.set(sessionId, queued)
    scheduleRetry(sessionId)
  }

  function disposeSession(id) {
    const watch = watching.get(id)
    watching.delete(id)
    watch?.stops.forEach((stop) => stop())
    const queued = detached.get(id)
    if (queued) { if (queued.timer) clearT(queued.timer); detached.delete(id) }
  }

  return { arm, dispose() { for (const id of [...new Set([...watching.keys(), ...detached.keys()])]) disposeSession(id) } }
}
