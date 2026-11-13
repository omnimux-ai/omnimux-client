/**
 * OpenReel WebCodecs Hardware Accelerated MP4 Export Engine.
 * Composites multi-track timeline frame-by-frame and encodes via VideoEncoder into standard MP4.
 */

import { renderCompositionFrame } from '../render/stageCompositor.js'
import { muxMp4, bytesToBase64 } from './mp4Muxer.js'

function pickCodec() {
  if (typeof VideoEncoder === 'undefined') return null
  return 'avc1.42001f'
}

function even(val) {
  const rounded = Math.round(val)
  return rounded % 2 === 0 ? rounded : rounded + 1
}

/**
 * Encode a TimelineSchema into an MP4 file with WebCodecs hardware acceleration.
 * @param {object} schema
 * @param {{ onProgress?: (info: { ratio: number, frame: number, frameCount: number }) => void, signal?: AbortSignal }} [options]
 * @returns {Promise<{ mp4Blob: Blob, base64: string, durationMs: number, width: number, height: number, thumbnail: string }>}
 */
export async function exportTimelineWithWebCodecs(schema, { onProgress, signal } = {}) {
  const width = even(schema.canvasConfig?.width || 1920)
  const height = even(schema.canvasConfig?.height || 1080)
  const fps = schema.canvasConfig?.fps || 30
  const durationMs = Math.max(200, schema.canvasConfig?.durationMs || 1000)
  const frameCount = Math.max(1, Math.round((durationMs / 1000) * fps))
  const codec = pickCodec()

  if (!codec) {
    throw new Error('export-encode-failed: WebCodecs VideoEncoder is not supported in this browser')
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })
  if (!ctx) throw new Error('export-encode-failed: 2d context unavailable')

  const chunks = []
  let encoderError = null
  const encoder = new VideoEncoder({
    output(chunk, meta) {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      chunks.push({
        data,
        timestamp: chunk.timestamp,
        duration: chunk.duration || Math.round(1_000_000 / fps),
        type: chunk.type,
        description: meta?.decoderConfig?.description
          ? new Uint8Array(meta.decoderConfig.description)
          : undefined,
      })
    },
    error(error) {
      encoderError = error
    },
  })

  const config = {
    codec,
    width,
    height,
    bitrate: Math.max(2_000_000, Math.round(width * height * fps * 0.08)),
    framerate: fps,
    avc: { format: 'avc' },
    hardwareAcceleration: 'prefer-hardware',
  }

  try {
    if (typeof VideoEncoder.isConfigSupported === 'function') {
      const support = await VideoEncoder.isConfigSupported(config)
      if (!support?.supported) {
        delete config.avc
        config.codec = 'avc1.4d001f'
      }
    }
  } catch {
    /* fallback to default */
  }

  encoder.configure(config)

  const frameIntervalMs = 1000 / fps
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    if (signal?.aborted) {
      try {
        encoder.close()
      } catch {
        /* ignore */
      }
      throw new Error('canceled')
    }
    if (encoderError) throw encoderError

    const timeMs = Math.min(durationMs, frameIndex * frameIntervalMs)
    await renderCompositionFrame(ctx, schema, timeMs, { width, height })

    const timestampUs = Math.round(frameIndex * (1_000_000 / fps))
    const videoFrame = new VideoFrame(canvas, {
      timestamp: timestampUs,
      duration: Math.round(1_000_000 / fps),
    })

    const isKeyFrame = frameIndex % Math.max(1, fps * 2) === 0
    encoder.encode(videoFrame, { keyFrame: isKeyFrame })
    videoFrame.close()

    if (encoder.encodeQueueSize > 6) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    if (typeof onProgress === 'function') {
      onProgress({
        ratio: Math.min(0.95, (frameIndex + 1) / frameCount),
        frame: frameIndex + 1,
        frameCount,
      })
    }
  }

  await encoder.flush()
  encoder.close()

  if (chunks.length === 0) {
    throw new Error('export-encode-failed: VideoEncoder produced zero frames')
  }

  // Mux into standard ISO-BMFF MP4 container
  const rawMp4 = muxMp4(chunks, { width, height, fps, durationMs })
  const mp4Blob = new Blob([rawMp4], { type: 'video/mp4' })
  const base64 = bytesToBase64(rawMp4)

  // Generate poster thumbnail
  const thumbnail = canvas.toDataURL('image/jpeg', 0.85)

  if (typeof onProgress === 'function') {
    onProgress({ ratio: 1, frame: frameCount, frameCount })
  }

  return {
    mp4Blob,
    base64,
    durationMs,
    width,
    height,
    thumbnail,
  }
}
