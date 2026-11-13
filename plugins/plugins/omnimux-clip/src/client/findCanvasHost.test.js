import test from 'node:test'
import assert from 'node:assert/strict'
import { findCanvasHost, isVisibleCanvasHost } from './findCanvasHost.js'

function fakeEl({ visible = true, width = 800, height = 600, tag = 'DIV' } = {}) {
  return {
    tagName: tag,
    getAttribute: (name) => (name === 'data-visible' ? (visible ? 'true' : 'false') : null),
    getBoundingClientRect: () => ({ top: 0, left: 400, width, height }),
  }
}

test('findCanvasHost: returns the first visible canvas tab', () => {
  const hidden = fakeEl({ visible: false })
  const shown = fakeEl({ visible: true, width: 900, height: 700 })
  const root = {
    querySelectorAll: () => [hidden, shown],
  }
  const host = findCanvasHost(root)
  assert.equal(host, shown)
})

test('findCanvasHost: skips tiny or hidden nodes and returns null when none fit', () => {
  const tiny = fakeEl({ width: 10, height: 10 })
  const hidden = fakeEl({ visible: false, width: 800, height: 600 })
  const root = { querySelectorAll: () => [tiny, hidden] }
  assert.equal(findCanvasHost(root), null)
})

test('findCanvasHost: null root is safe', () => {
  assert.equal(findCanvasHost(null), null)
})

test('isVisibleCanvasHost: rejects data-visible=false', () => {
  assert.equal(isVisibleCanvasHost(fakeEl({ visible: false })), false)
})

test('isVisibleCanvasHost: accepts a sizable visible tab', () => {
  assert.equal(isVisibleCanvasHost(fakeEl({ visible: true, width: 640, height: 480 })), true)
})
