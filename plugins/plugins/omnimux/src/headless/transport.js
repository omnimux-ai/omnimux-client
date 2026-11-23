import { existsSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OmnimuxError } from '../media/errors.js'

/** Conservative inline transport budget shared across headless multimodal requests. */
export const INLINE_REQUEST_BYTES = 9 * 1024 * 1024
const ENVELOPE_RESERVE_BYTES = 64 * 1024
const SINGLE_VIDEO_MAX_BYTES = 20 * 1024 * 1024

const encodedBytes = (size) => 4 * Math.ceil(size / 3)

function isLocalExistingFile(pathOrUrl) {
  if (typeof pathOrUrl !== 'string' || !pathOrUrl.trim()) return false
  if (/^(?:https?:|data:)/i.test(pathOrUrl)) return false
  if (!existsSync(pathOrUrl)) return false
  return Boolean(statSync(pathOrUrl, { throwIfNoEntry: false })?.isFile())
}

function assertNotAborted(signal) {
  if (!signal?.aborted) return
  if (signal.reason instanceof OmnimuxError) throw signal.reason
  throw new OmnimuxError('headless-skill-cancelled', 'Task cancelled during media preparation')
}

/**
 * Prepare local multimodal references to fit inside the Hub inline transport budget.
 * Never truncates video timelines or strips audio: oversized local videos are routed
 * through the formal `video_inline_analysis_prepare` capability and cleaned up after use.
 *
 * @param {{
 *   prompt: string,
 *   references?: Array<{ type: string, pathOrUrl: string, mime?: string }>,
 * }} payload
 * @param {{
 *   videoProcess?: { execute?: Function } | null,
 *   signal?: AbortSignal,
 *   onPreparing?: () => void,
 * }} [deps]
 * @returns {Promise<{ references?: Array<{ type: string, pathOrUrl: string, mime?: string }>, cleanup: () => Promise<void> }>}
 */
export async function prepareHeadlessTransport(payload, deps = {}) {
  const inputRefs = Array.isArray(payload?.references) ? payload.references : []
  const noopCleanup = async () => {}
  if (!inputRefs.length) {
    return { references: payload?.references, cleanup: noopCleanup }
  }

  const localSizes = inputRefs.map((ref) => (isLocalExistingFile(ref?.pathOrUrl) ? statSync(ref.pathOrUrl).size : null))
  if (localSizes.every((size) => size === null)) {
    return { references: inputRefs, cleanup: noopCleanup }
  }

  let directory = ''
  const cleanup = async () => {
    if (directory) {
      await rm(directory, { recursive: true, force: true })
      directory = ''
    }
  }

  try {
    assertNotAborted(deps.signal)
    const promptBytes = Buffer.byteLength(JSON.stringify(String(payload?.prompt || '')))
    let remaining = INLINE_REQUEST_BYTES - ENVELOPE_RESERVE_BYTES - promptBytes
    const references = inputRefs.map((ref) => ({ ...ref }))
    const localVideos = []

    for (let i = 0; i < references.length; i += 1) {
      const size = localSizes[i]
      if (size === null) continue
      if (references[i].type === 'video') {
        localVideos.push(i)
      } else {
        remaining -= encodedBytes(size) + 256
      }
    }

    if (remaining <= 0) {
      throw new OmnimuxError(
        'headless-skill-transport-exceeded',
        '整帖图片或正文超过分析传输容量，请选择具体素材或正文分析',
      )
    }

    // Reserve small videos at original size, and split remaining budget among oversized videos.
    let pending = [...localVideos]
    while (pending.length) {
      const share = Math.floor(remaining / pending.length)
      const small = pending.filter(
        (i) => encodedBytes(localSizes[i]) + 256 <= share && localSizes[i] <= SINGLE_VIDEO_MAX_BYTES,
      )
      if (!small.length) break
      for (const i of small) {
        remaining -= encodedBytes(localSizes[i]) + 256
      }
      pending = pending.filter((i) => !small.includes(i))
    }

    if (pending.length && typeof deps.videoProcess?.execute !== 'function') {
      throw new OmnimuxError(
        'headless-skill-transport-unavailable',
        '视频较大，需要视频处理能力准备完整视频后再分析',
      )
    }

    const maxRequestBytes = Math.min(
      SINGLE_VIDEO_MAX_BYTES,
      3 * Math.floor((Math.floor(remaining / (pending.length || 1)) - 256) / 4),
    )
    if (pending.length && maxRequestBytes <= 0) {
      throw new OmnimuxError(
        'headless-skill-transport-exceeded',
        '整帖素材超过分析传输容量，请选择具体素材分析',
      )
    }

    if (pending.length) {
      deps.onPreparing?.()
    }

    for (const i of pending) {
      assertNotAborted(deps.signal)
      directory ||= await mkdtemp(join(tmpdir(), 'omnimux-headless-media-'))
      const dest = join(directory, `video-${i}.mp4`)
      const output = await deps.videoProcess.execute({
        capability: 'video_inline_analysis_prepare',
        input: {
          videoUrl: references[i].pathOrUrl,
          maxRequestBytes,
          preserveTimeline: true,
          keepAudio: true,
        },
        dest,
        signal: deps.signal,
      })
      assertNotAborted(deps.signal)
      const file = output?.files?.find((entry) => entry.path === dest && entry.kind === 'video')
      if (
        output?.mode !== 'live'
        || !file
        || file.meta?.preserveTimeline !== true
        || file.meta?.keepAudio !== true
        || file.meta?.overshoot
        || !existsSync(dest)
        || statSync(dest).size > maxRequestBytes
      ) {
        throw new OmnimuxError(
          'headless-skill-transport-exceeded',
          '完整视频准备未满足分析容量，未提交不完整分析',
        )
      }
      references[i] = { ...references[i], type: 'video', pathOrUrl: dest }
    }

    const finalTotal = references.reduce((bytes, ref, idx) => {
      const size = pending.includes(idx)
        ? statSync(ref.pathOrUrl).size
        : localSizes[idx]
      return size === null ? bytes : bytes + encodedBytes(size) + 256
    }, promptBytes + ENVELOPE_RESERVE_BYTES)

    if (finalTotal > INLINE_REQUEST_BYTES) {
      throw new OmnimuxError(
        'headless-skill-transport-exceeded',
        '整帖素材超过分析传输容量，未提交不完整分析',
      )
    }

    return { references, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}
