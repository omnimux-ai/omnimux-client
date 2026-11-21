import { ClipDomainError } from '../../errors.js'
import { nativeProjectView } from '../../timeline/nativeProjectView.js'
import { calculateProjectDuration } from '../openreel/core/timeline/project-duration'
import { getTimelineItems, resolveTimelineItem, getCompoundClipId } from '../openreel/core/timeline/timeline-items'
import type { Project } from '../openreel/core/types/project'
import { getRenderBridge } from '../openreel/web/bridges/render-bridge'
import { useProjectStore } from '../openreel/web/stores/project-store'
import { useTimelineStore } from '../openreel/web/stores/timeline-store'
import { useUIStore, type SelectionItem } from '../openreel/web/stores/ui-store'
import { resolvePlaybackLoop, resolvePlaybackStart } from '../openreel/web/utils/playback-loop'
import { fields, invalid, number, referenceId, type Fields } from './native-input'
import { assertMotionPlaybackSafe, projectWithMotionCodeDisabled } from './native-motion'

const selectionTypes = {
  media: 'clip', text: 'text-clip', shape: 'shape-clip', svg: 'shape-clip',
  sticker: 'shape-clip', adjustment: 'clip', motion: 'motion-instance',
} as const
const MAX_FRAMES = 6

function openProject() {
  const store = useProjectStore.getState()
  if (!store.hasOpenProject) throw ClipDomainError.previewNotReady('Open the project in Clip')
  return store
}

function viewState() {
  const { playheadPosition, playbackState } = useTimelineStore.getState()
  const { selectedItems } = useUIStore.getState()
  return { playheadSec: playheadPosition, isPlaying: playbackState === 'playing', selectedClipIds: selectedItems.map(item => item.id) }
}

interface NativeSnapshotOptions {
  revision?: number
  updatedAt?: number
  binding?: { workspaceId: string; nodeId: string }
  view?: 'summary' | 'tracks' | 'clips' | 'full'
  clipId?: string
  trackId?: string
  trackIndex?: number
  fromSec?: number
  toSec?: number
}

/** Both saved and live projects use the same path- and Blob-free tool projection. */
export function readNativeSnapshot(options: NativeSnapshotOptions = {}) {
  const project = openProject().getFullProject()
  return nativeProjectView({
    projectId: project.id,
    project: { ...project, timeline: { ...project.timeline, duration: calculateProjectDuration(project) } },
    revision: options.revision,
    updatedAt: options.updatedAt ?? project.modifiedAt,
    binding: options.binding,
  }, { view: 'full', ...options, ...viewState() })
}

function playbackTime(value: unknown, name: string, duration: number): number {
  return number(value, name, 0, duration)
}

export async function executeNativeView(args: unknown, { assertCurrent = () => {} }: { assertCurrent?: () => void } = {}) {
  const request = fields(args, 'clip_view arguments')
  assertCurrent()
  const owner = openProject()
  const project = owner.getFullProject()
  const durationSec = calculateProjectDuration(project)
  const timeline = useTimelineStore.getState()
  if (request.action === 'seek' || request.action === 'play') {
    if (timeline.playbackLockedReason || useUIStore.getState().exportState.isExporting) throw ClipDomainError.previewNotReady('Playback is temporarily locked')
  }
  switch (request.action) {
    case 'seek': {
      const time = playbackTime(request.toSec ?? request.fromSec, 'toSec', durationSec)
      assertMotionPlaybackSafe(project, time)
      if (timeline.playbackState === 'playing') timeline.pause()
      timeline.seekTo(time)
      timeline.scrollToPlayhead()
      break
    }
    case 'play': {
      if (durationSec <= 0) throw ClipDomainError.previewNotReady('Place a clip on the timeline before playing')
      assertMotionPlaybackSafe(project)
      const from = request.fromSec === undefined ? undefined : playbackTime(request.fromSec, 'fromSec', durationSec)
      if (from !== undefined || timeline.playbackState !== 'playing') {
        const time = resolvePlaybackStart(from ?? timeline.playheadPosition, durationSec, resolvePlaybackLoop(timeline, durationSec))
        if (timeline.playbackState === 'playing' && time !== timeline.playheadPosition) {
          timeline.pause()
          // The Program monitor owns the live playback loop. Let the paused
          // state tear down its clock before restarting it at the new time.
          await new Promise<void>(resolve => setTimeout(resolve, 0))
          assertCurrent()
          const current = openProject()
          if (current.project !== owner.project || useTimelineStore.getState().playbackState !== 'paused') {
            throw ClipDomainError.previewNotReady('The playback target changed')
          }
        }
        timeline.seekTo(time)
      }
      timeline.play()
      if (useTimelineStore.getState().playbackState !== 'playing') throw ClipDomainError.previewNotReady('Playback is temporarily locked')
      break
    }
    case 'pause':
      timeline.pause()
      break
    case 'select_clips': {
      if (!Array.isArray(request.clipIds)) invalid('clipIds must be an array')
      const selected = [...new Set(request.clipIds.map(id => referenceId(id, 'clipId')))]
      const items: SelectionItem[] = selected.map(id => {
        const item = resolveTimelineItem(project, id)
        if (!item || !project.timeline.tracks.some(track => track.id === item.trackId)) {
          const subtitle = project.timeline.subtitles.find(subtitle => subtitle.id === id)
          if (subtitle) return { id, type: 'subtitle' }
          throw ClipDomainError.notFound('A selected clip is missing from the active timeline')
        }
        return { id, type: selectionTypes[item.kind], trackId: item.trackId }
      })
      useUIStore.getState().selectMultiple(items)
      break
    }
    default:
      invalid('Choose seek, play, pause or select_clips')
  }
  return { projectId: project.id, action: request.action, durationSec, ...viewState() }
}

