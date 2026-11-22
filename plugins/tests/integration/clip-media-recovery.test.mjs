import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire, findPackageJSON } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { mock } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolveClipPaths } from '../../plugins/omnimux-clip/src/paths.js'
import { createNativeProject } from '../../plugins/omnimux-clip/src/store/nativeProject.js'
import { createProjectStore } from '../../plugins/omnimux-clip/src/store/projectStore.js'
import { schemaFromOpenPayload } from '../../plugins/omnimux-clip/src/client/store/timelineTypes.js'
import { createProjectStore as createWorkflowProjectStore } from '../../plugins/omnimux-workflow/src/projects/ProjectStore.ts'
import { createLocalFileRoutes } from '../../plugins/omnimux-workflow/src/workflow/routes/localFileRoutes.ts'
import { createProjectAssetsRoutes } from '../../plugins/omnimux-workflow/src/workflow/routes/projectAssetsRoutes.ts'
import { createProjectAssetsStore } from '../../plugins/omnimux-workflow/src/workflow/workspace/ProjectAssetsStore.ts'
import { createWorkspaceStore } from '../../plugins/omnimux-workflow/src/workflow/workspace/WorkspaceStore.ts'

const clipPackage = new URL('../../plugins/omnimux-clip/package.json', import.meta.url)
const requireClip = createRequire(clipPackage)
const { build } = requireClip('esbuild')
const mediaPackage = findPackageJSON('mediabunny', clipPackage)
const mediaEntry = new URL(JSON.parse(readFileSync(mediaPackage, 'utf8')).module, pathToFileURL(mediaPackage)).href
const { ALL_FORMATS, AudioSampleSink, BlobSource, Input } = await import(mediaEntry)
const React = requireClip('react')
const { act } = React
const { createRoot } = requireClip('react-dom/client')
const fixtureUrl = new URL('src/client/live-media-recovery.test.js', clipPackage)
const directory = fileURLToPath(new URL('./', fixtureUrl))
const vendor = join(directory, 'openreel')
const built = await build({
  stdin: {
    contents: `export { useCanvasIngestion } from './hooks/useCanvasIngestion';
      export { ClipStage } from './ClipStage.jsx';
      export { createStageStore } from './stage-store.js';
      export { CANVAS_TAB, createEditorSession } from './live/editor-session.js';
      export { serveFile } from '../../../omnimux-workflow/src/workflow/routes/serveFile.ts';
      export { nativeEditorState } from './live/native-state';
      export { createClipPersistence, fromHost } from './live/persistence.js';
      export { executeNativeEdit } from './live/native-edit';
      export { useProjectStore } from './openreel/web/stores/project-store';
      export { getMediaEngine } from './openreel/core/media/mediabunny-engine';
      export { StorageEngine } from './openreel/core/storage/storage-engine';
      export { EffectsBridge } from './openreel/web/bridges/effects-bridge';
      export { FFmpegFallback } from './openreel/core/media/ffmpeg-fallback';
      export { restoreProjectPlaceholders } from './openreel/web/services/restore-project-placeholders';`,
    resolveDir: directory,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  jsx: 'automatic',
  alias: Object.fromEntries(['core', 'ui', 'agent', 'creation-schema'].map(name => [`@openreel/${name}`, join(vendor, name)])),
  define: { 'import.meta.env': '{}', 'import.meta.hot': 'undefined', 'import.meta.url': JSON.stringify(fixtureUrl.href) },
  loader: { '.wgsl': 'text', '.css': 'empty', '.svg': 'dataurl', '.wasm': 'dataurl' },
  plugins: [{ name: 'clip-media-test-browser', setup(builder) {
    builder.onResolve({ filter: /^mediabunny$/ }, () => ({ path: mediaEntry, external: true }))
    builder.onResolve({ filter: /^react$/ }, args => args.importer.endsWith('/hooks/useCanvasIngestion.ts')
      ? { path: 'react-effect', namespace: 'clip-media-test' } : undefined)
    builder.onResolve({ filter: /\?worker&url$/ }, () => ({ path: 'worker', namespace: 'clip-media-test' }))
    builder.onResolve({ filter: /^\.\/openreel\/web\/App\.tsx$/ }, () => ({ path: 'app', namespace: 'clip-media-test' }))
    builder.onResolve({ filter: /^dsh-ui-kit$/ }, () => ({ path: 'ui-kit', namespace: 'clip-media-test' }))
    const fixtures = new Map(Object.entries({
      'react-effect': `import { useEffect as reactEffect, useRef as reactRef } from 'react';
        export function useRef(value) {
          return globalThis.mountClipMediaEffect ? { current: value } : reactRef(value);
        }
        export function useEffect(effect, keys) {
          if (globalThis.mountClipMediaEffect) globalThis.mountClipMediaEffect(effect);
          else reactEffect(effect, keys);
        }`,
      'app': `import { createElement } from 'react';
        export default function App() { return createElement('div', { 'data-media-recovery-editor': true }); }`,
      'ui-kit': `import { createElement } from 'react';
        export function Button({ variant, ...props }) { return createElement('button', props); }`,
      'worker': 'export default "about:blank"',
    }))
    builder.onLoad({ filter: /.*/, namespace: 'clip-media-test' }, args => ({ contents: fixtures.get(args.path), resolveDir: directory }))
  } }],
})

// Only effect scheduling, IndexedDB and drawing are substituted. Host records,
// MediaBunny's PCM decoder, the native stores and the media actions are real.
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: () => null, setItem() {}, removeItem() {},
} })
globalThis.self = {}
globalThis.window = {}
globalThis.OffscreenCanvas = class { getContext() { return {} } }
const draftRows = new Map()
const draftDatabase = {
  createStore: (database, store) => `${database}:${store}`,
  get: async (key, store) => structuredClone(draftRows.get(store)?.get(key)),
  keys: async store => [...(draftRows.get(store)?.keys() ?? [])],
  getMany: async (keys, store) => Promise.all(keys.map(key => draftDatabase.get(key, store))),
  async set(key, record, store) {
    if (!draftRows.has(store)) draftRows.set(store, new Map())
    draftRows.get(store).set(key, structuredClone(record))
  },
}
const module = { exports: {} }
const requireFixture = specifier => specifier === 'idb-keyval' ? draftDatabase : requireClip(specifier)
new Function('require', 'module', 'exports', built.outputFiles[0].text)(requireFixture, module, module.exports)
const { ClipStage, createStageStore, CANVAS_TAB, createEditorSession, serveFile,
  nativeEditorState, createClipPersistence, fromHost, executeNativeEdit, useProjectStore, useCanvasIngestion, getMediaEngine, StorageEngine,
  EffectsBridge, FFmpegFallback, restoreProjectPlaceholders } = module.exports
