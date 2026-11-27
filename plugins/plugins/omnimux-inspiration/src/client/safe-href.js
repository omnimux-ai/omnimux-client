const LOCAL_MEDIA_PREFIX = '/omnimux/inspiration/local/media/'

/**
 * Permit only explicit `http:` or `https:` URLs for external `<a href>` links.
 * Rejects `javascript:`, `data:`, `vbscript:`, `file:`, protocol-relative, and
 * malformed strings.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function safeExternalHttpHref(raw) {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed.startsWith('//')) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.href
  } catch {
    return null
  }
}

/**
 * Permit `http:`, `https:`, or same-origin inspiration local media paths for
 * "open original media" links. Rejects executable schemes (`javascript:`,
 * `data:`, `vbscript:`, `file:`) and protocol-relative paths.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function safeMediaLinkHref(raw) {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed.startsWith('//')) return null
  if (trimmed.startsWith(LOCAL_MEDIA_PREFIX) && !/[\r\n\0]/.test(trimmed)) {
    return trimmed
  }
  return safeExternalHttpHref(trimmed)
}
