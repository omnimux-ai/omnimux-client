import { WebSocket, WebSocketServer } from 'ws'
import { HEARTBEAT_INTERVAL_MS } from './hub-event-bus.js'
import { isLocalRequest } from '../workbench/http-routes.js'
import { WINDOW_HELLO_EVENT } from './windows.js'

export const EVENTS_PATH = '/omnimux/events/stream'
const MAX_BUFFERED_BYTES = 1024 * 1024

/**
 * Mount the hub's read-only event feed on the existing authenticated Host.
 * An upgraded socket does not occupy the browser's HTTP/1 request pool.
 * @param {import('@deepseek-ai/dsh-host-webserver').WebServer} webServer
 * @param {{hubEvents: ReturnType<import('./hub-event-bus.js').createHubEventBus>, connection: {requestRejection: Function}}} deps
 */
export function registerHubEventStream(webServer, { hubEvents, connection }) {
  const server = new WebSocketServer({ noServer: true, maxPayload: 1024 })
  const cleanups = new Set()
  const unregister = webServer.registerUpgrade({
    path: EVENTS_PATH,
    auth: 'required',
    handler(req, socket, head, peer) {
      const admittedPeer = peer !== undefined && peer !== null && typeof peer === 'object'
      const legacyRejection = typeof connection?.requestRejection === 'function'
        ? connection.requestRejection(req)
        : (admittedPeer ? undefined : 503)
      const rejection = legacyRejection ?? (isLocalRequest(req) ? undefined : 403)
      if (rejection !== undefined) {
        const reason = rejection === 401 ? 'Unauthorized' : rejection === 503 ? 'Service Unavailable' : 'Forbidden'
        socket.end(`HTTP/1.1 ${rejection} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
        return
      }
      const after = new URL(req.url, 'http://localhost').searchParams.get('after')
      server.handleUpgrade(req, socket, head, (client) => {
        const send = (event) => {
          if (client.readyState !== WebSocket.OPEN) return false
          if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
            client.terminate()
            return false
          }
          client.send(JSON.stringify(event))
          return true
        }
        const isAuthenticated = () => client.readyState === WebSocket.OPEN && (
          typeof connection?.requestRejection === 'function'
            ? connection.requestRejection(req) === undefined
            : (admittedPeer && peer.signal?.aborted !== true)
        )
        const window = hubEvents.attachWindow({ send, isAuthenticated })
        send({ type: WINDOW_HELLO_EVENT, payload: { windowInstanceId: window.windowInstanceId, proof: window.proof } })
        const heartbeat = () => {
          if (!isAuthenticated()) return client.terminate()
          send({ type: 'omnimux:heartbeat', payload: { at: Date.now() } })
        }
        for (const event of hubEvents.getEventsSince(after)) send(event)
        const unsubscribe = hubEvents.subscribe(send)
        heartbeat()
        const timer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS)
        timer.unref?.()
        const cleanup = () => {
          clearInterval(timer)
          unsubscribe()
          window.dispose()
          cleanups.delete(cleanup)
        }
        cleanups.add(cleanup)
        client.once('close', cleanup)
        client.on('error', () => { client.terminate() })
        // Commands and acknowledgements retain their authenticated HTTP routes.
        client.on('message', () => { client.close(1008, 'read-only event feed') })
      })
    },
  })

  return async () => {
    unregister()
    for (const cleanup of cleanups) cleanup()
    for (const client of server.clients) client.terminate()
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}
