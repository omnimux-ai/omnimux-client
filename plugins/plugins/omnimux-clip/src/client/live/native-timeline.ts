import { ClipDomainError } from '../../errors.js'
import { ActionExecutor } from '../openreel/core/actions/action-executor'
import { createClipFragment, prepareClipSplit } from '../openreel/core/editing/clip-fragments'
import { planClipSpeedEdit } from '../openreel/core/editing/clip-speed-edit'
import { createMediaClip, planExtract, planLift, pruneTransitions } from '../openreel/core/editing/premiere-edits'
import { planRemoveGaps, planRippleDelete, removeClipsById } from '../openreel/core/editing/ripple-delete'
import { CLIP_SPEED_MAX, CLIP_SPEED_MIN } from '../openreel/core/editing/speed-limits'
import { applyTimelineToolEdits, EPS, validateTimelineToolEdits, type TimelineToolPlan } from '../openreel/core/editing/timeline-tool-edit'
import { mediaTrimBounds, subclipRange } from '../openreel/core/media/bins'
import { interpretationSpeed } from '../openreel/core/media/interpretation'
import { getCompoundClipId, getTimelineItemCapabilities, getTimelineItems, getTrackItems, resolveTimelineItem } from '../openreel/core/timeline/timeline-items'
import { resolveTimelinePlacement } from '../openreel/core/timeline/timeline-placement'
import { calculateProjectDuration } from '../openreel/core/timeline/project-duration'
import type { MediaItem, Project } from '../openreel/core/types/project'
import type { Clip, Track, Transition } from '../openreel/core/types/timeline'
import { TRANSITION_TYPES, type TransitionType } from '../openreel/core/types/effects'
import { getDefaultTransitionParams } from '../openreel/core/video/transition-engine'
import { TRANSITION_ADJACENCY_TOLERANCE } from '../openreel/web/components/editor/timeline/transition-handles'
import { boolean, fields, invalid, number, referenceId, seconds, text, type Fields } from './native-input'

const endOf = (item: { startTime: number; duration: number }) => item.startTime + item.duration
const newId = () => crypto.randomUUID()
const motionDenied = () => new ClipDomainError('motion-expression-denied', 'Motion items must be edited in the editor')
const locked = () => new ClipDomainError('TRACK_LOCKED', 'Unlock the affected track before editing')
const destructive = () => new ClipDomainError('CONFIRMATION_REQUIRED', 'Deleting a populated track or clearing the timeline requires confirmation')

export class NativeDraft {
  private readonly executor = new ActionExecutor()
  constructor(public project: Project, readonly confirmDestructive: boolean) {}

  async action(type: string, params: Fields): Promise<void> {
    // The executor validates and applies the same actions as the editor, with
    // no publication or history on this detached project.
    const result = await this.executor.applyRemote({ type, params, id: newId(), timestamp: Date.now() }, this.project)
    if (!result.success) invalid(result.error?.message ?? 'OpenReel rejected the edit')
  }

  plan(plan: TimelineToolPlan): void {
    if (!plan.edits.length) return
    if (plan.edits.some(edit => edit.kind === 'motion'
      || (edit.kind === 'media' && [edit.before, edit.after].some(item => (item as Clip | null)?.metadata?.motionClip)))) throw motionDenied()
    validateTimelineToolEdits(this.project, plan.edits)
    this.project = applyTimelineToolEdits(this.project, plan.edits)
  }

  replace(project: Project): void {
    this.project = { ...project, timeline: { ...project.timeline, duration: calculateProjectDuration(project) } }
  }
}

export function requireTrack(project: Project, value: unknown, writable = true): Track {
  const id = referenceId(value, 'trackId')
  const track = project.timeline.tracks.find(track => track.id === id)
  if (!track) throw ClipDomainError.notFound('The track does not exist in this timeline')
  if (writable && track.locked) throw locked()
  return track
}

export function requireItem(project: Project, value: unknown) {
  const id = referenceId(value, 'clipId')
  const item = resolveTimelineItem(project, id)
  if (!item) throw ClipDomainError.notFound('The clip does not exist in this timeline')
  requireTrack(project, item.trackId)
  if (item.kind === 'motion' || (item.kind === 'media' && item.item.metadata?.motionClip)) throw motionDenied()
  return item
}

function requireMediaClip(project: Project, value: unknown) {
  const item = requireItem(project, value)
  if (item.kind !== 'media') invalid('Choose a media clip')
  return item
}

