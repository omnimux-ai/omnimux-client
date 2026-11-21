import test from 'node:test'
import assert from 'node:assert/strict'
import { createStageStore, getActiveClipSession } from './stage-store.js'
import {
  createAndMountCanvasBridge,
  notifyCanvasSave,
  notifyCanvasProgress,
  notifyCanvasClose,
} from './CanvasBridge.js'
import {
  OMNIMUX_CLIP_OPEN,
  OMNIMUX_CLIP_SAVE,
  OMNIMUX_CLIP_CLOSE,
  OMNIMUX_CLIP_PROGRESS,
  isOpenClipEditorPayload,
  isSaveClipEditorPayload,
  isCloseClipEditorPayload,
  isProgressClipEditorPayload,
} from './clip-events.js'

test('stage-store: openFromCanvas does not claim stage, set(false) does not release stage', () => {
  let claimed = null
  let released = null
  const mockGetStage = () => ({
    claim: (id) => { claimed = id },
    release: (id) => { released = id },
    readBox: () => ({ top: 0, left: 0, width: 800, height: 600 }),
    PRODUCT_STAGE_EVENT: 'dsh-product-stage',
  })

  const store = createStageStore(mockGetStage)
  assert.equal(store.getSnapshot(), false)
  assert.equal(store.getSessionSnapshot(), null)

  // 1. openFromCanvas 仅将 open 设为 true 并保留 session，不调用 mockStage.claim
  store.openFromCanvas({
    workspaceId: 'ws_first',
    nodeId: 'node_123',
    nodeTitle: '测试视频合成',
    projectId: 'proj_456',
    upstreamInputs: {
      videos: [{ path: '/tmp/video.mp4', name: 'shot1.mp4' }],
    },
  })

  assert.equal(store.getSnapshot(), true)
  assert.equal(claimed, null, 'openFromCanvas must NOT claim product stage')
  const session = store.getSessionSnapshot()
  assert.equal(session.source, 'canvas')
  assert.equal(session.workspaceId, 'ws_first')
  assert.equal(session.nodeId, 'node_123')
  assert.equal(session.nodeTitle, '测试视频合成')
  assert.equal(session.projectId, 'proj_456')
  assert.equal(session.upstreamInputs.videos.length, 1)

  // 2. stage.set(false) 在画布模式下关闭浮层，清理 session，且不调用 mockStage.release
  store.set(false)
  assert.equal(store.getSnapshot(), false)
  assert.equal(store.getSessionSnapshot(), null)
  assert.equal(released, null, 'set(false) in canvas mode must NOT release product stage')

  store.dispose()
})

test('stage-store: set(true) still claims overlay (canvas portal / leftover only; sidebar must not call this)', () => {
  let claimed = null
  let released = null
  const mockGetStage = () => ({
    claim: (id) => { claimed = id },
    release: (id) => { released = id },
    readBox: () => ({ top: 0, left: 0, width: 800, height: 600 }),
    PRODUCT_STAGE_EVENT: 'dsh-product-stage',
  })

  const store = createStageStore(mockGetStage)

  // 3. 独立模式下 stage.set(true) 正常调用 mockStage.claim
  store.set(true)
  assert.equal(store.getSnapshot(), true)
  assert.equal(claimed, 'omnimux-clip')
  assert.equal(store.getSessionSnapshot(), null)

  // 独立模式下 stage.set(false) 正常调用 mockStage.release
  store.set(false)
  assert.equal(store.getSnapshot(), false)
  assert.equal(released, 'omnimux-clip')
  assert.equal(store.getSessionSnapshot(), null)

  store.dispose()
})

