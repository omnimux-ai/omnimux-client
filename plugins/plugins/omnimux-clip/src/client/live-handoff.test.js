import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createClipDispatcher, registerClipRoutes } from '../http/routes.js'
import { resolveClipPaths } from '../paths.js'
import { createProjectStore } from '../store/projectStore.js'
import { CANVAS_TAB, STUDIO_TAB, createEditorSession } from './live/editor-session.js'
import { createLiveChannel } from './live/live-channel.js'
import { LiveClipError, requestClip } from './live/persistence.js'

const binding = { workspaceId: 'ws_handoff', nodeId: 'composition', projectId: 'clip_node_handoff' }
const studioId = 'studio-handoff'
const canvasSession = 'session-handoff'

function deferred() {
  const { promise, resolve } = Promise.withResolvers()
  return { promise, resolve }
}

async function fixture(t) {
  const home = await mkdtemp(join(await realpath(tmpdir()), 'clip-live-handoff-'))
  const paths = resolveClipPaths({ homeDir: home })
  const store = createProjectStore({ paths })
  const initial = store.materialize(binding.projectId, { binding, title: 'Canvas original' })
  store.materialize(studioId, { title: 'Studio project' })
  const trace = []
  const writes = []
  const stored = new Map()
  const listeners = new Map()
  const viewportContributors = new Map()
  const contextContributors = new Map()
  const windowSessions = new Map([['source-window', canvasSession]])
  let windowId = 'source-window'
  let sessionId = canvasSession
  let tabId = CANVAS_TAB
  let activeBinding = binding
  let canvasElement = {}
  let holdHostDraft = false
  let holdPut
  let editedProject
  let nativeChange
  let pendingCommand
  let executions = 0
  const window = { document: { visibilityState: 'visible' }, setInterval, clearInterval }
  const native = {
    projectId: () => editedProject?.id,
    capture: () => ({ project: editedProject, media: {}, fingerprint: JSON.stringify(editedProject) }),
    suspend: () => trace.push('native:suspend'),
    subscribe(callback) { nativeChange = callback; return () => {} },
    subscribeContext: () => () => {},
    isEditorReady: () => true,
    projection: revision => ({ projectId: editedProject.id, title: editedProject.name, revision }),
    async load({ project }, isCurrent) {
      if (!isCurrent()) return
      trace.push(`native:load:${project.id}:${project.name}`)
      editedProject = project
    },
  }
  const dispatcher = createClipDispatcher({
    paths, store,
    getWorkflowClip: () => ({
      resolveBinding(target, ownerSession) {
        assert.deepEqual(target, binding)
        assert.equal(ownerSession, canvasSession)
        return binding
      },
      saveDraft({ revision }) {
        if (holdHostDraft) throw new Error('Canvas pointer unavailable')
        trace.push(`node:revision:${revision}`)
      },
    }),
    broker: {
      lease(_window, body) {
        trace.push(`lease:${body.projectId}:${body.revision}:${body.revisionEpoch}`)
        return { leaseId: `lease-${body.projectId}`, expiresAt: Date.now() + 30_000 }
      },
      renew(_window, body) {
        trace.push(`renew:${body.leaseId}:${body.revision}:${body.revisionEpoch}`)
        return { leaseId: body.leaseId, expiresAt: Date.now() + 30_000 }
      },
      release(_window, body) { trace.push(`release:${body.leaseId}`); return {} },
      claim() { return { command: pendingCommand } },
      receipt(_window, body) { trace.push(body.error?.code ?? 'command:applied'); return {} },
    },
  })
  let route
  registerClipRoutes({ register(registration) { route = registration.handler; return () => {} } }, dispatcher, {
    paths,
    getConnection: () => ({ requestRejection: () => undefined }),
    getHubEvents: () => ({
      authorizeWindow(req) {
        const id = req.headers['x-test-window-id']
        if (!id || id !== windowId) return null
        return { isAlive: () => true, getViewport: () => windowSessions.has(id) ? { sessionId: windowSessions.get(id) } : null }
      },
    }),
  })
  const server = createServer(route)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const hostFetch = async (path, init) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, init)
    if (init.method === 'PUT') {
      const { project, revision } = JSON.parse(init.body)
      const code = response.ok ? undefined : (await response.clone().json()).error
      writes.push({ id: project.id, revision, status: response.status, ...(code && { code }) })
      if (holdPut) {
        holdPut.arrived.resolve()
        await holdPut.unblock.promise
      }
    }
    return response
  }
  const workbench = {
    getCurrentSessionId: () => sessionId,
    getActiveSurface: () => ({ sessionId, tabId, instanceId: tabId, panelOpen: Boolean(tabId) }),
    registerContextContributor(key, callback) {
      contextContributors.set(key, callback)
      return () => contextContributors.delete(key)
    },
  }
  const events = {
    getWindowId: () => windowId,
    pushViewport: async () => windowSessions.get(windowId) === sessionId,
    subscribe(type, callback) { listeners.set(type, callback); return () => listeners.delete(type) },
    registerViewportContributor(key, callback) {
      viewportContributors.set(key, callback)
      return () => viewportContributors.delete(key)
    },
    windowFetch(path, init, id = windowId) {
      if (!windowId || id !== windowId) throw new LiveClipError('EDITOR_OFFLINE', 'Test window disconnected')
      return hostFetch(path, { ...init, headers: { ...init.headers, 'x-test-window-id': id } })
    },
  }
  Object.assign(window, { __omnimuxHubEvents: events, __omnimuxWorkbench: workbench })
  const storage = {
    async readLocal(id) { return stored.get(id) },
    async writeLocal(record) { stored.set(record.project.id, structuredClone(record)) },
    async backupLocal() {},
    async recoverReceipts() { return [] },
    async readReceipt() {},
    async saveReceipt() {},
    async markReceiptDelivered() {},
    async readHost(id) { return requestClip(`/projects/${id}`, { fetcher: hostFetch }) },
    async writeHost(record, options = {}) {
      const { project } = record
      return requestClip(`/projects/${project.id}`, {
        method: 'PUT', fetcher: record.binding ? events.windowFetch : hostFetch,
        body: {
          project, revision: options.revision ?? record.revision,
          expectedRevision: options.expectedRevision ?? record.localBaseRevision,
          binding: record.binding, backupCurrent: options.backupCurrent,
        },
      })
    },
  }
  let channel
  const session = createEditorSession({
    storage, native, document: window.document, workbench: () => workbench, debounce: 60_000,
    onRelease: owner => channel.release(owner),
  })
  channel = createLiveChannel({ session, storage, native, window, execute: async () => { executions++; return {} } })
  const removeCanvas = session.add({
    id: 'canvas-entry', mode: 'canvas', tabId: CANVAS_TAB,
    getCanvas: () => activeBinding, getCanvasAnchor: () => canvasElement,
    isVisible: () => tabId === CANVAS_TAB,
  })
  session.add({
    id: 'studio-entry', mode: 'standalone', tabId: STUDIO_TAB,
    getStudioRequest: () => ({ projectId: studioId, key: 'open-studio' }), isVisible: () => tabId === STUDIO_TAB,
  })
  t.after(async () => {
    holdPut?.unblock.resolve()
    session.dispose()
    await session.getWaiting()
    channel.dispose()
    server.closeAllConnections()
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(home, { recursive: true })
  })
  await session.getWaiting()
  await channel.renew()
  const emit = (type, payload = {}) => listeners.get(type)?.({ payload })
  return {
    session, channel, store, stored, trace, writes,
    change(name) { editedProject = { ...editedProject, name }; nativeChange() },
    fork() { store.save(binding.projectId, { ...initial.project, name: 'Host draft' }, { binding, expectedRevision: 1, revision: 2 }) },
    blockDraftLink(hold) { holdHostDraft = hold },
    holdSaveReply() {
      const arrived = deferred()
      const unblock = deferred()
      holdPut = { arrived, unblock }
      return { arrived: arrived.promise, release: () => unblock.resolve() }
    },
    switchTo(tab, nextSession = sessionId) { tabId = tab; sessionId = nextSession; session.reconcile() },
    detachCanvas() { canvasElement = null; activeBinding = undefined; session.reconcile() },
    removeCanvas,
    disconnect() { windowId = null; emit('omnimux:disconnected') },
    connect(id) { windowId = id; emit('omnimux:window-ready', { windowInstanceId: id }) },
    authenticate() {
      windowSessions.set(windowId, sessionId)
      emit('omnimux:viewport-registered', { windowInstanceId: windowId, sessionId })
    },
    viewportDetails: sessionId => viewportContributors.get('clip')?.({ sessionId }),
    clipView: () => contextContributors.get(tabId)?.()?.view?.extra?.clip,
    command(epoch) {
      const requestId = `edit-epoch-${epoch ?? 'legacy'}`
      pendingCommand = {
        protocolVersion: 1, requestId, operation: 'clip_edit', projectId: binding.projectId, binding,
        mode: 'canvas', tabInstanceId: CANVAS_TAB, editorInstanceId: 'canvas-entry',
        baseRevision: 2, ...(epoch === undefined ? {} : { revisionEpoch: epoch }),
        deadlineAt: Date.now() + 30_000, receiptToken: 'test-receipt',
      }
      emit('omnimux:clip:command', { requestId })
    },
    executions: () => executions,
  }
}

