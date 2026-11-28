import { ClipDomainError } from '../../errors.js'
import { DEFAULT_ESSENTIAL_SOUND_OPTIONS } from '../openreel/core/audio/essential-sound'
import { DEFAULT_LIVE_DUCKING, normalizeLiveDucking } from '../openreel/core/audio/live-ducking'
import {
  DEFAULT_FILLER_PHRASES,
  buildTranscript,
  findFillerWords,
  findPauses,
  mergeTimeRanges,
  parseTranscriptJson,
} from '../openreel/core/captions/transcript'
import { cutDuration, planTranscriptCut } from '../openreel/core/captions/transcript-edit'
import { EPS } from '../openreel/core/editing/timeline-tool-edit'
import { DEFAULT_IMPORTED_MARKER_COLOR } from '../openreel/core/interchange/model'
import { BeatSyncEngine, type ClipInfo, type SyncMode } from '../openreel/core/text/audio-text-sync-engine'
import { SUBTITLE_STYLE_PRESETS, parseSRT } from '../openreel/core/text/subtitle-engine'
import { calculateProjectDuration } from '../openreel/core/timeline/project-duration'
import { getTrackItems } from '../openreel/core/timeline/timeline-items'
import {
  AUDIO_TYPES,
  MARKER_KINDS,
  type AudioType,
  type LiveDuckingConfig,
  type MarkerKind,
  type Subtitle,
  type SubtitleWord,
} from '../openreel/core/types/timeline'
import { analyzeAudioBeatsSafely, resolveAudioBufferForClipOrMedia, type NativeAnalyzeOptions } from './native-analyze'
import { boolean, fields, invalid, number, onlyKeys, referenceId, seconds, text, type Fields } from './native-input'
import { normalizeColor, parseCaptionStylePatch } from './native-overlays'
import { preserveTransitions, requireItem, type NativeDraft } from './native-timeline'

const newId = () => crypto.randomUUID()
const invalidSubtitle = (message: string): never => { throw new ClipDomainError('subtitle-invalid', message) }
const SYNC_MODES: readonly SyncMode[] = ['cut-to-beats', 'smart', 'one-per-beat', 'preserve-duration']

interface RawTranscriptWord {
  word?: unknown
  text?: unknown
  start?: unknown
  end?: unknown
}

interface RawTranscriptSegment {
  start?: unknown
  end?: unknown
  text?: unknown
  speaker?: unknown
  words?: unknown
}

