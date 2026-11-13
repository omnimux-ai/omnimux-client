import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { VideoError } from '../errors.js'
import { spawnFfmpeg, spawnFfprobe } from './ffmpeg.js'
import { CAPABILITIES, SLUGS } from './video.js'

/**
 * Ensure the destination is ready for the capability's destKind.
 * single → parent dir exists; multi → the directory exists; none → no-op.
 * @param {string} dest @param {'single'|'multi'|'none'} kind
 */
export async function prepDest(dest, kind) {
  if (kind === 'none') return
  if (!String(dest || '').trim()) {
    throw new VideoError('video-invalid-input', `dest is required for ${kind} capabilities`)
  }
  if (kind === 'single') await mkdir(dirname(dest), { recursive: true })
  else await mkdir(dest, { recursive: true })
}

function guessExt(url) {
  try {
    const pathname = new URL(url).pathname
    const m = /\.([a-zA-Z0-9]{1,5})$/.exec(pathname)
    return m ? `.${m[1].toLowerCase()}` : '.dat'
  } catch {
    return '.dat'
  }
}

function safeLabel(label) {
  return String(label || 'input').replace(/[^a-zA-Z0-9._-]/g, '_')
}

/**
 * Turn an input into a local seekable path: http(s) URLs are downloaded into
 * tmpDir; local paths pass through untouched.
 * @param {string} input @param {string} tmpDir @param {string} label
 */
export async function materializeInput(input, tmpDir, label) {
  const s = String(input || '').trim()
  if (/^https?:\/\//i.test(s)) {
    const resp = await fetch(s)
    if (!resp.ok) {
      throw new VideoError('video-ffmpeg-failed', `failed to download ${s}: HTTP ${resp.status}`)
    }
    const buf = Buffer.from(await resp.arrayBuffer())
    const file = join(tmpDir, `${safeLabel(label)}${guessExt(s)}`)
    await writeFile(file, buf)
    return file
  }
  return s
}

/**
 * Orchestration: probe gate → capability validate → dest prep → tmpdir →
 * concurrency gate → spawn → output/cleanup.
 *
 * @param {{
 *   capability: string,
 *   input: object,
 *   dest?: string,
 *   signal?: AbortSignal,
 *   bin: { ffmpeg: string, ffprobe: string, version: string | null, missing: boolean },
 *   acquire: (fn: () => Promise<unknown>) => Promise<unknown>,
 *   procs: Set<unknown>,
 *   videoConfig: { video: { ffmpegPath: string, maxConcurrent: number } },
 * }} req
 */
export async function executeVideoProcess({ capability, input, dest, signal, bin, acquire, procs, videoConfig }) {
  if (!bin || bin.missing) {
    throw new VideoError(
      'ffmpeg-missing',
      'ffmpeg/ffprobe not found. Install with `brew install ffmpeg`, or point Config.video.ffmpegPath / OMNIMUX_VIDEO_FFMPEG_PATH (legacy: DSH_VIDEO_FFMPEG_PATH) at an ffmpeg install.',
      { hint: 'brew install ffmpeg' },
    )
  }
  const cap = CAPABILITIES[capability]
  if (!cap) {
    throw new VideoError('unknown-capability', `unknown capability '${capability}'. Known slugs: ${SLUGS.join(', ')}`)
  }
  cap.validate(input)
  await prepDest(dest, cap.destKind)

  const tmpDir = await mkdtemp(join(tmpdir(), 'omnimux-video-'))
  /** @type {Set<string>} files written this request (cleaned on failure) */
  const written = new Set()
  const ctx = {
    dest,
    tmpDir,
    bin,
    binVersion: bin.version,
    signal,
    procs,
    videoConfig,
    addFile(path) { written.add(String(path)) },
    runFfmpeg(args, opts = {}) {
      return spawnFfmpeg({ bin, args, timeoutMs: opts.timeoutMs ?? cap.timeoutMs, signal, procs, loglevel: opts.loglevel })
    },
    runFprobe(args, opts = {}) {
      return spawnFfprobe({ bin, args, timeoutMs: opts.timeoutMs ?? Math.min(cap.timeoutMs, 120_000), signal, procs })
    },
    materialize(urlOrPath, label) {
      return materializeInput(urlOrPath, tmpDir, label)
    },
  }
  try {
    const outcome = await acquire(() => cap.execute(input, ctx))
    return { mode: 'live', ...outcome }
  } catch (error) {
    await cleanupWritten(written)
    throw error
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Remove half-written outputs after a failure. */
async function cleanupWritten(written) {
  for (const path of written) {
    await unlink(path).catch(() => {})
  }
}