/**
 * OpenReel Video Decoder & Element Pool.
 * Provides accurate video frame rendering and caching for multi-track composition.
 */

const videoPool = new Map()
const imagePool = new Map()

/**
 * Get or create a pooled HTMLVideoElement for a given URL.
 * @param {string} url
 * @returns {Promise<HTMLVideoElement|null>}
 */
export async function getPooledVideo(url) {
  if (!url || typeof document === 'undefined') return null
  const cached = videoPool.get(url)
  if (cached) return cached

  const promise = new Promise((resolve) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = url

    const onReady = () => {
      video.removeEventListener('loadeddata', onReady)
      video.removeEventListener('error', onError)
      resolve(video)
    }

    const onError = () => {
      video.removeEventListener('loadeddata', onReady)
      video.removeEventListener('error', onError)
      resolve(null)
    }

    video.addEventListener('loadeddata', onReady)
    video.addEventListener('error', onError)

    // Timeout safety
    setTimeout(() => {
      if (video.readyState >= 2) resolve(video)
      else resolve(null)
    }, 4000)
  })

  videoPool.set(url, promise)
  return promise
}

/**
 * Seek a video element to a specific local timestamp in seconds.
 * @param {HTMLVideoElement} video
 * @param {number} timeSec
 * @returns {Promise<void>}
 */
export function seekVideo(video, timeSec) {
  return new Promise((resolve) => {
    if (!video || !Number.isFinite(timeSec)) {
      resolve()
      return
    }
    const target = Math.max(0, Math.min(timeSec, video.duration || timeSec))
    if (Math.abs(video.currentTime - target) < 0.03) {
      resolve()
      return
    }

    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked)
      resolve()
    }
    video.addEventListener('seeked', onSeeked)
    video.currentTime = target

    setTimeout(() => {
      video.removeEventListener('seeked', onSeeked)
      resolve()
    }, 150)
  })
}

/**
 * Get or load an HTMLImageElement for a given image URL.
 * @param {string} url
 * @returns {Promise<HTMLImageElement|null>}
 */
export async function getPooledImage(url) {
  if (!url || typeof document === 'undefined') return null
  const cached = imagePool.get(url)
  if (cached) return cached

  const promise = new Promise((resolve) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = url
  })

  imagePool.set(url, promise)
  return promise
}

/**
 * Release and clean up all pooled video and image elements.
 */
export function disposeMediaPool() {
  for (const promise of videoPool.values()) {
    promise.then((video) => {
      if (video) {
        try {
          video.pause()
          video.removeAttribute('src')
          video.load()
        } catch {
          /* ignore */
        }
      }
    }).catch(() => {})
  }
  videoPool.clear()
  imagePool.clear()
}
