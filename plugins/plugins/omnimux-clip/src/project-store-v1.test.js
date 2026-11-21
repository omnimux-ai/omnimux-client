import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { ClipDomainError } from './errors.js'
import { projectJsonPath, resolveClipPaths } from './paths.js'
import { createClipEditorSeam } from './seam/clipEditor.js'
import { createProjectStore } from './store/projectStore.js'
import { diagnoseNativeProject, nativeProjectView } from './timeline/nativeProjectView.js'

const UUID = '3f121f62-4324-455a-b0a0-88757c46f915'
const nativeTrack = (id, clips, type = 'video') => ({ id, name: id, type, clips, transitions: [], locked: false, hidden: false, muted: false, solo: false })
const nativeClip = (id, mediaId, startTime, duration, trackId = 'picture') => ({
  id, trackId, mediaId, startTime, duration, inPoint: 0.5, outPoint: 1.5, speed: 1.25, volume: 0.75,
  effects: [], audioEffects: [], keyframes: [],
  transform: { position: { x: 0.1, y: 0.2 }, scale: { x: 1.2, y: 1.2 }, anchor: { x: 0.5, y: 0.5 }, rotation: 14, opacity: 0.65 },
})
const nativeProject = (id = UUID, name = '剪辑初稿') => ({
  id, name, createdAt: 1000, modifiedAt: 2000,
  settings: { width: 1080, height: 1920, frameRate: 24, sampleRate: 48000, channels: 2, workingColorSpace: 'rec2020' },
  timeline: { duration: 2, tracks: [], markers: [], subtitles: [] },
  mediaLibrary: { items: [] },
})
const mediaItem = (id, details = {}) => ({
  id, type: 'video', name: id,
  metadata: { duration: 3, width: 720, height: 1280, frameRate: 24, codec: 'avc', sampleRate: 48000, channels: 2, fileSize: 1878 },
  ...details,
})
const bindingFor = (projectId, nodeId = 'node-first') => ({ projectId, workspaceId: 'ws_example', nodeId })
const hasCode = (code) => (error) => error instanceof ClipDomainError && error.code === code

