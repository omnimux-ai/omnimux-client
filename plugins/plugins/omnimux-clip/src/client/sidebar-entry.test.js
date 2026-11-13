import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { CLIP_SENTINEL_PATH, CLIP_TAB_ID, createClipWorkbenchStore } from './workbench-store.js'

const previousWindow = globalThis.window

afterEach(() => {
  if (previousWindow === undefined) delete globalThis.window
  else globalThis.window = previousWindow
})

test('clip sidebar store forwards to hub createSidebarStore and never claims product stage', async () => {
  let claimed = 0
  const opened = []
  const closed = []
  let activeId = null
  const html = { dataset: {} }
  const factoryStore = {
    getSnapshot() { return activeId === CLIP_TAB_ID },
    subscribe() { return () => {} },
    open() {
      opened.push({ tabId: CLIP_TAB_ID, path: CLIP_SENTINEL_PATH, title: '视频剪辑' })
      activeId = CLIP_TAB_ID
    },
    close() { closed.push(CLIP_TAB_ID) },
    set(next) { if (next) this.open(); else this.close() },
    readBox() { return { top: 0, left: 0, width: 0, height: 0 } },
  }
  globalThis.window = {
    __omnimuxStage: { claim() { claimed += 1 } },
    __omnimuxWorkbench: {
      createSidebarStore(opts) {
        assert.equal(opts.tabId, CLIP_TAB_ID)
        assert.equal(opts.path, CLIP_SENTINEL_PATH)
        assert.equal(typeof opts.title, 'function')
        assert.equal(opts.title(), '视频剪辑')
        return factoryStore
      },
      closeTab(id) { closed.push(id) },
      closePanel() { closed.push('panel') },
    },
    document: { documentElement: html },
  }

  const store = createClipWorkbenchStore((key) => (key === 'tab.title' ? '视频剪辑' : key))
  assert.equal(store.getSnapshot(), false)
  store.open()
  await Promise.resolve()
  assert.equal(claimed, 0)
  assert.equal(html.dataset.dshProductStage, undefined)
  assert.equal(opened.length, 1)
  assert.equal(opened[0].tabId, CLIP_TAB_ID)
  assert.equal(opened[0].path, CLIP_SENTINEL_PATH)
  assert.equal(store.getSnapshot(), true)
  assert.equal(store.readBox().width, 0)
  store.close()
  assert.deepEqual(closed, [CLIP_TAB_ID])
})

test('clip sidebar store is a no-op when workbench factory is missing', () => {
  let claimed = 0
  globalThis.window = {
    __omnimuxStage: { claim() { claimed += 1 } },
  }
  const store = createClipWorkbenchStore(() => '视频剪辑')
  assert.doesNotThrow(() => { store.open() })
  assert.equal(claimed, 0)
  assert.equal(store.getSnapshot(), false)
})
