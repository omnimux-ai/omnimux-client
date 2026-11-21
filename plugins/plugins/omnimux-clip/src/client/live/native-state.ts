import type { MediaItem, Project } from '@openreel/core'
import { reconnectMediaUrl } from '../../timeline/nativeProjectFields.js'
import { nativeProjectView } from '../../timeline/nativeProjectView.js'
import { calculateProjectDuration } from '../openreel/core/timeline/project-duration'
import { useProjectStore } from '../openreel/web/stores/project-store'
import { useTimelineStore } from '../openreel/web/stores/timeline-store'
import { useUIStore } from '../openreel/web/stores/ui-store'
import { useEngineStore } from '../openreel/web/stores/engine-store'
import { loadEngineModules } from '../openreel/web/services/lazy-engines'
import { getOpenReelRoute, resetOpenReelRouter } from '../openreel/web/hooks/use-router'
import { loadMediaRecord } from '../openreel/web/services/media-storage'
import { createMissingMediaItem, restoreMediaItem } from '../openreel/web/utils/media-recovery'
import { mediaDigest } from './media-source'

interface LocalSnapshot {
  project: Project
  media: Record<string, Blob>
}

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

async function recoverMedia(item: MediaItem, record: LocalSnapshot, isCurrent: () => boolean) {
  let blob = record.media[item.id]
  const expectedSize = item.sourceFile?.size || item.metadata.fileSize
  const expectedDigest = item.omnimuxSource?.digest
  if (!blob) {
    const stored = await loadMediaRecord(item.sourceRef?.key ?? item.id)
    const legacyOwner = item.sourceRef?.projectId ?? record.project.id
    if (stored?.projectId === legacyOwner && (!expectedSize || stored.blob.size === expectedSize)
      && (!expectedDigest || await mediaDigest(stored.blob) === expectedDigest)) blob = stored.blob
  }
  if (!isCurrent()) return item
  if (!blob && item.nativeSource) return item
  const url = !blob && expectedDigest && reconnectMediaUrl(item.omnimuxSource?.url)
  if (url) {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(12_000) })
    if (response.ok && isCurrent()) {
      const candidate = await response.blob()
      if (candidate.size && (!expectedSize || candidate.size === expectedSize)
        && await mediaDigest(candidate) === expectedDigest) blob = candidate
    }
  }
  if (!isCurrent()) return item
  const restored = await restoreMediaItem(item, blob)
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
  async welcome(isCurrent: () => boolean) {
    await waitForSharedRenderer()
    if (!isCurrent()) return
    suspend()
    useProjectStore.setState({ hasOpenProject: false })
    resetOpenReelRouter()
  },
  async load(record: LocalSnapshot, isCurrent: () => boolean) {
    await loadEngineModules()
    if (!isCurrent()) return
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
          restored = await recoverMedia(item, record, isCurrent)
        } catch (error) {
          console.warn('[Clip] Media recovery failed.', (error as Error)?.name)
          restored = createMissingMediaItem(item)
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
