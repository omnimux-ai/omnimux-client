import { ClipDomainError } from '../errors.js'
import { aspectRatioOf, finite, isReferenceId, items, mediaIsMissing, nativeClipsByTrack, projectMode, safeText, sourceIdentity } from './nativeProjectFields.js'

export { diagnoseNativeProject } from './nativeProjectDiagnostics.js'

const VIEWS = ['summary', 'tracks', 'clips', 'full']

function optionalNumber(value, field, integer = false) {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) {
    throw ClipDomainError.invalidJson(`${field} must be a non-negative ${integer ? 'integer' : 'number'}`)
  }
  return value
}

function textStyleView(style) {
  if (!style) return undefined
  return {
    fontFamily: safeText(style.fontFamily),
    fontSize: finite(style.fontSize),
    fontWeight: typeof style.fontWeight === 'number' ? finite(style.fontWeight) : safeText(style.fontWeight),
    color: safeText(style.color),
    backgroundColor: safeText(style.backgroundColor),
    strokeColor: safeText(style.strokeColor),
    strokeWidth: finite(style.strokeWidth),
    textAlign: safeText(style.textAlign),
    position: safeText(style.position),
  }
}

function mediaView(item) {
  return {
    id: item.id,
    mediaId: item.id,
    name: safeText(item.name) || item.id,
    type: item.type,
    omnimuxSource: sourceIdentity(item.omnimuxSource),
    missing: mediaIsMissing(item),
    durationSec: finite(item.metadata?.duration),
    width: finite(item.metadata?.width),
    height: finite(item.metadata?.height),
  }
}

function clipView({ clip, kind }, track, trackIndex, media) {
  const source = media.get(clip.mediaId)
  return {
    id: clip.id,
    name: safeText(clip.name ?? source?.name ?? clip.text, 160) || clip.id,
    trackId: track.id,
    trackIndex,
    trackType: track.type,
    kind,
    startSec: clip.startTime,
    endSec: clip.startTime + clip.duration,
    durationSec: clip.duration,
    ...(kind === 'media' ? {
      mediaId: isReferenceId(clip.mediaId) ? clip.mediaId : undefined,
      mediaType: source?.type,
      sourceInSec: finite(clip.inPoint),
      sourceOutSec: finite(clip.outPoint),
      speed: finite(clip.speed, 1),
      volume: finite(clip.volume, 1),
    } : {}),
    ...(kind === 'text' ? { text: safeText(clip.text, 4000), style: textStyleView(clip.style) } : {}),
    hasEffects: items(clip.effects).length > 0,
    hasColorGrading: clip.colorGrading != null,
  }
}

function trackView(track, index, clipCount) {
  return {
    id: track.id,
    index,
    name: safeText(track.name) || track.id,
    type: track.type,
    locked: track.locked === true,
    syncLock: track.syncLock !== false,
    hidden: track.hidden === true,
    muted: track.muted === true,
    solo: track.solo === true,
    soloSafe: track.soloSafe === true,
    clipCount,
  }
}

function transitionView(transition) {
  return {
    id: isReferenceId(transition.id) ? transition.id : undefined,
    clipAId: isReferenceId(transition.clipAId) ? transition.clipAId : undefined,
    clipBId: isReferenceId(transition.clipBId) ? transition.clipBId : undefined,
    edge: ['in', 'out'].includes(transition.edge) ? transition.edge : undefined,
    type: safeText(transition.type, 64),
    durationSec: finite(transition.duration),
  }
}

