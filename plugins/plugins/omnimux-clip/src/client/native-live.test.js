import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test, { beforeEach, mock } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const directory = fileURLToPath(new URL('./', import.meta.url))
const vendor = fileURLToPath(new URL('./openreel/', import.meta.url))
const require = createRequire(import.meta.url)
const built = await build({
  stdin: {
    contents: `export { executeNativeAnalyze } from './live/native-analyze';
      export { executeNativeEdit } from './live/native-edit';
      export { captureNativeFrames, executeNativeView, readNativeSnapshot } from './live/native-view';
      export { useProjectStore } from './openreel/web/stores/project-store';
      export { useTimelineStore } from './openreel/web/stores/timeline-store';
      export { useUIStore } from './openreel/web/stores/ui-store';
      export { useEngineStore } from './openreel/web/stores/engine-store';
      export { getMediaEngine } from './openreel/core/media/mediabunny-engine';
      export { EffectsBridge } from './openreel/web/bridges/effects-bridge';
      export { getMediaBridge } from './openreel/web/bridges/media-bridge';
      export { shouldProbeAudioStreamsWithFfmpeg } from './openreel/core/media/media-import-service';
      export { projectAssetUrlFromHandle } from './live/bridged-media';`,
    resolveDir: directory,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  jsx: 'automatic',
  alias: {
    '@openreel/core': `${vendor}core`,
    '@openreel/ui': `${vendor}ui`,
    '@openreel/agent': `${vendor}agent`,
    '@openreel/creation-schema': `${vendor}creation-schema`,
  },
  define: { 'import.meta.env': '{}', 'import.meta.hot': 'undefined', 'import.meta.url': JSON.stringify(import.meta.url) },
  loader: { '.wgsl': 'text', '.css': 'empty', '.svg': 'dataurl', '.wasm': 'dataurl' },
  plugins: [{ name: 'unused-browser-workers', setup(build) {
    build.onResolve({ filter: /\?worker&url$/ }, () => ({ path: 'worker', namespace: 'worker' }))
    build.onLoad({ filter: /.*/, namespace: 'worker' }, () => ({ contents: 'export default "about:blank"' }))
  } }],
})

// Stores, domain actions and history are real. Only browser drawing and media
// metadata I/O are isolated here. Browser pixel verification is separate.
class TestCanvas {
  constructor(width, height) { this.width = width; this.height = height }
  getContext() { return { drawImage() {} } }
  convertToBlob() { return Promise.resolve(new Blob(['encoded by the canvas in browsers'], { type: 'image/png' })) }
}
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: () => null, setItem() {}, removeItem() {},
} })
globalThis.OffscreenCanvas = TestCanvas
globalThis.self = {}
const module = { exports: {} }
new Function('require', 'module', 'exports', built.outputFiles[0].text)(require, module, module.exports)
const { executeNativeAnalyze, executeNativeEdit, captureNativeFrames, executeNativeView, readNativeSnapshot, useProjectStore,
  useTimelineStore, useUIStore, useEngineStore, getMediaEngine, EffectsBridge, getMediaBridge,
  shouldProbeAudioStreamsWithFfmpeg, projectAssetUrlFromHandle } = module.exports
mock.method(EffectsBridge.prototype, 'initialize', async () => {})
const store = () => useProjectStore.getState()
const timeline = () => useTimelineStore.getState()
const assertCurrent = () => {}
const edit = (operations, opts = {}, deps = {}) => executeNativeEdit({ operations, description: '剪成产品开场', ...opts }, { assertCurrent, ...deps })
const mediaFile = new File(['test video'], 'source.mp4', { type: 'video/mp4' })
const mediaMetadata = { duration: 12, width: 320, height: 180, frameRate: 30, codec: 'avc', sampleRate: 48000, channels: 2, fileSize: 10, hasVideo: true, hasAudio: true }
const media = { id: 'source', name: 'Source', blob: mediaFile, type: 'video', metadata: mediaMetadata, thumbnailUrl: null, waveformData: null, fileHandle: null }
const state = () => store().getFullProject()
const track = (id) => state().timeline.tracks.find(track => track.id === id)
const clips = () => state().timeline.tracks.flatMap(track => track.clips)
const clip = (id) => clips().find(clip => clip.id === id)
const undoLabel = () => store().actionHistory.peekUndo()?.description
const undoCount = () => store().actionHistory.getUndoStackSize()
const clipOn = (trackId, clipId, startSec = 0, durationSec = 4) => ({ type: 'add_clip', trackId, clipId, mediaId: 'source', startSec, durationSec })

beforeEach(() => {
  store().createNewProject('Native test', { width: 320, height: 180, frameRate: 30 })
  const project = store().project
  useProjectStore.setState({ project: { ...project, mediaLibrary: { ingestPreset: 'proxy', items: [media] } } })
  timeline().stop()
  timeline().seekTo(0)
  useUIStore.getState().clearSelection()
})

test('mixed native edit publishes one change and shares Undo/Redo with a manual edit', async () => {
  const stateBefore = store().project
  const operations = [
    { type: 'add_track', trackType: 'video', trackId: 'picture', name: '开场画面' },
    { type: 'add_track', trackType: 'video', trackId: 'alternate' },
    { type: 'add_track', trackType: 'audio', trackId: 'sound' },
    { type: 'add_track', trackType: 'graphics', trackId: 'graphics' },
    { type: 'add_track', trackType: 'text', trackId: 'titles' },
    clipOn('picture', 'opening'), clipOn('picture', 'next', 6, 3),
    { type: 'trim_clip', clipId: 'opening', sourceInMs: 1000, sourceOutSec: 3 },
    { type: 'split_clip', clipId: 'opening', atMs: 1000 },
    { type: 'move_clip', clipId: 'next', trackId: 'alternate', startTimeMs: 5000 },
    { type: 'set_volume', clipId: 'opening', volume: 1.5, muted: true },
    { type: 'set_speed', clipId: 'opening', speed: 2 },
    { type: 'add_text', trackId: 'titles', clipId: 'caption', content: '第一帧字幕', startSec: 0.1, durationSec: 2 },
    { type: 'set_subtitle_style', clipId: 'caption', textStyle: { fontSize: 44, strokeWidth: 3, strokeColor: 'black', presetId: 'modern' } },
    { type: 'add_text', trackId: 'graphics', clipId: 'title', kind: 'title', text: '花字', startSec: 2, endSec: 3 },
    { type: 'add_transition', clipId: 'opening', transitionId: 'fade', transition: 'fadeblack', durationMs: 200 },
    { type: 'set_clip_effect', clipId: 'opening', transform: { opacity: 0.9, scale: 1.1 }, filter: { id: 'vintage-70s', intensity: 50 } },
  ]
  const dry = await edit(operations, { validateOnly: true })
  assert.equal(dry.results.length, operations.length)
  assert.equal(store().project, stateBefore)
  assert.equal(undoCount(), 0)
  const changes = []
  const unsub = useProjectStore.subscribe((next, prior) => { if (next.project !== prior.project) changes.push(next.project) })
  try {
    const result = await edit(operations)
    assert.equal(result.undoStep, true)
    assert.equal(changes.length, 1)
    assert.equal(undoLabel(), '剪成产品开场')
    assert.equal(undoCount(), 1)
    assert.equal(clip('opening').inPoint, 1)
    assert.equal(clip('opening').outPoint, 2)
    assert.equal(clip('opening').duration, 0.5)
    assert.equal(clip('opening').volume, 1.5)
    assert.equal(clip('opening').audioEffects[0].params.value, 0)
    assert.equal(clip('opening').transform.opacity, 0.9)
    assert.ok(clip('opening').effects.length)
    assert.equal(clip(result.results[8].rightClipId).inPoint, 2)
    assert.equal(clip('next').trackId, 'alternate')
    assert.equal(clip('next').startTime, 5)
    assert.equal(track('picture').transitions[0].type, 'dipToBlack')
    assert.equal(state().textClips.find(item => item.id === 'caption').style.fontSize, 44)
    assert.equal(state().textClips.length, 2)

    assert.equal((await store().renameTrack('picture', '手工改名')).success, true)
    assert.equal(undoCount(), 2)
    assert.equal((await store().undo()).success, true)
    assert.equal(track('picture').name, '开场画面')
    assert.equal((await store().undo()).success, true)
    assert.equal(track('picture'), undefined)
    assert.deepEqual(state().textClips, [])
    assert.equal(state().mediaLibrary.ingestPreset, 'proxy')
    assert.equal((await store().redo()).success, true)
    assert.equal(readNativeSnapshot().clips.find(item => item.id === 'caption').text, '第一帧字幕')
    assert.equal((await store().redo()).success, true)
    assert.equal(track('picture').name, '手工改名')
  } finally { unsub() }
})