function normalizeTranscriptJsonInput(raw: unknown): string {
  let root: unknown
  if (typeof raw === 'string') {
    if (raw.length > 512_000) invalidSubtitle('transcriptJson exceeds maximum size')
    try {
      root = JSON.parse(raw)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'invalid syntax'
      throw new ClipDomainError('subtitle-invalid', `transcriptJson must be valid JSON: ${detail}`)
    }
  } else if (Array.isArray(raw) || (raw && typeof raw === 'object')) {
    root = raw
  } else {
    invalidSubtitle('transcriptJson must be a JSON string or object')
  }

  if (!root || typeof root !== 'object') {
    throw new ClipDomainError('subtitle-invalid', 'transcriptJson must be a JSON object or segments array')
  }
  if (Array.isArray(root)) return JSON.stringify(root)
  const record = root as { language?: unknown; segments?: unknown; words?: unknown }
  const topWords = Array.isArray(record.words) ? (record.words as RawTranscriptWord[]) : undefined
  const rawSegments = Array.isArray(record.segments) ? (record.segments as RawTranscriptSegment[]) : undefined

  if (rawSegments && rawSegments.length > 0) {
    if (!topWords || topWords.length === 0) return JSON.stringify(root)
    const segBounds = rawSegments.map((seg) => ({
      start: typeof seg?.start === 'number' && Number.isFinite(seg.start) ? seg.start : NaN,
      end: typeof seg?.end === 'number' && Number.isFinite(seg.end) ? seg.end : NaN,
    }))
    const assignedWords: RawTranscriptWord[][] = rawSegments.map(() => [])
    for (const word of topWords) {
      const wStart = typeof word?.start === 'number' && Number.isFinite(word.start) ? word.start : NaN
      const wEnd = typeof word?.end === 'number' && Number.isFinite(word.end) ? word.end : NaN
      if (!Number.isFinite(wStart) || !Number.isFinite(wEnd) || wEnd < wStart) continue
      const midpoint = (wStart + wEnd) / 2
      let owner = segBounds.findIndex((seg) => Number.isFinite(seg.start) && Number.isFinite(seg.end) && midpoint >= seg.start && midpoint <= seg.end)
      if (owner < 0) {
        let bestDist = Infinity
        segBounds.forEach((seg, idx) => {
          if (!Number.isFinite(seg.start) || !Number.isFinite(seg.end)) return
          if (wStart >= seg.start - 0.05 && wEnd <= seg.end + 0.05) {
            const dist = Math.abs(midpoint - (seg.start + seg.end) / 2)
            if (dist < bestDist) {
              bestDist = dist
              owner = idx
            }
          }
        })
      }
      if (owner >= 0) assignedWords[owner].push(word)
    }
    const enrichedSegments = rawSegments.map((seg, idx) => {
      if (Array.isArray(seg?.words) && seg.words.length > 0) return seg
      const slice = assignedWords[idx]
      return slice && slice.length > 0 ? { ...seg, words: slice } : seg
    })
    return JSON.stringify({ ...record, segments: enrichedSegments })
  }

  if (topWords && topWords.length > 0) {
    const synthesized: RawTranscriptSegment[] = []
    let bucket: RawTranscriptWord[] = []
    for (const word of topWords) {
      const wStart = typeof word?.start === 'number' && Number.isFinite(word.start) ? word.start : undefined
      const wEnd = typeof word?.end === 'number' && Number.isFinite(word.end) ? word.end : undefined
      const wText = String(word?.word ?? word?.text ?? '').trim()
      if (wStart === undefined || wEnd === undefined || wEnd < wStart || !wText) {
        invalidSubtitle('transcriptJson top-level words must include valid text, start, and end')
      }
      const prev = bucket[bucket.length - 1]
      const prevEnd = prev && typeof prev.end === 'number' ? prev.end : wStart
      const bucketStart = bucket.length > 0 && typeof bucket[0].start === 'number' ? bucket[0].start : wStart
      const prevText = prev ? String(prev.word ?? prev.text ?? '').trim() : ''
      const shouldFlush = bucket.length > 0 && (
        wStart - prevEnd >= 0.65
        || wEnd - bucketStart >= 5.0
        || bucket.length >= 12
        || /[.!?。！？…]$/.test(prevText)
      )
      if (shouldFlush) {
        synthesized.push({
          start: bucket[0].start,
          end: bucket[bucket.length - 1].end,
          text: bucket.map((item) => String(item.word ?? item.text ?? '').trim()).join(' '),
          words: bucket,
        })
        bucket = []
      }
      bucket.push(word)
    }
    if (bucket.length > 0) {
      synthesized.push({
        start: bucket[0].start,
        end: bucket[bucket.length - 1].end,
        text: bucket.map((item) => String(item.word ?? item.text ?? '').trim()).join(' '),
        words: bucket,
      })
    }
    return JSON.stringify({ ...record, segments: synthesized })
  }

  return JSON.stringify(root)
}

function parseExplicitCues(rawCues: unknown): Subtitle[] {
  if (!Array.isArray(rawCues) || rawCues.length === 0 || rawCues.length > 2000) {
    invalidSubtitle('cues must contain between 1 and 2000 subtitle entries')
  }
  const cues: Subtitle[] = []
  for (const [index, entry] of rawCues.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      invalidSubtitle(`cues[${index}] must be an object`)
    }
    const item = entry as Fields
    onlyKeys(item, ['id', 'text', 'startSec', 'endSec', 'speaker', 'language', 'words'], `cues[${index}]`)
    const cueId = item.id === undefined ? `cue-${index + 1}` : referenceId(item.id, `cues[${index}].id`)
    const cueText = typeof item.text === 'string' ? item.text.trim() : ''
    if (!cueText || cueText.length > 4096) invalidSubtitle(`cues[${index}].text must be non-empty up to 4096 characters`)
    if (typeof item.startSec !== 'number' || !Number.isFinite(item.startSec) || item.startSec < 0) {
      invalidSubtitle(`cues[${index}].startSec must be a non-negative number`)
    }
    if (typeof item.endSec !== 'number' || !Number.isFinite(item.endSec) || item.endSec <= item.startSec) {
      invalidSubtitle(`cues[${index}].endSec must be greater than startSec`)
    }
    let words: SubtitleWord[] | undefined
    if (item.words !== undefined) {
      if (!Array.isArray(item.words) || item.words.length > 500) {
        invalidSubtitle(`cues[${index}].words must contain up to 500 word items`)
      }
      words = item.words.map((rawWord, wordIdx) => {
        if (!rawWord || typeof rawWord !== 'object' || Array.isArray(rawWord)) {
          invalidSubtitle(`cues[${index}].words[${wordIdx}] must be an object`)
        }
        const word = rawWord as Fields
        onlyKeys(word, ['text', 'startSec', 'endSec'], `cues[${index}].words[${wordIdx}]`)
        const wordText = typeof word.text === 'string' ? word.text.trim() : ''
        if (!wordText || wordText.length > 80) invalidSubtitle(`cues[${index}].words[${wordIdx}].text must be non-empty`)
        if (typeof word.startSec !== 'number' || !Number.isFinite(word.startSec) || word.startSec < 0) {
          invalidSubtitle(`cues[${index}].words[${wordIdx}].startSec must be non-negative`)
        }
        if (typeof word.endSec !== 'number' || !Number.isFinite(word.endSec) || word.endSec < word.startSec) {
          invalidSubtitle(`cues[${index}].words[${wordIdx}].endSec must be >= startSec`)
        }
        return { text: wordText, startTime: word.startSec, endTime: word.endSec }
      })
    }
    const speaker = item.speaker === undefined ? undefined : text(item.speaker, `cues[${index}].speaker`, 80).trim()
    const language = item.language === undefined ? undefined : text(item.language, `cues[${index}].language`, 32).trim()
    cues.push({
      id: cueId,
      text: cueText,
      startTime: item.startSec,
      endTime: item.endSec,
      ...(words?.length ? { words } : {}),
      ...(speaker ? { speaker } : {}),
      ...(language ? { language } : {}),
    })
  }
  return cues
}

