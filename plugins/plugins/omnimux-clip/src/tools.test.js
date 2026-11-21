import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, it, test } from 'node:test'
import { crc32, deflateSync } from 'node:zlib'
import { ClipDomainError } from './errors.js'
import { createExportJobs } from './export-jobs.js'
import { createClipDispatcher, registerClipRoutes } from './http/routes.js'
import { apply, inject as moduleInject } from './index.js'
import { createClipCommandBroker } from './live/command-broker.js'
import { ensureClipDirs, resolveClipPaths } from './paths.js'
import { createNativeProject } from './store/nativeProject.js'
import { createProjectStore } from './store/projectStore.js'
import { nativeProjectView } from './timeline/nativeProjectView.js'
import { createEmptySchema } from './client/store/timelineTypes.js'
import { createClipTools, registerClipTools } from './tools.js'

const prefix = '/omnimux-clip/api'
const studioTab = 'omnimux-clip:studio'
const canvasTab = 'omnimux-workflow:canvas'
const binding = { workspaceId: 'ws_canvas', nodeId: 'composition', projectId: 'clip_node_canvas' }
const exec = { agent: { session: { id: 'chat-a' } }, session: { id: 'chat-b' } }

function fixture(t, { exportJobs: jobs, workflowClip } = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'omnimux-clip-host-')))
  const paths = ensureClipDirs(resolveClipPaths({ homeDir: home, env: {} }))
  const store = createProjectStore({ paths })
  const exportJobs = jobs ?? createExportJobs({ paths })
  let clock = Date.now()
  const windows = []
  const workflowCalls = []
  const drafts = []
  const workflow = workflowClip ?? {
    resolveBinding(value, sessionId) {
      workflowCalls.push({ value, sessionId })
      return value.workspaceId === binding.workspaceId && value.nodeId === binding.nodeId && value.projectId === binding.projectId
        ? { ...binding, title: 'Canvas Clip' } : null
    },
    saveDraft(value) { drafts.push(value) },
  }
  const getWorkflowClip = () => workflow
  let authRead = 0
  const getHubEvents = () => ({
    getWindows: (sessionId) => windows.filter(({ info }) => info.getViewport()?.sessionId === sessionId).map(({ info }) => info),
    authorizeWindow(req) {
      authRead++
      return windows.find(({ proof }) => proof === req.headers['test-window-proof'])?.info
    },
  })
  const broker = createClipCommandBroker({ getHubEvents, getWorkflowClip, now: () => clock, pollMs: 5 })
  const dispatcher = createClipDispatcher({ paths, store, broker, getWorkflowClip, exportJobs })
  const specs = createClipTools({ store, broker, getWorkflowClip, exportJobs })
  const tools = new Map(specs.map((tool) => [tool.name, tool]))
  let handler
  registerClipRoutes({ register(route) { handler = route.handler; return () => {} } }, dispatcher, {
    getHubEvents, getConnection: () => ({ requestRejection: req => req.headers['deny-request'] ? 401 : undefined }),
  })
  t.after(() => {
    broker.dispose()
    assert.equal(realpathSync(home), home)
    rmSync(home, { recursive: true, force: true })
  })
  function connect(id, sessionId = 'chat-a') {
    let current
    let alive = true
    const proof = `proof-${id}`
    const events = []
    const info = {
      windowInstanceId: id,
      isAlive: () => alive,
      getViewport: () => alive ? current : null,
      send(type, payload) { events.push({ type, payload }); return alive },
    }
    const client = {
      id, proof, info, events,
      editor(projectId, canvasBinding, overrides = {}) {
        const mode = canvasBinding ? 'canvas' : 'standalone'
        const editor = { mode, projectId, editorInstanceId: `editor-${id}`, tabInstanceId: `tab:${id}`, title: projectId, revision: 1, ...canvasBinding, ...overrides }
        current = { ok: true, sessionId,
          surface: { tabId: canvasBinding ? canvasTab : studioTab, instanceId: editor.tabInstanceId, panelOpen: true },
          view: { extra: { ...(canvasBinding ? { workspaceId: canvasBinding.workspaceId } : {}), clip: editor } } }
        return editor
      },
      hide() { current = { ok: true, sessionId, surface: { tabId: 'other', instanceId: `tab:other-${id}`, panelOpen: true }, view: null } },
      retainCanvas(value) { current = { ...current, viewportDetails: { clip: { retainedCanvas: value } } } },
      disconnect() { alive = false },
    }
    client.hide()
    windows.push(client)
    return client
  }
  async function http(method, path, body, client, headers = {}) {
    const chunks = body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))]
    const req = Object.assign(Readable.from(chunks), { method, url: `${prefix}${path}`, headers: {
      host: '127.0.0.1:45812', ...(client ? { 'test-window-proof': client.proof } : {}), ...headers,
    } })
    const data = {}
    await handler(req, { writeHead(status) { data.status = status }, end(text) { data.body = text ? JSON.parse(text) : null } })
    return data
  }
  const post = (client, action, body) => http('POST', `/live/${action}`, body, client)
  return { home, paths, store, tools, specs, connect, http, post, workflowCalls, drafts,
    tick: (ms) => { clock += ms }, authRead: () => authRead,
    execute: (name, args, identity = exec) => tools.get(name).execute(args, identity),
  }
}

async function acquire(h, client, id, canvasBinding, overrides) {
  const res = await h.post(client, 'lease', client.editor(id, canvasBinding, overrides))
  assert.equal(res.status, 200, JSON.stringify(res.body))
  return res.body.leaseId
}

function editArgs(requestId, extra = {}) {
  return { requestId, description: 'Insert a video track', operations: [{ type: 'add_track', trackType: 'video' }], ...extra }
}

function editResult(revision = 2, operation = { type: 'add_track', trackId: 'new-track' }) {
  return { projectId: 'demo', revision, results: [operation], undoStep: true, persisted: true, synchronized: true }
}

function rejectsCode(promise, code, verify = () => true) {
  return assert.rejects(promise, error => error instanceof ClipDomainError && error.code === code && verify(error))
}

function byName(tools, name) {
  const tool = tools.find((item) => item.name === name)
  assert.ok(tool, `missing tool ${name}`)
  return tool
}

function legacyTimeline() {
  const schema = createEmptySchema({ projectId: 'demo' })
  schema.tracks[0].clips.push({
    id: 'clip_a', trackId: 'track_video', name: 'A', mediaType: 'video', startTimeMs: 0, durationMs: 4000,
    sourceUrl: '/tmp/a.mp4', sourceInMs: 0, sourceOutMs: 4000, speed: 1, volume: 1,
  })
  schema.canvasConfig.durationMs = 4000
  return schema
}

function withHostHome(t, home) {
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous })
}