mock.method(EffectsBridge.prototype, 'initialize', async () => {})
// PCM decode and waveform extraction run in MediaBunny. FFmpeg's optional
// second probe for streams has no Node WebAssembly worker.
mock.method(FFmpegFallback.prototype, 'probeAudioStreams', async () => ({ audioStreamCount: 1, streams: [] }))

const workspaceId = 'ws_media_recovery'
const sourceUrl = `/omnimux-workflow/api/workspaces/${workspaceId}/file?rel=assets%2Fvoice.wav&rev=v1`
const current = () => true
const projectStore = () => useProjectStore.getState()
const media = id => projectStore().getMediaItem(id)
const sha256 = input => createHash('sha256').update(input).digest('hex')

function wav(sample, sampleCount = 1) {
  const audio = Buffer.alloc(44 + 2 * sampleCount)
  audio.write('RIFF')
  audio.writeUInt32LE(audio.length - 8, 4)
  audio.write('WAVEfmt ', 8)
  audio.writeUInt32LE(16, 16)
  audio.writeUInt16LE(1, 20)
  audio.writeUInt16LE(1, 22)
  audio.writeUInt32LE(8000, 24)
  audio.writeUInt32LE(16000, 28)
  audio.writeUInt16LE(2, 32)
  audio.writeUInt16LE(16, 34)
  audio.write('data', 36)
  audio.writeUInt32LE(2 * sampleCount, 40)
  for (let offset = 44; offset < audio.length; offset += 2) audio.writeInt16LE(sample, offset)
  return audio
}

const winningBytes = wav(133)
const losingBytes = wav(-222)
const waveBlob = bytes => new Blob([bytes], { type: 'audio/wav' })
const waveFile = (bytes, name = 'voice.wav') => new File([bytes], name, { type: 'audio/wav', lastModified: 1 })
async function firstSample(blob) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryAudioTrack()
    assert.ok(track)
    for await (const sample of new AudioSampleSink(track).samples()) {
      const values = new Float32Array(sample.numberOfFrames * sample.numberOfChannels)
      sample.copyTo(values, { format: 'f32', planeIndex: 0 })
      sample.close()
      return Math.round(values[0] * 32768)
    }
    assert.fail('The audio decoder produced no samples')
  } finally { input.dispose() }
}
const bindingFor = id => ({ projectId: id, workspaceId, nodeId: 'compose' })
const verifiedUrl = (url, bytes) => `${url.replace(/&rev=[^&]*/u, '')}&rev=sha256%3A${sha256(bytes)}`

const httpFetch = globalThis.fetch

async function workflowHttp(t, home) {
  const projects = createWorkflowProjectStore({ libraryRoot: join(home, 'library') })
  const project = projects.create('Media recovery', { canvasWorkspaceIds: [workspaceId] })
  const resolveProjectRoot = id => projects.findByCanvasWorkspaceId(id)
  const store = createWorkspaceStore({ workspacesDir: join(home, 'workspaces'), resolveProjectRoot })
  store.create('Media recovery', workspaceId)
  const assetsStore = createProjectAssetsStore({ workspacesDir: store.workspacesDir, resolveProjectRoot })
  const assets = createProjectAssetsRoutes(assetsStore)
  const local = createLocalFileRoutes()
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname
      const result = await assets.tryHandle(req.method, path, req) ?? await local.tryHandle(req.method, path, req)
      if (result?.file) serveFile(res, result.file, 'application/octet-stream', req.headers.range)
      else res.writeHead(result?.status ?? 404, { 'Content-Type': 'application/json' }).end(JSON.stringify(result?.body ?? {}))
    } catch (error) { res.destroy(error) }
  })
  t.after(() => new Promise(resolve => server.close(resolve)))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  const fetch = (path, init) => httpFetch(new URL(path, origin), init)
  const file = join(project.path, 'assets', 'voice.wav')
  mkdirSync(join(project.path, 'assets'), { recursive: true })
  return { fetch, file }
}

function draftWindow() {
  const sessionStorage = new Map()
  return createClipPersistence({ sessionStorage: { getItem: key => sessionStorage.get(key), setItem: (key, value) => sessionStorage.set(key, value) } })
}

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'clip-live-media-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  draftRows.clear()
  const paths = resolveClipPaths({ homeDir: home })
  const host = createProjectStore({ paths })
  const records = new Map()
  const readCache = t.mock.method(StorageEngine.prototype, 'loadMedia', async key => records.get(key) ?? null)
  t.mock.method(StorageEngine.prototype, 'saveMedia', async record => { records.set(record.id, record) })
  return { home, host, paths, records, readCache }
}

function oldCanvasDraft(projectId, url = sourceUrl) {
  const audios = [{ path: url, url, name: 'voice.wav', durationMs: 1000, sourceId: 'voice', sourceVersion: 'v1' }]
  return { binding: bindingFor(projectId), audios, draftSchema: schemaFromOpenPayload({ projectId, upstreamInputs: { audios } }) }
}

function runCanvas(t, binding, { draftSchema, audios = [], mediaReturn } = {}, owns = current) {
  const result = Promise.withResolvers()
  const token = new AbortController()
  let cleanup
  globalThis.mountClipMediaEffect = effect => { cleanup = effect() }
  useCanvasIngestion({ source: 'canvas', ...binding, draftSchema, upstreamInputs: { audios }, mediaReturn }, token, owns, result.resolve)
  delete globalThis.mountClipMediaEffect
  t.after(() => { token.abort(); cleanup?.() })
  return { completed: result.promise, cancel: () => { token.abort(); cleanup?.() } }
}

function mediaResponse(bytes) {
  return new Response(bytes, { headers: { 'Content-Type': 'audio/wav' } })
}

function savedAudio(projectId, { name = 'voice.wav', digest, url, sourceOwner } = {}) {
  const project = createNativeProject(projectId, 'Media recovery', 1)
  project.mediaLibrary.items.push({
    id: 'voice', name, type: 'audio', missing: false,
    metadata: { duration: 1 / 8000, fileSize: 46, codec: 'pcm-s16le', sampleRate: 8000, channels: 1 },
    sourceFile: { name, size: 46, lastModified: 1 },
    sourceRef: { kind: 'indexeddb', key: 'voice', ...(digest ? { digest } : {}), ...(sourceOwner ? { projectId: sourceOwner } : {}) },
    ...(url ? { omnimuxSource: { id: 'voice-source', version: 'v1', url } } : {}),
  })
  return project
}

function cachedAudio(projectId, blob, key = 'voice') {
  return { id: key, projectId, blob, metadata: { fileSize: blob.size } }
}

function saveAudioVersion(host, project, binding) {
  if (binding) host.materialize(project.id, { binding })
  return host.save(project.id, project, { expectedRevision: binding ? 1 : 0, binding })
}