/** An agent-safe native snapshot for both Host persistence and live editor reads. */
export function nativeProjectView(envelope, opts = {}) {
  const view = opts.view ?? 'summary'
  if (!VIEWS.includes(view)) throw ClipDomainError.invalidJson(`view must be one of ${VIEWS.join('|')}`)
  const fromSec = optionalNumber(opts.fromSec, 'fromSec') ?? 0
  const toSec = optionalNumber(opts.toSec, 'toSec') ?? Infinity
  if (toSec < fromSec) throw ClipDomainError.invalidJson('toSec must be at least fromSec')
  const offset = optionalNumber(opts.offset, 'offset', true) ?? 0
  const limit = optionalNumber(opts.limit, 'limit', true)
  const { project, projectId, binding, revision, updatedAt } = envelope
  const { timeline, settings } = project
  const clipsByTrack = nativeClipsByTrack(project)
  const media = new Map(project.mediaLibrary.items.map((item) => [item.id, item]))
  const selected = new Set(items(opts.selectedClipIds ?? project.selectedClipIds))
  const selectedClips = []
  const tracks = timeline.tracks.map((track, index) => {
    const clips = clipsByTrack.get(track.id).map((entry) => clipView(entry, track, index, media))
    for (const { id, name, trackId, startSec, endSec } of clips) {
      if (selectedClips.length < 3 && selected.delete(id)) selectedClips.push({ id, name, trackId, startSec, endSec })
    }
    return { track, index, clips }
  })
  const subtitles = items(timeline.subtitles)
  for (const cue of subtitles) {
    if (selectedClips.length >= 3) break
    if (selected.has(cue?.id) && isReferenceId(cue.captionTrackId)) {
      selectedClips.push({ id: cue.id, name: safeText(cue.text) || cue.id,
        trackId: cue.captionTrackId, startSec: cue.startTime, endSec: cue.endTime })
    }
  }
  const base = {
    projectId,
    mode: projectMode(envelope),
    ...(binding ? { workspaceId: safeText(binding.workspaceId), nodeId: safeText(binding.nodeId, 256) } : {}),
    title: safeText(project.name) || projectId,
    revision,
    updatedAt,
    view,
    durationSec: timeline.duration,
    fps: settings.frameRate,
    width: settings.width,
    height: settings.height,
    aspectRatio: aspectRatioOf(settings),
    playheadSec: finite(opts.playheadSec, finite(project.playheadSec, 0)),
    isPlaying: opts.isPlaying === true,
    selectedClips,
    trackCount: tracks.length,
    clipCount: tracks.reduce((count, row) => count + row.clips.length, 0),
    mediaCount: media.size,
    missingMediaCount: [...media.values()].filter(mediaIsMissing).length,
    subtitleCount: subtitles.length,
  }
  if (view === 'summary') return base

  const matchedTracks = tracks
    .filter(({ track, index }) => (!opts.trackId || opts.trackId === track.id) && (opts.trackIndex === undefined || opts.trackIndex === index))
    .map((row) => ({ ...row, clips: row.clips.filter((clip) => (
      (!opts.clipId || clip.id === opts.clipId) && clip.endSec >= fromSec && clip.startSec <= toSec
    )) }))
    .filter((row) => !opts.clipId || row.clips.length > 0)
  if (view === 'tracks') {
    return { ...base, tracks: matchedTracks.map(({ track, index, clips }) => trackView(track, index, clips.length)) }
  }

  const allClips = matchedTracks.flatMap(({ clips }) => clips)
  const clips = allClips.slice(offset, limit === undefined ? undefined : offset + limit)
  if (view === 'clips') return { ...base, clips }

  const includedIds = new Set(clips.map(({ id }) => id))
  return {
    ...base,
    media: [...media.values()].map(mediaView),
    tracks: matchedTracks.map(({ track, index, clips: matchingClips }) => ({
      ...trackView(track, index, matchingClips.length),
      clips: matchingClips.filter(({ id }) => includedIds.has(id)),
      transitions: items(track.transitions).filter((transition) => (
        transition && (includedIds.has(transition.clipAId) || includedIds.has(transition.clipBId))
      )).map(transitionView),
    })),
    clips,
    subtitles: subtitles.filter((cue) => cue && (!opts.clipId || cue.id === opts.clipId)
      && (!opts.trackId || cue.captionTrackId === opts.trackId) && cue.endTime >= fromSec && cue.startTime <= toSec)
      .map((cue) => ({
        id: isReferenceId(cue.id) ? cue.id : undefined,
        trackId: isReferenceId(cue.captionTrackId) ? cue.captionTrackId : undefined,
        text: safeText(cue.text, 4000),
        startSec: cue.startTime,
        endSec: cue.endTime,
        hidden: cue.hidden === true,
        style: textStyleView(cue.style),
      })),
  }
}
