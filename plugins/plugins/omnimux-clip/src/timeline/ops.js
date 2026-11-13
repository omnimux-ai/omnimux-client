import { ClipDomainError } from '../errors.js'
import {
  computeDurationMs,
  makeClip,
  structuredCloneSafe,
  uid,
} from '../client/store/timelineTypes.js'
import { pickTimeMs, secToMs } from './time.js'

export const CLIP_EDIT_TYPES = [
  'split_clip',
  'trim_clip',
  'remove_clip',
  'remove_range',
  'move_clip',
  'add_clip',
  'import_media',
  'set_text',
  'add_text',
  'set_subtitle_style',
  'set_volume',
  'set_speed',
  'cut_silences',
  'add_transition',
]

/**
 * @param {object} schema
 */
function recompute(schema) {
  schema.canvasConfig = schema.canvasConfig || {}
  schema.canvasConfig.durationMs = computeDurationMs(
    schema.tracks,
    schema.canvasConfig.durationMs || 0,
  )
  return schema
}

/**
 * @param {object} schema
 * @param {string} clipId
 */
export function findClip(schema, clipId) {
  if (!clipId || typeof clipId !== 'string') {
    throw ClipDomainError.invalidJson('clipId is required')
  }
  for (const track of schema.tracks || []) {
    const index = track.clips.findIndex((item) => item.id === clipId)
    if (index >= 0) return { track, clip: track.clips[index], index }
  }
  throw ClipDomainError.notFound(`clip not found: ${clipId}`)
}

/**
 * @param {object} schema
 * @param {string} trackId
 */
export function findTrack(schema, trackId) {
  if (!trackId || typeof trackId !== 'string') {
    throw ClipDomainError.invalidJson('trackId is required')
  }
  const track = (schema.tracks || []).find((item) => item.id === trackId)
  if (!track) throw ClipDomainError.notFound(`track not found: ${trackId}`)
  return track
}

function requireLocked(track, action) {
  if (track.isLocked) {
    throw ClipDomainError.invalidJson(`track ${track.id} is locked; cannot ${action}`)
  }
}

/**
 * Apply one `clip_edit` batch. Mutates a clone; caller persists.
 * One call = one undo step (handled by projectStore.save recordUndo).
 *
 * @param {object} schema
 * @param {unknown} operations
 * @returns {{ schema: object, results: object[] }}
 */
export function applyOperations(schema, operations) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw ClipDomainError.invalidJson('operations must be a non-empty array')
  }
  const next = structuredCloneSafe(schema)
  if (!Array.isArray(next.tracks)) next.tracks = []
  if (!Array.isArray(next.media)) next.media = []
  const results = []
  for (let i = 0; i < operations.length; i += 1) {
    const op = operations[i]
    if (!op || typeof op !== 'object' || Array.isArray(op)) {
      throw ClipDomainError.invalidJson(`operations[${i}] must be an object`)
    }
    const type = /** @type {Record<string, unknown>} */ (op).type
    if (typeof type !== 'string' || !CLIP_EDIT_TYPES.includes(type)) {
      throw ClipDomainError.invalidJson(
        `operations[${i}].type is not supported: ${String(type)}`,
      )
    }
    results.push(applyOne(next, /** @type {Record<string, unknown>} */ (op), i))
  }
  recompute(next)
  return { schema: next, results }
}

/**
 * @param {object} schema
 * @param {Record<string, unknown>} op
 * @param {number} index
 */
function applyOne(schema, op, index) {
  switch (op.type) {
    case 'split_clip':
      return splitClip(schema, op, index)
    case 'trim_clip':
      return trimClip(schema, op, index)
    case 'remove_clip':
      return removeClip(schema, op)
    case 'remove_range':
      return removeRange(schema, op, index)
    case 'move_clip':
      return moveClip(schema, op, index)
    case 'add_clip':
      return addClip(schema, op, index)
    case 'import_media':
      return importMedia(schema, op, index)
    case 'set_text':
    case 'add_text':
    case 'set_subtitle_style':
      return setText(schema, op, index)
    case 'set_volume':
      return setVolume(schema, op)
    case 'set_speed':
      return setSpeed(schema, op)
    case 'cut_silences':
      return cutSilences(schema, op, index)
    case 'add_transition':
      return addTransition(schema, op)
    default:
      throw ClipDomainError.invalidJson(`operations[${index}].type is not supported`)
  }
}