async function assertPlayable(item, bytes) {
  assert.equal(item.missing, false)
  assert.equal(item.isPlaceholder, false)
  assert.deepEqual(Buffer.from(await item.blob.arrayBuffer()), bytes)
  const engine = getMediaEngine()
  await engine.initialize()
  const waveform = await engine.generateWaveform(item.blob, 100)
  assert.equal(waveform.peaks[0], Math.abs(bytes.readInt16LE(44)) / 32768)
}

test('a materialized legacy canvas keeps the same workspace locator, media ID and placements through recovery and reopen', { timeout: 15_000 }, async t => {
  const { host, paths, records } = fixture(t)
  const bytes = wav(3200, 8000)
  const expectedUrl = verifiedUrl(sourceUrl, bytes)
  const draft = oldCanvasDraft('clip_node_legacy_audio', expectedUrl)
  const raw = `${JSON.stringify(draft.draftSchema, null, 2)}\r\n`
  const migrated = host.materialize(draft.binding.projectId, { binding: draft.binding, draftSchema: raw })
  const read = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, expectedUrl)
    assert.equal(options.redirect, 'error')
    assert.equal(options.mode, 'same-origin')
    assert.equal(options.credentials, 'same-origin')
    return mediaResponse(bytes)
  })
  await nativeEditorState.load(fromHost(migrated), current)
  const id = migrated.project.mediaLibrary.items[0].id
  const timeline = projectStore().project.timeline
  assert.equal(timeline.tracks.flatMap(track => track.clips)[0].mediaId, id)

  await runCanvas(t, draft.binding, draft).completed
  assert.equal(read.mock.callCount(), 1, 'the connected source must be read even with a populated old draft')
  assert.deepEqual(projectStore().project.timeline, timeline)
  assert.deepEqual(projectStore().project.mediaLibrary.items.map(item => item.id), [id])
  await assertPlayable(media(id), bytes)
  assert.equal(migrated.project.mediaLibrary.items[0].sourceRef.url, expectedUrl)
  const backup = join(paths.projectsDir, '.backups')
  const [backupName] = readdirSync(backup)
  assert.deepEqual(readFileSync(join(backup, backupName)), Buffer.from(raw))

  const captured = nativeEditorState.capture()
  const saved = host.save(draft.binding.projectId, captured.project, { binding: draft.binding, expectedRevision: migrated.revision })
  assert.equal(saved.project.mediaLibrary.items[0].sourceRef.digest, sha256(bytes))
  records.clear()
  await nativeEditorState.load(fromHost(host.load(saved.projectId)), current)
  await runCanvas(t, draft.binding).completed
  assert.equal(read.mock.callCount(), 2, 'a fresh editor without cache can reread the same verified source')
  assert.deepEqual(projectStore().project.timeline, timeline)
  await assertPlayable(media(id), bytes)
})

test('an already migrated hash-only draft recovers only its old connected source in place', { timeout: 15_000 }, async t => {
  const { home, host } = fixture(t)
  const http = await workflowHttp(t, home)
  const bytes = wav(1000, 8000)
  const expectedUrl = verifiedUrl(sourceUrl, bytes)
  const draft = oldCanvasDraft('clip_node_hash_only', expectedUrl)
  const migrated = host.materialize(draft.binding.projectId, draft)
  const [old] = migrated.project.mediaLibrary.items
  const project = { ...migrated.project, omnimuxCanvasInitialized: true, mediaLibrary: { items: [{
    ...old, sourceRef: { kind: 'legacy', fingerprint: sha256(expectedUrl) },
  }] } }
  const saved = host.save(migrated.projectId, project, { binding: draft.binding, expectedRevision: migrated.revision })
  writeFileSync(http.file, bytes)
  const read = t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, expectedUrl)
    return http.fetch(url)
  })
  const other = { ...draft.audios[0], url: sourceUrl, path: sourceUrl }
  await nativeEditorState.load(fromHost(saved), current)
  const timeline = projectStore().project.timeline
  await runCanvas(t, draft.binding, { ...draft, audios: [other, ...draft.audios] }).completed
  assert.equal(read.mock.callCount(), 1)
  assert.deepEqual(projectStore().project.mediaLibrary.items.map(item => item.id), [old.id])
  assert.deepEqual(projectStore().project.timeline, timeline)
  await assertPlayable(media(old.id), bytes)
})

test('a retained workspace locator works without a current connection to its upstream node', { timeout: 15_000 }, async t => {
  const { home, host } = fixture(t)
  const http = await workflowHttp(t, home)
  const bytes = wav(400, 8000)
  const expectedUrl = verifiedUrl(sourceUrl, bytes)
  const draft = oldCanvasDraft('clip_node_detached_input', expectedUrl)
  const migrated = host.materialize(draft.binding.projectId, draft)
  writeFileSync(http.file, bytes)
  const read = t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, expectedUrl)
    return http.fetch(url)
  })
  await nativeEditorState.load(fromHost(migrated), current)
  const timeline = projectStore().project.timeline
  await runCanvas(t, draft.binding).completed
  const [old] = migrated.project.mediaLibrary.items
  assert.equal(read.mock.callCount(), 1)
  assert.deepEqual(projectStore().project.mediaLibrary.items.map(item => item.id), [old.id])
  assert.deepEqual(projectStore().project.timeline, timeline)
  await assertPlayable(media(old.id), bytes)
})

async function assertMutableLegacyStaysMissing(t, mode) {
  const { home, host } = fixture(t)
  const http = await workflowHttp(t, home)
  const original = wav(333, 8000)
  const replacement = wav(-197, 8000)
  const draft = oldCanvasDraft(`clip_node_replaced_${mode}`)
  const migrated = host.materialize(draft.binding.projectId, draft)
  const [old] = migrated.project.mediaLibrary.items
  if (mode === 'hash-only') {
    const project = { ...migrated.project, mediaLibrary: { items: [{
      ...old, sourceRef: { kind: 'legacy', fingerprint: sha256(sourceUrl) },
    }] } }
    host.save(migrated.projectId, project, { binding: draft.binding, expectedRevision: migrated.revision })
  }
  writeFileSync(http.file, original)
  const before = await http.fetch(sourceUrl)
  assert.equal(before.status, 200)
  const originalSample = await firstSample(await before.blob())
  assert.equal(originalSample, 333)
  writeFileSync(http.file, replacement)
  const after = await http.fetch(sourceUrl)
  assert.equal(after.status, 200, 'unrelated legacy file reads keep serving the current path')
  const servedSample = await firstSample(await after.blob())
  assert.equal(servedSample, -197)
  const read = t.mock.method(globalThis, 'fetch', http.fetch)
  await nativeEditorState.load(fromHost(host.load(migrated.projectId)), current)
  const timeline = projectStore().project.timeline
  await runCanvas(t, draft.binding, mode === 'detached' ? {} : draft).completed
  const found = media(old.id)
  const attached = found.blob ? await firstSample(found.blob) : null
  const digest = nativeEditorState.capture().project.mediaLibrary.items[0].sourceRef.digest
  t.diagnostic(JSON.stringify({ mode, originalSample, servedSample, attached, missing: found.missing, recoveryRequests: read.mock.callCount(), digest: digest ?? null }))
  assert.equal(attached, null)
  assert.equal(found.missing, true)
  assert.equal(found.isPlaceholder, true)
  assert.equal(digest, undefined)
  assert.equal(read.mock.callCount(), 0)
  assert.deepEqual(projectStore().project.timeline, timeline)
  assert.deepEqual(projectStore().project.mediaLibrary.items.map(item => item.id), [old.id])

  if (mode === 'detached') {
    // This is the same native Store action used by the manual file picker.
    const relink = await projectStore().replaceMediaAsset(old.id, waveFile(original))
    assert.equal(relink.success, true)
    assert.equal(await firstSample(media(old.id).blob), 333)
    assert.equal(nativeEditorState.capture().project.mediaLibrary.items[0].sourceRef.digest, sha256(original))
    assert.deepEqual(projectStore().project.timeline, timeline)
  }
}

