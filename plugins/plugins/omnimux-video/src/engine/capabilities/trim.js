import { VideoError } from '../../errors.js'

export const slug = 'video_trim'
export const timeoutMs = 600_000
export const destKind = 'single'

/** @param {object} input @returns {number|null} */
export function resolveDurationSeconds(input) {
  const start = Number(input.startSeconds ?? 0) || 0
  if (input.durationSeconds !== undefined && input.durationSeconds !== null) {
    return Number(input.durationSeconds)
  }
  if (input.endSeconds !== undefined && input.endSeconds !== null) {
    return Number(input.endSeconds) - start
  }
  return null
}

export function validate(input) {
  if (!String(input?.videoUrl || '').trim()) {
    throw new VideoError('video-invalid-input', 'video_trim requires videoUrl')
  }
  const duration = resolveDurationSeconds(input)
  if (duration !== null && (!Number.isFinite(duration) || duration <= 0)) {
    throw new VideoError('video-invalid-input', 'video_trim durationSeconds must be > 0')
  }
}

/** Shared seek prefix builder for trim (both copy and re-encode paths). */
function buildTrimSeek(input, out) {
  const start = Number(input.startSeconds ?? 0) || 0
  const duration = resolveDurationSeconds(input)
  const args = ['-ss', String(start), '-i', String(input.videoUrl)]
  if (duration !== null) args.push('-t', String(duration))
  return { args, out }
}

/**
 * Stream-copy trim argv (`-c copy`, key-frame aligned). Prefer this unless
 * `precise` or it fails.
 * @param {object} input @param {string} out
 */
export function buildTrimCopyArgs(input, out) {
  const { args } = buildTrimSeek(input, out)
  args.push('-c', 'copy')
  if (input.keepAudio === false) args.push('-an')
  args.push(String(out))
  return args
}

/**
 * Full re-encode path (`precise: true` or copy fallback).
 * @param {object} input @param {string} out
 */
export function buildTrimReencodeArgs(input, out) {
  const { args } = buildTrimSeek(input, out)
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23')
  if (input.keepAudio === false) args.push('-an')
  else args.push('-c:a', 'aac')
  args.push('-movflags', '+faststart', String(out))
  return args
}

/**
 * Execute trim. Prefer `-c copy`; falls back to re-encode on a non-zero copy
 * exit or whenever `precise: true`.
 * @param {object} input @param {{ dest: string, runFfmpeg: (args: string[]) => Promise<unknown> }} ctx
 */
export async function execute(input, ctx) {
  validate(input)
  const out = ctx.dest
  ctx.addFile(out)
  if (input.precise) {
    await ctx.runFfmpeg(buildTrimReencodeArgs(input, out))
  } else {
    try {
      await ctx.runFfmpeg(buildTrimCopyArgs(input, out))
    } catch {
      await ctx.runFfmpeg(buildTrimReencodeArgs(input, out))
    }
  }
  return { files: [{ path: out, kind: 'video', meta: {} }] }
}