export async function importSubtitles(draft: NativeDraft, operation: Fields) {
  const sources = ['srt', 'transcriptJson', 'cues'].filter((key) => operation[key] !== undefined)
  if (sources.length !== 1) invalidSubtitle('Provide exactly one of srt, transcriptJson, or cues')

  const mode = operation.mode === undefined ? 'append' : operation.mode
  if (mode !== 'append' && mode !== 'replace') invalid('mode must be append or replace')

  const captionTrackId = operation.captionTrackId === undefined ? undefined : referenceId(operation.captionTrackId, 'captionTrackId')
  const language = operation.language === undefined ? undefined : text(operation.language, 'language', 32).trim()
  if (operation.language !== undefined && !language) invalidSubtitle('language must be non-empty')

  const timeOffsetSec = operation.timeOffsetSec === undefined ? 0 : number(operation.timeOffsetSec, 'timeOffsetSec', -86400, 86400)
  const { stylePatch, animationStyle, positionPoint } = parseCaptionStylePatch(operation)

  let parsedCues: Subtitle[]
  if (operation.srt !== undefined) {
    const srtContent = text(operation.srt, 'srt', 512_000)
    const parsed = parseSRT(srtContent)
    if (!parsed.success || parsed.subtitles.length === 0) {
      invalidSubtitle(parsed.errors[0]?.message ?? 'SRT content contains no valid cues')
    }
    parsedCues = parsed.subtitles
  } else if (operation.transcriptJson !== undefined) {
    const normalized = normalizeTranscriptJsonInput(operation.transcriptJson)
    const parsed = parseTranscriptJson(normalized, { captionTrackId, language, idPrefix: `sub-${newId().slice(0, 8)}` })
    if (parsed.errors.length > 0 || parsed.subtitles.length === 0) {
      invalidSubtitle(parsed.errors[0] ?? 'transcriptJson contains no valid cues')
    }
    parsedCues = parsed.subtitles
  } else {
    parsedCues = parseExplicitCues(operation.cues)
  }

  const baseSubtitles = mode === 'replace'
    ? (captionTrackId
        ? draft.project.timeline.subtitles.filter((cue) => (cue.captionTrackId ?? '') !== captionTrackId)
        : [])
    : [...draft.project.timeline.subtitles]

  const takenIds = new Set(baseSubtitles.map((cue) => cue.id))
  const hasStyleOverrides = Object.keys(stylePatch).length > 0
  const imported: Subtitle[] = parsedCues.map((cue) => {
    const startTime = cue.startTime + timeOffsetSec
    const endTime = cue.endTime + timeOffsetSec
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < 0 || endTime <= startTime) {
      invalidSubtitle('Subtitle cue timing is negative or empty after applying timeOffsetSec')
    }
    const words = cue.words?.map((word) => {
      const wStart = word.startTime + timeOffsetSec
      const wEnd = word.endTime + timeOffsetSec
      if (!Number.isFinite(wStart) || !Number.isFinite(wEnd) || wStart < 0 || wEnd < wStart) {
        invalidSubtitle('Subtitle word timing is invalid after applying timeOffsetSec')
      }
      return { text: word.text, startTime: wStart, endTime: wEnd }
    })
    let id = cue.id
    if (!id || takenIds.has(id)) id = `sub-${newId()}`
    takenIds.add(id)
    return {
      ...cue,
      id,
      startTime,
      endTime,
      ...(words ? { words } : {}),
      ...(captionTrackId ? { captionTrackId } : {}),
      ...(language ? { language } : {}),
      ...(animationStyle !== undefined ? { animationStyle } : {}),
      ...(positionPoint ? {
        cueSettings: {
          ...cue.cueSettings,
          snapToLines: false,
          line: positionPoint.y * 100,
          lineAlign: 'center',
          position: positionPoint.x * 100,
          positionAlign: 'center',
        },
      } : {}),
      ...(hasStyleOverrides
        ? { style: { ...SUBTITLE_STYLE_PRESETS.default, ...cue.style, ...stylePatch } }
        : cue.style ? { style: cue.style } : {}),
    }
  })

  const nextSubtitles = [...baseSubtitles, ...imported]
  await draft.action('subtitle/setAll', { subtitles: nextSubtitles })
  return {
    mode,
    count: imported.length,
    subtitleCount: nextSubtitles.length,
    createdClipIds: imported.map((cue) => cue.id).slice(0, 100),
    ...(captionTrackId ? { captionTrackId } : {}),
  }
}

