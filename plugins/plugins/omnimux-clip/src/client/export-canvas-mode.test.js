import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStageStore, getActiveClipSession } from './stage-store.js'
import {
  createSilentCanvasWritable,
  isCanvasClipExportSession,
} from './export-canvas-mode.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const RUNNER_TS = join(HERE, 'openreel/web/services/export-runner.ts')
const MOTION_TS = join(HERE, 'openreel/web/motion/export-motion-frame.ts')
const TOOLBAR_TSX = join(HERE, 'openreel/web/components/editor/Toolbar.tsx')

function mockGetStage() {
  return {
    claim() {},
    release() {},
    readBox() { return { top: 0, left: 0, width: 800, height: 600 } },
    PRODUCT_STAGE_EVENT: 'dsh-product-stage',
  }
}

test('isCanvasClipExportSession: true only while canvas session is active', () => {
  const store = createStageStore(mockGetStage)
  assert.equal(getActiveClipSession(), null)
  assert.equal(isCanvasClipExportSession(), false)

  store.openFromCanvas({ nodeId: 'n1', projectId: 'p1' })
  assert.equal(isCanvasClipExportSession(), true)

  store.set(false)
  assert.equal(isCanvasClipExportSession(), false)
  store.dispose()
})

test('createSilentCanvasWritable: captures encoded chunks without download or picker', async () => {
  const writable = createSilentCanvasWritable('video/mp4')
  await writable.write(new Uint8Array([1, 2, 3]))
  await writable.write(new Uint8Array([4, 5]))
  await writable.close()
  const blob = writable.getCapturedBlob()
  assert.ok(blob)
  assert.equal(blob.type, 'video/mp4')
  assert.equal(blob.size, 5)
})

test('canvas export sources skip showSaveDialog / showSaveFilePicker before picker calls', () => {
  const runner = readFileSync(RUNNER_TS, 'utf8')
  const motion = readFileSync(MOTION_TS, 'utf8')
  const toolbar = readFileSync(TOOLBAR_TSX, 'utf8')

  assert.ok(runner.includes('isCanvasClipExportSession'), 'export-runner must gate canvas mode')
  const dialogIdx = runner.indexOf('showSaveDialog')
  const canvasGuardIdx = runner.indexOf('isCanvasClipExportSession()')
  assert.ok(canvasGuardIdx > -1 && canvasGuardIdx < dialogIdx, 'canvas guard must precede showSaveDialog')

  const pickerIdx = runner.indexOf('showSaveFilePicker')
  assert.ok(canvasGuardIdx < pickerIdx, 'canvas guard must precede showSaveFilePicker')

  assert.ok(motion.includes('isCanvasClipExportSession'), 'motion export must gate canvas mode')
  const motionDialogIdx = motion.indexOf('showSaveDialog')
  const motionGuardIdx = motion.indexOf('isCanvasClipExportSession()')
  assert.ok(motionGuardIdx > -1 && motionGuardIdx < motionDialogIdx, 'motion canvas guard must precede showSaveDialog')

  assert.ok(toolbar.includes('showSavePicker'), 'Toolbar still uses showSavePicker (gated inside runner)')
})