test('invalid second operation and failed preflight preserve existing Undo and Redo', async () => {
  await edit([{ type: 'add_track', trackType: 'video', trackId: 'picture' }, clipOn('picture', 'kept')])
  await edit([{ type: 'add_track', trackType: 'audio', trackId: 'sound' }])
  await store().undo()
  const unchanged = store().project
  for (const opts of [{}, { validateOnly: true }]) {
    await assert.rejects(edit([{ type: 'set_track_state', trackId: 'picture', name: 'changed' }, clipOn('picture', 'collision', 1)], opts), { code: 'clip_overlap', operationIndex: 1 })
    await assert.rejects(edit([{ type: 'add_track', trackType: 'text' }, { type: 'split_clip', clipId: 'kept', atSec: 0.02 }], opts), { code: 'invalid-json', operationIndex: 1 })
    assert.equal(store().project, unchanged)
    assert.equal(undoCount(), 1)
    assert.equal(store().canRedo(), true)
  }
  assert.equal((await store().redo()).success, true)
  assert.ok(track('sound'))
})

test('locked tracks, non-empty track deletion and whole timeline clearing are guarded', async () => {
  await edit([{ type: 'add_track', trackType: 'video', trackId: 'picture' }, clipOn('picture', 'kept'),
    { type: 'set_track_state', trackId: 'picture', state: { isLocked: true, isHidden: true } }])
  const before = store().project
  for (const operation of [clipOn('picture', 'new', 6), { type: 'set_volume', clipId: 'kept', volume: 1.3 },
    { type: 'remove_range', fromSec: 0, toSec: 2 }, { type: 'remove_track', trackId: 'picture' }]) {
    await assert.rejects(edit([operation], { confirmDestructive: true }), { code: 'TRACK_LOCKED' })
    assert.equal(store().project, before)
  }
  const unlock = { type: 'set_track_state', trackId: 'picture', locked: false, hidden: false }
  await assert.rejects(edit([unlock, { type: 'remove_track', trackId: 'picture' }]), { code: 'CONFIRMATION_REQUIRED' })
  await assert.rejects(edit([unlock, { type: 'remove_clip', clipId: 'kept' }]), { code: 'CONFIRMATION_REQUIRED' })
  assert.equal(store().project, before)
  await edit([unlock, { type: 'remove_track', trackId: 'picture' }], { confirmDestructive: true })
  await store().undo()
  assert.equal(track('picture').locked, true)
  assert.ok(clip('kept'))
})

test('range extraction, silence threshold and transition removal change the real timeline', async () => {
  await edit([{ type: 'add_track', trackType: 'video', trackId: 'picture' }, clipOn('picture', 'first'), clipOn('picture', 'second', 6),
    { type: 'add_transition', clipId: 'first', transitionId: 'fade', edge: 'in' }])
  await edit([{ type: 'remove_transition', transitionId: 'fade' }, { type: 'remove_range', trackId: 'picture', fromSec: 1, toSec: 2 },
    { type: 'cut_silences', trackId: 'picture', minSilenceMs: 300 }])
  assert.equal(clip('second').startTime, 3)
  assert.equal(clip('first').duration, 1)
  assert.deepEqual(track('picture').transitions, [])
  const result = await edit([{ type: 'cut_silences', trackId: 'picture', silences: [{ fromSec: 3.5, toSec: 4.5 }] }])
  assert.equal(result.durationSec, 6)
  await edit([{ type: 'remove_clip', clipId: 'first', ripple: true }])
  assert.equal(result.durationSec - state().timeline.duration, 1)
})

test('media requires a verified resolver, deduplicates identity+version and rechecks ownership', async (t) => {
  const engine = getMediaEngine()
  t.mock.method(engine, 'initialize', async () => {})
  t.mock.method(engine, 'extractMetadata', async () => ({ ...mediaMetadata, canDecode: true }))
  const source = { id: 'shared-asset', version: 'v1' }
  const operation = { type: 'import_media', path: 'library/source.mp4', mediaId: 'imported', placeOnTimeline: false }
  await assert.rejects(edit([operation]), { code: 'path-denied' })
  await assert.rejects(edit([operation], {}, { resolveMedia: () => ({ file: mediaFile, source: {} }) }), { code: 'path-denied' })
  const resolveMedia = () => ({ file: mediaFile, source })
  await assert.rejects(edit([operation, { type: 'split_clip', clipId: 'missing', atSec: 1 }], {}, { resolveMedia }), { code: 'not-found' })
  assert.equal(state().mediaLibrary.items.length, 1)
  const success = await edit([operation, { ...operation, mediaId: undefined }], {}, { resolveMedia })
  assert.equal(success.results[1].reused, true)
  assert.equal(success.results[1].mediaId, 'imported')
  assert.equal(state().mediaLibrary.items.length, 2)
  await store().undo()
  assert.equal(state().mediaLibrary.items.length, 1)
  await store().redo()
  assert.equal(state().mediaLibrary.items[1].blob, mediaFile)
  assert.deepEqual(state().mediaLibrary.items[1].omnimuxSource, source)

  let changed = false
  await assert.rejects(edit([{ ...operation, mediaId: 'different' }], {}, {
    resolveMedia: async () => { changed = true; return { file: mediaFile, source: { ...source, version: 'v2' } } },
    assertCurrent: () => { if (changed) throw Object.assign(new Error('revision changed'), { code: 'REVISION_CONFLICT', details: { currentRevision: 4 } }) },
  }), { code: 'REVISION_CONFLICT', details: { currentRevision: 4, operationIndex: 0 } })
  assert.equal(state().mediaLibrary.items.length, 2)
  assert.equal(undoCount(), 1)

  const path = '/workspace/locked-source.mp4'
  const legacyResolve = () => ({ file: mediaFile, source: { id: path, version: 'v1' } })
  const legacy = await edit([{ ...operation, mediaId: 'legacy-media', path }, { ...operation, mediaId: undefined, path }], {}, { resolveMedia: legacyResolve })
  assert.equal(legacy.results[1].mediaId, 'legacy-media')
  assert.match(state().mediaLibrary.items[2].omnimuxSource.id, /^source:[a-f0-9]{64}$/)
  assert.doesNotMatch(JSON.stringify(readNativeSnapshot()), /locked-source\.mp4/)
})