describe('clip_* tools', () => {
  it('registers the nine frozen tool names', (t) => {
    const { specs: tools } = fixture(t)
    assert.deepEqual(
      tools.map((item) => item.name),
      ['clip_list', 'clip_create', 'clip_open', 'clip_get', 'clip_edit', 'clip_view', 'clip_snapshot', 'clip_diagnostics', 'clip_export'],
    )
  })

  it('clip_create persists an empty project and clip_list discovers it', async (t) => {
    const { specs: tools, store } = fixture(t)
    const created = await byName(tools, 'clip_create').execute({ name: ' 我的短视频 ', resolution: 'portrait', fps: 24 })
    assert.match(created.projectId, /^clip_/)
    assert.equal(created.name, '我的短视频')
    assert.equal(created.aspectRatio, '9:16')
    assert.equal(created.fps, 24)
    assert.equal(created.revision, 1)
    const saved = store.load(created.projectId)
    assert.partialDeepStrictEqual(saved.project.settings, { width: 1080, height: 1920, frameRate: 24 })
    const got = await byName(tools, 'clip_get').execute({ projectId: created.projectId })
    assert.equal(got.projectId, created.projectId)
    assert.equal(got.clipCount, 0)
    const listed = await byName(tools, 'clip_list').execute({})
    const hit = listed.projects.find((item) => item.id === created.projectId)
    assert.ok(hit, 'clip_list must surface the created project')
    assert.equal(hit.projectName, '我的短视频')
    assert.equal(hit.aspectRatio, '9:16')
    assert.equal(hit.mode, 'standalone')
  })

  it('clip_create validates name / resolution / fps', async (t) => {
    const { specs: tools, paths } = fixture(t)
    const create = byName(tools, 'clip_create')
    await assert.rejects(() => create.execute({ name: '  ' }), (e) => e instanceof ClipDomainError)
    await assert.rejects(() => create.execute({ name: 'x'.repeat(81) }), (e) => e instanceof ClipDomainError)
    await assert.rejects(() => create.execute({ name: 'ok', resolution: 'wide' }), (e) => e instanceof ClipDomainError)
    await assert.rejects(() => create.execute({ name: 'ok', fps: 0 }), (e) => e instanceof ClipDomainError)
    assert.deepEqual(readdirSync(paths.projectsDir), [])
  })

  it('clip_list sorts newest first and clamps limit', async (t) => {
    const { specs: tools, paths } = fixture(t)
    writeFileSync(join(paths.projectsDir, 'older.json'), JSON.stringify(createNativeProject('older', 'older', 1)))
    await byName(tools, 'clip_create').execute({ name: 'newer' })
    const all = await byName(tools, 'clip_list').execute({})
    assert.equal(all.count, 2)
    assert.equal(all.projects[0].projectName, 'newer')
    const one = await byName(tools, 'clip_list').execute({ limit: 1 })
    assert.equal(one.projects.length, 1)
    assert.equal(one.projects[0].id, all.projects[0].id)
    await assert.rejects(() => byName(tools, 'clip_list').execute({ limit: -1 }), (e) => e instanceof ClipDomainError)
  })

  it('reports native projects and invalid files alongside readable legacy projects', async (t) => {
    const ctx = fixture(t)
    const tools = ctx.specs
    const legacyPath = join(ctx.paths.projectsDir, 'demo.json')
    const legacy = JSON.stringify(legacyTimeline())
    const bare = createNativeProject('native-bare', 'Native bare', 2)
    const wrapped = createNativeProject('native-envelope', 'Native wrapped', 3)
    writeFileSync(legacyPath, legacy)
    writeFileSync(join(ctx.paths.projectsDir, 'native-envelope.json'), JSON.stringify({ schema: wrapped }))
    writeFileSync(join(ctx.paths.projectsDir, 'native-bare.json'), JSON.stringify(bare))
    writeFileSync(join(ctx.paths.projectsDir, 'broken.json'), 'private invalid file content')
    const listed = await byName(tools, 'clip_list').execute({})
    assert.deepEqual(listed.projects.map(({ id, mode }) => [id, mode]), [
      ['native-envelope', 'standalone'], ['native-bare', 'standalone'], ['demo', 'standalone'],
    ])
    assert.equal(listed.unavailableCount, 1)
    assert.deepEqual(listed.unavailableProjects.map(({ id, code }) => [id, code]), [['broken', 'invalid-json']])
    assert.doesNotMatch(listed.unavailableProjects[0].message, /private invalid file content/)
    const limited = await byName(tools, 'clip_list').execute({ limit: 1 })
    assert.equal(limited.unavailableProjects.length, 1)
    assert.equal(limited.unavailableCount, 1)
    const dispatcher = createClipDispatcher({ paths: ctx.paths, store: ctx.store })
    const httpList = await dispatcher.dispatch({ url: '/projects' })
    assert.equal(httpList.status, 200)
    assert.deepEqual(httpList.body.unavailableProjects, listed.unavailableProjects)
    const httpNative = await dispatcher.dispatch({ url: '/projects/native-bare' })
    assert.equal(httpNative.status, 200)
    assert.equal(httpNative.body.revision, 1)
    assert.equal(httpNative.body.project.id, bare.id)
    const httpWrapped = await dispatcher.dispatch({ url: '/projects/native-envelope' })
    assert.equal(httpWrapped.status, 200)
    assert.equal(httpWrapped.body.project.id, wrapped.id)
    assert.equal((await byName(tools, 'clip_get').execute({ projectId: 'demo' })).revision, 1)
    assert.equal(readFileSync(legacyPath, 'utf8'), legacy)
    const httpMissing = await dispatcher.dispatch({ url: '/projects/clip_node_fresh' })
    assert.equal(httpMissing.status, 404)
    assert.equal(httpMissing.body.error, 'project-not-materialized')
  })

  it('isolates a directory named like a project file in tools and HTTP', async (t) => {
    const ctx = fixture(t)
    const tools = ctx.specs
    ctx.store.create('demo', createNativeProject('demo'))
    const nativeId = '3f121f62-4324-455a-b0a0-88757c46f915'
    writeFileSync(join(ctx.paths.projectsDir, `${nativeId}.json`), JSON.stringify(createNativeProject(nativeId, 'Old native draft', 1)))
    writeFileSync(join(ctx.paths.projectsDir, 'broken.json'), 'private invalid file content')
    mkdirSync(join(ctx.paths.projectsDir, 'stale.json'))
    const registered = []
    registerClipTools({ tools: { register: (tool) => registered.push(tool) } }, tools)

    const listed = await byName(registered, 'clip_list').execute({})
    assert.deepEqual(listed.projects.map(({ id }) => id), ['demo', nativeId])
    assert.equal(listed.unavailableCount, 2)
    assert.deepEqual(listed.unavailableProjects.map(({ id, code }) => [id, code]), [
      ['broken', 'invalid-json'], ['stale', 'project-unreadable'],
    ])
    await assert.rejects(() => byName(registered, 'clip_get').execute({ projectId: 'stale' }),
      (error) => error instanceof ClipDomainError && error.code === 'project-unreadable'
        && error.message.startsWith('[project-unreadable] ') && !error.message.includes(ctx.home))
    assert.equal((await byName(registered, 'clip_get').execute({ projectId: 'demo' })).projectId, 'demo')
    assert.equal((await byName(registered, 'clip_get').execute({ projectId: nativeId })).projectId, nativeId)
    const limited = await byName(registered, 'clip_list').execute({ limit: 1 })
    assert.deepEqual(limited.unavailableProjects.map(({ id }) => id), ['broken'])
    assert.equal(limited.unavailableCount, 2)

    const dispatcher = createClipDispatcher({ paths: ctx.paths })
    const httpList = await dispatcher.dispatch({ url: '/projects' })
    assert.equal(httpList.status, 200)
    assert.deepEqual(httpList.body.projects.map(({ id }) => id), ['demo', nativeId])
    assert.deepEqual(httpList.body.unavailableProjects, listed.unavailableProjects)
    const unreadable = await dispatcher.dispatch({ url: '/projects/stale' })
    assert.equal(unreadable.status, 409)
    assert.equal(unreadable.body.error, 'project-unreadable')
    assert.equal(unreadable.body.message, listed.unavailableProjects[1].message)
    assert.doesNotMatch(unreadable.body.message, /EISDIR/)
  })

  it('clip_get returns seconds and respects view=clips', async (t) => {
    const { store, specs: tools } = fixture(t)
    store.create('demo', legacyTimeline())
    const summary = await byName(tools, 'clip_get').execute({ projectId: 'demo' })
    assert.equal(summary.projectId, 'demo')
    assert.equal(summary.durationSec, 4)
    assert.equal(summary.clipCount, 1)
    const clips = await byName(tools, 'clip_get').execute({ projectId: 'demo', view: 'clips' })
    assert.equal(clips.clips[0].startSec, 0)
    assert.equal(clips.clips[0].durationSec, 4)
    assert.equal(clips.clips[0].id, 'clip_a')
  })

  it('clip_edit enforces dry-run and one-step receipts over the live command boundary', async (t) => {
    const h = fixture(t)
    h.store.create('demo', legacyTimeline())
    const projectPath = join(h.paths.projectsDir, 'demo.json')
    const before = readFileSync(projectPath)
    const client = h.connect('one')
    const leaseId = await acquire(h, client, 'demo')
    const batch = { description: 'split at 1s', operations: [{ type: 'split_clip', clipId: 'clip_a', atSec: 1 }] }
    const split = { type: 'split_clip', clipId: 'clip_a', atSec: 1, rightClipId: 'clip_b' }

    async function claim(requestId, validateOnly) {
      const pending = h.execute('clip_edit', { ...batch, baseRevision: 1, requestId, validateOnly })
      const { command } = (await h.post(client, 'claim', { leaseId, requestId })).body
      assert.partialDeepStrictEqual(command, { baseRevision: 1, args: { ...batch, validateOnly } })
      return { pending, receipt: { leaseId, requestId, receiptToken: command.receiptToken } }
    }

    const invalid = await claim('split-invalid-dry-run', true)
    const invalidResult = rejectsCode(invalid.pending, 'INVALID_RECEIPT')
    assert.equal((await h.post(client, 'receipt', { ...invalid.receipt, result: editResult(2, split) })).status, 400)
    await invalidResult
    const dry = await claim('split-dry-run', true)
    await h.post(client, 'receipt', { ...dry.receipt, result: { ...editResult(1, split), persisted: false, synchronized: false, undoStep: false } })
    const preview = await dry.pending
    assert.equal(preview.persisted, false)
    assert.equal(preview.undoStep, false)
    assert.equal(preview.revision, 1)
    assert.deepEqual(readFileSync(projectPath), before)
    const project = await h.tools.get('clip_get').execute({ projectId: 'demo', view: 'clips' })
    assert.deepEqual(project.clips.map(({ id }) => id), ['clip_a'])

    const live = await claim('split-live', false)
    await h.post(client, 'receipt', { ...live.receipt, result: editResult(2, split) })
    const result = await live.pending
    assert.equal(result.persisted, true)
    assert.equal(result.undoStep, true)
    assert.equal(result.revision, 2)
    assert.deepEqual(result.results, [split])
  })

  it('reports saved format and live availability without changing any files', async (t) => {
    const ctx = fixture(t)
    const nativeId = '9f49d01b-9c0d-4767-beb3-4abcd1eac222'
    const nativeJson = JSON.stringify({ schema: createNativeProject(nativeId, 'Existing native') })
    const nativePath = join(ctx.paths.projectsDir, `${nativeId}.json`)
    const legacyPath = join(ctx.paths.projectsDir, 'demo.json')
    const legacy = JSON.stringify(legacyTimeline())
    writeFileSync(nativePath, nativeJson)
    writeFileSync(legacyPath, legacy)
    const live = [
      ['clip_view', { action: 'seek', toSec: 1.25 }], ['clip_snapshot', { times: [0, 1.25] }],
      ['clip_export', { confirm: true, resolution: '1080p', fps: 30 }],
    ]
    const saved = ['clip_get', 'clip_diagnostics']
    for (const name of ['clip_open', ...saved]) {
      await rejectsCode(ctx.execute(name, { projectId: 'clip_node_new' }), 'project-not-materialized')
      await rejectsCode(ctx.execute(name, { projectId: 'ghost' }), 'not-found')
      await rejectsCode(ctx.execute(name, { projectId: '../wrong' }), 'invalid-id')
    }
    for (const [name, args] of live) {
      await rejectsCode(ctx.execute(name, { ...args, projectId: '../wrong' }), 'invalid-id')
    }
    for (const projectId of ['demo', nativeId]) {
      for (const name of saved) {
        assert.equal((await ctx.execute(name, { projectId })).projectId, projectId)
      }
      await rejectsCode(ctx.execute('clip_open', { projectId }), 'EDITOR_OFFLINE')
      for (const [name, args] of live) {
        await rejectsCode(ctx.execute(name, { ...args, projectId }), 'EDITOR_OFFLINE')
      }
    }
    const hidden = ctx.connect('hidden')
    for (const [name, args] of live) {
      await rejectsCode(ctx.execute(name, { ...args, projectId: 'demo' }), 'EDITOR_NOT_VISIBLE')
    }
    assert.deepEqual(hidden.events, [])
    assert.equal(readFileSync(legacyPath, 'utf8'), legacy)
    assert.equal(readFileSync(nativePath, 'utf8'), nativeJson)
    assert.deepEqual(readdirSync(ctx.paths.projectsDir).sort(), [`${nativeId}.json`, 'demo.json'])
    assert.deepEqual(readdirSync(ctx.paths.snapshotsDir), [])
    assert.deepEqual(readdirSync(ctx.paths.exportsDir), ['jobs'])
    assert.deepEqual(readdirSync(join(ctx.paths.exportsDir, 'jobs')), [])
  })

  it('includes the stable code in the registered tool error shown by the Harness', async (t) => {
    const h = fixture(t)
    h.store.create('demo', createNativeProject('demo'))
    const registered = []
    registerClipTools({ tools: { register: (tool) => registered.push(tool) } }, h.specs)
    await assert.rejects(() => byName(registered, 'clip_get').execute({ projectId: 'clip_node_new' }),
      (error) => error instanceof ClipDomainError && error.code === 'project-not-materialized'
        && error.message.startsWith('[project-not-materialized] '))
    await assert.rejects(() => byName(registered, 'clip_open').execute({ projectId: 'demo' }, exec),
      (error) => error instanceof ClipDomainError && error.message.startsWith('[EDITOR_OFFLINE] '))
  })

  it('clip_diagnostics reports gaps without throwing', async (t) => {
    const { paths, specs: tools } = fixture(t)
    const schema = legacyTimeline()
    const track = schema.tracks[0]
    const [first] = track.clips
    first.durationMs = 1000
    first.sourceOutMs = 1000
    track.clips.push({ ...first, id: 'clip_b', name: 'B', startTimeMs: 3000, sourceUrl: '/tmp/b.mp4' })
    writeFileSync(join(paths.projectsDir, 'demo.json'), JSON.stringify(schema))
    const report = await byName(tools, 'clip_diagnostics').execute({ projectId: 'demo' })
    assert.equal(report.ok, false)
    assert.ok(report.issues.some((item) => item.code === 'timeline_gap'))
    assert.deepEqual(report.issues.filter((item) => item.code === 'timeline_gap').map(({ fromSec, toSec }) => [fromSec, toSec]), [[1, 3]])
  })

  it('missing projectId and unknown project throw ClipDomainError, never { ok: false }', async (t) => {
    const { specs: tools } = fixture(t)
    await assert.rejects(
      () => byName(tools, 'clip_get').execute({}),
      (error) => error instanceof ClipDomainError && error.code === 'SESSION_REQUIRED',
    )
    await assert.rejects(
      () => byName(tools, 'clip_get').execute({ projectId: 'nope' }),
      (error) => error instanceof ClipDomainError && error.code === 'not-found',
    )
  })
})