export async function setCaptionStyle(draft: NativeDraft, operation: Fields) {
  const { stylePatch, animationStyle, positionPoint } = parseCaptionStylePatch(operation)
  const hasStyleChanges = Object.keys(stylePatch).length > 0 || animationStyle !== undefined || positionPoint !== undefined
  if (!hasStyleChanges) invalid('Provide a caption preset, style property, or animationStyle to update')

  const captionTrackId = operation.captionTrackId === undefined ? undefined : referenceId(operation.captionTrackId, 'captionTrackId')
  const explicitIds = new Set<string>()
  if (operation.clipId !== undefined) explicitIds.add(referenceId(operation.clipId, 'clipId'))
  if (operation.clipIds !== undefined) {
    if (!Array.isArray(operation.clipIds) || operation.clipIds.length === 0 || operation.clipIds.length > 500) {
      invalid('clipIds must contain between 1 and 500 subtitle IDs')
    }
    for (const rawId of operation.clipIds) explicitIds.add(referenceId(rawId, 'clipIds[]'))
  }

  if (draft.project.timeline.subtitles.length === 0) {
    throw ClipDomainError.notFound('No subtitles exist in this timeline')
  }

  const updatedIds: string[] = []
  const nextSubtitles = draft.project.timeline.subtitles.map((cue) => {
    const matchId = explicitIds.size === 0 || explicitIds.has(cue.id)
    const matchTrack = captionTrackId === undefined || (cue.captionTrackId ?? '') === captionTrackId
    if (!matchId || !matchTrack) return cue
    updatedIds.push(cue.id)
    return {
      ...cue,
      ...(animationStyle !== undefined ? { animationStyle } : {}),
      ...(positionPoint ? {
        cueSettings: {
          ...cue.cueSettings,
          snapToLines: false,
          line: positionPoint.y * 100,
          lineAlign: 'center',
          position: positionPoint.x * 100,
          positionAlign: 'center',
        },
      } : {}),
      ...(Object.keys(stylePatch).length > 0
        ? { style: { ...SUBTITLE_STYLE_PRESETS.default, ...cue.style, ...stylePatch } }
        : {}),
    }
  })

  if (updatedIds.length === 0) {
    throw ClipDomainError.notFound('No matching subtitles exist for set_caption_style')
  }

  await draft.action('subtitle/setAll', { subtitles: nextSubtitles })
  return {
    count: updatedIds.length,
    ...(animationStyle !== undefined ? { animationStyle } : {}),
    updatedClipIds: updatedIds.slice(0, 100),
  }
}