test('saved native subtitle cues and the auto-created captions track stay editable', async () => {
  await store().executeAction({ type: 'subtitle/add', id: 'original-cue', timestamp: Date.now(), params: { text: 'Original', startTime: 0, endTime: 1 } })
  const [cue] = state().timeline.subtitles
  await edit([
    { type: 'set_text', clipId: cue.id, content: 'Revised', durationSec: 1.5 },
    { type: 'set_subtitle_style', clipId: cue.id, fontSize: 32, position: 'top' },
    { type: 'add_text', clipId: 'new-caption', content: 'Caption', startSec: 2, durationSec: 1 },
  ])
  const [after] = state().timeline.subtitles
  assert.equal(after.id, cue.id)
  assert.equal(after.text, 'Revised')
  assert.equal(after.endTime, 1.5)
  assert.equal(after.style.fontSize, 32)
  assert.equal(after.cueSettings.line, 15)
  assert.equal(track(state().textClips[0].trackId).role, 'captions')
  await store().undo()
  assert.deepEqual(state().timeline.subtitles, [cue])
  assert.deepEqual(state().textClips, [])
})

test('playback, selection, capture and snapshots read native state and leave history alone', async () => {
  await edit([{ type: 'add_track', trackType: 'video', trackId: 'picture' }, clipOn('picture', 'first'),
    { type: 'add_text', clipId: 'caption', content: 'Caption', durationSec: 3 }])
  await executeNativeView({ action: 'seek', toSec: 1.5 })
  assert.equal(timeline().playheadPosition, 1.5)
  await executeNativeView({ action: 'select_clips', clipIds: ['caption', 'first'] })
  assert.equal(useUIStore.getState().selectedItems[0].type, 'text-clip')
  assert.deepEqual(new Set(readNativeSnapshot().selectedClips.map(clip => clip.id)), new Set(['caption', 'first']))
  assert.equal((await executeNativeView({ action: 'play' })).isPlaying, true)
  assert.equal((await executeNativeView({ action: 'pause' })).isPlaying, false)
  await assert.rejects(executeNativeView({ action: 'select_clips', clipIds: ['missing'] }), { code: 'not-found' })
  assert.equal(useUIStore.getState().selectedItems.length, 2)
  const frames = []
  let closed = 0
  const expression = { id: 'unapproved', type: 'expression', enabled: true, code: 'value + 1' }
  const motionCompositions = [{ id: 'saved-motion', layers: [{ expressions: [expression] }] }]
  useProjectStore.setState({ project: { ...store().project, motionCompositions } })
  const oldEngine = useEngineStore.getState()
  useEngineStore.setState({ initialized: true, videoEngine: { async renderFrame(project, time, width, height, options) {
    options.assertCurrent()
    frames.push(time)
    assert.equal(project.textClips[0].text, 'Caption')
    assert.equal(project.motionCompositions[0].layers[0].expressions[0].enabled, false)
    assert.equal(options.overlaysFromProject, true)
    return { width, height, timestamp: time, image: { close() { closed++ } } }
  } } })
  try {
    const result = await captureNativeFrames({ times: [1.5, 2.5] }, { assertCurrent })
    assert.deepEqual(frames, [1.5, 2.5])
    assert.equal(closed, 2)
    assert.equal(result.frames[0].png.type, 'image/png')
    assert.equal(result.frames[0].width, 320)
    assert.equal(result.frames[0].height, 180)
    await assert.rejects(captureNativeFrames({ times: Array(7).fill(1) }, { assertCurrent }), { code: 'invalid-json' })
  } finally { useEngineStore.setState(oldEngine) }
  assert.equal(timeline().playheadPosition, 1.5)
  assert.equal(undoCount(), 1)
  assert.equal(state().motionCompositions[0].layers[0].expressions[0].enabled, true)
  assert.doesNotMatch(JSON.stringify(readNativeSnapshot()), /sourceFile|fileHandle|waveformData|blob|value \+ 1/)
})

test('Motion approval, custom code and raw file paths cannot enter edits', async () => {
  const original = store().project
  for (const validateOnly of [true, false]) {
    await assert.rejects(edit([{ type: 'add_text', content: 'caption', textStyle: { trusted: true } }], { validateOnly }),
      { code: 'motion-expression-denied', details: { operationIndex: 0 } })
    await assert.rejects(edit([{ type: 'set_clip_effect', clipId: 'source', filter: { code: 'value + 1' } }], { validateOnly }),
      { code: 'motion-expression-denied' })
    await assert.rejects(edit([{ type: 'add_clip', mediaId: 'source', sourceUrl: '/arbitrary/video.mp4' }], { validateOnly }),
      { code: 'path-denied' })
  }
  assert.equal(store().project, original)
  assert.equal(undoCount(), 0)
})

