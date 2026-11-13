import { VideoError } from '../../errors.js'

export const slug = 'video_thumbnail_extract'
export const timeoutMs = 180_000
export const destKind = 'single'

const DEFAULT_MAX_EDGE = 512

export function validate(input) {
  if (!String(input?.videoUrl || '').trim()) {
    throw new VideoError('video-invalid-input', 'video_thumbnail_extract requires videoUrl')
  }
  const t = input?.timeSeconds ?? 1
  if (Number(t) < 0) {
    throw new VideoError('video-invalid-input', 'timeSeconds must be >= 0')
  }
}

export function resolveThumbDims(input) {
  const fit = String(input?.fit ?? 'inside').toLowerCase() === 'cover' ? 'cover' : 'inside'
  let width = input?.width
  let height = input?.height
  const maxEdge = Number(input?.maxEdge) || DEFAULT_MAX_EDGE
  if ((!width || !height) && fit === 'inside') {
    // Keep aspect within maxEdge: scale to fit, preserving aspect ratio.
    return { filter: `scale='min(${maxEdge},iw)':-2`, fit }
  }
  const w = Number(width) || maxEdge
  const h = Number(height) || maxEdge
  const canvas = `${w}:${h}`
  const scale = fit === 'cover'
    ? `scale=${canvas}:force_original_aspect_ratio=increase,crop=${canvas}`
    : `scale=${canvas}:force_original_aspect_ratio=decrease`
  return { filter: scale, fit, width: w, height: h }
}

/** Pure argv for extracting a single frame. */
export function buildThumbArgs(input, out) {
  const volume = resolveThumbDims(input)
  const t = Number(input?.timeSeconds ?? 1) || 0
  return [
    '-ss', String(t),
    '-i', String(input.videoUrl),
    '-frames:v', '1',
    '-vf', volume.filter,
    '-y', String(out),
  ]
}

/** Candidate seek times tried when a frame at the requested time fails. */
export const RETRY_TIMES = [1, 0.5, 0.1, 2, 3, 5]

/**
 * Execute thumbnail. On a frame-capture failure it retries a few alternate
 * seek times (0.5, 0.1, 2, 3, 5s) before giving up.
 * @param {object} input @param {{ dest: string, runFfmpeg: (args: string[]) => Promise<unknown> }} ctx
 */
export async function execute(input, ctx) {
  validate(input)
  const requested = Number(input?.timeSeconds ?? 1) || 0
  const candidates = [requested, ...RETRY_TIMES.filter((t) => t !== requested)]
  const errors = []
  for (const t of candidates) {
    try {
      const candidate = { ...input, timeSeconds: t }
      ctx.addFile(ctx.dest)
      await ctx.runFfmpeg(buildThumbArgs(candidate, ctx.dest))
      return { files: [{ path: ctx.dest, kind: 'image', meta: { timeSeconds: t } }] }
    } catch (error) {
      errors.push(error)
    }
  }
  throw new VideoError('video-thumbnail-extract-failed', 'could not capture a thumbnail frame', {
    hint: errors.length ? String(errors[0].message) : undefined,
  })
}