import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { sameClipBinding } from '../../canvas/bridge/clipEvents.ts'
import { visibleClipBinding } from './canvasClipNavigation.js'
import { readClipMediaReturn } from './clipMediaReturn.js'

const snoopNothing = () => () => {}
const readNothing = () => undefined
const clipPortalSelector = ':scope > [data-clip-mode="canvas"]'

function watchClipPortal(host, listener) {
  if (!host || typeof MutationObserver !== 'function') return snoopNothing()
  const attrs = new MutationObserver(listener)
  const observePortal = () => {
    attrs.disconnect()
    const portal = host.querySelector(clipPortalSelector)
    if (portal) attrs.observe(portal, { attributes: true, attributeFilter: [
      'data-visible', 'data-clip-workspace-id', 'data-clip-node-id', 'data-clip-project-id',
    ] })
  }
  const children = new MutationObserver(() => { observePortal(); listener() })
  children.observe(host, { childList: true })
  observePortal()
  return () => { children.disconnect(); attrs.disconnect() }
}

function hasVisibleClipPortal(host) {
  return host?.querySelector(`${clipPortalSelector}[data-visible="true"]`) != null
}

function confirmClipPortal(host, binding, isCurrent) {
  return new Promise(resolve => {
    const finish = confirmed => { stop(); clearTimeout(timeout); resolve(confirmed) }
    const check = () => {
      if (!isCurrent()) finish(false)
      else if (sameClipBinding(visibleClipBinding(host), binding)) finish(true)
    }
    const stop = watchClipPortal(host, check)
    const timeout = setTimeout(() => finish(false), 2200)
    check()
  })
}

export function useCanvasClipMediaReturn({ manager, hostRef, sessionId, tab, visible, initialWorkspaceId, workspaceContext }) {
  const tabId = tab?.id
  const identity = useMemo(() => ({}), [sessionId, tabId, initialWorkspaceId])
  const [mounted, setMounted] = useState(null)
  const registered = mounted?.identity === identity ? mounted : null
  const workspaceId = registered?.workspaceId ?? initialWorkspaceId
  const adapter = registered?.adapter?.isReady() ? registered.adapter : undefined
  const current = useRef(null)
  const ticket = useMemo(() => ({}), [identity, visible, workspaceId, adapter])
  current.current = { workspaceId, adapter, visible, ticket, tab }

  const registerMediaReturnCanvas = useCallback(canvas => {
    if (canvas.initialWorkspaceId !== initialWorkspaceId) return snoopNothing()
    setMounted({ identity, workspaceId: canvas.workspaceId, adapter: canvas })
    return () => setMounted(value => value?.adapter === canvas ? { ...value, adapter: undefined } : value)
  }, [identity, initialWorkspaceId])

  const onActivePageChange = useCallback(newWorkspaceId => {
    // A page switch invalidates clicks from the previous canvas before React commits.
    current.current = { ...current.current, workspaceId: newWorkspaceId, adapter: undefined, ticket: {} }
    setMounted({ identity, workspaceId: newWorkspaceId })
    void workspaceContext?.refresh?.()
  }, [identity, workspaceContext])

  useLayoutEffect(() => {
    if (!manager || !sessionId || !tabId) return undefined
    return manager.registerSeat(sessionId, tabId, {
      read() {
        const host = hostRef.current
        const live = current.current
        return {
          tab: live.tab,
          workspaceId: live.workspaceId,
          adapter: live.adapter?.isReady() ? live.adapter : undefined,
          visible: live.visible && host?.isConnected && host.dataset.visible === 'true',
          portal: visibleClipBinding(host),
        }
      },
    })
  }, [manager, sessionId, tabId, hostRef])

  const transfers = useSyncExternalStore(manager?.subscribe ?? snoopNothing, manager?.getSnapshot ?? readNothing)
  const pending = readClipMediaReturn(transfers, sessionId, workspaceId)
  const readPortal = useCallback(() => Boolean(pending && hasVisibleClipPortal(hostRef.current)), [pending, hostRef])
  const subscribePortal = useCallback(listener => pending ? watchClipPortal(hostRef.current, listener) : snoopNothing(), [pending, hostRef])
  const portalOpen = useSyncExternalStore(subscribePortal, readPortal)
  const record = visible && !portalOpen && pending && manager.isBound(pending.transfer) ? pending : undefined
  const transfer = record?.transfer
  const clipMediaFocus = useMemo(() => transfer?.mode === 'canvas' && adapter ? {
    requestId: transfer.requestId, workspaceId: transfer.workspaceId, nodeId: transfer.nodeId, projectId: transfer.projectId,
  } : undefined, [transfer, adapter])

  const isCurrent = () => Boolean(transfer && current.current.ticket === ticket && current.current.visible
    && hostRef.current?.isConnected && hostRef.current.dataset.visible === 'true' && manager.isBound(transfer))
  return {
    workspaceId,
    adapter,
    record,
    clipMediaFocus,
    isCurrent,
    existingWorkspaceOnly: Boolean(readClipMediaReturn(transfers, sessionId, initialWorkspaceId)),
    registerMediaReturnCanvas: manager ? registerMediaReturnCanvas : undefined,
    onActivePageChange,
    mediaReturn: transfer?.mode === 'canvas' ? {
      requestId: transfer.requestId,
      baseline: transfer.baseline,
      canOpen: () => !hasVisibleClipPortal(hostRef.current),
      confirmOpened: binding => confirmClipPortal(hostRef.current, binding, isCurrent),
    } : undefined,
  }
}