test('relink_media updates handle atomically with undo/redo, guards version drift, and clamps shortened clip trims', async (t) => {
  const engine = getMediaEngine()
  t.mock.method(engine, 'initialize', async () => {})
  let nextDuration = 6
  t.mock.method(engine, 'extractMetadata', async () => ({ ...mediaMetadata, duration: nextDuration, canDecode: true }))

  const originalDigest = '1'.repeat(64)
  const driftedDigest = '2'.repeat(64)
  const libraryHandle = {
    v: 1,
    scope: 'library-file',
    libraryAssetId: 'ast_lib_1',
    fileId: 'file_1',
    sha256: originalDigest,
  }
  const canvasHandle = {
    v: 1,
    scope: 'project-asset',
    workspaceId: 'ws_demo',
    assetId: 'ast_proj_1',
    rel: 'artifacts/new_v2.mp4',
    sha256: driftedDigest,
  }

  // Place a 6s clip referencing media 'source', then simulate offline placeholder state with originalDigest
  await edit([{ type: 'add_track', trackType: 'video', trackId: 'v1' }, clipOn('v1', 'c1', 0, 6)])
  useProjectStore.setState({
    project: {
      ...store().project,
      mediaLibrary: {
        items: store().project.mediaLibrary.items.map(item => item.id === 'source'
          ? { ...item, blob: null, isPlaceholder: true, missing: true, omnimuxSource: { id: 'legacy-1', version: `sha256:${originalDigest}`, digest: originalDigest } }
          : item),
      },
    },
  })

  // 1) Relink with drifted digest WITHOUT allowVersionUpdate -> rejected with media-version-mismatch
  const driftedFile = new File([new Uint8Array(64).fill(9)], 'new_v2.mp4', { type: 'video/mp4' })
  await assert.rejects(
    edit([{ type: 'relink_media', mediaId: 'source', resolvedMedia: { transferUrl: '/omnimux-clip/api/media-transfer/tok' } }], {}, {
      resolveMedia: () => ({ file: driftedFile, source: { id: 'project:ws_demo:ast_proj_1', version: `sha256:${driftedDigest}`, digest: driftedDigest, handle: canvasHandle } }),
    }),
    { code: 'media-version-mismatch' },
  )
  assert.equal(state().mediaLibrary.items[0].isPlaceholder, true)

  // 2) Relink with matching digest succeeds with allowVersionUpdate=false and attaches library-file handle
  const exactRes = await edit([{ type: 'relink_media', mediaId: 'source', resolvedMedia: { transferUrl: '/omnimux-clip/api/media-transfer/tok' } }], {}, {
    resolveMedia: () => ({ file: mediaFile, source: { id: 'library:ast_lib_1:file_1', version: `sha256:${originalDigest}`, digest: originalDigest, handle: libraryHandle } }),
  })
  assert.equal(exactRes.results[0].relinked, true)
  assert.equal(exactRes.results[0].versionUpdated, false)
  assert.equal(exactRes.results[0].scope, 'library-file')
  assert.deepEqual(exactRes.results[0].omnimuxSource, { id: 'library:ast_lib_1:file_1', version: `sha256:${originalDigest}`, scope: 'library-file' })
  assert.equal(state().mediaLibrary.items[0].isPlaceholder, false)
  assert.deepEqual(state().mediaLibrary.items[0].omnimuxSource.handle, libraryHandle)

  // Undo rolls back relink completely
  await store().undo()
  assert.equal(state().mediaLibrary.items[0].isPlaceholder, true)
  await store().redo()
  assert.equal(state().mediaLibrary.items[0].isPlaceholder, false)

  // 3) Relink with shorter drifted video + allowVersionUpdate=true clamps clip outPoint/duration and reports adjustedClips
  nextDuration = 3.5
  const updatedRes = await edit([{ type: 'relink_media', mediaId: 'source', allowVersionUpdate: true, resolvedMedia: { transferUrl: '/omnimux-clip/api/media-transfer/tok2' } }], {}, {
    resolveMedia: () => ({ file: driftedFile, source: { id: 'project:ws_demo:ast_proj_1', version: `sha256:${driftedDigest}`, digest: driftedDigest, handle: canvasHandle } }),
  })
  assert.equal(updatedRes.results[0].relinked, true)
  assert.equal(updatedRes.results[0].versionUpdated, true)
  assert.equal(updatedRes.results[0].clampedClipCount, 1)
  assert.equal(updatedRes.results[0].adjustedClips[0].clipId, 'c1')
  assert.equal(updatedRes.results[0].adjustedClips[0].outSec, 3.5)
  assert.equal(updatedRes.results[0].adjustedClips[0].durationSec, 3.5)
  assert.equal(track('v1').clips[0].outPoint, 3.5)
  assert.equal(track('v1').clips[0].duration, 3.5)
  assert.deepEqual(state().mediaLibrary.items[0].omnimuxSource.handle, canvasHandle)

  // Undo restores previous 6s trim and library handle atomically
  await store().undo()
  assert.equal(track('v1').clips[0].outPoint, 6)
  assert.equal(track('v1').clips[0].duration, 6)
  assert.deepEqual(state().mediaLibrary.items[0].omnimuxSource.handle, libraryHandle)
})

test('relink_media clears stale handle/url across workspace path & cross-scope relink, and projectAssetUrlFromHandle uses ?rel=', async (t) => {
  const engine = getMediaEngine()
  t.mock.method(engine, 'initialize', async () => {})
  let nextDuration = 4
  t.mock.method(engine, 'extractMetadata', async () => ({ ...mediaMetadata, duration: nextDuration, canDecode: true }))

  const digestV1 = 'a'.repeat(64)
  const digestV2 = 'b'.repeat(64)
  const digestV3 = 'c'.repeat(64)
  const projectHandle = {
    v: 1,
    scope: 'project-asset',
    workspaceId: 'ws_demo',
    assetId: 'ast_1',
    rel: 'assets/imported/clip.mp4',
    sha256: digestV1,
  }
  const builtUrl = projectAssetUrlFromHandle(projectHandle)
  assert.equal(
    builtUrl,
    `/omnimux-workflow/api/workspaces/ws_demo/file?rel=assets%2Fimported%2Fclip.mp4&rev=sha256%3A${digestV1}`,
  )
  assert.equal(new URL(builtUrl, 'http://localhost').searchParams.get('path'), null)

  // Seed a project-asset item with handle + url and a clip with outPoint = 4
  await edit([{ type: 'add_track', trackType: 'video', trackId: 'v1' }, clipOn('v1', 'c1', 0, 4)])
  useProjectStore.setState({
    project: {
      ...store().project,
      mediaLibrary: {
        items: store().project.mediaLibrary.items.map(item => item.id === 'source'
          ? {
              ...item,
              omnimuxSource: {
                id: 'project:ws_demo:ast_1',
                version: `sha256:${digestV1}`,
                digest: digestV1,
                handle: projectHandle,
                url: builtUrl,
              },
            }
          : item),
      },
    },
  })

  // 1) Relink to library-file (cross-scope) must NOT leak old project-asset url
  const libHandle = { v: 1, scope: 'library-file', libraryAssetId: 'ast_lib', fileId: 'f_lib', sha256: digestV2 }
  const v2File = new File([new Uint8Array(32).fill(2)], 'lib.mp4', { type: 'video/mp4' })
  await edit([{ type: 'relink_media', mediaId: 'source', allowVersionUpdate: true, resolvedMedia: { transferUrl: '/omnimux-clip/api/media-transfer/t1' } }], {}, {
    resolveMedia: () => ({ file: v2File, source: { id: 'library:ast_lib:f_lib', version: `sha256:${digestV2}`, digest: digestV2, handle: libHandle } }),
  })
  assert.deepEqual(state().mediaLibrary.items[0].omnimuxSource.handle, libHandle)
  assert.equal(state().mediaLibrary.items[0].omnimuxSource.url, undefined)

  // 2) Relink to workspace path (no handle/url) must NOT leak stale library-file handle
  const v3File = new File([new Uint8Array(48).fill(3)], 'local.mp4', { type: 'video/mp4' })
  await edit([{ type: 'relink_media', mediaId: 'source', allowVersionUpdate: true, sourceUrl: '/omnimux-clip/api/host-media?path=local.mp4&rev=v3' }], {}, {
    resolveMedia: () => ({ file: v3File, source: { id: 'workspace-path-hash', version: 'workspace-rev-hash' } }),
  })
  assert.equal(state().mediaLibrary.items[0].omnimuxSource.handle, undefined)
  assert.equal(state().mediaLibrary.items[0].omnimuxSource.url, undefined)
  assert.equal(state().mediaLibrary.items[0].omnimuxSource.id, 'workspace-path-hash')

  // 3) replaceMediaAsset clamps clips cleanly when replacement duration is shorter by 0.005s or < 0.05s
  const mediaBridge = getMediaBridge()
  t.mock.method(mediaBridge, 'isInitialized', () => true)
  t.mock.method(mediaBridge, 'importFile', async () => ({
    success: true,
    media: { metadata: { ...mediaMetadata, duration: nextDuration, canDecode: true }, thumbnails: [] },
  }))
  const ultraShortFile = new File([new Uint8Array(16).fill(4)], 'tiny.mp4', { type: 'video/mp4' })
  nextDuration = 3.995
  const r1 = await store().replaceMediaAsset('source', ultraShortFile)
  assert.equal(r1.success, true)
  assert.equal(track('v1').clips[0].outPoint, 3.995)

  nextDuration = 0.03
  const r2 = await store().replaceMediaAsset('source', ultraShortFile)
  assert.equal(r2.success, true)
  assert.equal(track('v1').clips[0].outPoint, 0.03)
  assert.ok(track('v1').clips[0].inPoint <= 0.03)
})

