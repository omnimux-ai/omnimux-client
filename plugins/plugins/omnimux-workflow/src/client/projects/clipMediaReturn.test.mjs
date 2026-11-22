import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectStudioReturnOutputs, selectedStudioReturnRows } from '../../canvas/bridge/clipMediaOutputs.ts'
import { CANVAS_TAB_ID } from './projectCanvas.js'
import { createClipMediaReturn, readClipMediaReturn } from './clipMediaReturn.js'

const sessionId = 'studio-session'
const binding = { workspaceId: 'ws_open', nodeId: 'clip-node', projectId: 'clip_node_test' }
const openPage = { id: 'opened', canvasWorkspaceId: binding.workspaceId }
const recentPage = { id: 'recent', canvasWorkspaceId: 'ws_recent' }
const request = (options = {}) => ({
  id: 'test-request', sessionId, mode: 'standalone', projectId: 'clip_studio_test', title: 'Saved edit',
  isCurrent: () => true, returnToStudio: async () => true, ...options,
})

function setup({ opened = false, nativeTabs, workspaceExists, afterOpen } = {}) {
  const opens = []
  const canvas = { id: CANVAS_TAB_ID, type: CANVAS_TAB_ID, meta: { pageId: openPage.id, canvasSessionId: sessionId } }
  let legacyTabs = opened ? [canvas] : []
  let inventory = nativeTabs
  let nextTab = 10
  const listeners = new Set()
  const subscribe = listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  const notify = () => { for (const listener of listeners) listener() }
  const context = {
    status: 'ready', sessionId, workspaceId: 'current-workspace', workspacePath: '/test/workspace',
    project: { id: 'workflow-project', pages: [openPage, recentPage] }, activePage: recentPage,
  }
  const sidebar = {
    getSnapshot: () => ({ sessionId: context.sessionId, state: { splits: { kind: 'leaf', tabs: legacyTabs } } }),
    subscribeState: subscribe,
    getTab: id => id === CANVAS_TAB_ID ? canvas : undefined,
    async openTab(tab, scope) {
      opens.push({ tab, scope })
      if (inventory) {
        if (!inventory.some(row => row.sessionId === scope.sessionId && row.kind === tab.type)) {
          inventory = [...inventory, { sessionId: scope.sessionId, kind: tab.type, tabId: `tab${nextTab}` }]
          nextTab += 1
        }
      } else if (!legacyTabs.length) legacyTabs = [tab]
      notify()
      await afterOpen?.()
    },
  }
  const sidebarRight = {
    mounted: { getSnapshot: () => context.sessionId },
    ...(nativeTabs && { openTabs: { getSnapshot: () => inventory, subscribe } }),
  }
  const manager = createClipMediaReturn({
    workspaceContext: { getSnapshot: () => context }, getSidebar: () => sidebar, getSidebarRight: () => sidebarRight,
    t: () => 'Canvas', workspaceExists: workspaceExists ?? (async () => true),
  })
  const closeTab = (tabId, owner = sessionId) => {
    if (inventory) inventory = inventory.filter(row => row.tabId !== tabId || row.sessionId !== owner)
    else legacyTabs = legacyTabs.filter(row => row.id !== tabId)
    notify()
  }
  const openCanvasId = () => inventory
    ? inventory.find(row => row.sessionId === sessionId && row.kind === CANVAS_TAB_ID)?.tabId
    : legacyTabs[0]?.id
  return { manager, opens, context, closeTab, openCanvasId, listeners }
}

async function assertStudioTarget(t, opened, page) {
  const checked = []
  const { manager, opens } = setup({ opened, workspaceExists: async id => { checked.push(id); return true } })
  t.after(() => manager.dispose())
  const received = []
  const transfer = await manager.prepare(request({ returnToStudio: async rows => { received.push(rows); return true } }))
  assert.deepEqual(checked, [page.canvasWorkspaceId])
  assert.deepEqual(opens, [])
  assert.equal(await transfer.activate(), true)
  assert.equal(await transfer.activate(), false)
  assert.equal(opens.length, 1)
  assert.equal(opens[0].tab.meta.pageId, page.id)
  assert.equal(opens[0].scope.canvasWorkspaceId, page.canvasWorkspaceId)
  assert.equal(opens[0].scope.sessionId, sessionId)
  const pending = readClipMediaReturn(manager.getSnapshot(), sessionId, page.canvasWorkspaceId)
  assert.equal(pending.transfer.projectId, 'clip_studio_test')
  assert.equal(readClipMediaReturn(manager.getSnapshot(), 'other-session', page.canvasWorkspaceId), undefined)
  await manager.run(pending.transfer, () => pending.transfer.returnToStudio([]))
  assert.deepEqual(received, [[]])
  assert.equal(readClipMediaReturn(manager.getSnapshot(), sessionId, page.canvasWorkspaceId), undefined)
}

