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

function makeSessions(initial) {
  let snapshot = initial
  const listeners = new Set()
  return {
    list: {
      getSnapshot: () => snapshot,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    },
    select(sessionId) {
      snapshot = { ...snapshot, current: sessionId }
      for (const listener of listeners) listener()
    },
  }
}

describe('new-session-click.js isolation', () => {
  it('does not create sessions or projects through APIs', () => {
    assert.doesNotMatch(source, /sessions\.create/)
    assert.doesNotMatch(source, /startReplicationProject/)
    assert.doesNotMatch(source, /runNewProject/)
    assert.doesNotMatch(source, /omnimux-workflow/)
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
})

describe('clickOfficialNewSession official lifecycle resolution', () => {
  it('requires the public lifecycle seam and fails without an official button', async () => {
    const noSeam = await clickOfficialNewSession({ document: makeDoc([makeButton({ className: 'newSession' })]) })
    assert.deepEqual(noSeam, { ok: false, error: 'newSessionFailed' })
    const sessions = makeSessions({ current: 'old', byId: { old: { blank: false } } })
    const noButton = await clickOfficialNewSession({ document: makeDoc([]), sessions })
    assert.deepEqual(noButton, { ok: false, error: 'newSessionFailed' })
  })

  it('uses the direct single-workspace action when there is no current session', async () => {
    const generic = makeButton({ className: 'newSession' })
    const workspace = makeButton({ aria: '在“测试环境”中新建会话' })
    const sessions = makeSessions({ byId: { new: { blank: true } } })
    workspace.click = function click() { this.clicks.push(1); sessions.select('new') }
    const result = await clickOfficialNewSession({ document: makeDoc([generic, workspace]), sessions })
    assert.equal(workspace.clicks.length, 1)
    assert.equal(generic.clicks.length, 0)
    assert.deepEqual(result, { ok: true, sessionId: 'new', reusedBlank: false })
  })

  it('waits for async official selection A instead of returning pre-click blank B', async () => {
    const item = makeMenuItem('New Session')
    const sessions = makeSessions({
      current: 'blank-B',
      ids: ['blank-A', 'blank-B'],
      byId: { 'blank-A': { blank: true }, 'blank-B': { blank: true } },
    })
    item.click = function click() { this.clicks.push(1); Promise.resolve().then(() => sessions.select('blank-A')) }
    const result = await clickOfficialNewSession({ document: makeDoc([], () => [item]), sessions, timeoutMs: 100, pollMs: 1 })
    assert.deepEqual(result, { ok: true, sessionId: 'blank-A', reusedBlank: false })
  })

  it('accepts same-id blank reuse only after an official selection notification', async () => {
    const item = makeMenuItem('New Session')
    const sessions = makeSessions({ current: 'blank-B', byId: { 'blank-B': { blank: true } } })
    item.click = function click() { this.clicks.push(1); sessions.select('blank-B') }
    const result = await clickOfficialNewSession({ document: makeDoc([], () => [item]), sessions, timeoutMs: 100, pollMs: 1 })
    assert.deepEqual(result, { ok: true, sessionId: 'blank-B', reusedBlank: true })
  })

  it('waits for a delayed session menu and never clicks Create project', async () => {
    const button = makeButton({ className: 'newSession' })
    const sessionItem = makeMenuItem('新建会话')
    const projectItem = makeMenuItem('新建项目')
    const sessions = makeSessions({ current: 'old', byId: { old: { blank: false }, new: { blank: true } } })
    let menuOpen = false
    sessionItem.click = function click() { this.clicks.push(1); sessions.select('new') }
    const result = await clickOfficialNewSession({
      document: makeDoc([button], () => (menuOpen ? [projectItem, sessionItem] : [])),
      sessions,
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
    const sessions = makeSessions({ current: 'blank-B', byId: { 'blank-B': { blank: true }, 'blank-A': { blank: true } } })
    let menuOpen = false
    button.click = function click() { this.clicks.push(1); menuOpen = true; sessions.select('blank-B') }
    item.click = function click() { this.clicks.push(1); sessions.select('blank-A') }
    const result = await clickOfficialNewSession({
      document: makeDoc([button], () => (menuOpen ? [item] : [])), sessions, timeoutMs: 100, pollMs: 1,
    })
    assert.equal(item.clicks.length, 1)
    assert.deepEqual(result, { ok: true, sessionId: 'blank-A', reusedBlank: false })
  })

  it('times out when the official lifecycle never selects a blank target', async () => {
    const item = makeMenuItem('New Session')
    const sessions = makeSessions({ current: 'old', byId: { old: { blank: false } } })
    const result = await clickOfficialNewSession({ document: makeDoc([], () => [item]), sessions, timeoutMs: 10, pollMs: 1 })
    assert.equal(item.clicks.length, 1)
    assert.deepEqual(result, { ok: false, error: 'newSessionFailed' })
  })
})
