/**
 * OpenReel Video Core Engine — Unified Facade.
 * Vendorized from Augani/openreel-video under MIT License.
 *
 * Exposes:
 * - Types & Constants
 * - Magnet Snapping
 * - Frame Compositor & Video Decoder Pool
 * - Typography & Transitions
 * - Audio Context & FFT Waveform
 * - WebCodecs Hardware Accelerated MP4 Exporter
 */

export * from './core/types.js'
export * from './core/snapping.js'
export * from './render/videoDecoderPool.js'
export * from './render/typography.js'
export * from './render/transitions.js'
export * from './render/stageCompositor.js'
export * from './audio/audioManager.js'
export * from './audio/waveform.js'
export * from './export/webCodecsEncoder.js'
export * from './export/mp4Muxer.js'

/**
 * Release all OpenReel engine resources (video elements, Web Audio context, caches).
 * Call on Overlay unmount.
 */
export function disposeOpenReelEngine() {
  import('./render/videoDecoderPool.js').then(({ disposeMediaPool }) => disposeMediaPool())
  import('./audio/audioManager.js').then(({ disposeAudioContext }) => disposeAudioContext())
}