export function requireNewItemId(project: Project, value: unknown): string {
  const id = value === undefined ? newId() : referenceId(value, 'clipId')
  if (resolveTimelineItem(project, id) || project.timeline.subtitles.some(item => item.id === id)) invalid('clipId is already in use')
  return id
}

export function requirePlacement(project: Project, trackId: string, startTime: number, duration: number, excludeItemIds?: string[]): void {
  if (!Number.isFinite(startTime + duration) || duration <= EPS) invalid('The clip must have a positive, finite duration')
  const placement = resolveTimelinePlacement(project, { targetTrackId: trackId, startTime, duration, policy: 'gap', excludeItemIds })
  if (!placement.ok) {
    if (placement.reason === 'overlap') throw ClipDomainError.clipOverlap()
    if (placement.reason === 'track-locked') throw locked()
    throw ClipDomainError.notFound('The destination track does not exist')
  }
}

export async function addTrack(draft: NativeDraft, operation: Fields, role?: Track['role']): Promise<{ trackId: string }> {
  const trackType = operation.trackType ?? operation.kind
  if (trackType !== 'video' && trackType !== 'audio' && trackType !== 'image' && trackType !== 'text' && trackType !== 'graphics') {
    invalid('trackType must be video, audio, image, text or graphics')
  }
  const { project } = draft
  const trackId = operation.trackId === undefined ? newId() : referenceId(operation.trackId, 'trackId')
  if (project.timeline.tracks.some(track => track.id === trackId)) invalid('trackId is already in use')
  const position = operation.position === undefined ? (trackType === 'text' || trackType === 'graphics' ? 0 : undefined)
    : number(operation.position, 'position', 0, project.timeline.tracks.length)
  if (position !== undefined && !Number.isInteger(position)) invalid('position must be a track index')
  const name = operation.name === undefined ? undefined : text(operation.name, 'name', 256).trim()
  if (name === '') invalid('Track name is required')
  await draft.action('track/add', { trackType, trackId, position, name, role })
  return { trackId }
}

export async function setTrackState(draft: NativeDraft, operation: Fields) {
  const track = requireTrack(draft.project, operation.trackId, false)
  const state = operation.state === undefined ? operation : fields(operation.state, 'track state')
  const muted = boolean(state.muted ?? state.isMuted, 'muted')
  const isLocked = boolean(state.locked ?? state.isLocked, 'locked')
  const hiddenValue = boolean(state.hidden ?? state.isHidden, 'hidden')
  const visible = boolean(state.visible ?? state.isVisible, 'visible')
  const hidden = hiddenValue ?? (visible === undefined ? undefined : !visible)
  const name = state.name === undefined ? undefined : text(state.name, 'name', 256).trim()
  if (name === '' || [muted, isLocked, hidden, name].every(value => value === undefined)) invalid('Provide a track state change')
  const trackId = track.id
  if (name !== undefined) await draft.action('track/rename', { trackId, name })
  if (muted !== undefined) await draft.action('track/mute', { trackId, muted })
  if (hidden !== undefined) await draft.action('track/hide', { trackId, hidden })
  if (isLocked !== undefined) await draft.action('track/lock', { trackId, locked: isLocked })
  return { trackId }
}

export async function removeTrack(draft: NativeDraft, operation: Fields) {
  const track = requireTrack(draft.project, operation.trackId)
  const items = getTrackItems(draft.project, track.id)
  if (items.length && !draft.confirmDestructive) throw destructive()
  if (items.some(item => item.kind === 'motion' || (item.kind === 'media' && item.item.metadata?.motionClip))) throw motionDenied()
  // Native deletion detaches masks/particles/nests alongside media.
  draft.replace(removeClipsById(draft.project, new Set(items.map(item => item.id))))
  await draft.action('track/remove', { trackId: track.id })
  return { trackId: track.id }
}

export function requireClearConfirmation(before: Project, draft: NativeDraft): void {
  const hasItems = (project: Project) => getTimelineItems(project).some(item => project.timeline.tracks.some(track => track.id === item.trackId))
    || project.timeline.subtitles.length > 0
  if (!draft.confirmDestructive && hasItems(before) && !hasItems(draft.project)) throw destructive()
}

