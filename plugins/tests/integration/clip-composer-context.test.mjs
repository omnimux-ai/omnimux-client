import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createLiveChannel } from '../../plugins/omnimux-clip/src/client/live/live-channel.js'
import { createClipComposer } from '../../plugins/omnimux/src/client/attachments/clipComposer.js'
import { clipContextFromEnvelope, formatCompactContextBlock } from '../../plugins/omnimux/src/workbench/contract.js'

function setup(t, { mode, legacy = false }) {
  const dom = new JSDOM('<main id="main"></main>', { pretendToBeVisual: true })
  const win = dom.window
  const doc = win.document
  const main = doc.getElementById('main')
  let sessionId = 'chat-a'
  const tabId = mode === 'canvas' ? 'omnimux-workflow:canvas' : 'omnimux-clip:studio'
  const binding = mode === 'canvas' ? { workspaceId: 'workspace-a', nodeId: 'node-a', projectId: 'clip-a' } : undefined
  const project = { id: 'clip-a' }
  const editorId = 'editor-a'
  const owner = {
    site: { mode, sessionId, binding, entry: { id: editorId } },
    token: new win.AbortController(), record: { project, revision: 4 }, revisionEpoch: 0,
  }
  const projected = {
    projectId: project.id, title: 'Spring launch', playheadSec: 1.25, durationSec: 7,
    selectedClips: Array.from({ length: 4 }, (_, index) => ({
      id: `clip-${index}`, name: index === 0 ? 'Intro' : 'file:///private/example', trackId: 'video', startSec: index, endSec: index + 1,
    })),
    unlisted: 'file:///private/example',
  }
  const calls = []
  const listeners = new Set()
  let projection
  const workbench = {
    getCurrentSessionId: () => sessionId,
    setConversationCollapsed(value) { calls.push(['collapsed', value]); main.hidden = value },
    setFocus(mode) { calls.push(['focus', mode]) },
    registerContextContributor(id, read) {
      assert.equal(id, tabId)
      projection = read
      return () => { projection = undefined }
    },
    getUiContext() {
      const extra = projection?.()?.view.extra
      return { sessionId, surface: { panelOpen: true, tabId }, view: { extra: { workspaceId: binding?.workspaceId, ...extra } } }
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
  }
  if (!legacy) workbench.ensureConversationVisible = () => { calls.push(['ensure']); main.hidden = false }
  win.__omnimuxWorkbench = workbench
  const bridge = createClipComposer(win, workbench)
  const uninstall = bridge.install()
  let editorReady = true
  const native = {
    isEditorReady: () => editorReady,
    projection: revision => ({ ...projected, revision }),
    subscribeContext: () => () => {},
  }
  const session = { getOwner: () => owner, owns: value => value === owner && !owner.token.signal.aborted }
  const channel = createLiveChannel({ session, storage: {}, native, window: win })
  t.after(() => { channel.dispose(); uninstall(); win.close() })

  let sends = 0
  doc.addEventListener('submit', event => { event.preventDefault(); sends++ })
  function mount(id, { hidden = false, inSeat = true } = {}) {
    const container = doc.createElement('section')
    if (inSeat) container.dataset.composerSeat = ''
    container.hidden = hidden
    container.innerHTML = '<form data-composer-card><span hidden></span><textarea data-composer-input="true"></textarea><button>Send</button></form>'
    main.append(container)
    const card = container.querySelector('form')
    const editor = card.querySelector('textarea')
    editor.getClientRects = () => editor.closest('[hidden]') ? [] : [{}]
    const anchor = card.querySelector('span')
    const unregister = bridge.register(anchor, id)
    return { container, card, editor, anchor, unregister }
  }
  return { doc, main, bridge, owner, projected, workbench, editorId, channel, mount, calls,
    sends: () => sends, setReady: value => { editorReady = value }, uninstall,
    switchSession(next) { sessionId = next; for (const listener of listeners) listener() },
  }
}

for (const [mode, legacy] of [['canvas', false], ['standalone', true]]) {
  test(`${mode} reveals the main Composer and refreshes the projection without editing its draft`, t => {
    const fixture = setup(t, { mode, legacy })
    const { bridge, main, doc, owner, projected, channel, workbench, editorId, mount, calls } = fixture
    const other = mount('chat-b')
    const hidden = mount('chat-a', { hidden: true })
    const embedded = mount('chat-a', { inSeat: false })
    const current = mount('chat-a')
    current.editor.value = '保留多行草稿\nKeep the second line'
    other.editor.value = 'Another chat'
    main.hidden = true
    channel.compose(editorId)
    assert.deepEqual(calls, legacy ? [['collapsed', false], ['focus', 'split']] : [['ensure']])
    assert.equal(main.hidden, false)
    assert.equal(doc.activeElement, current.editor)
    assert.equal(current.card.hasAttribute('data-omnimux-clip-focus'), true)
    assert.equal(hidden.card.hasAttribute('data-omnimux-clip-focus'), false)
    assert.equal(embedded.card.hasAttribute('data-omnimux-clip-focus'), false)
    const first = bridge.getSnapshot()
    assert.equal(first.anchor, current.anchor)
    assert.deepEqual(first.clip, clipContextFromEnvelope(workbench.getUiContext()))
    assert.equal(first.clip.selectedClips.length, 3)
    assert.doesNotMatch(JSON.stringify(first.clip), /file:|unlisted|editorInstanceId/)
    assert.equal(first.clip.revision, 4)
    assert.equal(first.clip.revisionEpoch, 0)
    assert.equal(first.clip.playheadSec, 1.25)
    assert.equal(first.clip.workspaceId, mode === 'canvas' ? 'workspace-a' : undefined)
    assert.equal(first.clip.nodeId, mode === 'canvas' ? 'node-a' : undefined)
    projected.playheadSec = 6.5
    projected.selectedClips = []
    owner.record.revision = 2
    owner.revisionEpoch = 1
    channel.compose(editorId)
    const { anchor, clip } = bridge.getSnapshot()
    assert.equal(anchor, first.anchor)
    assert.deepEqual(clip.selectedClips, [])
    assert.equal(clip.playheadSec, 6.5)
    assert.equal(clip.revision, 2)
    assert.equal(clip.revisionEpoch, 1)
    assert.match(formatCompactContextBlock(workbench.getUiContext()), /revision: 2.*revisionEpoch: 1.*playheadSec: 6\.5/)
    assert.equal(current.editor.value, '保留多行草稿\nKeep the second line')
    assert.equal(other.editor.value, 'Another chat')
    assert.equal(fixture.sends(), 0)

    bridge.dismiss(current.anchor)
    assert.equal(bridge.getSnapshot(), null)
    assert.equal(doc.activeElement, current.editor)
    channel.compose(editorId)
    assert.equal(bridge.getSnapshot().anchor, current.anchor)
    owner.token.abort()
    assert.equal(bridge.getSnapshot(), null)
    assert.equal(current.card.hasAttribute('data-omnimux-clip-focus'), false)
  })
}

test('pending Clip context attaches to a late Composer only in the original session', async t => {
  const fixture = setup(t, { mode: 'canvas' })
  const { bridge, doc, owner, editorId, channel, mount, switchSession } = fixture
  const other = mount('chat-b')
  const hidden = mount('chat-a', { hidden: true })
  hidden.editor.disabled = true
  channel.compose(editorId)
  assert.equal(bridge.getSnapshot(), null)
  hidden.container.hidden = false
  await Promise.resolve()
  assert.equal(bridge.getSnapshot(), null)
  hidden.editor.disabled = false
  await Promise.resolve()
  assert.equal(bridge.getSnapshot().anchor, hidden.anchor)
  assert.equal(doc.activeElement, hidden.editor)

  hidden.unregister()
  channel.compose(editorId)
  switchSession('chat-b')
  const late = mount('chat-a')
  assert.equal(bridge.getSnapshot(), null)
  assert.notEqual(doc.activeElement, other.editor)
  assert.notEqual(doc.activeElement, late.editor)
  assert.equal(owner.token.signal.aborted, false)
})

test('unready, stale, conflicting and disposed seats never attach Clip context', t => {
  const fixture = setup(t, { mode: 'standalone' })
  const { bridge, owner, editorId, channel, workbench, mount, calls, setReady, uninstall } = fixture
  const main = mount('chat-a')
  setReady(false)
  channel.compose(editorId)
  setReady(true)
  owner.conflict = true
  channel.compose(editorId)
  owner.conflict = false
  channel.compose('stale-editor')
  assert.equal(bridge.getSnapshot(), null)
  assert.deepEqual(calls, [])
  const secondMain = mount('chat-a')
  channel.compose(editorId)
  assert.equal(bridge.getSnapshot(), null)
  secondMain.unregister()
  channel.compose(editorId)
  assert.equal(bridge.getSnapshot().anchor, main.anchor)
  uninstall()
  assert.equal(workbench.attachClipContext, undefined)
  assert.equal(bridge.getSnapshot(), null)
  assert.equal(main.card.hasAttribute('data-omnimux-clip-focus'), false)
})
