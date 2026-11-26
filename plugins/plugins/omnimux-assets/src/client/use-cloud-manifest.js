/**
 * Loads the cloud assets manifest — the totals, category table, and
 * sub-category table the cloud tab renders its navigation from.
 *
 * The manifest is small (~5.6 KB) and cached at module scope across tab mounts.
 * `prefetchCloudManifest()` shares the same single-flight request so opening
 * the Assets stage on the default Local tab can warm the manifest during idle
 * time without duplicating fetches when the user clicks Cloud.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { cloudManifest } from './api.js'

/**
 * 清单的模块级缓存。
 * @type {{ value: any } | null}
 */
let manifestCache = null

/**
 * 飞行中清单请求，合并预热与正式挂载的并发读取。
 * @type {Promise<{ ok: boolean, body?: any, error?: string }> | null}
 */
let manifestInFlight = null

/**
 * 单调递增请求代数，避免早期预热请求晚于显式 `force: true` 刷新落盘并覆盖新清单。
 */
let manifestRequestGen = 0

/** 清空清单缓存（测试与显式刷新用）。 */
export function clearCloudManifestCache() {
  manifestRequestGen += 1
  manifestCache = null
  manifestInFlight = null
}

/**
 * Single-flight manifest fetch. Populates `manifestCache` on success.
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, body?: any, error?: string }>}
 */
export function fetchCloudManifestCached(options = {}) {
  const force = options.force === true
  if (!force && manifestCache !== null) {
    return Promise.resolve({ ok: true, body: manifestCache.value })
  }
  if (!force && manifestInFlight !== null) {
    return manifestInFlight
  }
  const gen = ++manifestRequestGen
  const request = (async () => {
    try {
      const result = await cloudManifest({ force })
      if (!result.ok) {
        return {
          ok: false,
          error: String(result.body?.message ?? result.body?.error ?? 'manifest unavailable'),
        }
      }
      if (gen === manifestRequestGen) {
        manifestCache = { value: result.body }
      }
      return { ok: true, body: result.body }
    } catch (caught) {
      return {
        ok: false,
        error: caught instanceof Error ? caught.message : String(caught),
      }
    } finally {
      if (manifestInFlight === request) manifestInFlight = null
    }
  })()
  manifestInFlight = request
  return request
}

/**
 * Best-effort idle prefetch of the small manifest.json before switching to 公共.
 * Never throws; failures stay uncached so an explicit Cloud mount retries cleanly.
 */
export function prefetchCloudManifest() {
  if (manifestCache !== null || manifestInFlight !== null) return Promise.resolve(null)
  return fetchCloudManifestCached({ force: false })
}

/**
 * @param {{ enabled?: boolean }} [options]
 */
export function useCloudManifest(options = {}) {
  const { enabled = true } = options
  const [manifest, setManifest] = useState(/** @type {any} */ (manifestCache?.value ?? null))
  const [loading, setLoading] = useState(() => Boolean(enabled && manifestCache === null))
  const [error, setError] = useState('')
  const loadedRef = useRef(false)

  const load = useCallback(async (force = false) => {
    if (!force && loadedRef.current) return
    // 缓存命中直接落状态，不发请求、也不再进加载态。
    if (!force && manifestCache !== null) {
      loadedRef.current = true
      setError('')
      setManifest(manifestCache.value)
      return
    }
    setLoading(true)
    try {
      const result = await fetchCloudManifestCached({ force })
      if (!result.ok) {
        setError(String(result.error ?? 'manifest unavailable'))
        return
      }
      loadedRef.current = true
      setError('')
      setManifest(result.body)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    void load()
  }, [enabled, load])

  return { manifest, loading, error, reload: load }
}
