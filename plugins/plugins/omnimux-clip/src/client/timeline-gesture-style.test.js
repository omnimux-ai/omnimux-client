import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { beginTimelineGestureStyle } from './openreel/web/components/editor/timeline/gesture-style.ts'
import { listenTimelineGesture } from './openreel/web/components/editor/timeline/touch-gestures.ts'

function fixture() {
  return new JSDOM(`<body style="cursor: help; user-select: text">
    <section class="openreel-studio-root">
      <div class="editor-shell" style="cursor: crosshair !important"><span></span></div>
    </section>
    <div class="openreel-studio-root" id="other"><span></span></div>
  </body>`).window
}

test('overlapping gestures change only their editor and restore the original priority', () => {
  const window = fixture()
  const { document } = window
  const editor = document.querySelector('.editor-shell')
  const other = document.querySelector('#other')
  const bodyStyle = document.body.getAttribute('style')
  const first = beginTimelineGestureStyle(editor.firstElementChild, { cursor: 'grabbing', userSelect: 'none' })
  const second = beginTimelineGestureStyle(editor.firstElementChild, { cursor: 'ew-resize' })
  const independent = beginTimelineGestureStyle(other.firstElementChild, { cursor: 'move' })
  assert.equal(editor.style.cursor, 'ew-resize')
  assert.equal(editor.style.userSelect, 'none')
  first()
  assert.equal(editor.style.cursor, 'ew-resize')
  assert.equal(editor.style.userSelect, '')
  second()
  second()
  assert.equal(editor.style.cursor, 'crosshair')
  assert.equal(editor.style.getPropertyPriority('cursor'), 'important')
  assert.equal(other.style.cursor, 'move')
  independent()
  assert.equal(other.style.cursor, '')
  assert.equal(document.body.getAttribute('style'), bodyStyle)
  window.close()
})

for (const [event, ending] of [['mouseup', 'end'], ['blur', 'cancel'], ['pointercancel', 'cancel']]) {
  test(`${event} releases editor gesture styles and listeners`, async (t) => {
    const window = fixture()
    const previous = globalThis.window
    globalThis.window = window
    t.after(() => {
      window.close()
      if (previous) globalThis.window = previous
      else delete globalThis.window
    })
    const editor = window.document.querySelector('.editor-shell')
    const bodyStyle = window.document.body.getAttribute('style')
    const release = beginTimelineGestureStyle(editor, { cursor: 'col-resize', userSelect: 'none' })
    const calls = []
    const id = { current: event === 'pointercancel' ? 9 : null }
    const stop = listenTimelineGesture(id, () => calls.push('move'), () => calls.push('end'), () => calls.push('cancel'), release)
    const finish = event === 'pointercancel'
      ? new window.PointerEvent(event, { pointerId: 9 })
      : new window.MouseEvent(event)
    window.dispatchEvent(finish)
    window.dispatchEvent(new window.MouseEvent('mousemove'))
    stop()
    await Promise.resolve()
    assert.deepEqual(calls, [ending])
    assert.equal(id.current, null)
    assert.equal(editor.style.cursor, 'crosshair')
    assert.equal(editor.style.userSelect, '')
    assert.equal(window.document.body.getAttribute('style'), bodyStyle)
  })
}
