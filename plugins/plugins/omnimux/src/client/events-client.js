/** Hub event subscription and bounded workbench viewport/RPC delivery. */
import { isCanvasClipActive } from '../workbench/contract.js'

export const HUB_EVENTS_GLOBAL_KEY = '__omnimuxHubEvents'
export const WATCHDOG_TIMEOUT_MS = 5000
export const HEARTBEAT_INTERVAL_MS = 2000
export const REQUEST_TIMEOUT_MS = 3000
export const RECONNECT_DELAY_MS = 3000

export function createEventsClient(options = {}) {
  const WebSocketImpl = options.WebSocket ?? globalThis.WebSocket
  const openWebSocket = options.openWebSocket ?? ((path) => {
    const url = new URL(path, options.baseUrl ?? globalThis.location?.href)
    url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:'
    return new WebSocketImpl(url.href)
  })
  const fetchImpl = options.fetch ?? globalThis.fetch
  const getWorkbench = options.getWorkbench || (() => globalThis.window?.__omnimuxWorkbench)
  const streamUrl = options.streamUrl || '/omnimux/events/stream'
  const viewportUrl = options.viewportUrl || '/omnimux/workbench/viewport'
  const rpcAckUrl = options.rpcAckUrl || '/omnimux/workbench/rpc/ack'
  const subscribers = new Map()
  const viewportContributors = new Map()
  const requests = new Set()
  let socket = null
  let detachSocketListeners = null
  let running = false
  let generation = 0
  let watchdogTimer = null
  let heartbeatTimer = null
  let reconnectTimer = null
  let heartbeatRequest = null
  let refreshRequest = null
  let lastViewportCaptureAt = -Infinity
  let lastEventAt = 0
  let lastEventId = null
  let healthy = false
  let windowIdentity = null
  const proofHeader = 'x-omnimux-window-proof'

  function windowFetch(path, init, windowInstanceId = windowIdentity?.windowInstanceId) {
    if (!path.startsWith('/omnimux-clip/api/') || !windowIdentity || windowIdentity.windowInstanceId !== windowInstanceId) {
      throw Object.assign(new Error('The editor window is no longer connected'), { code: 'EDITOR_OFFLINE' })
    }
    const url = new URL(path, 'http://localhost')
    if (url.origin !== 'http://localhost' || !url.pathname.startsWith('/omnimux-clip/api/')) {
      throw new TypeError('Editor requests must stay on the Clip API')
    }
    const headers = new Headers(init?.headers)
    headers.set(proofHeader, windowIdentity.proof)
    return fetchImpl(path, { ...init, headers, redirect: 'error' })
  }

  function notifySubscribers(event) {
    for (const list of [subscribers.get(event.type), subscribers.get('*')]) {
      if (!list) continue
      for (const cb of list) {
        try { cb(event) } catch (error) { console.error('[EventsClient] subscriber error:', error) }
      }
    }
  }

  async function postJson(url, body, proof, controller = new AbortController()) {
    requests.add(controller)
    const timeout = setTimeout(() => controller.abort(new Error('request timed out')), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(proof ? { [proofHeader]: proof } : {}) },
        ...(proof ? { redirect: 'error' } : {}),
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
    } finally {
      clearTimeout(timeout)
      requests.delete(controller)
    }
  }

  async function handleRpc(payload) {
    const requestGeneration = generation
    const { requestId, tabId, path, view, meta, highlightIds } = payload
    const wb = getWorkbench()
    let applied = false
    let code = 'no-workbench'
    if (wb && typeof wb.open === 'function') {
      try {
        // The Portal can open between the last viewport heartbeat and this RPC.
        if (payload.auto === true && tabId === 'omnimux-clip:studio' && isCanvasClipActive(wb.getUiContext?.())) {
          code = 'canvas-clip-active'
        } else {
          applied = Boolean(await wb.open({
            tabId,
            path: path || tabId,
            view,
            meta,
            highlightIds,
            preserveLayout: true,
          }))
          code = applied ? 'opened' : 'open-failed'
        }
      } catch (error) {
        console.error('[EventsClient] RPC open failed:', error)
        code = 'error'
      }
    }
    if (!fetchImpl || !requestId || generation !== requestGeneration) return
    try {
      await postJson(rpcAckUrl, { requestId, ok: true, applied, code, tabId })
    } catch (error) {
      if (generation === requestGeneration) console.error('[EventsClient] RPC ack failed:', error)
    }
  }

  function handleMessage(event) {
    lastEventAt = Date.now()
    healthy = true
    if (event.type === 'omnimux:window-ready') {
      const { windowInstanceId, proof } = event.payload
      if (typeof windowInstanceId === 'string' && /^[a-f0-9]{64}$/.test(proof)) {
        if (windowIdentity?.windowInstanceId !== windowInstanceId) {
          cancelViewportRequests()
          windowIdentity = { windowInstanceId, proof }
        }
        notifySubscribers({ type: event.type, payload: { windowInstanceId } })
        return pushViewport()
      }
      return
    }
    if (event.type === 'omnimux:viewport:refresh') {
      if (windowIdentity && /^[0-9a-f-]{36}$/.test(event.payload.requestId)) return pushViewport(event.payload.requestId)
      return
    }
    if (typeof event.id === 'string') lastEventId = event.id
    notifySubscribers(event)
    if (event.type === 'omnimux:workbench:rpc' && event.payload) return handleRpc(event.payload)
  }

  function cancelViewportRequests() {
    heartbeatRequest?.controller.abort()
    refreshRequest?.controller.abort()
    heartbeatRequest = refreshRequest = null
  }

  function registerViewportContributor(key, contribute) {
    if (typeof key !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(key) || typeof contribute !== 'function') return () => {}
    viewportContributors.set(key, contribute)
    return () => {
      if (viewportContributors.get(key) === contribute) viewportContributors.delete(key)
    }
  }

  function viewportDetails(envelope) {
    const details = Object.create(null)
    for (const [key, contribute] of viewportContributors) {
      try {
        const data = contribute(envelope)
        if (data && typeof data === 'object') details[key] = data
      } catch (error) {
        console.warn('[EventsClient] viewport contributor failed:', error)
      }
    }
    return details
  }

  function sendViewportHeartbeat(refreshId) {
    if (!fetchImpl) return null
    if (!refreshId && (heartbeatRequest || refreshRequest)) return (heartbeatRequest ?? refreshRequest).promise
    if (refreshId && refreshRequest?.id === refreshId) return refreshRequest.promise
    const currentGeneration = generation
    const identity = windowIdentity
    let envelope = getWorkbench()?.getUiContext?.()
    if (!envelope?.sessionId || envelope.sessionId === 'default') return null
    if (globalThis.document?.visibilityState === 'hidden') {
      envelope = { ...envelope, surface: { ...envelope.surface, panelOpen: false }, view: null, selection: [] }
    }
    // A refresh may finish ahead of an older heartbeat, including one captured
    // in the same millisecond. Keep their capture order explicit for the Host.
    const capturedAt = Number.isFinite(envelope.capturedAt) ? envelope.capturedAt : Date.now()
    lastViewportCaptureAt = Math.max(capturedAt, lastViewportCaptureAt + 1)
    const body = { ...envelope, capturedAt: lastViewportCaptureAt, ...(refreshId ? { refreshId } : {}) }
    if (identity && viewportContributors.size) body.viewportDetails = viewportDetails(envelope)
    const request = { id: refreshId, controller: new AbortController(), promise: null }
    if (refreshId) {
      refreshRequest?.controller.abort()
      refreshRequest = request
    } else {
      heartbeatRequest = request
    }
    request.promise = postJson(viewportUrl, body, identity?.proof, request.controller)
      .then(() => {
        if (identity !== windowIdentity || generation !== currentGeneration || request.controller.signal.aborted) return false
        if (identity && body.capturedAt > (identity.registeredAt ?? -Infinity)) {
          identity.registeredAt = body.capturedAt
          if (identity.registeredSessionId !== envelope.sessionId) {
            identity.registeredSessionId = envelope.sessionId
            notifySubscribers({ type: 'omnimux:viewport-registered', payload: { windowInstanceId: identity.windowInstanceId, sessionId: envelope.sessionId } })
          }
        }
        return true
      }, error => {
        if (generation === currentGeneration && identity === windowIdentity && error?.name !== 'AbortError') {
          console.warn('[EventsClient] viewport heartbeat failed:', error)
        }
        return false
      })
      .finally(() => {
        if (heartbeatRequest === request) heartbeatRequest = null
        if (refreshRequest === request) refreshRequest = null
      })
    return request.promise
  }

  async function pushViewport(refreshId) {
    if (refreshId) return sendViewportHeartbeat(refreshId)
    const identity = windowIdentity
    const currentGeneration = generation
    while (heartbeatRequest || refreshRequest) {
      await (heartbeatRequest ?? refreshRequest).promise
      if (identity !== windowIdentity || generation !== currentGeneration) return false
    }
    return sendViewportHeartbeat()
  }

  function scheduleReconnect() {
    if (!running || reconnectTimer !== null) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      openSocket()
    }, RECONNECT_DELAY_MS)
  }

  function releaseSocket(current) {
    if (socket !== current) return
    socket = null
    healthy = false
    windowIdentity = null
    cancelViewportRequests()
    detachSocketListeners?.()
    detachSocketListeners = null
    if (current.readyState < 2) current.close()
    notifySubscribers({ type: 'omnimux:disconnected', at: Date.now() })
    scheduleReconnect()
  }

  function openSocket() {
    if (!running || socket) return
    let path = streamUrl
    if (lastEventId !== null) {
      const [endpoint, query] = streamUrl.split('?')
      const params = new URLSearchParams(query)
      params.set('after', lastEventId)
      path = `${endpoint}?${params}`
    }
    let current
    try {
      current = openWebSocket(path)
    } catch (error) {
      console.error('[EventsClient] connection failed:', error)
      scheduleReconnect()
      return
    }
    socket = current
    lastEventAt = Date.now()
    const onOpen = () => {
      if (socket !== current) return
      lastEventAt = Date.now()
      healthy = true
      notifySubscribers({ type: 'omnimux:connected', at: lastEventAt })
      void sendViewportHeartbeat()
    }
    const onMessage = ({ data }) => {
      if (socket !== current) return
      let event
      try {
        event = JSON.parse(data)
        if (!event || typeof event.type !== 'string' || !event.payload || typeof event.payload !== 'object') {
          throw new Error('invalid hub event')
        }
      } catch (error) {
        console.error('[EventsClient] invalid event:', error)
        releaseSocket(current)
        return
      }
      void handleMessage(event)
    }
    const onClose = () => releaseSocket(current)
    const listeners = { open: onOpen, message: onMessage, error: onClose, close: onClose }
    for (const [type, listener] of Object.entries(listeners)) current.addEventListener(type, listener)
    detachSocketListeners = () => {
      for (const [type, listener] of Object.entries(listeners)) current.removeEventListener(type, listener)
    }
  }

  function connect() {
    if (running) return
    if (!options.openWebSocket && !WebSocketImpl) throw new Error('WebSocket is required for hub events')
    running = true
    openSocket()
    watchdogTimer = setInterval(() => {
      if (socket && lastEventAt > 0 && Date.now() - lastEventAt > WATCHDOG_TIMEOUT_MS) releaseSocket(socket)
    }, 1000)
    heartbeatTimer = setInterval(() => { void sendViewportHeartbeat() }, HEARTBEAT_INTERVAL_MS)
  }

  function disconnect() {
    running = false
    generation += 1
    clearInterval(watchdogTimer)
    clearInterval(heartbeatTimer)
    clearTimeout(reconnectTimer)
    watchdogTimer = heartbeatTimer = reconnectTimer = null
    if (socket) releaseSocket(socket)
    cancelViewportRequests()
    windowIdentity = null
    for (const controller of requests) controller.abort()
    requests.clear()
    healthy = false
  }

  function subscribe(type, callback) {
    if (typeof callback !== 'function') throw new TypeError('event subscriber must be a function')
    if (!subscribers.has(type)) subscribers.set(type, new Set())
    subscribers.get(type).add(callback)
    return () => { subscribers.get(type)?.delete(callback) }
  }

  return {
    connect,
    disconnect,
    subscribe,
    registerViewportContributor,
    isHealthy: () => healthy,
    getLastEventAt: () => lastEventAt,
    pushViewport,
    getWindowId: () => windowIdentity?.windowInstanceId,
    windowFetch,
    notifyMessageForTests: handleMessage,
  }
}