test('Studio reuses its session’s open Canvas and cancellation consumes the original handoff', t => assertStudioTarget(t, true, openPage))
test('Studio opens an existing recent Canvas when its session has no Canvas tab', t => assertStudioTarget(t, false, recentPage))

test('Closing the native Canvas releases the handoff and reopens the same recent Canvas for the current Studio project', async t => {
  const checked = []
  const { manager, opens, closeTab, openCanvasId, listeners } = setup({
    nativeTabs: [], workspaceExists: async id => { checked.push(id); return true },
  })
  t.after(() => manager.dispose())
  const oldReturns = []
  const first = await manager.prepare(request({ returnToStudio: async rows => { oldReturns.push(rows); return true } }))
  assert.equal(await first.activate(), true)
  const firstTab = openCanvasId()
  const old = readClipMediaReturn(manager.getSnapshot(), sessionId, recentPage.canvasWorkspaceId).transfer
  const unmount = manager.registerSeat(sessionId, firstTab, { read: () => ({ workspaceId: recentPage.canvasWorkspaceId }) })
  closeTab(firstTab)
  assert.equal(manager.getSnapshot().size, 0, 'The host removed the tab before its component unmounted')
  assert.equal(manager.isBound(old), false)
  assert.equal(listeners.size, 0)
  unmount()

  const returned = []
  const second = await manager.prepare(request({
    id: 'second-request', projectId: 'clip_studio_second', title: 'Second draft',
    returnToStudio: async rows => { returned.push(rows); return true },
  }))
  assert.equal(await second.activate(), true)
  first.dispose()
  assert.notEqual(openCanvasId(), firstTab)
  assert.deepEqual(checked, [recentPage.canvasWorkspaceId, recentPage.canvasWorkspaceId])
  assert.equal(opens.length, 2)
  assert.deepEqual(opens[1].scope, opens[0].scope)
  const current = readClipMediaReturn(manager.getSnapshot(), sessionId, recentPage.canvasWorkspaceId).transfer
  assert.equal(current.projectId, 'clip_studio_second')
  assert.equal(current.title, 'Second draft')
  await manager.run(current, () => current.returnToStudio([]))
  assert.deepEqual(oldReturns, [])
  assert.deepEqual(returned, [[]])
  assert.equal(manager.getSnapshot().size, 0)
  assert.equal(listeners.size, 0)
})

test('An unmounted Canvas body retains its handoff while the native tab remains open', async t => {
  const nativeTabs = [
    { sessionId, tabId: 'tab2', kind: CANVAS_TAB_ID },
    { sessionId: 'other-session', tabId: 'tab2', kind: CANVAS_TAB_ID },
  ]
  const { manager, context, closeTab, listeners } = setup({ nativeTabs })
  t.after(() => manager.dispose())
  const mount = () => manager.registerSeat(sessionId, 'tab2', {
    read: () => ({ tab: { id: 'tab2' }, workspaceId: openPage.canvasWorkspaceId }),
  })
  const unmount = mount()
  const handle = await manager.prepare(request())
  assert.equal(await handle.activate(), true)
  const pending = readClipMediaReturn(manager.getSnapshot(), sessionId, openPage.canvasWorkspaceId)
  unmount()
  context.sessionId = 'other-session'
  closeTab('tab2', 'other-session')
  assert.equal(readClipMediaReturn(manager.getSnapshot(), sessionId, openPage.canvasWorkspaceId), pending)
  context.sessionId = sessionId
  const unmountAgain = mount()
  assert.equal(manager.isBound(pending.transfer), true)
  assert.equal(await manager.prepare(request({ id: 'another-request' })), undefined)
  unmountAgain()
  manager.dispose()
  assert.equal(listeners.size, 0)
})

