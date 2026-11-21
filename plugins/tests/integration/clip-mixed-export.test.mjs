import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { once } from 'node:events'
import * as fs from 'node:fs'
import { createServer } from 'node:http'
import { createRequire, findPackageJSON } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createExportJobs } from '../../plugins/omnimux-clip/src/export-jobs.js'
import { createClipDispatcher, registerClipRoutes } from '../../plugins/omnimux-clip/src/http/routes.js'
import { createClipCommandBroker } from '../../plugins/omnimux-clip/src/live/command-broker.js'
import { resolveClipPaths } from '../../plugins/omnimux-clip/src/paths.js'
import { createClipTools } from '../../plugins/omnimux-clip/src/tools.js'
import { installCanvasClipEvents } from '../../plugins/omnimux-workflow/src/canvas/bridge/canvasClipActions.ts'
import { planCanvasInputMutation } from '../../plugins/omnimux-workflow/src/shared/graph/canvasInputMutationGateway.ts'
import { createWorkflowClipService } from '../../plugins/omnimux-workflow/src/workflow/clip/workflowClip.ts'
import { createWorkspaceStore } from '../../plugins/omnimux-workflow/src/workflow/workspace/WorkspaceStore.ts'

// Two small, independently encoded 16×16 H.264 MP4s with different durations.
const olderMedia = Buffer.from(`
AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMwbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAA
AQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAgAAAlt0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAA
AAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAAAAABAAAAAAHT
bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAgABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRl
b0hhbmRsZXIAAAABfm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAA
AQAAAT5zdGJsAAAAtnN0c2QAAAAAAAAAAQAAAKZhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAA
AAABFExhdmM2My4xLjEwMiBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAALGF2Y0MBQsAK/+EAFWdCwAraewEQAAADABAAAAMA
QPEiagEABGjOD8gAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAAyAAAAAAAAAAYc3R0cwAAAAAAAAABAAAABAAAIAAA
AAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAABAAAAAEAAAAkc3RzegAAAAAAAAAAAAAABAAAABcA
AAAJAAAACQAAAAkAAAAUc3RjbwAAAAAAAAABAAADYAAAAGF1ZHRhAAAAWW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJh
cHBsAAAAAAAAAAAAAAAALGlsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNjMuMS4xMDIAAAAIZnJlZQAAADptZGF0
AAAAE2WIhDoRigACGPHAAED2OAAIeWAAAAAFQZogEqUAAAAFQZpAE6UAAAAFQZpgE6U=
`, 'base64')
const newerMedia = Buffer.from(`
AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMobW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAA
AQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAgAAAlN0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAA
AAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHL
bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRl
b0hhbmRsZXIAAAABdm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAA
AQAAATZzdGJsAAAAtnN0c2QAAAAAAAAAAQAAAKZhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAA
AAABFExhdmM2My4xLjEwMiBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAALGF2Y0MBQsAK/+EAFWdCwAraewEQAAADABAAAAMA
QPEiagEABGjOD8gAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAAAAAAAAAAAAAYc3R0cwAAAAAAAAABAAAAAgAAIAAA
AAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAAAgAAAAEAAAAcc3RzegAAAAAAAAAAAAAAAgAAABcA
AAAJAAAAFHN0Y28AAAAAAAAAAQAAA1gAAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAA
AAAAAAAAACxpbHN0AAAAJKl0b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYzLjEuMTAyAAAACGZyZWUAAAAobWRhdAAAABNliIQ6
EYoAAjFxwABDyjgACAXgAAAABUGaIBKl
`, 'base64')

const clipPackage = new URL('../../plugins/omnimux-clip/package.json', import.meta.url)
const requireClip = createRequire(clipPackage)
const { build } = requireClip('esbuild')
const clientDir = fileURLToPath(new URL('src/client/', clipPackage))
const mediaPackage = findPackageJSON('mediabunny', clipPackage)
const mediaEntry = new URL(JSON.parse(fs.readFileSync(mediaPackage, 'utf8')).module, pathToFileURL(mediaPackage)).href
const httpFetch = globalThis.fetch
const tabId = 'omnimux-workflow:canvas'
const sessionId = 'mixed-session'
const sessionProof = 'test-window-proof'
const renderer = '__clipMixedExportFixture'
const oldMtime = 1_700_000_002
const newMtime = 1_700_000_001