test('a mutable legacy workspace locator stays missing after same-path overwrite (connected)', { timeout: 15_000 }, async t => {
  await assertMutableLegacyStaysMissing(t, 'connected')
})

test('a mutable legacy workspace locator stays missing after same-path overwrite (detached)', { timeout: 15_000 }, async t => {
  await assertMutableLegacyStaysMissing(t, 'detached')
})

test('a mutable legacy workspace locator stays missing after same-path overwrite (hash-only)', { timeout: 15_000 }, async t => {
  await assertMutableLegacyStaysMissing(t, 'hash-only')
})

test('Workflow serves SHA-pinned project files and refuses a same-path replacement', { timeout: 15_000 }, async t => {
  const { home } = fixture(t)
  const http = await workflowHttp(t, home)
  const pinned = verifiedUrl(sourceUrl, winningBytes)
  const alias = pinned.replace(`/workspaces/${workspaceId}/file?`, `/project-file?workspace=${workspaceId}&`)
  writeFileSync(http.file, winningBytes)
  const first = await http.fetch(pinned)
  assert.equal(first.status, 200)
  assert.equal(await firstSample(await first.blob()), 133)
  const selectedRange = await http.fetch(alias, { headers: { Range: 'bytes=44-45' } })
  assert.equal(selectedRange.status, 206)
  assert.equal(Buffer.from(await selectedRange.arrayBuffer()).readInt16LE(), 133)
  writeFileSync(http.file, losingBytes)
  for (const url of [pinned, alias]) {
    const response = await http.fetch(url)
    t.diagnostic(JSON.stringify({ pinnedStatus: response.status }))
    assert.equal(response.status, 409)
    assert.deepEqual(await response.json(), { error: 'media-version-mismatch' })
  }
  const malformed = await http.fetch(`${sourceUrl}&rev=sha256%3Ainvalid`)
  assert.equal(malformed.status, 400)
  const unversioned = sourceUrl.replace('&rev=v1', '')
  for (const url of [sourceUrl, unversioned]) {
    const compatibility = await http.fetch(url)
    assert.equal(compatibility.status, 200)
    assert.equal(await firstSample(await compatibility.blob()), -222)
  }
  const legacyRange = await http.fetch(unversioned, { headers: { Range: 'bytes=44-45' } })
  assert.equal(legacyRange.status, 206)
  assert.equal(Buffer.from(await legacyRange.arrayBuffer()).readInt16LE(), -222)
  writeFileSync(http.file, winningBytes)
  const reread = await http.fetch(pinned)
  assert.equal(reread.status, 200)
  assert.equal(await firstSample(await reread.blob()), 133)
})

test('legacy recovery rechecks a verified revision even if a stale host returns 200 with wrong bytes', { timeout: 15_000 }, async t => {
  const { host } = fixture(t)
  const draft = oldCanvasDraft('clip_node_raced_verified', verifiedUrl(sourceUrl, winningBytes))
  const saved = host.materialize(draft.binding.projectId, draft)
  const old = saved.project.mediaLibrary.items[0]
  const read = t.mock.method(globalThis, 'fetch', async () => mediaResponse(losingBytes))
  await nativeEditorState.load(fromHost(saved), current)
  await runCanvas(t, draft.binding, draft).completed
  assert.equal(read.mock.callCount(), 1)
  assert.equal(media(old.id).missing, true)
  assert.equal(media(old.id).blob, null)
})

test('a newly linked revision at the same workspace path does not replace an unverified old version', { timeout: 15_000 }, async t => {
  const { host } = fixture(t)
  const draft = oldCanvasDraft('clip_node_new_revision')
  const migrated = host.materialize(draft.binding.projectId, draft)
  const newer = sourceUrl.replace('rev=v1', 'rev=v2')
  const read = t.mock.method(globalThis, 'fetch', async () => mediaResponse(wav(900, 8000)))
  await nativeEditorState.load(fromHost(migrated), current)
  const timeline = projectStore().project.timeline
  await runCanvas(t, draft.binding, { ...draft, audios: [{ ...draft.audios[0], path: newer, url: newer, sourceVersion: 'v2' }] }).completed
  const [item] = projectStore().project.mediaLibrary.items
  assert.equal(item.id, migrated.project.mediaLibrary.items[0].id)
  assert.equal(item.missing, true)
  assert.equal(read.mock.callCount(), 0)
  assert.deepEqual(projectStore().project.timeline, timeline)
})

test('a fresh canvas still ingests its upstream media once and retains the same ID on reentry', { timeout: 15_000 }, async t => {
  const { host } = fixture(t)
  const { binding, audios } = oldCanvasDraft('clip_node_fresh_audio')
  const empty = host.materialize(binding.projectId, { binding })
  const bytes = wav(1800, 8000)
  const read = t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, sourceUrl)
    return mediaResponse(bytes)
  })
  await nativeEditorState.load(fromHost(empty), current)
  await runCanvas(t, binding, { audios }).completed
  const [item] = projectStore().project.mediaLibrary.items
  assert.ok(item)
  // The original import has a playable Blob before any separate Host save.
  assert.deepEqual(Buffer.from(await item.blob.arrayBuffer()), bytes)
  assert.equal(projectStore().project.omnimuxCanvasInitialized, true)
  await runCanvas(t, binding, { audios }).completed
  assert.deepEqual(projectStore().project.mediaLibrary.items.map(entry => entry.id), [item.id])
  assert.equal(read.mock.callCount(), 1)
})