for (const fork of [false, true]) {
  test(`a new connection recovers the pending canvas draft ${fork ? 'into conflict choices' : 'once'}`, async t => {
    const h = await fixture(t)
    const owner = h.session.getOwner()
    h.disconnect()
    h.change('Offline cut')
    assert.deepEqual(await h.session.save(), { persisted: true, synchronized: false })
    if (fork) h.fork()

    h.connect('new-window')
    await h.session.getWaiting()
    await h.channel.renew()
    // A manual save or the debounce may race the newly connected window's viewport.
    assert.deepEqual(await h.session.save(), { persisted: true, synchronized: false })
    t.diagnostic(`Before authenticated viewport: ${JSON.stringify(h.writes)}`)
    assert.ok(h.writes.length > 0)
    assert.ok(h.writes.every(write => write.id === binding.projectId && write.status === 403 && write.code === 'WINDOW_UNAUTHORIZED'))
    assert.equal(h.store.load(binding.projectId).project.name, fork ? 'Host draft' : 'Canvas original')
    assert.equal(h.stored.get(binding.projectId).project.name, 'Offline cut')
    const priorAttempts = h.writes.length

    h.authenticate()
    await h.channel.renew()
    await h.session.getWaiting()
    await h.channel.renew()
    await h.session.getWaiting()
    t.diagnostic(`After authenticated viewport: ${JSON.stringify(h.writes.slice(priorAttempts))}`)
    assert.equal(h.session.getOwner(), owner)
    assert.deepEqual(h.writes.slice(priorAttempts), [fork
      ? { id: binding.projectId, revision: 2, status: 409, code: 'REVISION_CONFLICT' }
      : { id: binding.projectId, revision: 2, status: 200 }])
    assert.equal(h.session.getSnapshot().conflict, fork ? true : undefined)
    assert.equal(h.store.load(binding.projectId).project.name, fork ? 'Host draft' : 'Offline cut')
    assert.equal(h.stored.get(binding.projectId).localBaseRevision, fork ? 1 : 2)
  })
}

