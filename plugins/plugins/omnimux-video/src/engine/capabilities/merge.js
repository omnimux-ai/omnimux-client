import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { VideoError } from '../../errors.js'

export const slug = 'video_merge'
export const timeoutMs = 900_000
export const destKind = 'single'

/** @param {object} input @returns {{ urls: string[], keepAudio: boolean }} */
export function resolveMergeInput(input) {
  return {
    urls: Array.isArray(input?.videoUrls) ? input.videoUrls.map((u) => String(u)) : [],
    keepAudio: input?.keepAudio !== false,
  }
}

export function validate(input) {
  const { urls } = resolveMergeInput(input)
  if (urls.length < 2) {
    throw new VideoError('video-invalid-input', 'video_merge requires at least 2 videoUrls')
  }
}

/** Escape a path for concat demuxer `file '...'` lines. */
export function escapeConcatPath(path) {
  return String(path).replace(/\\/g, '\\\\').replace(/'/g, "'\\''")
}

/** Write the concat list file and return its path. @returns {Promise<string>} */
export async function writeConcatList(paths, listPath) {
  const lines = paths.map((p) => `file '${escapeConcatPath(p)}'`).join('\n') + '\n'
  await writeFile(listPath, lines, 'utf8')
  return listPath
}

/** Pure concat argv (`-c copy` on identical stream params). @param {string} listPath */
export function buildMergeArgs(listPath, { keepAudio = true, dest }) {
  const args = ['-f', 'concat', '-safe', '0', '-i', String(listPath), '-c', 'copy']
  if (keepAudio === false) args.push('-an')
  args.push('-movflags', '+faststart', String(dest))
  return args
}

/** ffprobe args to read one video stream's compatibility attributes. */
export function buildStreamProbeArgs(path) {
  return [
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,pix_fmt',
    '-of', 'json',
    String(path),
  ]
}

/**
 * Compare probed stream descriptors; returns the first differing attribute
 * key (or 'count') or null when compatible.
 * @param {Array<Record<string, unknown> | null>} streams @param {unknown[]} urls
 */
export function incompatibilityKey(streams, urls) {
  if (streams.length !== urls.length) return 'count'
  const first = streams[0]
  if (!first) return 'codec_name'
  for (const key of ['codec_name', 'width', 'height', 'pix_fmt']) {
    for (const s of streams) {
      if (String(s?.[key]) !== String(first[key])) return key
    }
  }
  return null
}

/**
 * Execute merge. Materialises any streaming inputs to local tmp files,
 * ffprobes each, fail-fasts on incompatible streams, then concat `-c copy`.
 *
 * @param {object} input
 * @param {{ dest: string, tmpDir: string, materialize: (url: string, label: string) => Promise<string>, runFprobe: (args: string[]) => Promise<string>, runFfmpeg: (args: string[]) => Promise<unknown> }} ctx
 */
export async function execute(input, ctx) {
  validate(input)
  const { urls, keepAudio } = resolveMergeInput(input)
  const locals = []
  for (let i = 0; i < urls.length; i += 1) {
    locals.push(await ctx.materialize(urls[i], `merge-${i}.mp4`))
  }
  const streams = []
  for (const path of locals) {
    const stdout = await ctx.runFprobe(buildStreamProbeArgs(path))
    let info
    try { info = JSON.parse(stdout) } catch { info = { streams: [] } }
    streams.push(Array.isArray(info.streams) && info.streams[0] ? info.streams[0] : null)
  }
  const badKey = incompatibilityKey(streams, locals)
  if (badKey !== null) {
    throw new VideoError(
      'video-incompatible-streams',
      `merge inputs are not compatible (mismatch on '${badKey}'); transcode all inputs to identical codec/size/pix_fmt first`,
      { hint: 'Re-encode inputs to the same codec/resolution (e.g. via video_trim / a first pass) before concatenating' },
    )
  }
  const listPath = join(ctx.tmpDir, 'concat-list.txt')
  await writeConcatList(locals, listPath)
  ctx.addFile(ctx.dest)
  await ctx.runFfmpeg(buildMergeArgs(listPath, { keepAudio, dest: ctx.dest }))
  return { files: [{ path: ctx.dest, kind: 'video', meta: {} }] }
}