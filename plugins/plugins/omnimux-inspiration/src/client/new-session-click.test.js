import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { clickOfficialNewSession, findNewSessionButton, findSingleWorkspaceNewSessionButton } from './new-session-click.js'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'new-session-click.js'), 'utf8')

function makeButton({ className = '', aria = '', menu = false, treeitem = false, topbar = false, visible = true } = {}) {
  const clicks = []
  return {
    className,
    clicks,
    getAttribute(name) {
      if (name === 'aria-label') return aria
      if (name === 'data-omnimux-topbar-new-session') return topbar ? '1' : null
      return null
    },
    hasAttribute(name) { return name === 'data-omnimux-topbar-new-session' ? topbar : false },
    closest(selector) {
      if (selector === '#omnimux-sidebar-new-menu') return menu ? {} : null
      if (selector === '[role="treeitem"]') return treeitem ? {} : null
      if (selector === '[data-omnimux-topbar-new-session="1"]') return topbar ? {} : null
      if (selector === '[data-omnimux-topbar-new-session]') return topbar ? {} : null
      return null
    },
    getClientRects() { return visible ? [{}] : [] },
    click() { clicks.push(1) },
  }
}

function makeMenuItem(text) {
  const clicks = []
  return {
    textContent: text,
    clicks,
    getAttribute() { return null },
    click() { clicks.push(1) },
  }
}

function makeDoc(buttons, getMenuItems = () => []) {
  return {
    querySelector(selector) {
      if (selector !== '#omnimux-sidebar-new-menu') return null
      const items = getMenuItems()
      return items.length ? { querySelectorAll: (inner) => (inner === '[role="menuitem"]' ? items : []) } : null
    },
    querySelectorAll(selector) {
      if (selector === 'button') return buttons
      if (selector === '#omnimux-sidebar-new-menu [role="menuitem"]') return getMenuItems()
      return []
    },
  }
}

/**
 * rc.3 `SessionListState` shape: `{ ids, byId, phase, projectionsBySession }`.
 * There is deliberately no `current` field — the production contract has none.
 */
function makeSessions(initial = {}) {
  let snapshot = {
    ids: [...(initial.ids || [])],
    byId: { ...(initial.byId || {}) },
    phase: initial.phase || 'ready',
    projectionsBySession: { ...(initial.projectionsBySession || {}) },
  }
  let activeId = initial.activeId || ''
  const listeners = new Set()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  return {
    list: {
      getSnapshot: () => snapshot,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    },
    getActiveId: () => activeId,
    select(sessionId) {
      activeId = sessionId
      notify()
    },
    /**
     * Official `POST /api/session/create` result. `select: false` simulates the
     * workbench snapshot lagging behind the list: the new blank id must still be
     * found through the ids diff.
     */
    createBlank(sessionId, { select = true } = {}) {
      const byId = Object.fromEntries([...Object.entries(snapshot.byId), [sessionId, { blank: true }]])
      snapshot = { ...snapshot, ids: [...snapshot.ids, sessionId], byId }
      if (select) activeId = sessionId
      notify()
    },
  }
}

/** Legal host read ports shared by the workbench and the attachment store. */
function makeWindow(sessions, { workbench = true, attachments = true } = {}) {
  const win = {}
  if (workbench) {
    win.__omnimuxWorkbench = {
      getSnapshot: () => ({ sessionId: sessions.getActiveId() }),
      getCurrentSessionId: () => sessions.getActiveId(),
    }
  }
  if (attachments) {
    win.__omnimuxAttachments = { getActiveSessionId: () => sessions.getActiveId() }
  }
  return win
}

