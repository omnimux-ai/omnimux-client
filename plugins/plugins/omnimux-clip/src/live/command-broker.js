import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { ClipDomainError, clipErrorValue, isClipRevision, isClipToken, safeClipLabel } from '../errors.js'
import { assertProjectId } from '../paths.js'

const TAB_IDS = { canvas: 'omnimux-workflow:canvas', standalone: 'omnimux-clip:studio' }
const CLAIM_TTL_MS = 8000
const RESULT_TTL_MS = 10 * 60_000

export function readCanvasBinding(projectId, value) {
  const { workspaceId, nodeId } = value ?? {}
  if (value?.projectId !== projectId || typeof workspaceId !== 'string' || !/^ws_[A-Za-z0-9_-]{1,128}$/.test(workspaceId)
    || typeof nodeId !== 'string' || !/^[^\s/\\\x00-\x1f\x7f]{1,256}$/.test(nodeId)) {
    throw new ClipDomainError('invalid-clip-binding', 'A matching project, canvas workspace and composition node are required.')
  }
  return { workspaceId, nodeId, projectId: assertProjectId(projectId) }
}

export function sameBinding(a, b) {
  if (!a || !b) return !a && !b
  return a.projectId === b.projectId && a.workspaceId === b.workspaceId && a.nodeId === b.nodeId
}

export function resolveWorkflowBinding(workflow, binding, sessionId) {
  if (typeof workflow?.resolveBinding !== 'function') {
    throw new ClipDomainError('needs-workflow-clip', 'The canvas Clip service is unavailable.')
  }
  let resolved
  try {
    resolved = workflow.resolveBinding(binding, sessionId)
  } catch (error) {
    if (error?.code === 'outside-project-boundary') {
      throw new ClipDomainError(error.code, 'The canvas is outside this conversation’s project.')
    }
    throw new ClipDomainError('clip-binding-mismatch', 'The Clip project no longer matches this composition node.')
  }
  if (!sameBinding(binding, resolved)) {
    throw new ClipDomainError('clip-binding-mismatch', 'The Clip project no longer matches this composition node.')
  }
  return resolved
}

function assertWindow(window) {
  if (!window?.isAlive?.() || !isClipToken(window.windowInstanceId)) {
    throw new ClipDomainError('WINDOW_UNAUTHORIZED', 'An authenticated Clip window is required.')
  }
}

function viewportDraftWriter(viewport) {
  const writerId = viewport?.view?.extra?.clip?.draftWriterId
  return isClipToken(writerId) ? writerId : undefined
}

function viewportMatches(viewport, target) {
  const clip = viewport?.view?.extra?.clip
  const surface = viewport?.surface
  return viewport?.sessionId === target.sessionId
    && viewport.ok === true
    && surface?.panelOpen === true
    && surface.tabId === TAB_IDS[target.mode]
    && surface.instanceId === target.tabInstanceId
    && clip?.visible !== false
    && clip?.conflict !== true
    && clip?.mode === target.mode
    && clip.projectId === target.projectId
    && clip.editorInstanceId === target.editorInstanceId
    && viewportDraftWriter(viewport) === target.draftWriterId
    && (target.mode === 'standalone'
      || (viewport.view.extra.workspaceId === target.binding.workspaceId && sameBinding(clip, target.binding)))
}

function validRevisionEpoch(epoch) {
  return epoch === undefined || isClipRevision(epoch)
}

function revisionConflict(lease) {
  return ClipDomainError.revisionConflict(lease.revision,
    'The Clip version changed or has not been read. Read the target editor with clip_get before continuing.', lease.revisionEpoch ?? 0)
}

function editorKey(lease) {
  return JSON.stringify([lease.sessionId, lease.projectId, lease.tabInstanceId, lease.editorInstanceId, lease.draftWriterId])
}

