import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createStageStore } from './createStageStore.ts'
import {
  createSidebarEntry,
  createWorkbenchSidebarEntry,
  createWorkbenchStageStore,
} from './createSidebarEntry.ts'

const here = dirname(fileURLToPath(import.meta.url))

describe('StageStore state machine', () => {
  it('creates an idempotent store with open/close methods and no toggle', () => {
    let claimed = ''
    let released = ''
    const fakeStage = {
      claim: (id) => { claimed = id },
      release: (id) => { released = id },
      readBox: () => ({ top: 10, left: 20, width: 800, height: 600 }),
    }

    const store = createStageStore('test-stage', () => fakeStage)

    assert.equal(store.getSnapshot(), false)
    assert.equal(typeof store.open, 'function')
    assert.equal(typeof store.close, 'function')
    assert.equal(typeof store.toggle, 'undefined', 'toggle is intentionally absent to prevent toggle bugs')

    let notified = 0
    const unsub = store.subscribe(() => { notified++ })

    // 1st open
    store.open()
    assert.equal(store.getSnapshot(), true)
    assert.equal(claimed, 'test-stage')
    assert.equal(notified, 1)

    // 2nd open (idempotent no-op: does not re-emit or re-claim)
    store.open()
    assert.equal(store.getSnapshot(), true)
    assert.equal(notified, 1, 'idempotent call must not re-notify')

    // close
    store.close()
    assert.equal(store.getSnapshot(), false)
    assert.equal(released, 'test-stage')
    assert.equal(notified, 2)

    // 2nd close (idempotent no-op)
    store.close()
    assert.equal(store.getSnapshot(), false)
    assert.equal(notified, 2)

    unsub()
  })

  it('provides readBox reading from stage host or fallback', () => {
    const fakeStage = {
      readBox: () => ({ top: 12, left: 34, width: 567, height: 890 }),
    }
    const store = createStageStore('test-stage', () => fakeStage)
    assert.deepEqual(store.readBox(), { top: 12, left: 34, width: 567, height: 890 })
  })
})

