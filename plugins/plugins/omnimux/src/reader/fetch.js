import { OmnimuxError } from '../media/errors.js'
import { postReader, READER_MODEL } from './client.js'
import { parseReaderMarkdown } from './parse.js'

const MAX_PAGE = 120_000

/**
 * @param {unknown} value
 */
export function normalizePageUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) {
    throw new OmnimuxError('omnimux-invalid-request', 'url is required')
  }
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new OmnimuxError('omnimux-invalid-request', 'url must be http(s)')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new OmnimuxError('omnimux-invalid-request', 'url must be http(s)')
  }
  if (!parsed.hostname) {
    throw new OmnimuxError('omnimux-invalid-request', 'url host is required')
  }
  return parsed.href
}

/**
 * @param {string} text
 */
export function clipPageContent(text) {
  const pageContent = String(text || '')
  if (pageContent.length <= MAX_PAGE) {
    return { pageContent, truncated: false }
  }
  return {
    pageContent: `${pageContent.slice(0, MAX_PAGE)}\n\n[truncated]`,
    truncated: true,
  }
}

/**
 * Official-only page fetch. Success shape is for verticals (products
 * playbook fills «pageContent»); the hub never writes a product row.
 *
 * @param {{
 *   fetcher?: typeof fetch,
 *   env?: Record<string, string | undefined>,
 *   resolveApiKey?: () => Promise<string | undefined> | string | undefined,
 * }} deps
 * @param {{ url?: string }} args
 */
export async function fetchPage(deps, args) {
  const url = normalizePageUrl(args?.url)
  const markdown = await postReader(deps, { url })
  const parsed = parseReaderMarkdown(markdown)
  const clipped = clipPageContent(parsed.pageContent)
  return {
    mode: 'live',
    model: READER_MODEL,
    url,
    title: parsed.title,
    pageContent: clipped.pageContent,
    ...(clipped.truncated ? { truncated: true } : {}),
  }
}