describe('apply() host entry', () => {
  it('declares strict injects including systemPrompt (regression: boot crash)', () => {
    assert.deepEqual(moduleInject, ['tools', 'systemPrompt'])
  })

  it('registers tools, prompt and clipEditor seam', (t) => {
    withHostHome(t, fixture(t).home)
    const registered = []
    const provided = {}
    const sections = []
    apply({
      tools: { register: (tool) => registered.push(tool.name) },
      systemPrompt: { section: (spec) => sections.push(spec.name) },
      provide: (name, value) => { if (name === 'clipEditor') provided.clipEditor = value },
      inject: () => {},
    })
    assert.deepEqual(registered, [
      'clip_list', 'clip_create', 'clip_open',
      'clip_get', 'clip_edit', 'clip_view', 'clip_snapshot', 'clip_diagnostics', 'clip_export',
    ])
    assert.deepEqual(sections, ['clip:ops'])
    assert.equal(typeof provided.clipEditor.open, 'function')
    assert.equal(typeof provided.clipEditor.export, 'function')
  })

  it('mounts routes via canonical guarded webServer resolution (regression: register without inject)', (t) => {
    withHostHome(t, fixture(t).home)
    const mounted = []
    const effects = []
    let captured
    apply({ inject: (deps, cb) => { if (deps.includes('webServer')) captured = cb } })
    captured({
      get: (name) => name === 'webServer' ? { register: (route) => { mounted.push(route.path); return () => {} } } : undefined,
      effect: (fn, label) => { effects.push(label); fn() },
    })
    apply({ inject: (deps, cb) => { if (deps.includes('webServer')) cb({}) } })
    assert.deepEqual(mounted, ['/omnimux-clip/api'])
    assert.deepEqual(effects, ['omnimux-clip: http routes'])
  })
})