export async function cutTranscriptRanges(draft: NativeDraft, operation: Fields) {
  const inferredMode = operation.mode ?? (operation.ranges !== undefined ? 'ranges' : undefined)
  if (inferredMode !== 'ranges' && inferredMode !== 'pauses' && inferredMode !== 'fillers') {
    invalid('mode must be ranges, pauses, or fillers')
  }

  const captionTrackId = operation.captionTrackId === undefined ? undefined : referenceId(operation.captionTrackId, 'captionTrackId')
  const maxCuts = operation.maxCuts === undefined ? 250 : number(operation.maxCuts, 'maxCuts', 1, 250)
  if (!Number.isInteger(maxCuts)) invalid('maxCuts must be an integer')

  let rawRanges: Array<{ start: number; end: number }>
  if (inferredMode === 'ranges') {
    if (!Array.isArray(operation.ranges) || operation.ranges.length === 0 || operation.ranges.length > 250) {
      invalid('ranges must be a non-empty array of time intervals')
    }
    rawRanges = operation.ranges.map((raw, idx) => {
      const range = fields(raw, `ranges[${idx}]`)
      const start = seconds(range, 'fromSec', 'fromMs')
      const end = seconds(range, 'toSec', 'toMs')
      if (start === undefined || end === undefined || !(end > start)) {
        invalid(`ranges[${idx}] requires valid fromSec < toSec`)
      }
      return { start, end }
    })
  } else {
    const transcript = buildTranscript(draft.project.timeline.subtitles, captionTrackId ? { captionTrackId } : {})
    if (inferredMode === 'pauses') {
      const minPauseSec = operation.minPauseSec === undefined ? 0.6 : number(operation.minPauseSec, 'minPauseSec', 0.05, 60)
      const keepPauseSec = operation.keepPauseSec === undefined ? Math.min(0.2, minPauseSec) : number(operation.keepPauseSec, 'keepPauseSec', 0, minPauseSec)
      rawRanges = findPauses(transcript.words, minPauseSec, { keep: keepPauseSec }).map((pause) => pause.cut)
    } else {
      let fillerPhrases: readonly string[] = DEFAULT_FILLER_PHRASES
      if (operation.fillerPhrases !== undefined) {
        if (!Array.isArray(operation.fillerPhrases) || operation.fillerPhrases.length === 0 || operation.fillerPhrases.length > 64) {
          invalid('fillerPhrases must contain between 1 and 64 non-empty strings')
        }
        fillerPhrases = operation.fillerPhrases.map((entry, idx) => {
          const phrase = text(entry, `fillerPhrases[${idx}]`, 64).trim()
          if (!phrase) invalid(`fillerPhrases[${idx}] must be non-empty`)
          return phrase
        })
      }
      const paddingSec = operation.paddingSec === undefined ? 0 : number(operation.paddingSec, 'paddingSec', 0, 0.3)
      const currentDuration = calculateProjectDuration(draft.project)
      rawRanges = findFillerWords(transcript.words, fillerPhrases)
        .map((hit) => ({
          start: Math.max(0, hit.start - paddingSec),
          end: Math.min(currentDuration, hit.end + paddingSec),
        }))
        .filter((range) => range.end > range.start + EPS)
    }
  }

  const merged = mergeTimeRanges(rawRanges).slice(0, maxCuts)
  if (merged.length === 0) {
    return { mode: inferredMode, count: 0, cutDurationSec: 0, removedClipIds: [], createdClipIds: [] }
  }

  const timelineDuration = calculateProjectDuration(draft.project)
  if (merged.some((range) => range.end > timelineDuration + EPS)) {
    invalid('Transcript cut range exceeds the timeline duration')
  }

  for (const range of merged) {
    const blocked = draft.project.timeline.tracks.some((track) => (
      track.locked && getTrackItems(draft.project, track.id).some((item) => item.startTime + item.duration > range.start + EPS)
    ))
    if (blocked) throw new ClipDomainError('TRACK_LOCKED', 'Unlock the affected track before cutting transcript ranges')
  }

  let plan
  try {
    plan = planTranscriptCut(draft.project, merged, newId(), 'Cut transcript ranges')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to plan transcript cut'
    if (/\blocked\b|\bsync-locked\b|\bSync Lock\b/i.test(message)) {
      throw new ClipDomainError('TRACK_LOCKED', message)
    }
    throw ClipDomainError.invalidJson(message)
  }

  draft.plan(plan)
  const clipEdits = plan.edits.filter((edit) => edit.kind === 'media' || edit.kind === 'text')
  return {
    mode: inferredMode,
    count: merged.length,
    cutDurationSec: Number(cutDuration(merged).toFixed(6)),
    removedClipIds: clipEdits.filter((edit) => !edit.after).map((edit) => edit.id),
    createdClipIds: clipEdits.filter((edit) => !edit.before).map((edit) => edit.id),
  }
}

