import assert from 'node:assert/strict'
import test from 'node:test'
import { CANVAS_TAB, STUDIO_TAB, createEditorSession } from './live/editor-session.js'
import { fromHost, LiveClipError } from './live/persistence.js'
import { createLiveChannel } from './live/live-channel.js'

const binding = { workspaceId: 'ws_a', nodeId: 'node-a', projectId: 'clip_node_a' }
const mediaLibrary = { items: [] }
const canvas = { ...binding, name: 'Canvas', id: binding.projectId, mediaLibrary }
const studio = { name: 'Studio', id: 'studio', mediaLibrary }

function deferred() {
  let resolve
  const promise = new Promise(finish => { resolve = finish })
  return { promise, resolve }
}

function harness(t) {
  const trace = []
  const stored = new Map()
  const backups = []
  const host = new Map([[canvas.id, { project: canvas, binding, revision: 1 }], [studio.id, { project: studio, revision: 1 }]])
  const document = { visibilityState: 'visible' }
  let tabId = CANVAS_TAB
  let activeProject
  let subscription
  let pendingWrite
  let offline = false
  const native = {
    projectId: () => activeProject?.id,
    capture: () => ({ project: activeProject, media: {}, fingerprint: JSON.stringify(activeProject) }),
    suspend: () => trace.push('suspend'),
    welcome: () => { activeProject = undefined },
    async load({ project }, isCurrent) {
      if (!isCurrent()) return
      trace.push(`load:${project.id}:${project.name}`)
      activeProject = project
    },
    subscribe(callback) { subscription = callback; return () => {} },
  }
  const storage = {
    async readLocal(id) { return stored.get(id) },
    async writeLocal(record, receipt) {
      trace.push(`local:${record.project.id}:${record.revision}`)
      stored.set(record.project.id, { ...record })
      if (receipt) trace.push(`receipt:${receipt.requestId}`)
    },
    async backupLocal(record) { backups.push(record) },
    async readHost(id) {
      if (offline) throw new LiveClipError('EDITOR_OFFLINE', 'offline')
      return host.get(id)
    },
    async writeHost(record, options) {
      const { project, binding } = record
      trace.push(`put:${project.id}:${record.revision}`)
      if (pendingWrite) await pendingWrite.promise
      if (offline) throw new LiveClipError('EDITOR_OFFLINE', 'offline')
      const latest = host.get(project.id)
      const expected = options?.expectedRevision ?? record.localBaseRevision
      const revision = options?.revision ?? record.revision
      if ((latest?.revision ?? 0) !== expected) throw new LiveClipError('REVISION_CONFLICT', 'changed')
      if (options?.backupCurrent) backups.push(latest)
      host.set(project.id, { project, binding, revision })
      return host.get(project.id)
    },
  }
  const session = createEditorSession({
    storage, native, document,
    workbench: () => ({ getActiveSurface: () => ({ tabId, instanceId: tabId, sessionId: 'session-a', panelOpen: Boolean(tabId) }) }),
    onRelease: owner => trace.push(`release:${owner.site.projectId}`),
  })
  session.add({ id: 'canvas-entry', mode: 'canvas', tabId: CANVAS_TAB, getCanvas: () => binding, isVisible: () => tabId === CANVAS_TAB })
  session.add({ id: 'studio-entry', mode: 'standalone', tabId: STUDIO_TAB, getStudioRequest: () => ({ projectId: studio.id, key: 'opened-studio' }), isVisible: () => tabId === STUDIO_TAB })
  t.after(async () => { session.dispose(); await session.getWaiting() })
  return {
    session, trace, stored, host, backups,
    active: () => activeProject,
    change(name) { activeProject = { ...activeProject, name }; subscription() },
    switchTo(next) { tabId = next; session.reconcile() },
    setOffline(value) { offline = value },
    pauseHost() { pendingWrite = deferred(); return pendingWrite },
  }
}

test('handover invalidates the old execution immediately and saves before releasing and loading', async t => {
  const h = harness(t)
  await h.session.getWaiting()
  const old = h.session.getOwner()
  h.change('Canvas edit')
  h.trace.length = 0
  const put = h.pauseHost()
  h.switchTo(STUDIO_TAB)
  assert.equal(h.session.owns(old), false)
  assert.equal(old.token.signal.aborted, true)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(h.trace, ['suspend', 'local:clip_node_a:2', 'put:clip_node_a:2'])
  assert.equal(h.active().name, 'Canvas edit')
  put.resolve()
  await h.session.getWaiting()
  assert.deepEqual(h.trace.slice(-4), ['local:clip_node_a:2', 'release:clip_node_a', 'load:studio:Studio', 'local:studio:1'])
  assert.equal(h.host.get(canvas.id).project.name, 'Canvas edit')
  h.change('Studio edit')
  h.host.set(canvas.id, { project: { ...canvas, name: 'Latest Canvas' }, binding, revision: 3 })
  h.switchTo(CANVAS_TAB)
  await h.session.getWaiting()
  assert.equal(h.active().name, 'Latest Canvas')
  assert.equal(h.host.get(studio.id).project.name, 'Studio edit')
  assert.equal(h.session.getOwner().record.revision, 3)
})

