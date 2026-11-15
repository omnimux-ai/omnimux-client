import test from 'node:test'
import assert from 'node:assert/strict'
import { createAttachmentAdmission } from './attachment-admission.js'
const observable = initial => {
  let value = initial
  const listeners = new Set()
  return { getSnapshot: () => value, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    set(next) { value = next; for (const fn of [...listeners]) fn() }, listeners }
}
test('attachment retirement requires correlated Host admission and preserves later additions', () => {
  const session = observable({ pendingSubmissions: [], queue: [] })
  const eventSource = observable({ entries: [] })
  const removed = []
  const admission = createAttachmentAdmission({ getSessions: () => ({ binding: () => ({ session, eventSource }) }),
    store: { removeAttachment: (...args) => removed.push(args) } })
  admission.arm('A', 'draft', [{ id: 'one' }])
  session.set({ pendingSubmissions: [{ requestId: 'req1', text: 'draft' }], queue: [] })
  session.set({ pendingSubmissions: [], queue: [], promptError: { op: 'send' } })
  assert.deepEqual(removed, [], 'failed optimistic send must preserve attachments')
  admission.arm('A', 'draft', [{ id: 'one' }])
  session.set({ pendingSubmissions: [{ requestId: 'req2', text: 'draft' }], queue: [] })
  eventSource.set({ entries: [{ type: 'event', event: { type: 'user/message', data: { source: { kind: 'user', rpcId: 'unrelated' } } } }] })
  assert.deepEqual(removed, [])
  session.set({ pendingSubmissions: [], queue: [{ rpcId: 'req2' }] })
  assert.deepEqual(removed, [['A', 'one']], '匹配到宿主回执后只回收本次提交的附件')
  session.set({ pendingSubmissions: [], queue: [{ rpcId: 'req2' }] })
  assert.equal(removed.length, 1)
  admission.dispose()
  assert.equal(session.listeners.size, 0)
  assert.equal(eventSource.listeners.size, 0)
})

const bind = ({ session, eventSource }) => ({ binding: () => ({ session, eventSource }) })

test('correlates by attachment identity when the draft text is empty', () => {
  const session = observable({ pendingSubmissions: [], queue: [] })
  const eventSource = observable({ entries: [] })
  const removed = []
  const admission = createAttachmentAdmission({ getSessions: () => bind({ session, eventSource }), store: { removeAttachment: (...a) => removed.push(a) } })
  admission.arm('S', '', [{ id: 'att-9' }])
  session.set({ pendingSubmissions: [{ requestId: 'r1', text: '', attachments: [{ attachmentId: 'att-9' }] }], queue: [] })
  assert.deepEqual(removed, [], 'must not clear before Host admission')
  session.set({ pendingSubmissions: [], queue: [{ rpcId: 'r1' }] })
  assert.deepEqual(removed, [['S', 'att-9']])
  admission.dispose()
})

test('follows a binding swapped mid-flight and still clears on admission', () => {
  const session = observable({ pendingSubmissions: [], queue: [] })
  const eventSource = observable({ entries: [] })
  const removed = []
  let current = { session, eventSource }
  const admission = createAttachmentAdmission({ getSessions: () => ({ binding: () => current }), store: { removeAttachment: (...a) => removed.push(a) } })
  admission.arm('S', 'hi', [{ id: 'a1' }])
  current = { session, eventSource } // Host re-keys the session binding
  session.set({ pendingSubmissions: [{ requestId: 'r2', text: 'hi' }], queue: [] })
  session.set({ pendingSubmissions: [], queue: [{ rpcId: 'r2' }] })
  assert.deepEqual(removed, [['S', 'a1']])
  admission.dispose()
})

test('missing binding at arm keeps attachments and never throws', () => {
  const removed = []
  const admission = createAttachmentAdmission({ getSessions: () => null, store: { removeAttachment: (...a) => removed.push(a) } })
  assert.doesNotThrow(() => admission.arm('S', 'x', [{ id: 'a' }]))
  assert.deepEqual(removed, [])
  admission.dispose()
})

test('a retired submission without admission is preserved, then clears once admitted', () => {
  const session = observable({ pendingSubmissions: [], queue: [] })
  const eventSource = observable({ entries: [] })
  const removed = []
  const admission = createAttachmentAdmission({ getSessions: () => bind({ session, eventSource }), store: { removeAttachment: (...a) => removed.push(a) } })
  admission.arm('S', 'hi', [{ id: 'a' }])
  session.set({ pendingSubmissions: [{ requestId: 'r1', text: 'hi' }], queue: [] })
  session.set({ pendingSubmissions: [], queue: [], promptError: { op: 'send' } })
  assert.deepEqual(removed, [], 'a lost/rejected message must not clear the chip')
  session.set({ pendingSubmissions: [], queue: [{ rpcId: 'r1' }] })
  assert.deepEqual(removed, [['S', 'a']], 'clears only after the Host proves admission')
  admission.dispose()
})

test('arm before the host binding is ready retries and clears once it appears and is admitted', () => {
  const session = observable({ pendingSubmissions: [], queue: [] })
  const eventSource = observable({ entries: [] })
  const removed = []
  let binding = null
  const timers = new Map()
  let nextId = 0
  let lastTick = null
  const fakeSetTimeout = (fn) => { const id = ++nextId; timers.set(id, fn); lastTick = fn; return id }
  const fakeClearTimeout = (id) => { timers.delete(id) }
  const admission = createAttachmentAdmission({
    getSessions: () => (binding ? { binding: () => binding } : null),
    store: { removeAttachment: (...a) => removed.push(a) },
    setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout,
  })
  admission.arm('S', 'hi', [{ id: 'a' }]) // binding not ready yet -> queued for retry
  assert.equal(removed.length, 0)
  binding = { session, eventSource }      // host sessions binding becomes ready
  lastTick()                              // retry flushes the detached attempt
  session.set({ pendingSubmissions: [{ requestId: 'r1', text: 'hi' }], queue: [] })
  session.set({ pendingSubmissions: [], queue: [{ rpcId: 'r1' }] })
  assert.deepEqual(removed, [['S', 'a']], 'clears once the binding is ready and the Host admits')
  admission.dispose()
  assert.equal(timers.size, 0, 'dispose clears the pending retry timer')
})