test('shouldProbeAudioStreamsWithFfmpeg avoids cold CDN wasm download when mediabunny already read audioTrackCount', () => {
  assert.equal(shouldProbeAudioStreamsWithFfmpeg(1, 1024 * 1024, { hasFastProbe: false }), false)
  assert.equal(shouldProbeAudioStreamsWithFfmpeg(1, 1024 * 1024, { hasFastProbe: true }), true)
  assert.equal(shouldProbeAudioStreamsWithFfmpeg(2, 1024 * 1024, { hasFastProbe: true }), false)
  assert.equal(shouldProbeAudioStreamsWithFfmpeg(undefined, 1024 * 1024, { hasFastProbe: false }), true)
  assert.equal(shouldProbeAudioStreamsWithFfmpeg(1, 100 * 1024 * 1024, { hasFastProbe: true }), false)
})

test('Phase 1 graphic templates: add, full projection, hot param update, protected duration, member guard, and ungroup (#phase1)', async () => {
  // AC-M1-02 & AC-M1-03
  const added = await edit([
    {
      type: 'add_graphic_instance',
      templateId: 'builtin-lt-classic-bar',
      instanceId: 'lt-main',
      startSec: 1.0,
      durationSec: 4.0,
      params: [
        { id: 'name', value: 'OmniMux Host' },
        { id: 'accent', value: '#22c55e' },
      ],
    },
  ])
  const info = added.results[0]
  assert.equal(info.instanceId, 'lt-main')
  assert.equal(info.templateId, 'builtin-lt-classic-bar')
  assert.ok(info.memberClipIds.length > 0)

  const snapFull = readNativeSnapshot({ view: 'full', revision: 2 })
  assert.equal(snapFull.graphicInstanceCount, 1)
  assert.equal(snapFull.graphicInstances.length, 1)
  assert.equal(snapFull.graphicInstances[0].id, 'lt-main')
  assert.equal(snapFull.graphicInstances[0].values.name, 'OmniMux Host')
  assert.ok(snapFull.clips.some((row) => row.graphicInstanceId === 'lt-main'))

  // Update parameters and stretch duration to 8s preserving intro/outro protected durations and instanceId
  const updated = await edit([
    {
      type: 'update_graphic_params',
      instanceId: 'lt-main',
      durationSec: 8.0,
      params: [{ id: 'name', value: 'Updated Title' }],
    },
  ])
  assert.equal(updated.results[0].instanceId, 'lt-main')
  assert.equal(updated.results[0].durationSec, 8.0)
  const snapUpdated = readNativeSnapshot({ view: 'full', revision: 3 })
  assert.equal(snapUpdated.graphicInstances[0].values.name, 'Updated Title')

  // Direct edit or text animation on member clip must throw graphic-member-readonly
  const memberTextClip = snapUpdated.clips.find((c) => c.graphicInstanceId === 'lt-main' && c.kind === 'text')
  assert.ok(memberTextClip, 'expected expanded text member clip')
  await assert.rejects(
    edit([{ type: 'set_text', clipId: memberTextClip.id, content: 'Hack' }]),
    (error) => error.code === 'graphic-member-readonly',
  )
  await assert.rejects(
    edit([{ type: 'set_text_animation', clipId: memberTextClip.id, preset: 'typewriter' }]),
    (error) => error.code === 'graphic-member-readonly',
  )
  await assert.rejects(
    edit([{ type: 'set_keyframes', clipId: memberTextClip.id, keyframes: [{ property: 'opacity', timeSec: 0, value: 0.5 }] }]),
    (error) => error.code === 'graphic-member-readonly',
  )

  // Ungroup releases member clips so set_text & set_text_animation succeed afterwards
  const ungrouped = await edit([{ type: 'remove_graphic_instance', instanceId: 'lt-main', ungroup: true }])
  assert.equal(ungrouped.results[0].ungrouped, true)
  assert.equal(readNativeSnapshot({ view: 'summary', revision: 4 }).graphicInstanceCount, 0)
  await edit([
    { type: 'set_text', clipId: memberTextClip.id, content: 'Now Editable' },
    { type: 'set_text_animation', clipId: memberTextClip.id, preset: 'typewriter', inDurationSec: 0.6, outDurationSec: 0.3 },
  ])
  const afterUngroup = readNativeSnapshot({ view: 'full', revision: 5 })
  const editedText = afterUngroup.clips.find((c) => c.id === memberTextClip.id)
  assert.equal(editedText.text, 'Now Editable')
  assert.equal(editedText.textAnimationPreset, 'typewriter')
})

test('Phase 1 editing template validateOnly isolation and single-step undo (#phase1)', async () => {
  // AC-M1-04
  await edit([{ type: 'add_track', trackType: 'video', trackId: 'v-main' }, clipOn('v-main', 'c-main', 0, 5)])
  const projectBefore = store().project
  const textBefore = useEngineStore.getState().getTitleEngine()?.getAllTextClips()?.length ?? 0
  const graphicsBefore = useEngineStore.getState().getGraphicsEngine()?.getAllShapeClips()?.length ?? 0

  const dry = await edit([
    {
      type: 'apply_editing_template',
      clipId: 'c-main',
      templateId: 'overlay-progress-bar',
      controls: [{ id: 'barColor', value: '#ff5500' }],
    },
  ], { validateOnly: true })
  assert.equal(dry.persisted, false)
  assert.equal(dry.undoStep, false)
  assert.ok(dry.results[0].addedOverlayClipIds.length > 0)
  assert.equal(store().project, projectBefore)
  assert.equal(useEngineStore.getState().getTitleEngine()?.getAllTextClips()?.length ?? 0, textBefore)
  assert.equal(useEngineStore.getState().getGraphicsEngine()?.getAllShapeClips()?.length ?? 0, graphicsBefore)

  const undoBefore = undoCount()
  const applied = await edit([
    {
      type: 'apply_editing_template',
      clipId: 'c-main',
      templateId: 'overlay-progress-bar',
      controls: [{ id: 'barColor', value: '#ff5500' }],
    },
  ])
  assert.equal(applied.undoStep, true)
  assert.equal(undoCount(), undoBefore + 1)
  assert.ok((state().shapeClips?.length ?? 0) > 0)

  await store().undo()
  assert.equal(state().shapeClips?.length ?? 0, 0)
})

