export const AUTO_ANALYZE_STORAGE_KEY = 'omnimux_inspiration_auto_analyze'

/**
 * Read the last AI-analyze preference. Missing / unreadable → true.
 * @returns {boolean}
 */
export function readAutoAnalyzePreference() {
  try {
    const raw = globalThis.localStorage?.getItem(AUTO_ANALYZE_STORAGE_KEY)
    if (raw === null || raw === undefined) return true
    return raw === 'true' || raw === '1'
  } catch {
    return true
  }
}

/**
 * Persist the AI-analyze preference.
 * @param {boolean} next
 */
export function writeAutoAnalyzePreference(next) {
  try {
    globalThis.localStorage?.setItem(AUTO_ANALYZE_STORAGE_KEY, next ? 'true' : 'false')
  } catch {
    // Ignore quota / private-mode failures; in-memory state still works.
  }
}
