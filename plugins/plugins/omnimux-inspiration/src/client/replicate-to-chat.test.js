import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildInspirationPayload,
  isReplicateBusy,
  oneClickReplicate,
  resetReplicateLock,
  revealConversationForReplicate,
  runExclusive,
} from './replicate-to-chat.js'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'replicate-to-chat.js'), 'utf8')
const feedSource = readFileSync(join(here, 'use-inspiration-feed.js'), 'utf8')

afterEach(() => {
  resetReplicateLock()
})

const ROW = {
  id: 'insp-1',
  title: '夏日护肤',
  source_url: 'https://tiktok.com/@x/video/1',
  source_platform: 'tiktok',
  type: 'video',
}

function makeIo(overrides = {}) {
  const clicks = []
  const attaches = []
  const prefills = []
  const reveals = []
  const status = []
  const starts = []
  const io = {
    clicks,
    attaches,
    prefills,
    reveals,
    status,
    starts,
    async clickNewSession() {
      clicks.push(1)
      return { ok: true, sessionId: 'sess-new' }
    },
    addAttachment(sessionId, payload) {
      attaches.push({ sessionId, payload })
      return { ok: true }
    },
    async prefillPrompt(request) {
      prefills.push(request.prompt)
      const attachment = request.attach()
      if (attachment?.ok === true) return { ok: true, via: 'prefill' }
      if (attachment?.reason === 'duplicate') return { ok: true, via: 'prefill', duplicate: true }
      if (attachment?.reason === 'quota-exceeded') return { ok: false, error: 'attach-full' }
      return { ok: false, error: 'attach-failed' }
    },
    revealConversation() {
      reveals.push(1)
    },
    startReplication() {
      starts.push(1)
      return { ok: true }
    },
    onStatus(key) {
      status.push(key)
    },
    ...overrides,
  }
  return io
}