export async function setMarker(draft: NativeDraft, operation: Fields) {
  const markerId = operation.markerId === undefined ? undefined : referenceId(operation.markerId, 'markerId')
  const time = seconds(operation, 'timeSec', 'timeMs')
  const duration = seconds(operation, 'durationSec', 'durationMs')
  const label = operation.label === undefined ? undefined : text(operation.label, 'label', 120).trim()
  if (operation.label !== undefined && !label) invalid('label must be non-empty')
  const markerColor = operation.color === undefined ? undefined : normalizeColor(operation.color, 'color')
  const comment = operation.comment === undefined ? undefined : text(operation.comment, 'comment', 1000)
  let kind: MarkerKind | undefined
  if (operation.kind !== undefined) {
    if (!(MARKER_KINDS as readonly string[]).includes(String(operation.kind))) {
      invalid('kind must be comment, chapter, segmentation, or web')
    }
    kind = operation.kind as MarkerKind
  }

  if (markerId !== undefined) {
    const existing = draft.project.timeline.markers.find((marker) => marker.id === markerId)
    if (!existing) throw ClipDomainError.notFound('The marker does not exist in this timeline')
    const updates: Fields = {
      ...(time !== undefined ? { time } : {}),
      ...(duration !== undefined ? { duration } : {}),
      ...(label !== undefined ? { label } : {}),
      ...(markerColor !== undefined ? { color: markerColor } : {}),
      ...(comment !== undefined ? { comment } : {}),
      ...(kind !== undefined ? { kind } : {}),
    }
    if (Object.keys(updates).length === 0) invalid('Provide at least one marker field to update')
    await draft.action('marker/update', { markerId, updates })
    const updatedMarker = draft.project.timeline.markers.find((marker) => marker.id === markerId) ?? existing
    return {
      markerId,
      timeSec: updatedMarker.time,
      ...(updatedMarker.duration ? { durationSec: updatedMarker.duration } : {}),
      label: updatedMarker.label,
      color: updatedMarker.color,
      ...(updatedMarker.kind ? { kind: updatedMarker.kind } : {}),
      updated: true,
    }
  }

  if (time === undefined) invalid('timeSec is required to add a marker')
  if (!label) invalid('label is required to add a marker')
  const finalColor = markerColor ?? DEFAULT_IMPORTED_MARKER_COLOR
  await draft.action('marker/add', {
    time,
    label,
    color: finalColor,
    ...(duration !== undefined && duration > 0 ? { duration } : {}),
    ...(comment !== undefined ? { comment } : {}),
    ...(kind !== undefined ? { kind } : {}),
  })
  const created = draft.project.timeline.markers[draft.project.timeline.markers.length - 1]
  return {
    markerId: created.id,
    timeSec: created.time,
    ...(created.duration ? { durationSec: created.duration } : {}),
    label: created.label,
    color: created.color,
    ...(created.kind ? { kind: created.kind } : {}),
    created: true,
  }
}

export async function removeMarker(draft: NativeDraft, operation: Fields) {
  const markerId = referenceId(operation.markerId, 'markerId')
  if (!draft.project.timeline.markers.some((marker) => marker.id === markerId)) {
    throw ClipDomainError.notFound('The marker does not exist in this timeline')
  }
  await draft.action('marker/remove', { markerId })
  return { markerId }
}

export async function setAudioDucking(draft: NativeDraft, operation: Fields) {
  const item = requireItem(draft.project, operation.clipId)
  if (item.kind !== 'media') invalid('Choose an audio or video clip for audio ducking')
  const mediaItem = draft.project.mediaLibrary.items.find((entry) => entry.id === item.item.mediaId)
  if (mediaItem && mediaItem.type !== 'audio' && mediaItem.type !== 'video') {
    invalid('Choose an audio or video clip for audio ducking')
  }

  let requestedAudioType: AudioType | null | undefined
  if (operation.audioType !== undefined) {
    if (operation.audioType === null || operation.audioType === 'none') {
      requestedAudioType = null
    } else if ((AUDIO_TYPES as readonly string[]).includes(String(operation.audioType))) {
      requestedAudioType = operation.audioType as AudioType
    } else {
      invalid('audioType must be dialogue, music, sfx, ambience, none, or null')
    }
  }

  const enabled = boolean(operation.enabled, 'enabled')
  const hasDuckParams = ['enabled', 'amountDb', 'attackMs', 'releaseMs', 'holdMs'].some((k) => operation[k] !== undefined)
  if (requestedAudioType === undefined && !hasDuckParams) {
    invalid('Provide audioType or ducking parameters')
  }

  if (requestedAudioType !== undefined) {
    const existingEssential = item.item.metadata?.essentialSound
    const nextState = requestedAudioType === null
      ? null
      : (existingEssential ?? { options: { ...DEFAULT_ESSENTIAL_SOUND_OPTIONS } })
    await draft.action('audio/setEssentialSound', {
      clipId: item.id,
      audioType: requestedAudioType,
      state: nextState,
    })
  }

  let finalDucking: LiveDuckingConfig | undefined = item.item.metadata?.liveDucking
  if (hasDuckParams) {
    const prior = item.item.metadata?.liveDucking ?? DEFAULT_LIVE_DUCKING
    const amountDb = operation.amountDb === undefined ? prior.amountDb : number(operation.amountDb, 'amountDb', 1, 40)
    const attackMs = operation.attackMs === undefined ? prior.attackMs : number(operation.attackMs, 'attackMs', 10, 3000)
    const releaseMs = operation.releaseMs === undefined ? prior.releaseMs : number(operation.releaseMs, 'releaseMs', 10, 3000)
    const holdMs = operation.holdMs === undefined ? prior.holdMs : number(operation.holdMs, 'holdMs', 0, 3000)
    const config = normalizeLiveDucking({
      enabled: enabled ?? prior.enabled,
      amountDb,
      attackMs,
      releaseMs,
      holdMs,
    })
    await draft.action('audio/setLiveDucking', { clipId: item.id, config })
    finalDucking = config
  }

  const finalAudioType = requestedAudioType !== undefined ? requestedAudioType : item.item.audioType
  return {
    clipId: item.id,
    ...(finalAudioType ? { audioType: finalAudioType } : {}),
    ...(finalDucking ? { liveDucking: finalDucking } : {}),
  }
}