test('registers the nine Clip tools and forwards the Cordis execution identity', async t => {
  const h = fixture(t)
  const registered = []
  registerClipTools({ tools: { register: tool => registered.push(tool) } }, h.specs)
  assert.deepEqual(registered.map(tool => tool.name), [
    'clip_list', 'clip_create', 'clip_open', 'clip_get', 'clip_edit', 'clip_view', 'clip_snapshot', 'clip_diagnostics', 'clip_export',
  ])
  const clientA = h.connect('one')
  const clientB = h.connect('two', 'chat-b')
  const leaseId = await acquire(h, clientA, 'demo')
  await acquire(h, clientB, 'decoy')
  const execute = registered.find(({ name }) => name === 'clip_view').execute
  const result = execute({ action: 'pause', requestId: 'forwarded-exec' }, exec)
  assert.deepEqual(clientA.events, [{ type: 'omnimux:clip:command', payload: { requestId: 'forwarded-exec' } }])
  assert.deepEqual(clientB.events, [])
  const request = { leaseId, requestId: 'forwarded-exec' }
  const { command } = (await h.post(clientA, 'claim', request)).body
  const state = { projectId: 'demo', action: 'pause', revision: 1, durationSec: 3, playheadSec: 2, isPlaying: false, selectedClipIds: ['clip-1'] }
  await h.post(clientA, 'receipt', { ...request, receiptToken: command.receiptToken, result: { ...state, mediaPath: '/private/asset.mp4' } })
  assert.deepEqual(await result, { ...state, requestId: 'forwarded-exec' })
  await rejectsCode(execute({ action: 'pause' }, {}), 'SESSION_REQUIRED', error => error.message.startsWith('[SESSION_REQUIRED]'))
  await rejectsCode(execute({ action: 'pause', sessionId: 'chat-a' }, {}), 'invalid-json')
})

test('manual project PUT requires compare-and-swap and returns the native envelope', async t => {
  const h = fixture(t)
  const project = createNativeProject('demo', 'Original')
  assert.equal((await h.http('PUT', '/projects/demo', { project })).status, 400)
  const created = await h.http('PUT', '/projects/demo', { project, expectedRevision: 0, revision: 1 })
  assert.equal(created.status, 200)
  assert.equal(created.body.project.id, 'demo')
  assert.equal(created.body.revision, 1)
  assert.deepEqual((await h.http('GET', '/projects/demo')).body, created.body)
  const updated = await h.http('PUT', '/projects/demo', { project: { ...project, name: 'User draft' }, expectedRevision: 1, revision: 2 })
  assert.equal(updated.status, 200)
  const conflict = await h.http('PUT', '/projects/demo', { project, expectedRevision: 1, revision: 3 })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.body.error, 'REVISION_CONFLICT')
  assert.deepEqual(conflict.body.details, { currentRevision: 2 })
  assert.equal((await h.http('GET', '/projects/demo')).body.project.name, 'User draft')
  const replay = await h.http('PUT', '/projects/demo', { project: { ...project, name: 'User draft' }, expectedRevision: 1, revision: 2 })
  assert.deepEqual(replay.body, updated.body)
})

test('manual export upload does not accept a source path in its body', async t => {
  const h = fixture(t)
  h.store.create('demo', createNativeProject('demo', 'Draft'))
  const projectPath = join(h.paths.projectsDir, 'demo.json')
  const original = readFileSync(projectPath)
  const result = await h.http('POST', '/projects/demo/save-export', { path: projectPath, base64: 'YWJj' })
  assert.equal(result.status, 403)
  assert.equal(result.body.error, 'path-denied')
  assert.deepEqual(readFileSync(projectPath), original)
  assert.deepEqual(readdirSync(h.paths.exportsDir), ['jobs'])
  assert.deepEqual(readdirSync(join(h.paths.exportsDir, 'jobs')), [])
})