describe('new-session-click.js isolation', () => {
  it('does not create sessions or projects through APIs', () => {
    assert.doesNotMatch(source, /sessions\.create/)
    assert.doesNotMatch(source, /startReplicationProject/)
    assert.doesNotMatch(source, /runNewProject/)
    assert.doesNotMatch(source, /omnimux-workflow/)
  })

  it('does not read the retired SessionListState.current field', () => {
    assert.doesNotMatch(source, /snapshot\?\.current/)
    assert.doesNotMatch(source, /sessionSnapshot\([^)]*\)\?\.current/)
    assert.match(source, /resolveCurrentSessionId/)
  })
})

describe('official button discovery', () => {
  it('selects a visible official button and excludes menu, tree, and topbar twins', () => {
    const official = makeButton({ className: 'newSession' })
    assert.equal(findNewSessionButton(makeDoc([
      makeButton({ className: 'newSession', menu: true }),
      makeButton({ aria: '新建会话', treeitem: true }),
      makeButton({ aria: '新建会话', topbar: true }),
      official,
    ])), official)
  })

  it('uses exactly one visible explicit-workspace action', () => {
    const first = makeButton({ aria: '在“测试环境”中新建会话' })
    const second = makeButton({ aria: '在“另一个工作区”中新建会话' })
    assert.equal(findSingleWorkspaceNewSessionButton(makeDoc([first])), first)
    assert.equal(findSingleWorkspaceNewSessionButton(makeDoc([first, second])), null)
  })

  it('recognizes the localized 新建对话 / 新对话 labels', () => {
    const workspace = makeButton({ aria: '在“测试环境”中新建对话' })
    assert.equal(findSingleWorkspaceNewSessionButton(makeDoc([workspace])), workspace)
    const generic = makeButton({ aria: '新对话' })
    assert.equal(findNewSessionButton(makeDoc([generic])), generic)
  })
})

