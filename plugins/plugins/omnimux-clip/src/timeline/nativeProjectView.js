import { ClipDomainError } from '../errors.js'
import { aspectRatioOf, finite, isReferenceId, items, mediaIsMissing, nativeClipsByTrack, projectMode, safeText, sourceProjection } from './nativeProjectFields.js'

export { diagnoseNativeProject, enrichDiagnosticsWithReconcile } from './nativeProjectDiagnostics.js'

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
    ...(safeText(style.highlightColor) ? { highlightColor: safeText(style.highlightColor) } : {}),
    ...(safeText(style.upcomingColor) ? { upcomingColor: safeText(style.upcomingColor) } : {}),
    ...(safeText(style.shadowColor) ? { shadowColor: safeText(style.shadowColor) } : {}),
    ...(finite(style.shadowBlur) !== undefined ? { shadowBlur: finite(style.shadowBlur) } : {}),
    ...(finite(style.boxPaddingX) !== undefined ? { boxPaddingX: finite(style.boxPaddingX) } : {}),
    ...(finite(style.boxPaddingY) !== undefined ? { boxPaddingY: finite(style.boxPaddingY) } : {}),
    ...(finite(style.boxRadius) !== undefined ? { boxRadius: finite(style.boxRadius) } : {}),
    ...(finite(style.safeMargin) !== undefined ? { safeMargin: finite(style.safeMargin) } : {}),
  }
}

const VALID_AUDIO_TYPES = new Set(['dialogue', 'music', 'sfx', 'ambience'])

function liveDuckingView(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  if (typeof raw.enabled !== 'boolean') return undefined
  const amountDb = finite(raw.amountDb)
  const attackMs = finite(raw.attackMs)
  const releaseMs = finite(raw.releaseMs)
  const holdMs = finite(raw.holdMs)
  if (amountDb === undefined || attackMs === undefined || releaseMs === undefined || holdMs === undefined) return undefined
  return { enabled: raw.enabled, amountDb, attackMs, releaseMs, holdMs }
}

function mediaView(item) {
  return {
    id: item.id,
    mediaId: item.id,
    name: safeText(item.name) || item.id,
    type: item.type,
    omnimuxSource: sourceProjection(item.omnimuxSource),
    missing: mediaIsMissing(item),
    durationSec: finite(item.metadata?.duration),
    width: finite(item.metadata?.width),
    height: finite(item.metadata?.height),
  }
}

function clipView({ clip, kind }, track, trackIndex, media) {
  const source = media.get(clip.mediaId)
  const liveDucking = kind === 'media' ? liveDuckingView(clip.metadata?.liveDucking) : undefined
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
      ...(VALID_AUDIO_TYPES.has(clip.audioType) ? { audioType: clip.audioType } : {}),
      ...(liveDucking ? { liveDucking } : {}),
    } : {}),
    ...(kind === 'text' ? {
      text: safeText(clip.text, 4000),
      style: textStyleView(clip.style),
      ...(clip.animation?.preset ? { textAnimationPreset: safeText(clip.animation.preset, 64) } : {}),
    } : {}),
    ...(isReferenceId(clip.metadata?.graphicInstanceId) ? { graphicInstanceId: clip.metadata.graphicInstanceId } : {}),
    keyframeCount: items(clip.keyframes).length,
    hasEffects: items(clip.effects).length > 0,
    hasColorGrading: clip.colorGrading != null,
  }
}

function markerView(marker) {
  const durationSec = finite(marker.duration)
  const comment = safeText(marker.comment, 1000)
  const kind = safeText(marker.kind, 32)
  return {
    id: isReferenceId(marker.id) ? marker.id : undefined,
    timeSec: finite(marker.time, 0),
    ...(durationSec !== undefined && durationSec > 0 ? { durationSec } : {}),
    label: safeText(marker.label, 120) ?? '',
    color: safeText(marker.color, 32) ?? '#f59e0b',
    ...(comment ? { comment } : {}),
    ...(kind ? { kind } : {}),
  }
}

