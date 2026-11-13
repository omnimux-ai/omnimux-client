/**
 * OpenReel Video Core Data Types and Constants.
 * Vendorized from Augani/openreel-video under MIT License.
 */

export const TRACK_TYPES = /** @type {const} */ (['video', 'audio', 'text', 'effect'])

export const DEFAULT_CANVAS_CONFIG = {
  aspectRatio: '16:9',
  width: 1920,
  height: 1080,
  fps: 30,
  durationMs: 0,
  backgroundColor: '#000000',
}

export const SNAP_THRESHOLD_PX = 10

export const DEFAULT_TEXT_STYLE = {
  content: '点击编辑字幕',
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontSize: 48,
  fontWeight: 'bold',
  color: '#ffffff',
  strokeColor: '#000000',
  strokeWidth: 4,
  backgroundColor: 'rgba(0, 0, 0, 0.4)',
  textAlign: 'center',
}

export const TRANSITION_TYPES = /** @type {const} */ ([
  'none',
  'cut',
  'crossfade',
  'fadeblack',
  'fadewhite',
  'wipeleft',
  'wiperight',
])

export function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value)
    } catch {
      /* fall back to JSON clone */
    }
  }
  return JSON.parse(JSON.stringify(value))
}