describe('clickOfficialNewSession official lifecycle resolution (rc.3 shape)', () => {
  it('requires the public lifecycle seam and fails without an official button', async () => {
    const noSeam = await clickOfficialNewSession({ document: makeDoc([makeButton({ className: 'newSession' })]) })
    assert.deepEqual(noSeam, { ok: false, error: 'newSessionFailed' })
    const sessions = makeSessions({ ids: ['old'], byId: { old: { blank: false } }, activeId: 'old' })
    const noButton = await clickOfficialNewSession({ document: makeDoc([]), sessions, window: makeWindow(sessions) })
    assert.deepEqual(noButton, { ok: false, error: 'newSessionFailed' })
  })

  it('uses the direct single-workspace action when there is no current session', async () => {
    const generic = makeButton({ className: 'newSession' })
    const workspace = makeButton({ aria: '在“测试环境”中新建会话' })
    const sessions = makeSessions()
    workspace.click = function click() { this.clicks.push(1); sessions.createBlank('new') }
    const result = await clickOfficialNewSession({
      document: makeDoc([generic, workspace]),
      sessions,
      window: makeWindow(sessions),
    })
    assert.equal(workspace.clicks.length, 1)
    assert.equal(generic.clicks.length, 0)
    assert.deepEqual(result, { ok: true, sessionId: 'new', reusedBlank: false })
  })

  it('waits for async official selection A instead of returning pre-click blank B', async () => {
    const item = makeMenuItem('New Session')
    const sessions = makeSessions({
      ids: ['blank-A', 'blank-B'],
      byId: { 'blank-A': { blank: true }, 'blank-B': { blank: true } },
      activeId: 'blank-B',
    })
    item.click = function click() { this.clicks.push(1); Promise.resolve().then(() => sessions.select('blank-A')) }
    const result = await clickOfficialNewSession({
      document: makeDoc([], () => [item]),
      sessions,
      window: makeWindow(sessions),
      timeoutMs: 100,
      pollMs: 1,
    })
    assert.deepEqual(result, { ok: true, sessionId: 'blank-A', reusedBlank: false })
  })

  it('accepts same-id blank reuse only after an official selection notification', async () => {
    const item = makeMenuItem('New Session')
    const sessions = makeSessions({
      ids: ['blank-B'],
      byId: { 'blank-B': { blank: true } },
      activeId: 'blank-B',
    })
    item.click = function click() { this.clicks.push(1); sessions.select('blank-B') }
    const result = await clickOfficialNewSession({
      document: makeDoc([], () => [item]),
      sessions,
      window: makeWindow(sessions),
      timeoutMs: 100,
      pollMs: 1,
    })
    assert.deepEqual(result, { ok: true, sessionId: 'blank-B', reusedBlank: true })
  })

  it('detects a newly created blank through the ids diff even if the workbench snapshot lags', async () => {
    const button = makeButton({ className: 'newSession' })
    const sessions = makeSessions({ ids: ['old'], byId: { old: { blank: false } }, activeId: 'old' })
    button.click = function click() { this.clicks.push(1); sessions.createBlank('new', { select: false }) }
    const result = await clickOfficialNewSession({
      document: makeDoc([button]),
      sessions,
      window: makeWindow(sessions),
      timeoutMs: 100,
      pollMs: 1,
    })
    assert.deepEqual(result, { ok: true, sessionId: 'new', reusedBlank: false })
  })

  it('falls back to the attachment store when the workbench read port is unavailable', async () => {
    const button = makeButton({ className: 'newSession' })
    const sessions = makeSessions({ ids: ['blank-B'], byId: { 'blank-B': { blank: true } }, activeId: 'blank-B' })
    button.click = function click() { this.clicks.push(1); sessions.select('blank-B') }
    const result = await clickOfficialNewSession({
      document: makeDoc([button]),
      sessions,
      window: makeWindow(sessions, { workbench: false, attachments: true }),
      timeoutMs: 100,
      pollMs: 1,
    })
    assert.deepEqual(result, { ok: true, sessionId: 'blank-B', reusedBlank: true })
  })

  it('waits for a delayed session menu and never clicks Create project', async () => {
    const button = makeButton({ className: 'newSession' })
    const sessionItem = makeMenuItem('新建会话')
    const projectItem = makeMenuItem('新建项目')
    const sessions = makeSessions({ ids: ['old'], byId: { old: { blank: false } }, activeId: 'old' })
    let menuOpen = false
    sessionItem.click = function click() { this.clicks.push(1); sessions.createBlank('new') }
    const result = await clickOfficialNewSession({
      document: makeDoc([button], () => (menuOpen ? [projectItem, sessionItem] : [])),
      sessions,
      window: makeWindow(sessions),
      timeoutMs: 100,
      pollMs: 1,
      sleep: async () => { menuOpen = true },
    })
    assert.equal(button.clicks.length, 1)
    assert.equal(sessionItem.clicks.length, 1)
    assert.equal(projectItem.clicks.length, 0)
    assert.deepEqual(result, { ok: true, sessionId: 'new', reusedBlank: false })
  })

  it('does not settle from a menu-opener projection before the session menuitem dispatches', async () => {
    const button = makeButton({ className: 'newSession' })
    const item = makeMenuItem('新建会话')
    const sessions = makeSessions({
      ids: ['blank-B', 'blank-A'],
      byId: { 'blank-B': { blank: true }, 'blank-A': { blank: true } },
      activeId: 'blank-B',
    })
    let menuOpen = false
    button.click = function click() { this.clicks.push(1); menuOpen = true; sessions.select('blank-B') }
    item.click = function click() { this.clicks.push(1); sessions.select('blank-A') }
    const result = await clickOfficialNewSession({
      document: makeDoc([button], () => (menuOpen ? [item] : [])),
      sessions,
      window: makeWindow(sessions),
      timeoutMs: 100,
      pollMs: 1,
    })
    assert.equal(item.clicks.length, 1)
    assert.deepEqual(result, { ok: true, sessionId: 'blank-A', reusedBlank: false })
  })

  it('times out when the official lifecycle never selects a blank target', async () => {
    const item = makeMenuItem('New Session')
    const sessions = makeSessions({ ids: ['old'], byId: { old: { blank: false } }, activeId: 'old' })
    const result = await clickOfficialNewSession({
      document: makeDoc([], () => [item]),
      sessions,
      window: makeWindow(sessions),
      timeoutMs: 10,
      pollMs: 1,
    })
    assert.equal(item.clicks.length, 1)
    assert.deepEqual(result, { ok: false, error: 'newSessionFailed' })
  })

  it('resolves reused blank retained synchronously by mainView even before workbench snapshot catches up', async () => {
    let snapshot = {
      ids: ['old', 'blank-A'],
      byId: {
        old: { blank: false, retainedBy: { mainView: 1 } },
        'blank-A': { blank: true },
      },
      phase: 'ready',
      projectionsBySession: {},
    }
    const listeners = new Set()
    const sessions = {
      list: {
        getSnapshot: () => snapshot,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      },
    }
    const win = {
      __omnimuxWorkbench: { getSnapshot: () => ({ sessionId: 'old' }) },
      __omnimuxAttachments: { getActiveSessionId: () => 'old' },
    }
    const button = makeButton({ className: 'newSession' })
    button.click = function click() {
      this.clicks.push(1)
      // Simulate rc.3+ replaceMain: retain fires list.subscribe while workbench still shows 'old'.
      snapshot = {
        ...snapshot,
        byId: {
          old: { blank: false },
          'blank-A': { blank: true, retainedBy: { mainView: 1 } },
        },
      }
      for (const listener of listeners) listener()
    }
    const result = await clickOfficialNewSession({
      document: makeDoc([button]),
      sessions,
      window: win,
      timeoutMs: 40,
      pollMs: 1,
    })
    assert.deepEqual(result, { ok: true, sessionId: 'blank-A', reusedBlank: false })
  })

  it('polls workbench/attachments after list.subscribe when React commits target selection asynchronously', async () => {
    const item = makeMenuItem('New Session')
    const sessions = makeSessions({
      ids: ['old', 'blank-A'],
      byId: { old: { blank: false }, 'blank-A': { blank: true } },
      activeId: 'old',
    })
    let committedActive = 'old'
    const win = {
      __omnimuxWorkbench: { getSnapshot: () => ({ sessionId: committedActive }) },
    }
    item.click = function click() {
      this.clicks.push(1)
      // First list.subscribe notification fires before React flushes committedActive.
      sessions.select('old')
      setTimeout(() => { committedActive = 'blank-A' }, 15)
    }
    const result = await clickOfficialNewSession({
      document: makeDoc([], () => [item]),
      sessions,
      window: win,
      timeoutMs: 120,
      pollMs: 2,
    })
    assert.deepEqual(result, { ok: true, sessionId: 'blank-A', reusedBlank: false })
  })

  it('resolves same-id mainView-retained blank reuse when host read ports return empty', async () => {
    let snapshot = {
      ids: ['blank-B'],
      byId: { 'blank-B': { blank: true, retainedBy: { mainView: 1 } } },
      phase: 'ready',
      projectionsBySession: {},
    }
    const listeners = new Set()
    const sessions = {
      list: {
        getSnapshot: () => snapshot,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      },
    }
    const button = makeButton({ className: 'newSession' })
    button.click = function click() {
      this.clicks.push(1)
      snapshot = { ...snapshot, byId: { 'blank-B': { blank: true, retainedBy: { mainView: 2 } } } }
      for (const listener of listeners) listener()
    }
    const result = await clickOfficialNewSession({
      document: makeDoc([button]),
      sessions,
      window: { __omnimuxWorkbench: { getSnapshot: () => ({ sessionId: '' }) } },
      timeoutMs: 40,
      pollMs: 1,
    })
    assert.deepEqual(result, { ok: true, sessionId: 'blank-B', reusedBlank: true })
  })
})
