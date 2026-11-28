import { ClipDomainError } from '../../errors.js'
import { analyzeTranscriptWith } from '../../timeline/analyzeTranscriptCore.js'
import { BeatDetectionEngine, type BeatAnalysisResult } from '../openreel/core/audio/beat-detection-engine'
import {
  DEFAULT_FILLER_PHRASES,
  buildTranscript,
  findFillerWords,
  findPauses,
  listSpeakers,
  searchTranscript,
} from '../openreel/core/captions/transcript'
import { analyzeAudioForHighlights, type TranscriptWord } from '../openreel/core/audio/highlight-analyzer'
import { extractAudioWav } from '../openreel/core/media/extract-audio'
import { calculateProjectDuration } from '../openreel/core/timeline/project-duration'
import { resolveTimelineItem } from '../openreel/core/timeline/timeline-items'
import type { MediaItem, Project } from '../openreel/core/types/project'
import type { Clip } from '../openreel/core/types/timeline'
import { useProjectStore } from '../openreel/web/stores/project-store'
import { assertSafeFields, boolean, fields, invalid, number, onlyKeys, referenceId, type Fields } from './native-input'

const transcriptCore = {
  DEFAULT_FILLER_PHRASES,
  buildTranscript,
  findFillerWords,
  findPauses,
  listSpeakers,
  searchTranscript,
}

export interface NativeAnalyzeOptions {
  assertCurrent?: () => void
  decodeAudioBuffer?: (params: { blob: Blob; mediaItem: MediaItem }) => Promise<AudioBuffer>
}

export interface ResolvedAudioTarget {
  audioBuffer: AudioBuffer
  mediaItem: MediaItem
  clip?: Clip
}

function openProject() {
  const store = useProjectStore.getState()
  if (!store.hasOpenProject) throw ClipDomainError.previewNotReady('Open the project in Clip')
  return store.getFullProject()
}

function selectAudioTarget(project: Project, request: Fields): { mediaItem: MediaItem; clip?: Clip } {
  const hasClip = request.clipId !== undefined
  const hasMedia = request.mediaId !== undefined
  if (hasClip && hasMedia) invalid('Specify either clipId or mediaId, not both')

  if (hasClip) {
    const clipId = referenceId(request.clipId, 'clipId')
    const item = resolveTimelineItem(project, clipId)
    if (!item || item.kind !== 'media') throw ClipDomainError.notFound('Choose an audio or video clip for analysis')
    const mediaItem = project.mediaLibrary.items.find((entry) => entry.id === item.item.mediaId)
    if (!mediaItem || (mediaItem.type !== 'audio' && mediaItem.type !== 'video')) {
      throw new ClipDomainError('audio-analysis-failed', 'The selected clip does not contain audio')
    }
    return { mediaItem, clip: item.item }
  }

  if (hasMedia) {
    const mediaId = referenceId(request.mediaId, 'mediaId')
    const mediaItem = project.mediaLibrary.items.find((entry) => entry.id === mediaId)
    if (!mediaItem || (mediaItem.type !== 'audio' && mediaItem.type !== 'video')) {
      throw new ClipDomainError('audio-analysis-failed', 'The requested media item does not contain audio')
    }
    return { mediaItem }
  }

  const audioTrackClips = project.timeline.tracks
    .filter((track) => track.type === 'audio')
    .flatMap((track) => [...track.clips].sort((a, b) => a.startTime - b.startTime))
  const videoTrackClips = project.timeline.tracks
    .filter((track) => track.type === 'video')
    .flatMap((track) => [...track.clips].sort((a, b) => a.startTime - b.startTime))

  for (const candidate of [...audioTrackClips, ...videoTrackClips]) {
    const mediaItem = project.mediaLibrary.items.find((entry) => entry.id === candidate.mediaId)
    if (mediaItem && (mediaItem.type === 'audio' || mediaItem.type === 'video') && !mediaItem.isPlaceholder) {
      return { mediaItem, clip: candidate }
    }
  }

  const libraryCandidate = project.mediaLibrary.items.find(
    (entry) => (entry.type === 'audio' || entry.type === 'video') && !entry.isPlaceholder,
  )
  if (libraryCandidate) return { mediaItem: libraryCandidate }

  throw new ClipDomainError('audio-analysis-failed', 'No audio or video source is available in this project for analysis')
}

