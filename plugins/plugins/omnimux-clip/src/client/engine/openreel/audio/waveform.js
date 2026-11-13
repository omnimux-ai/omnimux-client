/**
 * OpenReel Audio Waveform Generator.
 * Extracts peak/RMS waveform data from audio/video files for timeline track visualization.
 */

const waveformCache = new Map()

/**
 * Generate normalized waveform peaks for a given audio/video URL.
 * @param {string} url
 * @param {number} [numBuckets=100]
 * @returns {Promise<number[]>}
 */
export async function getAudioWaveform(url, numBuckets = 100) {
  if (!url || typeof window === 'undefined') return []
  const cacheKey = `${url}_${numBuckets}`
  if (waveformCache.has(cacheKey)) return waveformCache.get(cacheKey)

  const promise = (async () => {
    try {
      const response = await fetch(url)
      const arrayBuffer = await response.arrayBuffer()
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (!AudioCtx) return generateFallbackPeaks(numBuckets)

      const ctx = new AudioCtx()
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
      const rawData = audioBuffer.getChannelData(0) // Channel 0
      const blockSize = Math.floor(rawData.length / numBuckets)
      const peaks = []

      for (let i = 0; i < numBuckets; i++) {
        const start = i * blockSize
        let sum = 0
        for (let j = 0; j < blockSize; j++) {
          sum += Math.abs(rawData[start + j] || 0)
        }
        peaks.push(Math.min(1, (sum / blockSize) * 2.5))
      }

      await ctx.close()
      return peaks
    } catch {
      return generateFallbackPeaks(numBuckets)
    }
  })()

  waveformCache.set(cacheKey, promise)
  return promise
}

function generateFallbackPeaks(numBuckets) {
  const peaks = []
  for (let i = 0; i < numBuckets; i++) {
    const v = 0.3 + 0.5 * Math.sin((i / 5) * Math.PI) * Math.cos((i / 3) * Math.PI)
    peaks.push(Math.max(0.1, Math.min(0.9, Math.abs(v))))
  }
  return peaks
}

/**
 * Draw waveform peaks onto a canvas element.
 * @param {HTMLCanvasElement} canvas
 * @param {number[]} peaks
 * @param {string} [color='rgba(96, 165, 250, 0.7)']
 */
export function drawWaveformToCanvas(canvas, peaks, color = 'rgba(96, 165, 250, 0.7)') {
  if (!canvas || !peaks || peaks.length === 0) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const width = canvas.width
  const height = canvas.height
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = color

  const barWidth = width / peaks.length
  const centerY = height / 2

  for (let i = 0; i < peaks.length; i++) {
    const amp = peaks[i] * (height / 2)
    const x = i * barWidth
    ctx.fillRect(x, centerY - amp, Math.max(1, barWidth - 1), amp * 2)
  }
}
