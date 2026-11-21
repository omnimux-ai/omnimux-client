import assert from 'node:assert/strict'
import { once } from 'node:events'
import http from 'node:http'
import { test } from 'node:test'
import { WebSocket } from 'ws'
import { createEventsClient } from '../client/events-client.js'
import { createHubEventBus } from '../events/hub-event-bus.js'
import { EVENTS_PATH, registerHubEventStream } from '../events/stream.js'
import { WINDOW_PROOF_HEADER } from '../events/windows.js'
import { mountWorkbenchContextInjector } from './context-injector.js'
import { registerWorkbenchHttpRoutes } from './http-routes.js'
import { createWorkbenchMailbox } from './mailbox.js'

const REFRESH = 'omnimux:viewport:refresh'
const REGISTERED = 'omnimux:viewport-registered'
const browserCookie = ['local-browser', 'fixture'].join('=')
const userMessage = { id: 'prompt', role: 'user', content: [{ type: 'text', text: 'Summarize this edit' }] }
const turnInput = { kind: 'enter', messages: [userMessage], startsRequestSeries: true }

async function startHost(t) {
  const routes = new Map()
  const upgrades = new Map()
  const server = http.createServer((req, res) => {
    const route = routes.get(req.url)
    if (route) void route.handler(req, res)
    else res.writeHead(404).end()
  })
  server.on('upgrade', (req, socket, head) => {
    const route = upgrades.get(new URL(req.url, 'http://localhost').pathname)
    if (route) route.handler(req, socket, head)
    else socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
  })
  const hubEvents = createHubEventBus()
  const mailbox = createWorkbenchMailbox({ hubEvents })
  const connection = { requestRejection: req => req.headers.cookie === browserCookie ? undefined : 401 }
  const register = into => route => {
    into.set(route.path, route)
    return () => into.delete(route.path)
  }
  const disposeHttp = registerWorkbenchHttpRoutes({ register: register(routes) }, {
    hubEvents, mailbox, getConnection: () => connection,
    verifySession: id => ['chat-a', 'chat-b', 'chat-c'].includes(id),
  })
  const disposeStream = registerHubEventStream({ registerUpgrade: register(upgrades) }, { hubEvents, connection })
  let preStep
  mountWorkbenchContextInjector({
    on(event, listener) {
      assert.equal(event, 'agent/pre-step')
      preStep = listener
    },
  }, { hubEvents, mailbox })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    disposeHttp()
    await disposeStream()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    base, hubEvents,
    async step(sessionId, signal) {
      const start = performance.now()
      const result = await preStep({ agent: { session: { id: sessionId } }, turn: 1, step: 1, signal }, async () => turnInput)
      assert.equal(result.messages[0], userMessage)
      assert.equal(result.startsRequestSeries, true)
      return { text: result.messages.slice(1).map(message => message.content[0].text).join('\n'), elapsed: performance.now() - start }
    },
  }
}