function observeViewportRevision(lease, viewport) {
  const { revision, revisionEpoch } = viewport.view.extra.clip
  if (!isClipRevision(revision) || !validRevisionEpoch(revisionEpoch)) return
  if (lease.revisionEpoch !== undefined && (revisionEpoch === undefined || revisionEpoch < lease.revisionEpoch)) return

  // A Host adoption resets the revision sequence for the same editor. Older
  // clients have no epoch; a decrease between accepted viewports is their reset.
  if (lease.revisionEpoch !== revisionEpoch || (revisionEpoch === undefined && revision < lease.viewportRevision)) {
    lease.revisionEpoch = revisionEpoch
    lease.revision = revision
    lease.revisionResets += 1
  } else {
    lease.revision = Math.max(lease.revision, revision)
  }
  lease.viewportRevision = revision
}

function matchesSelector(lease, selector) {
  return (!selector.projectId || lease.projectId === selector.projectId)
    && (!selector.mode || lease.mode === selector.mode)
    && (!selector.binding || sameBinding(lease.binding, selector.binding))
}

function candidate(lease, visible) {
  return { ...lease.binding, projectId: lease.projectId, title: lease.title,
    mode: lease.mode, windowInstanceId: lease.window.windowInstanceId, visible }
}

function fingerprint(value) {
  const text = JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
  })
  return createHash('sha256').update(text).digest('hex')
}

function requestError(code, message, requestId, details) {
  return new ClipDomainError(code, message, { ...details, requestId })
}

function fromEditor(error, requestId) {
  if (!isClipToken(error?.code)) {
    throw requestError('INVALID_RECEIPT', 'The Clip error receipt needs a domain error code.', requestId)
  }
  return requestError(error.code, safeClipLabel(error.message, 'The editor rejected this Clip command.'), requestId, error.details ?? error.detail)
}