export async function syncClipsToBeats(draft: NativeDraft, operation: Fields, options: NativeAnalyzeOptions = {}) {
  if (!Array.isArray(operation.clipIds) || operation.clipIds.length === 0 || operation.clipIds.length > 100) {
    invalid('clipIds must contain between 1 and 100 clip IDs')
  }
  const uniqueClipIds = [...new Set(operation.clipIds.map((id, idx) => referenceId(id, `clipIds[${idx}]`)))]
  const targetClips = uniqueClipIds.map((id) => {
    const item = requireItem(draft.project, id)
    if (item.kind !== 'media') invalid(`Clip "${id}" is not a media clip`)
    return item
  })

  const syncMode = (operation.syncMode ?? 'cut-to-beats') as SyncMode
  if (!SYNC_MODES.includes(syncMode)) invalid('syncMode must be cut-to-beats, smart, one-per-beat, or preserve-duration')
  const beatsPerClip = operation.beatsPerClip === undefined ? 4 : number(operation.beatsPerClip, 'beatsPerClip', 1, 8)
  if (beatsPerClip !== 1 && beatsPerClip !== 2 && beatsPerClip !== 4 && beatsPerClip !== 8) {
    invalid('beatsPerClip must be 1, 2, 4, or 8')
  }
  const subdivision = operation.subdivision === undefined ? 1 : number(operation.subdivision, 'subdivision', 1, 4)
  if (subdivision !== 1 && subdivision !== 2 && subdivision !== 4) invalid('subdivision must be 1, 2, or 4')
  const offsetSec = operation.offsetSec === undefined ? 0 : number(operation.offsetSec, 'offsetSec', -10, 10)
  const snapToDownbeats = boolean(operation.snapToDownbeats, 'snapToDownbeats') === true

  let beatAnalysis
  let audioStartSec = operation.audioStartSec === undefined ? 0 : number(operation.audioStartSec, 'audioStartSec')
  if (operation.beats !== undefined) {
    if (operation.audioClipId !== undefined) invalid('Specify either beats or audioClipId, not both')
    if (!Array.isArray(operation.beats) || operation.beats.length < 2 || operation.beats.length > 1000) {
      invalid('beats must contain between 2 and 1000 beat timestamps in seconds')
    }
    const rawBeats = operation.beats.map((t, idx) => number(t, `beats[${idx}]`, 0, 86400))
    const sorted = [...new Set(rawBeats)].sort((a, b) => a - b)
    if (sorted.length < 2) invalid('Provide at least two distinct beat timestamps')
    const intervals = sorted.slice(1).map((t, idx) => t - sorted[idx])
    const avgInterval = intervals.reduce((sum, dt) => sum + dt, 0) / intervals.length
    beatAnalysis = {
      bpm: avgInterval > 0 ? Math.round(60 / avgInterval) : 120,
      confidence: 1,
      duration: Math.max(sorted[sorted.length - 1] + avgInterval, calculateProjectDuration(draft.project)),
      beats: sorted.map((time, index) => ({ time, strength: 1, index })),
      downbeats: sorted.filter((_, index) => index % 4 === 0),
    }
  } else {
    const resolved = await resolveAudioBufferForClipOrMedia(
      draft.project,
      operation.audioClipId !== undefined ? { clipId: operation.audioClipId } : {},
      options,
    )
    const analyzed = await analyzeAudioBeatsSafely(resolved.audioBuffer)
    if (resolved.clip) {
      const speed = resolved.clip.speed > 0 ? resolved.clip.speed : 1
      const inPoint = resolved.clip.inPoint
      const outPoint = resolved.clip.outPoint
      const clipBeats = analyzed.beats
        .filter((beat) => beat.time >= inPoint - 1e-4 && beat.time <= outPoint + 1e-4)
        .map((beat, index) => ({
          ...beat,
          time: Math.max(0, (beat.time - inPoint) / speed),
          index,
        }))
      if (clipBeats.length < 2) {
        throw new ClipDomainError('audio-analysis-failed', 'Not enough rhythmic beats detected in the trimmed audio clip')
      }
      if (operation.audioStartSec === undefined) {
        audioStartSec = resolved.clip.startTime
      }
      const clipDownbeats = analyzed.downbeats
        .filter((t) => t >= inPoint - 1e-4 && t <= outPoint + 1e-4)
        .map((t) => Math.max(0, (t - inPoint) / speed))
      beatAnalysis = {
        ...analyzed,
        duration: resolved.clip.duration,
        beats: clipBeats,
        downbeats: clipDownbeats.length > 0
          ? clipDownbeats
          : clipBeats.filter((_, index) => index % 4 === 0).map((beat) => beat.time),
      }
    } else {
      if (analyzed.beats.length < 2) {
        throw new ClipDomainError('audio-analysis-failed', 'Not enough rhythmic beats detected in the audio source')
      }
      beatAnalysis = analyzed
    }
  }

  const clipInfos: ClipInfo[] = targetClips.map((entry) => ({
    id: entry.id,
    startTime: entry.item.startTime,
    duration: entry.item.duration,
    trackId: entry.trackId,
  }))

  let timings
  try {
    timings = new BeatSyncEngine().calculateSyncedTimings(clipInfos, beatAnalysis, audioStartSec, {
      syncMode,
      beatSubdivision: subdivision,
      beatsPerClip,
      offsetMs: offsetSec * 1000,
      snapToDownbeats,
    })
  } catch (error) {
    throw ClipDomainError.invalidJson(error instanceof Error ? error.message : 'Unable to sync clips to beats')
  }

  if (timings.length === 0) invalid('Not enough beats to synchronize the selected clips')

  const initial = draft.project
  const timingById = new Map(timings.map((item) => [item.clipId, item]))
  const mediaById = new Map(initial.mediaLibrary.items.map((item) => [item.id, item]))
  const trackById = new Map(initial.timeline.tracks.map((track) => [track.id, track]))
  const edits = []

  // Validate source bounds & track non-overlap before mutating draft
  for (const track of initial.timeline.tracks) {
    const rows = track.clips.map((clip) => {
      const synced = timingById.get(clip.id)
      if (!synced) return { id: clip.id, start: clip.startTime, end: clip.startTime + clip.duration }
      return { id: clip.id, start: synced.newStartTime, end: synced.newStartTime + synced.newDuration }
    }).sort((a, b) => a.start - b.start || a.end - b.end)
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].start < rows[i - 1].end - EPS) throw ClipDomainError.clipOverlap()
    }
  }

  for (const entry of targetClips) {
    const synced = timingById.get(entry.id)
    if (!synced) continue
    const clip = entry.item
    const speed = clip.speed > 0 ? clip.speed : 1
    const nextOut = clip.inPoint + synced.newDuration * speed
    const mediaItem = mediaById.get(clip.mediaId)
    const maxSourceEnd = mediaItem?.type === 'image'
      ? Infinity
      : ((mediaItem?.metadata?.duration ?? 0) > 0 ? mediaItem!.metadata.duration : clip.outPoint)
    if (synced.newStartTime < -1e-6 || synced.newDuration <= EPS || nextOut > maxSourceEnd + 1e-4) {
      invalid(`Beat-synced duration exceeds available source bounds for clip "${clip.id}"`)
    }
    const track = trackById.get(entry.trackId)!
    edits.push({
      kind: 'media' as const,
      id: clip.id,
      trackId: entry.trackId,
      index: track.clips.indexOf(clip),
      before: clip,
      after: {
        ...clip,
        startTime: Math.max(0, synced.newStartTime),
        duration: synced.newDuration,
        outPoint: Math.min(nextOut, maxSourceEnd),
      },
    })
  }

  draft.plan({ label: 'Sync clips to beats', delta: 0, edits })
  draft.replace(preserveTransitions(draft.project, initial))
  return {
    syncMode,
    bpm: beatAnalysis.bpm,
    beatCount: beatAnalysis.beats.length,
    count: edits.length,
    syncedClips: edits.map((edit) => ({
      clipId: edit.id,
      startSec: edit.after.startTime,
      durationSec: edit.after.duration,
    })),
  }
}