test('a real 409 blocks canvas-to-Studio handoff until the original draft is resolved', async t => {
  const h = await fixture(t)
  const owner = h.session.getOwner()
  h.change('Local cut')
  h.fork()
  h.switchTo(STUDIO_TAB)
  await h.session.getWaiting()
  await h.channel.renew()
  t.diagnostic(JSON.stringify({ writes: h.writes, trace: h.trace }))
  assert.deepEqual(h.writes, [{ id: binding.projectId, revision: 2, status: 409, code: 'REVISION_CONFLICT' }])
  assert.equal(h.session.getOwner(), owner)
  assert.equal(h.session.getSnapshot().id, 'studio-entry')
  assert.equal(h.session.getSnapshot().conflict, true)
  assert.equal(h.session.owns(owner), false)
  assert.equal(owner.token.signal.aborted, true)
  assert.ok(h.trace.every(line => !line.startsWith('release:') && !line.startsWith(`native:load:${studioId}`) && !line.startsWith('renew:')))
  assert.equal(h.stored.get(binding.projectId).project.name, 'Local cut')

  assert.equal(await h.session.resolveConflict('host'), true)
  await h.session.getWaiting()
  assert.equal(h.store.load(binding.projectId).project.name, 'Host draft')
  assert.equal(h.stored.get(binding.projectId).project.name, 'Host draft')
  assert.equal(h.session.getOwner().site.projectId, studioId)
  assert.ok(h.trace.indexOf(`release:lease-${binding.projectId}`) < h.trace.indexOf(`native:load:${studioId}:Studio project`))
})

test('exit keeps ownership and emits no node close on 409', async t => {
  const h = await fixture(t)
  const owner = h.session.getOwner()
  const finish = () => { h.trace.push('node:close'); h.switchTo(null) }
  h.change('Unsaved cut')
  h.fork()
  const exited = await h.session.closeCanvas(binding, finish)
  t.diagnostic(JSON.stringify({ writes: h.writes, trace: h.trace, exited }))
  assert.equal(h.writes.at(-1).status, 409)
  assert.equal(exited, false)
  assert.equal(h.session.getOwner(), owner)
  assert.equal(h.session.getSnapshot().conflict, true)
  assert.ok(h.trace.every(line => !line.startsWith('release:') && line !== 'node:close'))

  assert.equal(await h.session.resolveConflict('local'), true)
  assert.equal(h.store.load(binding.projectId).project.name, 'Unsaved cut')
  assert.equal(await h.session.closeCanvas(binding, finish), true)
  await h.session.getWaiting()
  assert.deepEqual(h.trace.filter(line => line.startsWith('release:') || line === 'node:close'),
    [`release:lease-${binding.projectId}`, 'node:close'])
})

