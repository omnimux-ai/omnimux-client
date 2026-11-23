import type { MediaItem, Project } from '@openreel/core'
import { canvasWorkspaceMediaUrl, mediaContentDigest, normalizeMediaHandle, reconnectMediaUrl, workspaceMediaDigest } from '../../timeline/nativeProjectFields.js'
import { nativeProjectView } from '../../timeline/nativeProjectView.js'
import { calculateProjectDuration } from '../openreel/core/timeline/project-duration'
import { useProjectStore } from '../openreel/web/stores/project-store'
import { useTimelineStore } from '../openreel/web/stores/timeline-store'
import { useUIStore } from '../openreel/web/stores/ui-store'
import { useEngineStore } from '../openreel/web/stores/engine-store'
import { loadEngineModules } from '../openreel/web/services/lazy-engines'
import { saveMediaBlob } from '../openreel/web/services/media-storage'
import { getOpenReelRoute, resetOpenReelRouter } from '../openreel/web/hooks/use-router'
import { createMissingMediaItem, restoreMediaItem } from '../openreel/web/utils/media-recovery'
import { fetchHostMediaBlob, hasAuthenticatedClipHost } from './host-media'
import { mediaDigest, verifiedMediaBlob } from './media-source'
import { createStoredMediaRecovery } from './media-recovery'

interface LocalSnapshot {
  project: Project
  media: Record<string, Blob>
  binding?: { workspaceId: string; nodeId?: string; projectId?: string }
}

let loadGeneration = 0

function capture(): (LocalSnapshot & { fingerprint: string }) | null {
  const state = useProjectStore.getState()
  if (!state.hasOpenProject) return null
  const project = state.getFullProject()
  const media: Record<string, Blob> = Object.create(null)
  const items = project.mediaLibrary.items.map(item => {
    if (item.blob instanceof Blob && item.blob.size) media[item.id] = item.blob
    const ready = !item.isPlaceholder && Boolean(media[item.id] || item.fileHandle || item.nativeSource)
    const sourceRef = ready ? { ...item.sourceRef, kind: 'indexeddb' as const, key: item.id } : item.sourceRef
    return { ...item, sourceRef, missing: !ready, blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null, filmstripThumbnails: undefined }
  })
  const serializable = JSON.stringify({
    ...project,
    timeline: { ...project.timeline, duration: calculateProjectDuration(project) },
    mediaLibrary: { ...project.mediaLibrary, items },
  }, (_key, value: unknown) => value instanceof Blob ? null : value)
  return { project: JSON.parse(serializable) as Project, fingerprint: serializable, media }
}

function suspend() {
  useTimelineStore.getState().pause()
  useUIStore.getState().closeModal()
}

function resetView() {
  const timeline = useTimelineStore.getState()
  timeline.stop()
  timeline.clearLoopRange()
  timeline.setScrollX(0)
  timeline.setScrollY(0)
  useUIStore.getState().clearSelection()
  useTimelineStore.setState({ trackHeights: {} })
}

async function recoverMedia(
  item: MediaItem, record: LocalSnapshot, isCurrent: () => boolean,
  readStored: ReturnType<typeof createStoredMediaRecovery>,
) {
  const workspaceId = record.binding?.workspaceId
  const legacyUrl = item.sourceRef?.kind === 'legacy' ? canvasWorkspaceMediaUrl(item.sourceRef.url, workspaceId) : undefined
  const handle = normalizeMediaHandle(item.omnimuxSource?.handle, workspaceId)
  const expectedDigest = mediaContentDigest(item) ?? workspaceMediaDigest(legacyUrl, workspaceId)
  const inline = record.media?.[item.id]
  // Only the selected snapshot's own bytes can be reused without a digest.
  // A migrated legacy timeline never contained inline bytes.
  let blob = expectedDigest ? await verifiedMediaBlob(inline, expectedDigest)
    : item.sourceRef?.kind !== 'legacy' && inline instanceof Blob && inline.size > 0 ? inline : undefined
  if (!blob && expectedDigest) blob = await readStored(item, expectedDigest)
  if (!isCurrent()) return item
  if (!blob && !expectedDigest && item.sourceRef?.kind !== 'legacy' && item.nativeSource && !item.isPlaceholder) {
    return { ...item, missing: false }
  }
  let resolvedDigest = expectedDigest
  const canUseHostStream = Boolean(
    handle && expectedDigest
    && (handle.scope === 'library-file' || handle.scope === 'clip-vault' || hasAuthenticatedClipHost()),
  )
  if (!blob && canUseHostStream) {
    try {
      const fetched = await fetchHostMediaBlob(record.project.id, item.id, { expectedDigest, timeoutMs: 30_000 })
      if (!isCurrent()) return item
      if (fetched.ok && fetched.blob) {
        blob = fetched.blob
        resolvedDigest = fetched.digest ?? expectedDigest
        void saveMediaBlob(record.project.id, item.id, blob, item.metadata).catch((error: unknown) => {
          console.debug('[Clip] Could not backfill L1 media cache.', (error as Error)?.name)
        })
      } else if (fetched.status === 409) {
        // Disk bytes drifted from expected SHA-256: never silently substitute.
        return { ...createMissingMediaItem(item), missing: true }
      }
    } catch (error) {
      console.warn('[Clip] Host media stream recovery failed.', (error as Error)?.name)
    }
  }
  const url = !blob && expectedDigest && reconnectMediaUrl(item.omnimuxSource?.url, workspaceId)
  if (url && expectedDigest) {
    const response = await fetch(url, {
      redirect: 'error', mode: 'same-origin', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(12_000),
    })
    if (response.ok && isCurrent()) blob = await verifiedMediaBlob(await response.blob(), expectedDigest)
  }
  if (!isCurrent()) return item
  if (!blob) return { ...createMissingMediaItem(item), missing: true }
  const digest = resolvedDigest ?? await mediaDigest(blob)
  const sourceRef = { ...item.sourceRef, kind: 'indexeddb' as const, key: item.id, digest }
  const omnimuxSource = item.omnimuxSource
    ? { ...item.omnimuxSource, digest, ...(handle ? { handle: { ...handle, sha256: digest } } : {}) }
    : (legacyUrl ? {
      id: item.sourceRef?.fingerprint ?? await mediaDigest(legacyUrl), version: digest, url: legacyUrl, digest,
      ...(handle ? { handle: { ...handle, sha256: digest } } : {}),
    } : undefined)
  if (!isCurrent()) return item
  const restored = await restoreMediaItem({ ...item, blob: null, sourceRef, omnimuxSource }, blob)
  return { ...restored, missing: restored.isPlaceholder === true }
}