function requireSourceRange(project: Project, clip: Pick<Clip, 'mediaId' | 'metadata' | 'outPoint'>, start: number, end: number): void {
  const media = project.mediaLibrary.items.find(item => item.id === clip.mediaId)
  const compoundId = getCompoundClipId(clip)
  const compound = project.compoundClips?.find(item => item.id === compoundId)
  const restricted = mediaTrimBounds(media)
  const sourceEnd = restricted?.max ?? (media?.type === 'image' ? Infinity : compound?.content.duration ?? media?.metadata.duration ?? clip.outPoint)
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start + EPS)
    || start < (restricted?.min ?? 0) - EPS || end > sourceEnd + EPS) invalid('The edit exceeds the source bounds')
}

function mediaTrackAccepts(track: Track, media: MediaItem): boolean {
  return media.type === 'audio' ? track.type === 'audio' : track.type === 'video' || (media.type === 'image' && track.type === 'image')
}

export async function addMediaClip(draft: NativeDraft, operation: Fields, media: MediaItem, importPlacement = false) {
  const { project } = draft
  const trackId = operation.trackId ?? (importPlacement ? project.timeline.tracks.find(track => !track.locked && mediaTrackAccepts(track, media))?.id : undefined)
  const track = requireTrack(project, trackId)
  if (!mediaTrackAccepts(track, media)) invalid('Choose a compatible media track')
  if (media.isPlaceholder || !(media.blob || media.fileHandle || media.nativeSource)) throw ClipDomainError.mediaMissing('The source media must be available in the editor')
  const window = subclipRange(media)
  const startTime = seconds(operation, 'startSec', 'startTimeMs') ?? (operation.append === false ? 0 : getTrackItems(project, track.id).reduce((end, item) => Math.max(end, endOf(item)), 0))
  const inPoint = seconds(operation, 'sourceInSec', 'sourceInMs') ?? window?.start ?? 0
  const duration = seconds(operation, 'durationSec', 'durationMs')
  const typedSpeed = operation.speed === undefined ? undefined : number(operation.speed, 'speed', CLIP_SPEED_MIN, CLIP_SPEED_MAX)
  const rate = typedSpeed ?? (duration === undefined && !window ? interpretationSpeed(media) : 1)
  const defaultOutPoint = media.type === 'image' ? inPoint + 5 : window?.end ?? media.metadata.duration
  const outPoint = seconds(operation, 'sourceOutSec', 'sourceOutMs') ?? (duration === undefined ? defaultOutPoint : inPoint + duration * rate)
  requireSourceRange(project, { mediaId: media.id, outPoint }, inPoint, outPoint)
  const timedDuration = (outPoint - inPoint) / rate
  if (duration !== undefined && Math.abs(duration - timedDuration) > EPS) invalid('Duration must match the source range at the selected speed')
  requirePlacement(project, track.id, startTime, timedDuration)
  const clipId = requireNewItemId(project, operation.clipId)
  const clip = {
    ...createMediaClip(media, track.id, clipId),
    startTime, duration: timedDuration, inPoint, outPoint,
    volume: operation.volume === undefined ? 1 : number(operation.volume, 'volume', 0, 2),
    ...(rate !== 1 ? { speed: rate } : {}),
  }
  await draft.action('clip/add', { trackId: track.id, clipId, mediaId: media.id, startTime, sourceClip: clip })
  return { clipId, trackId: track.id, mediaId: media.id, startSec: startTime, durationSec: timedDuration }
}

export function splitClip(draft: NativeDraft, operation: Fields) {
  const { item: clip, id } = requireMediaClip(draft.project, operation.clipId)
  const atSec = seconds(operation, 'atSec', 'atMs')
  if (atSec === undefined || atSec - clip.startTime < 0.08 - EPS || endOf(clip) - atSec < 0.08 - EPS) {
    invalid('Split time must leave at least 80ms on either side')
  }
  const plan = prepareClipSplit(draft.project, id, atSec, newId())
  draft.plan(plan)
  return { clipId: id, rightClipId: plan.rightClipId, atSec }
}

function preserveTransitions(project: Project, reference: Project): Project {
  const pruned = pruneTransitions(project, reference)
  return {
    ...pruned,
    timeline: {
      ...pruned.timeline,
      tracks: pruned.timeline.tracks.map(track => {
        const clips = new Map(track.clips.map(clip => [clip.id, clip]))
        return { ...track, transitions: track.transitions.map(transition => ({
          ...transition,
          duration: Math.min(transition.duration, clips.get(transition.clipAId)!.duration,
            transition.clipBId === undefined ? Infinity : clips.get(transition.clipBId)!.duration),
        })) }
      }),
    },
  }
}

