import { ClipDomainError } from '../errors.js'
import { isReferenceId, items, safeText } from './nativeProjectFields.js'

const MAX_SENTENCES = 500
const MAX_RANGES = 250
const MAX_MATCHES = 100

/**
 * Pure transcript analysis shared between Host HTTP/saved queries and the live editor.
 */
export function analyzeTranscriptWith(core, project, options = {}) {
  const {
    DEFAULT_FILLER_PHRASES,
    buildTranscript,
    findFillerWords,
    findPauses,
    listSpeakers,
    searchTranscript,
  } = core

  const captionTrackId = options.captionTrackId === undefined ? undefined : options.captionTrackId
  if (captionTrackId !== undefined && !isReferenceId(captionTrackId)) {
    throw ClipDomainError.invalidJson('captionTrackId must be a valid caption track identifier.')
  }
  const minPauseSec = options.minPauseSec === undefined ? 0.6 : options.minPauseSec
  if (typeof minPauseSec !== 'number' || !Number.isFinite(minPauseSec) || minPauseSec < 0.05 || minPauseSec > 60) {
    throw ClipDomainError.invalidJson('minPauseSec must be between 0.05 and 60 seconds.')
  }
  const keepPauseSec = options.keepPauseSec === undefined ? Math.min(0.2, minPauseSec) : options.keepPauseSec
  if (typeof keepPauseSec !== 'number' || !Number.isFinite(keepPauseSec) || keepPauseSec < 0 || keepPauseSec > minPauseSec) {
    throw ClipDomainError.invalidJson('keepPauseSec must be between 0 and minPauseSec.')
  }

  let fillerPhrases = DEFAULT_FILLER_PHRASES
  if (options.fillerPhrases !== undefined) {
    if (!Array.isArray(options.fillerPhrases) || options.fillerPhrases.length === 0 || options.fillerPhrases.length > 64) {
      throw ClipDomainError.invalidJson('fillerPhrases must contain between 1 and 64 non-empty phrases.')
    }
    fillerPhrases = options.fillerPhrases.map((entry, idx) => {
      const cleaned = typeof entry === 'string' ? entry.trim().slice(0, 64) : ''
      if (!cleaned) throw ClipDomainError.invalidJson(`fillerPhrases[${idx}] must be a non-empty string.`)
      return cleaned
    })
  }

  let query
  if (options.query !== undefined) {
    query = typeof options.query === 'string' ? options.query.trim() : ''
    if (!query || query.length > 160) {
      throw ClipDomainError.invalidJson('query must be a non-empty string up to 160 characters.')
    }
  }

  const subtitles = items(project?.timeline?.subtitles)
  const transcript = buildTranscript(subtitles, captionTrackId ? { captionTrackId } : {})
  const filteredSubtitles = captionTrackId
    ? subtitles.filter((cue) => (cue?.captionTrackId ?? '') === captionTrackId)
    : subtitles
  const speakers = listSpeakers(filteredSubtitles).map((name) => safeText(name, 80)).filter(Boolean)

  const sentences = transcript.sentences.slice(0, MAX_SENTENCES).map((sentence) => {
    const text = transcript.words
      .slice(sentence.wordStart, sentence.wordEnd)
      .map((word) => word.text)
      .join(' ')
    return {
      index: sentence.index,
      startSec: sentence.start,
      endSec: sentence.end,
      text: safeText(text, 1000) ?? '',
      ...(sentence.speaker ? { speaker: safeText(sentence.speaker, 80) } : {}),
      wordStart: sentence.wordStart,
      wordEnd: sentence.wordEnd,
    }
  })

  const pauses = findPauses(transcript.words, minPauseSec, { keep: keepPauseSec })
    .slice(0, MAX_RANGES)
    .map((pause) => ({
      startSec: pause.start,
      endSec: pause.end,
      gapSec: pause.gap,
      cutFromSec: pause.cut.start,
      cutToSec: pause.cut.end,
    }))

  const fillers = findFillerWords(transcript.words, fillerPhrases)
    .slice(0, MAX_RANGES)
    .map((match) => ({
      startSec: match.start,
      endSec: match.end,
      text: safeText(match.text, 120) ?? '',
      phrase: safeText(match.phrase, 64) ?? '',
      wordStart: match.wordStart,
      wordEnd: match.wordEnd,
    }))

  const matches = query
    ? searchTranscript(transcript.words, query)
      .slice(0, MAX_MATCHES)
      .map((hit) => {
        const slice = transcript.words.slice(hit.wordStart, hit.wordEnd + 1)
        const startSec = slice[0]?.start ?? 0
        const endSec = slice[slice.length - 1]?.end ?? startSec
        return {
          startSec,
          endSec,
          text: safeText(slice.map((word) => word.text).join(' '), 240) ?? '',
          wordStart: hit.wordStart,
          wordEnd: hit.wordEnd,
        }
      })
    : undefined

  return {
    subtitleCount: filteredSubtitles.length,
    wordCount: transcript.words.length,
    sentenceCount: transcript.sentences.length,
    estimatedWordCount: transcript.words.filter((word) => word.estimated).length,
    speakers,
    sentences,
    pauses,
    fillers,
    ...(matches ? { matches } : {}),
  }
}
