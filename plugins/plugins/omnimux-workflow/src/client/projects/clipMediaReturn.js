import { isCanvasClipBinding, isClipProjectId, sameClipBinding } from '../../canvas/bridge/clipEvents.ts'
import { WORKFLOW_API_ROUTES } from '../../shared/api.ts'
import { workflowRequest } from '../api.js'
import { CANVAS_SENTINEL_PATH, CANVAS_TAB_ID, collectTabs } from './projectCanvas.js'

const transferKey = (sessionId, workspaceId) => `${sessionId}\u0000${workspaceId}`
const isCanvasTab = tab => tab?.type === CANVAS_TAB_ID || tab?.id === CANVAS_TAB_ID

async function existingCanvas(workspaceId) {
  const result = await workflowRequest(WORKFLOW_API_ROUTES.workspaceVersion(encodeURIComponent(workspaceId)))
  return result.ok && result.body?.id === workspaceId
}

/** Own the ephemeral handoff at Workflow Client lifetime, including tab remounts. */
export function createClipMediaReturn({ workspaceContext, getSidebar, getSidebarRight, t, workspaceExists = existingCanvas }) {
  let disposed = false
  let transfers = new Map()
  const listeners = new Set()
  const seats = new Map()
  const publish = (key, state) => {
    transfers = new Map(transfers)
    if (state) transfers.set(key, state)
    else transfers.delete(key)
    for (const listener of listeners) listener()
  }

  function scope(sessionId) {
    if (disposed) return undefined
    const context = workspaceContext.getSnapshot()
    const sidebar = getSidebar()
    const snapshot = sidebar?.getSnapshot?.()
    const sidebarRight = getSidebarRight?.()
    const mounted = sidebarRight?.mounted?.getSnapshot?.()
    if (context.status !== 'ready' || context.sessionId !== sessionId || snapshot?.sessionId !== sessionId
      || (mounted !== undefined && mounted !== sessionId)) return undefined
    return { ...context, sidebar, sidebarRight, state: snapshot.state }
  }

  function plan(request) {
    const current = scope(request.sessionId)
    if (!current || !Array.isArray(current.project?.pages)) return undefined
    // Native right-sidebar tabs do not appear in betterSidebar's legacy split tree.
    const inventory = current.sidebarRight?.openTabs?.getSnapshot?.()
    const tabs = Array.isArray(inventory)
      ? inventory.filter(row => row.sessionId === request.sessionId && row.kind === CANVAS_TAB_ID)
        .map(row => ({ id: row.tabId }))
      : [...collectTabs(current.state?.splits), ...collectTabs(current.state?.bottomSplits)].filter(isCanvasTab)
    if (tabs.length > 1) return undefined
    const openTab = tabs[0]
    const seat = openTab && seats.get(transferKey(request.sessionId, openTab.id))
    const canvas = seat?.read()
    const tab = canvas?.tab ?? openTab
    const meta = tab?.meta
    const exact = current.project.pages.find(page => page.canvasWorkspaceId === canvas?.workspaceId)
    const tabPage = tab && (!meta?.canvasSessionId || meta.canvasSessionId === request.sessionId)
      ? current.project.pages.find(page => page.id === meta?.pageId) : undefined
    const page = exact ?? tabPage ?? current.activePage
    if (!page || !/^ws_[A-Za-z0-9_-]{1,128}$/u.test(page.canvasWorkspaceId ?? '')) return undefined
    if (request.mode === 'canvas' && (!canvas?.adapter || !canvas.visible || !sameClipBinding(canvas.portal, request)
      || canvas.workspaceId !== request.workspaceId || page.canvasWorkspaceId !== request.workspaceId)) return undefined
    return { ...current, tab, seat, canvas, page }
  }

  function sameTarget(first, next) {
    return next && first.sidebar === next.sidebar && first.sidebarRight === next.sidebarRight
      && first.workspaceId === next.workspaceId && first.workspacePath === next.workspacePath && first.project.id === next.project.id
      && first.page.id === next.page.id && first.page.canvasWorkspaceId === next.page.canvasWorkspaceId
      && first.tab?.id === next.tab?.id
  }

  function prepare(request) {
    if (!request || !['canvas', 'standalone'].includes(request.mode) || !isClipProjectId(request.projectId)
      || typeof request.id !== 'string' || !request.id || typeof request.sessionId !== 'string' || !request.sessionId
      || typeof request.title !== 'string' || typeof request.isCurrent !== 'function' || !request.isCurrent()
      || (request.mode === 'canvas' ? !isCanvasClipBinding(request) : typeof request.returnToStudio !== 'function')) return undefined
    const original = plan(request)
    if (!original) return undefined
    const workspaceId = original.page.canvasWorkspaceId
    const key = transferKey(request.sessionId, workspaceId)
    if (transfers.has(key)) return undefined
    const transfer = {
      key, workspaceId, sessionId: request.sessionId, projectId: request.projectId, nodeId: request.nodeId,
      requestId: request.id, mode: request.mode, title: request.title, returnToStudio: request.returnToStudio,
      workflowProjectId: original.project.id, workspacePath: original.workspacePath, pageId: original.page.id,
    }
    let cancelled = false
    const dispose = () => {
      cancelled = true
      if (transfers.get(key)?.transfer === transfer) publish(key, undefined)
    }
    const currentPlan = () => {
      if (cancelled || transfers.has(key) || !request.isCurrent()) return undefined
      const current = plan(request)
      return sameTarget(original, current) ? current : undefined
    }
    if (request.mode === 'canvas') {
      return {
        activate() {
          const current = currentPlan()
          if (!current || current.seat !== original.seat || current.canvas.adapter !== original.canvas.adapter) return false
          const baseline = current.canvas.adapter.captureBaseline(transfer)
          if (!baseline) return false
          transfer.baseline = baseline
          publish(key, { transfer })
          return true
        },
        dispose,
      }
    }

    return (async () => {
      if (!await workspaceExists(workspaceId).catch(() => false) || !currentPlan()) return undefined
      return {
        async activate() {
          const current = currentPlan()
          if (!current || !current.sidebar.getTab?.(CANVAS_TAB_ID) || typeof current.sidebar.openTab !== 'function') return false
          const meta = { ...current.tab?.meta, pageId: transfer.pageId, canvasWorkspaceId: workspaceId, canvasSessionId: transfer.sessionId }
          const scope = { sessionId: transfer.sessionId, cwd: transfer.workspacePath, canvasWorkspaceId: workspaceId }
          const seed = { type: CANVAS_TAB_ID, id: CANVAS_TAB_ID, title: current.tab?.title || t('details.canvasTab'), path: CANVAS_SENTINEL_PATH, meta }
          publish(key, { transfer })
          try {
            if (await current.sidebar.openTab(seed, scope) !== false && isBound(transfer)) {
              // Older singleton tabs retain their metadata when openTab focuses them.
              // An already hydrated tab keeps its live page and in-memory graph.
              if (current.tab && !current.canvas?.adapter && current.tab.meta?.pageId !== transfer.pageId) {
                current.sidebar.updateTab?.(current.tab.id, { meta })
              }
              return true
            }
          } catch (error) {
            console.warn('[omnimux-workflow] Clip canvas navigation refused', error?.name)
          }
          dispose()
          return false
        },
        dispose,
      }
    })()
  }

  function isBound(transfer) {
    const current = scope(transfer.sessionId)
    return transfers.get(transfer.key)?.transfer === transfer && current?.workspacePath === transfer.workspacePath
      && current?.project?.id === transfer.workflowProjectId
      && current.project.pages.some(page => page.id === transfer.pageId && page.canvasWorkspaceId === transfer.workspaceId)
  }

  return {
    prepare,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => transfers,
    isBound,
    registerSeat(sessionId, tabId, seat) {
      const key = transferKey(sessionId, tabId)
      seats.set(key, seat)
      return () => { if (seats.get(key) === seat) seats.delete(key) }
    },
    async run(transfer, action) {
      const { key } = transfer
      const item = transfers.get(key)
      if (item?.transfer !== transfer || item.busy || !isBound(transfer)) return
      const busy = { transfer, busy: true }
      publish(key, busy)
      let outcome
      try { outcome = await action() } catch { outcome = 'retry' }
      if (transfers.get(key) !== busy) return
      publish(key, outcome === true ? undefined : { transfer, error: outcome || 'retry' })
    },
    dispose() {
      disposed = true
      transfers = new Map()
      seats.clear()
      listeners.clear()
    },
  }
}

export function readClipMediaReturn(transfers, sessionId, workspaceId) {
  return transfers?.get(transferKey(sessionId, workspaceId))
}
