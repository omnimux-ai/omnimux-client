import { ASPECT_PRESETS, defaultCanvasConfig, defaultTextStyle } from '../client/store/timelineTypes.js'
import { finite, isRecord, isReferenceId, items, MEDIA_TYPES, TRACK_TYPES } from '../timeline/nativeProjectFields.js'
import { contentVersionOf, createNativeProject, nativeTransform, sha256 } from './nativeProject.js'

const TRANSITIONS = {
  crossfade: { type: 'crossfade', edges: ['in', 'out'], params: { curve: 'linear' } },
  fadeblack: { type: 'dipToBlack', edges: ['in', 'out'], params: {} },
  wipeleft: { type: 'wipe', edges: ['in'], params: { direction: 'left', softness: 0 } },
  wiperight: { type: 'wipe', edges: ['in'], params: { direction: 'right', softness: 0 } },
}

export function isLegacyTimeline(value) {
  return isRecord(value) && Array.isArray(value.tracks)
}

function seconds(ms, fallback = 0) {
  return Number.isFinite(ms) ? ms / 1000 : fallback
}

function colorFallback(value) {
  // Legacy caption presets use CSS variables. The native canvas renderer needs
  // a concrete color, and the old presets already contain the fallback.
  const match = typeof value === 'string' && /^var\(--[\w-]+,\s*(.+)\)$/u.exec(value)
  return match ? match[1].trim() : value
}

function textClip(clip, timing) {
  const style = defaultTextStyle(isRecord(clip.textStyle) ? clip.textStyle : {})
  const align = ['left', 'right', 'center'].includes(style.textAlign) ? style.textAlign : 'center'
  return {
    ...timing,
    name: clip.name,
    text: typeof style.content === 'string' ? style.content : '',
    style: {
      fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, fontStyle: 'normal',
      color: colorFallback(style.color), backgroundColor: colorFallback(style.backgroundColor),
      strokeColor: colorFallback(style.strokeColor), strokeWidth: style.strokeWidth,
      textAlign: align, verticalAlign: 'middle', lineHeight: 1.3, letterSpacing: 0,
    },
    transform: nativeTransform({ x: align === 'left' ? 0.1 : align === 'right' ? 0.9 : 0.5, y: 0.85 }),
    keyframes: [],
  }
}

function sourceOf(item) {
  return [item.sourceUrl, item.path, item.url].find((value) => typeof value === 'string' && value.trim())
}

function legacyMedia(item, id, type, source, contentVersion) {
  return {
    id, type, name: typeof item.name === 'string' && item.name ? item.name : id,
    metadata: {
      duration: seconds(item.durationMs), width: finite(item.width, 0), height: finite(item.height, 0),
      frameRate: finite(item.fps, 0), fileSize: finite(item.fileSize, 0),
    },
    sourceRef: {
      kind: 'legacy',
      ...(source && !/^(?:blob|data):/i.test(source) ? { fingerprint: sha256(source) } : {}),
      ...(contentVersion === undefined ? {} : { contentVersion }),
    },
    omnimuxSource: item.omnimuxSource,
    missing: true,
  }
}

function allocateId(requested, fallback, used, reserved) {
  if (isReferenceId(requested) && !used.has(requested)) return requested
  let id = fallback
  for (let suffix = 1; used.has(id) || reserved.has(id); suffix++) id = `${fallback}-${suffix}`
  return id
}

function mediaMapper(schema, issues) {
  const media = new Map()
  const candidates = new Map()
  const inferred = new Map()
  const entries = items(schema.media)
  const reserved = new Set(entries.map((entry) => entry?.id))
  function key(type, source, contentVersion) {
    return JSON.stringify([type, source, contentVersion])
  }

  for (const [index, item] of entries.entries()) {
    if (!isRecord(item) || !MEDIA_TYPES.includes(item.type)) {
      issues.push({ code: 'legacy-media-unmapped', ...(isReferenceId(item?.id) ? { mediaId: item.id } : {}) })
      continue
    }
    const source = sourceOf(item)
    const version = contentVersionOf(item)
    const id = allocateId(item.id, `legacy-media-${index + 1}`, media, reserved)
    media.set(id, legacyMedia(item, id, item.type, source, version))
    if (source) {
      const identity = key(item.type, source)
      const matches = candidates.get(identity) ?? []
      matches.push({ id, version })
      candidates.set(identity, matches)
    }
  }

  return {
    media,
    mediaIdFor(clip, clipId, type) {
      const explicitId = isReferenceId(clip.mediaId) ? clip.mediaId : undefined
      if (explicitId && media.has(explicitId)) return explicitId
      const source = sourceOf(clip)
      const version = contentVersionOf(clip)
      if (source && !explicitId) {
        const matches = (candidates.get(key(type, source)) ?? []).filter((item) => version === undefined || item.version === version)
        if (matches.length === 1) return matches[0].id
        if (matches.length > 1) issues.push({ code: 'legacy-media-ambiguous', clipId })
      }
      const identity = source ? key(type, source, version) : undefined
      if (!explicitId && inferred.has(identity)) return inferred.get(identity)
      const id = allocateId(explicitId, `legacy-media-${sha256(clipId).slice(0, 24)}`, media, reserved)
      media.set(id, legacyMedia({ name: clip.name }, id, type, source, version))
      if (identity && !explicitId) inferred.set(identity, id)
      return id
    },
  }
}

