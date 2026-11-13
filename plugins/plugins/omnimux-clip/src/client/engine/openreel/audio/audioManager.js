/**
 * OpenReel Audio Playback & Pitch Preservation Engine.
 * Controls multi-track audio playback with pitch preservation.
 */

let globalAudioCtx = null

export function getAudioContext() {
  if (typeof window === 'undefined') return null
  if (!globalAudioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (AudioCtx) globalAudioCtx = new AudioCtx()
  }
  if (globalAudioCtx && globalAudioCtx.state === 'suspended') {
    globalAudioCtx.resume().catch(() => {})
  }
  return globalAudioCtx
}

export function disposeAudioContext() {
  if (globalAudioCtx) {
    try {
      globalAudioCtx.close().catch(() => {})
    } catch {
      /* ignore */
    }
    globalAudioCtx = null
  }
}
