import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { VideoError } from '../../errors.js'
import { supportsXfade } from '../ffmpeg.js'
import { buildAss, normalizeSubtitleSegments } from './export-ass.js'

export const slug = 'video_export'
export const timeoutMs = 1_200_000
export const destKind = 'single'

const BASE_WIDTH = { '4k': 3840, '1440p': 2560, '1080p': 1920, '720p': 1280 }
const TRANSITIONS = { fade: 'fade', slide_left: 'slideleft', slide_right: 'slideright', zoom: 'zoomin' }

export function validate(input) {
  const clips = Array.isArray(input?.clips) ? input.clips : []
  if (clips.length < 1) {
    throw new VideoError('video-invalid-input', 'video_export requires clips[] with at least 1 clip')
  }
  for (let i = 0; i < clips.length; i += 1) {
    const clip = clips[i] && typeof clips[i] === 'object' ? clips[i] : {}
    if (!String(clip.url || '').trim()) {
      throw new VideoError('video-invalid-input', `clips[${i}] requires url`)
    }
  }
}

/** @param {object} clip @returns {'video'|'image'|'audio'} */
export function clipTypeOf(clip) {
  const t = String(clip?.type ?? 'video')
  return t === 'image' || t === 'audio' ? t : 'video'
}

/** Effective duration for a clip (duration ?? sourceDuration ?? probe). */
export function resolveClipDuration(clip, probeDuration = 0) {
  const d = Number(clip?.duration ?? clip?.sourceDuration ?? probeDuration)
  return Number.isFinite(d) && d > 0 ? d : 3
}

/**
 * Canvas resolution: explicit width/height wins; else resolution + aspectRatio
 * (auto follows the first clip's orientation, default portrait 9:16).
 */
export function resolveExportCanvas(input, firstDims = null) {
  if (Number(input?.width) > 0 && Number(input?.height) > 0) {
    return { width: even(Number(input.width)), height: even(Number(input.height)) }
  }
  const res = String(input?.resolution ?? '720p')
  const baseW = BASE_WIDTH[res] || BASE_WIDTH['720p']
  const short = Math.round(baseW * 9 / 16) || 720 // short edge anchors the canvas
  const aspect = String(input?.aspectRatio ?? 'auto')
  let r = 9 / 16 // width/height
  if (aspect === '16:9') r = 16 / 9
  else if (aspect === '9:16') r = 9 / 16
  else if (aspect === '1:1') r = 1
  else if (aspect === '4:3') r = 4 / 3
  else if (aspect === '3:4') r = 3 / 4
  else if (aspect === '4:5') r = 4 / 5
  else if (aspect === '2:3') r = 2 / 3
  else if (aspect === '2:1') r = 2
  else if (aspect === 'auto') {
    r = firstDims && firstDims.w && firstDims.h ? firstDims.w / firstDims.h : 9 / 16
  }
  if (r >= 1) {
    return { width: even(Math.round(short * r)), height: short }
  }
  return { width: short, height: even(Math.round(short / r)) }
}

function even(n) { const v = Math.round(n); return v % 2 === 0 ? v : v + 1 }

/** Input-prefix args for one clip (seek/loop + duration). */
export function buildClipInputArgs(clip, { duration }) {
  const type = clipTypeOf(clip)
  const args = []
  if (type === 'image') {
    args.push('-loop', '1', '-t', String(duration), '-i', String(clip.url))
  } else {
    const start = Number(clip?.start ?? clip?.offset ?? 0) || 0
    if (start > 0) args.push('-ss', String(start))
    args.push('-t', String(duration), '-i', String(clip.url))
  }
  return args
}

/** Per-clip normalize filter (scale+pad to canvas, fixed fps). */
export function buildClipFilter(i, { width, height, fps }) {
  return `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}[c${i}]`
}

/** Pure concat + optional ASS burn filter graph. Returns { filter, map }. */
export function buildExportFilters(clipCount, { width, height, fps, assPath }) {
  const filters = []
  for (let i = 0; i < clipCount; i += 1) filters.push(buildClipFilter(i, { width, height, fps }))
  const labels = Array.from({ length: clipCount }, (_, i) => `[c${i}]`)
  filters.push(`${labels.join('')}concat=n=${clipCount}:v=1:a=0[base]`)
  let map = '[base]'
  if (assPath) {
    filters.push(`[base]ass=filename=${escapeFilterValue(assPath)}:shaping=complex[sub]`)
    map = '[sub]'
  }
  return { filters, map }
}

/** Escape a path for use inside a ffmpeg filter graph. */
export function escapeFilterValue(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/;/g, '\\;')
}