export function trimClip(draft: NativeDraft, operation: Fields) {
  const initial = draft.project
  const { item: clip, id, trackId } = requireMediaClip(initial, operation.clipId)
  const start = seconds(operation, 'startSec', 'startTimeMs')
  const duration = seconds(operation, 'durationSec', 'durationMs')
  const inPoint = seconds(operation, 'sourceInSec', 'sourceInMs')
  const outPoint = seconds(operation, 'sourceOutSec', 'sourceOutMs')
  if ([start, duration, inPoint, outPoint].every(value => value === undefined)) invalid('Provide a trim time')
  const retime = [duration, inPoint, outPoint].some(value => value !== undefined)
  if (retime && (clip.speedKeyframes?.length || clip.freezeFrames?.length)) invalid('Use the editor to trim a clip with nonlinear speed')
  const rate = Math.abs(clip.speed ?? 1)
  if (!(rate > 0) || !Number.isFinite(rate)) invalid('The clip has an invalid playback rate')
  const reversed = clip.reversed || (clip.speed ?? 1) < 0
  let sourceIn = inPoint ?? clip.inPoint
  let sourceOut = outPoint ?? clip.outPoint
  if (duration !== undefined) {
    if (outPoint === undefined && (!reversed || inPoint !== undefined)) sourceOut = sourceIn + duration * rate
    else if (inPoint === undefined) sourceIn = sourceOut - duration * rate
  }
  const nextDuration = retime ? (sourceOut - sourceIn) / rate : clip.duration
  if (retime) requireSourceRange(initial, clip, sourceIn, sourceOut)
  if (duration !== undefined && Math.abs(duration - nextDuration) > EPS) invalid('Duration must match the source range at the selected speed')
  const startTime = start ?? clip.startTime
  requirePlacement(initial, trackId, startTime, nextDuration, [id])
  const offset = (reversed ? clip.outPoint - sourceOut : sourceIn - clip.inPoint) / rate
  const trimmed = retime ? createClipFragment(clip, { startTime, duration: nextDuration, fromTime: clip.startTime + offset, inserted: false }, id, initial) : { ...clip, startTime }
  const track = requireTrack(initial, trackId)
  draft.plan({ label: 'Trim clip', delta: 0, edits: [{ kind: 'media', id, trackId, index: track.clips.indexOf(clip), before: clip,
    after: { ...trimmed, inPoint: sourceIn, outPoint: sourceOut } }] })
  draft.replace(preserveTransitions(draft.project, initial))
  return { clipId: id, startSec: startTime, durationSec: nextDuration, sourceInSec: sourceIn, sourceOutSec: sourceOut }
}

export async function moveClip(draft: NativeDraft, operation: Fields) {
  const item = requireItem(draft.project, operation.clipId)
  const initial = { ...draft.project, timeline: { ...draft.project.timeline } }
  const from = requireTrack(initial, item.trackId)
  const to = requireTrack(initial, operation.trackId ?? operation.toTrackId ?? from.id)
  if (from.type !== to.type) invalid('Moving a clip across tracks requires tracks of the same type')
  const startTime = seconds(operation, 'startSec', 'startTimeMs') ?? seconds(operation, 'toSec', 'toMs')
  if (startTime === undefined) invalid('startSec is required')
  requirePlacement(initial, to.id, startTime, item.duration, [item.id])
  if (item.kind === 'media') {
    await draft.action('clip/move', { clipId: item.id, trackId: to.id, startTime })
    const next = draft.project
    draft.replace({
      ...next,
      ...(next.nestedInstances ? { nestedInstances: next.nestedInstances.map(instance => instance.id === item.id ? { ...instance, trackId: to.id, startTime } : instance) } : {}),
      ...(next.particleEffects ? { particleEffects: next.particleEffects.map(effect => effect.clipId === item.id && effect.clipStartTime !== undefined
        ? { ...effect, clipStartTime: effect.clipStartTime + startTime - item.startTime } : effect) } : {}),
    })
    draft.replace(preserveTransitions(draft.project, initial))
  } else if (item.kind === 'text' || item.kind === 'shape' || item.kind === 'svg' || item.kind === 'sticker') {
    await draft.action(`${item.kind}/update`, { clipId: item.id, updates: { trackId: to.id, startTime } })
  } else invalid('This timeline item needs its native inspector to move')
  return { clipId: item.id, trackId: to.id, startSec: startTime }
}

