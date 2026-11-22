import { randomBytes, randomUUID } from 'node:crypto'
import { validateEnvelope } from '../workbench/contract.js'

export const WINDOW_PROOF_HEADER = 'x-omnimux-window-proof'
export const WINDOW_HELLO_EVENT = 'omnimux:window-ready'
const VIEWPORT_TIMEOUT_MS = 5500
const FRESH_VIEWPORT_TIMEOUT_MS = 600

/** Each window is admitted by a live, authenticated event socket. Its proof never enters the event ring. */
export function createWindowRegistry({ now = Date.now } = {}) {
  const connections = new Map()

  function attachWindow({ send, isAuthenticated }) {
    const windowInstanceId = randomUUID()
    const proof = randomBytes(32).toString('hex')
    let latest = null
    let active = true
    let refreshId = null
    const refreshWaiters = new Set()
    const isAlive = () => active && isAuthenticated()
    const finishRefresh = (answered = false) => {
      refreshId = null
      for (const waiter of refreshWaiters) waiter.resolve(answered)
      refreshWaiters.clear()
    }
    const window = Object.freeze({
      windowInstanceId,
      isAlive,
      getViewport: () => isAlive() && latest && now() - latest.receivedAt <= VIEWPORT_TIMEOUT_MS ? latest : null,
      send(type, payload) {
        return isAlive() && send({ type, payload }) !== false
      },
    })
    const record = {
      window,
      requestRefresh(sessionId) {
        const sameSessionPending = [...refreshWaiters].some(waiter => waiter.sessionId === sessionId)
        const { promise, resolve } = Promise.withResolvers()
        const waiter = { sessionId, resolve }
        refreshWaiters.add(waiter)
        if (!sameSessionPending) {
          // The client supersedes its previous priority request. The newer
          // snapshot also answers any turn already waiting on this socket.
          refreshId = randomUUID()
          if (!window.send('omnimux:viewport:refresh', { requestId: refreshId })) finishRefresh()
        }
        return {
          promise,
          cancel() {
            refreshWaiters.delete(waiter)
            if (!refreshWaiters.size) refreshId = null
            resolve(false)
          },
        }
      },
      update(envelope) {
        if (!isAlive()) return false
        const { refreshId: responseId, ...viewport } = envelope
        const answersRefresh = refreshId !== null && responseId === refreshId
        if (latest && viewport.capturedAt < latest.capturedAt) {
          // A newer authenticated viewport won while this response was in flight.
          if (answersRefresh) finishRefresh(true)
          return false
        }
        latest = Object.freeze({ ...viewport, receivedAt: now() })
        if (answersRefresh) finishRefresh(true)
        return true
      },
    }
    connections.set(proof, record)
    return {
      windowInstanceId,
      proof,
      dispose() {
        active = false
        latest = null
        finishRefresh()
        connections.delete(proof)
      },
    }
  }

  function recordForRequest(req) {
    const proof = req?.headers?.[WINDOW_PROOF_HEADER]
    const entry = typeof proof === 'string' && /^[a-f0-9]{64}$/.test(proof) ? connections.get(proof) : null
    return entry?.window.isAlive() ? entry : null
  }

  return {
    attachWindow,
    authorizeWindow(req) {
      return recordForRequest(req)?.window ?? null
    },
    async updateWindowViewport(req, envelope, verifySession) {
      const record = recordForRequest(req)
      if (!record || !validateEnvelope(envelope).valid || !Number.isFinite(envelope.capturedAt)) return false
      const sid = envelope.sessionId
      if (typeof sid !== 'string' || !sid || sid === 'default' || sid.length > 160) return false
      if (record.window.getViewport()?.sessionId !== sid && !await verifySession?.(sid)) return false
      return record.update(envelope)
    },
    getWindows(sessionId) {
      if (!sessionId || sessionId === 'default') return []
      return [...connections.values()].map(entry => entry.window)
        .filter(window => window.getViewport()?.sessionId === sessionId)
    },
    async refreshViewports(sessionId, signal) {
      if (!sessionId || sessionId === 'default' || signal?.aborted) return []
      // A session switch can precede its first HTTP viewport. Query each live
      // socket privately and learn its current session from the authenticated
      // reply. The notification carries no session or viewport data.
      const records = [...connections.values()].filter(({ window }) => window.isAlive())
      if (!records.length) return []

      const deadline = Promise.withResolvers()
      const stop = () => deadline.resolve(null)
      const timer = setTimeout(stop, FRESH_VIEWPORT_TIMEOUT_MS)
      signal?.addEventListener?.('abort', stop, { once: true })
      const pending = []
      try {
        for (const { window, requestRefresh } of records) {
          const initialSessionId = window.getViewport()?.sessionId
          const request = requestRefresh(sessionId)
          pending.push({ window, initialSessionId, request, answered: false })
        }
        const allSettled = Promise.all(pending.map(async probe => {
          probe.answered = await probe.request.promise
        }))
        await Promise.race([allSettled, deadline.promise])
        if (signal?.aborted) return []

        const viewports = []
        for (const { window, initialSessionId, answered } of pending) {
          if (!window.isAlive()) continue
          const current = window.getViewport()
          if (!answered) {
            // An unanswered socket can block uniqueness when it was unbound or
            // tied to this session, including a verified heartbeat during this probe.
            if (!initialSessionId || initialSessionId === sessionId || current?.sessionId === sessionId) return []
            continue
          }
          if (!current) return []
          if (current.sessionId === sessionId) viewports.push(current)
        }
        return viewports
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener?.('abort', stop)
        for (const { request } of pending) request.cancel()
      }
    },
  }
}
