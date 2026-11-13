/**
 * OpenReel Multi-Layer Stage Frame Compositor.
 * Renders video, image, and text tracks synchronously onto a Canvas 2D / Offscreen context.
 */

import { getPooledVideo, seekVideo, getPooledImage } from './videoDecoderPool.js'
import { drawTypography } from './typography.js'
import { getTransitionOpacity, applyTransitionClipping } from './transitions.js'

/**
 * Filter active visual clips at the given timeline timestamp.
 * @param {object} schema
 * @param {number} timeMs
 * @param {'video'|'text'} [trackType]
 */
export function getActiveClipsAt(schema, timeMs, trackType) {
  const hits = []
  for (const track of schema.tracks || []) {
    if (trackType && track.type !== trackType) continue
    if (track.isVisible === false) continue
    for (const clip of track.clips || []) {
      const start = clip.startTimeMs || 0
      const end = start + (clip.durationMs || 0)
      if (timeMs >= start && timeMs < end) {
        hits.push({
          track,
          clip,
          localMs: timeMs - start,
          sourceOffsetMs: (clip.sourceInMs || 0) + (timeMs - start) * (clip.speed || 1),
        })
      }
    }
  }
  return hits.sort((a, b) => (a.track.order || 0) - (b.track.order || 0))
}

/**
 * Draw a single complete composition frame.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} schema
 * @param {number} timeMs
 * @param {{ width?: number, height?: number }} [options]
 */
export async function renderCompositionFrame(ctx, schema, timeMs, { width, height } = {}) {
  const canvasWidth = width || schema.canvasConfig?.width || 1920
  const canvasHeight = height || schema.canvasConfig?.height || 1080

  ctx.save()
  ctx.fillStyle = schema.canvasConfig?.backgroundColor || '#000000'
  ctx.fillRect(0, 0, canvasWidth, canvasHeight)

  // 1. Render Video and Image tracks
  const visuals = getActiveClipsAt(schema, timeMs, 'video')
  for (const { clip, localMs, sourceOffsetMs } of visuals) {
    ctx.save()
    const opacity = getTransitionOpacity(clip, localMs)
    ctx.globalAlpha = opacity
    applyTransitionClipping(ctx, clip, localMs, canvasWidth, canvasHeight)

    const url = clip.sourceUrl || ''
    const isImage = clip.mediaType === 'image' || looksLikeImage(url)

    if (isImage) {
      const img = await getPooledImage(url)
      if (img) drawCover(ctx, img, canvasWidth, canvasHeight)
      else drawFallbackCard(ctx, canvasWidth, canvasHeight, clip.name || '图片')
    } else if (url) {
      const video = await getPooledVideo(url)
      if (video) {
        await seekVideo(video, sourceOffsetMs / 1000)
        drawCover(ctx, video, canvasWidth, canvasHeight)
      } else {
        drawFallbackCard(ctx, canvasWidth, canvasHeight, clip.name || '视频')
      }
    } else {
      drawFallbackCard(ctx, canvasWidth, canvasHeight, clip.name || '片段')
    }
    ctx.restore()
  }

  // 2. Render Subtitle and Text tracks
  const texts = getActiveClipsAt(schema, timeMs, 'text')
  for (const { clip } of texts) {
    if (clip.textStyle) {
      drawTypography(ctx, clip.textStyle, canvasWidth, canvasHeight)
    }
  }

  ctx.restore()
}

function looksLikeImage(url) {
  return typeof url === 'string' && /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url)
}

function drawCover(ctx, source, targetWidth, targetHeight) {
  const sourceWidth = source.naturalWidth || source.videoWidth || source.width || targetWidth
  const sourceHeight = source.naturalHeight || source.videoHeight || source.height || targetHeight
  if (!sourceWidth || !sourceHeight) return

  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
  const drawWidth = sourceWidth * scale
  const drawHeight = sourceHeight * scale
  const dx = (targetWidth - drawWidth) / 2
  const dy = (targetHeight - drawHeight) / 2

  try {
    ctx.drawImage(source, dx, dy, drawWidth, drawHeight)
  } catch {
    /* ignore draw errors during seek */
  }
}

function drawFallbackCard(ctx, targetWidth, targetHeight, label) {
  ctx.fillStyle = '#18181b'
  ctx.fillRect(0, 0, targetWidth, targetHeight)
  ctx.fillStyle = '#71717a'
  ctx.font = 'bold 36px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, targetWidth / 2, targetHeight / 2)
}
