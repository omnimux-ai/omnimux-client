import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { attachInspirationToCurrentSession } from './attach-to-current-session.js'

const ROW = {
  id: 'insp-1',
  title: '夏日护肤',
  source_url: 'https://tiktok.com/@x/video/1',
  source_platform: 'tiktok',
  type: 'video',
}

function makeWindow({ snapshotSessionId = '', getterSessionId = '', attachmentSessionId = '' } = {}) {
  const win = {}
  const workbench = {}
  if (snapshotSessionId !== null) workbench.getSnapshot = () => ({ sessionId: snapshotSessionId })
  if (getterSessionId !== null) workbench.getCurrentSessionId = () => getterSessionId
  if (Object.keys(workbench).length) win.__omnimuxWorkbench = workbench
  if (attachmentSessionId !== null) win.__omnimuxAttachments = { getActiveSessionId: () => attachmentSessionId }
  return win
}

describe('attachInspirationToCurrentSession', () => {
  it('resolves the workbench snapshot sessionId and attaches the inspiration payload', () => {
    const calls = []
    const result = attachInspirationToCurrentSession(ROW, {
      window: makeWindow({ snapshotSessionId: 'sess-workbench' }),
      addAttachment(sessionId, payload) {
        calls.push({ sessionId, payload })
        return { ok: true, attachment: { id: 'att-1' } }
      },
    })
    assert.deepEqual(result, { ok: true, sessionId: 'sess-workbench', attachmentId: 'att-1' })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].sessionId, 'sess-workbench')
    assert.equal(calls[0].payload.kind, 'inspiration')
    assert.equal(calls[0].payload.entityId, 'insp-1')
  })

  it('falls back to getCurrentSessionId() and then the attachment store', () => {
    const seen = []
    const addAttachment = (sessionId) => { seen.push(sessionId); return { ok: true } }
    assert.equal(attachInspirationToCurrentSession(ROW, {
      window: makeWindow({ snapshotSessionId: null, getterSessionId: 'sess-getter', attachmentSessionId: 'sess-att' }),
      addAttachment,
    }).sessionId, 'sess-getter')
    assert.equal(attachInspirationToCurrentSession(ROW, {
      window: makeWindow({ snapshotSessionId: null, getterSessionId: null, attachmentSessionId: 'sess-att' }),
      addAttachment,
    }).sessionId, 'sess-att')
    assert.deepEqual(seen, ['sess-getter', 'sess-att'])
  })

  it('explicit io.sessionId overrides the host read ports (new-session resolution)', () => {
    const seen = []
    const result = attachInspirationToCurrentSession(ROW, {
      window: makeWindow({ snapshotSessionId: 'sess-current' }),
      sessionId: 'sess-new',
      addAttachment(sessionId) { seen.push(sessionId); return { ok: true } },
    })
    assert.equal(result.ok, true)
    assert.equal(result.sessionId, 'sess-new')
    assert.deepEqual(seen, ['sess-new'])
  })

  it('fails explicitly when no session can be resolved', () => {
    const result = attachInspirationToCurrentSession(ROW, {
      window: makeWindow({ snapshotSessionId: null, getterSessionId: null, attachmentSessionId: '' }),
      addAttachment() { throw new Error('must not be called') },
    })
    assert.deepEqual(result, { ok: false, error: 'noSession' })
  })

  it('treats duplicate as success and quota as attachFull', () => {
    const duplicate = attachInspirationToCurrentSession(ROW, {
      window: makeWindow({ snapshotSessionId: 's' }),
      addAttachment() { return { ok: false, reason: 'duplicate' } },
    })
    assert.deepEqual(duplicate, { ok: true, sessionId: 's', duplicate: true })
    const quota = attachInspirationToCurrentSession(ROW, {
      window: makeWindow({ snapshotSessionId: 's' }),
      addAttachment() { return { ok: false, reason: 'quota-exceeded' } },
    })
    assert.deepEqual(quota, { ok: false, error: 'attachFull' })
  })

  it('rejects host sentinel session ids instead of attaching to default', () => {
    const result = attachInspirationToCurrentSession(ROW, {
      window: makeWindow({ snapshotSessionId: null, getterSessionId: 'default', attachmentSessionId: null }),
      addAttachment() { throw new Error('must not be called') },
    })
    assert.deepEqual(result, { ok: false, error: 'noSession' })
  })
})
