import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Readable } from 'node:stream'
import { isLocalRequest, registerWorkbenchHttpRoutes } from './http-routes.js'
import { createHubEventBus } from '../events/hub-event-bus.js'
import { createWorkbenchMailbox } from './mailbox.js'

describe('Workbench HTTP Routes', () => {
  it('isLocalRequest validates origin / referer / sec-fetch-site', () => {
    assert.equal(isLocalRequest({ headers: {} }), true)
    assert.equal(isLocalRequest({ headers: { origin: 'http://127.0.0.1:45120' } }), true)
    assert.equal(isLocalRequest({ headers: { origin: 'http://localhost:45120' } }), true)
    assert.equal(isLocalRequest({ headers: { origin: 'https://evil.com' } }), false)
    assert.equal(isLocalRequest({ headers: { 'sec-fetch-site': 'cross-site' } }), false)
  })

  it('routes register on webServer.register', () => {
    const routes = []
    const fakeServer = {
      register: (route) => {
        routes.push(route)
        return () => {}
      },
    }

    const bus = createHubEventBus()
    const mailbox = createWorkbenchMailbox({ hubEvents: bus })

    const dispose = registerWorkbenchHttpRoutes(fakeServer, { hubEvents: bus, mailbox })

    assert.equal(routes.length, 2)
    const paths = routes.map((r) => r.path)
    assert.equal(paths.includes('/omnimux/events/stream'), false, 'event feed must not hold an HTTP request open')
    assert.ok(paths.includes('/omnimux/workbench/viewport'))
    assert.ok(paths.includes('/omnimux/workbench/rpc/ack'))
    dispose()
  })

  it('keeps authenticated routing details out of the shared model-facing mailbox', async t => {
    const hubEvents = createHubEventBus()
    const mailbox = createWorkbenchMailbox({ hubEvents })
    let viewportHandler
    t.after(registerWorkbenchHttpRoutes({
      register(route) {
        if (route.path === '/omnimux/workbench/viewport') viewportHandler = route.handler
        return () => {}
      },
    }, {
      hubEvents, mailbox, verifySession: sessionId => sessionId === 'chat-a',
      getConnection: () => ({ requestRejection: () => undefined }),
    }))
    const auth = hubEvents.attachWindow({ isAuthenticated: () => true, send: () => true })
    t.after(auth.dispose)
    const viewportDetails = { clip: { retainedCanvas: { workspaceId: 'ws_test', nodeId: 'clip', projectId: 'clip_a' } } }
    const envelope = { schemaVersion: 1, ok: true, capturedAt: Date.now(), sessionId: 'chat-a', viewportDetails }
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(envelope))]), {
      method: 'POST', headers: { 'x-omnimux-window-proof': auth.proof },
    })
    let status
    await viewportHandler(req, { writeHead(code) { status = code }, end() {} })
    assert.equal(status, 200)
    assert.deepEqual(hubEvents.getWindows('chat-a')[0].getViewport().viewportDetails, viewportDetails)
    assert.equal(mailbox.getActiveView('chat-a').uiContext.viewportDetails, undefined)
  })
})
