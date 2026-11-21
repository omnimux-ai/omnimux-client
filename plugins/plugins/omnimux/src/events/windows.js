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
    let refresh = null
    const isAlive = () => active && isAuthenticated()
    const finishRefresh = (viewport = null) => {
      if (!refresh) return
      const { finish, timer } = refresh
      refresh = null
      clearTimeout(timer)
      finish(viewport)
    }
    const window = Object.freeze({
      windowInstanceId,
      isAlive,
      getViewport: () => isAlive() && latest && now() - latest.receivedAt <= VIEWPORT_TIMEOUT_MS ? latest : null,
      refreshViewport(sessionId) {
        if (!isAlive() || latest?.sessionId !== sessionId) return Promise.resolve(null)
        if (refresh?.sessionId === sessionId) return refresh.promise
        finishRefresh()
        const id = randomUUID()
        let finish
        const promise = new Promise(resolve => { finish = resolve })
        const timer = setTimeout(() => finishRefresh(), FRESH_VIEWPORT_TIMEOUT_MS)
        refresh = { id, sessionId, promise, finish, timer }
        if (!window.send('omnimux:viewport:refresh', { requestId: id })) finishRefresh()
        return promise
      },
      send(type, payload) {
        return isAlive() && send({ type, payload }) !== false
      },
    })
    const record = {
      window,
      update(envelope) {
        if (!isAlive()) return false
        if (latest && envelope.capturedAt < latest.capturedAt) return false
        const { refreshId, ...viewport } = envelope
        latest = Object.freeze({ ...viewport, receivedAt: now() })
        if (refresh && refreshId === refresh.id) finishRefresh(envelope.sessionId === refresh.sessionId ? latest : null)
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
  }
}