export async function removeClip(draft: NativeDraft, operation: Fields) {
  const item = requireItem(draft.project, operation.clipId)
  const ripple = boolean(operation.ripple, 'ripple') === true
  if (item.kind === 'media') {
    if (ripple) draft.plan(planRippleDelete(draft.project, [item.id], newId()))
    else draft.replace(pruneTransitions(removeClipsById(draft.project, new Set([item.id])), draft.project))
  } else if (item.kind === 'text' || item.kind === 'shape' || item.kind === 'svg' || item.kind === 'sticker') {
    if (ripple) draft.plan(planExtract(draft.project, { start: item.startTime, end: endOf(item) }, newId(), [item.trackId]))
    else await draft.action(`${item.kind}/remove`, { clipId: item.id })
  } else invalid('This timeline item needs its native inspector to remove')
  return { clipId: item.id }
}

function exactRange(operation: Fields) {
  const start = seconds(operation, 'fromSec', 'fromMs')
  const end = seconds(operation, 'toSec', 'toMs')
  if (start === undefined || end === undefined || end <= start + EPS) invalid('Provide fromSec < toSec')
  return { start, end }
}

export function removeRange(draft: NativeDraft, operation: Fields, range = exactRange(operation), ripple = boolean(operation.ripple, 'ripple') !== false) {
  const { project } = draft
  const tracks = operation.trackId === undefined ? undefined : [requireTrack(project, operation.trackId).id]
  if (range.end > calculateProjectDuration(project) + EPS) invalid('The range exceeds the timeline duration')
  if (!tracks && project.timeline.tracks.some(track => track.locked && getTrackItems(project, track.id).some(item =>
    endOf(item) > range.start + EPS && (ripple || item.startTime < range.end - EPS)))) throw locked()
  const plan = (ripple ? planExtract : planLift)(project, range, newId(), tracks)
  draft.plan(plan)
  const clipEdits = plan.edits.filter(edit => edit.kind === 'media' || edit.kind === 'text')
  return { fromSec: range.start, toSec: range.end, removedClipIds: clipEdits.filter(edit => !edit.after).map(edit => edit.id), createdClipIds: clipEdits.filter(edit => !edit.before).map(edit => edit.id) }
}

export function cutSilences(draft: NativeDraft, operation: Fields) {
  if (operation.silences !== undefined && !Array.isArray(operation.silences)) invalid('silences must be an array of ranges')
  if (Array.isArray(operation.silences) && operation.silences.length) {
    const ranges = operation.silences.map(range => exactRange(fields(range, 'silence range'))).sort((a, b) => b.start - a.start)
    if (ranges.some((range, i) => i && range.end > ranges[i - 1].start + EPS)) invalid('Silence ranges overlap')
    const removed = ranges.map(range => removeRange(draft, operation, range, true))
    return { mode: 'ranges', count: removed.length, removed }
  }
  const minSilenceSec = seconds(operation, 'minSilenceSec', 'minSilenceMs') ?? 0.3
  const tracks = operation.trackId === undefined ? draft.project.timeline.tracks.filter(track => track.type === 'audio' || track.type === 'video')
    : [requireTrack(draft.project, operation.trackId)]
  let closed = 0
  for (const track of tracks) {
    if (track.locked) throw locked()
    const plan = planRemoveGaps(draft.project, track.id, newId(), minSilenceSec)
    closed += plan.edits.filter(edit => edit.kind === 'media').length
    draft.plan(plan)
  }
  return { mode: 'gap-close', closed, minSilenceSec }
}

export function setSpeed(draft: NativeDraft, operation: Fields) {
  const { item: clip, id, trackId } = requireMediaClip(draft.project, operation.clipId)
  const speed = number(operation.speed, 'speed', CLIP_SPEED_MIN, CLIP_SPEED_MAX)
  const duration = (clip.outPoint - clip.inPoint) / speed
  requirePlacement(draft.project, trackId, clip.startTime, duration, [id])
  draft.plan(planClipSpeedEdit(draft.project, [id], { speed }, { ripple: false }, newId()))
  return { clipId: id, speed, durationSec: duration }
}