test('Phase 1 set_keyframes, set_text_animation, batch ripple sync, and custom unsafe SVG rejection (#phase1)', async () => {
  // AC-M1-05, AC-M1-06, AC-M1-07
  await edit([
    { type: 'add_track', trackType: 'video', trackId: 'v1' },
    clipOn('v1', 'main-vid', 0, 6),
    { type: 'add_track', trackType: 'text', trackId: 't1' },
    { type: 'add_text', trackId: 't1', clipId: 'title-1', kind: 'title', content: 'Kinetic', startSec: 1, durationSec: 3 },
  ])

  const kfRes = await edit([
    {
      type: 'set_keyframes',
      clipId: 'main-vid',
      mode: 'replace',
      keyframes: [
        { property: 'scale.x', timeSec: 0, value: 1.0, easing: 'easeInOutCubic' },
        { property: 'scale.x', timeSec: 4, value: 1.2, easing: 'easeOutCubic' },
      ],
    },
    {
      type: 'set_keyframes',
      clipId: 'title-1',
      mode: 'merge',
      keyframes: [
        { property: 'opacity', timeSec: 0, value: 0, easing: 'linear' },
        { property: 'opacity', timeSec: 0.5, value: 1, easing: 'easeOutQuad' },
      ],
    },
    {
      type: 'set_text_animation',
      clipId: 'title-1',
      preset: 'pop',
      inDurationSec: 0.4,
      outDurationSec: 0.3,
      unit: 'character',
      staggerSec: 0.04,
      outPreset: 'fade',
    },
  ])
  assert.equal(kfRes.results[0].keyframeCount, 2)
  assert.equal(kfRes.results[1].keyframeCount, 2)
  assert.equal(kfRes.results[2].preset, 'pop')
  assert.equal(clip('main-vid').keyframes.length, 2)

  // Keyframe bounds error
  await assert.rejects(
    edit([{ type: 'set_keyframes', clipId: 'main-vid', keyframes: [{ property: 'opacity', timeSec: 99, value: 1 }] }]),
    (error) => error.code === 'keyframe-out-of-range',
  )
  await assert.rejects(
    edit([{ type: 'set_keyframes', clipId: 'main-vid', keyframes: [{ property: 'opacity', timeSec: 1, value: 2.5 }] }]),
    (error) => error.code === 'keyframe-out-of-range',
  )

  // Batch sync (add_graphic_instance + remove_range ripple) succeeds and keeps members synchronized
  await edit([
    { type: 'add_graphic_instance', templateId: 'builtin-callout-info', instanceId: 'g-batch-ok', startSec: 2, durationSec: 2 },
    { type: 'remove_range', trackId: 'v1', fromSec: 0, toSec: 1, ripple: true },
  ])
  const afterBatch = readNativeSnapshot({ view: 'full', revision: 6 })
  const batchInst = afterBatch.graphicInstances.find((inst) => inst.id === 'g-batch-ok')
  assert.ok(batchInst)
  const batchMembers = afterBatch.clips.filter((c) => c.graphicInstanceId === 'g-batch-ok')
  assert.ok(batchMembers.length > 0)
  assert.ok(batchMembers.every((c) => c.startSec === batchInst.startSec && c.durationSec === batchInst.durationSec))

  // Batch rollback atomicity + unsafe SVG defense-in-depth
  const survivingVideoClip = afterBatch.clips.find((c) => c.trackId === 'v1')
  assert.ok(survivingVideoClip)
  const snapBeforeInvalid = store().project
  await assert.rejects(
    edit([
      { type: 'add_graphic_instance', templateId: 'builtin-callout-info', instanceId: 'g-batch', startSec: 1.5, durationSec: 2 },
      { type: 'remove_range', trackId: 'v1', fromSec: 4, toSec: 5, ripple: true },
      { type: 'set_keyframes', clipId: survivingVideoClip.id, keyframes: [{ property: 'scale.x', timeSec: 1, value: -1 }] },
    ]),
    (error) => error.code === 'keyframe-out-of-range',
  )
  assert.equal(store().project, snapBeforeInvalid)

  await assert.rejects(
    edit([{
      type: 'add_graphic_instance',
      startSec: 0,
      resolvedTemplate: {
        schemaVersion: 1,
        id: 'unsafe-svg',
        name: 'Unsafe',
        category: 'custom',
        description: '',
        tags: [],
        duration: 2,
        layers: [{ id: 's', name: 'S', kind: 'svg', visible: true, x: 100, y: 100, width: 50, height: 50, rotation: 0, opacity: 1, svg: { svgContent: '<svg><foreignObject/></svg>', viewBoxWidth: 10, viewBoxHeight: 10 } }],
        parameters: [],
      },
    }]),
    (error) => error.code === 'template-invalid',
  )
})

function createSyntheticBeatAudioBuffer({ durationSec = 10, sampleRate = 44100, bpm = 120, peakStartSec = 5, peakEndSec = 10 } = {}) {
  const intervalSec = 60 / bpm
  const totalSamples = Math.floor(durationSec * sampleRate)
  const channelData = Float32Array.from({ length: totalSamples }, (_, sampleIndex) => {
    const t = sampleIndex / sampleRate
    const baseHum = 0.004 * Math.sin(2 * Math.PI * 60 * t)
    if (t < intervalSec) return baseHum
    const nearestBeat = Math.floor((t - intervalSec) / intervalSec + 1e-9) * intervalSec + intervalSec
    const dt = t - nearestBeat
    if (dt < 0 || dt >= 0.055 || nearestBeat > durationSec - 0.1) return baseHum
    const inPeak = t >= peakStartSec && t <= peakEndSec
    const amp = inPeak ? 0.95 : 0.25
    return baseHum + amp * Math.exp(-dt * 50) * Math.sin(2 * Math.PI * 160 * dt)
  })
  return {
    sampleRate,
    length: totalSamples,
    numberOfChannels: 1,
    duration: durationSec,
    getChannelData: (channel) => {
      if (channel !== 0) throw new RangeError('Mono synthetic test AudioBuffer only has channel 0')
      return channelData
    },
    copyFromChannel: (dest, channel, startInChannel = 0) => {
      if (channel !== 0) throw new RangeError('Mono synthetic test AudioBuffer only has channel 0')
      dest.set(channelData.subarray(startInChannel, startInChannel + dest.length))
    },
    copyToChannel: () => {},
  }
}

test('Phase 2 subtitles: SRT, Whisper verbose_json, cues with timeOffsetSec, set_caption_style preserving words, and subtitle-invalid (#phase2)', async () => {
  // AC-M2-04
  const srtImport = await edit([
    {
      type: 'import_subtitles',
      srt: '1\n00:00:00,000 --> 00:00:01,500\nWelcome everyone\n\n2\n00:00:02,000 --> 00:00:03,500\nLet us begin',
      animationStyle: 'word-highlight',
      highlightColor: '#facc15',
      position: 'bottom',
    },
  ])
  assert.equal(srtImport.results[0].count, 2)
  assert.equal(srtImport.results[0].subtitleCount, 2)

  const snapAfterSrt = readNativeSnapshot({ view: 'full', revision: 2 })
  assert.equal(snapAfterSrt.subtitleCount, 2)
  assert.equal(snapAfterSrt.subtitles.at(0).animationStyle, 'word-highlight')
  assert.equal(snapAfterSrt.subtitles.at(0).style.highlightColor, '#facc15')

  const whisperPayload = JSON.stringify({
    language: 'en',
    segments: [{ id: 0, start: 0.0, end: 2.0, text: 'Hello bright world' }],
    words: [
      { word: 'Hello', start: 0.1, end: 0.5 },
      { word: 'bright', start: 0.6, end: 1.1 },
      { word: 'world', start: 1.2, end: 1.9 },
    ],
  })
  const replaced = await edit([
    {
      type: 'import_subtitles',
      mode: 'replace',
      transcriptJson: whisperPayload,
      animationStyle: 'bounce',
    },
  ])
  assert.equal(replaced.results[0].subtitleCount, 1)

  const appended = await edit([
    {
      type: 'import_subtitles',
      mode: 'append',
      timeOffsetSec: 2.5,
      cues: [
        {
          id: 'cue-shifted',
          text: 'Ship faster',
          startSec: 0.0,
          endSec: 1.4,
          speaker: 'Host',
          words: [
            { text: 'Ship', startSec: 0.0, endSec: 0.6 },
            { text: 'faster', startSec: 0.7, endSec: 1.4 },
          ],
        },
      ],
    },
  ])
  assert.equal(appended.results[0].subtitleCount, 2)

  const styled = await edit([
    {
      type: 'set_caption_style',
      animationStyle: 'karaoke',
      highlightColor: '#22c55e',
      strokeColor: '#111827',
      strokeWidth: 4,
      boxRadius: 10,
      safeMargin: 0.1,
    },
  ])
  assert.equal(styled.results[0].count, 2)
  assert.equal(styled.results[0].animationStyle, 'karaoke')

  const snapStyled = readNativeSnapshot({ view: 'full', revision: 4 })
  assert.equal(snapStyled.subtitles.at(0).animationStyle, 'karaoke')
  assert.equal(snapStyled.subtitles.at(0).wordCount, 3)
  assert.equal(snapStyled.subtitles.at(0).words.at(1).text, 'bright')
  assert.equal(snapStyled.subtitles.at(0).style.highlightColor, '#22c55e')
  assert.equal(snapStyled.subtitles.at(0).style.boxRadius, 10)
  assert.equal(snapStyled.subtitles.at(1).startSec, 2.5)
  assert.equal(snapStyled.subtitles.at(1).words.at(0).startSec, 2.5)

  // Validation errors produce subtitle-invalid
  await assert.rejects(
    edit([{ type: 'import_subtitles', srt: 'not valid srt' }]),
    (error) => error.code === 'subtitle-invalid',
  )
  await assert.rejects(
    edit([{ type: 'import_subtitles', timeOffsetSec: -1, cues: [{ text: 'Bad', startSec: 0.2, endSec: 1.0 }] }]),
    (error) => error.code === 'subtitle-invalid',
  )

  await store().undo()
  const afterUndo = readNativeSnapshot({ view: 'full', revision: 3 })
  assert.equal(afterUndo.subtitles.at(0).animationStyle, 'bounce')
})