export function installHubEventsGlobal(client, target = globalThis.window) {
  if (!target) return () => {}
  const facade = {
    subscribe: (type, cb) => client.subscribe(type, cb),
    registerViewportContributor: (key, contribute) => client.registerViewportContributor(key, contribute),
    isHealthy: () => client.isHealthy(),
    getLastEventAt: () => client.getLastEventAt(),
    pushViewport: () => client.pushViewport(),
    getWindowId: () => client.getWindowId(),
    windowFetch: (path, init, windowInstanceId) => client.windowFetch(path, init, windowInstanceId),
  }
  target[HUB_EVENTS_GLOBAL_KEY] = facade
  const catalogUpdated = 'omnimux:model-catalog-updated'
  const invalidateCatalog = () => target.dispatchEvent(new target.Event(catalogUpdated))
  const unsubscribeCatalog = client.subscribe(catalogUpdated, invalidateCatalog)
  // A connection can open after a change, including after the replay window
  // has expired. Reload once per connection in addition to live invalidations.
  const unsubscribeConnected = client.subscribe('omnimux:connected', invalidateCatalog)
  return () => {
    unsubscribeCatalog()
    unsubscribeConnected()
    if (target[HUB_EVENTS_GLOBAL_KEY] === facade) delete target[HUB_EVENTS_GLOBAL_KEY]
  }
}
