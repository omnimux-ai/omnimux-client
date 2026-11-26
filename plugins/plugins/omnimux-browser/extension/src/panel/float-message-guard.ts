import type { PageSceneInfo } from './components/SceneBadge.tsx'
import type { SniffedMediaItem } from './components/MediaSnifferBar.tsx'

const MAX_SNIFFED_MEDIA = 100
const MAX_URL_LEN = 2048
const MAX_TITLE_LEN = 300
const MAX_AUTHOR_LEN = 120
const MAX_TEXT_LEN = 4000
const ALLOWED_PLATFORMS = new Set(['twitter', 'tiktok', 'instagram', 'youtube', 'xiaohongshu', 'bilibili', 'generic'])
const ALLOWED_PAGE_TYPES = new Set(['home', 'status', 'profile', 'detail', 'video', 'feed', 'search', 'article', 'unknown'])

/** Parse an http(s) origin from a referrer or URL string; returns null for non-web or invalid values. */
export function resolveExpectedParentOrigin(referrer: string | undefined): string | null {
  if (typeof referrer !== 'string' || referrer.trim() === '') return null
  try {
    const parsed = new URL(referrer)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.origin
  } catch {
    return null
  }
}

/** Accept float-mode postMessages strictly from `window.parent` on an http(s) origin matching the host page. */
export function isTrustedParentMessage(
  event: Pick<MessageEvent, 'source' | 'origin'>,
  expectedSource: unknown,
  expectedOrigin: string | null,
): boolean {
  if (expectedSource === null || expectedSource === undefined) return false
  if (event.source !== expectedSource) return false
  if (typeof event.origin !== 'string' || event.origin === '' || event.origin === 'null') return false
  let parsed: URL
  try {
    parsed = new URL(event.origin)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (expectedOrigin !== null && parsed.origin !== expectedOrigin) return false
  return true
}

function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > MAX_URL_LEN) return undefined
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    return parsed.href
  } catch {
    return undefined
  }
}

function boundedText(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.length > maxLen ? value.slice(0, maxLen) : value
}

/** Validate and bound an untrusted sniffed media list from a page message. */
export function sanitizeSniffedMediaList(raw: unknown): SniffedMediaItem[] {
  if (!Array.isArray(raw)) return []
  const items: SniffedMediaItem[] = []
  for (const entry of raw) {
    if (items.length >= MAX_SNIFFED_MEDIA) break
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const src = safeHttpUrl(record.src)
    if (src === undefined) continue
    const previewSrc = safeHttpUrl(record.previewSrc) ?? src
    const type = record.type === 'video' ? 'video' : record.type === 'image' ? 'image' : null
    if (type === null) continue
    const id = boundedText(record.id, 256) || src
    const alt = boundedText(record.alt, 300)
    items.push({ id, type, src, previewSrc, ...(alt !== undefined ? { alt } : {}) })
  }
  return items
}

/** Validate and bound an untrusted PAGE_CONTEXT_UPDATE payload from a page message. */
export function sanitizePageScenePayload(raw: unknown): (PageSceneInfo & { media?: SniffedMediaItem[] }) | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const url = safeHttpUrl(record.url) ?? ''
  const title = boundedText(record.title, MAX_TITLE_LEN) ?? ''
  const rawPlatform = typeof record.platform === 'string' ? record.platform.trim().toLowerCase() : 'generic'
  const platform = (ALLOWED_PLATFORMS.has(rawPlatform) ? rawPlatform : 'generic') as PageSceneInfo['platform']
  const rawPageType = typeof record.pageType === 'string' ? record.pageType.trim().toLowerCase() : 'unknown'
  const pageType = (ALLOWED_PAGE_TYPES.has(rawPageType) ? rawPageType : 'unknown') as PageSceneInfo['pageType']
  const author = boundedText(record.author, MAX_AUTHOR_LEN)
  const postText = boundedText(record.postText, MAX_TEXT_LEN)
  const selectedText = boundedText(record.selectedText, MAX_TEXT_LEN)
  const heroImage = safeHttpUrl(record.heroImage)
  const media = record.media !== undefined ? sanitizeSniffedMediaList(record.media) : undefined
  return {
    url,
    title,
    platform,
    pageType,
    ...(author !== undefined ? { author } : {}),
    ...(postText !== undefined ? { postText } : {}),
    ...(selectedText !== undefined ? { selectedText } : {}),
    ...(heroImage !== undefined ? { heroImage } : {}),
    ...(media !== undefined ? { media } : {}),
  }
}
