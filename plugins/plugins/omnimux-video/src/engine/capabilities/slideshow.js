import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { VideoError } from '../../errors.js'
import { supportsXfade } from '../ffmpeg.js'
import { escapeConcatPath } from './merge.js'

export const slug = 'slideshow_export'
export const timeoutMs = 1_200_000
export const destKind = 'single'

const TRANSITIONS = { fade: 'fade', slide_left: 'slideleft', slide_right: 'slideright', zoom: 'zoomin' }

export function validate(input) {
  const urls = Array.isArray(input?.imageUrls) ? input.imageUrls : []
  if (urls.length < 1) {
    throw new VideoError('video-invalid-input', 'slideshow_export requires at least 1 imageUrl')
  }
}

/** Base (16:9) width per resolution name. */
const BASE_WIDTH = { '4k': 3840, '1440p': 2560, '1080p': 1920, '720p': 1280 }

/** @param {object} input */
export function transitionOf(input) {
  const t = String(input?.transitionType ?? 'none')
  return t === 'none' || TRANSITIONS[t] ? t : 'none'
}

/** Transition duration rule. */
export function transitionDurationFor(durPerImage) {
  return Math.min(0.5, Math.max(0.08, durPerImage * 0.25))
}

function even(n) { return n % 2 === 0 ? n : n + 1 }

/**
 * Compute output canvas from resolution + aspectRatio.
 * `auto` follows the first image's orientation (defaults portrait 9:16).
 */
export function resolveCanvas(input, firstDims = null) {
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
  else if (aspect === '3:5') r = 3 / 5
  else if (aspect === '2:1') r = 2
  else if (aspect === 'auto') {
    r = firstDims && firstDims.w && firstDims.h ? firstDims.w / firstDims.h : 9 / 16
  }

  if (r >= 1) {
    return { width: even(Math.round(short * r)), height: short }
  }
  return { width: short, height: even(Math.round(short / r)) }
}

/** ffprobe args to read a video stream's first-stream dims. */
export function buildProbeArgs(path) {
  return ['-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', String(path)]
}

/** Pure argv for one slide segment (loop + scale/pad to canvas, -an). */
export function buildImageSegmentArgs(input, { image, dur, width, height, fps, out }) {
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps}`
  return [
    '-loop', '1', '-t', String(dur), '-i', String(image),
    '-vf', vf,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-an',
    String(out),
  ]
}

/** Pure argv for no-transition concat (concat demuxer + optional audio). */
export function buildConcatArgs(listPath, dest, { audioUrl, audioVolume = 1.0 } = {}) {
  const audio = audioUrl ? String(audioUrl) : null
  const args = ['-f', 'concat', '-safe', '0', '-i', String(listPath)]
  if (audio) {
    args.push('-stream_loop', '-1', '-i', audio)
    args.push('-map', '0:v:0', '-map', '1:a:0', '-af', `volume=${Number(audioVolume) || 1.0}`)
  } else {
    args.push('-map', '0:v:0')
  }
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p')
  if (audio) args.push('-c:a', 'aac', '-shortest')
  args.push(String(dest))
  return args
}

/** Pure argv for the xfade transition chain (+ optional looping audio). */
export function buildXfadeArgs(segments, { dur, transition, audioUrl, audioVolume = 1.0, dest }) {
  const args = []
  for (const seg of segments) args.push('-i', String(seg))
  const sec = transition || 'fade'
  const td = transitionDurationFor(dur)
  const acTrans = TRANSITIONS[sec] || sec
  const filters = []
  let prev = '0:v'
  for (let i = 1; i < segments.length; i += 1) {
    const outLabel = `x${i}`
    const offset = (dur - td) * i
    filters.push(`[${prev}][${i}:v]xfade=transition=${acTrans}:duration=${td}:offset=${offset}[${outLabel}]`)
    prev = outLabel
  }
  const audio = audioUrl ? String(audioUrl) : null
  let aIdx = segments.length
  if (audio) {
    args.push('-stream_loop', '-1', '-i', audio)
    args.push('-filter_complex', filters.join(';'), '-map', `[${prev}]`, '-map', `${aIdx}:a:0`,
      '-af', `volume=${Number(audioVolume) || 1.0}`)
  } else {
    args.push('-filter_complex', filters.join(';'), '-map', `[${prev}]`)
  }
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p')
  if (audio) args.push('-c:a', 'aac', '-shortest')
  args.push(String(dest))
  void aIdx
  return args
}

/**
 * Execute: build per-image segments then concat (none) or xfade chain,
 * attach optional looping background audio.
 *
 * @param {object} input
 * @param {{ dest: string, tmpDir: string, materialize: (u:string,l:string)=>Promise<string>, runFprobe:(a:string[])=>Promise<string>, runFfmpeg:(a:string[])=>Promise<unknown>, binVersion?: string|null }} ctx
 */
export async function execute(input, ctx) {
  validate(input)
  const fps = Number(input.frameRate) || 30
  const dur = Number(input.durationPerImage) || 1.0
  const transition = transitionOf(input)
  const wantXfade = TRANSITIONS[transition] !== undefined
  const hasXfade = supportsXfade(ctx.binVersion ?? null)
  const xfade = wantXfade && hasXfade
  const degraded = wantXfade && !hasXfade ? ['xfade-missing'] : []

  let firstDims = null
  try {
    const stdout = await ctx.runFprobe(buildProbeArgs(String(input.imageUrls[0])))
    const info = JSON.parse(stdout)
    const s = Array.isArray(info.streams) && info.streams[0] ? info.streams[0] : null
    firstDims = s ? { w: Number(s.width) || 0, h: Number(s.height) || 0 } : null
  } catch { firstDims = null }
  const { width, height } = resolveCanvas(input, firstDims)

  const segments = []
  for (let i = 0; i < input.imageUrls.length; i += 1) {
    const local = await ctx.materialize(input.imageUrls[i], `slideshow-${i}.img`)
    const seg = join(ctx.tmpDir, `seg-${i}.mp4`)
    await ctx.runFfmpeg(buildImageSegmentArgs(input, { image: local, dur, width, height, fps, out: seg }))
    segments.push(seg)
  }

  const audioUrl = input.audioUrl ? String(input.audioUrl) : null
  const audioVolume = Number(input.audioVolume ?? 1.0)
  ctx.addFile(ctx.dest)
  if (xfade) {
    await ctx.runFfmpeg(buildXfadeArgs(segments, { dur, transition, audioUrl, audioVolume, dest: ctx.dest }))
  } else {
    const listPath = join(ctx.tmpDir, 'slideshow-concat.txt')
    await writeFile(listPath, segments.map((p) => `file '${escapeConcatPath(p)}'`).join('\n') + '\n', 'utf8')
    await ctx.runFfmpeg(buildConcatArgs(listPath, ctx.dest, { audioUrl, audioVolume }))
  }
  return {
    files: [{ path: ctx.dest, kind: 'video', meta: { width, height } }],
    result: { canvas: `${width}x${height}`, degraded },
  }
}