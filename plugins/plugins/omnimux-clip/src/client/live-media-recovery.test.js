import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { mock } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { resolveClipPaths } from '../paths.js'
import { createNativeProject } from '../store/nativeProject.js'
import { createProjectStore } from '../store/projectStore.js'
import { schemaFromOpenPayload } from './store/timelineTypes.js'

const directory = fileURLToPath(new URL('./', import.meta.url))
const vendor = join(directory, 'openreel')
const built = await build({
  stdin: {
    contents: `export { useCanvasIngestion } from './hooks/useCanvasIngestion';
      export { nativeEditorState } from './live/native-state';
      export { fromHost } from './live/persistence.js';
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
  define: { 'import.meta.env': '{}', 'import.meta.hot': 'undefined', 'import.meta.url': JSON.stringify(import.meta.url) },
  loader: { '.wgsl': 'text', '.css': 'empty', '.svg': 'dataurl', '.wasm': 'dataurl' },
  plugins: [{ name: 'clip-media-test-browser', setup(builder) {
    builder.onResolve({ filter: /^react$/ }, args => args.importer.endsWith('/hooks/useCanvasIngestion.ts')
      ? { path: 'react-effect', namespace: 'clip-media-test' } : undefined)
    builder.onResolve({ filter: /\?worker&url$/ }, () => ({ path: 'worker', namespace: 'clip-media-test' }))
    builder.onLoad({ filter: /.*/, namespace: 'clip-media-test' }, args => ({
      contents: args.path === 'react-effect'
        ? 'export function useEffect(effect) { globalThis.mountClipMediaEffect(effect) }'
        : 'export default "about:blank"',
    }))
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
const module = { exports: {} }
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
const { nativeEditorState, fromHost, executeNativeEdit, useProjectStore, useCanvasIngestion, getMediaEngine, StorageEngine,
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
const firstSample = async blob => Buffer.from(await blob.arrayBuffer()).readInt16LE(44)
const bindingFor = id => ({ projectId: id, workspaceId, nodeId: 'compose' })

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'clip-live-media-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const paths = resolveClipPaths({ homeDir: home })
  const host = createProjectStore({ paths })
  const records = new Map()
  const readCache = t.mock.method(StorageEngine.prototype, 'loadMedia', async key => records.get(key) ?? null)
  t.mock.method(StorageEngine.prototype, 'saveMedia', async record => { records.set(record.id, record) })
  return { host, paths, records, readCache }
}

function oldCanvasDraft(projectId, url = sourceUrl) {
  const audios = [{ path: url, url, name: 'voice.wav', durationMs: 1000, sourceId: 'voice', sourceVersion: 'v1' }]
  return { binding: bindingFor(projectId), audios, draftSchema: schemaFromOpenPayload({ projectId, upstreamInputs: { audios } }) }
}

function runCanvas(t, binding, { draftSchema, audios = [] } = {}, owns = current) {
  const result = Promise.withResolvers()
  const token = new AbortController()
  let cleanup
  globalThis.mountClipMediaEffect = effect => { cleanup = effect() }
  useCanvasIngestion({ source: 'canvas', ...binding, draftSchema, upstreamInputs: { audios } }, token, owns, result.resolve)
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
  const draft = oldCanvasDraft('clip_node_legacy_audio')
  const raw = `${JSON.stringify(draft.draftSchema, null, 2)}\r\n`
  const migrated = host.materialize(draft.binding.projectId, { binding: draft.binding, draftSchema: raw })
  const bytes = wav(3200, 8000)
  const read = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, sourceUrl)
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
  assert.equal(migrated.project.mediaLibrary.items[0].sourceRef.url, sourceUrl)
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
  const { host } = fixture(t)
  const draft = oldCanvasDraft('clip_node_hash_only')
  const migrated = host.materialize(draft.binding.projectId, draft)
  const [old] = migrated.project.mediaLibrary.items
  const project = { ...migrated.project, omnimuxCanvasInitialized: true, mediaLibrary: { items: [{
    ...old, sourceRef: { kind: 'legacy', fingerprint: sha256(sourceUrl) },
  }] } }
  const saved = host.save(migrated.projectId, project, { binding: draft.binding, expectedRevision: migrated.revision })
  const bytes = wav(1000, 8000)
  const read = t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, sourceUrl)
    return mediaResponse(bytes)
  })
  const other = { ...draft.audios[0], url: sourceUrl.replace('rev=v1', 'rev=v2'), path: sourceUrl.replace('rev=v1', 'rev=v2') }
  await nativeEditorState.load(fromHost(saved), current)
  const timeline = projectStore().project.timeline
  await runCanvas(t, draft.binding, { ...draft, audios: [other, ...draft.audios] }).completed
  assert.equal(read.mock.callCount(), 1)
  assert.deepEqual(projectStore().project.mediaLibrary.items.map(item => item.id), [old.id])
  assert.deepEqual(projectStore().project.timeline, timeline)
  await assertPlayable(media(old.id), bytes)
})

test('a retained workspace locator works without a current connection to its upstream node', { timeout: 15_000 }, async t => {
  const { host } = fixture(t)
  const draft = oldCanvasDraft('clip_node_detached_input')
  const migrated = host.materialize(draft.binding.projectId, draft)
  const bytes = wav(400, 8000)
  const read = t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, sourceUrl)
    return mediaResponse(bytes)
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
  const draft = oldCanvasDraft('clip_node_late_media')
  const migrated = host.materialize(draft.binding.projectId, draft)
  const opened = Promise.withResolvers()
  const response = Promise.withResolvers()
  const read = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, sourceUrl)
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
  response.resolve(mediaResponse(wav(1200, 8000)))
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
