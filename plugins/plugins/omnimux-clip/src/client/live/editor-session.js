import { isClipRevision } from '../../errors.js'
import { LiveClipError, fromHost, syncDisposition } from './persistence.js'

export const STUDIO_TAB = 'omnimux-clip:studio'
export const CANVAS_TAB = 'omnimux-workflow:canvas'
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const WAITING = Object.freeze({ phase: 'hidden' })
const bindingMatches = (left, right) => left?.workspaceId === right?.workspaceId
  && left?.nodeId === right?.nodeId && left?.projectId === right?.projectId
const awaitingConnection = code => code === 'EDITOR_OFFLINE' || code === 'WINDOW_UNAUTHORIZED'

export function assertProjectId(id) {
  if (!ID.test(id ?? '')) throw new LiveClipError('invalid-id', 'Enter a valid Clip project ID.')
  return id
}

function matchesAtSite(left, right) {
  return Boolean(left && right && left.entry.id === right.entry.id && left.sessionId === right.sessionId
    && left.tabInstanceId === right.tabInstanceId && left.projectId === right.projectId
    && left.mediaReturnId === right.mediaReturnId && bindingMatches(left.binding, right.binding))
}

/** Serializes ownership and writes for the two native entry points in this renderer. */
export function createEditorSession({ storage, native, workbench, document, onError, onVisibility, onRelease, debounce = 1500 }) {
  const entries = new Map()
  const listeners = new Set()
  const studioProjects = new Map()
  let view = WAITING
  let desired = null
  let current = null
  let wanted = 0
  let work = Promise.resolve()
  let saveTimer
  let disposed = false
  let failed = null
  let pendingNative = null
  let retainedCanvas = null

  const activeSessionId = () => workbench()?.getActiveSurface?.()?.sessionId
  const inConversation = owner => activeSessionId() === owner.site.sessionId

  function publish(next) {
    view = next
    for (const listener of listeners) listener()
  }

  function show(owner) {
    if (disposed || current !== owner) return
    if (owner.token.signal.aborted) {
      if (!desired) return publish(WAITING)
      const canRecover = inConversation(owner)
      publish({
        id: desired.entry.id,
        phase: 'blocked',
        title: canRecover ? owner.record?.project.name : undefined,
        status: canRecover ? owner.status : 'saveFailed',
        conflict: canRecover && Boolean(owner.conflict),
        resolving: owner.resolving || owner.handingOff,
        retryable: canRecover && owner.handoffBlocked,
      })
      return
    }
    publish({
      id: owner.site.entry.id,
      phase: owner.record ? 'editing' : 'welcome',
      projectId: owner.record?.project.id,
      title: owner.record?.project.name,
      revision: owner.record?.revision,
      token: owner.token,
      status: owner.status,
      ...(owner.site.mode === 'standalone' && owner.site.mediaReturnId ? { mediaReturnId: owner.site.mediaReturnId } : {}),
      ...(owner.ingesting && !owner.conflict ? { ingesting: true } : {}),
      ...(owner.conflict ? { conflict: true } : {}),
      ...(owner.resolving ? { resolving: true } : {}),
    })
  }

  function enqueue(callback) {
    const result = work.then(callback)
    work = result.catch(error => { onError?.(error) })
    return result
  }

  function readSite() {
    if (disposed || document?.visibilityState === 'hidden') return null
    const surface = workbench()?.getActiveSurface?.()
    if (!surface?.panelOpen || !surface.instanceId || !surface.sessionId || surface.sessionId === 'default') return null
    const { tabId, instanceId: tabInstanceId, sessionId } = surface
    for (const entry of entries.values()) {
      if (entry.tabId !== tabId || !entry.isVisible() || (entry.tabInstanceId && entry.tabInstanceId !== tabInstanceId)) continue
      if (entry.sessionId && entry.sessionId !== sessionId) continue
      const shared = { entry, sessionId, tabInstanceId, mode: entry.mode }
      if (entry.mode === 'canvas') {
        const canvas = entry.getCanvas()
        if (!canvas?.workspaceId || !canvas?.nodeId || !ID.test(canvas.projectId ?? '')) continue
        return {
          ...shared, projectId: canvas.projectId, title: canvas.nodeTitle, draftSchema: canvas.draftSchema,
          hasUpstream: Object.values(canvas.upstreamInputs ?? {}).some(items => Array.isArray(items) && items.length > 0),
          mediaReturnId: canvas.mediaReturn?.requestId,
          hasReturnedMedia: Object.values(canvas.mediaReturn?.upstreamInputs ?? {}).some(items => Array.isArray(items) && items.length > 0),
          binding: { workspaceId: canvas.workspaceId, nodeId: canvas.nodeId, projectId: canvas.projectId },
        }
      }
      const key = JSON.stringify([sessionId, tabInstanceId])
      const request = entry.getStudioRequest()
      let saved = studioProjects.get(key)
      if (request?.projectId && ID.test(request.projectId) && (!saved || (request.key && request.key !== saved.requestKey))) {
        saved = { projectId: request.projectId, requestKey: request.key,
          mediaReturnId: request.mediaReturn === true && ID.test(request.key) ? request.key : undefined }
        studioProjects.set(key, saved)
      }
      if (!saved) {
        saved = { projectId: storage.studioProject?.(key) ?? undefined }
        studioProjects.set(key, saved)
      }
      return { ...shared, projectId: saved.projectId, studioKey: key, mediaReturnId: saved.mediaReturnId }
    }
    return null
  }

  function owns(owner, { requireProject = true } = {}) {
    return Boolean(owner && current === owner && !owner.token.signal.aborted && !owner.resolving
      && matchesAtSite(owner.site, readSite())
      && (!requireProject || owner.record && native.projectId() === owner.record.project.id))
  }

  function capture(owner) {
    if (!owner.record || native.projectId() !== owner.record.project.id) return false
    const snapshot = native.capture()
    if (!snapshot || snapshot.project.id !== owner.record.project.id || snapshot.fingerprint === owner.fingerprint) return false
    owner.fingerprint = snapshot.fingerprint
    owner.record = {
      ...owner.record,
      project: snapshot.project,
      media: snapshot.media,
      revision: owner.record.revision + 1,
      updatedAt: new Date().toISOString(),
    }
    return true
  }

  function needsSave(owner) {
    return owner.record?.revision > owner.record?.localBaseRevision
  }

  function cancelSave() {
    clearTimeout(saveTimer)
    saveTimer = undefined
  }

  function scheduleSave(owner) {
    cancelSave()
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      if (owns(owner) && needsSave(owner)) void save(owner)
    }, debounce)
  }

  function scheduleRemainingSave(owner) {
    if (!saveTimer && owns(owner) && needsSave(owner) && !owner.conflict && !owner.retryOnViewport) scheduleSave(owner)
  }

  async function flush(owner, receipt, canWrite = () => true) {
    if (!owner.record) return { persisted: true, synchronized: true }
    const snapshot = owner.record
    await storage.writeLocal(snapshot, receipt)
    if (owner.conflict) return { persisted: true, synchronized: false, conflict: true }
    if (snapshot.revision <= snapshot.localBaseRevision) return { persisted: true, synchronized: true }
    if (!canWrite()) return { persisted: true, synchronized: false }
    if (snapshot.binding && !inConversation(owner)) {
      owner.status = 'saveFailed'
      owner.retryOnViewport = true
      show(owner)
      return { persisted: true, synchronized: false }
    }
    owner.status = 'saving'
    owner.retryOnViewport = false
    show(owner)
    let outgoing = snapshot
    if (typeof storage.uploadMediaBytes === 'function') {
      const pendingItems = (snapshot.project?.mediaLibrary?.items ?? []).filter(item => {
        if (item.omnimuxSource?.handle || item.omnimuxSource?.url || item.missing || item.isPlaceholder) return false
        const blob = snapshot.media?.[item.id]
        return blob instanceof Blob && blob.size > 0
      })
      if (pendingItems.length > 0) {
        const uploadedSources = new Map()
        try {
          for (const item of pendingItems) {
            if (!canWrite()) return { persisted: true, synchronized: false }
            const blob = snapshot.media[item.id]
            const uploaded = await storage.uploadMediaBytes(snapshot.project.id, item.id, blob, {
              name: item.sourceFile?.name || item.name,
              mimeType: blob.type,
              binding: snapshot.binding,
            })
            if (uploaded?.handle && uploaded.sha256) {
              const handle = uploaded.handle
              const stableId = item.omnimuxSource?.id
                ?? (handle.scope === 'project-asset' ? `project:${handle.workspaceId}:${handle.assetId ?? handle.rel}` : `vault:${uploaded.sha256}`)
              uploadedSources.set(item.id, {
                id: stableId,
                version: `sha256:${uploaded.sha256}`,
                digest: uploaded.sha256,
                handle,
                ...(uploaded.url ? { url: uploaded.url } : {}),
              })
            }
          }
        } catch (error) {
          owner.retryOnViewport = awaitingConnection(error.code)
          owner.status = owner.retryOnViewport ? 'offline' : 'saveFailed'
          show(owner)
          return { persisted: true, synchronized: false }
        }
        if (uploadedSources.size > 0) {
          const patchItems = items => items.map(item => {
            const nextSource = uploadedSources.get(item.id)
            if (!nextSource || item.omnimuxSource?.handle) return item
            return {
              ...item,
              omnimuxSource: nextSource,
              sourceRef: { ...item.sourceRef, kind: 'indexeddb', key: item.id, digest: nextSource.digest },
            }
          })
          outgoing = {
            ...snapshot,
            project: {
              ...snapshot.project,
              mediaLibrary: { ...snapshot.project.mediaLibrary, items: patchItems(snapshot.project.mediaLibrary.items) },
            },
          }
          for (const [mediaId, nextSource] of uploadedSources.entries()) {
            native.attachMediaHandle?.(snapshot.project.id, mediaId, nextSource)
          }
          if (owner.record === snapshot) {
            const refreshed = native.capture?.()
            if (refreshed?.project?.id === snapshot.project.id) owner.fingerprint = refreshed.fingerprint
            owner.record = outgoing
          } else if (owner.record?.project?.id === snapshot.project.id) {
            owner.record = {
              ...owner.record,
              project: {
                ...owner.record.project,
                mediaLibrary: { ...owner.record.project.mediaLibrary, items: patchItems(owner.record.project.mediaLibrary.items) },
              },
            }
          }
          await storage.writeLocal(outgoing, receipt)
        }
      }
    }
    let result
    try {
      result = await storage.writeHost(outgoing)
    } catch (error) {
      if (error.code === 'REVISION_CONFLICT' || error.code === 'revision-conflict') {
        try {
          const remote = await storage.readHost(snapshot.project.id)
          owner.conflict = remote ?? { revision: 0 }
          owner.status = undefined
          return { persisted: true, synchronized: false, conflict: true }
        } catch (readError) {
          error = readError
        }
      }
      owner.retryOnViewport = awaitingConnection(error.code)
      owner.status = owner.retryOnViewport ? 'offline' : 'saveFailed'
      return { persisted: true, synchronized: false }
    } finally {
      if (!result) show(owner)
    }
    owner.record = { ...owner.record, localBaseRevision: result.revision }
    await storage.writeLocal(owner.record)
    owner.status = owner.record.revision > result.revision ? undefined : 'saved'
    show(owner)
    return { persisted: true, synchronized: true }
  }

  async function tryFlush(owner, receipt, canWrite) {
    const revision = owner.record?.revision
    let saved
    try {
      saved = await flush(owner, receipt, canWrite)
      return saved
    } catch (error) {
      owner.status = 'saveFailed'
      show(owner)
      onError?.(error)
      return { persisted: false, synchronized: false }
    } finally {
      if (saved?.synchronized || owner.record?.revision > revision) scheduleRemainingSave(owner)
    }
  }

  function save(owner = current, receipt) {
    if (current !== owner || !owner?.record) return Promise.resolve({ persisted: false, synchronized: false })
    if (ownedNativeProject(owner) && !owner.resolving) capture(owner)
    return enqueue(() => current === owner
      ? tryFlush(owner, receipt)
      : { persisted: false, synchronized: false })
  }

  async function syncBeforeRelease(owner, canWrite) {
    if (!owner.record) return true
    if (ownedNativeProject(owner)) capture(owner)
    do {
      const saved = await tryFlush(owner, undefined, canWrite)
      if (!saved.persisted || !saved.synchronized) return false
      if (ownedNativeProject(owner)) capture(owner)
    } while (needsSave(owner))
    return true
  }

  function ownedNativeProject(owner) {
    return current === owner && native.projectId() === owner.record?.project.id
  }

  function rememberCanvas(site) {
    if (site.mode !== 'canvas') return
    const anchor = site.entry.getCanvasAnchor?.()
    if (anchor) retainedCanvas = { site, anchor }
  }

  function retainedCanvasBinding(sessionId) {
    if (!retainedCanvas) return null
    const { site, anchor } = retainedCanvas
    if (entries.get(site.entry.id) !== site.entry || site.entry.getCanvasAnchor?.() !== anchor
      || !bindingMatches(site.entry.getCanvas(), site.binding)) {
      retainedCanvas = null
      return null
    }
    return site.sessionId === sessionId && activeSessionId() === sessionId ? site.binding : null
  }

  async function openSite(site, version) {
    const stillDesired = () => version === wanted && matchesAtSite(site, readSite()) && !disposed
    if (!stillDesired()) return
    const token = new AbortController()
    const owner = { site, token, record: null, fingerprint: '', status: undefined, conflict: null, revisionEpoch: 0 }
    const opening = pendingNative?.project.id === site.projectId ? pendingNative : null
    let pendingDraft = Boolean(site.projectId)
    try {
      if (!site.projectId) {
        await native.welcome(stillDesired)
        if (!stillDesired()) return
        current = owner
        show(owner)
        onVisibility?.()
        return
      }
      const local = await storage.readLocal(site.projectId)
      pendingDraft = Boolean(opening || local && local.revision > local.localBaseRevision)
      if (!stillDesired()) return
      let host
      try {
        host = await storage.readHost(site.projectId)
        if (site.binding && stillDesired() && ((!host && !local) || (host && !host.binding))) host = await storage.materialize(site)
      } catch (error) {
        if (!awaitingConnection(error.code) || (!local && !opening)) throw error
        owner.status = 'offline'
        owner.retryOnViewport = true
      }
      if (!stillDesired()) return
      if (host && !bindingMatches(host.binding, site.binding)) {
        throw new LiveClipError('AMBIGUOUS_TARGET', 'The saved project belongs to another editor binding.')
      }
      if (local && !bindingMatches(local.binding, site.binding)) {
        throw new LiveClipError('AMBIGUOUS_TARGET', 'The local draft belongs to another editor binding.')
      }
      const disposition = owner.status === 'offline' ? 'offline' : syncDisposition(local, host)
      if (disposition === 'conflict') owner.conflict = host ?? { revision: 0 }
      if (['offline', 'push', 'retry', 'conflict'].includes(disposition)) owner.record = local ?? opening
      else if (host) {
        const needsReconcile = typeof storage.reconcileMedia === 'function'
          && (host.project?.mediaLibrary?.items ?? []).some(item => !item.omnimuxSource?.handle || item.missing || item.isPlaceholder)
        if (needsReconcile) {
          try {
            const reconciled = await storage.reconcileMedia(site.projectId, { mode: 'apply', binding: site.binding })
            if (!stillDesired()) return
            if (reconciled?.upgradedMediaIds?.length && reconciled.project && isClipRevision(reconciled.revision)) {
              host = { ...host, revision: reconciled.revision, project: reconciled.project }
            }
          } catch (error) {
            console.warn('[Clip] Host media reconcile before load failed.', error?.code ?? error?.name)
          }
        }
        owner.record = fromHost(host, local)
      }
      else owner.record = opening ?? local
      if (!owner.record) throw new LiveClipError('not-found', 'The Clip project does not exist.')
      await native.load(owner.record, stillDesired)
      if (!stillDesired()) return
      // Loading can rehydrate local media handles without an editorial change.
      const loaded = native.capture()
      owner.fingerprint = loaded.fingerprint
      owner.revisionEpoch = isClipRevision(local?.revisionEpoch) ? local.revisionEpoch : 0
      owner.record = { ...owner.record, project: loaded.project, media: loaded.media, revisionEpoch: owner.revisionEpoch }
      owner.ingesting = site.hasReturnedMedia || site.hasUpstream && !loaded.project.omnimuxCanvasInitialized
      pendingNative = pendingNative === opening ? null : pendingNative
      await flush(owner, undefined, stillDesired)
      if (!stillDesired()) return
      current = owner
      rememberCanvas(site)
      if (site.studioKey) storage.rememberStudioProject?.(site.studioKey, site.projectId)
      failed = null
      show(owner)
      onVisibility?.()
    } catch (error) {
      if (!stillDesired()) return
      failed = { site, code: error.code, pendingDraft: pendingDraft || Boolean(owner.record?.revision > owner.record?.localBaseRevision) }
      publish({ id: site.entry.id, phase: 'error', code: error.code, canExit: !failed.pendingDraft })
      onError?.(error)
    }
  }

  function freeze(owner) {
    if (owner.token.signal.aborted) return
    if (!owner.resolving) capture(owner)
    owner.token.abort(new LiveClipError('EDITOR_NOT_VISIBLE', 'The original editor is no longer active.'))
    native.suspend()
  }

  function resume(owner) {
    if (!matchesAtSite(owner.site, desired)) return false
    owner.token = new AbortController()
    owner.handoffBlocked = false
    rememberCanvas(owner.site)
    show(owner)
    scheduleRemainingSave(owner)
    onVisibility?.()
    return true
  }

  async function advance(retry = false, canWrite) {
    if (disposed) return
    const previous = current
    if (previous) {
      if (!previous.token.signal.aborted || resume(previous)) return
      if (previous.handoffBlocked && !retry) return
      previous.handingOff = true
      show(previous)
      let synchronized
      try {
        synchronized = await syncBeforeRelease(previous, canWrite)
      } finally {
        previous.handingOff = false
      }
      if (disposed || resume(previous)) return
      if (!synchronized) {
        previous.handoffBlocked = true
        show(previous)
        return
      }
      await onRelease?.(previous)
      current = null
    }
    if (disposed || failed) return
    publish(desired ? { id: desired.entry.id, phase: 'loading' } : WAITING)
    if (desired) await openSite(desired, wanted)
  }

  function reconcile() {
    if (disposed) return
    retainedCanvasBinding(activeSessionId())
    const site = readSite()
    if (matchesAtSite(site, desired) || (!site && !desired)) {
      if (site && matchesAtSite(current?.site, site) && !current.token.signal.aborted) rememberCanvas(site)
      return
    }
    desired = site
    wanted++
    failed = null
    cancelSave()
    if (current) {
      if (!matchesAtSite(current.site, site)) freeze(current)
      show(current)
    } else {
      publish(site ? { id: site.entry.id, phase: 'loading' } : WAITING)
    }
    onVisibility?.()
    void enqueue(() => advance())
  }

  function projectChanged() {
    const owner = current
    if (!owns(owner, { requireProject: false })) return
    const id = native.projectId()
    if (owner.site.mode === 'standalone' && id && id !== owner.record?.project.id) {
      const snapshot = native.capture()
      const created = { project: snapshot.project, media: snapshot.media, revision: 1, localBaseRevision: 0, updatedAt: new Date().toISOString() }
      pendingNative = created
      void enqueue(async () => {
        if (!await storage.readLocal(id)) await storage.writeLocal(created)
      })
      const saved = studioProjects.get(owner.site.studioKey)
      studioProjects.set(owner.site.studioKey, { ...saved, projectId: id })
      reconcile()
      return
    }
    if (capture(owner)) {
      owner.status = owner.status === 'offline' ? 'offline' : undefined
      show(owner)
      scheduleSave(owner)
    }
  }

  async function resolveConflict(choice) {
    const owner = current
    if (!owner?.conflict || owner.resolving || owner.handingOff || !inConversation(owner)) return false
    if (ownedNativeProject(owner)) capture(owner)
    cancelSave()
    owner.resolving = true
    native.suspend()
    show(owner)
    onVisibility?.()
    try {
      const resolved = await enqueue(async () => {
        const stillOwned = () => !disposed && current === owner && inConversation(owner)
        if (!stillOwned()) return false
        const draft = owner.record
        const host = await storage.readHost(draft.project.id)
        if (!stillOwned()) return false
        if ((host?.revision ?? 0) !== owner.conflict.revision) {
          owner.conflict = host ?? { revision: 0 }
          return false
        }
        if (host && !bindingMatches(host.binding, owner.site.binding)) throw new LiveClipError('AMBIGUOUS_TARGET', 'The project binding changed.')
        if (choice === 'local') {
          const revision = Math.max(draft.revision, (host?.revision ?? 0) + 1)
          const saved = await storage.writeHost(draft, { expectedRevision: host?.revision ?? 0, revision, backupCurrent: true })
          owner.record = { ...draft, revision: saved.revision, localBaseRevision: saved.revision }
        } else {
          if (!host || !['host', 'copy'].includes(choice)) throw new LiveClipError('not-found', 'The Host version is unavailable.')
          await storage.backupLocal(draft)
          if (!stillOwned()) return false
          if (choice === 'copy') {
            if (owner.copy?.draft !== draft) {
              const project = { ...draft.project, id: crypto.randomUUID() }
              owner.copy = { draft, record: { ...draft, project, binding: undefined, revision: 1, localBaseRevision: 0, revisionEpoch: 0 } }
            }
            const copy = owner.copy.record
            await storage.writeLocal(copy)
            if (!stillOwned()) return false
            const saved = await storage.writeHost(copy)
            await storage.writeLocal({ ...copy, localBaseRevision: saved.revision })
          }
          const adopted = fromHost(host, draft)
          if (!stillOwned()) return false
          // The old owner holds the native store even while another tab is waiting.
          const keepsNativeStore = () => !disposed && current === owner
          await native.load(adopted, keepsNativeStore)
          if (!keepsNativeStore()) return false
          const loaded = native.capture()
          owner.revisionEpoch++
          owner.record = { ...adopted, project: loaded.project, media: loaded.media, revisionEpoch: owner.revisionEpoch }
          owner.fingerprint = loaded.fingerprint
          owner.copy = undefined
        }
        owner.conflict = null
        owner.retryOnViewport = false
        await storage.writeLocal(owner.record)
        owner.status = 'saved'
        return true
      })
      if (resolved && owner.token.signal.aborted) void enqueue(() => advance(true))
      return resolved
    } catch (error) {
      owner.status = awaitingConnection(error.code) ? 'offline' : 'saveFailed'
      return false
    } finally {
      owner.resolving = false
      show(owner)
      onVisibility?.()
    }
  }

  function retry() {
    if (current?.handoffBlocked && inConversation(current)) return enqueue(() => advance(true))
    if (!failed || !matchesAtSite(failed.site, readSite())) return
    failed = null
    return enqueue(() => advance())
  }

  function needsReconnect(sessionId) {
    if (disposed || !sessionId || activeSessionId() !== sessionId) return false
    if (failed?.site.sessionId === sessionId && awaitingConnection(failed.code)) return true
    const owner = current
    return Boolean(owner?.site.sessionId === sessionId && owner.retryOnViewport && !owner.resolving && !owner.conflict
      && owner.record?.revision > owner.record?.localBaseRevision)
  }

  function reconnect(sessionId = activeSessionId(), stillConnected = () => true) {
    if (!needsReconnect(sessionId) || !stillConnected()) return
    if (failed) return retry()
    const owner = current
    return enqueue(() => {
      if (current !== owner || !needsReconnect(sessionId) || !stillConnected()) return
      if (owner.token.signal.aborted) return advance(true, stillConnected)
      return tryFlush(owner, undefined, stillConnected)
    })
  }

  async function leaveEditor(owner, finish) {
    const { token } = owner
    const stillVisible = () => owner.token === token && !token.signal.aborted && ownedNativeProject(owner)
      && matchesAtSite(owner.site, readSite())
    cancelSave()
    owner.resolving = true
    native.suspend()
    show(owner)
    onVisibility?.()
    try {
      return await enqueue(async () => {
        if (!stillVisible() || !await syncBeforeRelease(owner, stillVisible) || !stillVisible()) return false
        await onRelease?.(owner)
        if (!stillVisible() || await finish(stillVisible) === false) return false
        reconcile()
        return true
      })
    } finally {
      owner.resolving = false
      show(owner)
      onVisibility?.()
    }
  }

  async function closeCanvas(binding, finish) {
    const site = readSite()
    if (!site?.binding || !bindingMatches(site.binding, binding)) return false
    const owner = current
    if (!owner && failed && !failed.pendingDraft && matchesAtSite(failed.site, site)) {
      if (finish() === false) return false
      reconcile()
      return true
    }
    if (!owns(owner) || owner.conflict || !bindingMatches(owner.site.binding, binding)) return false
    return leaveEditor(owner, finish)
  }

  async function leaveForMedia(owner, navigate) {
    if (!owns(owner) || owner.conflict || owner.ingesting) return false
    return leaveEditor(owner, navigate)
  }

  const unsubscribe = native.subscribe(projectChanged)
  return {
    add(entry) {
      entries.set(entry.id, entry)
      reconcile()
      return () => {
        entries.delete(entry.id)
        reconcile()
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => view,
    getOwner: () => current,
    getWaiting: () => work,
    reconcile,
    save,
    async finishIngestion() {
      const owner = current
      if (!owns(owner)) return
      await save(owner)
      if (!owns(owner)) return
      owner.ingesting = false
      show(owner)
      onVisibility?.()
    },
    resolveConflict,
    owns,
    capture,
    retry,
    closeCanvas,
    leaveForMedia,
    needsReconnect,
    reconnect,
    retainedCanvasBinding,
    dispose() {
      if (disposed) return
      disposed = true
      const owner = current
      if (owner) {
        freeze(owner)
        void enqueue(async () => {
          if (current !== owner) return
          if (await syncBeforeRelease(owner)) await onRelease?.(owner)
          current = null
        })
      }
      entries.clear()
      retainedCanvas = null
      unsubscribe()
      cancelSave()
      listeners.clear()
    },
  }
}
