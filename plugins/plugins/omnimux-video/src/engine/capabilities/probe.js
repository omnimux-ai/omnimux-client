import { VideoError } from '../../errors.js'

export const slug = 'media_metadata'
export const timeoutMs = 120_000
export const destKind = 'none'

/**
 * @param {unknown} input
 * @returns {string} the resolved media path / URL
 */
export function resolveMediaUrl(input) {
  const v = input && typeof input === 'object' ? input : {}
  return v.mediaUrl ?? v.videoUrl ?? v.audioUrl ?? ''
}

/**
 * Pure ffprobe args for a metadata probe (spawn layer adds prefixes).
 * @param {object} input
 * @returns {string[]}
 */
export function buildProbeArgs(input) {
  const url = resolveMediaUrl(input)
  const kind = typeof input?.mediaKind === 'string' ? input.mediaKind : 'auto'
  const args = []
  if (kind === 'video') args.push('-select_streams', 'v:0')
  else if (kind === 'audio') args.push('-select_streams', 'a:0')
  args.push(
    '-show_entries',
    'stream=width,height,duration,codec_type,codec_name:format=duration,size,bit_rate',
    '-of', 'json',
    String(url),
  )
  return args
}

export function validate(input) {
  if (!String(resolveMediaUrl(input) || '').trim()) {
    throw new VideoError('video-invalid-input', 'media_metadata requires mediaUrl / videoUrl / audioUrl')
  }
}

/**
 * @param {unknown} input
 * @param {{ bin: { ffprobe: string }, runFprobe: (args: string[]) => Promise<string>, signal?: AbortSignal }} ctx
 * @returns {Promise<{ files: [], result: object }>}
 */
export async function execute(input, ctx) {
  validate(input)
  const stdout = await ctx.runFprobe(buildProbeArgs(input))
  /** @type {{ streams?: any[], format?: any }} */
  let info
  try {
    info = JSON.parse(stdout)
  } catch (error) {
    throw new VideoError('video-ffmpeg-failed', 'ffprobe returned invalid JSON', {
      stderrTail: String(error),
    })
  }
  const streams = Array.isArray(info.streams) ? info.streams : []
  const stream = streams[0] || {}
  const format = info.format || {}
  let duration = Number(stream.duration)
  if (!duration || duration <= 0) duration = Number(format.duration)
  return {
    files: [],
    result: {
      duration: Number.isFinite(duration) ? duration : 0,
      width: Number(stream.width) || 0,
      height: Number(stream.height) || 0,
      codec_type: stream.codec_type || null,
      codec_name: stream.codec_name || null,
      size: Number(format.size) || 0,
      bit_rate: Number(format.bit_rate) || Number(stream.bit_rate) || 0,
    },
  }
}