test('offline CAS reconnect keeps both sides until each conflict choice is applied', async t => {
  for (const choice of ['local', 'host', 'copy']) {
    const h = harness(t)
    await h.session.getWaiting()
    h.setOffline(true)
    h.change('Local draft')
    const saved = await h.session.save()
    assert.deepEqual(saved, { persisted: true, synchronized: false })
    assert.equal(h.session.getSnapshot().status, 'offline')
    assert.equal(h.stored.get(canvas.id).project.name, 'Local draft')
    h.host.set(canvas.id, { project: { ...canvas, name: 'Concurrent save' }, binding, revision: 2 })
    h.setOffline(false)
    h.session.reconnect()
    await h.session.getWaiting()
    assert.equal(h.session.getSnapshot().conflict, true)
    assert.equal(h.active().name, 'Local draft')
    assert.equal(h.host.get(canvas.id).project.name, 'Concurrent save')
    assert.equal(await h.session.resolveConflict(choice), true)
    assert.equal(h.session.getSnapshot().conflict, undefined)
    assert.equal(h.host.get(canvas.id).project.name, choice === 'local' ? 'Local draft' : 'Concurrent save')
    assert.equal(h.active().name, choice === 'local' ? 'Local draft' : 'Concurrent save')
    assert.equal(h.backups[0].project.name, choice === 'local' ? 'Concurrent save' : 'Local draft')
    const copies = [...h.host.values()].filter(entry => entry.project.id !== canvas.id && entry.project.id !== studio.id)
    assert.equal(copies.length, choice === 'copy' ? 1 : 0)
    if (choice === 'copy') assert.equal(copies[0].project.name, 'Local draft')
  }
})

test('adopting a newer source does not attach the previous bytes under the same media ID', () => {
  const localItem = { id: 'original', type: 'video', omnimuxSource: { id: 'source', version: 'a' } }
  const project = { ...studio, mediaLibrary: { items: [localItem] } }
  const blob = new Blob(['old video'])
  const local = { project, media: { original: blob } }
  assert.equal(fromHost({ project, revision: 3 }, local).media.original, blob)
  const current = { ...project, mediaLibrary: { items: [{ ...localItem, omnimuxSource: { id: 'source', version: 'b' } }] } }
  assert.equal(fromHost({ project: current, revision: 4 }, local).media.original, undefined)
})

test('reconnecting sends the durable original edit receipt without claiming or applying the edit again', async t => {
  const listeners = new Map()
  const receipts = new Map()
  const trace = []
  let windowId = 'window-a'
  let disconnectReceipt = true
  let applications = 0
  const owner = {
    site: { mode: 'standalone', sessionId: 'session-a', tabInstanceId: 'tab-a', entry: { id: 'editor-a' } },
    record: { project: studio, revision: 1 }, token: new AbortController(),
  }
  const storage = {
    readReceipt: id => receipts.get(id),
    saveReceipt: (id, receipt) => receipts.set(id, structuredClone(receipt)),
    async markReceiptDelivered(id) { receipts.get(id).delivered = true },
    async recoverReceipts() { return [...receipts.values()].filter(item => !item.delivered) },
  }
  const events = {
    getWindowId: () => windowId,
    pushViewport: async () => true,
    subscribe(kind, callback) { listeners.set(kind, callback); return () => listeners.delete(kind) },
    async windowFetch(path, init) {
      const body = JSON.parse(init.body)
      const route = path.split('/').at(-1)
      trace.push(route)
      if (route === 'lease' || route === 'renew') return Response.json({ leaseId: 'lease-a', expiresAt: Date.now() + 6000 })
      if (route === 'claim') return Response.json({ command: {
        protocolVersion: 1, operation: 'clip_edit', requestId: body.requestId, projectId: studio.id,
        mode: 'standalone', tabInstanceId: 'tab-a', editorInstanceId: 'editor-a', baseRevision: 1,
        deadlineAt: Date.now() + 30_000, receiptToken: 'fixture-receipt',
      } })
      if (route === 'receipt') {
        if (disconnectReceipt) throw new LiveClipError('EDITOR_OFFLINE', 'lost response')
        assert.equal(body.receiptToken, 'fixture-receipt')
        assert.equal(body.result.revision, 2)
        return Response.json({ status: 'succeeded' })
      }
      throw new Error('Unexpected test request')
    },
  }
  const window = {
    __omnimuxHubEvents: events,
    __omnimuxWorkbench: { getCurrentSessionId: () => 'session-a' },
    setInterval, clearInterval,
  }
  const session = {
    getOwner: () => owner, owns: value => value === owner, capture() {}, reconcile() {},
    async save() { return { persisted: true, synchronized: false } },
  }
  const native = { subscribeContext: () => () => {}, isEditorReady: () => true }
  const first = createLiveChannel({ session, storage, native, window, execute: async (_command, run) => {
    run.assertCurrent()
    ++applications
    owner.record.revision = 2
    return { undoStep: true }
  } })
  t.after(() => first.dispose())
  await first.renew()
  listeners.get('omnimux:clip:command')({ payload: { requestId: 'edit-original' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(receipts.get('edit-original').body.result.revision, 2)
  assert.equal(receipts.get('edit-original').delivered, undefined)
  first.dispose()
  windowId = 'window-reconnected'
  disconnectReceipt = false
  const second = createLiveChannel({ session, storage, native, window, execute: async () => { ++applications } })
  t.after(() => second.dispose())
  await second.renew()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(receipts.get('edit-original').delivered, true)
  assert.equal(trace.filter(route => route === 'claim').length, 1)
  assert.equal(trace.filter(route => route === 'receipt').length, 2)
  assert.equal(applications, 1)
})
