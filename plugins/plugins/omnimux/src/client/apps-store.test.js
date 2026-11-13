import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createAppsStore } from './apps-store.js'

/**
 * The store claims the product stage on open, so the test needs a minimal
 * DOM surface. Same global-stubbing style as apps-stage-box.test.js.
 * @returns {() => void} restore
 */
function installDom() {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    CustomEvent: globalThis.CustomEvent,
    HTMLStyleElement: globalThis.HTMLStyleElement,
  }
  globalThis.CustomEvent = class CustomEvent {
    /**
     * @param {string} type
     * @param {{ detail?: unknown }} [init]
     */
    constructor(type, init = {}) {
      this.type = type
      this.detail = init.detail
    }
  }
  globalThis.HTMLStyleElement = class HTMLStyleElement {}
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true },
  }
  globalThis.document = {
    documentElement: { dataset: {} },
    getElementById() { return null },
    createElement() { return {} },
    head: { append() {} },
    addEventListener() {},
    removeEventListener() {},
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  }
}

describe('apps store', () => {
  it('toggles, claims the stage, and notifies subscribers', () => {
    const restore = installDom()
    try {
      const store = createAppsStore()
      let ticks = 0
      const stop = store.subscribe(() => { ticks += 1 })
      assert.equal(store.getSnapshot(), false)
      store.toggle()
      assert.equal(store.getSnapshot(), true)
      assert.equal(globalThis.document.documentElement.dataset.dshProductStage, 'omnimux-apps')
      store.set(true)
      assert.equal(ticks, 1)
      store.set(false)
      assert.equal(store.getSnapshot(), false)
      assert.equal(globalThis.document.documentElement.dataset.dshProductStage, undefined)
      assert.equal(ticks, 2)
      stop()
      store.toggle()
      assert.equal(ticks, 2)
    } finally {
      restore()
    }
  })
})
