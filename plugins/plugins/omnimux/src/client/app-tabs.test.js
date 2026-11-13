import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mountAppTabs, placeTabsContainer, safeOpenApp, tabRowModel } from './app-tabs.js'
import { TABS_CHANGED_EVENT } from './open-app-flow.js'

describe('tabRowModel', () => {
  it('maps view rows to render models', () => {
    const rows = tabRowModel({
      schema: 1,
      tabs: [
        { id: 'accounts', title: '账号', pinned: true, lastOpenedAt: '2026-08-20T07:00:00Z' },
        { id: 'other-app', title: '其他', pinned: false, lastOpenedAt: '2026-08-19T07:00:00Z' },
      ],
    })
    assert.deepEqual(rows, [
      { id: 'accounts', title: '账号', pinned: true, lastOpenedAt: '2026-08-20T07:00:00Z' },
      { id: 'other-app', title: '其他', pinned: false, lastOpenedAt: '2026-08-19T07:00:00Z' },
    ])
  })

  it('defaults bad rows and drops rows without an id', () => {
    const rows = tabRowModel({
      tabs: [
        null,
        'not-an-object',
        { pinned: 'yes' },
        { id: 'ghost-app', title: 42, pinned: true },
      ],
    })
    assert.deepEqual(rows, [
      { id: 'ghost-app', title: 'ghost-app', pinned: true, lastOpenedAt: '' },
    ])
  })

  it('treats missing or malformed views as empty', () => {
    assert.deepEqual(tabRowModel(null), [])
    assert.deepEqual(tabRowModel(undefined), [])
    assert.deepEqual(tabRowModel({}), [])
    assert.deepEqual(tabRowModel({ tabs: 'nope' }), [])
    assert.deepEqual(tabRowModel(42), [])
  })
})

describe('TABS_CHANGED_EVENT', () => {
  it('uses the contract literal', () => {
    assert.equal(TABS_CHANGED_EVENT, 'omnimux-app-tabs-changed')
  })
})

describe('placeTabsContainer', () => {
  function fixture(next) {
    const calls = []
    const parent = {
      insertBefore(...args) {
        calls.push(args)
      },
    }
    const container = { marker: 'container' }
    const entry = { parentElement: parent, nextElementSibling: next }
    return { calls, container, entry, parent }
  }

  it('inserts the container right after the apps entry', () => {
    const next = { marker: 'taskboard' }
    const { calls, container, entry } = fixture(next)
    assert.equal(placeTabsContainer(entry, container), true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], container)
    assert.equal(calls[0][1], next)
  })

  it('is a no-op when the container already follows the entry', () => {
    const calls = []
    const parent = { insertBefore(...args) { calls.push(args) } }
    const container = { marker: 'container' }
    const entry = { parentElement: parent, nextElementSibling: container }
    assert.equal(placeTabsContainer(entry, container), true)
    assert.equal(calls.length, 0)
  })

  it('inserts before null when the entry is last', () => {
    const { calls, container, entry } = fixture(null)
    assert.equal(placeTabsContainer(entry, container), true)
    assert.deepEqual(calls, [[container, null]])
  })

  it('refuses entries without a parent', () => {
    const container = { marker: 'container' }
    assert.equal(placeTabsContainer({ parentElement: null, nextElementSibling: null }, container), false)
    assert.equal(placeTabsContainer(null, container), false)
    assert.equal(placeTabsContainer(undefined, container), false)
  })
})

describe('safeOpenApp (Auth Guard)', () => {
  it('gates openApp through window.__omnimuxAuth.ensureLogin when available with kind: explicit', () => {
    let ensuredWith = null
    let openedId = null
    const origWindow = globalThis.window
    globalThis.window = {
      __omnimuxAuth: {
        ensureLogin: (opts) => {
          ensuredWith = opts
          opts.onSuccess?.()
        },
      },
    }

    try {
      safeOpenApp('accounts', '账号管理', (id) => { openedId = id })
      assert.ok(ensuredWith, 'ensureLogin must be called')
      assert.equal(ensuredWith.reason, '账号管理')
      assert.equal(ensuredWith.kind, 'explicit', 'must pass kind: explicit')
      assert.equal(openedId, 'accounts')
    } finally {
      globalThis.window = origWindow
    }
  })

  it('falls back to id when title is empty and passes kind: explicit', () => {
    let ensuredWith = null
    let openedId = null
    const origWindow = globalThis.window
    globalThis.window = {
      __omnimuxAuth: {
        ensureLogin: (opts) => {
          ensuredWith = opts
          opts.onSuccess?.()
        },
      },
    }

    try {
      safeOpenApp('my-app', '', (id) => { openedId = id })
      assert.equal(ensuredWith?.reason, 'my-app')
      assert.equal(ensuredWith?.kind, 'explicit', 'must pass kind: explicit')
      assert.equal(openedId, 'my-app')
    } finally {
      globalThis.window = origWindow
    }
  })

  it('degrades to direct openApp when __omnimuxAuth is absent or not a function', () => {
    let openedId = null
    const origWindow = globalThis.window

    try {
      // 1. window is empty object
      globalThis.window = {}
      safeOpenApp('gallery', '专家馆', (id) => { openedId = id })
      assert.equal(openedId, 'gallery')

      // 2. ensureLogin is not a function
      openedId = null
      globalThis.window = { __omnimuxAuth: {} }
      safeOpenApp('workflow', '工作流', (id) => { openedId = id })
      assert.equal(openedId, 'workflow')
    } finally {
      globalThis.window = origWindow
    }
  })

  it('safely no-ops when id is empty or null', () => {
    let called = false
    safeOpenApp('', '标题', () => { called = true })
    assert.equal(called, false)
    safeOpenApp(null, '标题', () => { called = true })
    assert.equal(called, false)
  })
})