test('Phase 2 transcript analysis and pause/filler/range cuts with validateOnly, single undo, and TRACK_LOCKED (#phase2)', async () => {
  // AC-M2-02, AC-M2-05
  await edit([
    { type: 'add_track', trackType: 'video', trackId: 'v-talk' },
    { type: 'add_clip', trackId: 'v-talk', clipId: 'c-talk', mediaId: 'source', startSec: 0, durationSec: 6 },
    {
      type: 'import_subtitles',
      cues: [
        {
          text: 'Um hello world',
          startSec: 0.2,
          endSec: 1.2,
          words: [
            { text: 'Um', startSec: 0.2, endSec: 0.45 },
            { text: 'hello', startSec: 0.5, endSec: 0.85 },
            { text: 'world', startSec: 0.85, endSec: 1.2 },
          ],
        },
        {
          text: 'Actually great launch',
          startSec: 2.4,
          endSec: 4.5,
          words: [
            { text: 'Actually', startSec: 2.4, endSec: 3.1 },
            { text: 'great', startSec: 3.2, endSec: 3.8 },
            { text: 'launch', startSec: 3.8, endSec: 4.5 },
          ],
        },
      ],
    },
  ])

  const analyzed = await executeNativeAnalyze(
    { mode: 'transcript', minPauseSec: 0.6, keepPauseSec: 0.2, query: 'launch' },
    { assertCurrent },
  )
  assert.equal(analyzed.mode, 'transcript')
  assert.equal(analyzed.subtitleCount, 2)
  assert.equal(analyzed.pauses.length, 1)
  assert.equal(analyzed.fillers.length, 1)
  assert.equal(analyzed.matches.length, 1)

  const beforeDry = store().project
  const dryCut = await edit(
    [{ type: 'cut_transcript_ranges', mode: 'pauses', minPauseSec: 0.6, keepPauseSec: 0.2 }],
    { validateOnly: true },
  )
  assert.equal(dryCut.persisted, false)
  assert.equal(dryCut.undoStep, false)
  assert.equal(dryCut.results[0].count, 1)
  assert.equal(store().project, beforeDry)

  const undoBefore = undoCount()
  const fillerCut = await edit([
    { type: 'cut_transcript_ranges', mode: 'fillers', fillerPhrases: ['um'] },
  ])
  assert.equal(fillerCut.undoStep, true)
  assert.equal(undoCount(), undoBefore + 1)
  assert.ok(fillerCut.results[0].cutDurationSec > 0.2)
  assert.ok(readNativeSnapshot({ view: 'full', revision: 4 }).durationSec < 5.8)

  await store().undo()
  const restored = readNativeSnapshot({ view: 'full', revision: 3 })
  assert.equal(restored.durationSec, 6)
  assert.equal(restored.subtitles.at(0).startSec, 0.2)

  // Explicit ranges & TRACK_LOCKED guard
  await edit([{ type: 'cut_transcript_ranges', mode: 'ranges', ranges: [{ fromSec: 1.4, toSec: 2.2 }] }])
  assert.equal(Number(readNativeSnapshot({ view: 'summary', revision: 4 }).durationSec.toFixed(2)), 5.2)

  await edit([{ type: 'set_track_state', trackId: 'v-talk', locked: true }])
  await assert.rejects(
    edit([{ type: 'cut_transcript_ranges', mode: 'ranges', ranges: [{ fromSec: 0.2, toSec: 0.6 }] }]),
    (error) => error.code === 'TRACK_LOCKED',
  )
})

test('Phase 2 set_marker, remove_marker, and set_audio_ducking full projection and undo/redo (#phase2)', async () => {
  // AC-M2-06
  const audioItem = {
    id: 'bgm-source',
    name: 'BGM Audio',
    blob: new File(['bgm audio'], 'bgm.wav', { type: 'audio/wav' }),
    type: 'audio',
    metadata: { duration: 10, fileSize: 100, codec: 'pcm', sampleRate: 44100, channels: 2, hasVideo: false, hasAudio: true },
    thumbnailUrl: null,
    waveformData: null,
    fileHandle: null,
  }
  const baseProject = store().project
  useProjectStore.setState({
    project: { ...baseProject, mediaLibrary: { ...baseProject.mediaLibrary, items: [...baseProject.mediaLibrary.items, audioItem] } },
  })
  await edit([
    { type: 'add_track', trackType: 'video', trackId: 'v1' },
    { type: 'add_clip', trackId: 'v1', clipId: 'voice-clip', mediaId: 'source', startSec: 0, durationSec: 5 },
    { type: 'add_track', trackType: 'audio', trackId: 'a1' },
    { type: 'add_clip', trackId: 'a1', clipId: 'music-clip', mediaId: 'bgm-source', startSec: 0, durationSec: 5 },
  ])

  const undoBefore = undoCount()
  const markerAndDuck = await edit([
    { type: 'set_marker', timeSec: 1.0, durationSec: 0.5, label: 'Drop 1', color: '#ef4444', kind: 'chapter', comment: 'First beat' },
    { type: 'set_marker', timeSec: 3.0, label: 'Temp Marker', color: '#3b82f6' },
    { type: 'set_audio_ducking', clipId: 'voice-clip', audioType: 'dialogue' },
    { type: 'set_audio_ducking', clipId: 'music-clip', audioType: 'music', enabled: true, amountDb: 15, attackMs: 220, releaseMs: 320, holdMs: 180 },
  ])
  assert.equal(undoCount(), undoBefore + 1)
  const firstMarkerId = markerAndDuck.results[0].markerId
  const secondMarkerId = markerAndDuck.results[1].markerId

  await edit([
    { type: 'set_marker', markerId: firstMarkerId, label: 'Drop 1 Final', timeSec: 1.25 },
    { type: 'remove_marker', markerId: secondMarkerId },
  ])

  const snap = readNativeSnapshot({ view: 'full', revision: 3 })
  assert.equal(snap.markerCount, 1)
  assert.equal(snap.markers.length, 1)
  assert.equal(snap.markers[0].id, firstMarkerId)
  assert.equal(snap.markers[0].label, 'Drop 1 Final')
  assert.equal(snap.markers[0].timeSec, 1.25)

  const voiceSnap = snap.clips.find((row) => row.id === 'voice-clip')
  const musicSnap = snap.clips.find((row) => row.id === 'music-clip')
  assert.equal(voiceSnap.audioType, 'dialogue')
  assert.equal(musicSnap.audioType, 'music')
  assert.deepEqual(musicSnap.liveDucking, { enabled: true, amountDb: 15, attackMs: 220, releaseMs: 320, holdMs: 180 })

  await store().undo()
  const afterUndo = readNativeSnapshot({ view: 'full', revision: 2 })
  assert.equal(afterUndo.markerCount, 2)

  await store().redo()
  const afterRedo = readNativeSnapshot({ view: 'full', revision: 3 })
  assert.equal(afterRedo.markerCount, 1)
  assert.equal(afterRedo.markers[0].label, 'Drop 1 Final')
})

