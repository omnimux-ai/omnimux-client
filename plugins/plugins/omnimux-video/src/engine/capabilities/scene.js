import { join } from 'node:path'
import { VideoError } from '../../errors.js'

export const slug = 'video_scene_detect'
export const timeoutMs = 300_000
export const destKind = 'multi'

const DEFAULT_THRESHOLD = 0.4

export function validate(input) {
  if (!String(input?.videoUrl || '').trim()) {
    throw new VideoError('video-invalid-input', 'video_scene_detect requires videoUrl')
  }
}

/** @param {object} input @returns {number} */
export function thresholdOf(input) {
  const t = Number(input?.threshold ?? DEFAULT_THRESHOLD)
  return Number.isFinite(t) && t >= 0 ? t : DEFAULT_THRESHOLD
}

/**
 * Pure argv: select frames above a scene-change threshold and print metadata
 * (`showinfo`) to stderr so we can read `pts_time`.
 */
export function buildSceneArgs(input) {
  const t = thresholdOf(input)
  return [
    '-i', String(input.videoUrl),
    '-map', '0:v:0',
    '-vf', `select='gt(scene,${t})',showinfo`,
    '-vsync', 'vfr',
    '-f', 'null', '-',
  ]
}

/** Extract scene start times (seconds) from ffmpeg showinfo stderr. */
export function parseSceneTimestamps(stderr) {
  const times = []
  const re = /pts_time:(\d+(?:\.\d+)?)/g
  let m
  while ((m = re.exec(String(stderr))) !== null) {
    const v = Number(m[1])
    if (Number.isFinite(v)) times.push(v)
  }
  // dedupe + sort ascending
  const uniq = [...new Set(times.map((t) => Math.round(t * 100) / 100))].sort((a, b) => a - b)
  return uniq
}

/** Pure argv for extracting a frame at a given time. */
export function buildFrameArgs(input, time, out) {
  return [
    '-ss', String(time),
    '-i', String(input.videoUrl),
    '-frames:v', '1',
    '-q:v', '2',
    String(out),
  ]
}

/** @param {number} index @returns {string} */
export function frameFilename(index) {
  return `frame-${String(index).padStart(3, '0')}.jpg`
}

/**
 * Execute scene detection (ffmpeg `scene` filter approximation). Parses
 * `showinfo` pts_time from stderr; optionally extracts a jpg per cut into dest.
 *
 * NOTE: this is an ffmpeg scene approximation, NOT Python scenedetect.
 * `detectorType`/`returnBase64` are accepted but ignored in v1.
 *
 * The detection pass MUST run at `loglevel: 'info'` so `showinfo`'s
 * `pts_time` lines reach stderr (they are suppressed at `error`); the frame
 * extraction passes keep the default error level.
 * @param {object} input @param {{ dest: string, runFfmpeg: (args: string[], opts?: { loglevel?: string }) => Promise<{ stderr: string }>, runFfmpegText?: (args: string[]) => Promise<unknown> }} ctx
 */
export async function execute(input, ctx) {
  validate(input)
  const { stderr } = await ctx.runFfmpeg(buildSceneArgs(input), { loglevel: 'info' })
  const starts = parseSceneTimestamps(stderr)
  const scenes = starts.map((start, i) => ({
    start,
    end: i + 1 < starts.length ? starts[i + 1] : undefined,
  }))
  const files = []
  if (input?.extractFrames !== false) {
    for (let i = 0; i < starts.length; i += 1) {
      const out = join(ctx.dest, frameFilename(i + 1))
      ctx.addFile(out)
      await ctx.runFfmpeg(buildFrameArgs(input, starts[i], out))
      files.push({ path: out, kind: 'image', meta: { timeSeconds: starts[i] } })
    }
  }
  return { mode: 'live', files, result: { scenes, count: scenes.length } }
}