test('stage-store: external switch to another stage exits canvas mode', () => {
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = new EventTarget()
  }

  const mockGetStage = () => ({
    claim: () => {},
    release: () => {},
    readBox: () => ({ top: 0, left: 0, width: 800, height: 600 }),
    PRODUCT_STAGE_EVENT: 'dsh-product-stage',
  })

  const store = createStageStore(mockGetStage)
  store.openFromCanvas({
    workspaceId: 'ws_first',
    nodeId: 'node_canvas_1',
    projectId: 'clip_node_first',
    nodeTitle: 'Canvas Video',
  })
  assert.equal(store.getSnapshot(), true)
  assert.equal(store.getSessionSnapshot()?.source, 'canvas')

  // 4. 外部派发切换到其他 stageId
  globalThis.window.dispatchEvent(new CustomEvent('dsh-product-stage', {
    detail: { id: 'omnimux-assets' },
  }))

  assert.equal(store.getSnapshot(), false, 'Canvas mode must close on external stage switch')
  assert.equal(store.getSessionSnapshot(), null, 'Session must be cleared on external stage switch')

  store.dispose()
})

test('stage-store: external switch to omnimux-clip activates standalone mode', () => {
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = new EventTarget()
  }

  const mockGetStage = () => ({
    claim: () => {},
    release: () => {},
    readBox: () => ({ top: 0, left: 0, width: 800, height: 600 }),
    PRODUCT_STAGE_EVENT: 'dsh-product-stage',
  })

  const store = createStageStore(mockGetStage)
  assert.equal(store.getSnapshot(), false)

  globalThis.window.dispatchEvent(new CustomEvent('dsh-product-stage', {
    detail: { id: 'omnimux-clip' },
  }))

  assert.equal(store.getSnapshot(), true, 'Must activate when id matches STAGE_ID')
  assert.equal(store.getSessionSnapshot(), null, 'Standalone mode has no session')

  store.dispose()
})

const binding = { workspaceId: 'ws_first', nodeId: 'node_first', projectId: 'clip_node_first' }
const badBindings = [
  { ...binding, workspaceId: undefined }, { ...binding, nodeId: undefined }, { ...binding, projectId: undefined },
  { ...binding, workspaceId: '../other' }, { ...binding, nodeId: ' ' }, { ...binding, projectId: 'x/y' },
]

test('CanvasBridge opens only fully identified sessions and closes only the matching session', () => {
  const target = new EventTarget()
  const stage = createStageStore(() => null)
  const host = {
    getAttribute(name) {
      if (name === 'data-visible') return 'true'
      if (name === 'data-canvas-workspace-id') return binding.workspaceId
      return null
    },
  }
  const root = { querySelectorAll: () => [host] }
  const cleanup = createAndMountCanvasBridge({ stage, target, root })
  const fire = (type, detail) => target.dispatchEvent(new CustomEvent(type, { detail }))
  try {
    for (const invalid of badBindings) fire(OMNIMUX_CLIP_OPEN, { ...invalid, source: 'canvas' })
    assert.equal(stage.getSnapshot(), false)
    fire(OMNIMUX_CLIP_OPEN, { ...binding, source: 'canvas', nodeTitle: 'Canvas Composition' })
    assert.equal(stage.getSessionSnapshot().workspaceId, binding.workspaceId)
    assert.equal(stage.getSessionSnapshot().projectId, binding.projectId)
    fire(OMNIMUX_CLIP_OPEN, { ...binding, source: 'canvas', workspaceId: 'ws_other', projectId: 'clip_node_other' })
    assert.equal(stage.getSessionSnapshot().workspaceId, binding.workspaceId)
    assert.equal(stage.getSessionSnapshot().projectId, binding.projectId)
    for (const wrong of [...badBindings, { ...binding, workspaceId: 'ws_other' },
      { ...binding, nodeId: 'node_other' }, { ...binding, projectId: 'clip_node_other' }]) {
      fire(OMNIMUX_CLIP_CLOSE, wrong)
      assert.equal(stage.getSnapshot(), true)
    }
    notifyCanvasClose({ nodeId: binding.nodeId }, target)
    assert.equal(stage.getSnapshot(), false)
  } finally {
    cleanup()
    stage.dispose()
  }
})

