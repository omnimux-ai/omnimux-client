import { join } from 'node:path'
import { VideoError } from '../../errors.js'

export const slug = 'video_split'
export const timeoutMs = 900_000
export const destKind = 'multi'

/** Normalize segments: each requires startSeconds (default 0) + duration>0. */
export function resolveSegments(input) {
  const segs = Array.isArray(input?.segments) ? input.segments : []
  return segs.map((raw, idx) => {
    const seg = raw && typeof raw === 'object' ? raw : {}
    const start = Number(seg.startSeconds ?? 0) || 0
    let duration = seg.durationSeconds
      ? Number(seg.durationSeconds)
      : seg.endSeconds !== undefined && seg.endSeconds !== null
        ? Number(seg.endSeconds) - start
        : null
    if (duration !== null && (!Number.isFinite(duration) || duration <= 0)) {
      throw new VideoError('video-invalid-input', `segments[${idx}] durationSeconds must be > 0`)
    }
    if (duration === null) {
      throw new VideoError('video-invalid-input', `segments[${idx}] requires durationSeconds or endSeconds`)
    }
    return { start, duration, index: idx + 1 }
  })
}

export function validate(input) {
  if (!String(input?.videoUrl || '').trim()) {
    throw new VideoError('video-invalid-input', 'video_split requires videoUrl')
  }
  if (!Array.isArray(input?.segments) || input.segments.length === 0) {
    throw new VideoError('video-invalid-input', 'video_split requires non-empty segments')
  }
  resolveSegments(input) // throws on bad duration
}

/** Output filename for a segment (1-based, `segment-001.mp4`). */
export function segmentFilename(index) {
  return `segment-${String(index).padStart(3, '0')}.mp4`
}

/** Pure argv for one segment (full re-encode so splits are frame-accurate). */
export function buildSplitArgs(input, { start, duration, keepAudio, dest }) {
  const args = ['-ss', String(start), '-i', String(input.videoUrl), '-t', String(duration),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23']
  if (keepAudio === false) args.push('-an')
  else args.push('-c:a', 'aac')
  args.push('-movflags', '+faststart', String(dest))
  return args
}

/**
 * Execute split: one re-encoded trim per segment into `dest/segment-NNN.mp4`.
 * @param {object} input @param {{ dest: string, runFfmpeg: (args: string[]) => Promise<unknown> }} ctx
 */
export async function execute(input, ctx) {
  validate(input)
  const segments = resolveSegments(input)
  const keepAudio = input?.keepAudio !== false
  const files = []
  for (const seg of segments) {
    const out = join(ctx.dest, segmentFilename(seg.index))
    ctx.addFile(out)
    await ctx.runFfmpeg(buildSplitArgs(input, { ...seg, keepAudio, dest: out }))
    files.push({ path: out, kind: 'video', meta: { index: seg.index } })
  }
  return { files, result: { segmentCount: files.length } }
}