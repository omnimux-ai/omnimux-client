import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { ClipDomainError } from './errors.js'
import { ensureClipDirs, resolveClipPaths } from './paths.js'
import { createProjectStore } from './store/projectStore.js'
import { createClipTools, registerClipTools } from './tools.js'
import { createEmptySchema } from './client/store/timelineTypes.js'
import { apply, inject as moduleInject } from './index.js'
import { createClipDispatcher } from './http/routes.js'

function tempStore() {
  const home = mkdtempSync(join(tmpdir(), 'omnimux-clip-tools-'))
  const paths = ensureClipDirs(resolveClipPaths({ homeDir: home, env: {} }))
  const store = createProjectStore({ paths })
  return { home, paths, store }
}

function byName(tools, name) {
  const tool = tools.find((item) => item.name === name)
  assert.ok(tool, `missing tool ${name}`)
  return tool
}

describe('clip_* tools', () => {
  /** @type {{ home: string, paths: object, store: ReturnType<typeof createProjectStore> }} */
  let ctx
  let tools

  beforeEach(() => {
    ctx = tempStore()
    ctx.store.create('demo', (() => {
      const schema = createEmptySchema({ projectId: 'demo' })
      schema.tracks[0].clips.push({
        id: 'clip_a',
        trackId: 'track_video',
        name: 'A',
        mediaType: 'video',
        startTimeMs: 0,
        durationMs: 4000,
        sourceUrl: '/tmp/a.mp4',
        sourceInMs: 0,
        sourceOutMs: 4000,
        speed: 1,
        volume: 1,
      })
      schema.canvasConfig.durationMs = 4000
      return schema
    })())
    tools = createClipTools({ store: ctx.store })
  })

  afterEach(() => {
    rmSync(ctx.home, { recursive: true, force: true })
  })

  it('registers the nine frozen tool names', () => {
    assert.deepEqual(
      tools.map((item) => item.name),
      ['clip_list', 'clip_create', 'clip_open', 'clip_get', 'clip_edit', 'clip_view', 'clip_snapshot', 'clip_diagnostics', 'clip_export'],
    )
  })

  it('clip_create persists an empty project and clip_list discovers it', async () => {
    const created = await byName(tools, 'clip_create').execute({ name: ' 我的短视频 ', resolution: 'portrait', fps: 24 })
    assert.match(created.projectId, /^clip_/)
    assert.equal(created.name, '我的短视频')
    assert.equal(created.aspectRatio, '9:16')
    assert.equal(created.fps, 24)
    // persisted: clip_get can read it back without an overlay
    const got = await byName(tools, 'clip_get').execute({ projectId: created.projectId })
    assert.equal(got.projectId, created.projectId)
    const listed = await byName(tools, 'clip_list').execute({})
    const hit = listed.projects.find((item) => item.id === created.projectId)
    assert.ok(hit, 'clip_list must surface the created project')
    assert.equal(hit.projectName, '我的短视频')
    assert.equal(hit.aspectRatio, '9:16')
  })

  it('clip_create validates name / resolution / fps', async () => {
    const create = byName(tools, 'clip_create')
    await assert.rejects(() => create.execute({ name: '  ' }), (e) => e instanceof ClipDomainError)
    await assert.rejects(() => create.execute({ name: 'x'.repeat(81) }), (e) => e instanceof ClipDomainError)
    await assert.rejects(() => create.execute({ name: 'ok', resolution: 'wide' }), (e) => e instanceof ClipDomainError)
    await assert.rejects(() => create.execute({ name: 'ok', fps: 0 }), (e) => e instanceof ClipDomainError)
  })

  it('clip_list sorts newest first and clamps limit', async () => {
    await byName(tools, 'clip_create').execute({ name: 'newer' })
    const all = await byName(tools, 'clip_list').execute({})
    assert.equal(all.count, 2)
    assert.equal(all.projects[0].projectName, 'newer')
    const one = await byName(tools, 'clip_list').execute({ limit: 1 })
    assert.equal(one.projects.length, 1)
    await assert.rejects(() => byName(tools, 'clip_list').execute({ limit: -1 }), (e) => e instanceof ClipDomainError)
  })

  it('reports native projects and invalid files alongside readable legacy projects', async () => {
    const native = (id) => ({ id, timeline: { tracks: [] }, mediaLibrary: { items: [] } })
    writeFileSync(join(ctx.paths.projectsDir, 'native-envelope.json'), JSON.stringify({ schema: native('native-envelope') }))
    writeFileSync(join(ctx.paths.projectsDir, 'native-bare.json'), JSON.stringify(native('native-bare')))
    writeFileSync(join(ctx.paths.projectsDir, 'broken.json'), 'private invalid file content')
    const listed = await byName(tools, 'clip_list').execute({})
    assert.deepEqual(listed.projects.map(({ id }) => id), ['demo'])
    assert.equal(listed.unavailableCount, 3)
    assert.deepEqual(listed.unavailableProjects.map(({ id, code }) => [id, code]), [
      ['broken', 'invalid-json'], ['native-bare', 'openreel-migration-required'], ['native-envelope', 'openreel-migration-required'],
    ])
    assert.doesNotMatch(listed.unavailableProjects[0].message, /private invalid file content/)
    const limited = await byName(tools, 'clip_list').execute({ limit: 1 })
    assert.equal(limited.unavailableProjects.length, 1)
    assert.equal(limited.unavailableCount, 3)
    const dispatcher = createClipDispatcher({ paths: ctx.paths, store: ctx.store })
    const httpList = await dispatcher.dispatch({ url: '/projects' })
    assert.equal(httpList.status, 200)
    assert.deepEqual(httpList.body.unavailableProjects, listed.unavailableProjects)
    const httpNative = await dispatcher.dispatch({ url: '/projects/native-bare' })
    assert.equal(httpNative.status, 409)
    assert.equal(httpNative.body.error, 'openreel-migration-required')
    const httpMissing = await dispatcher.dispatch({ url: '/projects/clip_node_fresh' })
    assert.equal(httpMissing.status, 404)
    assert.equal(httpMissing.body.error, 'project-not-materialized')
  })

  it('clip_get returns seconds and respects view=clips', async () => {
    const summary = await byName(tools, 'clip_get').execute({ projectId: 'demo' })
    assert.equal(summary.projectId, 'demo')
    assert.equal(summary.durationSec, 4)
    assert.equal(summary.clipCount, 1)
    const clips = await byName(tools, 'clip_get').execute({ projectId: 'demo', view: 'clips' })
    assert.equal(clips.clips[0].startSec, 0)
    assert.equal(clips.clips[0].durationSec, 4)
  })

  it('clip_edit is one undo step and validateOnly does not persist', async () => {
    const preview = await byName(tools, 'clip_edit').execute({
      projectId: 'demo',
      description: 'dry run split',
      validateOnly: true,
      operations: [{ type: 'split_clip', clipId: 'clip_a', atSec: 1 }],
    })
    assert.equal(preview.persisted, false)
    assert.equal(ctx.store.load('demo').schema.tracks[0].clips.length, 1)

    const live = await byName(tools, 'clip_edit').execute({
      projectId: 'demo',
      description: 'split at 1s',
      operations: [{ type: 'split_clip', clipId: 'clip_a', atSec: 1 }],
    })
    assert.equal(live.persisted, true)
    assert.equal(live.undoStep, true)
    const after = ctx.store.load('demo')
    assert.equal(after.schema.tracks[0].clips.length, 2)
    assert.equal(after.history.past.length, 1)
    assert.equal(after.history.past[0].tracks[0].clips.length, 1)
  })

  it('reports saved format and live availability without changing any files', async () => {
    const nativeId = '9f49d01b-9c0d-4767-beb3-4abcd1eac222'
    const nativeJson = JSON.stringify({ schema: { id: nativeId, timeline: { tracks: [] }, mediaLibrary: { items: [] } } })
    const nativePath = join(ctx.paths.projectsDir, `${nativeId}.json`)
    const legacyPath = join(ctx.paths.projectsDir, 'demo.json')
    writeFileSync(nativePath, nativeJson)
    const legacy = readFileSync(legacyPath, 'utf8')
    const cases = [
      ['clip_open', {}], ['clip_view', { action: 'seek', toSec: 1.25 }],
      ['clip_snapshot', { times: [0, 1.25] }], ['clip_export', { resolution: '1080p', fps: 30 }],
    ]
    for (const [name, args] of [...cases, ['clip_get', {}], ['clip_diagnostics', {}]]) {
      const tool = byName(tools, name)
      for (const [projectId, expected] of [
        ['clip_node_new', 'project-not-materialized'], [nativeId, 'openreel-migration-required'],
        ['ghost', 'not-found'], ['../wrong', 'invalid-id'],
      ]) {
        await assert.rejects(() => tool.execute({ ...args, projectId }),
          (error) => error instanceof ClipDomainError && error.code === expected, `${name}: ${projectId}`)
      }
    }
    for (const [name, args] of cases) {
      await assert.rejects(() => byName(tools, name).execute({ ...args, projectId: 'demo' }),
        (error) => error instanceof ClipDomainError && error.code === 'ui-unavailable', name)
    }
    assert.equal(readFileSync(legacyPath, 'utf8'), legacy)
    assert.equal(readFileSync(nativePath, 'utf8'), nativeJson)
    assert.deepEqual(readdirSync(ctx.paths.projectsDir).sort(), [`${nativeId}.json`, 'demo.json'])
    assert.deepEqual(readdirSync(ctx.paths.snapshotsDir), [])
    assert.deepEqual(readdirSync(ctx.paths.exportsDir), [])
  })

  it('includes the stable code in the registered tool error shown by the Harness', async () => {
    const registered = []
    registerClipTools({ tools: { register: (tool) => registered.push(tool) } }, tools)
    await assert.rejects(() => byName(registered, 'clip_get').execute({ projectId: 'clip_node_new' }),
      (error) => error instanceof ClipDomainError && error.code === 'project-not-materialized'
        && error.message.startsWith('[project-not-materialized] '))
    await assert.rejects(() => byName(registered, 'clip_open').execute({ projectId: 'demo' }),
      (error) => error instanceof ClipDomainError && error.message.startsWith('[ui-unavailable] '))
  })

  it('clip_diagnostics reports gaps without throwing', async () => {
    await byName(tools, 'clip_edit').execute({
      projectId: 'demo',
      description: 'open a hole',
      operations: [{ type: 'trim_clip', clipId: 'clip_a', durationSec: 1 }],
    })
    await byName(tools, 'clip_edit').execute({
      projectId: 'demo',
      description: 'add later clip',
      operations: [{
        type: 'add_clip',
        trackId: 'track_video',
        clipId: 'clip_b',
        startSec: 3,
        durationSec: 1,
        path: '/tmp/b.mp4',
      }],
    })
    const report = await byName(tools, 'clip_diagnostics').execute({ projectId: 'demo' })
    assert.equal(report.ok, false)
    assert.ok(report.issues.some((item) => item.code === 'timeline_gap'))
  })

  it('missing projectId and unknown project throw ClipDomainError, never { ok: false }', async () => {
    await assert.rejects(
      () => byName(tools, 'clip_get').execute({}),
      (error) => error instanceof ClipDomainError && error.code === 'invalid-id',
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

  it('registers tools, prompt and clipEditor seam', () => {
    const registered = []
    const provided = {}
    const sections = []
    const home = mkdtempSync(join(tmpdir(), 'omnimux-clip-apply-'))
    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      apply({
        tools: { register: (tool) => registered.push(tool.name) },
        systemPrompt: { section: (spec) => sections.push(spec.name) },
        provide: (name, value) => { provided[name] = value },
        inject: () => {},
      })
    } finally {
      if (prev == null) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
      rmSync(home, { recursive: true, force: true })
    }
    assert.deepEqual(registered, [
      'clip_list', 'clip_create', 'clip_open',
      'clip_get', 'clip_edit', 'clip_view', 'clip_snapshot', 'clip_diagnostics', 'clip_export',
    ])
    assert.deepEqual(sections, ['clip:ops'])
    assert.equal(typeof provided.clipEditor.open, 'function')
    assert.equal(typeof provided.clipEditor.export, 'function')
  })

  it('mounts routes via canonical guarded webServer resolution (regression: register without inject)', () => {
    const home = mkdtempSync(join(tmpdir(), 'omnimux-clip-mount-'))
    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const mounted = []
    const effects = []
    let captured = null
    try {
      apply({
        tools: { register: () => {} },
        systemPrompt: { section: () => {} },
        provide: () => {},
        inject: (deps, cb) => { if (deps.includes('webServer')) captured = cb },
      })
      // Case A: nested callback hands us a ctx whose .register is gated —
      // the guarded mount must resolve via get() and mount exactly once.
      captured({
        get: (name) => name === 'webServer'
          ? { register: (route) => { mounted.push(route.path); return () => {} } }
          : undefined,
        effect: (fn, label) => { effects.push(label); fn() },
      })
      // Case B: raw service handed directly with no effect() — must still mount.
      apply({
        tools: { register: () => {} },
        systemPrompt: { section: () => {} },
        provide: () => {},
        inject: (deps, cb) => { if (deps.includes('webServer')) cb({}) }, // no get, no register → must NOT throw
      })
    } finally {
      if (prev == null) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
      rmSync(home, { recursive: true, force: true })
    }
    assert.deepEqual(mounted, ['/omnimux-clip/api'])
    assert.deepEqual(effects, ['omnimux-clip: http routes'])
  })
})
