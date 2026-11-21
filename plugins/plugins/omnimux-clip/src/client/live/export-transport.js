import { LiveClipError, requestClip } from './persistence.js'

/** Reserve the current canvas revision before encoding a manual export. */
export async function reserveCanvasExport({ workspaceId, nodeId, projectId }) {
  const events = window.__omnimuxHubEvents
  const windowId = events?.getWindowId?.()
  if (!windowId || !events.windowFetch || !events.pushViewport) {
    throw new LiveClipError('EDITOR_OFFLINE', 'The Clip window is offline.')
  }
  const viewport = window.__omnimuxWorkbench?.getUiContext?.()
  const clip = viewport?.view?.extra?.clip
  const tabInstanceId = viewport?.surface?.instanceId
  if (!tabInstanceId || !clip?.editorInstanceId || clip.mode !== 'canvas'
    || clip.workspaceId !== workspaceId || clip.nodeId !== nodeId || clip.projectId !== projectId) {
    throw new LiveClipError('EDITOR_NOT_VISIBLE', 'The export must start in the original canvas editor.')
  }
  const body = {
    requestId: crypto.randomUUID(), binding: { workspaceId, nodeId, projectId },
    tabInstanceId, editorInstanceId: clip.editorInstanceId, projectRevision: clip.revision,
    revisionEpoch: clip.revisionEpoch,
  }
  if (!await events.pushViewport()) throw new LiveClipError('EDITOR_OFFLINE', 'The Clip window is offline.')
  const job = await requestClip('/exports/reserve', {
    method: 'POST', body, fetcher: (path, init) => events.windowFetch(path, init, windowId),
  })
  if (job?.requestId !== body.requestId || job.projectId !== projectId || job.projectRevision !== body.projectRevision
    || (job.revisionEpoch ?? 0) !== (body.revisionEpoch ?? 0)
    || !Number.isSafeInteger(job.exportJobId) || job.exportJobId < 1 || !/^[A-Za-z0-9_-]{43}$/.test(job.uploadToken)) {
    throw new LiveClipError('INVALID_RECEIPT', 'The Clip export task has no upload authorization.')
  }
  return job
}

/** A reserved task keeps its original upload authorization after editor exit. */
export function uploadClipExport({ exportJobId, uploadToken, projectId }, blob, signal) {
  return requestClip(`/exports/${exportJobId}/upload?projectId=${encodeURIComponent(projectId)}`, {
    method: 'POST', body: blob, timeout: 120_000, signal,
    headers: { 'Content-Type': 'application/octet-stream', 'x-clip-export-proof': uploadToken },
  })
}

export async function cancelClipExport({ exportJobId, uploadToken, projectId }) {
  const receipt = await requestClip(`/exports/${exportJobId}/cancel?projectId=${encodeURIComponent(projectId)}`, {
    method: 'POST', headers: { 'x-clip-export-proof': uploadToken },
  })
  if (receipt?.exportJobId !== exportJobId || receipt.projectId !== projectId
    || (!['cancelled', 'upload-failed', 'expired'].includes(receipt.status) && receipt.fileSaved !== true)) {
    throw new LiveClipError('INVALID_RECEIPT', 'The Clip Host could not confirm the export status.')
  }
  return receipt
}