test('a Canvas media return appends a verified new version to the initialized editor once', { timeout: 15_000 }, async t => {
  const { home, host } = fixture(t)
  const projectId = 'clip_node_media_return'
  const binding = bindingFor(projectId)
  const { audios } = oldCanvasDraft(projectId)
  const http = await workflowHttp(t, home)
  const read = t.mock.method(globalThis, 'fetch', http.fetch)
  const first = verifiedUrl(sourceUrl, winningBytes)
  writeFileSync(http.file, winningBytes)
  await nativeEditorState.load(fromHost(host.materialize(binding.projectId, { binding })), current)
  await runCanvas(t, binding, { audios: [{ ...audios[0], path: first, url: first }] }).completed
  const [original] = projectStore().project.mediaLibrary.items
  assert.equal(await firstSample(original.blob), 133)
  assert.equal(projectStore().project.omnimuxCanvasInitialized, true)
  const timeline = structuredClone(projectStore().project.timeline)

  const next = verifiedUrl(sourceUrl, losingBytes)
  writeFileSync(http.file, losingBytes)
  const updated = [{ ...audios[0], path: next, url: next, sourceVersion: 'v2' }]
  await runCanvas(t, binding, { audios: updated }).completed
  assert.equal(read.mock.callCount(), 1)
  const returned = { requestId: 'return-audio', upstreamInputs: { audios: updated } }
  await runCanvas(t, binding, { audios: updated, mediaReturn: returned }).completed
  const [kept, imported] = projectStore().project.mediaLibrary.items
  assert.equal(kept.id, original.id)
  assert.equal(await firstSample(kept.blob), 133)
  assert.notEqual(imported?.id, kept.id)
  assert.equal(await firstSample(imported.blob), -222)
  assert.deepEqual(projectStore().project.timeline, timeline)
  await runCanvas(t, binding, { audios: updated, mediaReturn: returned }).completed
  assert.deepEqual(projectStore().project.mediaLibrary.items.map(item => item.id), [kept.id, imported.id])
  assert.equal(read.mock.callCount(), 2)
})

test('a Canvas return cannot add data with the wrong pinned digest or after its seat leaves', { timeout: 15_000 }, async t => {
  const { host } = fixture(t)
  const projectId = 'clip_node_late_media_return'
  const binding = bindingFor(projectId)
  const { audios } = oldCanvasDraft(projectId)
  const pending = Promise.withResolvers()
  const started = Promise.withResolvers()
  let reads = 0
  const read = t.mock.method(globalThis, 'fetch', async () => {
    if (++reads === 1) return mediaResponse(losingBytes)
    started.resolve()
    return pending.promise
  })
  await nativeEditorState.load(fromHost(host.materialize(binding.projectId, { binding })), current)
  await runCanvas(t, binding).completed
  assert.equal(projectStore().project.omnimuxCanvasInitialized, true)
  const pinned = verifiedUrl(sourceUrl, winningBytes)
  const mediaReturn = { requestId: 'late-audio', upstreamInputs: { audios: [{ ...audios[0], path: pinned, url: pinned }] } }
  await runCanvas(t, binding, { mediaReturn }).completed
  assert.equal(read.mock.callCount(), 1)
  assert.deepEqual(projectStore().project.mediaLibrary.items, [])

  const old = runCanvas(t, binding, { mediaReturn })
  await started.promise
  old.cancel()
  const next = host.materialize('another-clip-media-draft', { title: 'Another project' })
  await nativeEditorState.load(fromHost(next), current)
  pending.resolve(mediaResponse(winningBytes))
  // Yield beyond the stale fetch continuation before inspecting the new seat.
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(projectStore().project.id, next.projectId)
  assert.deepEqual(projectStore().project.mediaLibrary.items, [])
})

test('old drafts do not follow external, local-file, path escape or foreign workspace locators', { timeout: 15_000 }, async t => {
  const { host } = fixture(t)
  const urls = [
    `https://example.invalid${sourceUrl}`,
    `//example.invalid${sourceUrl}`,
    '/omnimux-workflow/api/local-file?path=%2Foutside.wav',
    sourceUrl.replace('assets%2Fvoice.wav', '..%2Foutside.wav'),
    sourceUrl.replace(workspaceId, 'ws_other'),
    `${sourceUrl}&path=%2Foutside.wav`,
  ]
  const read = t.mock.method(globalThis, 'fetch', async () => mediaResponse(wav(1000)))
  for (const [index, url] of urls.entries()) {
    const draft = oldCanvasDraft(`clip_node_bad_media_${index}`, url)
    const saved = host.materialize(draft.binding.projectId, draft)
    const [item] = saved.project.mediaLibrary.items
    assert.ok(!item.sourceRef.url)
    await nativeEditorState.load(fromHost(saved), current)
    const timeline = projectStore().project.timeline
    await runCanvas(t, draft.binding, draft).completed
    assert.equal(media(item.id).isPlaceholder, true)
    assert.equal(media(item.id).missing, true)
    assert.equal(media(item.id).blob, null)
    assert.deepEqual(projectStore().project.timeline, timeline)
  }
  assert.equal(read.mock.callCount(), 0)
})

test('a late legacy response cannot attach media after a project switch', { timeout: 15_000 }, async t => {
  const { host, records } = fixture(t)
  const bytes = wav(1200, 8000)
  const expectedUrl = verifiedUrl(sourceUrl, bytes)
  const draft = oldCanvasDraft('clip_node_late_media', expectedUrl)
  const migrated = host.materialize(draft.binding.projectId, draft)
  const opened = Promise.withResolvers()
  const response = Promise.withResolvers()
  const read = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, expectedUrl)
    opened.resolve(options.signal)
    return response.promise
  })
  await nativeEditorState.load(fromHost(migrated), current)
  const ingestion = runCanvas(t, draft.binding, draft)
  const signal = await Promise.race([opened.promise, ingestion.completed])
  assert.ok(signal instanceof AbortSignal)
  const next = createNativeProject('different-editor')
  ingestion.cancel()
  await nativeEditorState.load({ project: next, media: {} }, current)
  const loaded = projectStore().project
  response.resolve(mediaResponse(bytes))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(signal.aborted, true)
  assert.equal(read.mock.callCount(), 1)
  assert.equal(projectStore().project, loaded)
  assert.deepEqual(projectStore().project.mediaLibrary.items, [])
  assert.equal(records.size, 0)
  assert.deepEqual(host.load(migrated.projectId), migrated)
})