async function waitForSharedRenderer() {
  const { waitForNativeExportRender } = await import('./native-export')
  await waitForNativeExportRender()
}

export const nativeEditorState = {
  capture,
  suspend,
  projectId: () => {
    const state = useProjectStore.getState()
    return state.hasOpenProject ? state.project.id : null
  },
  subscribe(callback: () => void) {
    return useProjectStore.subscribe((next, old) => {
      if (next.project !== old.project || next.hasOpenProject !== old.hasOpenProject) callback()
    })
  },
  subscribeContext(callback: () => void) {
    const timeline = useTimelineStore.subscribe((next, old) => {
      if (next.playheadPosition !== old.playheadPosition || next.playbackState !== old.playbackState) callback()
    })
    const selection = useUIStore.subscribe((next, old) => {
      if (next.selectedItems !== old.selectedItems) callback()
    })
    const engine = useEngineStore.subscribe((next, old) => {
      if (next.initialized !== old.initialized) callback()
    })
    return () => { timeline(); selection(); engine() }
  },
  async welcome(stillCurrent: () => boolean) {
    if (!stillCurrent()) return
    const generation = ++loadGeneration
    await waitForSharedRenderer()
    if (generation !== loadGeneration || !stillCurrent()) return
    suspend()
    useProjectStore.setState({ hasOpenProject: false })
    resetOpenReelRouter()
  },
  async load(record: LocalSnapshot, stillCurrent: () => boolean) {
    if (!stillCurrent()) return
    const generation = ++loadGeneration
    const isCurrent = () => generation === loadGeneration && stillCurrent()
    await loadEngineModules()
    if (!isCurrent()) return
    const readStored = createStoredMediaRecovery(record.project.id, record.binding, isCurrent)
    const sourceItems = record.project.mediaLibrary.items
    const items: MediaItem[] = []
    const stagedThumbnails = new Set<string>()
    let cursor = 0
    let committed = false
    const restoreNext = async () => {
      while (isCurrent() && cursor < sourceItems.length) {
        const index = cursor++
        const item = sourceItems[index]
        let restored
        try {
          restored = await recoverMedia(item, record, isCurrent, readStored)
        } catch (error) {
          console.warn('[Clip] Media recovery failed.', (error as Error)?.name)
          restored = { ...createMissingMediaItem(item), missing: true }
        }
        const url = restored.thumbnailUrl
        if (url?.startsWith('blob:') && url !== item.thumbnailUrl) stagedThumbnails.add(url)
        items[index] = restored
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(2, sourceItems.length) }, restoreNext))
      await waitForSharedRenderer()
      if (!isCurrent()) return
      suspend()
      resetView()
      useProjectStore.getState().loadProject({
        ...record.project,
        mediaLibrary: { ...record.project.mediaLibrary, items },
      })
      committed = true
      resetOpenReelRouter({ route: 'editor', params: {} })
    } finally {
      if (!committed) for (const url of stagedThumbnails) URL.revokeObjectURL(url)
    }
  },
  isEditorReady: () => getOpenReelRoute().route === 'editor' && useEngineStore.getState().initialized,
  projection(revision: number) {
    const project = useProjectStore.getState().getFullProject()
    const playheadSec = useTimelineStore.getState().playheadPosition
    const selectedClipIds = useUIStore.getState().selectedItems.map(item => item.id)
    const { projectId, title, selectedClips } = nativeProjectView({ project, projectId: project.id, revision }, { selectedClipIds })
    return { projectId, title, revision, playheadSec, durationSec: calculateProjectDuration(project), selectedClips }
  },
}