function sampleTimes(args: Fields, duration: number): number[] {
  if (args.times !== undefined) {
    if (args.fromSec !== undefined || args.toSec !== undefined) invalid('Choose explicit frame times or a frame range')
    if (!Array.isArray(args.times) || !args.times.length || args.times.length > MAX_FRAMES) invalid('Provide between one and six frame times')
    return args.times.map((time, index) => playbackTime(time, `times[${index}]`, duration))
  }
  if (args.fromSec === undefined && args.toSec === undefined) return [Math.min(useTimelineStore.getState().playheadPosition, duration)]
  const start = playbackTime(args.fromSec, 'fromSec', duration)
  const end = playbackTime(args.toSec, 'toSec', duration)
  if (end <= start) invalid('Provide fromSec < toSec')
  const count = args.count === undefined ? MAX_FRAMES : number(args.count, 'count', 1, MAX_FRAMES)
  if (!Number.isSafeInteger(count)) invalid('count must be a frame count')
  return Array.from({ length: count }, (_, index) => start + (end - start) * (index + 0.5) / count)
}

function assertAvailablePicture(project: Project, time: number): void {
  const visible = new Set(project.timeline.tracks.filter(track => !track.hidden).map(track => track.id))
  for (const item of getTimelineItems(project)) {
    if (item.kind !== 'media' || !visible.has(item.trackId) || time < item.startTime || time >= item.startTime + item.duration
      || getCompoundClipId(item.item) || item.item.metadata?.motionClip) continue
    const media = item.mediaItem
    if (!media || (media.type !== 'audio' && (media.isPlaceholder || !(media.blob || media.fileHandle || media.nativeSource)))) {
      throw ClipDomainError.mediaMissing('Relink the missing frame source in Clip')
    }
  }
}

export async function captureNativeFrames(args: unknown, { assertCurrent }: { assertCurrent: () => void }) {
  const request = fields(args, 'clip_snapshot arguments')
  assertCurrent()
  const owner = openProject()
  const project = owner.getFullProject()
  const duration = calculateProjectDuration(project)
  const times = sampleTimes(request, duration)
  const { width, height, frameRate } = project.settings
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 2 || height < 2) {
    throw ClipDomainError.previewNotReady('A valid project resolution is required for frame capture')
  }
  const current = () => {
    assertCurrent()
    const state = openProject()
    if (state.project !== owner.project || state.actionExecutor !== owner.actionExecutor) {
      throw new ClipDomainError('REVISION_CONFLICT', 'The active project changed during frame capture')
    }
    if (useUIStore.getState().exportState.isExporting || useTimelineStore.getState().playbackLockedReason) {
      throw ClipDomainError.previewNotReady('Wait for the current render to finish')
    }
  }
  const renderProject = projectWithMotionCodeDisabled(project)
  const frames = []
  for (const requested of times) {
    // The terminal playhead position is the end boundary, after the last frame.
    const time = duration > 0 && requested === duration ? Math.max(0, duration - 1 / frameRate) : requested
    const verify = () => { current(); assertMotionPlaybackSafe(project, time) }
    verify()
    assertAvailablePicture(project, time)
    const frame = await getRenderBridge().captureProjectPng(renderProject, time, verify).catch(error => {
      if (error instanceof ClipDomainError || typeof error?.code === 'string') throw error
      throw ClipDomainError.previewNotReady('OpenReel could not capture the composite frame')
    })
    verify()
    if (!frame) throw ClipDomainError.previewNotReady('The native preview renderer did not return a frame')
    frames.push({ ...frame, ...(time !== requested ? { requestedTimeSec: requested } : {}) })
  }
  return { frames }
}