test('canvas event guards require valid ids on all canvas events', () => {
  const accepts = [
    (detail) => isOpenClipEditorPayload({ ...detail, source: 'canvas' }),
    (detail) => isSaveClipEditorPayload({ ...detail, output: { videoPath: '/tmp/a.mp4' } }),
    isCloseClipEditorPayload,
    (detail) => isProgressClipEditorPayload({ ...detail, renderProgress: 50 }),
  ]
  for (const accept of accepts) {
    assert.equal(accept(binding), true)
    for (const invalid of badBindings) assert.equal(accept(invalid), false)
  }
  assert.equal(isOpenClipEditorPayload({ source: 'invalid' }), false)
  assert.equal(isOpenClipEditorPayload({ source: 'sidebar' }), true)
  assert.equal(isOpenClipEditorPayload('non-object'), false)
  assert.equal(isSaveClipEditorPayload('non-object'), false)
  assert.equal(isSaveClipEditorPayload({ ...binding, output: { videoPath: 123 } }), false)
  assert.equal(isCloseClipEditorPayload('non-object'), false)
  assert.equal(isProgressClipEditorPayload({ ...binding, renderProgress: 'not-number' }), false)
  assert.equal(isProgressClipEditorPayload({ ...binding, renderProgress: NaN }), false)
})

test('getActiveClipSession: tracks canvas session and clears on dispose', () => {
  const mockGetStage = () => ({
    claim: () => {},
    release: () => {},
    readBox: () => ({ top: 0, left: 0, width: 800, height: 600 }),
    PRODUCT_STAGE_EVENT: 'dsh-product-stage',
  })

  const store = createStageStore(mockGetStage)
  assert.equal(getActiveClipSession(), null)

  store.openFromCanvas({
    workspaceId: 'ws_first',
    nodeId: 'node_test_export',
    projectId: 'proj_export_1',
    nodeTitle: 'Export Composition',
  })

  const active = getActiveClipSession()
  assert.ok(active)
  assert.equal(active.source, 'canvas')
  assert.equal(active.nodeId, 'node_test_export')
  assert.equal(active.projectId, 'proj_export_1')

  store.dispose()
  assert.equal(getActiveClipSession(), null)
})

test('legacy manual export callbacks are scoped and ambiguous callbacks are dropped', () => {
  const target = new EventTarget()
  const stage = createStageStore(() => null)
  const seen = []
  for (const type of [OMNIMUX_CLIP_PROGRESS, OMNIMUX_CLIP_SAVE]) {
    target.addEventListener(type, (event) => seen.push(event.detail))
  }
  const progress = { nodeId: binding.nodeId, status: 'rendering', renderProgress: 75 }
  const output = {
    videoPath: '/exports/test.mp4', thumbnailPath: 'data:image/jpeg;base64,thumb', durationMs: 1000,
    width: 1920, height: 1080, revision: '12:42',
  }
  const save = { nodeId: binding.nodeId, projectId: binding.projectId, createDownstreamNode: true, output }
  try {
    assert.equal(notifyCanvasProgress(progress, target), false)
    stage.openFromCanvas(binding)
    assert.equal(notifyCanvasProgress(progress, target), true)
    assert.equal(notifyCanvasSave(save, target), true)
    assert.deepEqual(seen, [{ ...binding, ...progress }, { ...binding, ...save }])
    assert.equal(notifyCanvasSave({ ...save, projectId: 'clip_node_wrong' }, target), false)
    stage.openFromCanvas({ ...binding, workspaceId: 'ws_other' })
    assert.equal(notifyCanvasProgress(progress, target), false)
    assert.equal(notifyCanvasSave(save, target), false)
    assert.equal(notifyCanvasSave({ ...binding, ...save }, target), false)
    assert.equal(notifyCanvasSave({ ...save, workspaceId: 'ws_other' }, target), true)
    stage.set(false)
    assert.equal(notifyCanvasSave({ ...save, workspaceId: 'ws_other' }, target), false)
    assert.equal(seen.length, 3)
  } finally {
    stage.dispose()
  }
})