test('Host selection checks same-ID, equal-length cache bytes and rereads the expected version', { timeout: 15_000 }, async t => {
  const { host, records } = fixture(t)
  const projectId = 'clip_node_audio_cas'
  const binding = bindingFor(projectId)
  const hostVersion = savedAudio(projectId, { name: 'host.wav', digest: sha256(winningBytes), url: sourceUrl })
  const winning = saveAudioVersion(host, hostVersion, binding)
  assert.equal(winning.revision, 2)
  const local = { project: savedAudio(projectId, { name: 'local.wav' }), binding, revision: 2, localBaseRevision: 1, media: { voice: waveBlob(losingBytes) } }
  records.set('voice', cachedAudio(projectId, local.media.voice))
  const read = t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, sourceUrl)
    return mediaResponse(winningBytes)
  })
  await nativeEditorState.load(fromHost(host.load(projectId), local), current)
  assert.equal(media('voice').name, 'host.wav')
  assert.equal(await firstSample(media('voice').blob), 133)
  assert.equal(read.mock.callCount(), 1)
  await assertPlayable(media('voice'), winningBytes)

  // Identical, owner-matched cache bytes are used even when the URL is offline.
  records.set('voice', cachedAudio(projectId, waveBlob(winningBytes)))
  await nativeEditorState.load(fromHost(winning), current)
  assert.equal(read.mock.callCount(), 1)
  assert.equal(await firstSample(media('voice').blob), 133)
})

test('Host selection searches all confirmed writers for the selected media digest after cache pollution', { timeout: 15_000 }, async t => {
  const { host, records, readCache } = fixture(t)
  const projectId = 'clip_node_cross_window'
  const binding = bindingFor(projectId)
  const selected = saveAudioVersion(host, savedAudio(projectId, { digest: sha256(winningBytes) }), binding)
  const other = draftWindow()
  const selectedDraft = fromHost(selected)
  const wrong = waveBlob(losingBytes)
  const right = waveBlob(winningBytes)
  const losingProject = savedAudio(projectId, { digest: sha256(losingBytes) })
  await other.writeLocal({ ...selectedDraft, localBaseRevision: 1, project: losingProject, media: { voice: wrong } })
  await draftWindow().writeLocal({ ...selectedDraft, binding: { ...binding, nodeId: 'wrong-node' }, media: { voice: right } })
  await draftWindow().writeLocal({ ...selectedDraft, localBaseRevision: 1, media: { voice: right } })
  await draftWindow().writeLocal({ ...selectedDraft, media: { voice: wrong } })
  records.set('voice', cachedAudio(projectId, wrong))
  const read = t.mock.method(globalThis, 'fetch', async () => assert.fail('No permitted network URL for the asset'))
  const alternate = await other.readLocal(projectId)
  await nativeEditorState.load(fromHost(host.load(projectId), alternate), current)
  assert.equal(media('voice').missing, true, 'pending rows, wrong bindings and wrong hashes cannot supply bytes')

  const winner = draftWindow()
  await winner.writeLocal({ ...selectedDraft, media: { voice: right } })
  await nativeEditorState.load(fromHost(host.load(projectId), alternate), current)
  const actual = media('voice')
  const attached = actual.blob ? await firstSample(actual.blob) : null
  t.diagnostic(JSON.stringify({ revision: selected.revision, sharedCacheSample: -222, attached, missing: actual.missing, networkReads: read.mock.callCount() }))
  assert.equal(attached, 133)
  await assertPlayable(actual, winningBytes)

  // The asset SHA also proves bytes carried by an earlier confirmed revision.
  await winner.writeLocal({ ...selectedDraft, revision: 1, localBaseRevision: 1, media: { voice: right } })
  await nativeEditorState.load(fromHost(host.load(projectId), alternate), current)
  assert.equal(await firstSample(media('voice').blob), 133)
  assert.equal(readCache.mock.callCount(), 3)
  assert.equal(read.mock.callCount(), 0)
})

test('overwriting a writer draft still permits an existing confirmed backup, with no recovery from pending rows', { timeout: 15_000 }, async t => {
  const { host, records } = fixture(t)
  const projectId = 'clip_node_existing_media_backup'
  const selected = saveAudioVersion(host, savedAudio(projectId, { digest: sha256(winningBytes) }), bindingFor(projectId))
  const confirmed = { ...fromHost(selected), media: { voice: waveBlob(winningBytes) } }
  const winner = draftWindow()
  await winner.writeLocal(confirmed)
  const pending = { ...confirmed, revision: selected.revision + 1 }
  await winner.writeLocal(pending)
  records.set('voice', cachedAudio(projectId, waveBlob(losingBytes)))
  const currentHostRecord = () => fromHost(host.load(projectId))
  await winner.backupLocal(pending)
  await nativeEditorState.load(currentHostRecord(), current)
  assert.equal(media('voice').missing, true)
  assert.equal(media('voice').blob, null)
  assert.equal((await winner.readLocal(projectId)).revision, pending.revision)
  await winner.backupLocal(confirmed)
  await nativeEditorState.load(currentHostRecord(), current)
  assert.equal(media('voice').missing, false)
  assert.equal(await firstSample(media('voice').blob), 133)
  assert.equal((await winner.readLocal(projectId)).revision, pending.revision)
})

async function initializedLocalCanvas(t, label) {
  const { home, host, records } = fixture(t)
  const http = await workflowHttp(t, home)
  const url = `/omnimux-workflow/api/local-file?path=${encodeURIComponent(http.file)}&rev=original`
  const { binding, audios } = oldCanvasDraft(`clip_node_${label}`, url)
  const project = host.materialize(binding.projectId, { binding })
  writeFileSync(http.file, winningBytes)
  const read = t.mock.method(globalThis, 'fetch', http.fetch)
  await nativeEditorState.load(fromHost(project), current)
  await runCanvas(t, binding, { audios }).completed
  const captured = nativeEditorState.capture().project
  const saved = host.save(project.projectId, captured, { binding, expectedRevision: project.revision })
  const [item] = saved.project.mediaLibrary.items
  assert.equal(saved.project.omnimuxCanvasInitialized, true)
  assert.equal(item.sourceRef.digest, sha256(winningBytes))
  assert.equal(await firstSample(media(item.id).blob), 133)
  assert.ok(!JSON.stringify(saved.project).includes(http.file))
  assert.equal(item.omnimuxSource.url, undefined)
  records.set(item.id, cachedAudio(project.projectId, waveBlob(losingBytes), item.id))
  const lost = fromHost(host.load(project.projectId))
  await nativeEditorState.load(lost, current)
  assert.equal(media(item.id).missing, true)
  return { host, http, url, binding, audios, item, read, lost }
}