function fixture(t, io) {
  const home = fs.mkdtempSync(join(tmpdir(), 'clip-project-v1-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const paths = resolveClipPaths({ homeDir: home })
  const store = createProjectStore({ paths, fs: io })
  const file = (id) => projectJsonPath(paths, id)
  const backups = () => fs.readdirSync(join(paths.projectsDir, '.backups')).sort()
    .map((name) => [name, fs.readFileSync(join(paths.projectsDir, '.backups', name))])
  return { home, paths, store, file, backups }
}

function legacyTimeline(id, sourceUrl) {
  return {
    version: '1.0', projectId: id, name: '旧画布剪辑',
    canvasConfig: { width: 1080, height: 1920, aspectRatio: '9:16', fps: 25, durationMs: 6123 },
    media: [{ id: 'legacy-media', name: '素材', type: 'video', path: sourceUrl, durationMs: 2000, revision: 'old-v3' }],
    tracks: [{
      id: 'legacy-video', name: '主视频', type: 'video', order: 0, isVisible: false, isLocked: true, isMuted: true,
      clips: [{
        id: 'video-1', trackId: 'legacy-video', name: '甲', mediaType: 'video', startTimeMs: 125, durationMs: 1777,
        sourceInMs: 250, sourceOutMs: 1888, volume: 0.35, speed: 1.5, sourceUrl,
        transition: { type: 'fadeblack', durationMs: 243 },
      }, {
        id: 'video-2', trackId: 'legacy-video', name: '乙', mediaType: 'video', mediaId: 'legacy-media',
        startTimeMs: 2100, durationMs: 1500, sourceInMs: 0, sourceOutMs: 1500, sourceUrl: 'blob:expired',
        transition: { type: 'crossfade', durationMs: 321 },
      }],
    }, {
      id: 'legacy-text', name: '标题', type: 'text', order: 2,
      clips: [{ id: 'text-1', mediaType: 'text', startTimeMs: 1001, durationMs: 901,
        textStyle: { content: '旧字幕\n第二行', fontFamily: 'sans-serif', fontSize: 43, fontWeight: 'bold', strokeWidth: 0, textAlign: 'left' } }],
    }],
  }
}

test('migration keeps raw bare and wrapped OpenReel files and preserves stable IndexedDB IDs', (t) => {
  const { store, file, backups } = fixture(t)
  const forms = [
    (project) => project,
    (project) => ({ schema: project, history: { past: ['old undo'], future: ['old redo'] } }),
    (project) => ({ projectId: project.id, openreel: project, updatedAt: '2026-01-04T04:00:00.000Z' }),
    (project) => ({ version: '1.2.0', project }),
    (project) => ({ openreel: { version: '1.2.0', project } }),
  ]
  for (const [index, wrap] of forms.entries()) {
    const id = `${UUID.slice(0, -1)}${index}`
    const project = nativeProject(id)
    project.mediaLibrary.items.push(mediaItem('stock-1', { blob: {}, fileHandle: {}, thumbnailUrl: 'blob:gone', isPlaceholder: false }))
    project.timeline.tracks.push(nativeTrack('picture', [nativeClip('placed-1', 'stock-1', 0.1234, 1.25)]))
    const original = Buffer.from(`${JSON.stringify(wrap(project), null, 4)}\r\n`)
    fs.writeFileSync(file(id), original)
    const preview = store.load(id)
    assert.deepEqual(fs.readFileSync(file(id)), original)
    assert.equal(preview.projectId, id)
    assert.equal(preview.revision, 1)
    const migrated = store.materialize(id)
    assert.equal(migrated.project.id, id)
    assert.equal(migrated.updatedAt, index === 2 ? Date.parse('2026-01-04T04:00:00.000Z') : 2000)
    assert.deepEqual(migrated.project.timeline.tracks[0].clips[0], project.timeline.tracks[0].clips[0])
    assert.deepEqual(migrated.project.mediaLibrary.items[0].sourceRef, { kind: 'indexeddb', key: 'stock-1' })
    assert.equal(migrated.project.mediaLibrary.items[0].missing, true)
    const saved = fs.readFileSync(file(id))
    assert.doesNotMatch(saved.toString(), /"(?:blob|fileHandle|thumbnailUrl)":/)
    assert.deepEqual(store.materialize(id), migrated)
    assert.deepEqual(fs.readFileSync(file(id)), saved)
    assert.deepEqual(backups().filter(([name]) => name.startsWith(`${id}.`)).map(([, bytes]) => bytes), [original])
  }
})

test('old TimelineSchema migration preserves intervals, source mapping, flags, subtitles, transitions and history', (t) => {
  const legacyPath = join(tmpdir(), 'sample-migration-source.mp4')
  const { store, file, backups } = fixture(t, { openSync(path, ...args) {
    assert.notEqual(path, legacyPath, 'migration must not open media paths')
    return fs.openSync(path, ...args)
  } })
  const id = 'clip-old'
  const schema = legacyTimeline(id, legacyPath)
  const source = Buffer.from(JSON.stringify({ id, updatedAt: 4444, playheadMs: 1379, schema, history: { past: [schema], future: [{ foo: 2 }] } }, null, 4))
  fs.writeFileSync(file(id), source)
  const result = store.materialize(id)
  assert.equal(result.updatedAt, 4444)
  assert.equal(result.project.playheadSec, 1.379)
  assert.equal(result.project.timeline.duration, 6.123)
  assert.equal(result.project.settings.frameRate, 25)
  const [title, video] = result.project.timeline.tracks
  assert.equal(title.id, 'legacy-text')
  assert.deepEqual([video.id, video.locked, video.muted, video.hidden], ['legacy-video', true, true, true])
  assert.deepEqual(video.clips.map((clip) => [clip.id, clip.mediaId, clip.startTime, clip.duration, clip.inPoint, clip.outPoint, clip.speed, clip.volume]), [
    ['video-1', 'legacy-media', 0.125, 1.777, 0.25, 1.888, 1.5, 0.35],
    ['video-2', 'legacy-media', 2.1, 1.5, 0, 1.5, 1, 1],
  ])
  assert.deepEqual(video.transitions.map(({ clipAId, edge, type, duration }) => [clipAId, edge, type, duration]), [
    ['video-1', 'in', 'dipToBlack', 0.243], ['video-1', 'out', 'dipToBlack', 0.243],
    ['video-2', 'in', 'crossfade', 0.321], ['video-2', 'out', 'crossfade', 0.321],
  ])
  const [subtitle] = result.project.textClips
  assert.deepEqual([subtitle.id, subtitle.trackId, subtitle.startTime, subtitle.duration, subtitle.text, subtitle.style.fontSize, subtitle.style.textAlign],
    ['text-1', 'legacy-text', 1.001, 0.901, '旧字幕\n第二行', 43, 'left'])
  const [media] = result.project.mediaLibrary.items
  assert.deepEqual([media.id, media.missing, media.sourceRef.kind, media.sourceRef.contentVersion], ['legacy-media', true, 'legacy', 'old-v3'])
  assert.match(media.sourceRef.fingerprint, /^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(result).includes(legacyPath), false)
  assert.deepEqual(backups().map(([, bytes]) => bytes), [source])
  assert.deepEqual(store.materialize(id), result)
  assert.equal(backups().length, 1)
  assert.deepEqual(store.list().projects[0], {
    id, projectName: schema.name, updatedAt: 4444, durationMs: 6123, aspectRatio: '9:16', trackCount: 2, clipCount: 3, revision: 1, mode: 'standalone',
  })
})

test('canvas materialization is bound, retryable and gives the saved project precedence over its old draft', (t) => {
  const { store, file, backups } = fixture(t)
  const id = 'clip_node_demo'
  const binding = bindingFor(id)
  const other = bindingFor(id, 'node-other')
  const draft = `${JSON.stringify(legacyTimeline(id, 'blob:older-browser'))}\n`
  assert.throws(() => store.load(id), hasCode('project-not-materialized'))
  assert.throws(() => store.materialize(id, { binding: { ...binding, workspaceId: '../somewhere' }, draftSchema: draft }), hasCode('invalid-clip-binding'))
  assert.throws(() => store.materialize(id, { binding: bindingFor('clip_node_wrong'), draftSchema: draft }), hasCode('invalid-clip-binding'))
  assert.equal(store.exists(id), false)
  const saved = store.materialize(id, { binding, draftSchema: draft })
  const bytes = fs.readFileSync(file(id))
  assert.deepEqual(saved.binding, binding)
  assert.deepEqual(store.load(id, { binding }), saved)
  assert.deepEqual(backups().map(([, raw]) => raw), [Buffer.from(draft)])
  assert.equal(saved.project.mediaLibrary.items[0].sourceRef.kind, 'legacy')
  assert.equal(saved.project.mediaLibrary.items[0].sourceRef.key, undefined)
  assert.deepEqual(store.materialize(id, { binding, title: 'replacement', draftSchema: '{invalid' }), saved)
  assert.throws(() => store.load(id, { binding: other }), hasCode('clip-binding-mismatch'))
  assert.throws(() => store.materialize(id, { binding: other }), hasCode('clip-binding-mismatch'))
  assert.throws(() => store.save(id, saved.project, { expectedRevision: saved.revision }), hasCode('clip-binding-mismatch'))
  assert.deepEqual(fs.readFileSync(file(id)), bytes)
  assert.equal(store.list().projects[0].mode, 'canvas')
})

test('existing project identity wins when associating a canvas and raw native canvas drafts retain their original media owner', (t) => {
  const { store, backups } = fixture(t)
  const id = UUID
  const saved = store.create(id, nativeProject(id, '已有标题'))
  const bound = store.materialize(id, { binding: bindingFor(id), draftSchema: legacyTimeline(id, 'blob:ignored') })
  assert.deepEqual(bound.project, saved.project)
  assert.equal(bound.revision, saved.revision + 1)
  assert.equal(backups().length, 1)
  const canvasId = 'clip_node_native_draft'
  const draft = nativeProject('older-browser-project')
  draft.mediaLibrary.items.push(mediaItem('persisted-key'))
  const migrated = store.materialize(canvasId, { binding: bindingFor(canvasId), draftSchema: draft })
  assert.equal(migrated.project.id, canvasId)
  assert.deepEqual(migrated.project.mediaLibrary.items[0].sourceRef, { kind: 'indexeddb', key: 'persisted-key', projectId: draft.id })
})

test('CAS requires an explicit revision, permits coalescing, and returns only matching replay receipts', async (t) => {
  const { store, paths, file, backups } = fixture(t)
  const project = nativeProject()
  assert.throws(() => store.save(UUID, project), hasCode('invalid-json'))
  assert.throws(() => store.save(UUID, project, { expectedRevision: 1, revision: 1 }), hasCode('invalid-json'))
  assert.throws(() => store.save(UUID, project, { expectedRevision: 1 }), (error) => hasCode('REVISION_CONFLICT')(error) && error.details.currentRevision === 0)
  const created = store.save(UUID, project, { expectedRevision: 0 })
  assert.equal(created.revision, 1)
  const previousBytes = fs.readFileSync(file(UUID))
  const next = { ...project, name: '改名' }
  const otherStore = createProjectStore({ paths })
  const [first, stale] = await Promise.allSettled([
    Promise.resolve().then(() => store.save(UUID, next, { expectedRevision: 1, revision: 7, backupCurrent: true })),
    Promise.resolve().then(() => otherStore.save(UUID, { ...next, name: '迟到的内容' }, { expectedRevision: 1, revision: 7 })),
  ])
  assert.equal(first.status, 'fulfilled')
  assert.equal(stale.status, 'rejected')
  assert.equal(stale.reason.code, 'REVISION_CONFLICT')
  assert.deepEqual(stale.reason.details, { currentRevision: 7 })
  const disk = fs.readFileSync(file(UUID))
  assert.deepEqual(store.save(UUID, { name: next.name, ...Object.fromEntries(Object.entries(next).filter(([key]) => key !== 'name')) }, { expectedRevision: 1, revision: 7, backupCurrent: true }), first.value)
  assert.deepEqual(fs.readFileSync(file(UUID)), disk)
  assert.deepEqual(backups().map(([, bytes]) => bytes), [previousBytes])
  assert.deepEqual(otherStore.load(UUID), first.value)
})

test('a failed atomic replacement keeps the original and reuses its byte-identical backup on retry', (t) => {
  let fail = true
  const { store, file, paths, backups } = fixture(t, {
    renameSync(source, destination) {
      if (fail) throw Object.assign(new Error('synthetic I/O failure'), { code: 'EIO' })
      fs.renameSync(source, destination)
    },
  })
  const original = Buffer.from(`${JSON.stringify(legacyTimeline(UUID, 'blob:unknown'))}\r\n`)
  fs.writeFileSync(file(UUID), original)
  assert.throws(() => store.materialize(UUID), hasCode('project-unreadable'))
  assert.deepEqual(fs.readFileSync(file(UUID)), original)
  assert.deepEqual(backups().map(([, bytes]) => bytes), [original])
  assert.deepEqual(fs.readdirSync(paths.projectsDir).sort(), ['.backups', `${UUID}.json`])
  fail = false
  const migrated = store.materialize(UUID)
  assert.deepEqual(store.load(UUID), migrated)
  assert.equal(backups().length, 1)
})

test('copes with corrupt entries and refuses project symlinks without exposing file contents', (t) => {
  const { store, file } = fixture(t)
  store.create(UUID)
  fs.writeFileSync(file('broken'), 'synthetic invalid project')
  fs.mkdirSync(file('directory'))
  fs.symlinkSync(file(UUID), file('symlink'))
  assert.throws(() => store.load('missing'), hasCode('not-found'))
  const list = store.list({ limit: 2 })
  assert.deepEqual(list.projects.map((row) => row.id), [UUID])
  assert.equal(list.unavailableCount, 3)
  assert.deepEqual(list.unavailableProjects.map(({ id, code }) => [id, code]), [['broken', 'invalid-json'], ['directory', 'project-unreadable']])
  assert.throws(() => store.load('symlink'), hasCode('project-unreadable'))
  assert.doesNotMatch(JSON.stringify(list), /synthetic invalid project/)
})

test('media and Motion roundtrip strips runtime data and retains only sanctioned reconnect URLs', (t) => {
  const { store, home, file } = fixture(t)
  const project = nativeProject(UUID)
  const safeUrl = '/omnimux-workflow/api/workspaces/ws_example/file?rel=footage%2Fclip.mp4&rev=v3'
  const unsafeUrls = ['//synthetic.invalid/media/one', '/omnimux-workflow/media/%2E%2E/clip.mp4', '/media/a.mov?path=hidden', '/omnimux-workflow/api/local-file?path=%2Foutside.mov', 'blob:gone']
  project.mediaLibrary.items.push(
    mediaItem('a', { sourceRef: { kind: 'indexeddb', key: 'a' }, missing: false, omnimuxSource: { id: 'node-a', version: 'v3', url: safeUrl }, nativeSource: { path: join(home, 'private.mp4') } }),
    mediaItem('b', { blob: new Blob(['synthetic bytes']), sourceRef: { kind: 'indexeddb', key: 'b' }, missing: false }),
    mediaItem('c', { blob: {}, sourceRef: { kind: 'indexeddb', key: 'c' }, missing: false }),
    ...unsafeUrls.map((url, index) => mediaItem(`unsafe-${index}`, { omnimuxSource: { id: `node-${index}`, version: 'v3', url } })),
  )
  project.motionCompositions = [{ layers: [{ expressions: [{ id: 'code-1', type: 'expression', enabled: true, code: 'private expression body', approved: true, trusted: true }, { id: 'preset-1', type: 'sine', enabled: true }] }] }]
  project.generatedShaders = [{ glsl: 'private shader source' }]
  const envelope = store.save(UUID, project, { expectedRevision: 0 })
  assert.deepEqual(store.load(UUID), envelope)
  const [a, b, c, ...unsafe] = envelope.project.mediaLibrary.items
  assert.deepEqual(a.omnimuxSource, { id: 'node-a', version: 'v3', url: safeUrl })
  assert.deepEqual([a.missing, b.missing, c.missing], [false, true, true])
  assert.ok(unsafe.every((item) => item.omnimuxSource.version === 'v3' && !item.omnimuxSource.url))
  assert.deepEqual(envelope.project.motionCompositions[0].layers[0].expressions, [{ id: 'code-1', type: 'expression', enabled: false }, { id: 'preset-1', type: 'sine', enabled: true }])
  assert.doesNotMatch(fs.readFileSync(file(UUID), 'utf8'), /synthetic bytes|private expression body|private shader source|private\.mp4|"blob"|"approved"|"trusted"/)
  const safe = nativeProjectView(envelope, { view: 'full' })
  assert.deepEqual(safe.media[0].omnimuxSource, { id: 'node-a', version: 'v3' })
  assert.doesNotMatch(JSON.stringify(safe), /clip\.mp4|private\.mp4|synthetic bytes|private expression|blob:/)
})

test('static reads filter precise native seconds and diagnose visible video gaps, overlap, bounds and missing media', (t) => {
  const { store } = fixture(t)
  const project = nativeProject(UUID, 'Title\nwith <script>private code</script> /fixture/secret.mov')
  const source = mediaItem('available', { sourceRef: { kind: 'indexeddb', key: 'available' }, missing: false })
  project.timeline.tracks.push(nativeTrack('picture', [
    { ...nativeClip('first', source.id, 0, 0.50), outPoint: 4 },
    nativeClip('second', source.id, 0.4, 0.333333),
    nativeClip('missing', 'unknown-file', 0.813333, 1.3),
  ]), nativeTrack('captions', [], 'text'))
  project.timeline.subtitles.push({ id: 'subtitle', startTime: 0.1, endTime: 0.2, text: 'Subtitle text', captionTrackId: 'cap-en' })
  project.textClips = [{ id: 'title', trackId: 'captions', startTime: 0.2, duration: 0.3, text: 'Title text with blob:runtime', style: { fontSize: 50, shader: { glsl: 'private code' } } }]
  project.mediaLibrary.items.push(source, mediaItem('offline', { blob: {} }))
  const envelope = store.save(UUID, project, { expectedRevision: 0 })
  const summary = nativeProjectView(envelope, { playheadSec: 0.41, selectedClipIds: ['second', 'title'] })
  assert.equal(summary.clipCount, 4)
  assert.equal(summary.playheadSec, 0.41)
  assert.equal(summary.revision, 1)
  assert.deepEqual(summary.selectedClips.map(({ id }) => id), ['second', 'title'])
  assert.doesNotMatch(summary.title, /private code|secret\.mov/)
  const full = nativeProjectView(envelope, { view: 'full' })
  assert.equal(full.subtitles[0].text, 'Subtitle text')
  assert.equal(full.clips.find(({ id }) => id === 'second').durationSec, 0.333333)
  assert.doesNotMatch(JSON.stringify(full), /blob:|shader|private code|secret\.mov/)
  const clips = nativeProjectView(envelope, { view: 'clips', trackId: 'picture', fromSec: 0.7, toSec: 0.75 })
  assert.deepEqual(clips.clips.map(({ id }) => id), ['second'])
  assert.throws(() => nativeProjectView(envelope, { fromSec: 2, toSec: 1 }), hasCode('invalid-json'))
  const report = diagnoseNativeProject(envelope)
  assert.deepEqual(report.issues.map(({ code, scope, clipId, mediaId }) => [code, scope ?? clipId ?? mediaId]), [
    ['clip_out_of_bounds', 'source'], ['clip_overlap', 'second'], ['clip_out_of_bounds', 'timeline'],
    ['media_missing', 'missing'], ['media_missing', 'offline'], ['timeline_gap', undefined],
  ])
  assert.ok(Math.abs(report.issues.at(-1).toSec - report.issues.at(-1).fromSec - 0.08) < 1e-9)
})

test('Host browser-safe projection uses the same core media, track and timing fields as the pinned agent serializer', async () => {
  const read = (path) => fileURLToPath(new URL(path, import.meta.url))
  const result = await build({
    entryPoints: [read('./client/openreel/agent/serialize.ts')],
    alias: { '@openreel/core/media/interpretation': read('./client/openreel/core/media/interpretation.ts') },
    bundle: true, write: false, format: 'esm', platform: 'node',
  })
  const upstream = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
  const project = nativeProject(UUID)
  project.timeline.tracks.push(nativeTrack('picture', [nativeClip('placed', 'media', 0.25, 1)]))
  project.mediaLibrary.items.push(mediaItem('media'))
  const view = nativeProjectView({ id: UUID, projectId: UUID, revision: 2, project }, { view: 'full' })
  const pick = (record, keys) => Object.fromEntries(keys.map((key) => [key, record[key]]))
  const stateFields = ['durationSec', 'trackCount', 'clipCount', 'mediaCount']
  const trackFields = ['id', 'type', 'name', 'locked', 'syncLock', 'hidden', 'muted', 'solo', 'soloSafe', 'clipCount']
  const clipFields = ['id', 'trackIndex', 'trackType', 'startSec', 'endSec', 'durationSec', 'mediaId', 'speed', 'hasEffects', 'hasColorGrading']
  const mediaFields = ['id', 'name', 'type', 'durationSec', 'width', 'height']
  assert.deepEqual(pick(view, stateFields), pick(upstream.serializeEditorState(project), stateFields))
  assert.deepEqual(pick(view.tracks[0], trackFields), pick(upstream.listTracks(project)[0], trackFields))
  assert.deepEqual(pick(view.clips[0], clipFields), pick(upstream.listClips(project)[0], clipFields))
  assert.deepEqual(pick(view.media[0], mediaFields), pick(upstream.listMedia(project)[0], mediaFields))
})

test('Cordis seam opens legacy drafts and uses the native CAS interface for saved edits', async (t) => {
  const { store } = fixture(t)
  const editor = createClipEditorSeam({ store })
  const id = 'clip_node_seam'
  const binding = bindingFor(id)
  assert.deepEqual(await editor.open({ ...binding, source: 'canvas', draftSchema: legacyTimeline(id, 'blob:expired') }), { projectId: id })
  const initial = await editor.get(id, { binding })
  const saved = await editor.save({ project: { ...initial, name: 'updated via seam' }, binding, expectedRevision: 1 })
  assert.equal(saved.revision, 2)
  assert.equal((await editor.get(id, { binding })).name, 'updated via seam')
  await assert.rejects(() => editor.save({ project: initial, binding, expectedRevision: 1 }), hasCode('REVISION_CONFLICT'))
})
