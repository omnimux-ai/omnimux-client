import { stat } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
import { VideoError } from '../errors.js'

const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.mov'])

/**
 * Validate a local video path before handing it to Hub `headlessSkill`.
 * Hub owns transport: it packs small videos inline and prepares oversized ones
 * through `video_inline_analysis_prepare`, so this plugin only checks shape
 * (absolute path / extension / readable file) and never opens OmniMux HTTP.
 * @param {string} source
 */
export async function assertLocalVideo(source) {
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