describe('replicate-to-chat.js isolation', () => {
  it('does not import workflow global or call project/session APIs', () => {
    assert.doesNotMatch(source, /startReplicationProject/)
    assert.doesNotMatch(source, /waitForWorkflowGlobal/)
    assert.doesNotMatch(source, /runNewProject/)
    assert.doesNotMatch(source, /activateProjectCanvas/)
    assert.doesNotMatch(source, /sessions\.create/)
    assert.doesNotMatch(source, /clipboard/)
    assert.doesNotMatch(source, /from ['"].*workflow-global/)
    assert.doesNotMatch(source, /omnimux-workflow/)
    assert.doesNotMatch(source, /replicateInspirationToChat/)
    assert.doesNotMatch(source, /hasAnySession/)
    assert.doesNotMatch(source, /isBlankSession/)
    assert.doesNotMatch(feedSource, /replicateInspirationToChat/)
    assert.match(feedSource, /oneClickReplicate/)
  })

  it('product red lines: never closes the library tab, never touches the canvas panel, no store fallback (#552)', () => {
    // P-1: the inspiration library tab stays open.
    assert.doesNotMatch(source, /closeTab/)
    // P-3: the canvas panel open/close authority belongs to the user.
    assert.doesNotMatch(source, /closePanel/)
    // The removed close path had a store fallback; it must not come back.
    assert.doesNotMatch(source, /createSidebarStore/)
  })
})

describe('buildInspirationPayload', () => {
  it('uses inspiration kind and metadata id', () => {
    const payload = buildInspirationPayload(ROW)
    assert.equal(payload.sourcePlugin, 'omnimux-inspiration')
    assert.equal(payload.kind, 'inspiration')
    assert.equal(payload.entityId, 'insp-1')
    assert.equal(payload.extension, 'INSPIRATION')
    assert.equal(payload.metadata.inspiration_id, 'insp-1')
    assert.doesNotMatch(JSON.stringify(payload), /"kind":"product"/)
  })
})

describe('revealConversationForReplicate', () => {
  it('calls onDismissModal and reveals the conversation without closing the library tab (#552 P-1)', () => {
    const dismissed = []
    const tabs = []
    const order = []
    revealConversationForReplicate({
      onDismissModal: () => dismissed.push(1),
      window: {
        __omnimuxWorkbench: {
          closeTab(id) { tabs.push(id) },
          setConversationCollapsed(next) { order.push(`collapsed:${next}`) },
          setFocus(mode) { order.push(`focus:${mode}`) },
        },
      },
    })
    assert.deepEqual(dismissed, [1])
    assert.deepEqual(tabs, [])
    assert.deepEqual(order, ['collapsed:false', 'focus:split'])
  })

  it('uncollapses the conversation column with split focus and nothing else', () => {
    const order = []
    revealConversationForReplicate({
      window: {
        __omnimuxWorkbench: {
          setConversationCollapsed(next) { order.push(`collapsed:${next}`) },
          setFocus(mode) { order.push(`focus:${mode}`) },
        },
      },
    })
    assert.deepEqual(order, ['collapsed:false', 'focus:split'])
  })

  it('keeps the right panel open (canvas stays) and reveals split (#552 P-3)', () => {
    const order = []
    revealConversationForReplicate({
      window: {
        __omnimuxWorkbench: {
          closeTab(id) { order.push(`close:${id}`) },
          setConversationCollapsed(next) { order.push(`collapsed:${next}`) },
          closePanel() { order.push('closePanel') },
          setFocus(mode) { order.push(`focus:${mode}`) },
        },
      },
    })
    assert.deepEqual(order, ['collapsed:false', 'focus:split'])
    assert.ok(!order.includes('closePanel'))
    assert.ok(!order.includes('focus:chat'))
    assert.ok(!order.some((entry) => entry.startsWith('close:')))
  })

  it('replay re-asserts reveal only (0ms/50ms, idempotent geometry)', async () => {
    const counts = { collapsed: 0, focus: 0, closedTabs: 0 }
    revealConversationForReplicate({
      window: {
        __omnimuxWorkbench: {
          closeTab() { counts.closedTabs += 1 },
          setConversationCollapsed() { counts.collapsed += 1 },
          setFocus() { counts.focus += 1 },
        },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 80))
    // Initial call + two reveal-only replays = 3 assertions each.
    assert.equal(counts.collapsed, 3)
    assert.equal(counts.focus, 3)
    assert.equal(counts.closedTabs, 0)
  })
})

describe('oneClickReplicate', () => {
  it('never invokes startReplication even when io supplies it', async () => {
    const io = makeIo()
    const result = await oneClickReplicate(ROW, io)
    assert.equal(result.ok, true)
    assert.equal(io.starts.length, 0)
  })

  it('success uses real revealConversationForReplicate: split reveal, library tab stays open (#552)', async () => {
    const order = []
    const win = {
      __omnimuxWorkbench: {
        closeTab(id) { order.push(`close:${id}`) },
        setConversationCollapsed(v) { order.push(`collapsed:${v}`) },
        closePanel() { order.push('closePanel') },
        setFocus(mode) { order.push(`focus:${mode}`) },
      },
    }
    const io = makeIo({ isBlank: () => true, window: win })
    delete io.revealConversation
    const result = await oneClickReplicate(ROW, io)
    assert.equal(result.ok, true)
    assert.ok(!order.some((entry) => entry.startsWith('close:')))
    assert.ok(!order.includes('closePanel'))
    assert.ok(order.includes('collapsed:false'))
    assert.ok(order.includes('focus:split'))
  })

  it('reveals conversation before prefill so a hidden composer can become visible (#528)', async () => {
    const order = []
    const io = makeIo({
      isBlank: () => true,
      revealConversation() {
        order.push('reveal')
        io.reveals.push(1)
      },
      async prefillPrompt(text) {
        order.push('prefill')
        io.prefills.push(text)
        return { ok: true, via: 'prefill' }
      },
    })
    const result = await oneClickReplicate(ROW, io)
    assert.equal(result.ok, true)
    assert.deepEqual(order, ['reveal', 'prefill'])
  })

  it('blank session clicks official new session once, then attaches and prefills the returned id', async () => {
    const io = makeIo()
    const result = await oneClickReplicate(ROW, io)
    assert.equal(result.ok, true)
    assert.equal(result.clickedNewSession, true)
    assert.equal(result.attached, true)
    assert.equal(io.clicks.length, 1)
    assert.equal(io.attaches.length, 1)
    assert.equal(io.attaches[0].sessionId, 'sess-new')
    assert.equal(io.reveals.length, 1)
    assert.equal(io.prefills.length, 1)
    assert.match(io.prefills[0], /^\/video-deconstruct\n/)
    assert.match(io.prefills[0], /完全复刻原视频脚本和画面/)
    assert.doesNotMatch(io.prefills[0], /inspiration_id/)
    assert.equal(io.attaches[0].payload.metadata.inspiration_id, 'insp-1')
    assert.equal(io.attaches[0].payload.entityId, 'insp-1')
    assert.equal(io.status.at(-1), null)
  })

  it('non-blank session also clicks official new session then attaches, reveals, and prefills', async () => {
    const io = makeIo()
    const result = await oneClickReplicate(ROW, io)
    assert.equal(result.ok, true)
    assert.equal(result.clickedNewSession, true)
    assert.equal(io.clicks.length, 1)
    assert.equal(io.attaches.length, 1)
    assert.equal(io.attaches[0].sessionId, 'sess-new')
    assert.equal(io.reveals.length, 1)
    assert.equal(io.prefills.length, 1)
  })

  it('action-dispatched but unresolved reveals the column and performs zero writes', async () => {
    const order = []
    let resolveOfficial
    const pendingOfficial = new Promise((resolve) => { resolveOfficial = resolve })
    const io = makeIo({
      clickNewSession() {
        io.clicks.push(1)
        return pendingOfficial
      },
      revealConversation() {
        order.push('reveal')
        io.reveals.push(1)
      },
    })
    const work = oneClickReplicate(ROW, io)
    await Promise.resolve()
    assert.deepEqual(order, ['reveal'])
    assert.equal(io.attaches.length, 0)
    assert.equal(io.prefills.length, 0)
    resolveOfficial({ ok: false, error: 'newSessionFailed' })
    const result = await work
    assert.deepEqual(result, { ok: false, error: 'newSessionFailed' })
    assert.equal(io.attaches.length, 0)
    assert.equal(io.prefills.length, 0)
    assert.equal(io.status.at(-1), 'card.cta.newSessionFailed')
  })

  it('new-session failure never attaches to the prior session', async () => {
    const io = makeIo({
      async clickNewSession() {
        return { ok: false, error: 'newSessionFailed' }
      },
    })
    const result = await oneClickReplicate(ROW, io)
    assert.deepEqual(result, { ok: false, error: 'newSessionFailed' })
    assert.equal(io.reveals.length, 1)
    assert.equal(io.attaches.length, 0)
    assert.equal(io.prefills.length, 0)
    assert.equal(io.status.at(-1), 'card.cta.newSessionFailed')
  })

  it('does not attach when the official action returns no new session id', async () => {
    const io = makeIo({
      async clickNewSession() {
        io.clicks.push(1)
        return { ok: true }
      },
    })
    const result = await oneClickReplicate(ROW, io)
    assert.deepEqual(result, { ok: false, error: 'newSessionFailed' })
    assert.equal(io.clicks.length, 1)
    assert.equal(io.attaches.length, 0)
    assert.equal(io.reveals.length, 1)
    assert.equal(io.prefills.length, 0)
    assert.equal(io.status.at(-1), 'card.cta.newSessionFailed')
  })

  it('uses a blank-reused official target explicitly for attachment and prompt', async () => {
    const io = makeIo({
      async clickNewSession() {
        io.clicks.push(1)
        return { ok: true, sessionId: 'sess-blank-reused', reusedBlank: true }
      },
    })
    const result = await oneClickReplicate(ROW, io)
    assert.equal(result.ok, true)
    assert.equal(io.attaches.length, 1)
    assert.equal(io.attaches[0].sessionId, 'sess-blank-reused')
    assert.equal(io.prefills.length, 1)
    assert.match(io.prefills[0], /^\/video-deconstruct\n\n/)
  })

  it('draft-protected target performs zero attachment writes and exposes the protected state', async () => {
    const io = makeIo({
      async prefillPrompt() {
        io.prefills.push('attempt')
        return { ok: false, error: 'draft-protected' }
      },
    })
    const result = await oneClickReplicate(ROW, io)
    assert.deepEqual(result, { ok: false, error: 'draftProtected' })
    assert.equal(io.attaches.length, 0)
    assert.deepEqual(io.status.at(-1), 'card.cta.draftProtected')
  })

  it('fails explicitly when the official attachment store is unavailable', async () => {
    const events = []
    const win = {
      CustomEvent: class CustomEvent {
        constructor(type, init) {
          this.type = type
          this.detail = init.detail
        }
      },
      dispatchEvent(event) {
        events.push(event)
        return true
      },
    }
    const io = makeIo({ window: win })
    delete io.addAttachment
    const result = await oneClickReplicate(ROW, io)
    assert.deepEqual(result, { ok: false, error: 'attachFailed' })
    assert.deepEqual(events, [])
  })

  it('second concurrent click returns busy and does not queue', async () => {
    let releaseFirst
    const firstGate = new Promise((resolve) => { releaseFirst = resolve })
    const io1 = makeIo({
      async prefillPrompt(text) {
        io1.prefills.push(text)
        await firstGate
        return { ok: true, via: 'prefill' }
      },
    })
    const first = oneClickReplicate(ROW, io1)
    assert.equal(isReplicateBusy(), true)
    const io2 = makeIo()
    const second = await oneClickReplicate({ ...ROW, id: 'insp-2' }, io2)
    assert.deepEqual(second, { ok: false, error: 'busy' })
    assert.deepEqual(io2.status, ['card.cta.busy'])
    assert.equal(io2.attaches.length, 0)
    releaseFirst()
    const firstResult = await first
    assert.equal(firstResult.ok, true)
    assert.equal(isReplicateBusy(), false)
  })

  it('duplicate is treated as attached and continues to reveal+prefill', async () => {
    const io = makeIo({
      addAttachment(sessionId, payload) {
        io.attaches.push({ sessionId, payload })
        return { ok: false, reason: 'duplicate' }
      },
    })
    const result = await oneClickReplicate(ROW, io)
    assert.equal(result.ok, true)
    assert.equal(result.duplicate, true)
    assert.equal(result.attached, true)
    assert.equal(io.reveals.length, 1)
    assert.equal(io.prefills.length, 1)
  })

  it('quota-exceeded returns attachFull after one safe prefill', async () => {
    const io = makeIo({
      addAttachment(sessionId, payload) {
        io.attaches.push({ sessionId, payload })
        return { ok: false, reason: 'quota-exceeded' }
      },
    })
    const result = await oneClickReplicate(ROW, io)
    assert.deepEqual(result, { ok: false, error: 'attachFull' })
    assert.equal(io.reveals.length, 1)
    assert.equal(io.prefills.length, 1)
    assert.equal(io.status.at(-1), 'card.cta.attachFull')
  })

  it('prefill failure still reveals the conversation and never closes the library (#528)', async () => {
    let sendClicks = 0
    const closedTabs = []
    const win = {
      __omnimuxWorkbench: {
        closeTab(id) { closedTabs.push(id) },
      },
    }
    const io = makeIo({
      window: win,
      async prefillPrompt() {
        return { ok: false, error: 'composer-missing' }
      },
      findSendButton() {
        return { click() { sendClicks += 1 } }
      },
    })
    const result = await oneClickReplicate(ROW, io)
    assert.equal(result.ok, false)
    assert.equal(result.error, 'sendManual')
    assert.equal(io.status.at(-1), 'card.cta.sendManual')
    assert.equal(sendClicks, 0)
    assert.equal(io.reveals.length, 1)
    assert.equal(io.attaches.length, 0)
    assert.deepEqual(closedTabs, [])
  })

  it('runExclusive does not queue: two concurrent calls invoke the worker once', async () => {
    let release
    const hanging = new Promise((resolve) => { release = resolve })
    let runCount = 0
    const first = runExclusive(async () => {
      runCount += 1
      await hanging
      return { ok: true, n: runCount }
    })
    const second = await runExclusive(async () => {
      runCount += 1
      return { ok: true, n: runCount }
    })
    assert.deepEqual(second, { ok: false, error: 'busy' })
    assert.equal(runCount, 1)
    release()
    const settled = await first
    assert.deepEqual(settled, { ok: true, n: 1 })
    assert.equal(isReplicateBusy(), false)
  })
})