test('materializes only the Workflow-owned canvas binding and advances the draft pointer after CAS', async t => {
  const h = fixture(t)
  const client = h.connect('canvas', 'chat-a')
  const path = `/projects/${binding.projectId}`
  const materializePath = `${path}/materialize`
  const draft = { binding, title: 'Draft' }
  assert.equal((await h.http('GET', path)).body.error, 'project-not-materialized')
  const unauthenticated = await h.http('POST', materializePath, draft)
  assert.equal(unauthenticated.status, 403)
  assert.equal(unauthenticated.body.error, 'WINDOW_UNAUTHORIZED')
  assert.equal((await h.http('GET', path)).body.error, 'project-not-materialized')
  assert.deepEqual(h.workflowCalls, [])
  const fake = await h.http('POST', materializePath, { binding: { ...binding, nodeId: 'wrong' } }, client)
  assert.equal(fake.body.error, 'clip-binding-mismatch')
  assert.deepEqual(h.drafts, [])
  const first = await h.http('POST', materializePath, draft, client)
  assert.equal(first.status, 200)
  assert.partialDeepStrictEqual(first.body, { projectId: binding.projectId, revision: 1, binding })
  const update = { project: { ...first.body.project, name: 'updated' }, expectedRevision: 1, revision: 2 }
  const unproven = await h.http('PUT', path, update)
  assert.equal(unproven.status, 403)
  assert.equal(unproven.body.error, 'WINDOW_UNAUTHORIZED')
  assert.deepEqual(h.drafts, [{ ...binding, revision: 1 }])
  assert.equal((await h.http('GET', path)).body.revision, 1)
  const second = await h.http('PUT', path, update, client)
  assert.equal(second.status, 200)
  assert.equal((await h.http('GET', path)).body.project.name, 'updated')
  assert.deepEqual(h.drafts, [{ ...binding, revision: 1 }, { ...binding, revision: 2 }])
  const other = await h.http('PUT', path, { project: first.body.project, binding: { ...binding, nodeId: 'wrong' }, expectedRevision: 2, revision: 3 }, client)
  assert.equal(other.status, 409)
  assert.equal(h.drafts.length, 2)
  assert.deepEqual(h.workflowCalls, [
    { value: { ...binding, nodeId: 'wrong' }, sessionId: 'chat-a' },
    { value: binding, sessionId: 'chat-a' },
    { value: binding, sessionId: 'chat-a' },
  ])
})

test('authenticates on the original HTTP boundary before checking window proof and visible native identity', async t => {
  const h = fixture(t)
  const client = h.connect('one')
  const editor = client.editor('demo', null, { revision: 7 })
  const denied = await h.http('POST', '/live/lease', editor, client, { 'deny-request': 'yes' })
  assert.equal(denied.status, 401)
  assert.equal(h.authRead(), 0)
  assert.equal((await h.post(null, 'lease', { ...editor, windowInstanceId: client.id })).status, 403)
  assert.equal((await h.post(client, 'lease', { ...editor, tabInstanceId: 'tab:wrong' })).body.error, 'EDITOR_NOT_VISIBLE')
  assert.equal((await h.post(client, 'lease', { ...editor, projectId: 'decoy' })).body.error, 'EDITOR_NOT_VISIBLE')
  assert.equal((await h.post(client, 'lease', { ...editor, editorInstanceId: 'decoy' })).body.error, 'EDITOR_NOT_VISIBLE')
  client.editor('demo', null, { editorInstanceId: undefined })
  assert.equal((await h.post(client, 'lease', editor)).body.error, 'EDITOR_NOT_VISIBLE')
  client.editor('demo', null, { revision: 7 })
  const lease = (await h.post(client, 'lease', editor)).body
  assert.equal(lease.revision, 7)
  assert.equal((await h.post(client, 'renew', { leaseId: lease.leaseId, revision: 8 })).body.leaseId, lease.leaseId)
  assert.equal((await h.post(client, 'renew', { leaseId: lease.leaseId, revision: 4 })).body.revision, 8)
  client.hide()
  assert.equal((await h.post(client, 'renew', { leaseId: lease.leaseId, revision: 8 })).body.error, 'EDITOR_NOT_VISIBLE')
  assert.equal((await h.post(client, 'release', { leaseId: lease.leaseId })).body.released, true)
})

test('blocks new and existing leases during a conflict and requires a fresh lease afterward', async t => {
  const h = fixture(t)
  const client = h.connect('one')
  const leaseId = await acquire(h, client, 'demo')
  const conflicted = client.editor('demo', null, { conflict: true })
  assert.equal((await h.post(client, 'renew', { leaseId, revision: 1 })).body.error, 'EDITOR_NOT_VISIBLE')
  assert.equal((await h.post(client, 'lease', conflicted)).body.error, 'EDITOR_NOT_VISIBLE')
  client.editor('demo')
  assert.equal((await h.post(client, 'renew', { leaseId, revision: 1 })).body.error, 'LEASE_INVALID')
  await rejectsCode(h.execute('clip_view', { action: 'pause' }), 'EDITOR_NOT_VISIBLE')
  assert.deepEqual(client.events, [])
  assert.notEqual(await acquire(h, client, 'demo'), leaseId)
})

test('requires a Workflow binding for a canvas lease using the proven conversation', async t => {
  const h = fixture(t)
  const client = h.connect('canvas')
  const wrong = { ...binding, nodeId: 'other-node' }
  assert.equal((await h.post(client, 'lease', client.editor(binding.projectId, wrong))).body.error, 'clip-binding-mismatch')
  assert.equal((await h.post(client, 'lease', client.editor(binding.projectId, binding))).status, 200)
  assert.deepEqual(h.workflowCalls.at(-1), { value: binding, sessionId: 'chat-a' })
})

test('blocks ambiguous edits and binds claim, receipt and idempotency to exactly one window', async t => {
  const h = fixture(t)
  const a = h.connect('one')
  const b = h.connect('two')
  const firstLease = await acquire(h, a, 'demo')
  const secondLease = await acquire(h, b, 'other')
  await rejectsCode(h.execute('clip_edit', editArgs('ambiguous')), 'AMBIGUOUS_TARGET', error =>
    error.details.candidates.map(({ projectId }) => projectId).join(',') === 'demo,other')
  await rejectsCode(h.execute('clip_edit', editArgs('wrong-project', { projectId: 'unrelated' })), 'AMBIGUOUS_TARGET')
  assert.deepEqual([...a.events, ...b.events], [])
  const args = editArgs('exact-edit', { projectId: 'demo', windowInstanceId: 'one', baseRevision: 1 })
  const result = h.execute('clip_edit', args)
  const duplicate = h.execute('clip_edit', { ...args, operations: [{ trackType: 'video', type: 'add_track' }] })
  assert.deepEqual(a.events, [{ type: 'omnimux:clip:command', payload: { requestId: 'exact-edit' } }])
  assert.deepEqual(b.events, [])
  const request = { leaseId: firstLease, requestId: args.requestId }
  assert.equal((await h.post(b, 'claim', request)).status, 403)
  assert.equal((await h.post(a, 'claim', { ...request, leaseId: secondLease })).status, 403)
  assert.equal((await h.post(a, 'receipt', { ...request, result: editResult() })).body.error, 'REQUEST_NOT_CLAIMED')
  const { command } = (await h.post(a, 'claim', request)).body
  assert.equal(command.operation, 'clip_edit')
  assert.equal(command.baseRevision, 1)
  assert.equal(command.editorInstanceId, 'editor-one')
  assert.deepEqual((await h.post(a, 'claim', request)).body, { status: 'claimed' })
  const receipt = { ...request, receiptToken: command.receiptToken, result: editResult() }
  const wrongToken = command.receiptToken.replace(/^./, (letter) => letter === 'A' ? 'B' : 'A')
  assert.equal((await h.post(b, 'receipt', receipt)).status, 403)
  for (const receiptToken of [wrongToken, undefined]) {
    const denied = await h.post(a, 'receipt', { ...receipt, receiptToken })
    assert.equal(denied.status, 403)
    assert.equal(denied.body.error, 'WINDOW_UNAUTHORIZED')
  }
  assert.deepEqual((await h.post(a, 'claim', request)).body, { status: 'claimed' })
  const accepted = await h.post(a, 'receipt', receipt)
  assert.equal(accepted.body.status, 'succeeded')
  assert.equal((await h.post(a, 'receipt', { ...receipt, receiptToken: wrongToken })).status, 403)
  assert.deepEqual(await h.post(a, 'receipt', receipt), accepted)
  assert.equal((await h.post(a, 'receipt', { ...receipt, result: editResult(3) })).body.error, 'REQUEST_ID_CONFLICT')
  assert.deepEqual(await result, accepted.body.result)
  assert.deepEqual(await duplicate, accepted.body.result)
  assert.deepEqual(await h.execute('clip_edit', args), accepted.body.result)
  await rejectsCode(h.execute('clip_edit', { ...args, description: 'Different edit' }), 'REQUEST_ID_CONFLICT')
  await rejectsCode(h.execute('clip_edit', { ...args, windowInstanceId: 'two' }), 'REQUEST_ID_CONFLICT')
  assert.equal(a.events.length, 1)
  const fallbackExec = { agent: { session: {} }, session: { id: 'chat-a' } }
  await rejectsCode(h.execute('clip_edit', editArgs('old-fresh-request', { windowInstanceId: 'one', baseRevision: 1 }), fallbackExec),
    'REVISION_CONFLICT', error => error.details.currentRevision === 2)
})

