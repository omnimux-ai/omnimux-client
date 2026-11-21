import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWorkspaceContextStore } from './workspace-context.js'

function makeStores({ session, workspace, project }) {
  const byId = session ? { [session.id]: session } : {}
  return {
    sessions: {
      list: {
        getSnapshot: () => ({ current: session?.id ?? null, byId, archivedSessionIds: [] }),
        subscribe: () => () => {},
      },
    },
    workspaces: {
      list: {
        getSnapshot: () => ({ items: workspace ? [workspace] : [] }),
        subscribe: () => () => {},
      },
    },
    fetchProject: async () => ({ ok: true, status: 200, body: { project } }),
  }
}

test('session -> workspace -> project -> activePage', async () => {
  const project = {
    id: 'p1', title: '项目', path: '/work/a', activePageId: 'page2',
    pages: [{ id: 'page1', canvasWorkspaceId: 'ws_1' }, { id: 'page2', canvasWorkspaceId: 'ws_2' }],
  }
  const stores = makeStores({
    session: { id: 's1', cwd: '/work/a', updatedAt: 1 },
    workspace: { workspaceId: 'w1', path: '/work/a', title: 'A', sessionIds: ['s1'] },
    project,
  })
  const context = createWorkspaceContextStore({
    sessions: stores.sessions, workspaces: stores.workspaces, fetchProject: stores.fetchProject,
  })
  const state = await context.refresh()
  assert.equal(state.status, 'ready')
  assert.equal(state.workspaceId, 'w1')
  assert.equal(state.project.id, 'p1')
  assert.equal(state.activePage.id, 'page2')
  assert.equal(state.activePage.canvasWorkspaceId, 'ws_2')
  context.dispose()
})

test('no workspace is explicit, not a guessed first workspace', async () => {
  const stores = makeStores({
    session: { id: 's1', cwd: '/work/orphan', updatedAt: 1 },
    workspace: { workspaceId: 'w1', path: '/work/other', title: 'Other', sessionIds: [] },
    project: null,
  })
  const context = createWorkspaceContextStore({
    sessions: stores.sessions, workspaces: stores.workspaces, fetchProject: stores.fetchProject,
  })
  const state = await context.refresh()
  assert.equal(state.status, 'no-workspace')
  assert.equal(state.workspaceId, null)
  context.dispose()
})

test('workspace without project is a visible guide state', async () => {
  const stores = makeStores({
    session: { id: 's1', cwd: '/work/a', updatedAt: 1 },
    workspace: { workspaceId: 'w1', path: '/work/a', title: 'A', sessionIds: ['s1'] },
    project: null,
  })
  const context = createWorkspaceContextStore({
    sessions: stores.sessions, workspaces: stores.workspaces, fetchProject: stores.fetchProject,
  })
  const state = await context.refresh()
  assert.equal(state.status, 'workspace-no-project')
  assert.equal(state.project, null)
  context.dispose()
})

test('session list refresh keeps the visible project until its lookup resolves', async t => {
  const project = {
    id: 'p1', path: '/work/a', activePageId: 'main',
    pages: [{ id: 'main', canvasWorkspaceId: 'ws_main' }, { id: 'second', canvasWorkspaceId: 'ws_second' }],
  }
  const stores = makeStores({
    session: { id: 's1', cwd: '/work/a' },
    workspace: { workspaceId: 'w1', path: '/work/a' },
    project,
  })
  let refreshFromSessionList
  stores.sessions.list.subscribe = listener => { refreshFromSessionList = listener; return () => {} }
  let reply = Promise.resolve({ ok: true, body: { project } })
  const context = createWorkspaceContextStore({ ...stores, fetchProject: () => reply })
  t.after(() => context.dispose())
  const initial = await context.refresh()

  const delayed = Promise.withResolvers()
  reply = delayed.promise
  const revalidation = refreshFromSessionList()
  assert.equal(context.getSnapshot(), initial)
  assert.equal(context.getSnapshot().activePage.canvasWorkspaceId, 'ws_main')

  delayed.resolve({ ok: true, body: { project: { ...project, activePageId: 'second' } } })
  assert.equal((await revalidation).activePage.canvasWorkspaceId, 'ws_second')
})

test('a new session clears the previous projection and ignores its late lookup error', async t => {
  const project = { id: 'p1', path: '/work/a', pages: [{ id: 'main', canvasWorkspaceId: 'ws_main' }] }
  const stores = makeStores({ workspace: { workspaceId: 'w1', path: '/work/a' }, project })
  let current = 's1'
  stores.sessions.list.getSnapshot = () => ({
    current, byId: { s1: { cwd: '/work/a' }, s2: { cwd: '/work/a' } },
  })
  let reply = Promise.resolve({ ok: true, body: { project } })
  const context = createWorkspaceContextStore({ ...stores, fetchProject: () => reply })
  t.after(() => context.dispose())
  await context.refresh()

  const stale = Promise.withResolvers()
  reply = stale.promise
  const refreshingFirst = context.refresh()
  current = 's2'
  reply = Promise.resolve({ ok: true, body: { project } })
  const refreshingSecond = context.refresh()
  assert.equal(context.getSnapshot().sessionId, 's2')
  assert.equal(context.getSnapshot().project, null)
  const ready = await refreshingSecond

  stale.resolve({ ok: false, status: 500, body: { error: 'old lookup failed' } })
  await refreshingFirst
  assert.equal(context.getSnapshot(), ready)
})
