import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'

const source = readFileSync(new URL('./session-create.js', import.meta.url), 'utf8')
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup({ install, create, attach, draft = '', protectedInput = false, receipt = true, mount = true, uiWorkspace = false, uiSwitches = true, openDelay = 0, duringWorkbenchOpen, composerActions = null } = {}) {
  const calls = [], listeners = new Set(), writes = [], wbCalls = [], uiCalls = []
  let current = 'a'
  const state = new Map([
    ['a', { draft: 'old draft', attachments: ['image-a'] }],
    ['b', { draft, attachments: protectedInput ? ['image-b'] : [] }],
    ['c', { draft: 'other draft', attachments: ['image-c'] }],
  ])
  const move = id => { current = id; for (const fn of listeners) fn() }
  const sessions = {
    list: { getSnapshot: () => ({ ids: ['a', 'b', 'c'], byId: { a: { workspaceId: 'w' } }, phase: 'ready', projectionsBySession: {} }), subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } },
    create: async options => { calls.push(['create', options.workspaceId]); return create ? create() : 'b' },
    open: id => { calls.push(['open', id]); move(id) },
  }
  const ui = uiWorkspace ? { openSession: id => { uiCalls.push(['openSession', id]); if (uiSwitches) move(id) } } : null
  const context = { plazaSessions: sessions, plazaUiWorkspace: ui, setTimeout, console, window: { __omnimuxWorkbench: {
    getSnapshot: () => ({ sessionId: current }),
    open: async payload => {
      wbCalls.push(['open', payload, current])
      await duringWorkbenchOpen?.(move)
      if (openDelay) {
        await new Promise(resolve => setTimeout(resolve, openDelay))
        wbCalls.push(['open-done', payload.sessionId])
      }
    },
    setFocus: mode => { wbCalls.push(['setFocus', mode]) },
    setConversationCollapsed: (value, opts) => { wbCalls.push(['setConversationCollapsed', value, opts]) },
  }, addEventListener: () => {} }, api: async (method, body) => {
    calls.push([method, body.sessionId || body.slug])
    if (method === 'install') return install ? install() : { ok: true }
    if (method === 'tryAttach') return attach ? attach(body) : { attached: true, hasBody: true, sessionId: body.sessionId, slug: body.slug }
    throw Error('unexpected API')
  } }
  if (composerActions) context.window.__omnimuxComposerActions = composerActions
  const exports = runInNewContext(source + '\n({createSkillSession,skillCreationInputs})', context)
  for (const [id, input] of state) {
    if (id === 'b' && !mount) continue
    exports.skillCreationInputs.set(id, {
      get draft() { return input.draft },
      get protected() { return input.attachments.length > 0 },
      write: text => {
        writes.push({ sessionId: id, text })
        if (receipt) input.draft = text
        return receipt
      },
    })
  }
  return { ...exports, calls, writes, wbCalls, uiCalls, move, state, listeners, current: () => current, run: options => exports.createSkillSession({ requireReady: true, timeoutMs: 5, navTimeoutMs: 1000, ...options }) }
}

test('ready flow installs once, attaches nonempty body to B, writes once without reading stale draft, preserves A', async () => {
  const h = setup({ uiWorkspace: true })
  const result = await h.run()
  assert.equal(result.ok, true)
  assert.equal(result.prefilled, true)
  // ready 路径走 uiWorkspace.openSession（Next/rc.3 壳里 sessions.open 不切主会话）。
  assert.deepEqual(h.uiCalls, [['openSession', 'b']])
  assert.equal(h.calls.some(call => call[0] === 'open'), false, '有 uiWorkspace 时不应回落 sessions.open')
  assert.deepEqual(h.calls, [['install', 'skill-creator'], ['create', 'w'], ['tryAttach', 'b']])
  // ready 路径必须真的把新会话开进 workbench，否则实机会停在旧会话、无 composer。
  // VM 里创建的对象跨 realm，用字段断言而不是 deepEqual 原型比较。
  assert.equal(h.wbCalls.length, 3)
  assert.equal(h.wbCalls[0][0], 'open')
  assert.equal(h.wbCalls[0][2], 'b', 'workbench.open 必须在会话切到 C 之后才调用')
  assert.equal(h.wbCalls[0][1].tabId, 'omnimux-market:plaza')
  assert.equal(h.wbCalls[0][1].sessionId, 'b')
  assert.equal(typeof h.wbCalls[0][1].title, 'string')
  assert.equal(h.wbCalls[0][1].focus, 'split', 'open 必须直接带 focus=split，避免异步 open 按 gui 覆盖')
  assert.deepEqual(h.wbCalls.map(call => call[0]), ['open', 'setFocus', 'setConversationCollapsed'])
  assert.deepEqual([...h.wbCalls[1]], ['setFocus', 'split'])
  assert.equal(h.wbCalls[2][0], 'setConversationCollapsed')
  assert.equal(h.wbCalls[2][1], false)
  assert.equal(h.wbCalls[2][2].sessionId, 'b')
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0].sessionId, 'b')
  assert.match(h.state.get('b').draft, /^\/skill-creator\n/)
  assert.deepEqual(h.state.get('a'), { draft: 'old draft', attachments: ['image-a'] })
  assert.deepEqual(h.state.get('c'), { draft: 'other draft', attachments: ['image-c'] })
  assert.equal(h.listeners.size, 0)
})