function splitClip(schema, op, index) {
  const clipId = String(op.clipId || '')
  const atMs = pickTimeMs({ ms: op.atMs, sec: op.atSec }, 'at')
  if (atMs == null) throw ClipDomainError.invalidJson(`operations[${index}] needs atSec`)
  const found = findClip(schema, clipId)
  requireLocked(found.track, 'split')
  const { track, clip } = found
  const start = clip.startTimeMs || 0
  const end = start + (clip.durationMs || 0)
  if (atMs <= start + 80 || atMs >= end - 80) {
    throw ClipDomainError.invalidJson(
      `split point ${atMs}ms is too close to clip ${clipId} edges`,
    )
  }
  const offset = atMs - start
  const sourceOffset = Math.round(offset * (clip.speed || 1))
  const right = makeClip({
    ...clip,
    id: uid('clip'),
    startTimeMs: atMs,
    durationMs: clip.durationMs - offset,
    sourceInMs: (clip.sourceInMs || 0) + sourceOffset,
  })
  clip.durationMs = offset
  clip.sourceOutMs = (clip.sourceInMs || 0) + sourceOffset
  track.clips.splice(found.index + 1, 0, right)
  return { type: 'split_clip', clipId, rightClipId: right.id, atMs }
}

function trimClip(schema, op, index) {
  const found = findClip(schema, String(op.clipId || ''))
  requireLocked(found.track, 'trim')
  const startTimeMs = pickTimeMs({ ms: op.startTimeMs, sec: op.startSec }, 'start')
  const durationMs = pickTimeMs({ ms: op.durationMs, sec: op.durationSec }, 'duration')
  const sourceInMs = pickTimeMs({ ms: op.sourceInMs, sec: op.sourceInSec }, 'sourceIn')
  const sourceOutMs = pickTimeMs({ ms: op.sourceOutMs, sec: op.sourceOutSec }, 'sourceOut')
  if (startTimeMs == null && durationMs == null && sourceInMs == null && sourceOutMs == null) {
    throw ClipDomainError.invalidJson(`operations[${index}] trim_clip needs a time field`)
  }
  if (startTimeMs != null) found.clip.startTimeMs = Math.max(0, startTimeMs)
  if (durationMs != null) found.clip.durationMs = Math.max(120, durationMs)
  if (sourceInMs != null) found.clip.sourceInMs = Math.max(0, sourceInMs)
  if (sourceOutMs != null) {
    found.clip.sourceOutMs = Math.max((found.clip.sourceInMs || 0) + 120, sourceOutMs)
  }
  return { type: 'trim_clip', clipId: found.clip.id }
}

function removeClip(schema, op) {
  const clipId = String(op.clipId || '')
  const found = findClip(schema, clipId)
  requireLocked(found.track, 'remove')
  found.track.clips.splice(found.index, 1)
  return { type: 'remove_clip', clipId }
}

function removeRange(schema, op, index) {
  const fromMs = pickTimeMs({ ms: op.fromMs, sec: op.fromSec }, 'from')
  const toMs = pickTimeMs({ ms: op.toMs, sec: op.toSec }, 'to')
  if (fromMs == null || toMs == null || toMs <= fromMs) {
    throw ClipDomainError.invalidJson(`operations[${index}] remove_range needs fromSec < toSec`)
  }
  const tracks = op.trackId
    ? [findTrack(schema, String(op.trackId))]
    : schema.tracks
  const removed = []
  const created = []
  for (const track of tracks) {
    requireLocked(track, 'remove_range')
    const nextClips = []
    for (const clip of track.clips) {
      const start = clip.startTimeMs || 0
      const end = start + (clip.durationMs || 0)
      if (end <= fromMs || start >= toMs) {
        nextClips.push(clip)
        continue
      }
      if (start >= fromMs && end <= toMs) {
        removed.push(clip.id)
        continue
      }
      if (start < fromMs && end > toMs) {
        const leftDur = fromMs - start
        const right = makeClip({
          ...clip,
          id: uid('clip'),
          startTimeMs: toMs,
          durationMs: end - toMs,
          sourceInMs: (clip.sourceInMs || 0) + Math.round((toMs - start) * (clip.speed || 1)),
        })
        clip.durationMs = leftDur
        clip.sourceOutMs = (clip.sourceInMs || 0) + Math.round(leftDur * (clip.speed || 1))
        nextClips.push(clip, right)
        created.push(right.id)
        continue
      }
      if (start < fromMs) {
        clip.durationMs = fromMs - start
        clip.sourceOutMs = (clip.sourceInMs || 0) + Math.round(clip.durationMs * (clip.speed || 1))
        nextClips.push(clip)
        continue
      }
      const cut = toMs - start
      clip.startTimeMs = toMs
      clip.durationMs = end - toMs
      clip.sourceInMs = (clip.sourceInMs || 0) + Math.round(cut * (clip.speed || 1))
      nextClips.push(clip)
    }
    track.clips = nextClips
  }
  return { type: 'remove_range', fromMs, toMs, removedClipIds: removed, createdClipIds: created }
}