test('a started manual export delivers its saved output to the original node after exit', () => {
  const target = new EventTarget()
  const stage = createStageStore(() => null)
  const saved = []
  target.addEventListener(OMNIMUX_CLIP_SAVE, (event) => saved.push(event.detail))
  const start = { nodeId: binding.nodeId, status: 'rendering', renderProgress: 0 }
  const output = { videoPath: '/exports/first.mp4', revision: '12:42' }
  const save = { nodeId: binding.nodeId, projectId: binding.projectId, createDownstreamNode: true, output }
  const otherNode = { ...binding, nodeId: 'node_other', projectId: 'clip_node_other' }
  try {
    stage.openFromCanvas(binding)
    assert.equal(notifyCanvasProgress(start, target), true)
    assert.equal(notifyCanvasProgress({ ...start, renderProgress: 100 }, target), true)
    stage.close()
    assert.equal(stage.getSnapshot(), false)
    assert.equal(getActiveClipSession(), null)
    assert.equal(notifyCanvasProgress({ ...start, renderProgress: 50 }, target), false)
    assert.equal(notifyCanvasSave({ ...save, output: { videoPath: '' } }, target), false)
    for (const wrong of [
      { projectId: undefined }, { workspaceId: 'ws_other' }, { workspaceId: '../other' },
      { nodeId: 'node_missing' }, { projectId: 'clip_node_other' },
    ]) {
      assert.equal(notifyCanvasSave({ ...save, ...wrong }, target), false)
    }
    stage.openFromCanvas(otherNode)
    assert.equal(notifyCanvasSave(save, target), true)
    assert.deepEqual(saved, [{ ...save, workspaceId: binding.workspaceId }])
    assert.equal(getActiveClipSession()?.nodeId, otherNode.nodeId)
    assert.equal(notifyCanvasSave(save, target), false)
    assert.equal(saved.length, 1)
  } finally {
    stage.dispose()
  }
})

test('terminal progress after exit requires the pending export binding and settles it', () => {
  const target = new EventTarget()
  const stage = createStageStore(() => null)
  const progress = []
  target.addEventListener(OMNIMUX_CLIP_PROGRESS, (event) => progress.push(event.detail))
  const failure = { ...binding, status: 'error' }
  try {
    stage.openFromCanvas(binding)
    assert.equal(notifyCanvasProgress({ ...binding, status: 'rendering', renderProgress: 0 }, target), true)
    stage.close()
    assert.equal(notifyCanvasProgress({ ...failure, projectId: undefined }, target), false)
    assert.equal(notifyCanvasProgress({ ...failure, workspaceId: 'ws_other' }, target), false)
    assert.equal(notifyCanvasProgress(failure, target), true)
    assert.equal(notifyCanvasProgress(failure, target), false)
    assert.equal(progress.length, 2)
    assert.deepEqual(progress[1], failure)
  } finally {
    stage.dispose()
  }
})

test('a pending export cannot borrow the workspace of a newly opened colliding node', () => {
  const target = new EventTarget()
  const stage = createStageStore(() => null)
  const saved = []
  target.addEventListener(OMNIMUX_CLIP_SAVE, (event) => saved.push(event.detail))
  const otherBinding = { ...binding, workspaceId: 'ws_other' }
  const output = { videoPath: '/exports/first.mp4' }
  try {
    stage.openFromCanvas(binding)
    assert.equal(notifyCanvasProgress({ nodeId: binding.nodeId, status: 'rendering', renderProgress: 0 }, target), true)
    stage.close()
    stage.openFromCanvas(otherBinding)
    assert.equal(notifyCanvasSave({ nodeId: binding.nodeId, projectId: binding.projectId, output }, target), false)
    assert.equal(notifyCanvasSave({ ...otherBinding, output }, target), false)
    assert.equal(notifyCanvasSave({ ...binding, output }, target), true)
    assert.deepEqual(saved, [{ ...binding, output }])
    assert.equal(getActiveClipSession()?.workspaceId, otherBinding.workspaceId)
  } finally {
    stage.dispose()
  }
})
