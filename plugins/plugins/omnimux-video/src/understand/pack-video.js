import { stat } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
import { VideoError } from '../errors.js'

const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.mov'])

/**
 * Validate a local video path for hub `textComplete.video`.
 * Hub owns data URI packing as `image_url(data:video)`; this plugin only
 * checks path / size and never opens OmniMux HTTP itself.
 * @param {string} source
 * @param {{ maxVideoBytes?: number }} [opts]
 */
export async function assertLocalVideo(source, opts = {}) {
  const raw = String(source || '').trim()
  if (!raw) {
    throw new VideoError('video-invalid-input', 'video is required')
  }
  if (raw.startsWith('data:')) {
    if (!raw.startsWith('data:video/')) {
      throw new VideoError('video-invalid-input', 'video data URI must be data:video/…')
    }
    return { video: raw, name: 'video', bytes: null, kind: 'data-uri' }
  }
  if (/^https?:\/\//i.test(raw)) {
    throw new VideoError(
      'video-invalid-input',
      'video URL input is not supported for understand tools; pass an absolute local path',
    )
  }
  if (!isAbsolute(raw)) {
    throw new VideoError('video-invalid-input', 'video path must be absolute')
  }
  const ext = extnameOf(raw)
  if (!VIDEO_EXT.has(ext)) {
    throw new VideoError('video-invalid-input', 'video path must end in .mp4, .m4v, .webm, or .mov')
  }
  let info
  try {
    info = await stat(raw)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new VideoError('video-invalid-input', `video file not found: ${raw}`)
    }
    throw error
  }
  if (!info.isFile()) {
    throw new VideoError('video-invalid-input', `video path is not a file: ${raw}`)
  }
  const cap = typeof opts.maxVideoBytes === 'number' && opts.maxVideoBytes > 0
    ? opts.maxVideoBytes
    : 20 * 1024 * 1024
  if (info.size > cap) {
    throw new VideoError(
      'video-invalid-input',
      `video exceeds ${cap} bytes; run video_inline_analysis_prepare first or raise Config.understand.maxVideoBytes`,
      { hint: 'use video_process capability=video_inline_analysis_prepare' },
    )
  }
  return { video: raw, name: basename(raw), bytes: info.size, kind: 'path' }
}

/**
 * @param {string} filePath
 */
function extnameOf(filePath) {
  const base = basename(filePath).toLowerCase()
  const dot = base.lastIndexOf('.')
  return dot === -1 ? '' : base.slice(dot)
}