test('Closing the Canvas while returning keeps the busy lock until the submit settles', async t => {
  const { manager, closeTab, openCanvasId, listeners } = setup({ nativeTabs: [] })
  t.after(() => manager.dispose())
  const handle = await manager.prepare(request())
  assert.equal(await handle.activate(), true)
  const { transfer } = readClipMediaReturn(manager.getSnapshot(), sessionId, recentPage.canvasWorkspaceId)
  const finish = Promise.withResolvers()
  const submitting = manager.run(transfer, () => finish.promise)
  closeTab(openCanvasId())
  assert.equal(readClipMediaReturn(manager.getSnapshot(), sessionId, recentPage.canvasWorkspaceId).busy, true)
  assert.equal(manager.isBound(transfer), false)
  assert.equal(await manager.prepare(request({ id: 'while-submitting' })), undefined)
  let submittedAgain = false
  await manager.run(transfer, () => { submittedAgain = true; return true })
  assert.equal(submittedAgain, false)
  finish.resolve('retry')
  await submitting
  assert.equal(manager.getSnapshot().size, 0, 'A failed submit cannot restore the closed tab’s handoff')
  assert.equal(listeners.size, 0)
  const next = await manager.prepare(request({ id: 'after-submit' }))
  assert.equal(await next.activate(), true)
})

test('A Canvas closed before its open acknowledges cannot claim a replacement handoff', async t => {
  const finish = Promise.withResolvers()
  const { manager, closeTab, openCanvasId } = setup({ nativeTabs: [], afterOpen: () => finish.promise })
  t.after(() => manager.dispose())
  const first = await manager.prepare(request())
  const opening = first.activate()
  const tabId = openCanvasId()
  assert.ok(tabId)
  closeTab(tabId)
  const next = await manager.prepare(request({ id: 'next-request' }))
  assert.ok(next)
  const reopening = next.activate()
  finish.resolve()
  assert.equal(await opening, false)
  assert.equal(await reopening, true)
  assert.notEqual(openCanvasId(), tabId)
  assert.equal(readClipMediaReturn(manager.getSnapshot(), sessionId, recentPage.canvasWorkspaceId).transfer.requestId, 'next-request')
})

test('Studio can start another handoff after closing a legacy Canvas tab', async t => {
  const { manager, closeTab, openCanvasId, context } = setup()
  t.after(() => manager.dispose())
  const handle = await manager.prepare(request())
  assert.equal(await handle.activate(), true)
  context.sessionId = 'other-session'
  closeTab('not-our-tab', 'other-session')
  assert.equal(manager.getSnapshot().size, 1)
  context.sessionId = sessionId
  closeTab(openCanvasId())
  assert.equal(manager.getSnapshot().size, 0)
  const next = await manager.prepare(request({ id: 'after-legacy-close' }))
  assert.equal(await next.activate(), true)
})

test('Studio refuses missing Canvas workspaces and delayed navigation from a switched session', async t => {
  const missing = setup({ workspaceExists: async () => false })
  t.after(() => missing.manager.dispose())
  assert.equal(await missing.manager.prepare(request()), undefined)
  assert.deepEqual(missing.opens, [])

  const check = Promise.withResolvers()
  const later = setup({ workspaceExists: () => check.promise })
  t.after(() => later.manager.dispose())
  const pending = later.manager.prepare(request())
  later.context.sessionId = 'another-session'
  check.resolve(true)
  assert.equal(await pending, undefined)
  assert.deepEqual(later.opens, [])
  assert.equal(later.manager.getSnapshot().size, 0)
})

