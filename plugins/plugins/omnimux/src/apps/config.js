/** Apps catalog refresh settings. Remote is off until the site file exists. */

import { resolveSiteBaseUrl } from '../auth/omnimux-auth.js'

export const DEFAULT_APPS = Object.freeze({
  remote: false,
  catalogUrl: '',
  ttlSeconds: 21600,
  timeoutMs: 5000,
  bundledDir: '',
})

/**
 * @param {unknown} value
 * @param {string} [siteBaseUrl]
 */
export function parseAppsConfig(value, siteBaseUrl) {
  if (value == null) return { ...DEFAULT_APPS }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('omnimux: apps config must be an object')
  }
  const input = /** @type {Record<string, unknown>} */ (value)
  const ttlSeconds = input.ttlSeconds == null ? DEFAULT_APPS.ttlSeconds : Number(input.ttlSeconds)
  const timeoutMs = input.timeoutMs == null ? DEFAULT_APPS.timeoutMs : Number(input.timeoutMs)
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 0) {
    throw new Error('omnimux: apps.ttlSeconds must be a non-negative integer')
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('omnimux: apps.timeoutMs must be a positive integer')
  }
  const catalogUrl = input.catalogUrl == null ? '' : String(input.catalogUrl).trim()
  if (catalogUrl) {
    let parsed
    try {
      parsed = new URL(catalogUrl)
    } catch {
      throw new Error('omnimux: apps.catalogUrl must be an https URL')
    }
    if (parsed.protocol !== 'https:') {
      throw new Error('omnimux: apps.catalogUrl must be an https URL')
    }
    const site = new URL(resolveSiteBaseUrl(siteBaseUrl))
    if (parsed.host !== site.host) {
      throw new Error('omnimux: apps.catalogUrl host must match siteBaseUrl')
    }
  }
  return {
    remote: input.remote === true,
    catalogUrl,
    ttlSeconds,
    timeoutMs,
    bundledDir: input.bundledDir == null ? '' : String(input.bundledDir).trim(),
  }
}

/**
 * @param {{ catalogUrl: string }} apps
 * @param {string} siteBaseUrl
 */
export function resolveCatalogUrl(apps, siteBaseUrl) {
  if (apps.catalogUrl) return apps.catalogUrl
  return `${resolveSiteBaseUrl(siteBaseUrl)}/apps/catalog.json`
}
