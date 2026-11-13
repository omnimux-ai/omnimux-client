import { VideoError } from '../../errors.js'

/** Default output audio formats: { codec, extension }. */
export const AUDIO_CODECS = {
  mp3: { codec: 'libmp3lame', ext: 'mp3' },
  m4a: { codec: 'aac', ext: 'm4a' },
}

/** @param {object} input */
export function resolveAudioFormat(input) {
  const fmt = String(input?.outputFormat ?? 'mp3').toLowerCase()
  return AUDIO_CODECS[fmt] ? fmt : null
}

function validateFormat(input) {
  const fmt = resolveAudioFormat(input)
  if (!fmt) {
    throw new VideoError('video-invalid-input', 'outputFormat must be mp3 or m4a')
  }
  return fmt
}

// ---------------------------------------------------------------------------
// audio_extract
// ---------------------------------------------------------------------------

export const extractSlug = 'audio_extract'
export const extractTimeoutMs = 600_000
export const extractDestKind = 'single'

export function validateExtract(input) {
  if (!String(input?.videoUrl || '').trim()) {
    throw new VideoError('video-invalid-input', 'audio_extract requires videoUrl')
  }
  validateFormat(input)
  const dur = input?.durationSeconds
  if (dur !== undefined && dur !== null && (!Number.isFinite(Number(dur)) || Number(dur) <= 0)) {
    throw new VideoError('video-invalid-input', 'audio_extract durationSeconds must be > 0')
  }
}

/** Pure argv for a stream-copy style extraction (seek before input). @param {string} out */
export function buildExtractArgs(input, out) {
  const fmt = resolveAudioFormat(input)
  const bitrate = String(input?.audioBitrate ?? '128k')
  const args = []
  const start = Number(input?.startSeconds ?? 0) || 0
  args.push('-ss', String(start), '-i', String(input.videoUrl))
  if (input?.durationSeconds !== undefined && input?.durationSeconds !== null) {
    args.push('-t', String(input.durationSeconds))
  }
  args.push('-vn')
  args.push('-acodec', AUDIO_CODECS[fmt].codec, '-ab', bitrate)
  args.push(String(out))
  return args
}

/** ffprobe args to test for an audio stream. */
export function buildHasAudioArgs(path) {
  return ['-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'csv=p=0', String(path)]
}

/**
 * Execute extract. When no audio stream exists, succeed with
 * `no_audio_stream: true` and no file (per PRD §5.1).
 * @param {object} input @param {{ dest: string, runFprobe: (args: string[]) => Promise<string>, runFfmpeg: (args: string[]) => Promise<unknown> }} ctx
 */
export async function executeExtract(input, ctx) {
  validateExtract(input)
  const fmt = validateFormat(input)
  const stdout = await ctx.runFprobe(buildHasAudioArgs(input.videoUrl))
  if (!String(stdout).trim()) {
    // No audio stream → succeed without a file (PRD §5.1). The flag rides
    // under `result` so job.js flattens it to the documented success shape:
    // `{ mode:'live', files:[], result:{ no_audio_stream:true, duration:0 } }`.
    return { files: [], result: { no_audio_stream: true, duration: 0 } }
  }
  const out = ctx.dest
  ctx.addFile(out)
  await ctx.runFfmpeg(buildExtractArgs(input, out))
  return { files: [{ path: out, kind: 'audio', meta: { format: fmt } }] }
}

// ---------------------------------------------------------------------------
// audio_prepare
// ---------------------------------------------------------------------------

export const prepareSlug = 'audio_prepare'
export const prepareTimeoutMs = 300_000
export const prepareDestKind = 'single'

export function validatePrepare(input) {
  if (!String(input?.audioUrl || '').trim()) {
    throw new VideoError('video-invalid-input', 'audio_prepare requires audioUrl')
  }
  validateFormat(input)
}

/** Pure argv for re-encoding an audio source. */
export function buildPrepareArgs(input, out) {
  const fmt = validateFormat(input)
  const args = ['-i', String(input.audioUrl)]
  if (input?.durationSeconds !== undefined && input?.durationSeconds !== null) {
    args.push('-t', String(input.durationSeconds))
  }
  args.push('-vn')
  args.push('-acodec', AUDIO_CODECS[fmt].codec)
  args.push('-ab', String(input?.audioBitrate ?? '128k'))
  if (input?.sampleRate !== undefined && input?.sampleRate !== null) {
    args.push('-ar', String(input.sampleRate))
  }
  if (input?.channels !== undefined && input?.channels !== null) {
    args.push('-ac', String(input.channels))
  }
  args.push(String(out))
  return args
}

/**
 * @param {object} input @param {{ dest: string, runFfmpeg: (args: string[]) => Promise<unknown> }} ctx
 */
export async function executePrepare(input, ctx) {
  validatePrepare(input)
  ctx.addFile(ctx.dest)
  await ctx.runFfmpeg(buildPrepareArgs(input, ctx.dest))
  return { files: [{ path: ctx.dest, kind: 'audio', meta: {} }] }
}

/** capability descriptor for audio_extract. */
export const extract = {
  slug: extractSlug,
  timeoutMs: extractTimeoutMs,
  destKind: extractDestKind,
  validate: validateExtract,
  execute: executeExtract,
}

/** capability descriptor for audio_prepare. */
export const prepare = {
  slug: prepareSlug,
  timeoutMs: prepareTimeoutMs,
  destKind: prepareDestKind,
  validate: validatePrepare,
  execute: executePrepare,
}