test('Phase 2 real BeatDetectionEngine, extractHighlights, and sync_clips_to_beats on synthetic 120 BPM PCM (#phase2)', async () => {
  // AC-M2-03, AC-M2-07
  // Missing audio fails closed with audio-analysis-failed
  await assert.rejects(
    executeNativeAnalyze({ mode: 'beats' }, { assertCurrent }),
    (error) => error.code === 'audio-analysis-failed',
  )

  const bgmFile = new File(['pcm synth'], 'bgm-120bpm.wav', { type: 'audio/wav' })
  const bgmItem = {
    id: 'bgm-media',
    name: 'BGM 120',
    blob: bgmFile,
    type: 'audio',
    metadata: { duration: 10, fileSize: 100, codec: 'pcm', sampleRate: 44100, channels: 1, hasVideo: false, hasAudio: true },
    thumbnailUrl: null,
    waveformData: null,
    fileHandle: null,
  }
  const currentProject = store().project
  useProjectStore.setState({
    project: { ...currentProject, mediaLibrary: { ...currentProject.mediaLibrary, items: [...currentProject.mediaLibrary.items, bgmItem] } },
  })

  await edit([
    { type: 'add_track', trackType: 'audio', trackId: 'a-bgm' },
    { type: 'add_clip', trackId: 'a-bgm', clipId: 'bgm-clip', mediaId: 'bgm-media', startSec: 0, durationSec: 10 },
    { type: 'add_track', trackType: 'video', trackId: 'v-broll' },
    { type: 'add_clip', trackId: 'v-broll', clipId: 'broll-1', mediaId: 'source', startSec: 0, durationSec: 4 },
    { type: 'add_clip', trackId: 'v-broll', clipId: 'broll-2', mediaId: 'source', startSec: 4, durationSec: 4 },
  ])

  const syntheticAudio = createSyntheticBeatAudioBuffer({ durationSec: 10, sampleRate: 44100, bpm: 120, peakStartSec: 5, peakEndSec: 10 })
  const decodeAudioBuffer = async () => syntheticAudio

  const beatRes = await executeNativeAnalyze(
    { mode: 'beats', clipId: 'bgm-clip', minBpm: 90, maxBpm: 150, sensitivity: 0.5 },
    { assertCurrent, decodeAudioBuffer },
  )
  assert.equal(beatRes.mode, 'beats')
  assert.equal(beatRes.clipId, 'bgm-clip')
  assert.ok(beatRes.bpm >= 110 && beatRes.bpm <= 130, `expected BPM near 120, got ${beatRes.bpm}`)
  assert.ok(beatRes.beatCount >= 10, `expected >= 10 real detected beats, got ${beatRes.beatCount}`)

  const highlightRes = await executeNativeAnalyze(
    { mode: 'highlights', clipId: 'bgm-clip', targetClipCount: 2, minClipDurationSec: 2, maxClipDurationSec: 4 },
    { assertCurrent, decodeAudioBuffer },
  )
  assert.equal(highlightRes.mode, 'highlights')
  assert.ok(highlightRes.highlightCount >= 1)
  assert.ok(highlightRes.highlights.some((seg) => seg.endSec > 5 && seg.score > 1))

  // Cut-to-beats using real detected beat timestamps + single-step undo
  const beatTimes = beatRes.beats.map((row) => row.timeSec)
  const syncCut = await edit([
    { type: 'sync_clips_to_beats', clipIds: ['broll-1', 'broll-2'], beats: beatTimes, syncMode: 'cut-to-beats', beatsPerClip: 2 },
  ])
  assert.equal(syncCut.results[0].count, 2)
  assert.equal(syncCut.results[0].syncMode, 'cut-to-beats')
  const synced1 = clip('broll-1')
  const synced2 = clip('broll-2')
  assert.ok(Math.abs(synced1.startTime - beatTimes.at(0)) < 1e-4)
  assert.ok(Math.abs(synced2.startTime - beatTimes.at(2)) < 1e-4)
  assert.ok(synced1.startTime + synced1.duration <= synced2.startTime + 1e-5)

  await store().undo()
  assert.equal(clip('broll-1').startTime, 0)
  assert.equal(clip('broll-1').duration, 4)
  assert.equal(clip('broll-2').startTime, 4)

  // Preserve-duration driven directly by audioClipId + decodeAudioBuffer (short clips fit inside 0.5s beat spacing)
  await edit([
    { type: 'add_track', trackType: 'video', trackId: 'v-snap' },
    { type: 'add_clip', trackId: 'v-snap', clipId: 'snap-1', mediaId: 'source', startSec: 0, durationSec: 0.35 },
    { type: 'add_clip', trackId: 'v-snap', clipId: 'snap-2', mediaId: 'source', startSec: 2, durationSec: 0.35 },
  ])
  const syncPreserve = await edit(
    [{ type: 'sync_clips_to_beats', clipIds: ['snap-1', 'snap-2'], audioClipId: 'bgm-clip', syncMode: 'preserve-duration', beatsPerClip: 1 }],
    {},
    { decodeAudioBuffer },
  )
  assert.equal(syncPreserve.results[0].syncMode, 'preserve-duration')
  assert.equal(clip('snap-1').duration, 0.35)
  assert.ok(clip('snap-1').startTime + clip('snap-1').duration <= clip('snap-2').startTime)
  await store().undo()

  // Overlap and source-bound guards on sync_clips_to_beats
  await assert.rejects(
    edit([{ type: 'sync_clips_to_beats', clipIds: ['broll-1', 'broll-2'], beats: [0.5, 1.0, 1.5, 2.0], syncMode: 'preserve-duration' }]),
    (error) => error.code === 'clip_overlap',
  )
  await assert.rejects(
    edit([{ type: 'sync_clips_to_beats', clipIds: ['broll-1'], beats: [0, 7, 14], syncMode: 'cut-to-beats', beatsPerClip: 1 }]),
    (error) => error.code === 'invalid-json',
  )
})