// Keep the real export runner, bundle-local legacy fetch adapter and command
// executor. Replace the React mount, GPU/codec and window timing only.
const stubs = {
  react: `export const useState = value => [value, () => {}]; export const useRef = value => ({current: value});
    export const useCallback = fn => fn;
    export const useEffect = run => { globalThis.${renderer}.unmountRunner = run(); };`,
  '@openreel/core': `export const getExportEngine = () => globalThis.${renderer}.engine;
    export const describeExportSource = () => '';`,
  '@openreel/core/export/encoder-backend': 'export const getEncoderBackendFactory = () => null; export const setEncoderBackendFactory = () => {};',
  '../../core/video/video-engine': 'export const getVideoEngine = () => null;',
  './project-fonts': 'export const ensureProjectFonts = async () => {};',
  '../stores/notification-store': 'export const toast = { info() {} };',
  './export-queue/export-queue-activity': 'export const getUseExportPreviews = () => false; export const createExportFrameSource = () => null;',
  '../openreel/web/stores/project-store': `export const useProjectStore = {
    getState: () => globalThis.${renderer}.projectState, subscribe: () => () => {}, };`,
  '../stores/project-store': `export const useProjectStore = { getState: () => globalThis.${renderer}.projectState };`,
  '../openreel/core/export/export-engine': `export const createIsolatedExportEngine = () => ({
    engine: globalThis.${renderer}.agentEngine, dispose: async () => {}, });`,
  '../openreel/web/services/export-queue/export-queue-activity': 'export const isExportQueueRunning = () => false;',
  '../openreel/web/services/project-fonts': 'export const ensureProjectFonts = async () => {};',
  '../openreel/web/services/render-cache-service': 'export const renderCacheService = { isRenderingNow: () => false };',
  '../openreel/web/stores/timeline-store': 'export const useTimelineStore = { getState: () => ({ pause() {} }) };',
  '../openreel/web/stores/ui-store': `export const useUIStore = { getState: () => globalThis.${renderer}.uiState };`,
  '../media-storage': 'export const loadMediaBlob = async () => null;',
  './native-motion': 'export const assertMotionPlaybackSafe = () => {};',
  './native-edit': '', './native-view': '', './media-source': 'export const mediaDigest = () => {};',
  '../../../i18n/index.js': 'export const clipNow = () => value => value;',
}
const clientBundle = await build({
  stdin: {
    contents: `export { useExportRunner } from './openreel/web/services/export-runner';
      export { createStageStore } from './stage-store.js';
      export { runNativeCommand } from './live/run-command.ts';
      export { waitForNativeExportRender } from './live/native-export.ts';`,
    resolveDir: clientDir,
    loader: 'ts',
  },
  inject: [join(clientDir, 'export-canvas-mode.js')],
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'export-renderer-fixture', setup(builder) {
    builder.onResolve({ filter: /^mediabunny$/ }, () => ({ path: mediaEntry, external: true }))
    builder.onResolve({ filter: /.*/ }, ({ path }) => Object.hasOwn(stubs, path) ? { path, namespace: 'fixture' } : undefined)
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: stubs[path] }))
  } }],
})
const module = { exports: {} }
new Function('require', 'module', 'exports', clientBundle.outputFiles[0].text)(requireClip, module, module.exports)
const { createStageStore, runNativeCommand, useExportRunner, waitForNativeExportRender } = module.exports

function localhostPath(url) {
  return new URL(url, 'http://localhost').pathname
}

function fixtureGlobal(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, name, original)
    else delete globalThis[name]
  })
}