for (const [options, error, attempts] of [
  [{ draft: 'user text' }, 'draft-protected', 0],
  [{ protectedInput: true }, 'draft-protected', 0],
  [{ receipt: false }, 'prefill-failed', 1],
  [{ mount: false }, 'input-unavailable', 0],
]) {
  test(`protected/unavailable input returns ${error}: ${JSON.stringify(options)}`, async () => {
    const h = setup(options)
    const before = structuredClone([...h.state])
    const result = await h.run()
    assert.equal(result.ok, false)
    assert.equal(result.prefilled, false)
    assert.equal(result.error, error)
    assert.equal(result.sessionId, 'b')
    assert.equal(h.writes.length, attempts)
    assert.deepEqual([...h.state], before)
    assert.deepEqual(h.calls, [['install', 'skill-creator'], ['create', 'w'], ['tryAttach', 'b'], ['open', 'b']])
    assert.equal(h.listeners.size, 0)
  })
}

test('install failure never creates or navigates', async () => {
  const h = setup({ install: async () => { throw Error('offline') } })
  await assert.rejects(h.run(), /offline/)
  assert.deepEqual(h.calls, [['install', 'skill-creator']])
  assert.equal(h.current(), 'a')
})

for (const stage of ['install', 'create', 'attach']) {
  test(`session switch during ${stage} never steals navigation, even after returning to A`, async () => {
    const pending = deferred(), entered = deferred()
    const h = setup({ [stage]: () => { entered.resolve(); return pending.promise } })
    const run = h.run()
    await entered.promise
    h.move('c'); h.move('a')
    pending.resolve(stage === 'create' ? 'b' : { attached: true, hasBody: true, sessionId: 'b', slug: 'skill-creator' })
    assert.equal((await run).cancelled, true)
    assert.equal(h.calls.some(call => call[0] === 'open'), false)
    assert.equal(h.writes.length, 0)
  })
}

test('closing panel cancels pending install without navigation', async () => {
  const pending = deferred()
  let cancelled = false
  const h = setup({ install: () => pending.promise })
  const run = h.run({ isCancelled: () => cancelled })
  cancelled = true
  pending.resolve({ ok: true })
  assert.equal((await run).cancelled, true)
  assert.deepEqual(h.calls, [['install', 'skill-creator']])
})

test('empty body or wrong-session attachment fails closed before navigation', async () => {
  for (const attached of [{ attached: true, hasBody: false, sessionId: 'b', slug: 'skill-creator' }, { attached: true, hasBody: true, sessionId: 'c', slug: 'skill-creator' }]) {
    const h = setup({ attach: async () => attached })
    await assert.rejects(h.run(), /skill-body-unavailable/)
    assert.equal(h.current(), 'a')
    assert.equal(h.writes.length, 0)
  }
})

test('no current session can create through the same public service', async () => {
  const h = setup()
  h.move('')
  assert.equal((await h.run()).ok, true)
  assert.equal(h.current(), 'b')
})

test('switch away while target input is mounting never writes or reopens target', async () => {
  const h = setup({ mount: false, uiWorkspace: true })
  const result = await h.run({ onTarget: () => queueMicrotask(() => h.move('c')) })
  assert.equal(result.cancelled, true)
  assert.equal(h.current(), 'c')
  assert.equal(h.writes.length, 0)
  assert.equal(h.uiCalls.length, 1, '导航必须只发起一次（uiWorkspace.openSession）')
})