async function resolveBlobForMedia(mediaItem: MediaItem): Promise<Blob> {
  if (mediaItem.blob instanceof Blob) return mediaItem.blob
  if (mediaItem.fileHandle && typeof mediaItem.fileHandle.getFile === 'function') {
    try {
      const file = await mediaItem.fileHandle.getFile()
      if (file instanceof Blob) return file
    } catch (error) {
      console.warn('[omnimux-clip] failed to read fileHandle media for audio analysis:', error)
    }
  }
  if (typeof mediaItem.originalUrl === 'string' && mediaItem.originalUrl.startsWith('blob:')) {
    try {
      const response = await fetch(mediaItem.originalUrl, { redirect: 'error' })
      if (response.ok) return await response.blob()
    } catch (error) {
      console.warn('[omnimux-clip] failed to read blob media for audio analysis:', error)
    }
  }
  throw new ClipDomainError('audio-analysis-failed', 'Media audio bytes are not loaded in the editor')
}

export async function analyzeAudioBeatsSafely(
  audioBuffer: AudioBuffer,
  config?: { minBpm?: number; maxBpm?: number; sensitivity?: number },
): Promise<BeatAnalysisResult> {
  if (audioBuffer.length < 2048) {
    throw new ClipDomainError('audio-analysis-failed', 'Audio clip is too short for beat detection')
  }
  const engine = new BeatDetectionEngine(config)
  try {
    return await engine.analyzeAudioBuffer(audioBuffer)
  } catch (error) {
    console.warn('[omnimux-clip] BeatDetectionEngine failed:', error)
    throw new ClipDomainError(
      'audio-analysis-failed',
      error instanceof Error ? `Beat analysis failed: ${error.message}` : 'Beat analysis failed',
    )
  }
}

function rankAudioHighlights(
  audioBuffer: AudioBuffer,
  transcript: TranscriptWord[],
  prefs: { targetClipCount: number; minClipDuration: number; maxClipDuration: number },
  bounds?: { start: number; end: number },
) {
  const analysis = analyzeAudioForHighlights(audioBuffer, transcript)
  const boundStart = bounds ? Math.max(0, bounds.start) : 0
  const boundEnd = bounds ? Math.min(analysis.duration, bounds.end) : analysis.duration
  const boundSpan = Math.max(0, boundEnd - boundStart)
  if (boundSpan <= 1e-3) return []

  const usable = analysis.segments
    .filter((segment) => !segment.isSilence && segment.end > boundStart + 1e-4 && segment.start < boundEnd - 1e-4)
    .map((segment) => ({
      ...segment,
      start: Math.max(boundStart, segment.start),
      end: Math.min(boundEnd, segment.end),
    }))
    .filter((segment) => segment.end - segment.start > 1e-4)
  if (usable.length === 0) return []

  const windowDuration = Math.min(prefs.maxClipDuration, Math.max(prefs.minClipDuration, 15), boundSpan)
  if (!(windowDuration > 1e-3)) return []

  const maxRms = Math.max(...usable.map((segment) => segment.rmsDb))
  const minRms = Math.min(...usable.map((segment) => segment.rmsDb))
  const rmsRange = Math.max(maxRms - minRms, 1)

  const candidates = usable
    .map((anchor) => {
      const start = Math.min(
        Math.max(boundStart, anchor.start - windowDuration / 3),
        Math.max(boundStart, boundEnd - windowDuration),
      )
      const end = Math.min(boundEnd, start + windowDuration)
      if (end - start <= 1e-3) return null
      const windowSegments = usable.filter((segment) => segment.end > start && segment.start < end)
      const energy = windowSegments.reduce((total, seg) => total + (seg.rmsDb - minRms) / rmsRange, 0) / Math.max(windowSegments.length, 1)
      const speech = windowSegments.reduce((total, seg) => total + seg.speechRate, 0) / Math.max(windowSegments.length, 1)
      const score = Math.min(10, Math.max(1, 1 + energy * 7 + Math.min(speech, 2) * 1))
      return { start, end, score }
    })
    .filter((entry): entry is { start: number; end: number; score: number } => entry !== null)

  const selected: Array<{ start: number; end: number; score: number; title: string; reason: string }> = []
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (selected.some((item) => candidate.start < item.end && candidate.end > item.start)) continue
    selected.push({
      ...candidate,
      title: `Highlight ${selected.length + 1}`,
      reason: transcript.length > 0 ? 'Strong local audio energy and speech activity' : 'Strong local audio energy',
    })
    if (selected.length >= prefs.targetClipCount) break
  }
  return selected.sort((a, b) => a.start - b.start)
}

async function decodeWithWebAudio(blob: Blob): Promise<AudioBuffer> {
  const ctor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (typeof ctor !== 'function') {
    throw new ClipDomainError('audio-analysis-failed', 'Web Audio decoding is unavailable in this environment')
  }
  const audioContext = new ctor()
  try {
    try {
      const wavBlob = await extractAudioWav(blob, 0)
      return await audioContext.decodeAudioData(await wavBlob.arrayBuffer())
    } catch (extractError) {
      console.warn('[omnimux-clip] extracted WAV decode failed, falling back to direct decode:', extractError)
    }
    try {
      return await audioContext.decodeAudioData(await blob.arrayBuffer())
    } catch (directError) {
      console.warn('[omnimux-clip] direct Web Audio decode failed:', directError)
      throw new ClipDomainError('audio-analysis-failed', 'Could not decode an audio track from the media')
    }
  } finally {
    try {
      await audioContext.close()
    } catch (closeError) {
      console.warn('[omnimux-clip] AudioContext close warning:', closeError)
    }
  }
}