describe('createSidebarEntry contract', () => {
  it('implements idempotent click and standard 32px contract', () => {
    const src = readFileSync(join(here, 'createSidebarEntry.ts'), 'utf8')
    assert.ok(src.includes('stageStore.open()'), 'sidebar click must call stageStore.open(), not toggle')
    assert.ok(!src.includes('stageStore.toggle'), 'must not have toggle')
    assert.match(src, /height:\s*32px/, 'must follow 32px height baseline')
    assert.ok(src.includes('--dsw-font-s-14'), 'must use dsw font 14px token')
  })

  it('declares access, requireAuth and authReason options in types', () => {
    const src = readFileSync(join(here, 'createSidebarEntry.ts'), 'utf8')
    assert.match(src, /access\?: PluginAccess/)
    assert.match(src, /requireAuth\?: boolean/)
    assert.match(src, /authReason\?: string \| \(\(\) => string\)/)
    assert.match(src, /__omnimuxAuth/)
    assert.match(src, /ensureLogin/)
  })

  it('handles offline access: clicks open stage directly without auth prompt', () => {
    let opened = false
    const fakeStageStore = {
      open: () => { opened = true },
      getSnapshot: () => false,
      subscribe: () => () => {},
    }

    let authCalled = false
    const origWindow = globalThis.window
    const fakeWindow = {
      __omnimuxAuth: {
        ensureLogin: () => { authCalled = true },
      },
      __omnimuxSidebar: {
        register: () => () => {},
      },
    }

    const listeners = {}
    const fakeEntry = {
      setAttribute: () => {},
      removeAttribute: () => {},
      classList: { add: () => {}, remove: () => {} },
      querySelector: () => ({ textContent: '' }),
      addEventListener: (evt, fn) => { listeners[evt] = fn },
      dataset: {},
    }
    const origDoc = globalThis.document
    globalThis.document = {
      createElement: () => fakeEntry,
    }
    globalThis.window = fakeWindow

    try {
      const cleanup = createSidebarEntry({
        id: 'offline-entry',
        rank: 5,
        label: '离线入口',
        access: 'offline',
        iconSvg: '<svg></svg>',
        stageStore: fakeStageStore,
      })

      assert.equal(typeof listeners.click, 'function')
      listeners.click()
      assert.equal(authCalled, false, 'offline access must not invoke ensureLogin on click')
      assert.equal(opened, true, 'offline access opens stageStore directly')

      cleanup()
    } finally {
      globalThis.window = origWindow
      globalThis.document = origDoc
    }
  })

  it('handles cloud access: always visible when unauthenticated and click requires explicit auth', () => {
    let opened = false
    const fakeStageStore = {
      open: () => { opened = true },
      getSnapshot: () => false,
      subscribe: () => () => {},
    }

    let authCalledWith = null

    const origWindow = globalThis.window
    const fakeWindow = {
      __omnimuxAuth: {
        isLoggedIn: () => false,
        ensureLogin: (opts) => {
          authCalledWith = opts
          opts.onSuccess?.()
        },
      },
      __omnimuxSidebar: {
        register: () => () => {},
      },
    }

    const attrs = {}
    const classList = new Set()
    const listeners = {}
    const fakeEntry = {
      setAttribute: (k, v) => { attrs[k] = v },
      removeAttribute: (k) => { delete attrs[k] },
      classList: {
        add: (c) => { classList.add(c) },
        remove: (c) => { classList.delete(c) },
        contains: (c) => classList.has(c),
      },
      querySelector: () => ({ textContent: '' }),
      addEventListener: (evt, fn) => { listeners[evt] = fn },
      dataset: {},
    }
    const origDoc = globalThis.document
    globalThis.document = {
      createElement: () => fakeEntry,
    }
    globalThis.window = fakeWindow

    try {
      // 1. Unauthenticated -> entry is always visible (no data-hidden, no hidden class)
      const cleanup = createSidebarEntry({
        id: 'cloud-analytics-entry',
        rank: 10,
        label: '数据分析',
        access: 'cloud',
        iconSvg: '<svg></svg>',
        stageStore: fakeStageStore,
      })

      assert.equal(attrs['data-hidden'], undefined, 'cloud entry must remain visible when unauthenticated')
      assert.ok(!classList.has('omnimux-sidebar-nav-entry-hidden'), 'must not have hidden class')

      // 2. Click -> ensureLogin is called with kind: 'explicit'
      assert.equal(typeof listeners.click, 'function')
      listeners.click()
      assert.ok(authCalledWith !== null, 'ensureLogin must be called on click')
      assert.equal(authCalledWith.kind, 'explicit', 'ensureLogin must be called with kind: explicit')
      assert.equal(opened, true, 'onSuccess opens stageStore')

      cleanup()
    } finally {
      globalThis.window = origWindow
      globalThis.document = origDoc
    }
  })

  it('does not treat auth-gate phase closed as logged in and cloud entry remains visible', () => {
    const origWindow = globalThis.window
    const origDoc = globalThis.document
    const attrs = {}
    const classList = new Set()
    const fakeEntry = {
      setAttribute: (k, v) => { attrs[k] = v },
      removeAttribute: (k) => { delete attrs[k] },
      classList: {
        add: (c) => { classList.add(c) },
        remove: (c) => { classList.delete(c) },
        contains: (c) => classList.has(c),
      },
      querySelector: () => ({ textContent: '' }),
      addEventListener: () => {},
      dataset: {},
    }
    globalThis.document = { createElement: () => fakeEntry }
    globalThis.window = {
      __omnimuxAuth: {
        getSnapshot: () => ({ phase: 'closed' }),
        peekCache: () => null,
      },
      __omnimuxSidebar: { register: () => () => {} },
    }
    try {
      const cleanup = createSidebarEntry({
        id: 'cloud-closed-phase',
        rank: 10,
        label: '云端入口',
        access: 'cloud',
        iconSvg: '<svg></svg>',
        stageStore: { open() {}, getSnapshot: () => false, subscribe: () => () => {} },
      })
      assert.equal(attrs['data-hidden'], undefined, 'cloud entry is always visible')
      assert.ok(!classList.has('omnimux-sidebar-nav-entry-hidden'))
      cleanup()
    } finally {
      globalThis.window = origWindow
      globalThis.document = origDoc
    }
  })

  it('cancel explicit auth does not open stage', () => {
    let opened = false
    const fakeStageStore = {
      open: () => { opened = true },
      getSnapshot: () => false,
      subscribe: () => () => {},
    }

    let authCalledWith = null

    const origWindow = globalThis.window
    const fakeWindow = {
      __omnimuxAuth: {
        isLoggedIn: () => false,
        ensureLogin: (opts) => {
          authCalledWith = opts
          // Simulating cancel: onSuccess is NOT called
        },
      },
      __omnimuxSidebar: {
        register: () => () => {},
      },
    }

    const listeners = {}
    const fakeEntry = {
      setAttribute: () => {},
      removeAttribute: () => {},
      classList: { add: () => {}, remove: () => {} },
      querySelector: () => ({ textContent: '' }),
      addEventListener: (evt, fn) => { listeners[evt] = fn },
      dataset: {},
    }
    const origDoc = globalThis.document
    globalThis.document = {
      createElement: () => fakeEntry,
    }
    globalThis.window = fakeWindow

    try {
      const cleanup = createSidebarEntry({
        id: 'cloud-cancel-entry',
        rank: 10,
        label: '云端入口',
        access: 'cloud',
        iconSvg: '<svg></svg>',
        stageStore: fakeStageStore,
      })

      listeners.click()
      assert.ok(authCalledWith !== null)
      assert.equal(authCalledWith.kind, 'explicit')
      assert.equal(opened, false, 'stage must not open when explicit login is not successful')

      cleanup()
    } finally {
      globalThis.window = origWindow
      globalThis.document = origDoc
    }
  })

  it('createWorkbenchStageStore lazily binds window.__omnimuxWorkbench.createSidebarStore with polling and cleanup', async () => {
    const origWindow = globalThis.window
    const opened = []
    const closed = []
    let active = false
    const subscribers = new Set()
    const notify = () => { for (const fn of subscribers) fn() }

    globalThis.window = {}
    try {
      const store = createWorkbenchStageStore({
        tabId: 'omnimux-test:library',
        path: 'omnimux-test:sentinel',
        title: () => '测试页',
      })

      assert.equal(store.getSnapshot(), false)
      assert.deepEqual(store.readBox(), { top: 0, left: 0, width: 0, height: 0 })
      assert.doesNotThrow(() => store.open())
      assert.doesNotThrow(() => store.close())

      let notifications = 0
      const unsub = store.subscribe(() => { notifications += 1 })

      globalThis.window.__omnimuxWorkbench = {
        createSidebarStore(opts) {
          assert.equal(opts.tabId, 'omnimux-test:library')
          assert.equal(opts.path, 'omnimux-test:sentinel')
          assert.equal(opts.title(), '测试页')
          return {
            getSnapshot: () => active,
            subscribe(fn) {
              subscribers.add(fn)
              return () => { subscribers.delete(fn) }
            },
            open() {
              active = true
              opened.push(opts.tabId)
              notify()
            },
            close() {
              active = false
              closed.push(opts.tabId)
              notify()
            },
            readBox: () => ({ top: 1, left: 2, width: 300, height: 400 }),
          }
        },
      }

      await new Promise((resolve) => setTimeout(resolve, 90))
      assert.ok(notifications >= 1, 'polling subscribe must attach once workbench global appears')

      store.open()
      assert.equal(store.getSnapshot(), true)
      assert.deepEqual(opened, ['omnimux-test:library'])
      assert.deepEqual(store.readBox(), { top: 1, left: 2, width: 300, height: 400 })

      store.set(false)
      assert.equal(store.getSnapshot(), false)
      assert.deepEqual(closed, ['omnimux-test:library'])

      const beforeUnsub = notifications
      unsub()
      store.set(true)
      assert.equal(notifications, beforeUnsub, 'unsubscribed listener must not fire')
    } finally {
      globalThis.window = origWindow
    }
  })

  it('createWorkbenchSidebarEntry mounts entry with extraDatasetKeys, titleAttr and workbench activation', () => {
    const origWindow = globalThis.window
    const origDoc = globalThis.document
    const attrs = new Map()
    const listeners = new Map()
    const labelNode = { textContent: '' }
    const fakeEntry = {
      title: '',
      className: '',
      innerHTML: '',
      dataset: {},
      setAttribute: (k, v) => { attrs.set(k, v) },
      removeAttribute: (k) => { attrs.delete(k) },
      querySelector: () => labelNode,
      addEventListener: (evt, fn) => { listeners.set(evt, fn) },
    }
    let registeredRow = null
    let unregistered = false
    let openedTab = null
    let active = false
    let wbListener = null
    let localeListener = null
    let currentLabel = '技能/专家'

    globalThis.document = { createElement: () => fakeEntry }
    globalThis.window = {
      __omnimuxSidebar: {
        register: (row) => {
          registeredRow = row
          row.create()
          return () => { unregistered = true }
        },
      },
      __omnimuxWorkbench: {
        createSidebarStore: ({ tabId, title }) => ({
          getSnapshot: () => active,
          subscribe: (fn) => {
            wbListener = fn
            return () => { wbListener = null }
          },
          open: () => {
            openedTab = { tabId, title: title() }
            active = true
            wbListener?.()
          },
          close: () => {
            active = false
            wbListener?.()
          },
          readBox: () => ({ top: 0, left: 0, width: 0, height: 0 }),
        }),
      },
    }

    try {
      const cleanup = createWorkbenchSidebarEntry({
        id: 'omnimux-market',
        rank: 4.1,
        tabId: 'omnimux-market:plaza',
        label: () => currentLabel,
        iconSvg: '<svg></svg>',
        access: 'local',
        customClassName: 'omnimux-market-entry',
        datasetKey: 'data-omnimux-market-entry',
        extraDatasetKeys: ['data-omnimux-esc-entry'],
        titleAttr: true,
        locale: {
          subscribe: (fn) => {
            localeListener = fn
            return () => { localeListener = null }
          },
        },
      })

      assert.equal(registeredRow.id, 'omnimux-market-entry')
      assert.equal(registeredRow.rank, 4.1)
      assert.equal(attrs.get('data-omnimux-market-entry'), '')
      assert.equal(attrs.get('data-omnimux-esc-entry'), '')
      assert.equal(fakeEntry.title, '技能/专家')
      assert.equal(attrs.get('aria-label'), '技能/专家')
      assert.equal(labelNode.textContent, '技能/专家')

      currentLabel = 'Skills & Experts'
      localeListener?.()
      assert.equal(fakeEntry.title, 'Skills & Experts')
      assert.equal(attrs.get('aria-label'), 'Skills & Experts')

      listeners.get('click')?.()
      assert.deepEqual(openedTab, { tabId: 'omnimux-market:plaza', title: 'Skills & Experts' })
      assert.equal(fakeEntry.dataset.active, 'true')

      cleanup()
      assert.equal(unregistered, true)
      assert.equal(wbListener, null)
      assert.equal(localeListener, null)
    } finally {
      globalThis.window = origWindow
      globalThis.document = origDoc
    }
  })
})