for (const exit of [false, true]) {
  test(`failed canvas draft pointer ${exit ? 'keeps exit closed to retries until synchronization' : 'holds handoff for an explicit retry'}`, async t => {
    const h = await fixture(t)
    const owner = h.session.getOwner()
    const finish = () => { h.trace.push('node:close'); h.switchTo(null) }
    h.change('Clip with a pending draft pointer')
    h.blockDraftLink(true)
    if (exit) assert.equal(await h.session.closeCanvas(binding, finish), false)
    else h.switchTo(STUDIO_TAB)
    await h.session.getWaiting()
    assert.equal(h.writes.at(-1).code, 'draft-link-failed')
    assert.equal(h.session.getOwner(), owner)
    assert.equal(h.session.getSnapshot().status, 'saveFailed')
    assert.equal(h.stored.get(binding.projectId).localBaseRevision, 1)
    assert.ok(!h.trace.some(line => line.startsWith('release:') || line === 'node:close'))

    h.blockDraftLink(false)
    if (exit) assert.equal(await h.session.closeCanvas(binding, finish), true)
    else await h.session.retry()
    await h.session.getWaiting()
    assert.equal(h.writes.at(-1).status, 200)
    assert.equal(h.stored.get(binding.projectId).localBaseRevision, 2)
    const linked = h.trace.indexOf('node:revision:2')
    const released = h.trace.indexOf(`release:lease-${binding.projectId}`)
    const moved = h.trace.indexOf(exit ? 'node:close' : `native:load:${studioId}:Studio project`)
    assert.ok(linked >= 0 && linked < released && released < moved, JSON.stringify(h.trace))
  })
}

test('an exit in flight cannot close a node after the viewport has moved', async t => {
  const h = await fixture(t)
  const response = h.holdSaveReply()
  h.change('Save before moving')
  const exit = h.session.closeCanvas(binding, () => h.trace.push('node:close'))
  await response.arrived
  h.switchTo(STUDIO_TAB)
  response.release()
  assert.equal(await exit, false)
  await h.session.getWaiting()
  assert.equal(h.session.getOwner().site.projectId, studioId)
  assert.deepEqual(h.writes, [{ id: binding.projectId, revision: 2, status: 200 }])
  assert.equal(h.trace.filter(line => line.startsWith('release:')).length, 1)
  assert.ok(!h.trace.includes('node:close'))
})

test('viewport detail represents only the live canvas portal for its original conversation', async t => {
  const h = await fixture(t)
  h.switchTo(STUDIO_TAB)
  await h.session.getWaiting()
  assert.deepEqual(h.viewportDetails(canvasSession), { retainedCanvas: binding })
  assert.equal(h.viewportDetails('session-other'), null)
  h.detachCanvas()
  assert.equal(h.viewportDetails(canvasSession), null)
  h.channel.dispose()
  assert.equal(h.viewportDetails(canvasSession), undefined)
})

test('adopting a new project at the same revision fences old commands and publishes its epoch', async t => {
  const h = await fixture(t)
  h.change('Local revision two')
  h.fork()
  await h.session.save()
  assert.equal(await h.session.resolveConflict('host'), true)
  await h.channel.renew()
  assert.equal(h.session.getOwner().record.revision, 2)
  h.command(0)
  await waitForTrace(h.trace, 'REVISION_CONFLICT')
  assert.equal(h.executions(), 0)
  assert.equal(h.clipView()?.revisionEpoch, 1)
  assert.ok(h.trace.some(line => line === `renew:lease-${binding.projectId}:2:1` || line === `lease:${binding.projectId}:2:1`))
  h.command(1)
  await waitForTrace(h.trace, 'command:applied')
  h.command(undefined)
  await waitForTrace(h.trace, 'command:applied', 2)
  assert.equal(h.executions(), 2)
})

async function waitForTrace(trace, entry, count = 1) {
  const until = Date.now() + 1500
  while (trace.filter(line => line === entry).length < count && Date.now() < until) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.ok(trace.filter(line => line === entry).length >= count, JSON.stringify(trace))
}
