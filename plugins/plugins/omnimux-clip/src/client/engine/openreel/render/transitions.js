/**
 * OpenReel Transition Effects & Shaders Engine.
 * Computes opacity, wipe offsets and blending factors for clip transitions.
 */

/**
 * Compute transition opacity / alpha for a clip at local timestamp.
 * @param {object} clip
 * @param {number} localMs
 * @returns {number} opacity between 0 and 1
 */
export function getTransitionOpacity(clip, localMs) {
  const transition = clip.transition
  if (!transition || !transition.type || transition.type === 'none') {
    return 1
  }

  const duration = Math.max(50, transition.durationMs || 500)
  const clipDuration = clip.durationMs || 1000

  // Fade in at clip start
  if (localMs < duration) {
    const progress = localMs / duration
    if (transition.type === 'crossfade' || transition.type === 'fadeblack') {
      return Math.max(0, Math.min(1, progress))
    }
  }

  // Fade out at clip end
  const remaining = clipDuration - localMs
  if (remaining < duration && remaining >= 0) {
    const progress = remaining / duration
    if (transition.type === 'crossfade' || transition.type === 'fadeblack') {
      return Math.max(0, Math.min(1, progress))
    }
  }

  return 1
}

/**
 * Apply wipe transition offset or clipping if applicable.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} clip
 * @param {number} localMs
 * @param {number} width
 * @param {number} height
 */
export function applyTransitionClipping(ctx, clip, localMs, width, height) {
  const transition = clip.transition
  if (!transition || !transition.type || transition.type === 'none') return

  const duration = Math.max(50, transition.durationMs || 500)
  if (localMs < duration) {
    const progress = localMs / duration
    if (transition.type === 'wipeleft') {
      ctx.beginPath()
      ctx.rect(0, 0, width * progress, height)
      ctx.clip()
    } else if (transition.type === 'wiperight') {
      ctx.beginPath()
      ctx.rect(width * (1 - progress), 0, width * progress, height)
      ctx.clip()
    }
  }
}
