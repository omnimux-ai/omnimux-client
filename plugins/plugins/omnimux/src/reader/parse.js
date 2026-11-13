/**
 * Jina Reader markdown as returned by OmniMux `POST /v1/reader`
 * (text/plain). Typical header:
 *
 *   Title: Example Domain
 *   URL Source: https://example.com/
 *   Markdown Content:
 *   # Example Domain
 *   ...
 */

const TITLE_LINE = /^Title:\s*(.+)\s*$/m
const HEADING = /^#\s+(.+)\s*$/m

/**
 * @param {string} text
 * @returns {{ title: string, pageContent: string }}
 */
export function parseReaderMarkdown(text) {
  const pageContent = String(text ?? '').replace(/^\uFEFF/, '')
  const trimmed = pageContent.trim()
  if (!trimmed) {
    return { title: '', pageContent: '' }
  }
  const fromHeader = matchGroup(TITLE_LINE, pageContent)
  const fromHeading = matchGroup(HEADING, pageContent)
  const title = pickTitle(fromHeader) || pickTitle(fromHeading) || ''
  return { title, pageContent }
}

/**
 * @param {RegExp} re
 * @param {string} text
 */
function matchGroup(re, text) {
  const match = re.exec(text)
  return match ? String(match[1] || '').trim() : ''
}

/**
 * @param {string} value
 */
function pickTitle(value) {
  const title = String(value || '').trim()
  if (!title) return ''
  if (/^(untitled|no title|-)$/i.test(title)) return ''
  return title
}