test('concurrent calls cannot borrow another creation result', async () => {
  const pending = deferred()
  const h = setup({ install: () => pending.promise })
  const first = h.run()
  assert.equal((await h.run()).error, 'creation-busy')
  pending.resolve({ ok: true })
  assert.equal((await first).ok, true)
  assert.equal(h.calls.filter(call => call[0] === 'create').length, 1)
})

test('falls back to sessions.open when uiWorkspace is unavailable', async () => {
  const h = setup({ uiWorkspace: false })
  const result = await h.run()
  assert.equal(result.ok, true)
  assert.deepEqual(h.calls, [['install', 'skill-creator'], ['create', 'w'], ['tryAttach', 'b'], ['open', 'b']])
  assert.equal(h.uiCalls.length, 0)
  assert.equal(h.wbCalls[0][2], 'b', 'workbench.open 必须在会话切到 C 之后')
})

test('awaits async workbench.open before forcing split focus', async () => {
  const h = setup({ uiWorkspace: true, openDelay: 20 })
  const result = await h.run()
  assert.equal(result.ok, true)
  assert.deepEqual(
    h.wbCalls.map(call => call[0]),
    ['open', 'open-done', 'setFocus', 'setConversationCollapsed'],
    'setFocus 必须在异步 open 落定之后',
  )
})

test('prefills once after workbench.open temporarily leaves the current session unbound', async () => {
  const writes = []
  const h = setup({
    uiWorkspace: true,
    duringWorkbenchOpen: async move => {
      move('')
      await Promise.resolve()
      move('b')
    },
    composerActions: {
      setDraft: text => { writes.push(text); return true },
      getDraft: () => writes[0] || '',
    },
  })
  const result = await h.run({ timeoutMs: 1000 })
  assert.equal(result.ok, true)
  assert.equal(result.prefilled, true)
  assert.equal(writes.length, 1)
  assert.match(writes[0], /^\/skill-creator\n/)
  assert.equal(h.writes.length, 0)
  assert.equal(h.state.get('a').draft, 'old draft')
})

test('manual switch during workbench.open cancels even if the target returns', async () => {
  const h = setup({
    uiWorkspace: true,
    duringWorkbenchOpen: move => { move('c'); move('b') },
  })
  assert.equal((await h.run()).cancelled, true)
  assert.equal(h.writes.length, 0)
  assert.deepEqual(h.wbCalls.map(call => call[0]), ['open'])
})

test('a draft already present in the composer bridge is protected', async () => {
  const writes = []
  const h = setup({
    uiWorkspace: true,
    composerActions: {
      setDraft: text => { writes.push(text); return true },
      getDraft: () => 'user draft',
    },
  })
  const result = await h.run({ timeoutMs: 1000 })
  assert.equal(result.error, 'draft-protected')
  assert.deepEqual(writes, [])
})

test('ready prefill uses composer bridge receipt and verifies getDraft readback', async () => {
  const drafts = []
  const h = setup({
    uiWorkspace: true,
    composerActions: {
      setDraft: text => { drafts.push(text); return true },
      getDraft: () => drafts.at(-1) || '',
    },
  })
  const result = await h.run({ timeoutMs: 1000 })
  assert.equal(result.ok, true)
  assert.equal(result.prefilled, true)
  assert.match(drafts[0], /^\/skill-creator\n/)
  assert.equal(h.writes.length, 0, '真实 composer 桥可用时不得走 slot 内部通路')
})

test('composer bridge setDraft false returns visible prefill-failed', async () => {
  const h = setup({
    uiWorkspace: true,
    composerActions: { setDraft: () => false, getDraft: () => '' },
  })
  const result = await h.run({ timeoutMs: 1000 })
  assert.equal(result.ok, false)
  assert.equal(result.prefilled, false)
  assert.equal(result.error, 'prefill-failed')
  assert.equal(h.writes.length, 0)
})

test('returns session-navigation-unavailable instead of silently waiting when the host never switches', async () => {
  const h = setup({ uiWorkspace: true, uiSwitches: false })
  const result = await h.run({ navTimeoutMs: 80 })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'session-navigation-unavailable')
  assert.equal(h.wbCalls.length, 0, '没切到目标会话不得开 workbench')
  assert.deepEqual(h.uiCalls, [['openSession', 'b']])
})
