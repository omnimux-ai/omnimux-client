const pending = new Map()
const failed = new Map()
const CACHE = 'omnimux-project-thumbnails-v1'
const IMAGE_CONCURRENCY = 4
const VIDEO_CONCURRENCY = 2
const IMAGE_TIMEOUT_MS = 6000
const VIDEO_TIMEOUT_MS = 8000
const MAX_CACHE_ENTRIES = 128
const MAX_MEMORY_URLS = 96

function createAbortError() {
  const err = new Error('thumbnail-aborted')
  err.name = 'AbortError'
  return err
}

function createConcurrencyPool(limit) {
  let active = 0
  const waiters = []

  const release = () => {
    active = Math.max(0, active - 1)
    while (waiters.length > 0 && active < limit) {
      const next = waiters.shift()
      if (next.settled) continue
      next.settled = true
      if (next.signal && next.onAbort) {
        next.signal.removeEventListener('abort', next.onAbort)
      }
      active += 1
      next.resolve(release)
    }
  }

  return {
    acquire(signal) {
      if (signal?.aborted) return Promise.reject(createAbortError())
      if (active < limit) {
        active += 1
        return Promise.resolve(release)
      }
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject, signal, onAbort: null, settled: false }
        if (signal) {
          waiter.onAbort = () => {
            if (waiter.settled) return
            waiter.settled = true
            const idx = waiters.indexOf(waiter)
            if (idx >= 0) waiters.splice(idx, 1)
            reject(createAbortError())
          }
          signal.addEventListener('abort', waiter.onAbort, { once: true })
        }
        waiters.push(waiter)
      })
    },
  }
}

const imagePool = createConcurrencyPool(IMAGE_CONCURRENCY)
const videoPool = createConcurrencyPool(VIDEO_CONCURRENCY)

let cachedCachesApi = null
let cachedCachePromise = null

function openThumbnailCache() {
  if (typeof caches === 'undefined' || !caches?.open) return Promise.resolve(null)
  if (caches !== cachedCachesApi) {
    cachedCachesApi = caches
    cachedCachePromise = null
  }
  if (!cachedCachePromise) {
    cachedCachePromise = caches.open(CACHE).catch(() => {
      cachedCachePromise = null
      return null
    })
  }
  return cachedCachePromise
}

export function coverCacheKey(cover) {
  const source = cover?.thumbnailUrl || cover?.mediaUrl
  if (!source || !['image', 'video'].includes(cover?.kind)) return null
  return `${cover.kind}:${cover.sourceRevision || source}`
}

function renderThumbnail(cover, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError())
      return
    }
    const video = cover.kind === 'video' && !cover.thumbnailUrl
    const media = document.createElement(video ? 'video' : 'img')
    let settled = false
    const onAbort = () => finish(createAbortError())
    const finish = (error, blob) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
      media.onload = media.onerror = media.onloadedmetadata = media.onloadeddata = media.onseeked = null
      if (video) media.pause()
      media.removeAttribute('src')
      if (video) media.load()
      if (error) reject(error)
      else resolve(blob)
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => finish(new Error('thumbnail-timeout')), video ? VIDEO_TIMEOUT_MS : IMAGE_TIMEOUT_MS)
    const draw = () => {
      if (settled) return
      try {
        const width = video ? media.videoWidth : media.naturalWidth
        const height = video ? media.videoHeight : media.naturalHeight
        if (!width || !height) throw new Error('thumbnail-no-dimensions')
        const canvas = document.createElement('canvas')
        const scale = Math.min(1, 640 / Math.max(width, height))
        canvas.width = Math.max(1, Math.round(width * scale))
        canvas.height = Math.max(1, Math.round(height * scale))
        canvas.getContext('2d').drawImage(media, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => finish(blob ? null : new Error('thumbnail-encode-failed'), blob), 'image/webp', 0.82)
      } catch (error) {
        finish(error)
      }
    }
    media.crossOrigin = 'anonymous'
    media.onerror = () => finish(new Error('thumbnail-load-failed'))
    if (video) {
      media.muted = true
      media.preload = 'metadata'
      media.onloadedmetadata = () => {
        const time = Number.isFinite(media.duration) ? Math.min(1, media.duration * 0.1) : 0
        media.onseeked = draw
        if (time > 0) media.currentTime = time
        else {
          media.onloadeddata = draw
          if (media.readyState >= 2) draw()
        }
      }
    } else {
      media.onload = draw
    }
    media.src = cover.thumbnailUrl || cover.mediaUrl
  })
}

async function computeCacheRequest(key) {
  if (typeof crypto === 'undefined' || !crypto?.subtle?.digest || typeof location === 'undefined') return null
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return new Request(`${location.origin}/omnimux-cover-cache/${hash}`)
}