function moveClip(schema, op, index) {
  const found = findClip(schema, String(op.clipId || ''))
  requireLocked(found.track, 'move')
  const startTimeMs = pickTimeMs({ ms: op.startTimeMs, sec: op.startSec }, 'start')
  if (startTimeMs == null) {
    throw ClipDomainError.invalidJson(`operations[${index}] move_clip needs startSec`)
  }
  const nextStart = Math.max(0, startTimeMs)
  const destId = typeof op.trackId === 'string' ? op.trackId : found.track.id
  if (destId !== found.track.id) {
    const dest = findTrack(schema, destId)
    requireLocked(dest, 'move')
    found.track.clips.splice(found.index, 1)
    found.clip.trackId = dest.id
    found.clip.startTimeMs = nextStart
    dest.clips.push(found.clip)
  } else {
    found.clip.startTimeMs = nextStart
  }
  return { type: 'move_clip', clipId: found.clip.id, startTimeMs: nextStart, trackId: destId }
}

function addClip(schema, op, index) {
  const track = findTrack(schema, String(op.trackId || ''))
  requireLocked(track, 'add_clip')
  const startTimeMs = pickTimeMs({ ms: op.startTimeMs, sec: op.startSec }, 'start') ?? 0
  const durationMs = pickTimeMs({ ms: op.durationMs, sec: op.durationSec }, 'duration') ?? 3000
  const mediaType = typeof op.mediaType === 'string'
    ? op.mediaType
    : track.type === 'audio' ? 'audio' : track.type === 'text' ? 'text' : 'video'
  const clip = makeClip({
    id: typeof op.clipId === 'string' ? op.clipId : undefined,
    trackId: track.id,
    name: typeof op.name === 'string' ? op.name : '片段',
    mediaType,
    startTimeMs,
    durationMs,
    sourceUrl: typeof op.sourceUrl === 'string' ? op.sourceUrl
      : typeof op.path === 'string' ? op.path : '',
    speed: typeof op.speed === 'number' ? op.speed : 1,
    volume: typeof op.volume === 'number' ? op.volume : 1,
    textStyle: op.textStyle && typeof op.textStyle === 'object' ? op.textStyle : undefined,
  })
  if (mediaType === 'text' && !clip.textStyle) {
    clip.textStyle = {
      presetId: 'subtitle',
      content: typeof op.content === 'string' ? op.content : clip.name,
      fontFamily: 'sans-serif',
      fontSize: 42,
      fontWeight: 'normal',
      color: '#ffffff',
      textAlign: 'center',
    }
  }
  track.clips.push(clip)
  return { type: 'add_clip', clipId: clip.id, trackId: track.id }
}

