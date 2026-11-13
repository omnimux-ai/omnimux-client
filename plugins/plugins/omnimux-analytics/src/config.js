/**
 * omnimux-analytics config.
 *
 * Field summary:
 * - enabled: explicit `true` requires websiteId (hard load failure when missing);
 *   absence of both falls back to soft-disable so an unconfigured profile never crashes.
 * - umamiUrl: self-hosted Umami base (same instance as OmniMux, no trailing slash).
 * - websiteId: Umami website id created in the analytics.omnimux.ai dashboard.
 * - pluginMap: tool-name prefix -> plugin id. Longest prefix wins. Merge over the
 *   defaults below; set a prefix to `null` to exclude it.
 */

export const DEFAULT_PLUGIN_MAP = Object.freeze({
  video_: 'omnimux-video',
  assets_: 'omnimux-assets',
  plaza_: 'omnimux-market',
  plugin_: 'omnimux-market',
  connector_: 'omnimux-market',
  workflow_: 'omnimux-workflow',
  skillhub: 'omnimux-market', // matches `skillhub` and `skillhub_*`
  omnimux_: 'omnimux',
})

/**
 * @param {unknown} value raw plugin config
 * @returns {{
 *   enabled: boolean,
 *   umamiUrl: string,
 *   websiteId: string,
 *   hostname: string,
 *   sampleRate: number,
 *   flushIntervalMs: number,
 *   maxQueue: number,
 *   trackSessions: boolean,
 *   trackSubCalls: boolean,
 *   toolEventName: string,
 *   sessionEventName: string,
 *   loadEventName: string,
 *   pluginMap: Record<string, string>,
 * }} normalized config
 */
export function parseAnalyticsConfig(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {}
  const explicitEnabled = typeof raw.enabled === 'boolean'
  const websiteId = typeof raw.websiteId === 'string' ? raw.websiteId.trim() : ''

  const umamiUrl = typeof raw.umamiUrl === 'string' && raw.umamiUrl.trim()
    ? raw.umamiUrl.trim().replace(/\/+$/, '')
    : 'https://analytics.omnimux.ai'
  if (!/^https?:\/\/.+/.test(umamiUrl)) {
    throw new Error('omnimux-analytics: umamiUrl must be an http(s) URL')
  }

  if (raw.enabled === true && !websiteId) {
    throw new Error('omnimux-analytics: websiteId is required when enabled is true')
  }

  const sampleRate = typeof raw.sampleRate === 'number'
    ? Math.min(1, Math.max(0, raw.sampleRate))
    : 1
  const flushIntervalMs = typeof raw.flushIntervalMs === 'number'
    ? Math.max(0, Math.floor(raw.flushIntervalMs))
    : 5000
  const maxQueue = typeof raw.maxQueue === 'number'
    ? Math.min(10000, Math.max(10, Math.floor(raw.maxQueue)))
    : 500

  const pluginMap = { ...DEFAULT_PLUGIN_MAP }
  if (raw.pluginMap && typeof raw.pluginMap === 'object' && !Array.isArray(raw.pluginMap)) {
    for (const [prefix, plugin] of Object.entries(raw.pluginMap)) {
      if (typeof prefix !== 'string' || prefix.length === 0) continue
      if (plugin === null) delete pluginMap[prefix]
      else if (typeof plugin === 'string' && plugin.trim()) pluginMap[prefix] = plugin.trim()
    }
  }

  return {
    // Explicit `false` wins; explicit `true` already validated above. Neither set:
    // enabled only when a websiteId is present (soft-disable otherwise).
    enabled: explicitEnabled ? raw.enabled === true : Boolean(websiteId),
    umamiUrl,
    websiteId,
    hostname: typeof raw.hostname === 'string' && raw.hostname.trim()
      ? raw.hostname.trim()
      : 'omnimux-plugins',
    sampleRate,
    flushIntervalMs,
    maxQueue,
    trackSessions: raw.trackSessions !== false,
    trackSubCalls: raw.trackSubCalls === true,
    toolEventName: typeof raw.toolEventName === 'string' && raw.toolEventName.trim()
      ? raw.toolEventName.trim()
      : 'tool-call',
    sessionEventName: typeof raw.sessionEventName === 'string' && raw.sessionEventName.trim()
      ? raw.sessionEventName.trim()
      : 'session-start',
    loadEventName: typeof raw.loadEventName === 'string' && raw.loadEventName.trim()
      ? raw.loadEventName.trim()
      : 'plugin-load',
    pluginMap,
  }
}

/** @type {{ '~standard': { version: 1, vendor: string, validate: (value: unknown) => { value: ReturnType<typeof parseAnalyticsConfig> } | { issues: Array<{ message: string }> } } }} */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'omnimux-analytics',
    validate(value) {
      try {
        return { value: parseAnalyticsConfig(value) }
      } catch (error) {
        return { issues: [{ message: error instanceof Error ? error.message : String(error) }] }
      }
    },
  },
}