/** Pure full argv for a concat export (no transition). */
export function buildExportConcatArgs(input, { clipCount, width, height, fps, assPath, dest }) {
  const { filters, map } = buildExportFilters(clipCount, { width, height, fps, assPath })
  const args = ['-filter_complex', filters.join(';'), '-map', map, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-an']
  args.push('-movflags', '+faststart', String(dest))
  return args
}

/** Pure argv for an xfade-chain export (no ASS). */
export function buildExportXfadeArgs(clipCount, { width, height, fps, dur, transition, dest }) {
  const args = []
  const filters = []
  for (let i = 0; i < clipCount; i += 1) filters.push(buildClipFilter(i, { width, height, fps }))
  const td = Math.min(0.5, Math.max(0.08, dur * 0.25))
  const trans = TRANSITIONS[transition] || 'fade'
  let prev = 'c0'
  for (let i = 1; i < clipCount; i += 1) {
    const outLabel = `x${i}`
    const offset = (dur - td) * i
    filters.push(`[${prev}][c${i}]xfade=transition=${trans}:duration=${td}:offset=${offset}[${outLabel}]`)
    prev = outLabel
  }
  args.push('-filter_complex', filters.join(';'), '-map', `[${prev}]`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-an')
  args.push('-movflags', '+faststart', String(dest))
  return args
}

/** True when an ffmpeg failure came from a missing libass/subtitles filter. */
export function isLibassMissing(error) {
  const text = String(error?.message ?? '') + ' ' + String(error?.stderrTail ?? '')
  return /No such filter: '(ass|subtitles)'|Filter not found/.test(text)
}

/**
 * Execute export (v1 core subset): re-encode every clip to a unified canvas,
 * concat (or xfade chain when timeline.transitionType is set), burn optional
 * ASS subtitles. Output is video-only (`-an`) in v1.
 *
 * @param {object} input
 * @param {{ dest: string, tmpDir: string, materialize: (u:string,l:string)=>Promise<string>, runFprobe:(a:string[])=>Promise<string>, runFfmpeg:(a:string[])=>Promise<unknown>, binVersion?: string|null }} ctx
 */
export async function execute(input, ctx) {
  validate(input)
  const clips = input.clips.map((c) => ({ ...c }))
  const fps = Number(input.frameRate) || 30

  // Materialise every clip to a local seekable file.
  const locals = []
  for (let i = 0; i < clips.length; i += 1) {
    const type = clipTypeOf(clips[i])
    const ext = type === 'image' ? '.img' : type === 'audio' ? '.aud' : '.mp4'
    locals.push(await ctx.materialize(clips[i].url, `export-${i}${ext}`))
  }

  // Effective durations (probe video clips without an explicit duration).
  const durations = []
  for (let i = 0; i < clips.length; i += 1) {
    let probe = 0
    if (clipTypeOf(clips[i]) === 'video') {
      try {
        const stdout = await ctx.runFprobe(['-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', locals[i]])
        probe = Number(String(stdout).trim()) || 0
      } catch { probe = 0 }
    }
    durations.push(resolveClipDuration(clips[i], probe))
  }
  const totalDuration = durations.reduce((a, b) => a + b, 0)

  // Canvas: explicit width/height wins; auto follows first clip orientation.
  let firstDims = null
  try {
    const stdout = await ctx.runFprobe(['-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', locals[0]])
    const info = JSON.parse(stdout)
    const s = Array.isArray(info.streams) && info.streams[0] ? info.streams[0] : null
    firstDims = s ? { w: Number(s.width) || 0, h: Number(s.height) || 0 } : null
  } catch { firstDims = null }
  const { width, height } = resolveExportCanvas(input, firstDims)

  // Subtitles: write ASS when provided.
  let assPath = null
  if (input.subtitles) {
    const segs = normalizeSubtitleSegments(input.subtitles, { duration: totalDuration })
    if (segs.length > 0) {
      assPath = join(ctx.tmpDir, 'export-subtitles.ass')
      await writeFile(assPath, buildAss({ width, height, style: input.subtitles.style, segments: segs }), 'utf8')
    }
  }

  const transition = String(input.timeline?.transitionType ?? 'none')
  const wantXfade = TRANSITIONS[transition] !== undefined && clips.length > 1
  const hasXfade = supportsXfade(ctx.binVersion ?? null)
  const xfade = wantXfade && hasXfade && !assPath // v1: ASS burn rides on concat path

  const ffmpegArgs = []
  for (let i = 0; i < clips.length; i += 1) {
    ffmpegArgs.push(...buildClipInputArgs({ ...clips[i], url: locals[i] }, { duration: durations[i] }))
  }
  const tail = xfade
    ? buildExportXfadeArgs(clips.length, { width, height, fps, dur: durations[0], transition, dest: ctx.dest })
    : buildExportConcatArgs(input, { clipCount: clips.length, width, height, fps, assPath, dest: ctx.dest })

  ctx.addFile(ctx.dest)
  try {
    await ctx.runFfmpeg([...ffmpegArgs, ...tail])
  } catch (error) {
    if (assPath && isLibassMissing(error)) {
      throw new VideoError(
        'video-export-failed',
        'ffmpeg has no libass/subtitles filter; cannot burn subtitles',
        { hint: 'Install an ffmpeg build with libass (e.g. brew install ffmpeg), or run without subtitles' },
      )
    }
    throw error
  }

  return {
    files: [{ path: ctx.dest, kind: 'video', meta: { width, height, duration: totalDuration } }],
    result: { canvas: `${width}x${height}`, duration: totalDuration, degraded: wantXfade && !xfade ? ['xfade-missing'] : [] },
  }
}