test('Use saved version retries the connected local-file in the already mounted canvas Portal', { timeout: 15_000 }, async t => {
  const { host, binding, audios, item, read, lost } = await initializedLocalCanvas(t, 'adopt-in-portal')
  const { omnimuxSource, ...savedItem } = item
  const fingerprint = omnimuxSource.id
  const selected = host.save(binding.projectId, { ...lost.project, mediaLibrary: { items: [{ ...savedItem,
    sourceRef: { ...savedItem.sourceRef, fingerprint },
  }] } }, { binding, expectedRevision: lost.revision })
  assert.equal(selected.project.mediaLibrary.items[0].omnimuxSource, undefined)
  const { JSDOM } = createRequire(new URL('../../plugins/omnimux/package.json', import.meta.url))('jsdom')
  const dom = new JSDOM(`<div id="root"></div><div data-omnimux-canvas-tab data-canvas-workspace-id="${binding.workspaceId}"></div>`, {
    url: 'http://localhost/', pretendToBeVisual: true,
  })
  const observer = class { observe() {} disconnect() {} }
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    HTMLStyleElement: dom.window.HTMLStyleElement, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: observer, IntersectionObserver: observer }
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, globals)
  const canvasHost = document.querySelector('[data-omnimux-canvas-tab]')
  canvasHost.getBoundingClientRect = () => ({ width: 900, height: 600 })
  const stage = createStageStore(() => ({}))
  stage.openFromCanvas({ ...binding, upstreamInputs: { audios } })
  const storage = draftWindow()
  const loser = { ...item, sourceRef: { ...item.sourceRef, digest: sha256(losingBytes) } }
  await storage.writeLocal({ ...lost, revision: selected.revision + 1, localBaseRevision: 1, media: { [item.id]: waveBlob(losingBytes) },
    project: { ...lost.project, name: 'Unconfirmed canvas draft', mediaLibrary: { items: [loser] } } })
  storage.readHost = async id => host.load(id)
  storage.writeHost = async record => host.save(record.project.id, record.project, {
    binding, expectedRevision: record.localBaseRevision, revision: record.revision,
  })
  const session = createEditorSession({ storage, native: nativeEditorState, document,
    workbench: () => ({ getActiveSurface: () => ({ tabId: CANVAS_TAB, instanceId: 'canvas-tab', sessionId: 'test-session', panelOpen: true }) }),
  })
  const ingestion = Promise.withResolvers()
  const finishIngestion = session.finishIngestion
  session.finishIngestion = async () => {
    try { await finishIngestion() } finally { ingestion.resolve() }
  }
  const root = createRoot(document.getElementById('root'))
  try {
    await act(async () => root.render(React.createElement(ClipStage, { stage, runtime: { session }, t: key => key })))
    await act(async () => session.getWaiting())
    const mounted = canvasHost.querySelector('[data-media-recovery-editor]')
    assert.ok(mounted)
    const conflict = canvasHost.querySelector('[data-clip-sync="conflict"]')
    assert.ok(conflict)
    assert.equal(await firstSample(media(item.id).blob), -222)
    assert.equal(read.mock.callCount(), 1, 'conflict pauses automatic recovery')
    await act(async () => {
      const useSaved = [...conflict.querySelectorAll('button')].find(button => button.textContent === 'tab.useSaved')
      assert.ok(useSaved)
      useSaved.click()
      await session.getWaiting()
    })
    await act(async () => ingestion.promise)
    assert.equal(canvasHost.querySelector('[data-clip-sync="conflict"]'), null)
    assert.equal(canvasHost.querySelector('[data-media-recovery-editor]'), mounted)
    const actual = media(item.id)
    const attached = actual.blob ? await firstSample(actual.blob) : null
    t.diagnostic(JSON.stringify({ samePortal: true, conflictCleared: true, savedSourceFingerprint: fingerprint,
      storedUrl: selected.project.mediaLibrary.items[0].omnimuxSource?.url ?? null,
      attached, selectedDigest: item.sourceRef.digest, localFileReads: read.mock.callCount() - 1 }))
    assert.equal(attached, 133)
    assert.equal(read.mock.callCount(), 2)
    assert.equal(host.load(binding.projectId).project.mediaLibrary.items[0].sourceRef.digest, sha256(winningBytes))
  } finally {
    await act(async () => root.unmount())
    session.dispose()
    await session.getWaiting()
    stage.dispose()
    dom.window.close()
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})

test('reopened initialized canvas uses only its connected local file and rejects same-path wrong bytes', { timeout: 15_000 }, async t => {
  const { http, url, binding, audios, item, read } = await initializedLocalCanvas(t, 'reopen-local')
  const timeline = projectStore().project.timeline
  await runCanvas(t, binding).completed
  const wrongSource = url.replace('voice.wav', 'other.wav')
  await runCanvas(t, binding, { audios: [{ ...audios[0], url: wrongSource, path: wrongSource }] }).completed
  await runCanvas(t, binding, { audios: [{ ...audios[0], url: `https://foreign.example${url}` }] }).completed
  assert.equal(read.mock.callCount(), 1, 'no disconnected, different-source or foreign URL may be read')

  writeFileSync(http.file, losingBytes)
  await runCanvas(t, binding, { audios }).completed
  assert.equal(media(item.id).blob, null)
  assert.equal(media(item.id).missing, true)
  writeFileSync(http.file, winningBytes)
  await runCanvas(t, binding, { audios }).completed
  const actual = media(item.id)
  const attached = actual.blob ? await firstSample(actual.blob) : null
  t.diagnostic(JSON.stringify({ initialized: true, attached, missing: actual.missing, localFileReads: read.mock.callCount() - 1 }))
  assert.equal(attached, 133)
  assert.equal(read.mock.callCount(), 3)
  await assertPlayable(actual, winningBytes)
  assert.deepEqual(projectStore().project.timeline, timeline)
  assert.deepEqual(projectStore().project.mediaLibrary.items.map(entry => entry.id), [item.id])
  assert.equal(nativeEditorState.capture().project.mediaLibrary.items[0].omnimuxSource.url, undefined)
})

test('a delayed local-file read cannot commit into a newer generation of the same canvas', { timeout: 15_000 }, async t => {
  const { http, binding, audios, item, lost } = await initializedLocalCanvas(t, 'reopen-generation')
  const pending = Promise.withResolvers()
  const arrived = Promise.withResolvers()
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const response = await http.fetch(url, options)
    arrived.resolve()
    await pending.promise
    return response
  })
  let completed = false
  const old = runCanvas(t, binding, { audios })
  void old.completed.then(() => { completed = true })
  assert.equal(await Promise.race([arrived.promise.then(() => true), old.completed.then(() => false)]), true)
  const next = { ...lost, project: { ...lost.project, name: 'Next selected revision' } }
  await nativeEditorState.load(next, current)
  const loaded = projectStore().project
  pending.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(completed, false)
  assert.equal(projectStore().project, loaded)
  assert.equal(media(item.id).blob, null)
})