test('lists a retained canvas project as hidden after its lease is released and Studio takes over', async t => {
  const h = fixture(t)
  const client = h.connect('one')
  const canvasLease = await acquire(h, client, binding.projectId, binding)
  assert.equal((await h.post(client, 'release', { leaseId: canvasLease })).body.released, true)
  await acquire(h, client, 'demo')
  client.retainCanvas(binding)

  const hiddenEdit = requestId => h.execute('clip_edit', editArgs(requestId, { projectId: binding.projectId }))
  await assert.rejects(hiddenEdit('hidden-canvas'), error => {
    assert.equal(error.code, 'AMBIGUOUS_TARGET')
    assert.deepEqual(error.details.candidates, [
      { projectId: 'demo', mode: 'standalone', title: 'demo', windowInstanceId: 'one', visible: true },
      { ...binding, mode: 'canvas', title: 'Canvas Clip', windowInstanceId: 'one', visible: false },
    ])
    return true
  })
  assert.deepEqual(h.workflowCalls.at(-1), { value: binding, sessionId: 'chat-a' })

  for (const hint of [{ ...binding, nodeId: 'other-node' }, null]) {
    client.retainCanvas(hint)
    await assert.rejects(hiddenEdit(`retained-${hint?.nodeId ?? 'closed'}`), error => {
      assert.equal(error.code, 'AMBIGUOUS_TARGET')
      assert.deepEqual(error.details.candidates.map(candidate => candidate.projectId), ['demo'])
      return true
    })
  }
  assert.deepEqual(client.events, [])
})

test('dispatches the authenticated viewport revision before renewal and rechecks at claim', async t => {
  const h = fixture(t)
  const client = h.connect('one')
  const leaseId = await acquire(h, client, 'demo', null, { revisionEpoch: 0 })
  client.editor('demo', null, { revision: 2, revisionEpoch: 0 })
  const requestId = 'viewport-before-renew'
  const pending = h.execute('clip_edit', editArgs(requestId, { baseRevision: 2 }))
  const settlement = pending.then(result => ({ result }), error => ({ error }))

  assert.deepEqual(client.events, [{ type: 'omnimux:clip:command', payload: { requestId } }])
  client.editor('demo', null, { revision: 3, revisionEpoch: 0 })
  const claim = await h.post(client, 'claim', { leaseId, requestId })
  assert.equal(claim.status, 409)
  assert.deepEqual(claim.body.details, { currentRevision: 3 })
  assert.equal(claim.body.command, undefined)
  assert.equal((await settlement).error?.code, 'REVISION_CONFLICT')
})

test('a lower adopted viewport supersedes a stale heartbeat and a delayed old receipt on the same lease', async t => {
  const h = fixture(t)
  const client = h.connect('one')
  const leaseId = await acquire(h, client, 'demo', null, { revision: 7, revisionEpoch: 0 })
  const delayedArgs = editArgs('before-adoption', { baseRevision: 7 })
  const delayed = h.execute('clip_edit', delayedArgs)
  const delayedSettlement = delayed.then(result => ({ result }), error => ({ error }))
  const request = { leaseId, requestId: delayedArgs.requestId }
  const { command } = (await h.post(client, 'claim', request)).body
  assert.equal(command.baseRevision, 7)

  client.editor('demo', null, { revision: 3, revisionEpoch: 1 })
  const staleRenew = await h.post(client, 'renew', { leaseId, revision: 7, revisionEpoch: 0 })
  assert.equal(staleRenew.body.leaseId, leaseId)
  assert.equal(staleRenew.body.revision, 3)
  assert.equal((await h.post(client, 'receipt', {
    ...request, receiptToken: command.receiptToken, result: editResult(8),
  })).body.status, 'succeeded')
  assert.equal((await delayedSettlement).result?.revision, 8)
  const newArgs = editArgs('after-adoption', { baseRevision: 3 })
  const fresh = h.execute('clip_edit', newArgs)
  const freshSettlement = fresh.then(result => ({ result }), error => ({ error }))
  const freshRequest = { leaseId, requestId: newArgs.requestId }
  const freshReply = (await h.post(client, 'claim', freshRequest)).body.command
  assert.equal(freshReply.baseRevision, 3)
  assert.equal(freshReply.revisionEpoch, 1)
  assert.equal((await h.post(client, 'receipt', {
    ...freshRequest, receiptToken: freshReply.receiptToken, result: editResult(4),
  })).body.status, 'succeeded')
  assert.equal((await freshSettlement).result?.revision, 4)
})

test('rechecks baseRevision at claim and protects the latest user edit', async t => {
  const h = fixture(t)
  const client = h.connect('one')
  const leaseId = await acquire(h, client, 'demo')
  const result = h.execute('clip_edit', editArgs('race-edit', { baseRevision: 1 }))
  const failure = rejectsCode(result, 'REVISION_CONFLICT', error => error.details.currentRevision === 9)
  await h.post(client, 'renew', { leaseId, revision: 9 })
  const claim = await h.post(client, 'claim', { leaseId, requestId: 'race-edit' })
  assert.equal(claim.status, 409)
  assert.deepEqual(claim.body.details, { currentRevision: 9 })
  assert.equal(claim.body.command, undefined)
  await failure
})

