import { CANVAS_TAB, STUDIO_TAB } from './editor-session.js'
import { readReturnedMedia } from './media-bridge-source.js'

export function createMediaHandoff({ window, session, closePortal }) {
  const outgoing = new Map()
  const incoming = new Map()
  const listeners = new Set()
  let disposed = false
  const workbench = () => window.__omnimuxWorkbench
  const push = () => { for (const listener of listeners) listener() }

  function editorAt(editorId) {
    const owner = session.getOwner()
    return !disposed && owner && owner.site.entry.id === editorId && !owner.ingesting && !owner.conflict && session.owns(owner) ? owner : undefined
  }

  function captureEditor(editorId) {
    const owner = editorAt(editorId)
    if (!owner) return undefined
    const { token, revisionEpoch } = owner
    return {
      signal: token.signal,
      isCurrent: () => editorAt(editorId) === owner && owner.token === token && owner.revisionEpoch === revisionEpoch,
    }
  }

  async function returnToStudio(trip, rows) {
    const { sessionId, projectId, tabInstanceId, id } = trip
    const surface = workbench()?.getActiveSurface?.()
    if (disposed || outgoing.get(sessionId) !== trip || !trip.ready || trip.returning
      || !surface?.panelOpen || surface.sessionId !== sessionId || surface.tabId !== CANVAS_TAB) return false
    const items = readReturnedMedia(rows)
    if (!items) return false
    trip.returning = true
    let opened = false
    try {
      // The tab seed only carries a key. Media locators stay in this renderer.
      opened = await workbench()?.open?.({
        tabId: STUDIO_TAB, id: tabInstanceId, sessionId, preserveLayout: true,
        meta: { clip: { mode: 'standalone', projectId, requestId: id, mediaReturn: true } },
      }) === true
      if (!opened || disposed || outgoing.get(sessionId) !== trip) return false
      if (items.length) {
        incoming.set(sessionId, { id, projectId, items })
        push()
      }
      outgoing.delete(sessionId)
      return true
    } catch (error) {
      console.warn('[Clip] Return to the original project failed.', error?.name)
      return false
    } finally {
      trip.returning = false
    }
  }

  async function openCanvas(editorId) {
    const owner = editorAt(editorId)
    if (!owner) return 'stale'
    const workflow = window.__omnimuxWorkflow
    if (typeof workflow?.prepareClipMediaReturn !== 'function') return 'unavailable'
    const { sessionId, projectId, tabInstanceId, mode, binding } = owner.site
    const trip = { id: crypto.randomUUID(), sessionId, projectId, tabInstanceId, mode, binding }
    const previous = outgoing.get(sessionId)
    let failure = 'save-failed'
    try {
      const opened = await session.leaveForMedia(owner, async isCurrent => {
        failure = 'unavailable'
        const prepared = await workflow.prepareClipMediaReturn({
          id: trip.id, mode, sessionId, projectId, title: owner.record.project.name,
          ...(binding ? { workspaceId: binding.workspaceId, nodeId: binding.nodeId } : {}),
          isCurrent, returnToStudio: rows => returnToStudio(trip, rows),
        })
        trip.handle = prepared
        if (!isCurrent() || disposed) {
          failure = 'stale'
          return false
        }
        if (!prepared) return false
        outgoing.set(sessionId, trip)
        if (mode === 'canvas') {
          if (prepared.activate() !== true || !closePortal(binding)) return false
        } else if (!await prepared.activate()) {
          return false
        }
        trip.ready = true
        return true
      })
      if (opened && trip.ready && !disposed) {
        previous?.handle?.dispose()
        return 'opened'
      }
    } catch (error) {
      console.warn('[Clip] Canvas media handoff failed.', error?.name)
    }
    if (outgoing.get(sessionId) === trip) {
      if (previous && !disposed) outgoing.set(sessionId, previous)
      else outgoing.delete(sessionId)
    }
    trip.handle?.dispose()
    return failure
  }

  return {
    captureEditor,
    openCanvas,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getIncoming(editorId, requestId) {
      if (!requestId) return undefined
      const owner = editorAt(editorId)
      const entry = incoming.get(owner?.site.sessionId)
      return entry?.id === requestId && entry.projectId === owner?.site.projectId ? entry : undefined
    },
    acknowledge(editorId, requestId) {
      if (!this.getIncoming(editorId, requestId)) return
      incoming.delete(session.getOwner().site.sessionId)
      push()
    },
    acceptCanvasReturn(payload) {
      const surface = workbench()?.getActiveSurface?.()
      if (disposed || !surface?.panelOpen || surface.tabId !== CANVAS_TAB) return false
      const trip = outgoing.get(surface.sessionId)
      if (!trip?.ready || trip.mode !== 'canvas' || trip.id !== payload.mediaReturn?.requestId
        || trip.binding?.workspaceId !== payload.workspaceId || trip.binding?.nodeId !== payload.nodeId
        || trip.projectId !== payload.projectId) return false
      outgoing.delete(surface.sessionId)
      return true
    },
    dispose() {
      disposed = true
      for (const trip of outgoing.values()) trip.handle?.dispose()
      outgoing.clear()
      incoming.clear()
      listeners.clear()
    },
  }
}
