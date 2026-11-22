import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createEventsClient, installHubEventsGlobal } from './events-client.js'

describe('EventsClient', () => {
  it('dispatches RPC and sends ack', async () => {
    let ackPayload = null
    let openedTab = null

    const fakeFetch = async (url, opts) => {
      if (url.includes('/rpc/ack')) {
        ackPayload = JSON.parse(opts.body)
      }
      return { ok: true }
    }

    const fakeWorkbench = {
      open: async ({ tabId }) => {
        openedTab = tabId
        return true
      },
      getUiContext: () => ({ schemaVersion: 1, ok: true }),
    }

    const client = createEventsClient({
      fetch: fakeFetch,
      getWorkbench: () => fakeWorkbench,
    })

    // Simulate RPC event arriving
    await client.notifyMessageForTests({
      type: 'omnimux:workbench:rpc',
      payload: {
        requestId: 'req_abc',
        tabId: 'omnimux-assets:library',
      },
    })

    assert.equal(openedTab, 'omnimux-assets:library')
    assert.ok(ackPayload)
    assert.equal(ackPayload.requestId, 'req_abc')
    assert.equal(ackPayload.ok, true)
    assert.equal(ackPayload.applied, true)
    assert.equal(ackPayload.code, 'opened')
    assert.equal(ackPayload.tabId, 'omnimux-assets:library')
  })

  it('rechecks the Portal before applying an in-flight automatic clip switch', async () => {
    const opened = []
    const acks = []
    const clip = { mode: 'canvas', workspaceId: 'ws_test', nodeId: 'node_test', projectId: 'clip_node_test' }
    const client = createEventsClient({
      fetch: async (_url, { body }) => { acks.push(JSON.parse(body)); return { ok: true } },
      getWorkbench: () => ({
        open: async ({ tabId }) => { opened.push(tabId); return true },
        getUiContext: () => ({
          surface: { tabId: 'omnimux-workflow:canvas', panelOpen: true },
          view: { kind: 'canvas', extra: { workspaceId: 'ws_test', clip } },
        }),
      }),
    })
    const payload = { requestId: 'auto_follow', auto: true, tabId: 'omnimux-clip:studio' }
    await client.notifyMessageForTests({ type: 'omnimux:workbench:rpc', payload })
    assert.deepEqual(opened, [])
    assert.deepEqual([acks[0].applied, acks[0].code], [false, 'canvas-clip-active'])
    await client.notifyMessageForTests({ type: 'omnimux:workbench:rpc', payload: { ...payload, requestId: 'explicit_open', auto: false } })
    assert.deepEqual(opened, ['omnimux-clip:studio'])
    assert.equal(acks[1].applied, true)
  })

  it('notifies subscribers on specific and wildcard events', () => {
    const client = createEventsClient()
    const received = []

    client.subscribe('omnimux:assets:changed', (ev) => received.push(ev.type))
    client.subscribe('*', (ev) => received.push(`all:${ev.type}`))

    client.notifyMessageForTests({
      type: 'omnimux:assets:changed',
      payload: { lrev: 1 },
    })

    assert.deepEqual(received, ['omnimux:assets:changed', 'all:omnimux:assets:changed'])
  })
})

