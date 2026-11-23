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
    contents: `export { executeNativeEdit } from './live/native-edit';
      export { captureNativeFrames, executeNativeView, readNativeSnapshot } from './live/native-view';
      export { useProjectStore } from './openreel/web/stores/project-store';
      export { useTimelineStore } from './openreel/web/stores/timeline-store';
      export { useUIStore } from './openreel/web/stores/ui-store';
      export { useEngineStore } from './openreel/web/stores/engine-store';
      export { getMediaEngine } from './openreel/core/media/mediabunny-engine';
      export { EffectsBridge } from './openreel/web/bridges/effects-bridge';
      export { getMediaBridge } from './openreel/web/bridges/media-bridge';
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
const { executeNativeEdit, captureNativeFrames, executeNativeView, readNativeSnapshot, useProjectStore,
  useTimelineStore, useUIStore, useEngineStore, getMediaEngine, EffectsBridge, getMediaBridge, projectAssetUrlFromHandle } = module.exports
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
