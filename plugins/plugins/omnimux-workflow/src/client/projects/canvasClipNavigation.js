import { isCanvasClipBinding, sameClipBinding } from '../../canvas/bridge/clipEvents.ts'
import { collectTabs } from './projectCanvas.js'

export function visibleClipBinding(host) {
  if (host?.dataset.visible !== 'true') return undefined
  const portal = host.querySelector(':scope > [data-clip-mode="canvas"][data-visible="true"]')
  const { clipWorkspaceId, clipNodeId, clipProjectId } = portal?.dataset ?? {}
  const binding = { workspaceId: clipWorkspaceId, nodeId: clipNodeId, projectId: clipProjectId }
  return isCanvasClipBinding(binding) ? binding : undefined
}

export function readCanvasClipNavigation(meta) {
  const clip = meta?.clip ?? meta?.extra?.clip
  if (clip?.mode !== 'canvas' || !isCanvasClipBinding(clip)) return undefined
  if ([meta.workspaceId, meta.extra?.workspaceId].some(id => id !== undefined && id !== clip.workspaceId)) return undefined
  if (meta.clip && meta.extra?.clip && (meta.extra.clip.mode !== 'canvas' || !sameClipBinding(meta.extra.clip, clip))) {
    return undefined
  }
  const { workspaceId, nodeId, projectId } = clip
  return { workspaceId, nodeId, projectId }
}

/** Consume the request from the live tab before waiting for the canvas island. */
export function claimCanvasClipNavigation({ sidebar, sessionId, tabId, binding, pageId }) {
  if (!tabId || !sessionId || typeof sidebar?.updateTab !== 'function') return false
  const snapshot = sidebar.getSnapshot?.()
  if (snapshot?.sessionId !== sessionId) return false
  const tab = [
    ...collectTabs(snapshot.state?.splits),
    ...collectTabs(snapshot.state?.bottomSplits),
  ].find(item => item.id === tabId)
  if (!sameClipBinding(readCanvasClipNavigation(tab?.meta), binding)) return false
  const meta = { ...tab.meta, clip: null, ...(pageId ? { pageId } : {}) }
  if (meta.extra?.clip) meta.extra = { ...meta.extra, clip: null }
  return sidebar.updateTab(tabId, { meta }) !== false
}