export async function resolveAudioBufferForClipOrMedia(
  project: Project,
  target: { clipId?: unknown; mediaId?: unknown },
  options: NativeAnalyzeOptions = {},
): Promise<ResolvedAudioTarget> {
  const { mediaItem, clip } = selectAudioTarget(project, target)
  const blob = await resolveBlobForMedia(mediaItem)
  const audioBuffer = options.decodeAudioBuffer
    ? await options.decodeAudioBuffer({ blob, mediaItem })
    : await decodeWithWebAudio(blob)
  options.assertCurrent?.()

  if (!audioBuffer || audioBuffer.numberOfChannels <= 0 || audioBuffer.length <= 0 || !(audioBuffer.duration > 0)) {
    throw new ClipDomainError('audio-analysis-failed', 'The decoded audio contains no usable samples')
  }
  return { audioBuffer, mediaItem, clip }
}

const TRANSCRIPT_KEYS = ['mode', 'captionTrackId', 'minPauseSec', 'keepPauseSec', 'fillerPhrases', 'query'] as const
const BEAT_KEYS = ['mode', 'clipId', 'mediaId', 'minBpm', 'maxBpm', 'sensitivity', 'subdivision', 'snapToDownbeats', 'limit'] as const
const HIGHLIGHT_KEYS = ['mode', 'clipId', 'mediaId', 'targetClipCount', 'minClipDurationSec', 'maxClipDurationSec', 'captionTrackId'] as const