function importMedia(schema, op, index) {
  const path = typeof op.path === 'string' ? op.path
    : typeof op.sourceUrl === 'string' ? op.sourceUrl : ''
  if (!path) throw ClipDomainError.invalidJson(`operations[${index}] import_media needs path`)
  const mediaType = typeof op.mediaType === 'string' ? op.mediaType
    : typeof op.type === 'string' && op.type !== 'import_media' ? op.type
    : guessMediaType(path)
  const item = {
    id: typeof op.mediaId === 'string' ? op.mediaId : uid('media'),
    name: typeof op.name === 'string' ? op.name : path.split(/[\\/]/).pop() || 'media',
    type: mediaType,
    durationMs: pickTimeMs({ ms: op.durationMs, sec: op.durationSec }, 'duration'),
    path,
  }
  schema.media.push(item)
  let clipId
  if (op.placeOnTimeline !== false) {
    const trackType = mediaType === 'audio' ? 'audio' : mediaType === 'text' ? 'text' : 'video'
    const track = op.trackId
      ? findTrack(schema, String(op.trackId))
      : schema.tracks.find((itemTrack) => itemTrack.type === trackType) || schema.tracks[0]
    if (!track) throw ClipDomainError.notFound('no track available for import_media')
    const added = addClip(schema, {
      type: 'add_clip',
      trackId: track.id,
      name: item.name,
      mediaType,
      path,
      startSec: op.startSec,
      startTimeMs: op.startTimeMs,
      durationSec: op.durationSec,
      durationMs: op.durationMs ?? item.durationMs,
    }, index)
    clipId = added.clipId
  }
  return { type: 'import_media', mediaId: item.id, clipId, path }
}

function guessMediaType(path) {
  const lower = path.toLowerCase()
  if (/\.(mp3|wav|aac|m4a|flac|ogg)$/.test(lower)) return 'audio'
  if (/\.(png|jpe?g|gif|webp|bmp)$/.test(lower)) return 'image'
  if (/\.(srt|vtt|ass)$/.test(lower)) return 'text'
  return 'video'
}

function setText(schema, op, index) {
  const stylePatch = {}
  if (typeof op.content === 'string') stylePatch.content = op.content
  if (typeof op.fontSize === 'number') stylePatch.fontSize = op.fontSize
  if (typeof op.fontFamily === 'string') stylePatch.fontFamily = op.fontFamily
  if (typeof op.fontWeight === 'string') stylePatch.fontWeight = op.fontWeight
  if (typeof op.color === 'string') stylePatch.color = op.color
  if (typeof op.strokeColor === 'string') stylePatch.strokeColor = op.strokeColor
  if (typeof op.strokeWidth === 'number') stylePatch.strokeWidth = op.strokeWidth
  if (typeof op.backgroundColor === 'string') stylePatch.backgroundColor = op.backgroundColor
  if (typeof op.textAlign === 'string') stylePatch.textAlign = op.textAlign
  if (op.textStyle && typeof op.textStyle === 'object') Object.assign(stylePatch, op.textStyle)

  if (typeof op.clipId === 'string' && op.clipId) {
    const found = findClip(schema, op.clipId)
    requireLocked(found.track, 'set_text')
    found.clip.mediaType = 'text'
    found.clip.textStyle = { ...(found.clip.textStyle || {}), ...stylePatch }
    if (stylePatch.content) found.clip.name = String(stylePatch.content).slice(0, 24)
    return { type: 'set_text', clipId: found.clip.id }
  }

  const textTrack = op.trackId
    ? findTrack(schema, String(op.trackId))
    : schema.tracks.find((track) => track.type === 'text')
  if (!textTrack) throw ClipDomainError.notFound('no text track for set_text')
  const added = addClip(schema, {
    type: 'add_clip',
    trackId: textTrack.id,
    mediaType: 'text',
    name: stylePatch.content || '字幕',
    content: stylePatch.content,
    startSec: op.startSec,
    startTimeMs: op.startTimeMs,
    durationSec: op.durationSec,
    durationMs: op.durationMs,
    textStyle: { presetId: 'subtitle', fontFamily: 'sans-serif', fontSize: 42, fontWeight: 'normal', color: '#ffffff', textAlign: 'center', ...stylePatch },
  }, index)
  return { type: 'set_text', clipId: added.clipId, created: true }
}

function setVolume(schema, op) {
  const found = findClip(schema, String(op.clipId || ''))
  requireLocked(found.track, 'set_volume')
  const volume = Number(op.volume)
  if (!Number.isFinite(volume)) throw ClipDomainError.invalidJson('volume must be a number')
  found.clip.volume = Math.max(0, Math.min(1, volume))
  return { type: 'set_volume', clipId: found.clip.id, volume: found.clip.volume }
}