export async function setVolume(draft: NativeDraft, operation: Fields) {
  const { item: clip, id, trackId } = requireMediaClip(draft.project, operation.clipId)
  const volume = operation.volume === undefined ? clip.volume : number(operation.volume, 'volume', 0, 2)
  const muted = boolean(operation.muted ?? operation.isMuted ?? operation.mute, 'muted')
  if (operation.volume === undefined && muted === undefined) invalid('Provide volume or muted')
  if (muted !== undefined) {
    // Native zero-gain effect also silences an existing volume automation lane.
    const muteEffect = clip.audioEffects.find(effect => effect.metadata?.clipToolMute === true)
    const audioEffects = clip.audioEffects.filter(effect => effect !== muteEffect)
    if (muted) audioEffects.push(muteEffect ?? { id: newId(), type: 'gain', enabled: true, params: { value: 0 }, metadata: { clipToolMute: true } })
    const track = requireTrack(draft.project, trackId)
    draft.plan({ label: 'Set clip sound', delta: 0, edits: [{ kind: 'media', id, trackId, index: track.clips.indexOf(clip), before: clip, after: { ...clip, volume, audioEffects } }] })
  } else {
    await draft.action('audio/setVolume', { clipId: id, volume })
  }
  return { clipId: id, volume, muted: muted ?? clip.audioEffects.some(effect => effect.metadata?.clipToolMute === true) }
}

export async function addTransition(draft: NativeDraft, operation: Fields) {
  const { project } = draft
  const first = requireMediaClip(project, operation.clipAId ?? operation.clipId)
  const track = requireTrack(project, first.trackId)
  const transitionName = operation.transition ?? operation.transitionType ?? 'crossfade'
  const type = (transitionName === 'fadeblack' ? 'dipToBlack' : transitionName) as TransitionType
  if (!TRANSITION_TYPES.includes(type)) invalid('Choose an OpenReel transition type')
  if (!getTimelineItemCapabilities(first).transitionSource) invalid('Choose a picture clip for the transition')
  const edge = operation.edge
  if (edge !== undefined && edge !== 'in' && edge !== 'out') invalid('edge must be in or out')
  const secondId = operation.clipBId ?? operation.nextClipId
  const second = secondId === undefined ? undefined : requireMediaClip(project, secondId)
  if (second && (edge !== undefined || second.trackId !== first.trackId || second.id === first.id || !getTimelineItemCapabilities(second).transitionSource
    || Math.abs(second.startTime - endOf(first)) > TRANSITION_ADJACENCY_TOLERANCE)) invalid('Two-clip transitions require adjacent picture clips on the same track')
  const duration = seconds(operation, 'durationSec', 'durationMs') ?? 0.4
  if (duration <= EPS || duration > Math.min(first.duration, second?.duration ?? Infinity) + EPS) invalid('Transition duration exceeds its clips')
  const previous = track.transitions.find(transition => transition.clipAId === first.id && transition.clipBId === second?.id
    && (second || (transition.edge ?? 'out') === (edge ?? 'out')))
  const transitionId = operation.transitionId === undefined ? previous?.id ?? newId() : referenceId(operation.transitionId, 'transitionId')
  if (project.timeline.tracks.some(track => track.transitions.some(transition => transition.id === transitionId && transition !== previous))) invalid('transitionId is already in use')
  const transition: Transition = { id: transitionId, clipAId: first.id, ...(second ? { clipBId: second.id } : { edge: edge ?? 'out' }), type, duration, params: getDefaultTransitionParams(type) }
  await draft.action('transition/set', { transition })
  return { transitionId, trackId: track.id, clipId: first.id, transition: { type, durationSec: duration } }
}

export async function removeTransition(draft: NativeDraft, operation: Fields) {
  const clipId = operation.clipAId ?? operation.clipId
  const matches = draft.project.timeline.tracks.flatMap(track => track.transitions
    .filter(transition => operation.transitionId !== undefined ? transition.id === operation.transitionId
      : transition.clipAId === clipId && (operation.edge === undefined || (transition.edge ?? 'out') === operation.edge))
    .map(transition => ({ track, transition })))
  if (matches.length !== 1) invalid('Choose a single transitionId')
  const { track, transition } = matches[0]
  requireTrack(draft.project, track.id)
  await draft.action('transition/remove', { transitionId: transition.id })
  return { transitionId: transition.id, trackId: track.id }
}