function sockets() {
  const instances = []
  class Socket {
    listeners = new Map()
    constructor(url) { this.url = url; this.readyState = 0; instances.push(this) }
    addEventListener(type, callback) { this.listeners.set(type, callback) }
    removeEventListener(type) { this.listeners.delete(type) }
    open() { this.readyState = 1; this.listeners.get('open')?.() }
    emit(event) { this.listeners.get('message')?.({ data: JSON.stringify(event) }) }
    close() { this.readyState = 3; this.listeners.get('close')?.() }
  }
  return { Socket, instances }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

describe('event connection lifecycle', () => {
  it('connect is idempotent; stalled heartbeats stay bounded, time out and abort on disposal', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 })
    t.mock.method(console, 'warn', () => {})
    const { Socket, instances } = sockets()
    const pending = []
    const client = createEventsClient({
      WebSocket: Socket,
      streamUrl: 'ws://localhost/omnimux/events/stream',
      getWorkbench: () => ({ getUiContext: () => ({ sessionId: 'session-test' }) }),
      fetch: (_url, { signal }) => new Promise((_resolve, reject) => {
        pending.push(signal)
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
    })
    client.connect()
    client.connect()
    assert.equal(instances.length, 1)
    instances[0].open()
    t.mock.timers.tick(2000)
    assert.equal(pending.length, 1, 'do not enqueue another heartbeat behind a stalled request')
    t.mock.timers.tick(1000)
    await flush()
    assert.equal(pending[0].aborted, true)
    t.mock.timers.tick(1000)
    assert.equal(pending.length, 2)
    client.disconnect()
    assert.equal(pending[1].aborted, true)
    await flush()
    t.mock.timers.tick(15000)
    assert.equal(instances.length, 1)
    assert.equal(pending.length, 2)
    assert.equal(client.isHealthy(), false)
  })

  it('reconnects with the last event cursor and ignores the old socket', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 })
    const { Socket, instances } = sockets()
    const client = createEventsClient({ WebSocket: Socket, streamUrl: 'ws://localhost/omnimux/events/stream' })
    const revisions = []
    client.subscribe('omnimux:assets:changed', (event) => revisions.push(event.payload.lrev))
    client.connect()
    instances[0].open()
    instances[0].emit({ id: '7', type: 'omnimux:assets:changed', payload: { lrev: 7 } })
    const staleMessage = instances[0].listeners.get('message')
    instances[0].close()
    assert.equal(client.isHealthy(), false)
    assert.equal(instances[0].listeners.size, 0)
    t.mock.timers.tick(3000)
    assert.equal(instances.length, 2)
    assert.equal(new URL(instances[1].url).searchParams.get('after'), '7')
    staleMessage({ data: JSON.stringify({ id: '8', type: 'omnimux:assets:changed', payload: { lrev: 8 } }) })
    instances[1].open()
    instances[1].emit({ id: '8', type: 'omnimux:assets:changed', payload: { lrev: 8 } })
    assert.deepEqual(revisions, [7, 8])
    client.disconnect()
    t.mock.timers.tick(10000)
    assert.equal(instances.length, 2)
  })

  it('passes the logical Hub path and replay cursor to the selected Host carrier', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 })
    const { Socket, instances } = sockets()
    const paths = []
    const client = createEventsClient({
      baseUrl: 'dsh-app://app/',
      openWebSocket(path) {
        paths.push(path)
        return new Socket(new URL(path, 'ws://127.0.0.1:31337/').href)
      },
    })
    t.after(() => client.disconnect())
    client.connect()
    instances[0].open()
    instances[0].emit({ id: '13', type: 'omnimux:model-catalog-updated', payload: {} })
    assert.equal(client.isHealthy(), true)
    instances[0].close()
    t.mock.timers.tick(3000)
    assert.deepEqual(paths, ['/omnimux/events/stream', '/omnimux/events/stream?after=13'])
    assert.equal(instances[1].url, 'ws://127.0.0.1:31337/omnimux/events/stream?after=13')
  })

  it('retains the standalone browser transport for an HTTPS document', (t) => {
    const { Socket, instances } = sockets()
    const client = createEventsClient({ WebSocket: Socket, baseUrl: 'https://example.test/' })
    t.after(() => client.disconnect())
    client.connect()
    assert.equal(instances[0].url, 'wss://example.test/omnimux/events/stream')
  })

  it('invalidates the DOM catalog after reconnect without relying on replay', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 })
    const { Socket, instances } = sockets()
    const client = createEventsClient({ WebSocket: Socket, streamUrl: 'ws://localhost/omnimux/events/stream' })
    const target = Object.assign(new EventTarget(), { Event })
    const uninstall = installHubEventsGlobal(client, target)
    const type = 'omnimux:model-catalog-updated'
    let invalidations = 0
    target.addEventListener(type, () => { invalidations++ })
    t.after(() => { uninstall(); client.disconnect() })

    client.connect()
    instances[0].open()
    assert.equal(invalidations, 1)
    instances[0].emit({ type, payload: {} })
    assert.equal(invalidations, 2)
    instances[0].close()
    t.mock.timers.tick(3000)
    instances[1].open()
    assert.equal(invalidations, 3)

    uninstall()
    instances[1].emit({ type, payload: {} })
    assert.equal(invalidations, 3)
  })

  it('does not enqueue viewport requests without an actual session', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 })
    const { Socket, instances } = sockets()
    let posts = 0
    const client = createEventsClient({
      WebSocket: Socket, streamUrl: 'ws://localhost/omnimux/events/stream',
      getWorkbench: () => ({ getUiContext: () => ({ sessionId: 'default' }) }),
      fetch: async () => { posts++; return { ok: true } },
    })
    client.connect()
    instances[0].open()
    t.mock.timers.tick(4000)
    assert.equal(posts, 0)
    client.disconnect()
  })

  it('pushViewport 立刻推一次信封，不等下一个心跳周期', async () => {
    const bodies = []
    const client = createEventsClient({
      getWorkbench: () => ({ getUiContext: () => ({ schemaVersion: 1, sessionId: 'sess-live' }) }),
      fetch: async (url, opts) => {
        bodies.push({ url: String(url), body: JSON.parse(opts.body) })
        return { ok: true }
      },
    })

    await client.pushViewport()

    assert.equal(bodies.length, 1, '主动推送只发一次')
    assert.equal(bodies[0].url, '/omnimux/workbench/viewport')
    assert.equal(bodies[0].body.sessionId, 'sess-live')

    const idle = createEventsClient({
      getWorkbench: () => ({ getUiContext: () => ({ schemaVersion: 1, sessionId: 'default' }) }),
      fetch: async () => { throw new Error('无真实会话时不得发送 viewport 心跳') },
    })
    await idle.pushViewport()
  })

  it('announces an authenticated viewport only after successful admission for its socket and session', async t => {
    const requests = []
    const ready = []
    let sessionId = 's1'
    let status = 403
    const client = createEventsClient({
      getWorkbench: () => ({ getUiContext: () => ({ schemaVersion: 1, sessionId, capturedAt: 1000 }) }),
      fetch: async (_url, { body, headers }) => {
        requests.push({ body: JSON.parse(body), authenticated: Object.hasOwn(headers, 'x-omnimux-window-proof') })
        return { ok: status === 200, status }
      },
    })
    const remove = client.registerViewportContributor('clip', ({ sessionId }) => ({ retainedCanvas: { projectId: `clip_${sessionId}` } }))
    client.subscribe('omnimux:viewport-registered', event => ready.push(event.payload))
    t.mock.method(console, 'warn', () => {})
    t.after(() => client.disconnect())
    await client.pushViewport()
    assert.equal(requests[0].authenticated, false)
    assert.equal(requests[0].body.viewportDetails, undefined)

    await client.notifyMessageForTests({ type: 'omnimux:window-ready', payload: { windowInstanceId: 'one', proof: '1'.repeat(64) } })
    assert.deepEqual(ready, [])
    assert.equal(requests[1].authenticated, true)
    assert.deepEqual(requests[1].body.viewportDetails, { clip: { retainedCanvas: { projectId: 'clip_s1' } } })

    status = 200
    assert.equal(await client.pushViewport(), true)
    assert.equal(await client.pushViewport(), true)
    assert.deepEqual(ready, [{ windowInstanceId: 'one', sessionId: 's1' }])
    sessionId = 's2'
    remove()
    assert.equal(await client.pushViewport(), true)
    assert.equal(requests.at(-1).body.viewportDetails, undefined)
    assert.deepEqual(ready, [{ windowInstanceId: 'one', sessionId: 's1' }, { windowInstanceId: 'one', sessionId: 's2' }])
  })

  it('does not acknowledge an old RPC after the owning client disconnects', async () => {
    let resolveOpen
    let posts = 0
    const client = createEventsClient({
      getWorkbench: () => ({ open: () => new Promise((resolve) => { resolveOpen = resolve }) }),
      fetch: async () => { posts++; return { ok: true } },
    })
    const operation = client.notifyMessageForTests({
      type: 'omnimux:workbench:rpc', payload: { requestId: 'pending-rpc', tabId: 'assets' },
    })
    client.disconnect()
    resolveOpen(true)
    await operation
    assert.equal(posts, 0)
  })
})
