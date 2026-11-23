import { normalizeMediaHandle, sha256Digest } from '../../timeline/nativeProjectFields.js'
import { uploadClipExport } from './export-transport.js'
import { fetchMediaTransferBlob } from './host-media'
import { LiveClipError } from './persistence.js'
import { mediaDigest } from './media-source'
import { useProjectStore } from '../openreel/web/stores/project-store'

interface Command {
  operation: 'clip_get' | 'clip_view' | 'clip_edit' | 'clip_snapshot' | 'clip_export'
  projectId: string
  args: Record<string, unknown>
  binding?: { workspaceId: string; nodeId: string; projectId: string }
  revisionEpoch?: number
  exportJobId?: number
  uploadToken?: string
}

interface Execution {
  assertCurrent: () => void
  revision: () => number
  signal: AbortSignal
}

const HOST_MEDIA_PATH = '/omnimux-workflow/api/local-file'
const MAX_FRAME_BYTES = 8 * 1024 * 1024
const MAX_CAPTURE_BYTES = 24 * 1024 * 1024
const EXPORT_PRESETS = { '720p': [1280, 720], '1080p': [1920, 1080], '4k': [3840, 2160] } as const

async function base64Png(png: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new LiveClipError('PREVIEW_NOT_READY', 'The preview frame could not be read.'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.readAsDataURL(png)
  })
}

async function resolveMedia(op: Record<string, unknown>, run: Execution, binding?: Command['binding']) {
  const resolvedMedia = op.resolvedMedia as Record<string, unknown> | undefined
  if (resolvedMedia && typeof resolvedMedia === 'object' && !Array.isArray(resolvedMedia)) {
    const transferUrl = typeof resolvedMedia.transferUrl === 'string' ? resolvedMedia.transferUrl : ''
    const expectedDigest = sha256Digest(resolvedMedia.sha256)
    const handle = normalizeMediaHandle(resolvedMedia.handle, binding?.workspaceId)
    if (!transferUrl.startsWith('/omnimux-clip/api/media-transfer/') || !expectedDigest || !handle) {
      throw new LiveClipError('path-denied', 'The media handle transfer reference is invalid.')
    }
    const fetched = await fetchMediaTransferBlob(transferUrl, { expectedDigest, signal: run.signal })
    run.assertCurrent()
    if (!fetched.ok || !fetched.blob) {
      const code = fetched.status === 403 ? 'path-denied'
        : fetched.status === 409 ? 'media-version-mismatch'
          : fetched.status === 415 ? 'unsupported-media'
            : (fetched.code || 'media_missing')
      throw new LiveClipError(code, 'The Host could not stream the authorized media handle.')
    }
    const digest = fetched.digest ?? expectedDigest
    const rawName = typeof resolvedMedia.name === 'string' ? resolvedMedia.name.split(/[/\\]/u).at(-1)?.trim() : ''
    const filename = rawName || 'media'
    const mimeType = fetched.blob.type || (typeof resolvedMedia.mimeType === 'string' ? resolvedMedia.mimeType : '')
    const sourceId = typeof resolvedMedia.sourceId === 'string' && resolvedMedia.sourceId ? resolvedMedia.sourceId : undefined
    return {
      file: new File([fetched.blob], filename, { type: mimeType }),
      source: {
        ...(sourceId ? { id: sourceId } : {}),
        version: `sha256:${digest}`,
        digest,
        handle: { ...handle, sha256: digest },
      },
    }
  }
  if (typeof op.sourceUrl !== 'string' || !op.sourceUrl.startsWith(`${HOST_MEDIA_PATH}?`)) {
    throw new LiveClipError('path-denied', 'The media must use the authorized Host reference.')
  }
  const url = new URL(op.sourceUrl, 'http://localhost')
  const path = url.searchParams.get('path')
  const version = url.searchParams.get('rev')
  if (url.pathname !== HOST_MEDIA_PATH || !path || !version) throw new LiveClipError('path-denied', 'The media reference is invalid.')
  const response = await fetch(op.sourceUrl, { signal: run.signal, redirect: 'error' })
  run.assertCurrent()
  if (!response.ok) {
    const code = response.status === 403 ? 'path-denied' : 'media_missing'
    throw new LiveClipError(code, 'The Host could not read the requested media.')
  }
  const blob = await response.blob()
  const [sourceId, sourceVersion] = await Promise.all([mediaDigest(path), mediaDigest(version)])
  run.assertCurrent()
  const filename = path.split(/[/\\]/).pop() || 'media'
  return { file: new File([blob], filename, { type: blob.type }), source: { id: sourceId, version: sourceVersion } }
}

function exportSettings(args: Command['args'], width: number, height: number) {
  const settings = typeof args.fps === 'number' ? { frameRate: args.fps } : {}
  if (typeof args.resolution !== 'string' || !Object.hasOwn(EXPORT_PRESETS, args.resolution)) return settings
  const [long, short] = EXPORT_PRESETS[args.resolution as keyof typeof EXPORT_PRESETS]
  const bounds = width >= height ? [long, short] : [short, long]
  const ratio = Math.min(bounds[0] / width, bounds[1] / height)
  return { ...settings, width: Math.max(2, Math.floor(width * ratio / 2) * 2), height: Math.max(2, Math.floor(height * ratio / 2) * 2) }
}

export async function runNativeCommand(command: Command, run: Execution) {
  const { operation, args } = command
  if (operation === 'clip_get') {
    const { readNativeSnapshot } = await import('./native-view')
    run.assertCurrent()
    return { ...readNativeSnapshot({ ...args, binding: command.binding, revision: run.revision() }), revisionEpoch: command.revisionEpoch ?? 0 }
  }
  if (operation === 'clip_edit') {
    const { executeNativeEdit } = await import('./native-edit')
    return executeNativeEdit(args, { assertCurrent: run.assertCurrent, resolveMedia: op => resolveMedia(op, run, command.binding) })
  }
  if (operation === 'clip_view') {
    const { executeNativeView } = await import('./native-view')
    return executeNativeView(args, run)
  }
  if (operation === 'clip_snapshot') {
    const { captureNativeFrames } = await import('./native-view')
    const { frames } = await captureNativeFrames(args, run)
    if (frames.some(frame => frame.png.size > MAX_FRAME_BYTES) || frames.reduce((bytes, frame) => bytes + frame.png.size, 0) > MAX_CAPTURE_BYTES) {
      throw new LiveClipError('PREVIEW_NOT_READY', 'This capture exceeds the preview size limit. Capture fewer frames.')
    }
    const encoded = await Promise.all(frames.map(async frame => ({
      timeSec: frame.timeSec, requestedTimeSec: frame.requestedTimeSec,
      width: frame.width, height: frame.height, base64: await base64Png(frame.png),
    })))
    run.assertCurrent()
    return { frames: encoded }
  }
  if (operation === 'clip_export') {
    const { exportNativeProject } = await import('./native-export')
    run.assertCurrent()
    const { exportJobId, uploadToken, projectId } = command
    if (typeof exportJobId !== 'number' || !Number.isSafeInteger(exportJobId) || !uploadToken) {
      throw new LiveClipError('INVALID_RECEIPT', 'The Clip export task has no upload authorization.')
    }
    const project = useProjectStore.getState().getFullProject()
    const { width, height } = project.settings
    return exportNativeProject({ project, settings: exportSettings(args, width, height) }, {
      assertCurrent: run.assertCurrent,
      upload: blob => uploadClipExport({ exportJobId, projectId, uploadToken }, blob),
    })
  }
  throw new LiveClipError('invalid-json', 'The Clip command is unsupported.')
}