test('Host selection marks mismatched bytes missing and accepts only a verified inline or cache copy', { timeout: 15_000 }, async t => {
  const { host, records } = fixture(t)
  const projectId = 'clip_node_audio_collision'
  const committed = saveAudioVersion(host, savedAudio(projectId, { digest: sha256(winningBytes), url: sourceUrl }), bindingFor(projectId))
  const wrong = waveBlob(losingBytes)
  records.set('voice', cachedAudio(projectId, wrong))
  const read = t.mock.method(globalThis, 'fetch', async () => mediaResponse(losingBytes))
  await nativeEditorState.load({ ...fromHost(committed), media: { voice: wrong } }, current)
  assert.deepEqual([media('voice').blob, media('voice').missing, media('voice').isPlaceholder], [null, true, true])
  assert.equal(read.mock.callCount(), 1)

  // An unrelated project's cache record is not a source, even with the same ID and digest.
  records.set('voice', cachedAudio('another-project', waveBlob(winningBytes)))
  await nativeEditorState.load(fromHost(committed), current)
  assert.equal(media('voice').missing, true)
  assert.equal(read.mock.callCount(), 2)

  await nativeEditorState.load({ ...fromHost(committed), media: { voice: waveBlob(winningBytes) } }, current)
  assert.equal(await firstSample(media('voice').blob), 133)
  assert.equal(read.mock.callCount(), 2)
})

test('old Host records without a digest keep acknowledged draft bytes and reject divergent candidates', { timeout: 15_000 }, async t => {
  const { host, records } = fixture(t)
  const projectId = 'old-audio-branch'
  const committed = saveAudioVersion(host, savedAudio(projectId))
  const next = host.save(projectId, committed.project, { expectedRevision: 1 })
  const divergent = { ...fromHost(next), project: structuredClone(next.project), localBaseRevision: 1, media: { voice: waveBlob(losingBytes) } }
  records.set('voice', cachedAudio(projectId, divergent.media.voice))
  await nativeEditorState.load(fromHost(next, divergent), current)
  assert.deepEqual([media('voice').blob, media('voice').missing, media('voice').isPlaceholder], [null, true, true])

  const confirmed = { ...fromHost(next), media: { voice: waveBlob(winningBytes) } }
  await nativeEditorState.load(fromHost(next, confirmed), current)
  assert.equal(await firstSample(media('voice').blob), 133)
  assert.equal(nativeEditorState.capture().project.mediaLibrary.items[0].sourceRef.digest, sha256(winningBytes))
})

test('saved file handles cannot bypass the selected media digest', { timeout: 15_000 }, async t => {
  const { host } = fixture(t)
  const projectId = 'saved-audio-handle'
  const committed = saveAudioVersion(host, savedAudio(projectId, { digest: sha256(winningBytes), url: sourceUrl }))
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }))
  let file = waveFile(losingBytes)
  t.mock.method(StorageEngine.prototype, 'loadFileHandle', async () => ({ getFile: async () => file }))
  t.mock.method(StorageEngine.prototype, 'loadDirectoryHandle', async () => null)
  await nativeEditorState.load(fromHost(committed), current)
  const tryRelink = () => restoreProjectPlaceholders(projectStore().project, {
    isCurrent: current,
    getItem: media,
    replace: (id, found, folder) => projectStore().replaceMediaAsset(id, found, folder, { restorePlaceholder: true }),
  })
  assert.equal(await tryRelink(), 0)
  assert.deepEqual([media('voice').blob, media('voice').missing], [null, true])

  file = waveFile(winningBytes)
  assert.equal(await tryRelink(), 1)
  await assertPlayable(media('voice'), winningBytes)
  assert.equal(media('voice').omnimuxSource.url, sourceUrl)
})

test('native edit imports persist the media digest even if the resolver supplies a version label', { timeout: 15_000 }, async t => {
  const { host } = fixture(t)
  const projectId = 'native-audio-digest'
  await nativeEditorState.load({ project: createNativeProject(projectId), media: {} }, current)
  const source = { id: 'native-source', version: 'workspace-v1' }
  const operation = { type: 'import_media', mediaId: 'voice', path: 'assets/voice.wav', placeOnTimeline: false }
  const importSource = bytes => executeNativeEdit({ description: 'Import source', operations: [operation] }, {
    assertCurrent() {}, resolveMedia: () => ({ file: waveFile(bytes), source }),
  })
  const result = await importSource(winningBytes)
  assert.equal(result.results[0].mediaId, 'voice')
  const snapshot = nativeEditorState.capture()
  const saved = saveAudioVersion(host, snapshot.project)
  assert.equal(saved.project.mediaLibrary.items[0].sourceRef.digest, sha256(winningBytes))
  await assert.rejects(importSource(losingBytes), /Media bytes changed for the same source version/)
  assert.equal(await firstSample(media('voice').blob), 133)
})

test('replacement publishes clean version fields before storage settles and delayed writes preserve the current bytes', { timeout: 15_000 }, async t => {
  const { host, records } = fixture(t)
  const projectId = 'audio-replacement-race'
  await nativeEditorState.load({ project: createNativeProject(projectId), media: {} }, current)
  const imported = await projectStore().importMedia(waveFile(winningBytes), undefined, {
    omnimuxSource: { id: 'previous-source', version: 'v1', url: sourceUrl, digest: sha256(winningBytes) },
  })
  assert.equal(imported.success, true, imported.error?.message)
  const id = imported.actionId
  const oldWrite = Promise.withResolvers()
  const releaseWrite = Promise.withResolvers()
  const newPublish = Promise.withResolvers()
  const delayed = waveFile(losingBytes)
  const newestBytes = wav(733)
  const newest = waveFile(newestBytes)
  t.mock.method(StorageEngine.prototype, 'saveMedia', async record => {
    if (record.blob === delayed) {
      oldWrite.resolve()
      await releaseWrite.promise
    }
    records.set(record.id, record)
  })
  const unsubscribe = useProjectStore.subscribe(state => {
    if (state.getMediaItem(id)?.blob === newest) newPublish.resolve()
  })
  const older = projectStore().replaceMediaAsset(id, delayed)
  let update
  try {
    await oldWrite.promise
    update = projectStore().replaceMediaAsset(id, newest)
    await newPublish.promise
    const snapshot = nativeEditorState.capture()
    const saved = saveAudioVersion(host, snapshot.project)
    // A complete project revision contains the digest even while the separate cache write is pending.
    assert.equal(saved.project.mediaLibrary.items[0].sourceRef.digest, sha256(newestBytes))
    assert.equal(saved.project.mediaLibrary.items[0].omnimuxSource, undefined)
    assert.equal(media(id).missing, false)
    assert.equal(await firstSample(snapshot.media[id]), 733)
    await nativeEditorState.load(fromHost(saved), current)
    const offline = media(id)
    assert.deepEqual([offline.blob, offline.missing], [null, true])
  } finally {
    releaseWrite.resolve()
    await Promise.all([older, update])
    unsubscribe()
  }
  assert.equal(await firstSample(records.get(id).blob), 733)
  await nativeEditorState.load(fromHost(host.load(projectId)), current)
  assert.equal(await firstSample(media(id).blob), 733)
})
