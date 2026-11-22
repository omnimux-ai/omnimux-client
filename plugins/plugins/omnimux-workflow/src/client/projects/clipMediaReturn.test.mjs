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

function setup({ opened = false, nativeTabs, workspaceExists } = {}) {
  const opens = []
  const canvas = { id: CANVAS_TAB_ID, type: CANVAS_TAB_ID, meta: { pageId: openPage.id, canvasSessionId: sessionId } }
  const context = {
    status: 'ready', sessionId, workspaceId: 'current-workspace', workspacePath: '/test/workspace',
    project: { id: 'workflow-project', pages: [openPage, recentPage] }, activePage: recentPage,
  }
  const sidebar = {
    getSnapshot: () => ({ sessionId: context.sessionId, state: { splits: { kind: 'leaf', tabs: opened ? [canvas] : [] } } }),
    getTab: id => id === CANVAS_TAB_ID ? canvas : undefined,
    openTab: async (tab, scope) => { opens.push({ tab, scope }) },
  }
  const sidebarRight = {
    mounted: { getSnapshot: () => context.sessionId },
    ...(nativeTabs && { openTabs: { getSnapshot: () => nativeTabs } }),
  }
  const manager = createClipMediaReturn({
    workspaceContext: { getSnapshot: () => context }, getSidebar: () => sidebar, getSidebarRight: () => sidebarRight,
    t: () => 'Canvas', workspaceExists: workspaceExists ?? (async () => true),
  })
  return { manager, opens, context }
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
