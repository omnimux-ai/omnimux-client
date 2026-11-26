/**
 * Guard untrusted external links before placing them into `<a href>` attributes.
 * Only explicit `http:` and `https:` URLs are permitted; schemes such as
 * `javascript:`, `data:`, `vbscript:`, `file:`, and protocol-relative strings
 * are rejected.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function safeExternalHref(raw) {
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