function waitWithSignal(promise, signal, onCancel) {
  if (!signal) return promise
  if (signal.aborted) {
    onCancel()
    return Promise.reject(createAbortError())
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      onCancel()
      reject(createAbortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

/**
 * Cache-first parallel lookup with isolated bounded decode pools (image=4, video=2),
 * deduplication, AbortSignal cancellation, corrupt-cache recovery, and failure cooldown.
 */
export async function loadCoverThumbnail(cover, opts = {}) {
  const key = coverCacheKey(cover)
  if (!key) return null
  const callerSignal = opts?.signal
  if (callerSignal?.aborted) throw createAbortError()
  if ((failed.get(key) || 0) > Date.now()) throw new Error('thumbnail-retry-later')

  let entry = pending.get(key)
  if (!entry) {
    const controller = new AbortController()
    const run = async () => {
      const signal = controller.signal
      let cache = null
      let request = null
      // 1. Lock-free Cache API fast path (never blocked behind slow image/video decodes).
      try {
        const [openedCache, cacheReq] = await Promise.all([openThumbnailCache(), computeCacheRequest(key)])
        cache = openedCache
        request = cacheReq
        if (cache && request) {
          const existing = await cache.match(request)
          if (existing && Date.now() - Number(existing.headers.get('x-cover-created') || 0) < 3600000) {
            const cachedBlob = await existing.blob()
            try {
              const bitmap = await createImageBitmap(cachedBlob)
              bitmap.close()
              return cachedBlob
            } catch {
              await cache.delete(request)
            }
          }
        }
      } catch {
        /* Private/limited storage still supports transient previews. */
      }

      if (signal.aborted) throw createAbortError()

      // 2. Decode in isolated image/video pool so slow videos never stall image cards.
      const needsVideoDecode = cover.kind === 'video' && !cover.thumbnailUrl
      const pool = needsVideoDecode ? videoPool : imagePool
      const release = await pool.acquire(signal)
      let blob
      try {
        try {
          blob = await renderThumbnail(cover, signal)
        } catch (error) {
          if (signal.aborted || cover.kind !== 'video' || !cover.thumbnailUrl || !cover.mediaUrl) throw error
          // Poster failed; fall back to video frame extraction in the video pool.
          const releaseVideo = await videoPool.acquire(signal)
          try {
            blob = await renderThumbnail({ ...cover, thumbnailUrl: undefined }, signal)
          } finally {
            releaseVideo()
          }
        }
      } finally {
        release()
      }

      if (cache && request) {
        try {
          await cache.put(request, new Response(blob, { headers: { 'x-cover-created': String(Date.now()) } }))
          const keys = await cache.keys()
          if (keys.length > MAX_CACHE_ENTRIES) {
            await Promise.all(keys.slice(0, keys.length - MAX_CACHE_ENTRIES).map((item) => cache.delete(item)))
          }
        } catch {
          /* Storage failures must not hide a successfully decoded cover. */
        }
      }
      return blob
    }

    const promise = run()
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          failed.set(key, Date.now() + 30000)
          if (failed.size > MAX_CACHE_ENTRIES) failed.delete(failed.keys().next().value)
        }
        throw error
      })
      .finally(() => {
        if (pending.get(key) === entry) pending.delete(key)
      })
    // Prevent unhandled rejection when all callers abort and detach before settlement.
    promise.catch(() => {})
    entry = { promise, controller, waiters: 0 }
    pending.set(key, entry)
  }

  const shared = entry
  shared.waiters += 1
  let detached = false
  const detach = () => {
    if (detached) return
    detached = true
    shared.waiters = Math.max(0, shared.waiters - 1)
    if (shared.waiters === 0) shared.controller.abort()
  }

  try {
    return await waitWithSignal(shared.promise, callerSignal, detach)
  } finally {
    if (!detached) {
      detached = true
      shared.waiters = Math.max(0, shared.waiters - 1)
    }
  }
}

// ============================================================================
// Session-scoped LRU ObjectURL cache (0ms hit on tab switches / filters / sorts)
// ============================================================================

const memoryUrls = new Map()

function touchMemoryEntry(key, record) {
  memoryUrls.delete(key)
  memoryUrls.set(key, record)
}

function evictMemoryUrls() {
  if (memoryUrls.size <= MAX_MEMORY_URLS) return
  for (const [key, record] of memoryUrls) {
    if (memoryUrls.size <= MAX_MEMORY_URLS) break
    if (record.refCount > 0) continue
    memoryUrls.delete(key)
    try {
      URL.revokeObjectURL(record.url)
    } catch {
      /* URL may already be revoked by environment teardown. */
    }
  }
}

export function peekCoverObjectUrl(cover) {
  const key = coverCacheKey(cover)
  if (!key) return null
  const record = memoryUrls.get(key)
  if (!record) return null
  touchMemoryEntry(key, record)
  return record.url
}

export function retainCoverObjectUrl(cover) {
  const key = coverCacheKey(cover)
  if (!key) return null
  const record = memoryUrls.get(key)
  if (!record) return null
  record.refCount += 1
  touchMemoryEntry(key, record)
  return record.url
}

export function acquireCoverObjectUrl(cover, blob) {
  const key = coverCacheKey(cover)
  if (!key || !blob) return null
  const existing = memoryUrls.get(key)
  if (existing) {
    existing.refCount += 1
    touchMemoryEntry(key, existing)
    return existing.url
  }
  const url = URL.createObjectURL(blob)
  memoryUrls.set(key, { url, refCount: 1 })
  evictMemoryUrls()
  return url
}

export function releaseCoverObjectUrl(cover) {
  const key = coverCacheKey(cover)
  if (!key) return
  const record = memoryUrls.get(key)
  if (!record) return
  record.refCount = Math.max(0, record.refCount - 1)
  evictMemoryUrls()
}

export function clearCoverObjectUrlCache() {
  for (const record of memoryUrls.values()) {
    try {
      URL.revokeObjectURL(record.url)
    } catch {
      /* Ignore revoke failures in synthetic test environments. */
    }
  }
  memoryUrls.clear()
}