async function makeHarness(t) {
  const home = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'mixed-clip-export-')))
  const paths = resolveClipPaths({ homeDir: home, env: {} })
  const store = createWorkspaceStore({ workspacesDir: join(home, 'canvas') })
  const workspace = store.create('Export ordering')
  const binding = { workspaceId: workspace.id, nodeId: 'composition', projectId: 'clip_node_mixed' }
  const notes = { id: 'notes', type: 'material', position: { x: 0, y: 100 }, data: { materialType: 'text', content: 'keep me' } }
  const source = { id: binding.nodeId, type: 'video_composition', position: { x: 60, y: 0 }, data: { projectId: binding.projectId, title: 'Mixed export' } }
  store.save(workspace.id, { expectedVersion: 0, nodes: [source, notes], edges: [] })
  const workflow = createWorkflowClipService({ store, canAccessWorkspace: (id, session) => id === workspace.id && session === sessionId })
  const getWorkflowClip = () => workflow
  const viewport = {
    ok: true, sessionId, surface: { tabId, instanceId: 'canvas-tab', panelOpen: true },
    view: { extra: { workspaceId: workspace.id, clip: { ...binding, mode: 'canvas', editorInstanceId: 'editor', revision: 1 } } },
  }
  let advertised = structuredClone(viewport)
  const notifications = []
  const hostWindow = {
    windowInstanceId: 'trusted-window', isAlive: () => true, getViewport: () => advertised,
    send(_type, payload) { notifications.push(payload); return true },
  }
  const hub = {
    getWindows: () => [hostWindow],
    authorizeWindow: req => req.headers['x-window-proof'] === sessionProof ? hostWindow : null,
  }
  const broker = createClipCommandBroker({ getHubEvents: () => hub, getWorkflowClip, pollMs: 5 })
  const exportJobs = createExportJobs({ paths, getWorkflowClip })
  const dispatcher = createClipDispatcher({ paths, broker, exportJobs, getWorkflowClip })
  const requestMtime = new AsyncLocalStorage()
  let handler
  registerClipRoutes({ register(route) { handler = route.handler } }, dispatcher, {
    getHubEvents: () => hub, getConnection: () => ({ requestRejection: () => undefined }),
    fs: { ...fs, createWriteStream(path, options) {
      const stream = fs.createWriteStream(path, options)
      const mtime = requestMtime.getStore()
      if (mtime) stream.on('finish', () => fs.utimesSync(path, mtime, mtime))
      return stream
    } },
  })
  const server = createServer((req, res) => requestMtime.run(Number(req.headers['x-test-mtime']), () => void handler(req, res)))
  const deliverUploads = new Map()
  let stopClient
  let resumeEncoding
  server.listen(0, '127.0.0.1')
  t.after(async () => {
    resumeEncoding?.()
    for (const { allow } of deliverUploads.values()) allow.resolve()
    stopClient?.()
    broker.dispose()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    assert.equal(fs.realpathSync(home), home)
    fs.rmSync(home, { recursive: true, force: true })
  })
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const prefix = '/omnimux-clip/api'
  const send = (path, init) => httpFetch(`${base}${path}`, init)
  const post = async (path, body, proof = sessionProof) => {
    const response = await send(prefix + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Window-Proof': proof }, body: JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }
  const materialized = await post(`/projects/${binding.projectId}/materialize`, { binding })
  assert.equal(materialized.status, 200, JSON.stringify(materialized.body))
  const lease = await post('/live/lease', { ...viewport.view.extra.clip, tabInstanceId: viewport.surface.instanceId })
  assert.equal(lease.status, 200, JSON.stringify(lease.body))
  const uploads = []
  const replies = []
  let foreignLegacyEvents = 0
  t.mock.method(globalThis, 'fetch', async (path, init) => {
    if (init?.body instanceof Blob) {
      const bytes = Buffer.from(await init.body.arrayBuffer())
      const order = bytes.equals(olderMedia) ? 'older' : 'newer'
      assert.deepEqual(bytes, order === 'older' ? olderMedia : newerMedia)
      const latch = deliverUploads.get(order)
      uploads.push({ order, path: localhostPath(path) })
      latch.ready.resolve()
      await latch.allow.promise
      const headers = new Headers(init.headers)
      headers.set('X-Test-Mtime', order === 'older' ? String(oldMtime) : String(newMtime))
      const response = await send(path, { ...init, headers })
      replies.push({ order, status: response.status, body: await response.clone().json() })
      return response
    }
    return send(path, init)
  })
  const window = new EventTarget()
  window.__omnimuxWorkbench = { getUiContext: () => viewport }
  window.__omnimuxHubEvents = {
    getWindowId: () => hostWindow.windowInstanceId,
    pushViewport: async () => { advertised = structuredClone(viewport); return true },
    windowFetch: (path, init) => {
      const headers = new Headers(init.headers)
      headers.set('X-Window-Proof', sessionProof)
      return send(path, { ...init, headers })
    },
  }
  fixtureGlobal(t, 'window', window)
  const graph = () => store.get(workspace.id)
  const stage = createStageStore(() => ({}))
  stage.openFromCanvas(binding)
  const stop = installCanvasClipEvents({ workspaceId: workspace.id, target: window, readGraph: graph,
    updateNode() {}, defaultTitle: 'Mixed export', onManualExport() { foreignLegacyEvents++ },
    applyMutation(input) {
      const snapshot = graph()
      const planned = planCanvasInputMutation(snapshot, input)
      assert.equal(planned.status, 'allowed')
      store.save(workspace.id, { expectedVersion: snapshot.version, nodes: planned.nodes, edges: planned.edges })
    },
  })
  const project = { ...materialized.body.project, modifiedAt: 1,
    timeline: { ...materialized.body.project.timeline, duration: 2 }, mediaLibrary: { items: [] } }
  const engineFor = (getBytes) => ({
    async initialize() {},
    cancel() {},
    async *exportVideo(_project, _settings, writable) {
      const bytes = getBytes()
      yield { progress: 0.5, phase: 'encoding' }
      if (fixture.encoding) {
        fixture.encoding.ready.resolve()
        await fixture.encoding.allow.promise
      }
      await writable.write(bytes.subarray(0, 4))
      await writable.write(bytes.subarray(4))
      await writable.seek(0)
      await writable.write(bytes.subarray(0, 4))
      await writable.close()
      return { success: true }
    },
  })
  const fixture = {
    projectState: { hasOpenProject: true, project, getFullProject: () => project },
    uiState: { exportState: { isExporting: false }, setExportState(value) { this.exportState = value } },
    engine: engineFor(() => fixture.manualBytes),
    agentEngine: engineFor(() => fixture.agentBytes),
  }
  fixtureGlobal(t, renderer, fixture)
  stopClient = () => { stop(); stage.dispose() }
  const agentExport = createClipTools({ store: { paths }, broker, exportJobs, getWorkflowClip }).find(tool => tool.name === 'clip_export')
  const completed = new Map()
  async function start(caller, order) {
    const bytes = order === 'older' ? olderMedia : newerMedia
    const latch = { ready: Promise.withResolvers(), allow: Promise.withResolvers() }
    deliverUploads.set(order, latch)
    let pending
    if (caller === 'manual') {
      fixture.manualBytes = bytes
      const runner = useExportRunner({ project, canvasMode: true })
      const writable = await runner.showSavePicker('mixed.mp4', 'mp4')
      runner.beginExport(writable)
      pending = runner.runExport({ format: 'mp4' }, 'mp4', writable)
    } else {
      fixture.agentBytes = bytes
      const requestId = `agent-${order}`
      const result = agentExport.execute({ projectId: binding.projectId, requestId, confirm: true }, { agent: { session: { id: sessionId } } })
      void result.catch(() => {})
      assert.deepEqual(notifications.at(-1), { requestId })
      const claim = await post('/live/claim', { requestId, leaseId: lease.body.leaseId })
      assert.equal(claim.status, 200, JSON.stringify(claim.body))
      const upload = runNativeCommand(claim.body.command, { assertCurrent() {}, revision: () => 1 })
      pending = Promise.all([upload, result]).then(([, receipt]) => receipt)
    }
    completed.set(order, pending)
    await Promise.race([latch.ready.promise, pending.then(() => assert.fail('Export completed before uploading'))])
  }
  async function finish(order) {
    deliverUploads.get(order).allow.resolve()
    const result = await completed.get(order)
    const reply = replies.find(entry => entry.order === order)
    assert.equal(reply?.status, 200, JSON.stringify(reply?.body))
    return { receipt: reply.body, result }
  }
  async function exit() {
    stage.set(false)
    fixture.unmountRunner?.()
    advertised = null
    const release = await post('/live/release', { leaseId: lease.body.leaseId })
    assert.deepEqual(release, { status: 200, body: { released: true } })
  }
  function pauseEncoding() {
    fixture.encoding = { ready: Promise.withResolvers(), allow: Promise.withResolvers() }
    resumeEncoding = fixture.encoding.allow.resolve
    return { ready: fixture.encoding.ready.promise, resume: resumeEncoding }
  }
  return { start, finish, exit, graph, binding, post, send, viewport, uploads, notes, window, exportJobs, pauseEncoding,
    legacyEventCount: () => foreignLegacyEvents }
}

function currentOutput(graph, binding, durationMs, media) {
  const source = graph.nodes.find(node => node.id === binding.nodeId)
  const downstream = graph.nodes.filter(node => node.data.origin === 'clip_export')
  assert.equal(downstream.length, 1)
  assert.equal(source.data.status, 'completed')
  assert.equal(source.data.outputVideoUrl, downstream[0].data.mediaUrl)
  assert.equal(source.data.outputDurationMs, durationMs)
  const url = new URL(source.data.outputVideoUrl, 'http://localhost')
  assert.equal(url.searchParams.get('rev'), source.data.outputRevision)
  assert.deepEqual(fs.readFileSync(url.searchParams.get('path')), media)
  assert.deepEqual(graph.edges.map(({ source, target, sourceHandle, targetHandle }) => [source, target, sourceHandle, targetHandle]),
    [[binding.nodeId, downstream[0].id, 'out', 'in']])
  return downstream[0].id
}

for (const [first, second] of [['agent', 'manual'], ['manual', 'agent']]) {
  for (const newestFirst of [true, false]) {
    test(`${first} reserves before ${second}; ${newestFirst ? 'newer' : 'older'} publishes first`, { timeout: 15_000 }, async t => {
      const h = await makeHarness(t)
      await h.start(first, 'older')
      await h.start(second, 'newer')
      await h.exit()
      const [firstDelivery, secondDelivery] = newestFirst ? ['newer', 'older'] : ['older', 'newer']
      const initial = await h.finish(firstDelivery)
      const before = h.graph()
      const nodeId = currentOutput(before, h.binding, newestFirst ? 1000 : 2000, newestFirst ? newerMedia : olderMedia)
      const final = await h.finish(secondDelivery)
      const after = h.graph()
      if (newestFirst) assert.deepEqual(after, before, 'late older export must leave the persisted canvas byte-for-byte equivalent')
      assert.equal(currentOutput(after, h.binding, 1000, newerMedia), nodeId)
      assert.deepEqual(after.edges, before.edges)
      assert.deepEqual(after.nodes.find(node => node.id === h.notes.id).data, h.notes.data)
      const [older, newer] = newestFirst ? [final.receipt, initial.receipt] : [initial.receipt, final.receipt]
      assert.ok(newer.exportJobId > older.exportJobId, 'both callers must reserve from one monotonic sequence')
      assert.equal(Number(older.output.revision.split(':')[0]), oldMtime * 1000)
      assert.equal(Number(newer.output.revision.split(':')[0]), newMtime * 1000)
      assert.notEqual(newer.output.videoPath, older.output.videoPath)
      assert.deepEqual(fs.readFileSync(older.output.videoPath), olderMedia)
      assert.deepEqual(fs.readFileSync(newer.output.videoPath), newerMedia)
      assert.equal(newer.status, 'committed')
      assert.equal(older.status, newestFirst ? 'superseded' : 'committed')
      assert.equal(older.fileSaved, true)
      assert.equal(older.canvasCommitted, !newestFirst)
      assert.equal(h.legacyEventCount(), 0)
    })
  }
}

test('a reserved manual render survives portal exit and releases its lock before upload', { timeout: 15_000 }, async t => {
  const h = await makeHarness(t)
  const { ready, resume } = h.pauseEncoding()
  const started = h.start('manual', 'newer')
  void started.catch(() => {})
  await ready
  const lock = waitForNativeExportRender()
  try {
    await h.exit()
    assert.ok(lock, 'the project handoff must wait for the manual render')
    assert.equal(waitForNativeExportRender(), lock)
  } finally {
    resume()
  }
  await started
  await lock
  assert.equal(waitForNativeExportRender(), undefined)
  assert.equal((await h.finish('newer')).receipt.status, 'committed')
  currentOutput(h.graph(), h.binding, 1000, newerMedia)
})