test('a disconnected command can recover its proven receipt without redispatch', async t => {
  const h = fixture(t)
  const first = h.connect('old')
  const leaseId = await acquire(h, first, 'demo')
  const args = editArgs('recover-edit')
  const pending = h.execute('clip_edit', args)
  const result = rejectsCode(pending, 'outcome-unknown', error => error.details.reason === 'EDITOR_OFFLINE')
  const ids = { leaseId, requestId: args.requestId }
  const { command } = (await h.post(first, 'claim', ids)).body
  first.disconnect()
  await result
  const reconnect = h.connect('new')
  await acquire(h, reconnect, 'demo')
  const wrongSession = h.connect('other-chat', 'chat-b')
  const body = { ...ids, receiptToken: command.receiptToken, result: editResult() }
  assert.equal((await h.post(reconnect, 'claim', ids)).status, 403)
  assert.equal((await h.post(wrongSession, 'receipt', body)).status, 404)
  assert.equal((await h.post(reconnect, 'receipt', { ...body, receiptToken: 'wrong' })).status, 403)
  const recovered = (await h.post(reconnect, 'receipt', body)).body.result
  assert.equal(recovered.revision, 2)
  assert.deepEqual(await h.execute('clip_edit', args), recovered)
  assert.deepEqual(reconnect.events, [])
  assert.equal(first.events.length, 1)
})

test('an expired or hidden command never becomes executable later', async t => {
  const h = fixture(t)
  const client = h.connect('one')
  const leaseId = await acquire(h, client, 'demo')
  const args = { requestId: 'expired-view', action: 'pause' }
  const pending = h.execute('clip_view', args)
  const failure = rejectsCode(pending, 'REQUEST_EXPIRED')
  h.tick(8500)
  const claim = await h.post(client, 'claim', { leaseId, requestId: args.requestId })
  assert.equal(claim.body.error.code, 'REQUEST_EXPIRED')
  assert.equal(claim.body.command, undefined)
  await failure
  h.tick(11 * 60_000)
  await acquire(h, client, 'demo')
  await rejectsCode(h.execute('clip_view', args), 'REQUEST_EXPIRED')
  const hidden = h.execute('clip_view', { requestId: 'hidden-view', action: 'pause' })
  const hiddenFailure = rejectsCode(hidden, 'EDITOR_NOT_VISIBLE')
  client.hide()
  await hiddenFailure
  assert.equal(client.events.length, 2)
})

test('clip_get prefers the safe live projection, advances the lease and falls back to saved projects', async t => {
  const h = fixture(t)
  h.store.create('demo', createNativeProject('demo', 'Saved draft'))
  h.store.create('other', createNativeProject('other', 'Other draft'))
  const client = h.connect('one')
  const leaseId = await acquire(h, client, 'demo', undefined, { revision: 4 })
  assert.equal((await h.execute('clip_get', { projectId: 'other' })).title, 'Other draft')
  assert.deepEqual(client.events, [])
  const read = h.execute('clip_get', { view: 'full', requestId: 'read-project' })
  const request = { leaseId, requestId: 'read-project' }
  const { command } = (await h.post(client, 'claim', request)).body
  assert.equal(command.operation, 'clip_get')
  const live = nativeProjectView({ ...h.store.load('demo'), revision: 5 }, { view: 'full', playheadSec: 0.8 })
  const source = { id: 'source:clip-1', version: '1:1280' }
  const result = { ...live, title: 'Live draft', mediaCount: 2, fakePath: '/private/file.mp4', media: [
    { mediaId: 'media-1', type: 'video', omnimuxSource: { ...source, path: '/private/file.mp4' } },
    { mediaId: 'media-2', type: 'image', omnimuxSource: { id: '/private/file.png', version: '1' } },
  ] }
  await h.post(client, 'receipt', { ...request, result, receiptToken: command.receiptToken })
  const snapshot = await read
  assert.equal(snapshot.title, 'Live draft')
  assert.equal(snapshot.playheadSec, 0.8)
  assert.equal(snapshot.revision, 5)
  assert.equal(snapshot.fakePath, undefined)
  assert.deepEqual(snapshot.media, [{ mediaId: 'media-1', type: 'video', omnimuxSource: source }, { mediaId: 'media-2', type: 'image' }])

  const edit = h.execute('clip_edit', editArgs('after-read', { baseRevision: snapshot.revision }))
  const next = { leaseId, requestId: 'after-read' }
  const claimed = await h.post(client, 'claim', next)
  assert.equal(claimed.body.command.baseRevision, 5)
  await h.post(client, 'receipt', { ...next, receiptToken: claimed.body.command.receiptToken, result: editResult(6) })
  assert.equal((await edit).revision, 6)
})

test('clip_open waits for the exact visible canvas lease on the selected window', async t => {
  const h = fixture(t)
  const client = h.connect('one')
  const other = h.connect('two')
  const params = { ...binding, requestId: 'open-node', windowInstanceId: client.id }
  let resolved = false
  const opening = h.execute('clip_open', params).then(value => { resolved = true; return value })
  assert.deepEqual(client.events, [{ type: 'omnimux:clip:open', payload: { requestId: params.requestId, sessionId: 'chat-a',
    view: { workspaceId: binding.workspaceId, clip: { ...binding, mode: 'canvas' } } } }])
  assert.deepEqual(other.events, [])
  await acquire(h, other, binding.projectId, binding)
  await acquire(h, client, 'wrong')
  assert.equal(resolved, false)
  await acquire(h, client, binding.projectId, binding)
  const opened = await opening
  assert.equal(opened.windowInstanceId, client.id)
  assert.partialDeepStrictEqual(opened, { projectId: binding.projectId, mode: 'canvas', binding })
  assert.deepEqual(await h.execute('clip_open', params), opened)
  assert.equal(client.events.length, 1)
})