describe('StageContainer & StageHeader/PageHeader components', () => {
  it('exports StageContainer with --stage-* variables and keepalive display:none', () => {
    const src = readFileSync(join(here, 'StageContainer.tsx'), 'utf8')
    assert.match(src, /useSyncExternalStore/)
    assert.match(src, /--stage-top/)
    assert.match(src, /--stage-left/)
    assert.match(src, /--stage-width/)
    assert.match(src, /--stage-height/)
    assert.match(src, /data-visible/)
  })

  it('exports PageHeader with standard title, subtitle, refresh, close, and 20px typography', () => {
    const src = readFileSync(join(here, 'PageHeader.tsx'), 'utf8')
    assert.match(src, /IconRefreshOutline16/)
    assert.match(src, /IconCloseOutline16/)
    assert.match(src, /refreshing/)
    assert.match(src, /onRefresh/)
    assert.match(src, /onClose/)
    assert.match(src, /breadcrumb/)
    assert.match(src, /tabs/)

    const css = readFileSync(join(here, 'PageHeader.module.css'), 'utf8')
    assert.match(css, /font-size:\s*20px/, 'PageHeader title must be 20px')
    assert.match(css, /line-height:\s*28px/, 'PageHeader line-height must be 28px')
    assert.match(css, /font-weight:\s*600/, 'PageHeader font-weight must be 600')
    assert.match(css, /-webkit-app-region:\s*no-drag/, 'PageHeader must have no-drag')
  })

  it('StageHeader forwards to PageHeader for backward compatibility', () => {
    const src = readFileSync(join(here, 'StageHeader.tsx'), 'utf8')
    assert.match(src, /PageHeader/, 'StageHeader must forward to PageHeader')
  })
})