function setSpeed(schema, op) {
  const found = findClip(schema, String(op.clipId || ''))
  requireLocked(found.track, 'set_speed')
  const speed = Number(op.speed)
  if (!Number.isFinite(speed)) throw ClipDomainError.invalidJson('speed must be a number')
  found.clip.speed = Math.max(0.2, Math.min(10, speed))
  return { type: 'set_speed', clipId: found.clip.id, speed: found.clip.speed }
}

function addTransition(schema, op) {
  const found = findClip(schema, String(op.clipId || ''))
  requireLocked(found.track, 'add_transition')
  const type = typeof op.transition === 'string' ? op.transition
    : typeof op.transitionType === 'string' ? op.transitionType
    : 'crossfade'
  const durationMs = pickTimeMs({ ms: op.durationMs, sec: op.durationSec }, 'duration') ?? 400
  found.clip.transition = { type, durationMs }
  return { type: 'add_transition', clipId: found.clip.id, transition: found.clip.transition }
}

/**
 * Host-side silence cut. Prefers explicit `silences: [{fromSec,toSec}]`.
 * Otherwise closes gaps on the target track larger than `minSilenceSec` (default 0.3s).
 * Wasm FFT detection is P2 — this keeps the operation callable without ffmpeg.
 */
function cutSilences(schema, op, index) {
  const silences = Array.isArray(op.silences) ? op.silences : []
  const removed = []
  if (silences.length > 0) {
    const sorted = silences
      .map((item, silenceIndex) => {
        if (!item || typeof item !== 'object') {
          throw ClipDomainError.invalidJson(`operations[${index}].silences[${silenceIndex}] must be an object`)
        }
        const rec = /** @type {Record<string, unknown>} */ (item)
        const fromMs = pickTimeMs({ ms: rec.fromMs, sec: rec.fromSec }, 'from')
        const toMs = pickTimeMs({ ms: rec.toMs, sec: rec.toSec }, 'to')
        if (fromMs == null || toMs == null || toMs <= fromMs) {
          throw ClipDomainError.invalidJson(`operations[${index}].silences[${silenceIndex}] needs fromSec < toSec`)
        }
        return { fromMs, toMs }
      })
      .sort((a, b) => b.fromMs - a.fromMs)
    for (const range of sorted) {
      const result = removeRange(schema, {
        type: 'remove_range',
        trackId: op.trackId,
        fromMs: range.fromMs,
        toMs: range.toMs,
      }, index)
      removed.push(result)
    }
    rippleTrack(schema, op.trackId)
    return { type: 'cut_silences', mode: 'ranges', count: sorted.length, removed }
  }

  const minSilenceMs = pickTimeMs({ ms: op.minSilenceMs, sec: op.minSilenceSec }, 'minSilence')
    ?? secToMs(0.3, 'minSilenceSec')
  const tracks = op.trackId
    ? [findTrack(schema, String(op.trackId))]
    : schema.tracks.filter((track) => track.type === 'video' || track.type === 'audio')
  let closed = 0
  for (const track of tracks) {
    requireLocked(track, 'cut_silences')
    const clips = [...track.clips].sort((a, b) => (a.startTimeMs || 0) - (b.startTimeMs || 0))
    let cursor = 0
    for (const clip of clips) {
      const start = clip.startTimeMs || 0
      const gap = start - cursor
      if (gap >= minSilenceMs) {
        clip.startTimeMs = cursor
        closed += 1
      }
      cursor = (clip.startTimeMs || 0) + (clip.durationMs || 0)
    }
    track.clips = clips
  }
  return { type: 'cut_silences', mode: 'gap-close', closed, minSilenceMs }
}

function rippleTrack(schema, trackId) {
  const tracks = trackId ? [findTrack(schema, String(trackId))] : schema.tracks
  for (const track of tracks) {
    const clips = [...track.clips].sort((a, b) => (a.startTimeMs || 0) - (b.startTimeMs || 0))
    let cursor = 0
    for (const clip of clips) {
      if ((clip.startTimeMs || 0) > cursor) clip.startTimeMs = cursor
      cursor = (clip.startTimeMs || 0) + (clip.durationMs || 0)
    }
    track.clips = clips
  }
}