function subtitleWordsView(rawWords) {
  if (!Array.isArray(rawWords) || rawWords.length === 0) return undefined
  const out = []
  for (const word of rawWords) {
    if (out.length >= 200) break
    const text = safeText(word?.text, 80)
    const startSec = finite(word?.startTime)
    const endSec = finite(word?.endTime)
    if (!text || startSec === undefined || endSec === undefined || endSec < startSec) continue
    out.push({ text, startSec, endSec })
  }
  return out.length > 0 ? out : undefined
}

function sanitizeGraphicValues(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return {}
  const out = {}
  for (const [key, value] of Object.entries(values)) {
    if (!isReferenceId(key)) continue
    if (typeof value === 'string') {
      out[key] = safeText(value, 4000) ?? ''
    } else if (typeof value === 'boolean' || Number.isFinite(value)) {
      out[key] = value
    } else if (value && typeof value === 'object' && !Array.isArray(value) && Number.isFinite(value.x) && Number.isFinite(value.y)) {
      out[key] = { x: value.x, y: value.y }
    }
  }
  return out
}

function graphicInstanceView(instance) {
  return {
    id: isReferenceId(instance.id) ? instance.id : undefined,
    name: safeText(instance.name, 120) || instance.id,
    templateId: safeText(instance.template?.id, 128),
    category: safeText(instance.template?.category, 64),
    trackId: isReferenceId(instance.trackId) ? instance.trackId : undefined,
    startSec: finite(instance.startTime, 0),
    durationSec: finite(instance.duration, 0),
    values: sanitizeGraphicValues(instance.values),
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
  const markers = items(timeline.markers)
  const base = {
    projectId,
    mode: projectMode(envelope),
    ...(binding ? { workspaceId: safeText(binding.workspaceId), nodeId: safeText(binding.nodeId, 256) } : {}),
    title: safeText(project.name) || projectId,
    revision,
    revisionEpoch: envelope.revisionEpoch ?? 0,
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
    markerCount: markers.length,
    graphicInstanceCount: items(project.graphicInstances).length,
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
    graphicInstances: items(project.graphicInstances)
      .filter((inst) => inst && (!opts.trackId || inst.trackId === opts.trackId)
        && (inst.startTime + inst.duration) >= fromSec && inst.startTime <= toSec)
      .map(graphicInstanceView),
    tracks: matchedTracks.map(({ track, index, clips: matchingClips }) => ({
      ...trackView(track, index, matchingClips.length),
      clips: matchingClips.filter(({ id }) => includedIds.has(id)),
      transitions: items(track.transitions).filter((transition) => (
        transition && (includedIds.has(transition.clipAId) || includedIds.has(transition.clipBId))
      )).map(transitionView),
    })),
    clips,
    markers: markers
      .filter((marker) => {
        if (!marker || !Number.isFinite(marker.time)) return false
        const end = marker.time + (finite(marker.duration, 0) || 0)
        return end >= fromSec && marker.time <= toSec
      })
      .map(markerView),
    subtitles: subtitles.filter((cue) => cue && (!opts.clipId || cue.id === opts.clipId)
      && (!opts.trackId || cue.captionTrackId === opts.trackId) && cue.endTime >= fromSec && cue.startTime <= toSec)
      .map((cue) => {
        const animationStyle = safeText(cue.animationStyle, 32)
        const speaker = safeText(cue.speaker, 80)
        const language = safeText(cue.language, 32)
        const words = subtitleWordsView(cue.words)
        return {
          id: isReferenceId(cue.id) ? cue.id : undefined,
          trackId: isReferenceId(cue.captionTrackId) ? cue.captionTrackId : undefined,
          text: safeText(cue.text, 4000),
          startSec: cue.startTime,
          endSec: cue.endTime,
          hidden: cue.hidden === true,
          style: textStyleView(cue.style),
          ...(animationStyle ? { animationStyle } : {}),
          ...(speaker ? { speaker } : {}),
          ...(language ? { language } : {}),
          wordCount: items(cue.words).length,
          ...(words ? { words } : {}),
        }
      }),
  }
}