test('Canvas captures the existing upstream set only for the visible bound Portal', async t => {
  const { manager, opens, context } = setup({ opened: true })
  t.after(() => manager.dispose())
  const captured = []
  const baseline = new Map()
  let portal = binding
  const adapter = { captureBaseline: target => { captured.push(target); return baseline } }
  manager.registerSeat(sessionId, CANVAS_TAB_ID, { read: () => ({ workspaceId: binding.workspaceId, adapter, visible: true, portal }) })
  const fromCanvas = request({ mode: 'canvas', ...binding })
  const stale = manager.prepare(fromCanvas)
  portal = { ...binding, projectId: 'clip_node_other' }
  assert.equal(stale.activate(), false)
  assert.equal(manager.prepare(fromCanvas), undefined)
  portal = binding
  const handle = manager.prepare(fromCanvas)
  assert.equal(handle.activate(), true)
  assert.equal(captured.length, 1)
  assert.deepEqual(opens, [])
  const pending = readClipMediaReturn(manager.getSnapshot(), sessionId, binding.workspaceId)
  assert.equal(pending.transfer.baseline, baseline)
  context.sessionId = 'another-session'
  await manager.run(pending.transfer, () => assert.fail('The original Canvas is no longer active'))
  handle.dispose()
  assert.equal(manager.getSnapshot().size, 0)
})

test('Native Canvas tabs are resolved by session and instance even when the legacy split tree is empty', async t => {
  const nativeTabs = [
    { sessionId: 'other-session', tabId: 'tab4', kind: CANVAS_TAB_ID },
    { sessionId, tabId: 'tab2', kind: CANVAS_TAB_ID },
  ]
  const checked = []
  const { manager, opens } = setup({ nativeTabs, workspaceExists: async id => { checked.push(id); return true } })
  t.after(() => manager.dispose())
  const baseline = new Map()
  const adapter = { captureBaseline: () => baseline }
  const tab = { id: 'tab2', title: 'Open canvas', meta: { pageId: openPage.id, canvasSessionId: sessionId } }
  manager.registerSeat('other-session', 'tab4', { read: () => assert.fail('Do not read a Canvas in another session') })
  const unregister = manager.registerSeat(sessionId, tab.id, {
    read: () => ({ tab, workspaceId: openPage.canvasWorkspaceId, adapter, visible: true, portal: binding }),
  })

  const portal = manager.prepare(request({ mode: 'canvas', ...binding }))
  assert.ok(portal, 'Read the mounted native Canvas by its real tab id')
  assert.equal(portal.activate(), true)
  assert.equal(readClipMediaReturn(manager.getSnapshot(), sessionId, binding.workspaceId).transfer.baseline, baseline)
  assert.deepEqual(opens, [])
  portal.dispose()

  const studio = await manager.prepare(request())
  assert.deepEqual(checked, [openPage.canvasWorkspaceId])
  assert.equal(await studio.activate(), true)
  assert.equal(opens[0].tab.title, tab.title)
  assert.equal(opens[0].tab.meta.pageId, openPage.id)
  studio.dispose()
  unregister()
  assert.equal(manager.prepare(request({ mode: 'canvas', ...binding })), undefined)
})

function generation(nodeId, overrides = {}) {
  return { id: nodeId, type: 'material', data: { nodeKind: 'generate', status: 'completed',
    materialType: 'audio', label: 'Generated audio', ...overrides } }
}

const digestA = `sha256:${'a'.repeat(64)}`
const digestB = `sha256:${'b'.repeat(64)}`
const pinned = (workspaceId, version) => `/omnimux-workflow/api/workspaces/${workspaceId}/file?${new URLSearchParams({ rel: 'artifacts/voice.wav', rev: version })}`

test('Studio offers only completed same-workspace media and refuses a changed selection', () => {
  const url = pinned(binding.workspaceId, digestA)
  const rows = collectStudioReturnOutputs([
    generation('selected', { mediaUrl: url }),
    generation('pending', { status: 'running', mediaUrl: url }),
    generation('simulated', { simulated: true, mediaUrl: url }),
    generation('imported', { nodeKind: 'import', mediaUrl: url }),
    generation('another-workspace', { mediaUrl: pinned('ws_other', digestA) }),
    generation('external', { mediaUrl: `https://example.invalid${url}` }),
    generation('mutable', { mediaUrl: url.split('&')[0] }),
  ], binding.workspaceId)
  assert.equal(rows.length, 1)
  const selected = selectedStudioReturnRows(rows, rows)
  assert.deepEqual(selected, [{ id: `${binding.workspaceId}:selected:0`, type: 'audio', name: 'Generated audio', url, version: digestA }])
  const next = collectStudioReturnOutputs([generation('selected', { mediaUrl: pinned(binding.workspaceId, digestB) })], binding.workspaceId)
  assert.equal(selectedStudioReturnRows(next, rows), undefined)
})