function samplePng(width, height) {
  function chunk(name, data) {
    const header = Buffer.alloc(4)
    header.writeUInt32BE(data.length)
    const payload = Buffer.concat([Buffer.from(name), data])
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE(crc32(payload))
    return Buffer.concat([header, payload, checksum])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const rows = Buffer.alloc((4 * width + 1) * height)
  rows[1] = 255
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

test('clip_snapshot delivers verified PNG bytes and rejects a placeholder or path-only receipt', async t => {
  const h = fixture(t)
  const client = h.connect('one')
  const leaseId = await acquire(h, client, 'demo')
  const tool = h.tools.get('clip_snapshot')
  const real = samplePng(12, 9)
  const frames = [{ path: '/outside/any.png' }, { base64: samplePng(1, 1).toString('base64') },
    { base64: real.toString('base64'), timeSec: 0.96, requestedTimeSec: 1 }]
  for (const [index, frame] of frames.entries()) {
    const requestId = `snapshot-${index}`
    const attempt = tool.execute({ requestId, times: [1] }, exec)
    const failure = index < 2 ? rejectsCode(attempt, 'INVALID_RECEIPT') : null
    const { command } = (await h.post(client, 'claim', { leaseId, requestId })).body
    const receipt = await h.post(client, 'receipt', { leaseId, requestId, receiptToken: command.receiptToken,
      result: { revision: 1, frames: [{ timeSec: 1, ...frame }] } })
    if (failure) {
      assert.equal(receipt.status, 400)
      await failure
      assert.deepEqual(readdirSync(h.paths.snapshotsDir), [])
    } else {
      const value = await attempt
      assert.deepEqual(readFileSync(value.frames[0].path), real)
      assert.equal(value.frames[0].width, 12)
      assert.equal(value.frames[0].height, 9)
      assert.equal(value.frames[0].timeSec, 0.96)
      assert.equal(value.frames[0].requestedTimeSec, 1)
      assert.equal(value.frames[0].base64, undefined)
      assert.match(tool.output.render({}, value)[0].text, /12×9 PNG/)
    }
  }
})

test('rejects Motion approval fields and resolves only workspace media when the editor claims', async t => {
  const h = fixture(t)
  const client = h.connect('one')
  const leaseId = await acquire(h, client, 'demo')
  const identity = { session: { id: 'chat-a', header: { cwd: h.paths.projectsDir } } }
  writeFileSync(join(h.paths.projectsDir, 'video.mp4'), 'media bytes')
  writeFileSync(join(h.home, 'outside.mp4'), 'outside')
  symlinkSync(join(h.home, 'outside.mp4'), join(h.paths.projectsDir, 'symlink.mp4'))
  await rejectsCode(h.execute('clip_edit', editArgs('motion-attempt', {
    operations: [{ type: 'set_clip_effect', clipId: 'c', transform: { approved: true } }],
  }), identity), 'motion-expression-denied')
  for (const [requestId, path, expected] of [['external-import', 'https://example.invalid/video.mp4', 403], ['unsafe-import', 'symlink.mp4', 403], ['workspace-import', 'video.mp4', 200]]) {
    const pending = h.execute('clip_edit', editArgs(requestId, { operations: [{ type: 'import_media', path }] }), identity)
    const failure = expected === 403 ? rejectsCode(pending, 'path-denied') : null
    const { status, body } = await h.post(client, 'claim', { leaseId, requestId })
    assert.equal(status, expected)
    if (failure) await failure
    else {
      const [operation] = body.command.args.operations
      assert.equal(operation.path, undefined)
      const source = new URL(operation.sourceUrl, 'http://localhost')
      assert.equal(source.pathname, '/omnimux-workflow/api/local-file')
      assert.equal(source.searchParams.get('path'), join(h.paths.projectsDir, path))
      assert.ok(source.searchParams.get('rev'))
      const result = editResult(2, { type: 'import_media', mediaId: 'media-1', path: '/private/media.mp4' })
      await h.post(client, 'receipt', { leaseId, requestId, receiptToken: body.command.receiptToken, result })
      assert.deepEqual((await pending).results, [{ type: 'import_media', mediaId: 'media-1' }])
    }
  }
})

test('the tool accepts the native filter intensity ceiling and rejects values above it', async t => {
  const h = fixture(t)
  const client = h.connect('one')
  const leaseId = await acquire(h, client, 'demo')
  const params = (intensity) => editArgs('filter-edit', {
    operations: [{ type: 'set_clip_effect', clipId: 'clip-1', filterId: 'neutral', filterIntensity: intensity }],
  })
  await rejectsCode(h.execute('clip_edit', params(101)), 'invalid-json', (error) => error.message.includes('filterIntensity'))
  assert.deepEqual(client.events, [])
  const result = h.execute('clip_edit', params(100))
  const request = { leaseId, requestId: 'filter-edit' }
  const { command } = (await h.post(client, 'claim', request)).body
  assert.equal(command.args.operations[0].filterIntensity, 100)
  await h.post(client, 'receipt', { ...request, receiptToken: command.receiptToken,
    result: editResult(2, { type: 'set_clip_effect', clipId: 'clip-1' }) })
  assert.equal((await result).revision, 2)
})

test('uses the pinned export job receipt after the source editor switches away', async t => {
  let job
  let begins = 0
  const proof = '1'.repeat(43)
  const exportJobs = {
    begin(options) {
      begins++
      job = { ...options, exportJobId: 1, status: 'awaiting-upload', fileSaved: false, canvasCommitted: false }
      return { exportJobId: 1, uploadToken: proof }
    },
    get() { return job },
    authorizeUpload({ uploadToken }) {
      if (uploadToken !== proof) throw ClipDomainError.pathDenied()
    },
    upload({ exportJobId, projectId, uploadToken, tempPath }) {
      assert.equal(exportJobId, '1')
      assert.equal(projectId, 'demo')
      assert.equal(uploadToken, proof)
      assert.equal(readFileSync(tempPath, 'utf8'), 'fixture MP4 data')
      job = { ...job, status: 'file-saved', fileSaved: true, bytes: 16,
        output: { durationMs: 1000, width: 1280, height: 720, videoPath: '/test/verified.mp4' } }
      return job
    },
  }
  const h = fixture(t, { exportJobs })
  const client = h.connect('one')
  const leaseId = await acquire(h, client, 'demo', undefined, { revision: 5 })
  await rejectsCode(h.execute('clip_export', { confirm: false }), 'CONFIRMATION_REQUIRED')
  assert.equal(begins, 0)
  const args = { confirm: true, requestId: 'export-demo', baseRevision: 5, resolution: '720p', fps: 24 }
  const attempt = h.execute('clip_export', args)
  const ids = { leaseId, requestId: args.requestId }
  const { command } = (await h.post(client, 'claim', ids)).body
  assert.equal(command.exportJobId, 1)
  assert.equal(command.uploadToken, proof)
  assert.equal(command.args.resolution, '720p')
  assert.equal(command.args.fps, 24)
  assert.equal(job.projectRevision, 5)
  assert.equal((await h.post(client, 'receipt', { ...ids, receiptToken: command.receiptToken,
    result: { fileSaved: true, path: '/forged.mp4' } })).body.status, 'claimed')
  client.hide()
  const path = '/exports/1/upload?projectId=demo'
  const headers = { 'content-type': 'application/octet-stream', 'x-clip-export-proof': proof }
  assert.equal((await h.http('POST', path, Buffer.from('fixture MP4 data'), undefined, { ...headers, 'x-clip-export-proof': '2'.repeat(43) })).status, 403)
  const upload = await h.http('POST', path, Buffer.from('fixture MP4 data'), undefined, headers)
  assert.equal(upload.body.fileSaved, true)
  const result = await attempt
  assert.equal(result.output.videoPath, '/test/verified.mp4')
  assert.equal(result.output.durationSec, 1)
  assert.deepEqual(await h.execute('clip_export', args), result)
  assert.equal(begins, 1)
  assert.deepEqual(readdirSync(h.paths.tmpDir), [])
})

test('host apply provides the native seam and registers routes through guarded injects', async t => {
  const h = fixture(t)
  withHostHome(t, h.home)
  const provided = new Map()
  const effects = []
  const mounted = []
  const ctx = {
    tools: { register() {} }, systemPrompt: { section() {} }, provide: (name, value) => provided.set(name, value),
    get: (name) => provided.get(name),
    effect(fn, label) { effects.push(label); fn() },
    inject(_deps, mount) {
      mount({ get: name => name === 'webServer' ? { register(route) { mounted.push(route.path); return () => {} } } : undefined,
        effect: this.effect })
    },
  }
  apply(ctx)
  const seam = provided.get('clipEditor')
  const opened = await seam.open({ projectId: 'seam' })
  assert.equal((await seam.get(opened.projectId)).id, opened.projectId)
  assert.equal(typeof seam.export, 'function')
  assert.deepEqual(mounted, [prefix])
  assert.deepEqual(effects, ['omnimux-clip: live commands', 'omnimux-clip: prompt', 'omnimux-clip: tools', 'omnimux-clip: http routes'])
})