function post(base, path, { method, headers, body, signal }) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(path, base), { method, headers, signal }, res => {
      res.resume()
      res.once('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

async function connectWindow(t, host, initial) {
  let view = initial
  let hold = null
  const registered = []
  const refreshes = []
  const { base } = host
  const headers = { cookie: browserCookie, origin: base }
  const client = createEventsClient({
    openWebSocket(path) {
      const socket = new WebSocket(new URL(path, base.replace('http:', 'ws:')), { headers })
      socket.on('message', data => {
        const frame = JSON.parse(data)
        if (frame.type === REFRESH) refreshes.push(frame)
      })
      return socket
    },
    getWorkbench: () => ({
      getUiContext: () => ({
        schemaVersion: 1, ok: true, sessionId: view.sessionId, capturedAt: Date.now(),
        surface: { tabId: 'omnimux-clip:studio', instanceId: 'tab:studio', panelOpen: true },
        view: { extra: { clip: { ...view.clip, mode: 'standalone', title: 'Timeline', durationSec: 3, playheadSec: 1.25 } } },
      }),
    }),
    async fetch(path, init) {
      const body = JSON.parse(init.body)
      const gated = init.headers[WINDOW_PROOF_HEADER] && hold?.matches(body) ? hold : null
      if (gated) {
        hold = null
        gated.signal = init.signal
        gated.proof = init.headers[WINDOW_PROOF_HEADER]
        gated.started.resolve(body)
        await gated.release.promise
      }
      const response = await post(base, path, { ...init, headers: { ...headers, ...init.headers } })
      gated?.finished.resolve(response.status)
      return response
    },
  })
  const ready = Promise.withResolvers()
  client.subscribe(REGISTERED, ({ payload }) => {
    registered.push(payload)
    ready.resolve(payload)
  })
  t.after(() => client.disconnect())
  client.connect()
  assert.equal((await ready.promise).sessionId, initial.sessionId)
  return {
    client, registered, refreshes,
    show(sessionId, projectId, revision) { view = { sessionId, clip: { projectId, revision } } },
    hold(matches) {
      const gate = { matches, started: Promise.withResolvers(), release: Promise.withResolvers(), finished: Promise.withResolvers() }
      hold = gate
      t.after(gate.release.resolve)
      return gate
    },
  }
}

const clipView = (sessionId, projectId) => ({ sessionId, clip: { projectId, revision: 1 } })
const ms = elapsed => `${elapsed.toFixed(1)} ms`

test('the first turn refreshes B on its existing authenticated socket before B first registers', { timeout: 4000 }, async t => {
  const host = await startHost(t)
  const switching = await connectWindow(t, host, clipView('chat-a', 'clip_a'))
  const unrelated = await connectWindow(t, host, clipView('chat-c', 'clip_c'))
  const firstB = switching.hold(body => body.sessionId === 'chat-b' && !body.refreshId)
  switching.show('chat-b', 'clip_b', 1)
  const heartbeat = switching.client.pushViewport()
  assert.equal((await firstB.started.promise).view.extra.clip.revision, 1)
  assert.equal(host.hubEvents.getWindows('chat-b').length, 0)
  switching.show('chat-b', 'clip_b', 2)
  const turn = await host.step('chat-b')
  t.diagnostic(`first B turn: ${ms(turn.elapsed)}, switching/unrelated refreshes: ${switching.refreshes.length}/${unrelated.refreshes.length}, context: ${JSON.stringify(turn.text)}`)
  assert.match(turn.text, /clip \| mode: standalone \| projectId: clip_b .*revision: 2/)
  assert.doesNotMatch(turn.text, /clip_a|clip_c/)
  assert.equal(switching.refreshes.length, 1)
  assert.equal(unrelated.refreshes.length, 1)
  assert.deepEqual(Object.keys(switching.refreshes[0].payload), ['requestId'])
  assert.notEqual(unrelated.refreshes[0]?.payload.requestId, switching.refreshes[0].payload.requestId)
  assert.equal(host.hubEvents.getEventsSince('0').some(event => event.type === REFRESH), false)

  firstB.release.resolve()
  const lateStatus = await firstB.finished.promise
  t.diagnostic(`late B heartbeat: HTTP ${lateStatus}`)
  assert.equal(lateStatus, 403)
  assert.equal(await heartbeat, false)
  assert.equal(host.hubEvents.getWindows('chat-b')[0].getViewport().view.extra.clip.revision, 2)
  assert.equal(host.hubEvents.getWindows('chat-a').length, 0)
  assert.equal(host.hubEvents.getWindows('chat-c').length, 1)
  assert.deepEqual(switching.registered, ['chat-a', 'chat-b'].map(sessionId => ({ windowInstanceId: switching.client.getWindowId(), sessionId })))
  assert.deepEqual(unrelated.registered, [{ windowInstanceId: unrelated.client.getWindowId(), sessionId: 'chat-c' }])
})

test('a second Clip window switching to B makes first-turn Clip context ambiguous', { timeout: 4000 }, async t => {
  const host = await startHost(t)
  const known = await connectWindow(t, host, clipView('chat-b', 'clip_known'))
  const switching = await connectWindow(t, host, clipView('chat-a', 'clip_a'))
  switching.show('chat-b', 'clip_switching', 2)
  assert.equal(host.hubEvents.getWindows('chat-b').length, 1)
  const turn = await host.step('chat-b')
  t.diagnostic(`two B windows: ${ms(turn.elapsed)}, refreshes: ${known.refreshes.length}/${switching.refreshes.length}, context: ${JSON.stringify(turn.text)}`)
  assert.doesNotMatch(turn.text, /clip \||clip_known|clip_switching|clip_a/)
  assert.equal(host.hubEvents.getWindows('chat-b').length, 2)
  assert.equal(known.refreshes.length, 1)
  assert.equal(switching.refreshes.length, 1)
})

test('overlapping turns receive only their own session context and ignore an unrelated window', { timeout: 4000 }, async t => {
  const host = await startHost(t)
  await connectWindow(t, host, clipView('chat-a', 'clip_a'))
  await connectWindow(t, host, clipView('chat-c', 'clip_c'))
  const switching = await connectWindow(t, host, clipView('chat-a', 'clip_previous'))
  const oldA = switching.hold(body => Boolean(body.refreshId))
  const pendingA = host.step('chat-a')
  assert.equal((await oldA.started.promise).sessionId, 'chat-a')
  switching.show('chat-b', 'clip_b', 2)
  const [a, b] = await Promise.all([pendingA, host.step('chat-b')])
  t.diagnostic(`overlapping turns: A ${ms(a.elapsed)}, B ${ms(b.elapsed)}, old A canceled: ${oldA.signal.aborted}`)
  assert.match(b.text, /projectId: clip_b .*revision: 2/)
  assert.doesNotMatch(b.text, /clip_a|clip_c|clip_previous/)
  assert.match(a.text, /projectId: clip_a /)
  assert.doesNotMatch(a.text, /clip_b|clip_c|clip_previous/)
  assert.equal(oldA.signal.aborted, true)
})

test('an empty registry and an unrelated window both let the first turn continue immediately', { timeout: 4000 }, async t => {
  const host = await startHost(t)
  const noWindow = await host.step('chat-b')
  await connectWindow(t, host, clipView('chat-c', 'clip_c'))
  const noMatch = await host.step('chat-b')
  t.diagnostic(`no window: ${ms(noWindow.elapsed)}; unrelated window: ${ms(noMatch.elapsed)}`)
  for (const turn of [noWindow, noMatch]) {
    assert.equal(turn.text, '')
    assert.ok(turn.elapsed < 400, 'an answered or empty probe does not use the timeout')
  }
})

for (const alreadyRegistered of [true, false]) {
  test(`a silent known A cannot hide the unique ${alreadyRegistered ? 'registered' : 'first'} B viewport`, { timeout: 4000 }, async t => {
    const host = await startHost(t)
    const silentA = await connectWindow(t, host, clipView('chat-a', 'clip_a'))
    const b = await connectWindow(t, host, clipView(alreadyRegistered ? 'chat-b' : 'chat-c', 'clip_previous'))
    silentA.hold(body => Boolean(body.refreshId))
    b.show('chat-b', 'clip_b', 2)
    assert.equal(host.hubEvents.getWindows('chat-b').length, alreadyRegistered ? 1 : 0)

    const turn = await host.step('chat-b')
    const confirmed = host.hubEvents.getWindows('chat-b')[0]?.getViewport().view.extra.clip.revision
    t.diagnostic(`known A silent, B ${alreadyRegistered ? 'registered' : 'first'}: ${ms(turn.elapsed)}, probes to A: ${silentA.refreshes.length}, confirmed B revision: ${confirmed ?? 'none'}, context: ${JSON.stringify(turn.text)}`)
    assert.match(turn.text, /projectId: clip_b .*revision: 2/)
    assert.doesNotMatch(turn.text, /clip_a|clip_previous/)
    assert.equal(confirmed, 2)
    assert.equal(host.hubEvents.getWindows('chat-a').length, 1)
    assert.ok(turn.elapsed < 1050, 'a silent A cannot add a second deadline')
  })
}

test('a silent known B leaves a responding B viewport ambiguous', { timeout: 4000 }, async t => {
  const host = await startHost(t)
  const silentB = await connectWindow(t, host, clipView('chat-b', 'clip_silent'))
  const b = await connectWindow(t, host, clipView('chat-b', 'clip_b'))
  silentB.hold(body => Boolean(body.refreshId))
  b.show('chat-b', 'clip_b', 2)
  const turn = await host.step('chat-b')
  t.diagnostic(`one known B silent: ${ms(turn.elapsed)}, context: ${JSON.stringify(turn.text)}`)
  assert.doesNotMatch(turn.text, /clip \||clip_silent|clip_b/)
  assert.equal(b.refreshes.length, 1)
  assert.equal(silentB.refreshes.length, 1)
})

test('an authenticated B registration during a probe makes a second B possible even without its priority reply', { timeout: 4000 }, async t => {
  const host = await startHost(t)
  const b = await connectWindow(t, host, clipView('chat-b', 'clip_b'))
  const switching = await connectWindow(t, host, clipView('chat-a', 'clip_a'))
  switching.show('chat-b', 'clip_switching', 2)
  const ordinary = switching.hold(body => !body.refreshId)
  const heartbeat = switching.client.pushViewport()
  assert.equal((await ordinary.started.promise).sessionId, 'chat-b')
  switching.hold(body => Boolean(body.refreshId))
  const known = b.hold(body => Boolean(body.refreshId))
  const pending = host.step('chat-b')
  await known.started.promise
  ordinary.release.resolve()
  assert.equal(await heartbeat, true)
  assert.equal(host.hubEvents.getWindows('chat-b').length, 2)
  known.release.resolve()
  const turn = await pending
  t.diagnostic(`A registered as B while waiting for the priority reply: ${ms(turn.elapsed)}, context: ${JSON.stringify(turn.text)}`)
  assert.doesNotMatch(turn.text, /clip \||clip_b|clip_switching/)
})

test('a live socket with no registered viewport yet can make a responding B ambiguous', { timeout: 4000 }, async t => {
  const host = await startHost(t)
  const b = await connectWindow(t, host, clipView('chat-b', 'clip_b'))
  const unknown = new WebSocket(host.base.replace('http:', 'ws:') + EVENTS_PATH, { headers: { cookie: browserCookie, origin: host.base } })
  const [frame] = await once(unknown, 'message')
  assert.equal(JSON.parse(frame).type, 'omnimux:window-ready')
  const turn = await host.step('chat-b')
  t.diagnostic(`one unregistered live socket silent: ${ms(turn.elapsed)}, context: ${JSON.stringify(turn.text)}`)
  assert.equal(b.refreshes.length, 1)
  assert.doesNotMatch(turn.text, /clip \||clip_b/)
})

test('two stalled authenticated refreshes share one first-step deadline', { timeout: 4000 }, async t => {
  const host = await startHost(t)
  const first = await connectWindow(t, host, clipView('chat-b', 'clip_first'))
  const second = await connectWindow(t, host, clipView('chat-b', 'clip_second'))
  const holds = [first, second].map(window => window.hold(body => Boolean(body.refreshId)))
  const pending = host.step('chat-b')
  const bodies = await Promise.all(holds.map(gate => gate.started.promise))
  assert.notEqual(bodies[0].refreshId, bodies[1].refreshId)
  const turn = await pending
  t.diagnostic(`two unanswered refreshes: ${ms(turn.elapsed)}, context: ${JSON.stringify(turn.text)}`)
  assert.doesNotMatch(turn.text, /clip \||clip_first|clip_second/)
  assert.ok(turn.elapsed >= 550 && turn.elapsed < 1050, 'both windows use the same 600 ms budget')
  for (const gate of holds) gate.release.resolve()
  assert.deepEqual(await Promise.all(holds.map(gate => gate.finished.promise)), [200, 200])
})

test('the priority viewport still requires the same-origin cookie, live proof and known session', { timeout: 4000 }, async t => {
  const host = await startHost(t)
  const browser = await connectWindow(t, host, clipView('chat-b', 'clip_b'))
  const legitimate = browser.hold(body => Boolean(body.refreshId))
  browser.show('chat-b', 'clip_b', 2)
  const pending = host.step('chat-b')
  const body = await legitimate.started.promise
  const headers = { 'Content-Type': 'application/json', origin: host.base }
  const rejected = await Promise.all([
    [{ ...headers, [WINDOW_PROOF_HEADER]: legitimate.proof }, 'chat-b'],
    [{ ...headers, cookie: browserCookie, [WINDOW_PROOF_HEADER]: '0'.repeat(64) }, 'chat-b'],
    [{ ...headers, origin: 'http://localhost', cookie: browserCookie, [WINDOW_PROOF_HEADER]: legitimate.proof }, 'chat-b'],
    [{ ...headers, cookie: browserCookie, [WINDOW_PROOF_HEADER]: legitimate.proof }, 'unknown-chat'],
  ].map(([headers, sessionId]) => post(host.base, '/omnimux/workbench/viewport', {
    method: 'POST', headers, body: JSON.stringify({ ...body, sessionId, view: null }),
  })))
  const statuses = rejected.map(response => response.status)
  t.diagnostic(`priority authorization (missing cookie, wrong proof, wrong origin, unknown session): ${statuses.join(', ')}`)
  assert.deepEqual(statuses, [401, 403, 403, 403])
  legitimate.release.resolve()
  assert.equal(await legitimate.finished.promise, 200)
  assert.match((await pending).text, /projectId: clip_b .*revision: 2/)
})

test('canceling the turn releases the pre-step without waiting for a stalled viewport', { timeout: 4000 }, async t => {
  const host = await startHost(t)
  const browser = await connectWindow(t, host, clipView('chat-b', 'clip_b'))
  const held = browser.hold(body => Boolean(body.refreshId))
  const controller = new AbortController()
  const pending = host.step('chat-b', controller.signal)
  await held.started.promise
  const start = performance.now()
  controller.abort()
  const turn = await pending
  const elapsed = performance.now() - start
  t.diagnostic(`canceled turn settled in ${ms(elapsed)}`)
  assert.equal(turn.text, '')
  assert.ok(elapsed < 400, 'cancellation settles before the 600 ms deadline')
})