export async function executeNativeAnalyze(args: unknown, options: NativeAnalyzeOptions = {}) {
  const request = fields(args, 'clip_analyze arguments')
  assertSafeFields(request)
  options.assertCurrent?.()

  const mode = request.mode
  if (mode !== 'transcript' && mode !== 'beats' && mode !== 'highlights') {
    invalid('mode must be transcript, beats, or highlights')
  }

  const project = openProject()
  options.assertCurrent?.()

  if (mode === 'transcript') {
    onlyKeys(request, TRANSCRIPT_KEYS, 'clip_analyze transcript')
    const analysis = analyzeTranscriptWith(transcriptCore, project, request)
    return {
      projectId: project.id,
      mode: 'transcript',
      durationSec: calculateProjectDuration(project),
      ...analysis,
    }
  }

  if (mode === 'beats') {
    onlyKeys(request, BEAT_KEYS, 'clip_analyze beats')
    const minBpm = request.minBpm === undefined ? 60 : number(request.minBpm, 'minBpm', 30, 240)
    const defaultMaxBpm = Math.max(200, minBpm)
    const maxBpm = request.maxBpm === undefined ? defaultMaxBpm : number(request.maxBpm, 'maxBpm', minBpm, 300)
    const sensitivity = request.sensitivity === undefined ? 0.5 : number(request.sensitivity, 'sensitivity', 0.05, 1)
    const subdivision = request.subdivision === undefined ? 1 : number(request.subdivision, 'subdivision', 1, 4)
    if (subdivision !== 1 && subdivision !== 2 && subdivision !== 4) invalid('subdivision must be 1, 2, or 4')
    const snapToDownbeats = boolean(request.snapToDownbeats, 'snapToDownbeats') === true
    const limit = request.limit === undefined ? 300 : number(request.limit, 'limit', 1, 500)
    if (!Number.isInteger(limit)) invalid('limit must be an integer')

    const { audioBuffer, mediaItem, clip } = await resolveAudioBufferForClipOrMedia(project, request, options)
    const rawAnalysis = await analyzeAudioBeatsSafely(audioBuffer, { minBpm, maxBpm, sensitivity })
    options.assertCurrent?.()

    const speed = clip?.speed && clip.speed > 0 ? clip.speed : 1
    const inPoint = clip?.inPoint ?? 0
    const outPoint = clip ? clip.outPoint : rawAnalysis.duration
    const timelineStart = clip?.startTime ?? 0

    const baseBeats = rawAnalysis.beats
      .filter((beat) => !clip || (beat.time >= inPoint - 1e-4 && beat.time <= outPoint + 1e-4))
      .map((beat) => ({
        sourceTimeSec: Number(beat.time.toFixed(4)),
        timeSec: Number((clip ? timelineStart + (beat.time - inPoint) / speed : beat.time).toFixed(4)),
        strength: Number(beat.strength.toFixed(4)),
        index: beat.index,
        isDownbeat: rawAnalysis.downbeats.some((downbeatTime) => Math.abs(downbeatTime - beat.time) < 1e-3),
      }))
      .filter((beat) => !snapToDownbeats || beat.isDownbeat)

    const beats = subdivision === 1
      ? baseBeats
      : baseBeats.flatMap((beat, idx) => {
          const next = baseBeats[idx + 1]
          if (!next) return [{ ...beat, isSubdivision: false }]
          const dtTimeline = (next.timeSec - beat.timeSec) / subdivision
          const dtSource = (next.sourceTimeSec - beat.sourceTimeSec) / subdivision
          return Array.from({ length: subdivision }, (_, subIdx) => ({
            timeSec: Number((beat.timeSec + subIdx * dtTimeline).toFixed(4)),
            sourceTimeSec: Number((beat.sourceTimeSec + subIdx * dtSource).toFixed(4)),
            strength: subIdx === 0 ? beat.strength : Number((beat.strength * 0.5).toFixed(4)),
            index: beat.index * subdivision + subIdx,
            isDownbeat: subIdx === 0 && beat.isDownbeat,
            isSubdivision: subIdx > 0,
          }))
        })

    const downbeats = rawAnalysis.downbeats
      .filter((t) => !clip || (t >= inPoint - 1e-4 && t <= outPoint + 1e-4))
      .map((t) => Number((clip ? timelineStart + (t - inPoint) / speed : t).toFixed(4)))

    return {
      projectId: project.id,
      mode: 'beats',
      ...(clip ? { clipId: clip.id } : {}),
      mediaId: mediaItem.id,
      bpm: rawAnalysis.bpm,
      confidence: Number(rawAnalysis.confidence.toFixed(3)),
      audioDurationSec: rawAnalysis.duration,
      beatCount: beats.length,
      downbeatCount: downbeats.length,
      beats: beats.slice(0, limit),
      downbeats: downbeats.slice(0, limit),
      ...(beats.length > limit ? { truncated: true } : {}),
    }
  }

  onlyKeys(request, HIGHLIGHT_KEYS, 'clip_analyze highlights')
  const captionTrackId = request.captionTrackId === undefined ? undefined : referenceId(request.captionTrackId, 'captionTrackId')
  const targetClipCount = request.targetClipCount === undefined ? 5 : number(request.targetClipCount, 'targetClipCount', 1, 20)
  if (!Number.isInteger(targetClipCount)) invalid('targetClipCount must be an integer')
  const minClipDuration = request.minClipDurationSec === undefined ? 5 : number(request.minClipDurationSec, 'minClipDurationSec', 1, 120)
  const defaultMaxClipDuration = Math.max(60, minClipDuration)
  const maxClipDuration = request.maxClipDurationSec === undefined ? defaultMaxClipDuration : number(request.maxClipDurationSec, 'maxClipDurationSec', minClipDuration, 300)

  const { audioBuffer, mediaItem, clip } = await resolveAudioBufferForClipOrMedia(project, request, options)
  const transcript = buildTranscript(project.timeline.subtitles, captionTrackId ? { captionTrackId } : {})
  const speed = clip?.speed && clip.speed > 0 ? clip.speed : 1
  const inPoint = clip?.inPoint ?? 0
  const outPoint = clip ? Math.min(audioBuffer.duration, clip.outPoint) : audioBuffer.duration
  const timelineStart = clip?.startTime ?? 0

  const transcriptWords = transcript.words
    .map((word) => ({
      text: word.text,
      start: clip ? (word.start - timelineStart) * speed + inPoint : word.start,
      end: clip ? (word.end - timelineStart) * speed + inPoint : word.end,
    }))
    .filter((word) => word.end > inPoint && word.start < outPoint && word.end >= word.start)

  const extracted = rankAudioHighlights(
    audioBuffer,
    transcriptWords,
    { targetClipCount, minClipDuration, maxClipDuration },
    clip ? { start: inPoint, end: outPoint } : undefined,
  )
  options.assertCurrent?.()

  const highlights = extracted
    .map((item) => {
      const startSec = Number((clip ? Math.max(timelineStart, timelineStart + (item.start - inPoint) / speed) : item.start).toFixed(3))
      const endSec = Number((clip ? Math.max(startSec, timelineStart + (item.end - inPoint) / speed) : item.end).toFixed(3))
      return {
        startSec,
        endSec,
        durationSec: Number((endSec - startSec).toFixed(3)),
        score: Number(item.score.toFixed(2)),
        title: item.title,
        reason: item.reason,
      }
    })
    .filter((row) => row.durationSec > 1e-3)

  return {
    projectId: project.id,
    mode: 'highlights',
    ...(clip ? { clipId: clip.id } : {}),
    mediaId: mediaItem.id,
    audioDurationSec: audioBuffer.duration,
    highlightCount: highlights.length,
    highlights,
  }
}
