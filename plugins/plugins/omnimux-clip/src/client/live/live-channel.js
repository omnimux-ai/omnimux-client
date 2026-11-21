import { CANVAS_TAB, STUDIO_TAB, assertProjectId } from './editor-session.js'
import { LiveClipError, liveError, requestClip } from './persistence.js'

const HEARTBEAT_MS = 2000
const RECEIPT_AGE_MS = 10 * 60_000
const TERMINAL_RECEIPT_ERRORS = new Set(['REQUEST_NOT_FOUND', 'REQUEST_EXPIRED', 'REQUEST_ID_CONFLICT', 'INVALID_RECEIPT'])
const TOKEN = /^[A-Za-z0-9_:-]{1,180}$/

const bindingMatches = (left, right) => left?.workspaceId === right?.workspaceId
  && left?.nodeId === right?.nodeId && left?.projectId === right?.projectId

export function createLiveChannel({ session, storage, native, execute, window }) {
  const pending = new Map()
  const inFlight = new Set()
  const handlers = new Map()
  let events
  let detachEvents = []
  let renewTask = null
  let recoveryKey
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

  function changed({ immediate = false } = {}) {
    if (!active) return
    if (immediate) {
      clearTimeout(pulseTimer)
      pulseTimer = undefined
      updateContributors()
      void events?.pushViewport?.()
      void renew()
    } else if (!pulseTimer) {
      pulseTimer = setTimeout(() => {
        pulseTimer = undefined
        updateContributors()
        const owner = session.getOwner()
        if (owner?.record) {
          void events?.pushViewport?.()
          if (!owner.lease) void renew()
        }
      }, 120)
    }
  }

  async function sendReceipt(receipt) {
    if (!active || receipt.sessionId !== window.__omnimuxWorkbench?.getCurrentSessionId?.()) return
    if (receipt.createdAt + RECEIPT_AGE_MS < Date.now()) {
      pending.delete(receipt.requestId)
      return
    }
    if (receipt.sending) return
    receipt.sending = true
    try {
      await post('receipt', receipt.body)
      receipt.delivered = true
    } catch (error) {
      if (TERMINAL_RECEIPT_ERRORS.has(error.code)) receipt.delivered = true
    } finally {
      delete receipt.sending
    }
    if (!receipt.delivered) return
    pending.delete(receipt.requestId)
    if (receipt.durable) {
      try {
        await storage.markReceiptDelivered(receipt.requestId)
      } catch (error) {
        console.warn('[Clip] Could not mark the command receipt as delivered.', error?.name)
      }
    }
  }

  async function recoverReceipts(windowId) {
    const sessionId = window.__omnimuxWorkbench?.getCurrentSessionId?.()
    if (!sessionId || sessionId === 'default') return
    const key = JSON.stringify([windowId, sessionId])
    if (recoveryKey === key) return
    try {
      const viewport = await events.pushViewport()
      if (!viewport || events.getWindowId() !== windowId || window.__omnimuxWorkbench?.getCurrentSessionId?.() !== sessionId) return
      const receipts = await storage.recoverReceipts(sessionId, Date.now() - RECEIPT_AGE_MS)
      if (!active) return
      for (const receipt of receipts) {
        if (!pending.has(receipt.requestId)) pending.set(receipt.requestId, receipt)
      }
      recoveryKey = key
    } catch (error) {
      console.warn('[Clip] Could not recover pending command receipts.', error?.name)
    }
  }

  async function receive({ requestId } = {}) {
    if (!active || !TOKEN.test(requestId ?? '') || inFlight.has(requestId)) return
    const owner = session.getOwner()
    const lease = owner?.lease
    if (!lease || !session.owns(owner)) return
    inFlight.add(requestId)
    let command
    try {
      const previous = pending.get(requestId) ?? await storage.readReceipt(requestId)
      if (previous) {
        pending.set(requestId, previous)
        await sendReceipt(previous)
        return
      }
      if (!session.owns(owner) || owner.lease?.leaseId !== lease.leaseId) return
      const response = await post('claim', { requestId, leaseId: lease.leaseId }, lease.windowId)
      command = response.command
      if (!command) return
      const receipt = {
        requestId, sessionId: owner.site.sessionId, createdAt: Date.now(), durable: command.operation === 'clip_edit',
        body: { requestId, leaseId: lease.leaseId, receiptToken: command.receiptToken },
      }
      const assertCurrent = () => {
        if (!editorReady(owner) || owner.lease?.leaseId !== lease.leaseId
          || events?.getWindowId?.() !== lease.windowId || owner.lease.expiresAt <= Date.now()) {
          throw new LiveClipError('EDITOR_NOT_VISIBLE', 'The original Clip editor is no longer active.')
        }
        if (command.deadlineAt <= Date.now()) throw new LiveClipError('REQUEST_EXPIRED', 'The Clip command deadline has passed.')
        if (['clip_edit', 'clip_export'].includes(command.operation)) {
          session.capture(owner)
          if (owner.record.revision !== command.baseRevision || owner.conflict) {
            throw new LiveClipError('REVISION_CONFLICT', 'The timeline version has advanced or needs conflict resolution.', {
              currentRevision: owner.record.revision,
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
          assertCurrent, revision: () => owner.record.revision, signal: owner.token.signal,
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
    events = candidate
    detachEvents = !events?.subscribe ? [] : [
      events.subscribe('omnimux:clip:command', event => void receive(event.payload)),
      events.subscribe('omnimux:clip:open', event => void open(event.payload)),
      events.subscribe('omnimux:window-ready', () => {
        session.reconnect()
        changed({ immediate: true })
      }),
      events.subscribe('omnimux:disconnected', () => {
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
      const windowId = events?.getWindowId?.()
      if (!windowId) return
      await recoverReceipts(windowId)
      if (!active || events?.getWindowId?.() !== windowId) return
      for (const receipt of pending.values()) {
        if (receipt.createdAt + RECEIPT_AGE_MS < Date.now()) pending.delete(receipt.requestId)
        else void sendReceipt(receipt)
      }
      const owner = session.getOwner()
      if (!editorReady(owner)) return
      if (owner.conflict) {
        await release(owner)
        return
      }
      if (owner.lease?.windowId !== windowId) owner.lease = null
      try {
        if (owner.lease) {
          const lease = await post('renew', { leaseId: owner.lease.leaseId, revision: owner.record.revision }, windowId)
          if (session.owns(owner)) owner.lease = { ...lease, windowId }
          return
        }
        await events.pushViewport()
        if (!session.owns(owner) || events.getWindowId() !== windowId) return
        const lease = await post('lease', {
          mode: owner.site.mode, editorInstanceId: owner.site.entry.id, tabInstanceId: owner.site.tabInstanceId,
          projectId: owner.record.project.id, title: owner.record.project.name, revision: owner.record.revision,
          ...owner.site.binding,
        }, windowId)
        owner.lease = { ...lease, windowId }
        if (!session.owns(owner)) await release(owner)
      } catch (error) {
        owner.lease = null
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
    changed, release, renew,
    dispose() {
      active = false
      clearTimeout(pulseTimer)
      window.clearInterval(interval)
      stopContext()
      for (const stop of detachEvents) stop()
      for (const item of handlers.values()) item.detach()
      handlers.clear()
    },
  }
}
