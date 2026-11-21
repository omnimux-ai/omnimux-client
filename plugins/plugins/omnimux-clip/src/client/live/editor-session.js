import { LiveClipError, fromHost, syncDisposition } from './persistence.js'

export const STUDIO_TAB = 'omnimux-clip:studio'
export const CANVAS_TAB = 'omnimux-workflow:canvas'
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const WAITING = Object.freeze({ phase: 'hidden' })
const bindingMatches = (left, right) => left?.workspaceId === right?.workspaceId
  && left?.nodeId === right?.nodeId && left?.projectId === right?.projectId

export function assertProjectId(id) {
  if (!ID.test(id ?? '')) throw new LiveClipError('invalid-id', 'Enter a valid Clip project ID.')
  return id
}

function matchesAtSite(left, right) {
  return Boolean(left && right && left.entry.id === right.entry.id && left.sessionId === right.sessionId
    && left.tabInstanceId === right.tabInstanceId && left.projectId === right.projectId
    && bindingMatches(left.binding, right.binding))
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
  let unsavedOwner = null
  let pendingNative = null

  function publish(next) {
    view = next
    for (const listener of listeners) listener()
  }

  function show(owner) {
    if (current !== owner) return
    publish({
      id: owner.site.entry.id,
      phase: owner.record ? 'editing' : 'welcome',
      projectId: owner.record?.project.id,
      title: owner.record?.project.name,
      revision: owner.record?.revision,
      token: owner.token,
      status: owner.status,
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
          binding: { workspaceId: canvas.workspaceId, nodeId: canvas.nodeId, projectId: canvas.projectId },
        }
      }
      const key = JSON.stringify([sessionId, tabInstanceId])
      const request = entry.getStudioRequest()
      let saved = studioProjects.get(key)
      if (!saved) {
        saved = { projectId: storage.studioProject?.(key) ?? undefined }
        if (request?.projectId && ID.test(request.projectId)) { saved.projectId = request.projectId; saved.requestKey = request.key }
        studioProjects.set(key, saved)
      }
      if (request?.key && request.key !== saved.requestKey && ID.test(request.projectId ?? '')) {
        saved = { projectId: request.projectId, requestKey: request.key }
        studioProjects.set(key, saved)
      }
      return { ...shared, projectId: saved.projectId, studioKey: key }
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

  function scheduleSave(owner) {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void save(owner), debounce)
  }

  async function flush(owner, receipt) {
    if (!owner.record) return { persisted: true, synchronized: true }
    const snapshot = owner.record
    await storage.writeLocal(snapshot, receipt)
    if (snapshot.revision <= snapshot.localBaseRevision) return { persisted: true, synchronized: true }
    if (owner.conflict) return { persisted: true, synchronized: false, conflict: true }
    owner.status = 'saving'
    show(owner)
    try {
      const result = await storage.writeHost(snapshot)
      owner.record = { ...owner.record, localBaseRevision: result.revision }
      await storage.writeLocal(owner.record)
      owner.status = owner.record.revision > result.revision ? undefined : 'saved'
      return { persisted: true, synchronized: true }
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
      owner.status = error.code === 'EDITOR_OFFLINE' ? 'offline' : 'saveFailed'
      return { persisted: true, synchronized: false }
    } finally {
      show(owner)
    }
  }

  function save(owner = current, receipt) {
    if (!owner?.record) return Promise.resolve({ persisted: false, synchronized: false })
    if (ownedNativeProject(owner)) capture(owner)
    return enqueue(async () => {
      try {
        return await flush(owner, receipt)
      } catch (error) {
        owner.status = 'saveFailed'
        show(owner)
        onError?.(error)
        return { persisted: false, synchronized: false }
      }
    })
  }

  function ownedNativeProject(owner) {
    return current === owner && native.projectId() === owner.record?.project.id
  }

  async function openSite(site, version) {
    const stillDesired = () => version === wanted && matchesAtSite(site, readSite()) && !disposed
    if (!stillDesired()) return
    const token = new AbortController()
    const owner = { site, token, record: null, fingerprint: '', status: undefined, conflict: null }
    const opening = pendingNative?.project.id === site.projectId ? pendingNative : null
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
      if (!stillDesired()) return
      let host
      try {
        host = await storage.readHost(site.projectId)
        if (site.binding && stillDesired() && ((!host && !local) || (host && !host.binding))) host = await storage.materialize(site)
      } catch (error) {
        if (error.code !== 'EDITOR_OFFLINE' || (!local && !opening)) throw error
        owner.status = 'offline'
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
      else if (host) owner.record = fromHost(host, local)
      else owner.record = opening ?? local
      if (!owner.record) throw new LiveClipError('not-found', 'The Clip project does not exist.')
      await native.load(owner.record, stillDesired)
      if (!stillDesired()) return
      // Loading can rehydrate local media handles without an editorial change.
      const loaded = native.capture()
      owner.fingerprint = loaded.fingerprint
      owner.record = { ...owner.record, project: loaded.project, media: loaded.media }
      owner.ingesting = site.hasUpstream && !loaded.project.omnimuxCanvasInitialized
      pendingNative = pendingNative === opening ? null : pendingNative
      if (owner.record.revision <= owner.record.localBaseRevision) await storage.writeLocal(owner.record)
      else await flush(owner)
      if (!stillDesired()) return
      current = owner
      if (site.studioKey) storage.rememberStudioProject?.(site.studioKey, site.projectId)
      failed = null
      show(owner)
      onVisibility?.()
    } catch (error) {
      if (!stillDesired()) return
      failed = site
      publish({ id: site.entry.id, phase: 'error', code: error.code })
      onError?.(error)
    }
  }

  function reconcile() {
    if (disposed) return
    const site = readSite()
    if (matchesAtSite(site, desired) || (!site && !desired)) return
    const previous = current
    desired = site
    const version = ++wanted
    if (previous) {
      if (!previous.resolving) capture(previous)
      previous.token.abort(new LiveClipError('EDITOR_NOT_VISIBLE', 'The original editor is no longer active.'))
      native.suspend()
    }
    clearTimeout(saveTimer)
    current = null
    failed = null
    publish(site ? { id: site.entry.id, phase: 'loading' } : WAITING)
    onVisibility?.(previous)
    void enqueue(async () => {
      const detached = previous?.record ? previous : unsavedOwner
      if (detached) {
        unsavedOwner = detached
        try {
          await flush(detached)
          unsavedOwner = null
        } catch (error) {
          // Keep the detached draft in memory until it can be recorded locally.
          if (site && version === wanted) {
            failed = site
            publish({ id: site.entry.id, phase: 'error', code: 'storage-failed' })
          }
          throw error
        } finally {
          await onRelease?.(detached)
        }
      }
      if (site && version === wanted) await openSite(site, version)
    })
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
    if (!owns(owner) || !owner.conflict) return false
    capture(owner)
    owner.resolving = true
    show(owner)
    try {
      return await enqueue(async () => {
        const siteStillCurrent = () => current === owner && matchesAtSite(owner.site, readSite())
        if (!siteStillCurrent()) return false
        const draft = owner.record
        const host = await storage.readHost(draft.project.id)
        if (!siteStillCurrent()) return false
        if ((host?.revision ?? 0) !== owner.conflict.revision) {
          owner.conflict = host ?? { revision: 0 }
          return false
        }
        if (host && !bindingMatches(host.binding, owner.site.binding)) throw new LiveClipError('AMBIGUOUS_TARGET', 'The project binding changed.')
        if (choice === 'local') {
          const revision = Math.max(draft.revision, (host?.revision ?? 0) + 1)
          const saved = await storage.writeHost(draft, { expectedRevision: host?.revision ?? 0, revision, backupCurrent: true })
          owner.record = { ...draft, revision: saved.revision, localBaseRevision: saved.revision }
          await storage.writeLocal(owner.record)
        } else {
          if (!host || !['host', 'copy'].includes(choice)) throw new LiveClipError('not-found', 'The Host version is unavailable.')
          await storage.backupLocal(draft)
          if (choice === 'copy') {
            if (owner.copy?.draft !== draft) {
              const project = { ...draft.project, id: crypto.randomUUID() }
              owner.copy = { draft, record: { ...draft, project, binding: undefined, revision: 1, localBaseRevision: 0 } }
            }
            const copy = owner.copy.record
            await storage.writeLocal(copy)
            const saved = await storage.writeHost(copy)
            await storage.writeLocal({ ...copy, localBaseRevision: saved.revision })
          }
          const adopted = fromHost(host, draft)
          if (!siteStillCurrent()) return false
          await native.load(adopted, siteStillCurrent)
          if (!siteStillCurrent()) return false
          const loaded = native.capture()
          owner.record = { ...adopted, project: loaded.project, media: loaded.media }
          owner.fingerprint = loaded.fingerprint
          await storage.writeLocal(owner.record)
          owner.copy = undefined
        }
        owner.conflict = null
        owner.status = 'saved'
        return true
      })
    } catch (error) {
      owner.status = error.code === 'EDITOR_OFFLINE' ? 'offline' : 'saveFailed'
      return false
    } finally {
      owner.resolving = false
      show(owner)
      onVisibility?.()
    }
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
    retry() {
      if (!failed) return
      desired = null
      reconcile()
    },
    async closeCanvas(binding, finish) {
      const owner = current
      if (!owns(owner) || !bindingMatches(owner.site.binding, binding)) return false
      owner.resolving = true
      native.suspend()
      show(owner)
      onVisibility?.()
      try {
        let saved = await save(owner)
        if (ownedNativeProject(owner) && capture(owner)) saved = await save(owner)
        if (!saved.persisted || current !== owner) return false
        await onRelease?.(owner)
        if (current !== owner) return false
        finish()
        reconcile()
        return true
      } finally {
        owner.resolving = false
        show(owner)
        onVisibility?.()
      }
    },
    reconnect() {
      if (failed?.entry && readSite()) this.retry()
      if (current?.record && !current.conflict && current.record.revision > current.record.localBaseRevision) void save(current)
    },
    dispose() {
      entries.clear()
      reconcile()
      disposed = true
      unsubscribe()
      clearTimeout(saveTimer)
      listeners.clear()
    },
  }
}