function addTransitions(track, clip, clipId, issues) {
  const transition = clip.transition
  if (!transition?.type || ['none', 'cut'].includes(transition.type)) return
  const mapped = Object.hasOwn(TRANSITIONS, transition.type) && TRANSITIONS[transition.type]
  if (!mapped || clip.mediaType === 'text' || !['video', 'image'].includes(track.type)) {
    issues.push({ code: 'legacy-transition-unmapped', trackId: track.id, clipId })
    return
  }
  // Legacy fades apply to both ends. Its wipes affect the entry only.
  const duration = transition.durationMs > 0 ? seconds(transition.durationMs) : 0.5
  for (const edge of mapped.edges) {
    track.transitions.push({ id: `${clipId}-transition-${edge}`, clipAId: clipId, edge, type: mapped.type, duration, params: mapped.params })
  }
}

export function migrateLegacyTimeline(schema, { id, title, updatedAt, playheadMs } = {}) {
  const project = createNativeProject(id, schema.name || title || id, updatedAt)
  const config = isRecord(schema.canvasConfig) ? schema.canvasConfig : {}
  const aspect = Object.hasOwn(ASPECT_PRESETS, config.aspectRatio) ? config.aspectRatio : '16:9'
  const defaults = defaultCanvasConfig(aspect)
  const issues = []
  const { media, mediaIdFor } = mediaMapper(schema, issues)
  const tracks = schema.tracks.map((track, index) => ({ track, index }))
    // Legacy paints in ascending order. OpenReel stores the front-most track first.
    .sort((a, b) => finite(b.track?.order, 0) - finite(a.track?.order, 0) || b.index - a.index)
  const trackIds = new Set()
  const reservedTracks = new Set(tracks.map(({ track }) => track?.id))
  const clipIds = new Set()
  const reservedClips = new Set(tracks.flatMap(({ track }) => items(track?.clips).map((clip) => clip?.id)))
  let duration = seconds(config.durationMs)
  const textClips = []
  for (const { track: oldTrack, index } of tracks) {
    if (!isRecord(oldTrack) || !TRACK_TYPES.includes(oldTrack.type)) {
      issues.push({ code: 'legacy-track-unmapped', ...(isReferenceId(oldTrack?.id) ? { trackId: oldTrack.id } : {}) })
      continue
    }
    const trackId = allocateId(oldTrack.id, `legacy-track-${index + 1}`, trackIds, reservedTracks)
    trackIds.add(trackId)
    const track = {
      id: trackId, name: typeof oldTrack.name === 'string' ? oldTrack.name : trackId, type: oldTrack.type,
      mode: 'standard', locked: !!oldTrack.isLocked, muted: !!oldTrack.isMuted, hidden: oldTrack.isVisible === false,
      solo: false, clips: [], transitions: [],
    }
    project.timeline.tracks.push(track)
    for (const [clipIndex, clip] of items(oldTrack.clips).entries()) {
      if (!isRecord(clip) || !Number.isFinite(clip.startTimeMs) || !Number.isFinite(clip.durationMs)) {
        issues.push({ code: 'legacy-clip-unmapped', trackId, ...(isReferenceId(clip?.id) ? { clipId: clip.id } : {}) })
        continue
      }
      const clipId = allocateId(clip.id, `legacy-clip-${index + 1}-${clipIndex + 1}`, clipIds, reservedClips)
      clipIds.add(clipId)
      const timing = { id: clipId, trackId, startTime: seconds(clip.startTimeMs), duration: seconds(clip.durationMs) }
      duration = Math.max(duration, timing.startTime + timing.duration)
      if (clip.mediaType === 'text' || oldTrack.type === 'text') {
        textClips.push(textClip(clip, timing))
      } else {
        const type = MEDIA_TYPES.includes(clip.mediaType) ? clip.mediaType : (oldTrack.type === 'audio' ? 'audio' : 'video')
        const inPoint = seconds(clip.sourceInMs)
        const speed = finite(clip.speed, 1)
        track.clips.push({
          ...timing, name: clip.name, mediaId: mediaIdFor(clip, clipId, type),
          inPoint, outPoint: seconds(clip.sourceOutMs, inPoint + timing.duration * Math.abs(speed)),
          volume: finite(clip.volume, 1), speed,
          effects: [], audioEffects: [], keyframes: [], transform: nativeTransform({ fitMode: 'cover' }),
        })
      }
      addTransitions(track, clip, clipId, issues)
    }
  }
  const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback
  Object.assign(project.settings, {
    width: positive(config.width, defaults.width), height: positive(config.height, defaults.height),
    frameRate: positive(config.fps, defaults.fps),
  })
  if (typeof config.backgroundColor === 'string' && config.backgroundColor) {
    project.timeline.backgroundFillMode = 'color'
    project.timeline.layoutBackgroundColor = colorFallback(config.backgroundColor)
  }
  project.timeline.duration = duration
  project.mediaLibrary.items = [...media.values()]
  if (textClips.length) project.textClips = textClips
  if (Number.isFinite(playheadMs)) project.playheadSec = seconds(playheadMs)
  if (issues.length) project.migrationIssues = issues
  return project
}
