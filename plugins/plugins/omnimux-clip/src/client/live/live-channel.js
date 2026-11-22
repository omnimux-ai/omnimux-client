import { isClipRevision, isClipToken } from '../../errors.js'
import { CANVAS_TAB, STUDIO_TAB, assertProjectId } from './editor-session.js'
import { LiveClipError, liveError, requestClip } from './persistence.js'

const HEARTBEAT_MS = 2000
const RECEIPT_AGE_MS = 10 * 60_000
const TERMINAL_RECEIPT_STATES = new Set(['succeeded', 'failed'])
const receiptExpired = (receipt, cutoff = Date.now() - RECEIPT_AGE_MS) => (receipt.deadlineAt ?? receipt.createdAt) <= cutoff
const TOKEN = /^[A-Za-z0-9_:-]{1,180}$/

const bindingMatches = (left, right) => left?.workspaceId === right?.workspaceId
  && left?.nodeId === right?.nodeId && left?.projectId === right?.projectId

export function createLiveChannel({ session, storage, native, execute, window }) {
  const pending = new Map()
  const inFlight = new Set()
  const handlers = new Map()
  let events
  let detachEvents = []
  let detachViewport
  const activeSessionId = () => window.__omnimuxWorkbench?.getCurrentSessionId?.()
  let renewTask = null
  let registeredViewport
  let recoveryKey
  let recovering
  let pulseTimer
  let active = true

  function post(action, body, windowId = events?.getWindowId?.()) {
    if (!events || !windowId) throw new LiveClipError('EDITOR_OFFLINE', 'The Clip editor is disconnected.')
    return requestClip(`/live/${action}`, {
      method: 'POST', body, fetcher: (path, init) => events.windowFetch(path, init, windowId),
      timeout: action === 'receipt' ? 12_000 : undefined,
    })
  }

  function editorReady(owner) {
    return session.owns(owner) && native.isEditorReady() && owner.site.entry.isEditorMounted?.() !== false && !owner.ingesting
  }

  function projection(mode) {
    const owner = session.getOwner()
    if (owner?.site.mode !== mode || !editorReady(owner)) return null
    const clip = {
      ...native.projection(owner.record.revision),
      mode,
      ...owner.site.binding,
      editorInstanceId: owner.site.entry.id,
      revisionEpoch: owner.revisionEpoch,
      ...(isClipToken(storage.writerId) ? { draftWriterId: storage.writerId } : {}),
      ...(owner.conflict ? { conflict: true } : {}),
    }
    return { view: mode === 'canvas' ? { extra: { clip } } : { kind: 'clip', extra: { clip } } }
  }

  async function release(owner) {
    const lease = owner?.lease
    if (!lease) return
    owner.lease = null
    try {
      await post('release', { leaseId: lease.leaseId }, lease.windowId)
    } catch (error) {
      if (!['EDITOR_OFFLINE', 'WINDOW_UNAUTHORIZED', 'LEASE_INVALID'].includes(error.code)) {
        console.warn('[Clip] Could not release the editor lease.', error.code)
      }
    }
  }

  function updateContributors() {
    const wb = window.__omnimuxWorkbench
    const owner = session.getOwner()
    for (const [mode, tabId] of [['canvas', CANVAS_TAB], ['standalone', STUDIO_TAB]]) {
      const previous = handlers.get(mode)
      const wanted = owner?.site.mode === mode && session.owns(owner)
      if (previous && (!wanted || previous.wb !== wb)) {
        previous.detach()
        handlers.delete(mode)
      }
      if (wanted && !handlers.has(mode) && wb?.registerContextContributor) {
        const detach = wb.registerContextContributor(tabId, () => projection(mode), { merge: true })
        handlers.set(mode, { wb, detach })
      }
    }
  }

  function compose(editorInstanceId) {
    const owner = session.getOwner()
    if (!active || owner?.site.entry.id !== editorInstanceId || !editorReady(owner) || owner.conflict) return
    const wb = window.__omnimuxWorkbench
    if (typeof wb?.ensureConversationVisible === 'function') {
      wb.ensureConversationVisible()
    } else {
      wb?.setConversationCollapsed?.(false)
      wb?.setFocus?.('split')
    }
    if (!editorReady(owner) || owner.conflict) return
    updateContributors()
    wb?.attachClipContext?.({ sessionId: owner.site.sessionId, editorInstanceId, signal: owner.token.signal })
  }

  function changed({ immediate = false } = {}) {
    if (!active) return
    if (immediate) {
      clearTimeout(pulseTimer)
      pulseTimer = undefined
      updateContributors()
      if (events?.getWindowId?.()) void events.pushViewport?.()
      void renew()
    } else if (!pulseTimer) {
      pulseTimer = setTimeout(() => {
        pulseTimer = undefined
        updateContributors()
        const owner = session.getOwner()
        if (owner?.record) {
          if (events?.getWindowId?.()) void events.pushViewport?.()
          if (!owner.lease) void renew()
        }
      }, 120)
    }
  }

  function isRegistered(windowId, sessionId) {
    return registeredViewport?.windowInstanceId === windowId && registeredViewport?.sessionId === sessionId
  }

  async function sendReceipt(receipt) {
    const windowId = events?.getWindowId?.()
    if (!active || !windowId || events !== window.__omnimuxHubEvents || receipt.sessionId !== activeSessionId()
      || !isRegistered(windowId, receipt.sessionId) || receipt.delivered || receipt.sending || receiptExpired(receipt)
      || receipt.missingViewport === registeredViewport) return
    const viewport = registeredViewport
    receipt.sending = true
    try {
      const ack = await post('receipt', receipt.body, windowId)
      receipt.delivered = TERMINAL_RECEIPT_STATES.has(ack?.status)
    } catch (error) {
      if (registeredViewport === viewport) {
        if (error.code === 'VIEWPORT_NOT_REGISTERED') registeredViewport = undefined
        if (error.code === 'REQUEST_NOT_FOUND') {
          if (receipt.checkedWindowId === windowId) receipt.missingViewport = viewport
          else {
            // Confirm the session again before concluding that this Host lost the request ledger.
            receipt.checkedWindowId = windowId
            registeredViewport = undefined
          }
        }
      }
      receipt.delivered = error.code === 'REQUEST_EXPIRED'
    } finally {
      delete receipt.sending
    }
    if (!receipt.delivered) return
    if (receipt.durable) {
      try {
        await storage.markReceiptDelivered(receipt.requestId)
      } catch (error) {
        console.warn('[Clip] Could not mark the command receipt as delivered.', error?.name)
      }
    }
    pending.delete(receipt.requestId)
  }

  async function recoverReceipts(windowId, sessionId, stillConnected) {
    const key = JSON.stringify([windowId, sessionId])
    if (recoveryKey === key) return
    const liveRequests = new Set(inFlight)
    recovering = liveRequests
    try {
      const cutoff = Date.now() - RECEIPT_AGE_MS
      const receipts = await storage.recoverReceipts(sessionId, cutoff)
      if (!stillConnected()) return
      // In-flight commands publish their own final outcomes, even if IndexedDB already has a provisional receipt.
      for (const receipt of receipts) {
        if (!receiptExpired(receipt, cutoff) && !liveRequests.has(receipt.requestId) && !pending.has(receipt.requestId)) {
          pending.set(receipt.requestId, receipt)
        }
      }
      recoveryKey = key
    } catch (error) {
      console.warn('[Clip] Could not recover pending command receipts.', error?.name)
    } finally {
      recovering = undefined
    }
  }

  async function receive({ requestId } = {}) {
    if (!active || !TOKEN.test(requestId ?? '') || inFlight.has(requestId)) return
    const owner = session.getOwner()
    const lease = owner?.lease
    if (!lease || !session.owns(owner)) return
    const token = owner.token
    inFlight.add(requestId)
    recovering?.add(requestId)
    let command
    try {
      const previous = pending.get(requestId) ?? await storage.readReceipt(requestId)
      if (previous) {
        if (!previous.delivered && !receiptExpired(previous)) {
          pending.set(requestId, previous)
          await sendReceipt(previous)
        }
        return
      }
      if (!session.owns(owner) || owner.token !== token || owner.lease?.leaseId !== lease.leaseId) return
      const response = await post('claim', { requestId, leaseId: lease.leaseId }, lease.windowId)
      command = response.command
      if (!command) return
      const receipt = {
        requestId, sessionId: owner.site.sessionId, createdAt: Date.now(), deadlineAt: command.deadlineAt,
        durable: command.operation === 'clip_edit', body: { requestId, leaseId: lease.leaseId, receiptToken: command.receiptToken },
      }
      const assertCurrent = () => {
        if (!editorReady(owner) || owner.token !== token || owner.lease?.leaseId !== lease.leaseId
          || events?.getWindowId?.() !== lease.windowId || owner.lease.expiresAt <= Date.now()) {
          throw new LiveClipError('EDITOR_NOT_VISIBLE', 'The original Clip editor is no longer active.')
        }
        if (command.deadlineAt <= Date.now()) throw new LiveClipError('REQUEST_EXPIRED', 'The Clip command deadline has passed.')
        const needsExactRevision = ['clip_edit', 'clip_export'].includes(command.operation)
        if (needsExactRevision || command.operation === 'clip_get') {
          session.capture(owner)
          const currentRevisionEpoch = owner.revisionEpoch ?? 0
          if (owner.conflict || (command.revisionEpoch ?? 0) !== currentRevisionEpoch
            || (needsExactRevision && owner.record.revision !== command.baseRevision)) {
            throw new LiveClipError('REVISION_CONFLICT', 'The timeline version has changed. Read the live editor again.', {
              currentRevision: owner.record.revision, currentRevisionEpoch,
            })
          }
        }
      }
      try {
        if (command.protocolVersion !== 1 || command.requestId !== requestId || command.projectId !== owner.record.project.id
          || command.mode !== owner.site.mode || command.tabInstanceId !== owner.site.tabInstanceId
          || command.editorInstanceId !== owner.site.entry.id || !bindingMatches(command.binding, owner.site.binding)) {
          throw new LiveClipError('AMBIGUOUS_TARGET', 'The command belongs to a different Clip editor.')
        }
        assertCurrent()
        const result = await execute(command, {
          assertCurrent, revision: () => owner.record.revision, signal: token.signal,
        })
        receipt.body.result = { ...result, revision: result?.revision ?? owner.record.revision }
        if (command.operation === 'clip_edit' && result.undoStep) {
          // The draft and provisional receipt share the initial IndexedDB transaction.
          receipt.body.result.persisted = true
          receipt.body.result.synchronized = false
          Object.assign(receipt.body.result, await session.save(owner, receipt))
        }
      } catch (error) {
        delete receipt.body.result
        receipt.body.error = liveError(error)
        if (isClipRevision(error?.details?.currentRevisionEpoch)) {
          receipt.body.error.details.currentRevisionEpoch = error.details.currentRevisionEpoch
        }
      }
      if (receipt.durable) {
        try {
          await storage.saveReceipt(requestId, receipt)
        } catch (error) {
          console.warn('[Clip] Could not persist the command receipt.', error?.name)
        }
      }
      pending.set(requestId, receipt)
      await sendReceipt(receipt)
    } catch (error) {
      if (!['EDITOR_OFFLINE', 'EDITOR_NOT_VISIBLE', 'LEASE_INVALID', 'REQUEST_EXPIRED', 'REVISION_CONFLICT'].includes(error.code)) {
        console.warn('[Clip] Could not receive the editor command.', error.code)
      }
    } finally {
      inFlight.delete(requestId)
    }
  }

  async function open({ requestId, sessionId, view } = {}) {
    const wb = window.__omnimuxWorkbench
    const clip = view?.clip
    if (!TOKEN.test(requestId ?? '') || wb?.getCurrentSessionId?.() !== sessionId
      || window.document.visibilityState === 'hidden' || !['canvas', 'standalone'].includes(clip?.mode)) return
    try {
      assertProjectId(clip.projectId)
      if (clip.mode === 'canvas' && (!clip.workspaceId || !clip.nodeId || view.workspaceId !== clip.workspaceId)) return
      await wb.open({ tabId: clip.mode === 'canvas' ? CANVAS_TAB : STUDIO_TAB, sessionId,
        view: { ...view, clip: { ...clip, requestId } }, preserveLayout: true })
      session.reconcile()
    } catch (error) {
      console.warn('[Clip] Could not navigate to the requested project.', error.code)
    }
  }

  function connect() {
    const candidate = window.__omnimuxHubEvents
    if (candidate === events) return
    for (const stop of detachEvents) stop()
    detachViewport?.()
    events = candidate
    registeredViewport = recoveryKey = undefined
    detachViewport = events?.registerViewportContributor?.('clip', ({ sessionId }) => {
      const binding = session.retainedCanvasBinding(sessionId)
      return binding ? { retainedCanvas: binding } : null
    })
    detachEvents = !events?.subscribe ? [] : [
      events.subscribe('omnimux:clip:command', event => void receive(event.payload)),
      events.subscribe('omnimux:clip:open', event => void open(event.payload)),
      events.subscribe('omnimux:window-ready', () => changed({ immediate: true })),
      events.subscribe('omnimux:viewport-registered', ({ payload }) => {
        if (!payload?.sessionId || payload.windowInstanceId !== events.getWindowId()) return
        registeredViewport = payload
        if (payload.sessionId === activeSessionId()) void renew()
      }),
      events.subscribe('omnimux:disconnected', () => {
        registeredViewport = recoveryKey = undefined
        const owner = session.getOwner()
        if (owner?.lease) owner.lease = null
      }),
    ]
  }

  function renew() {
    if (!active || renewTask) return renewTask
    const run = async () => {
      connect()
      session.reconcile()
      updateContributors()
      const cutoff = Date.now() - RECEIPT_AGE_MS
      for (const [id, receipt] of pending) {
        if (receiptExpired(receipt, cutoff)) pending.delete(id)
      }
      const hub = events
      const windowId = hub?.getWindowId?.()
      const sessionId = activeSessionId()
      if (!windowId || !sessionId || sessionId === 'default') return
      const stillConnected = () => active && window.__omnimuxHubEvents === hub
        && hub.getWindowId() === windowId && activeSessionId() === sessionId
      let viewportRequest
      const registerViewport = () => (viewportRequest ??= (async () => {
        const previous = registeredViewport
        try {
          if (!await hub.pushViewport() || !stillConnected()) return false
          if (!isRegistered(windowId, sessionId)) {
            if (registeredViewport !== previous) return false
            registeredViewport = { windowInstanceId: windowId, sessionId }
          }
          return true
        } catch {
          return false
        }
      })())
      if (!isRegistered(windowId, sessionId) && !await registerViewport()) return
      await recoverReceipts(windowId, sessionId, stillConnected)
      if (!stillConnected()) return
      for (const receipt of pending.values()) void sendReceipt(receipt)
      if (session.needsReconnect?.(sessionId) && await registerViewport()) {
        await session.reconnect(sessionId, stillConnected)
      }
      if (!stillConnected()) return
      const owner = session.getOwner()
      if (!editorReady(owner) || owner.conflict) return
      if (owner.lease?.windowId !== windowId || owner.lease.expiresAt <= Date.now()) owner.lease = null
      const previous = owner.lease
      try {
        if (previous) {
          const lease = await post('renew', {
            leaseId: previous.leaseId, revision: owner.record.revision, revisionEpoch: owner.revisionEpoch,
          }, windowId)
          if (stillConnected() && editorReady(owner) && !owner.conflict && owner.lease === previous) {
            owner.lease = { ...lease, windowId }
          }
          return
        }
        if (!await registerViewport() || !editorReady(owner) || owner.conflict) return
        const lease = await post('lease', {
          mode: owner.site.mode, editorInstanceId: owner.site.entry.id, tabInstanceId: owner.site.tabInstanceId,
          projectId: owner.record.project.id, title: owner.record.project.name, revision: owner.record.revision,
          revisionEpoch: owner.revisionEpoch, ...owner.site.binding,
        }, windowId)
        if (hub.getWindowId() !== windowId || window.__omnimuxHubEvents !== hub) return
        owner.lease = { ...lease, windowId }
        if (!active || session.getOwner() !== owner) await release(owner)
      } catch (error) {
        if (owner.lease === previous) owner.lease = null
        if (!['EDITOR_OFFLINE', 'EDITOR_NOT_VISIBLE', 'WINDOW_UNAUTHORIZED', 'LEASE_INVALID', 'EDITOR_LEASE_CONFLICT'].includes(error.code)) {
          console.warn('[Clip] Could not register the active editor.', error.code)
        }
      }
    }
    renewTask = Promise.resolve().then(run).finally(() => { renewTask = null })
    return renewTask
  }

  const stopContext = native.subscribeContext(() => changed())
  const interval = window.setInterval(() => void renew(), HEARTBEAT_MS)
  return {
    changed, compose, release, renew,
    dispose() {
      active = false
      clearTimeout(pulseTimer)
      window.clearInterval(interval)
      stopContext()
      detachViewport?.()
      for (const stop of detachEvents) stop()
      for (const item of handlers.values()) item.detach()
      handlers.clear()
    },
  }
}
