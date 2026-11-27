import { mkdir, mkdtemp, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { VideoError } from '../errors.js'
import { spawnFfmpeg, spawnFfprobe } from './ffmpeg.js'
import {
  MAX_REMOTE_MEDIA_BYTES,
  DEFAULT_REMOTE_FETCH_TIMEOUT_MS,
  assertSafeRemoteMediaUrl,
  materializeInput,
  resolveInputPath,
} from './remote-media.js'
import { CAPABILITIES, SLUGS } from './video.js'

export {
  MAX_REMOTE_MEDIA_BYTES,
  DEFAULT_REMOTE_FETCH_TIMEOUT_MS,
  assertSafeRemoteMediaUrl,
  materializeInput,
  resolveInputPath,
}

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
      return materializeInput(urlOrPath, tmpDir, label, { signal })
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
