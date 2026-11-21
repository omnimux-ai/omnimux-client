import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createClipDispatcher, registerClipRoutes } from '../http/routes.js'
import { createClipCommandBroker } from '../live/command-broker.js'
import { resolveClipPaths } from '../paths.js'
import { createProjectStore } from '../store/projectStore.js'
import { nativeProjectView } from '../timeline/nativeProjectView.js'
import { createClipTools } from '../tools.js'
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

async function fixture(t, { liveBroker = false, debounce = 60_000 } = {}) {
  const home = await mkdtemp(join(await realpath(tmpdir()), 'clip-live-handoff-'))
  const paths = resolveClipPaths({ homeDir: home })
  const store = createProjectStore({ paths })
  const initial = store.materialize(binding.projectId, { binding, title: 'Canvas original' })
  store.materialize(studioId, { title: 'Studio project' })
  const trace = []
  const writes = []
  const stored = new Map()
  const receipts = new Map()
  const receiptAttempts = []
  const receiptPosts = []
  const notifications = []
  const listeners = new Map()
  const viewportContributors = new Map()
  const contextContributors = new Map()
  const windows = new Map()
  let windowId = 'source-window'
  let viewportAdmitted = true
  let receiptRejection
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
  let heartbeat
  const window = { document: { visibilityState: 'visible' }, clearInterval,
    setInterval(callback, ms) { heartbeat = callback; return setInterval(callback, ms) } }
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
  const getWorkflowClip = () => ({
    resolveBinding(target, ownerSession) {
      assert.deepEqual(target, binding)
      assert.equal(ownerSession, canvasSession)
      return binding
    },
    saveDraft({ revision }) {
      if (holdHostDraft) throw new Error('Canvas pointer unavailable')
      trace.push(`node:revision:${revision}`)
    },
  })
  const emit = (type, payload = {}) => listeners.get(type)?.({ payload })
  function attachWindow(id) {
    const info = {
      windowInstanceId: id,
      isAlive: () => windowId === id,
      getViewport: () => info.isAlive() ? windows.get(id).viewport : null,
      send(type, payload) {
        if (!info.isAlive()) return false
        notifications.push({ type, payload })
        emit(type, payload)
        return true
      },
    }
    windows.set(id, { info })
  }
  attachWindow(windowId)
  const getHubEvents = () => ({
    getWindows: id => [...windows.values()].map(({ info }) => info).filter(info => info.getViewport()?.sessionId === id),
    authorizeWindow(req) { return windows.get(req.headers['x-test-window-id'])?.info },
  })
  const realBroker = liveBroker ? createClipCommandBroker({ getWorkflowClip, getHubEvents, pollMs: 5 }) : null
  const tools = realBroker && createClipTools({ store, broker: realBroker, getWorkflowClip })
  const broker = realBroker ?? {
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
    receipt(_window, body) { trace.push(body.error?.code ?? 'command:applied'); return { status: 'succeeded' } },
  }
  const dispatcher = createClipDispatcher({ paths, store, getWorkflowClip, broker })
  let route
  registerClipRoutes({ register(registration) { route = registration.handler; return () => {} } }, dispatcher, {
    paths, getConnection: () => ({ requestRejection: () => undefined }), getHubEvents,
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
    if (path.endsWith('/live/receipt') && init.method === 'POST') {
      const { error: code, status: outcome, details } = await response.clone().json()
      receiptPosts.push({ id: init.headers['x-test-window-id'], body: JSON.parse(init.body), status: response.status, code, outcome,
        retryable: details?.retryable })
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
  function publishViewport(id = sessionId) {
    const current = windows.get(windowId)
    if (!current) return false
    const clip = contextContributors.get(tabId)?.()?.view?.extra?.clip
    current.viewport = { ok: true, sessionId: id, surface: workbench.getActiveSurface(),
      view: { extra: { workspaceId: clip?.workspaceId, clip } } }
    return true
  }
  const events = {
    getWindowId: () => windowId,
    pushViewport: async () => viewportAdmitted && publishViewport(),
    subscribe(type, callback) { listeners.set(type, callback); return () => listeners.delete(type) },
    registerViewportContributor(key, callback) {
      viewportContributors.set(key, callback)
      return () => viewportContributors.delete(key)
    },
    windowFetch(path, init, id = windowId) {
      if (!windowId || id !== windowId) throw new LiveClipError('EDITOR_OFFLINE', 'Test window disconnected')
      if (path.endsWith('/live/receipt')) {
        receiptAttempts.push(id)
        receiptRejection?.()
        receiptRejection = undefined
      }
      return hostFetch(path, { ...init, headers: { ...init.headers, 'x-test-window-id': id } })
    },
  }
  Object.assign(window, { __omnimuxHubEvents: events, __omnimuxWorkbench: workbench })
  const storage = {
    writerId: 'draft-writer',
    async readLocal(id) { return stored.get(id) },
    async writeLocal(record, receipt) {
      stored.set(record.project.id, structuredClone(record))
      if (receipt) receipts.set(receipt.requestId, structuredClone(receipt))
    },
    async backupLocal() {},
    async recoverReceipts(id, since) {
      return structuredClone([...receipts.values()].filter(receipt => receipt.sessionId === id
        && (receipt.deadlineAt ?? receipt.createdAt) > since && !receipt.delivered))
    },
    async readReceipt(id) { return receipts.get(id) && structuredClone(receipts.get(id)) },
    async saveReceipt(id, receipt) { receipts.set(id, structuredClone(receipt)) },
    async markReceiptDelivered(id) { receipts.get(id).delivered = true },
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
    storage, native, document: window.document, workbench: () => workbench, debounce,
    onRelease: owner => channel.release(owner),
  })
  function change(name) {
    editedProject = { ...editedProject, name }
    nativeChange()
  }
  channel = createLiveChannel({ session, storage, native, window, async execute(command, run) {
    run.assertCurrent()
    if (command.operation === 'clip_get') {
      return nativeProjectView({ ...command, projectId: editedProject.id, project: editedProject,
        revision: run.revision(), revisionEpoch: session.getOwner().revisionEpoch }, command.args)
    }
    executions++
    if (!liveBroker) return {}
    const { validateOnly } = command.args
    if (!validateOnly) change(command.args.operations[0].content)
    return { projectId: editedProject.id, undoStep: !validateOnly, persisted: false, synchronized: false,
      results: [{ type: 'set_text', clipId: 'caption' }] }
  } })
  const addCanvasEditor = id => session.add({
    id, mode: 'canvas', tabId: CANVAS_TAB,
    getCanvas: () => activeBinding, getCanvasAnchor: () => canvasElement,
    isVisible: () => tabId === CANVAS_TAB,
  })
  let removeCanvas = addCanvasEditor('canvas-entry')
  session.add({
    id: 'studio-entry', mode: 'standalone', tabId: STUDIO_TAB,
    getStudioRequest: () => ({ projectId: studioId, key: 'open-studio' }), isVisible: () => tabId === STUDIO_TAB,
  })
  t.after(async () => {
    holdPut?.unblock.resolve()
    session.dispose()
    await session.getWaiting()
    channel.dispose()
    realBroker?.dispose()
    server.closeAllConnections()
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    assert.equal(await realpath(home), home)
    await rm(home, { recursive: true })
  })
  await session.getWaiting()
  await channel.renew()
  return {
    session, channel, store, stored, trace, writes, receipts, receiptAttempts, receiptPosts, notifications, change,
    execute(name, args) { return tools.find(tool => tool.name === name).execute(args, { session: { id: canvasSession } }) },
    fork() { store.save(binding.projectId, { ...initial.project, name: 'Host draft' }, { binding, expectedRevision: 1, revision: 2 }) },
    blockDraftLink(hold) { holdHostDraft = hold },
    holdSaveReply() {
      const arrived = deferred()
      const unblock = deferred()
      holdPut = { arrived, unblock }
      return { arrived: arrived.promise, release() { holdPut = undefined; unblock.resolve() } }
    },
    switchTo(tab, nextSession = sessionId) { tabId = tab; sessionId = nextSession; session.reconcile() },
    detachCanvas() { canvasElement = null; activeBinding = undefined; session.reconcile() },
    removeCanvas() { removeCanvas() },
    replaceCanvasEditor(id) { removeCanvas(); removeCanvas = addCanvasEditor(id) },
    dropHostLedger: () => realBroker.dispose(),
    disconnect() { windowId = null; emit('omnimux:disconnected') },
    connect(id) {
      windowId = id
      viewportAdmitted = false
      attachWindow(id)
      emit('omnimux:window-ready', { windowInstanceId: id })
    },
    authenticate(notify = true) {
      viewportAdmitted = true
      if (!notify) return
      publishViewport()
      emit('omnimux:viewport-registered', { windowInstanceId: windowId, sessionId })
    },
    tickHeartbeat() { heartbeat(); return channel.renew() },
    publishViewport,
    rejectNextReceiptInAnotherSession() {
      receiptRejection = () => publishViewport('session-other')
    },
    rejectNextReceiptWithoutViewport() {
      receiptRejection = () => { windows.get(windowId).viewport = null }
    },
    notifyCommand: requestId => emit('omnimux:clip:command', { requestId }),
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
  await waitForTrace(h.trace, 'REVISION_CONFLICT', 2)
  assert.equal(h.executions(), 1)
})

const editBatch = (requestId, extra = {}) => ({ requestId, description: 'Edit the existing caption',
  operations: [{ type: 'set_text', clipId: 'caption', content: 'Agent cut' }], ...extra })

async function eventually(check, message, duration = 1200) {
  const end = Date.now() + duration
  while (!check() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(check(), message)
}

function receiptStatuses(h) {
  return h.receiptPosts.map(({ id, status, code, outcome }) => ({ id, status, code, outcome }))
}

async function checkReceiptAfterReconnect(t, registerWhileSaving) {
  const h = await fixture(t, { liveBroker: true })
  const saveResponse = h.holdSaveReply()
  const args = editBatch('edit-before-reconnect')
  const initialAttempt = h.execute('clip_edit', args).catch(error => error)
  await saveResponse.arrived
  const original = h.receipts.get(args.requestId)
  assert.equal(original.body.result.synchronized, false)
  assert.equal(h.store.load(binding.projectId).project.name, 'Agent cut')
  assert.equal(h.store.load(binding.projectId).revision, 2)
  h.disconnect()
  assert.equal((await initialAttempt).code, 'outcome-unknown')
  h.connect('new-window')
  if (registerWhileSaving) h.authenticate()
  await h.channel.renew()
  assert.deepEqual(h.receiptAttempts, [], 'the provisional receipt cannot be sent while the original save response is held')

  saveResponse.release()
  await eventually(() => h.receipts.get(args.requestId).body.result.synchronized === true, 'the original receipt should report the confirmed save')
  if (!registerWhileSaving) {
    await h.channel.renew()
    t.diagnostic(`Before viewport admission ${JSON.stringify(receiptStatuses(h))}`)
    assert.deepEqual(h.receiptAttempts, [])
    assert.equal(h.receipts.get(args.requestId).delivered, undefined)
    h.authenticate()
  }
  await eventually(() => h.receipts.get(args.requestId).delivered === true, 'the final receipt should be acknowledged after viewport admission')
  t.diagnostic(`After viewport admission ${JSON.stringify(receiptStatuses(h))}`)
  assert.deepEqual(receiptStatuses(h), [{ id: 'new-window', status: 200, code: undefined, outcome: 'succeeded' }])
  const [receipt] = h.receiptPosts
  assert.equal(receipt.body.requestId, original.body.requestId)
  assert.equal(receipt.body.leaseId, original.body.leaseId)
  assert.ok(receipt.body.receiptToken === original.body.receiptToken, 'retry must keep the original receipt proof')
  const result = await h.execute('clip_edit', args)
  h.notifyCommand(args.requestId)
  await h.channel.renew()
  assert.equal(result.revision, 2)
  assert.equal(result.synchronized, true)
  assert.equal(h.executions(), 1)
  assert.equal(h.notifications.length, 1)
  assert.equal(h.receiptPosts.length, 1)
}

test('third review #3 waits for the reconnected authenticated viewport before flushing a receipt', t => checkReceiptAfterReconnect(t, false))
test('third review #3 waits for the final edit outcome before flushing a receipt', t => checkReceiptAfterReconnect(t, true))

async function checkReceiptAfterRejection(t, wrongSession) {
  const h = await fixture(t, { liveBroker: true })
  const saveResponse = h.holdSaveReply()
  const args = editBatch('receipt-after-rejection')
  const initialAttempt = h.execute('clip_edit', args).catch(error => error)
  await saveResponse.arrived
  h.disconnect()
  assert.equal((await initialAttempt).code, 'outcome-unknown')
  h.connect('new-window')
  await h.channel.renew()

  if (wrongSession) h.rejectNextReceiptInAnotherSession()
  else h.rejectNextReceiptWithoutViewport()
  h.authenticate()
  saveResponse.release()
  await eventually(() => h.receiptPosts.length > 0, 'the registered connection should attempt the final receipt')
  t.diagnostic(`Receipt rejected ${JSON.stringify(receiptStatuses(h))}`)
  const [first] = h.receiptPosts
  assert.equal(first.status, wrongSession ? 404 : 409)
  assert.equal(first.code, wrongSession ? 'REQUEST_NOT_FOUND' : 'VIEWPORT_NOT_REGISTERED')
  assert.equal(first.retryable, wrongSession ? undefined : true)
  // Allow the client to process the rejection before the authenticated retry.
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.receipts.get(args.requestId).delivered, undefined)
  h.authenticate()
  await h.channel.renew()
  await eventually(() => h.receipts.get(args.requestId).delivered === true, 'rejected receipts should be retried after registration')
  const [, second] = h.receiptPosts
  assert.equal(second.status, 200)
  assert.equal(second.outcome, 'succeeded')
  assert.equal(second.body.leaseId, first.body.leaseId)
  assert.ok(second.body.receiptToken === first.body.receiptToken, 'rejection must leave the original receipt proof intact')
  assert.deepEqual(second.body.result, first.body.result)
  assert.equal((await h.execute('clip_edit', args)).revision, 2)
  assert.equal(h.executions(), 1)
  assert.equal(h.notifications.length, 1)
  t.diagnostic(`Receipt recovered ${JSON.stringify(receiptStatuses(h))}`)
}

test('third review #3 retries the original receipt after temporary Host viewport loss', t => checkReceiptAfterRejection(t, false))
test('third review #3 retries the original receipt after a registered conversation mismatch', t => checkReceiptAfterRejection(t, true))

test('third review #3 stops retrying an unknown result after a stable authenticated Host lookup', async t => {
  const h = await fixture(t, { liveBroker: true })
  const saveResponse = h.holdSaveReply()
  const args = editBatch('missing-after-host-restart')
  const initialAttempt = h.execute('clip_edit', args).catch(error => error)
  await saveResponse.arrived
  h.disconnect()
  assert.equal((await initialAttempt).code, 'outcome-unknown')
  h.dropHostLedger()
  h.connect('new-window')
  h.authenticate()
  await h.channel.renew()

  saveResponse.release()
  await eventually(() => h.receiptPosts.length === 1, 'the final receipt should be attempted on the registered window')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.receipts.get(args.requestId).delivered, undefined)
  await h.tickHeartbeat()
  await eventually(() => h.receiptPosts.length === 2, 'the Host should receive one retry with a refreshed viewport')
  for (let tick = 0; tick < 3; tick++) {
    await h.tickHeartbeat()
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.deepEqual(h.receiptAttempts, ['new-window', 'new-window'])
  assert.ok(h.receiptPosts.every(post => post.status === 404 && post.code === 'REQUEST_NOT_FOUND'))
  assert.equal(h.receipts.get(args.requestId).delivered, undefined)
  assert.equal(h.store.load(binding.projectId).revision, 2)
  assert.equal(h.executions(), 1)
  t.diagnostic(`Confirmed lookups ${JSON.stringify(receiptStatuses(h))}`)
})

async function checkSaveAfterRapidReturn(t, acknowledge) {
  const h = await fixture(t, { debounce: 50 })
  const owner = h.session.getOwner()
  const response = h.holdSaveReply()
  h.change('First cut')
  if (!acknowledge) h.connect('unauthenticated-window')
  const first = h.session.save()
  await response.arrived
  h.change('Second cut')
  h.switchTo(STUDIO_TAB)
  h.switchTo(CANVAS_TAB)
  response.release()
  assert.equal((await first).synchronized, acknowledge)
  await h.session.getWaiting()
  if (!acknowledge) {
    assert.equal(h.store.load(binding.projectId).revision, 1)
    h.authenticate(false)
    await h.tickHeartbeat()
  }
  try {
    await eventually(() => h.stored.get(binding.projectId)?.localBaseRevision === 3, 'the source r3 must be rescheduled and synced')
  } finally {
    t.diagnostic(JSON.stringify({ writes: h.writes, hostRevision: h.store.load(binding.projectId).revision,
      localRevision: h.session.getOwner().record.revision, needsReconnect: h.session.needsReconnect(canvasSession) }))
  }
  assert.equal(h.session.getOwner(), owner)
  assert.equal(h.store.load(binding.projectId).revision, 3)
  assert.equal(h.store.load(binding.projectId).project.name, 'Second cut')
  assert.equal(h.store.load(studioId).revision, 1)
  assert.equal(h.writes.filter(write => write.status === 200 && write.revision === 3).length, 1)
  assert.ok(h.writes.every(write => write.id === binding.projectId))
}

test('third review #5 saves r3 after rapid Studio return with a held r2 PUT', t => checkSaveAfterRapidReturn(t, true))
test('third review #5 saves r3 after rapid Studio return during an offline r2 PUT', t => checkSaveAfterRapidReturn(t, false))

test('third review #8 blocks same-number writes after Host adoption and remembers the epoch after reopening', async t => {
  const h = await fixture(t, { liveBroker: true })
  h.change('Local r2')
  h.publishViewport()
  const before = await h.execute('clip_get', { requestId: 'before-adoption' })
  h.fork()
  assert.equal((await h.session.save()).conflict, true)
  assert.equal(await h.session.resolveConflict('host'), true)
  h.publishViewport()
  await h.channel.renew()

  try {
    await assert.rejects(h.execute('clip_edit', editBatch('stale-r2-edit', { baseRevision: before.revision })),
      { code: 'REVISION_CONFLICT', details: { currentRevision: 2, currentRevisionEpoch: 1 } })
  } finally {
    t.diagnostic(JSON.stringify({ writes: h.writes, hostRevision: h.store.load(binding.projectId).revision,
      notifications: h.notifications.map(event => event.payload.requestId), firstEpoch: before.revisionEpoch }))
  }
  assert.equal(before.revisionEpoch, 0)
  assert.equal(before.windowInstanceId, 'source-window')
  assert.equal(h.executions(), 0)
  h.switchTo(STUDIO_TAB)
  await h.session.getWaiting()
  await h.channel.renew()
  h.replaceCanvasEditor('reopened-editor')
  h.switchTo(CANVAS_TAB)
  await h.session.getWaiting()
  await h.channel.renew()
  assert.equal(h.clipView().editorInstanceId, 'reopened-editor')
  assert.equal(h.clipView().revisionEpoch, 1)
  assert.equal(h.clipView().draftWriterId, 'draft-writer')
  await assert.rejects(h.execute('clip_edit', editBatch('stale-r2-dry', { baseRevision: 2, validateOnly: true })), { code: 'REVISION_CONFLICT' })
  const read = await h.execute('clip_get', { requestId: 'fresh-read' })
  assert.equal(read.title, 'Host draft')
  assert.equal(read.revision, 2)
  assert.equal(read.revisionEpoch, 1)
  assert.equal(read.draftWriterId, undefined)
  const dry = await h.execute('clip_edit', editBatch('fresh-dry', { baseRevision: read.revision, validateOnly: true }))
  assert.equal(dry.undoStep, false)
  assert.equal(h.store.load(binding.projectId).revision, 2)
  const args = editBatch('fresh-write', { baseRevision: read.revision, baseRevisionEpoch: read.revisionEpoch })
  const accepted = await h.execute('clip_edit', args)
  assert.equal(accepted.revision, 3)
  assert.equal(h.store.load(binding.projectId).project.name, 'Agent cut')
  assert.deepEqual(await h.execute('clip_edit', args), accepted)
})

async function waitForTrace(trace, entry, count = 1) {
  const until = Date.now() + 1500
  while (trace.filter(line => line === entry).length < count && Date.now() < until) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.ok(trace.filter(line => line === entry).length >= count, JSON.stringify(trace))
}