/** A command notification belongs to one authenticated socket and can be claimed once. */
export function createClipCommandBroker({
  getHubEvents, getWorkflowClip, now = Date.now, leaseTtlMs = 6500, pollMs = 100,
} = {}) {
  const leases = new Map()
  const observations = new WeakMap()
  const ledger = new Map()
  const active = new Set()
  const completed = new Set()
  let timer = null
  let disposed = false

  function liveError(lease) {
    const viewport = lease.window.isAlive() ? lease.window.getViewport() : null
    if (!viewport) {
      lease.invalidated = true
      return new ClipDomainError('EDITOR_OFFLINE', 'The Clip window is offline.')
    }
    if (leases.get(lease.window.windowInstanceId) !== lease || lease.expiresAt <= now()) {
      return new ClipDomainError('LEASE_INVALID', 'The Clip editor lease expired or was released.')
    }
    if (!viewportMatches(viewport, lease)) {
      lease.invalidated = true
      return new ClipDomainError('EDITOR_NOT_VISIBLE', 'The target Clip editor is no longer available in this conversation.')
    }
    if (lease.invalidated) return new ClipDomainError('LEASE_INVALID', 'Register a new lease for this Clip editor.')
    observeViewportRevision(lease, viewport)
    return null
  }

  function sweep() {
    for (const [windowId, lease] of leases) {
      if (lease.expiresAt <= now() || !lease.window.isAlive()) leases.delete(windowId)
    }
    for (const record of completed) {
      if (record.finishedAt + RESULT_TTL_MS > now()) break
      completed.delete(record)
      // Retain only the identity so an old request ID cannot dispatch again.
      ledger.set(record.id, { sessionId: record.sessionId, hash: record.hash, expired: true })
    }
  }

  function lease(window, body) {
    assertWindow(window)
    sweep()
    const viewport = window.getViewport()
    const binding = body?.mode === 'canvas' ? readCanvasBinding(body.projectId, body) : undefined
    if (!Object.hasOwn(TAB_IDS, body?.mode) || !isClipToken(body?.editorInstanceId)
      || !isClipToken(body.tabInstanceId) || !isClipRevision(body.revision) || !validRevisionEpoch(body.revisionEpoch)
      || (body.mode === 'standalone' && (body.workspaceId !== undefined || body.nodeId !== undefined))) {
      throw ClipDomainError.invalidJson('A Clip mode, native tab instance, editor instance and revision are required.')
    }
    const projectId = assertProjectId(body.projectId)
    const target = {
      window, projectId, binding, mode: body.mode, sessionId: viewport?.sessionId,
      editorInstanceId: body.editorInstanceId, tabInstanceId: body.tabInstanceId, draftWriterId: viewportDraftWriter(viewport),
    }
    if (disposed || !target.sessionId || !viewportMatches(viewport, target)) {
      throw new ClipDomainError('EDITOR_NOT_VISIBLE', 'The Clip editor does not match the visible native tab and project.')
    }
    const resolved = binding && resolveWorkflowBinding(getWorkflowClip?.(), binding, target.sessionId)
    const previous = leases.get(window.windowInstanceId)
    if (previous && !liveError(previous)) {
      if (previous.editorInstanceId !== target.editorInstanceId) {
        throw new ClipDomainError('EDITOR_LEASE_CONFLICT', 'Release the existing editor lease before activating another editor in this window.')
      }
      return renew(window, { leaseId: previous.id, revision: body.revision, revisionEpoch: body.revisionEpoch })
    }
    const current = { ...target, id: randomUUID(), title: safeClipLabel(resolved?.title ?? body.title, projectId),
      revision: body.revision, revisionResets: 0, expiresAt: now() + leaseTtlMs }
    observeViewportRevision(current, viewport)
    if (current.revisionEpoch === body.revisionEpoch) current.revision = Math.max(current.revision, body.revision)
    leases.set(window.windowInstanceId, current)
    return leaseValue(current)
  }

  function leaseValue(current) {
    return { leaseId: current.id, revision: current.revision, expiresAt: current.expiresAt }
  }

  function renew(window, body) {
    assertWindow(window)
    const current = leases.get(window.windowInstanceId)
    if (current?.window !== window || current.id !== body?.leaseId) {
      throw new ClipDomainError('LEASE_INVALID', 'The window has no matching Clip lease.')
    }
    if (!isClipRevision(body.revision) || !validRevisionEpoch(body.revisionEpoch)) {
      throw ClipDomainError.invalidJson('The revision and optional revision epoch must be nonnegative safe integers.')
    }
    const error = liveError(current)
    if (error) throw error
    if (current.binding) resolveWorkflowBinding(getWorkflowClip?.(), current.binding, current.sessionId)
    if (current.revisionEpoch === body.revisionEpoch) current.revision = Math.max(current.revision, body.revision)
    current.expiresAt = now() + leaseTtlMs
    return leaseValue(current)
  }

  function release(window, body) {
    assertWindow(window)
    if (!isClipToken(body?.leaseId)) throw ClipDomainError.invalidJson('leaseId is required.')
    const current = leases.get(window.windowInstanceId)
    if (current?.window !== window || current.id !== body.leaseId) return { released: false }
    leases.delete(window.windowInstanceId)
    return { released: true }
  }

  function scope(sessionId, selector) {
    const windows = (getHubEvents?.()?.getWindows?.(sessionId) ?? []).filter((window) =>
      window.isAlive() && window.getViewport()?.sessionId === sessionId)
    const scoped = selector.windowInstanceId ? windows.filter((window) => window.windowInstanceId === selector.windowInstanceId) : windows
    const held = scoped.flatMap((window) => {
      const lease = leases.get(window.windowInstanceId)
      return lease?.window === window && lease.sessionId === sessionId ? [lease] : []
    })
    const visible = held.filter((lease) => !liveError(lease))
    return { sessionId, scoped, held, visible, matching: visible.filter((lease) => matchesSelector(lease, selector)) }
  }

  function retainedCandidate(window, sessionId) {
    const viewport = window.getViewport()
    const hint = viewport?.viewportDetails?.clip?.retainedCanvas
    if (!hint || viewport.sessionId !== sessionId || viewport.ok !== true) return null
    try {
      const binding = readCanvasBinding(hint.projectId, hint)
      const resolved = resolveWorkflowBinding(getWorkflowClip?.(), binding, sessionId)
      return candidate({ window, binding, mode: 'canvas', projectId: binding.projectId,
        title: safeClipLabel(resolved.title, binding.projectId) }, false)
    } catch (error) {
      if (!(error instanceof ClipDomainError)) throw error
      return null
    }
  }

  function ambiguous({ sessionId, scoped, held, visible }) {
    const candidates = held.map((lease) => candidate(lease, visible.includes(lease)))
    for (const window of scoped) {
      const hidden = retainedCandidate(window, sessionId)
      if (hidden && !candidates.some(item => item.windowInstanceId === hidden.windowInstanceId && sameBinding(item, hidden))) {
        candidates.push(hidden)
      }
    }
    return new ClipDomainError('AMBIGUOUS_TARGET', 'Choose a Clip project and, if needed, its window.', {
      candidates,
      windows: scoped.map((window) => window.windowInstanceId),
    })
  }

  function select(context, selector, savedFallback) {
    const { scoped, matching, visible } = context
    if (matching.length === 1) return matching[0]
    if (matching.length > 1) throw ambiguous(context)
    if (savedFallback && selector.projectId && !selector.windowInstanceId) return null
    if (!scoped.length) throw new ClipDomainError('EDITOR_OFFLINE', 'No authenticated Clip window is connected to this conversation.')
    if (visible.length) throw ambiguous(context)
    throw new ClipDomainError('EDITOR_NOT_VISIBLE', 'Open the target Clip editor to run this command.')
  }

  function settle(record, state, { result, error } = {}) {
    active.delete(record)
    completed.delete(record)
    record.state = state
    record.result = result
    record.error = error
    record.finishedAt = now()
    completed.add(record)
    record.resolve()
    if (!active.size && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  function expire(record, cause) {
    const requestId = record.id
    if (record.state === 'claimed') {
      settle(record, 'unknown', { error: requestError('outcome-unknown',
        'The editor claimed this command, but the Host could not confirm its result. Check again with the same request ID.',
        requestId, { reason: cause.code, exportJobId: record.command?.exportJobId }) })
    } else {
      settle(record, 'failed', { error: requestError(cause.code, cause.message, requestId, cause.details) })
    }
  }

  function checkExport(record) {
    if (!['claimed', 'unknown'].includes(record.state) || !record.observe || !record.command.exportJobId) return false
    try {
      const result = record.observe(record.command)
      if (result == null) return false
      settle(record, 'succeeded', { result })
    } catch (error) {
      settle(record, 'failed', { error })
    }
    return true
  }

  function refresh(record) {
    if (checkExport(record) || !active.has(record)) return
    const time = now()
    if (time >= record.deadlineAt || (record.state !== 'claimed' && time >= record.claimDeadline)) {
      const cause = record.state === 'opening'
        ? new ClipDomainError('EDITOR_NOT_VISIBLE', 'The window did not activate the requested Clip project in time.')
        : new ClipDomainError('REQUEST_EXPIRED', 'The Clip command deadline passed.')
      expire(record, cause)
      return
    }
    if (record.state === 'opening') {
      if (!record.window.isAlive() || !record.window.getViewport()) {
        expire(record, new ClipDomainError('EDITOR_OFFLINE', 'The Clip window disconnected during navigation.'))
        return
      }
      if (record.window.getViewport().sessionId !== record.sessionId) {
        expire(record, new ClipDomainError('EDITOR_NOT_VISIBLE', 'The Clip window switched to another conversation.'))
        return
      }
      const current = leases.get(record.window.windowInstanceId)
      if (current?.window === record.window && !liveError(current) && matchesSelector(current, record.target)) {
        settle(record, 'succeeded', { result: openValue(record, current) })
      }
      return
    }
    // Once claimed, a versioned export can finish through its independent upload proof.
    if (record.state === 'claimed' && record.observe) return
    const error = liveError(record.lease)
    if (error) expire(record, error)
  }

  function monitor(record) {
    active.add(record)
    timer ??= setInterval(() => {
      for (const attempt of active) refresh(attempt)
      sweep()
    }, pollMs)
  }

  function findExisting(id, sessionId, hash) {
    const previous = ledger.get(id)
    if (!previous) return null
    if (previous.sessionId !== sessionId) throw new ClipDomainError('REQUEST_NOT_FOUND', 'No Clip request in this conversation has that ID.')
    if (previous.hash !== hash) throw requestError('REQUEST_ID_CONFLICT', 'This request ID already identifies different parameters or a different target.', id)
    if (previous.expired) throw requestError('REQUEST_EXPIRED', 'The original Clip result expired. The request was not reissued.', id)
    if (previous.state === 'unknown') checkExport(previous)
    return previous
  }

  function requestIdentity(options) {
    if (disposed) throw new ClipDomainError('EDITOR_OFFLINE', 'The Clip Host stopped.')
    if (options.signal?.aborted) throw options.signal.reason
    if (typeof options.sessionId !== 'string' || !options.sessionId || options.sessionId === 'default') {
      throw new ClipDomainError('SESSION_REQUIRED', 'This Clip operation requires a trusted tool conversation.')
    }
    sweep()
    const id = options.requestId ?? randomUUID()
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_:-]{0,127}$/.test(id)) {
      throw ClipDomainError.invalidJson('requestId is not a valid Clip request ID.')
    }
    const hash = fingerprint([options.operation, options.selector, options.args, options.baseRevision, options.baseRevisionEpoch])
    return { id, hash, previous: findExisting(id, options.sessionId, hash) }
  }

  function recordFor(options, id, hash, state) {
    let resolve
    const done = new Promise((finish) => { resolve = finish })
    const deadlineAt = now() + options.timeoutMs
    const record = { id, hash, state, done, resolve, deadlineAt, sessionId: options.sessionId,
      claimDeadline: state === 'opening' ? deadlineAt : Math.min(now() + CLAIM_TTL_MS, deadlineAt),
      validateResult: options.validateResult, observe: options.observe }
    ledger.set(id, record)
    return record
  }

  async function wait(record, signal, first = false) {
    if (active.has(record) && signal) {
      let cancel
      try {
        const aborted = new Promise((_resolve, reject) => {
          cancel = () => {
            if (first && active.has(record) && record.state !== 'claimed') {
              expire(record, requestError('REQUEST_EXPIRED', 'The Clip tool was canceled before the editor claimed it.', record.id, { reason: 'ABORTED' }))
            }
            reject(signal.reason)
          }
          if (signal.aborted) cancel()
          else signal.addEventListener('abort', cancel, { once: true })
        })
        await Promise.race([aborted, record.done])
      } finally {
        signal.removeEventListener('abort', cancel)
      }
    } else await record.done
    if (record.error) throw record.error
    if (record.command?.operation === 'clip_get' && isCurrentGeneration(record)) {
      const { lease } = record
      let observed = observations.get(lease.window)
      if (!observed) observations.set(lease.window, observed = new Map())
      observed.set(editorKey(lease), record.result.revisionEpoch)
    }
    return record.result
  }

  async function run(options) {
    const { id, hash, previous } = requestIdentity(options)
    if (previous) return wait(previous, options.signal)
    const current = select(scope(options.sessionId, options.selector), options.selector, options.savedFallback)
    if (!current) return null
    if (current.binding) resolveWorkflowBinding(getWorkflowClip?.(), current.binding, current.sessionId)
    const baseRevision = options.baseRevision ?? current.revision
    if (options.checkRevision) {
      const planned = options.operation === 'clip_edit' || options.baseRevision !== undefined || options.baseRevisionEpoch !== undefined
      const observedEpoch = observations.get(current.window)?.get(editorKey(current)) ?? 0
      if (current.revision !== baseRevision
        || (planned && (options.baseRevisionEpoch ?? observedEpoch) !== (current.revisionEpoch ?? 0))) {
        throw revisionConflict(current)
      }
    }
    const record = recordFor(options, id, hash, 'notified')
    record.lease = current
    record.window = current.window
    record.checkRevision = options.checkRevision === true
    record.revisionResets = current.revisionResets
    record.prepare = options.prepare
    record.prepareArgs = options.prepareArgs
    record.command = {
      protocolVersion: 1, requestId: id, operation: options.operation, args: options.args, baseRevision,
      ...(current.revisionEpoch !== undefined ? { revisionEpoch: current.revisionEpoch } : {}),
      projectId: current.projectId, mode: current.mode, ...(current.binding ? { binding: current.binding } : {}),
      tabInstanceId: current.tabInstanceId, editorInstanceId: current.editorInstanceId,
      ...(current.draftWriterId ? { draftWriterId: current.draftWriterId } : {}), deadlineAt: record.deadlineAt,
    }
    monitor(record)
    try {
      if (current.window.send('omnimux:clip:command', { requestId: id }) === false) {
        throw new Error('Clip notification was not admitted')
      }
    } catch {
      expire(record, new ClipDomainError('EDITOR_OFFLINE', 'The Clip window disconnected before delivery.'))
    }
    return wait(record, options.signal, true)
  }

  function openValue(record, current) {
    return { requestId: record.id, projectId: current.projectId, mode: current.mode,
      windowInstanceId: current.window.windowInstanceId, revision: current.revision, ...(current.binding ? { binding: current.binding } : {}) }
  }

  async function open(options) {
    const { id, hash, previous } = requestIdentity({ ...options, operation: 'clip_open' })
    if (previous) return wait(previous, options.signal)
    const target = options.resolveTarget()
    const context = scope(options.sessionId, { ...target, windowInstanceId: options.selector.windowInstanceId })
    const { matching, scoped } = context
    if (!scoped.length) throw new ClipDomainError('EDITOR_OFFLINE', 'No authenticated window is connected to this conversation.')
    if (matching.length > 1 || (!matching.length && scoped.length > 1)) throw ambiguous(context)
    const record = recordFor(options, id, hash, 'opening')
    if (matching.length) {
      settle(record, 'succeeded', { result: openValue(record, matching[0]) })
      return wait(record, options.signal)
    }
    const [window] = scoped
    record.window = window
    record.target = target
    monitor(record)
    const clip = { ...target.binding, projectId: target.projectId, mode: target.mode }
    try {
      if (window.send('omnimux:clip:open', { requestId: id, sessionId: options.sessionId,
        view: { clip, ...(target.binding ? { workspaceId: target.binding.workspaceId } : {}) } }) === false) {
        throw new Error('Clip navigation was not admitted')
      }
    } catch {
      expire(record, new ClipDomainError('EDITOR_OFFLINE', 'The Clip window disconnected before navigation.'))
    }
    return wait(record, options.signal, true)
  }

  function provenReceipt(record, token) {
    return record.receiptProof && typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
      && timingSafeEqual(record.receiptProof, createHash('sha256').update(token).digest())
  }

  function ownedRecord(window, body, receipt = false) {
    assertWindow(window)
    sweep()
    if (!isClipToken(body?.requestId) || !isClipToken(body.leaseId)) throw ClipDomainError.invalidJson('requestId and leaseId are required.')
    const sessionId = window.getViewport()?.sessionId
    if (receipt && !sessionId) {
      throw new ClipDomainError('VIEWPORT_NOT_REGISTERED', 'Register the authenticated viewport before retrying this receipt.', { retryable: true })
    }
    const record = ledger.get(body.requestId)
    if (!record || record.sessionId !== sessionId) {
      throw new ClipDomainError('REQUEST_NOT_FOUND', 'No matching Clip request is available to this window.')
    }
    if (record.expired) throw requestError('REQUEST_EXPIRED', 'The original Clip result expired.', body.requestId)
    const sameWindow = record.window === window
    const reconnect = receipt && !record.window?.isAlive()
    if ((!sameWindow && !reconnect) || record.lease?.id !== body.leaseId) {
      throw new ClipDomainError('WINDOW_UNAUTHORIZED', 'This Clip command belongs to a different window or lease.')
    }
    if (receipt && !provenReceipt(record, body.receiptToken)) {
      if (sameWindow && record.state === 'notified') {
        throw requestError('REQUEST_NOT_CLAIMED', 'The editor must claim this Clip command before returning a receipt.', record.id)
      }
      throw requestError('WINDOW_UNAUTHORIZED', 'A valid proof for the original Clip command is required.', record.id)
    }
    return record
  }

  function statusValue(record) {
    return { status: record.state,
      ...(record.result !== undefined ? { result: record.result } : {}),
      ...(record.error ? { error: clipErrorValue(record.error) } : {}) }
  }

  async function claim(window, body) {
    const record = ownedRecord(window, body)
    refresh(record)
    if (record.state !== 'notified') return statusValue(record)
    try {
      const current = record.lease
      if (current.binding) resolveWorkflowBinding(getWorkflowClip?.(), current.binding, current.sessionId)
      if (record.checkRevision && (current.revision !== record.command.baseRevision || current.revisionResets !== record.revisionResets)) {
        throw revisionConflict(current)
      }
      if (record.command.operation === 'clip_get') {
        record.command.revisionEpoch = current.revisionEpoch
        record.revisionResets = current.revisionResets
      }
      if (record.prepareArgs) {
        record.state = 'claiming'
        record.command.args = await record.prepareArgs(record.command.args, record.command, current.sessionId)
        if (record.expired) throw requestError('REQUEST_EXPIRED', 'The original Clip result expired.', record.id)
        const err = liveError(current)
        if (err) throw err
      }
      const job = record.prepare?.(record.command)
      if (job) record.command.exportJobId = job.exportJobId
      record.state = 'claimed'
      if (job && !job.uploadToken) {
        // A durable export job already received this request, possibly before a Host restart.
        checkExport(record)
        return statusValue(record)
      }
      const receiptToken = randomBytes(32).toString('base64url')
      record.receiptProof = createHash('sha256').update(receiptToken).digest()
      return { command: { ...record.command, receiptToken, ...(job ? { uploadToken: job.uploadToken } : {}) } }
    } catch (error) {
      settle(record, 'failed', { error })
      throw error
    }
  }

  function isCurrentGeneration(record) {
    return !liveError(record.lease) && record.revisionResets === record.lease.revisionResets
  }

  function advanceReceiptRevision(record, revision, epoch = record.command.revisionEpoch ?? 0) {
    // Keep late receipts retrievable while only advancing their original revision sequence.
    if (!isClipRevision(revision) || epoch !== (record.command.revisionEpoch ?? 0) || !isCurrentGeneration(record)) return
    record.lease.revision = Math.max(record.lease.revision, revision)
  }

  function receipt(window, body) {
    const record = ownedRecord(window, body, true)
    const hash = fingerprint([body.result, body.error])
    if (record.receiptHash) {
      if (record.receiptHash !== hash) throw requestError('REQUEST_ID_CONFLICT', 'This request already has a different receipt.', record.id)
      return statusValue(record)
    }
    refresh(record)
    if (record.state === 'succeeded' || record.state === 'failed') return statusValue(record)
    if (!['claimed', 'unknown'].includes(record.state)) {
      throw requestError('REQUEST_NOT_CLAIMED', 'The editor must claim this Clip command before returning a receipt.', record.id)
    }
    if ((body.result === undefined) === (body.error === undefined)) {
      throw requestError('INVALID_RECEIPT', 'Supply either a Clip result or an error.', record.id)
    }
    if (body.error !== undefined) {
      const failure = fromEditor(body.error, record.id)
      if (failure.code === 'REVISION_CONFLICT') {
        advanceReceiptRevision(record, failure.details?.currentRevision, failure.details?.currentRevisionEpoch)
      }
      record.receiptHash = hash
      settle(record, 'failed', { error: failure })
    } else if (record.observe) {
      // Only the server-side upload can confirm the exported file and canvas commit.
      return statusValue(record)
    } else {
      if (!body.result || typeof body.result !== 'object' || Array.isArray(body.result) || body.result.ok === false) {
        throw requestError('INVALID_RECEIPT', 'The editor did not return a valid Clip result.', record.id)
      }
      let result
      try {
        result = record.validateResult ? record.validateResult(body.result, record.command) : body.result
      } catch (error) {
        record.receiptHash = hash
        settle(record, 'failed', { error })
        throw error
      }
      const operation = record.command.operation
      if (operation === 'clip_get' || operation === 'clip_edit') advanceReceiptRevision(record, result.revision, result.revisionEpoch)
      record.receiptHash = hash
      settle(record, 'succeeded', { result: { ...result, requestId: record.id, projectId: record.lease.projectId,
        ...(operation === 'clip_get' ? { windowInstanceId: record.window.windowInstanceId } : {}) } })
    }
    return statusValue(record)
  }

  function dispose() {
    disposed = true
    for (const record of active) expire(record, new ClipDomainError('EDITOR_OFFLINE', 'The Clip Host stopped.'))
    leases.clear()
    ledger.clear()
    completed.clear()
  }

  return { lease, renew, release, claim, receipt, run, open, dispose }
}
