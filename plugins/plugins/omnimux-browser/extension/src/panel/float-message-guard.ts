import type { PageSceneInfo } from './components/SceneBadge.tsx'
import type { SniffedMediaItem } from './components/MediaSnifferBar.tsx'
import type {
  PollOption,
  QuotedTweet,
  TweetAuthor,
  TweetCapture,
  TweetPoll,
  TweetShape,
  TweetStats,
} from '../content/twitter-capture/types.ts'

const MAX_SNIFFED_MEDIA = 100
const MAX_URL_LEN = 2048
const MAX_TITLE_LEN = 300
const MAX_AUTHOR_LEN = 120
const MAX_TEXT_LEN = 4000
const MAX_THREAD_ITEMS = 50
const MAX_POLL_OPTIONS = 10

const ALLOWED_PLATFORMS = new Set<PageSceneInfo['platform']>(['twitter', 'tiktok', 'zhihu', 'wechat', 'generic'])
const ALLOWED_PAGE_TYPES = new Set<PageSceneInfo['pageType']>(['home', 'profile', 'status', 'detail', 'article', 'unknown'])
const ALLOWED_TWEET_SHAPES = new Set<TweetShape>([
  'text',
  'photo',
  'gallery',
  'video',
  'quote',
  'repost',
  'thread',
  'article',
  'poll',
  'link',
])

function parseHttpOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.origin
  } catch {
    return null
  }
}

/**
 * Resolve the host page's http(s) origin for float-mode iframe messaging.
 * Prefers `window.location.ancestorOrigins[0]` (unaffected by Referrer-Policy: no-referrer)
 * before falling back to `document.referrer`.
 */
export function resolveExpectedParentOrigin(
  referrer: string | undefined,
  ancestorOrigins?: ArrayLike<string> | null,
): string | null {
  if (ancestorOrigins && ancestorOrigins.length > 0) {
    const fromAncestor = parseHttpOrigin(ancestorOrigins[0])
    if (fromAncestor !== null) return fromAncestor
  }
  return parseHttpOrigin(referrer)
}

/** Resolve the current floating panel's expected parent origin from Chromium ancestorOrigins / referrer. */
export function resolveCurrentParentOrigin(): string | null {
  const ref = typeof document !== 'undefined' ? document.referrer : undefined
  const ancestors = typeof window !== 'undefined'
    ? (window.location as Location & { ancestorOrigins?: ArrayLike<string> })?.ancestorOrigins
    : undefined
  return resolveExpectedParentOrigin(ref, ancestors)
}

/** Accept float-mode postMessages strictly from `window.parent` on an http(s) origin matching the host page. */
export function isTrustedParentMessage(
  event: Pick<MessageEvent, 'source' | 'origin'>,
  expectedSource: unknown,
  expectedOrigin: string | null,
): boolean {
  if (expectedSource === null || expectedSource === undefined) return false
  if (event.source !== expectedSource) return false
  if (expectedOrigin === null) return false
  if (typeof event.origin !== 'string' || event.origin === '' || event.origin === 'null') return false
  const actualOrigin = parseHttpOrigin(event.origin)
  if (actualOrigin === null) return false
  return actualOrigin === expectedOrigin
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

function nonNegNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function sanitizeTweetAuthor(raw: unknown): TweetAuthor | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  return {
    name: boundedText(r.name, MAX_AUTHOR_LEN) ?? '',
    handle: boundedText(r.handle, MAX_AUTHOR_LEN) ?? '',
    avatar: safeHttpUrl(r.avatar) ?? '',
    verified: r.verified === true,
  }
}

function sanitizeTweetStats(raw: unknown): TweetStats {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const r = raw as Record<string, unknown>
  const stats: TweetStats = {}
  const likes = nonNegNumber(r.likes)
  const comments = nonNegNumber(r.comments)
  const shares = nonNegNumber(r.shares)
  const views = nonNegNumber(r.views)
  if (likes !== undefined) stats.likes = likes
  if (comments !== undefined) stats.comments = comments
  if (shares !== undefined) stats.shares = shares
  if (views !== undefined) stats.views = views
  return stats
}

function sanitizeQuotedTweet(raw: unknown): QuotedTweet | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  const author = sanitizeTweetAuthor(r.author)
  if (!author) return undefined
  const text = boundedText(r.text, MAX_TEXT_LEN) ?? ''
  const coverUrl = safeHttpUrl(r.coverUrl)
  return {
    author,
    text,
    ...(coverUrl !== undefined ? { coverUrl } : {}),
  }
}

function sanitizeTweetPoll(raw: unknown): TweetPoll | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.options)) return undefined
  const options: PollOption[] = []
  for (const entry of r.options) {
    if (options.length >= MAX_POLL_OPTIONS) break
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const item = entry as Record<string, unknown>
    const label = boundedText(item.label, 200)
    const pct = nonNegNumber(item.pct)
    if (label !== undefined && pct !== undefined) options.push({ label, pct })
  }
  const votes = nonNegNumber(r.votes) ?? 0
  const closesAt = boundedText(r.closesAt, 80)
  return { options, votes, ...(closesAt !== undefined ? { closesAt } : {}) }
}

function sanitizeTweetCapture(raw: unknown): TweetCapture | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  const rawShape = typeof r.shape === 'string' ? r.shape.trim().toLowerCase() : 'text'
  const shape: TweetShape = ALLOWED_TWEET_SHAPES.has(rawShape as TweetShape) ? (rawShape as TweetShape) : 'text'
  const url = safeHttpUrl(r.url)
  const author = sanitizeTweetAuthor(r.author)
  if (!url || !author) return undefined
  const text = boundedText(r.text, MAX_TEXT_LEN) ?? ''
  const postedAt = r.postedAt === null ? null : (boundedText(r.postedAt, 64) ?? null)
  const mediaUrls: string[] = []
  if (Array.isArray(r.mediaUrls)) {
    for (const item of r.mediaUrls) {
      if (mediaUrls.length >= MAX_SNIFFED_MEDIA) break
      const safe = safeHttpUrl(item)
      if (safe) mediaUrls.push(safe)
    }
  }
  const coverUrl = safeHttpUrl(r.coverUrl) ?? ''
  const stats = sanitizeTweetStats(r.stats)
  const quoted = sanitizeQuotedTweet(r.quoted)
  let threadItems: string[] | undefined
  if (Array.isArray(r.threadItems)) {
    threadItems = []
    for (const entry of r.threadItems) {
      if (threadItems.length >= MAX_THREAD_ITEMS) break
      const item = boundedText(entry, MAX_TEXT_LEN)
      if (item !== undefined) threadItems.push(item)
    }
  }
  const poll = sanitizeTweetPoll(r.poll)
  return {
    shape,
    url,
    text,
    author,
    postedAt,
    mediaUrls,
    coverUrl,
    stats,
    ...(quoted !== undefined ? { quoted } : {}),
    ...(threadItems !== undefined ? { threadItems } : {}),
    ...(poll !== undefined ? { poll } : {}),
  }
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

/** Validate and bound an untrusted PAGE_CONTEXT_UPDATE payload from a page message or tab context. */
export function sanitizePageScenePayload(raw: unknown): (PageSceneInfo & { media?: SniffedMediaItem[] }) | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const url = safeHttpUrl(record.url) ?? ''
  const title = boundedText(record.title, MAX_TITLE_LEN) ?? ''
  const rawPlatform = typeof record.platform === 'string' ? record.platform.trim().toLowerCase() : 'generic'
  const platform: PageSceneInfo['platform'] = ALLOWED_PLATFORMS.has(rawPlatform as PageSceneInfo['platform'])
    ? (rawPlatform as PageSceneInfo['platform'])
    : 'generic'
  const rawPageType = typeof record.pageType === 'string' ? record.pageType.trim().toLowerCase() : 'unknown'
  const pageType: PageSceneInfo['pageType'] = ALLOWED_PAGE_TYPES.has(rawPageType as PageSceneInfo['pageType'])
    ? (rawPageType as PageSceneInfo['pageType'])
    : 'unknown'
  const platformLabel = boundedText(record.platformLabel, 64)
  const author = boundedText(record.author, MAX_AUTHOR_LEN)
  const postText = boundedText(record.postText, MAX_TEXT_LEN)
  const selectedText = boundedText(record.selectedText, MAX_TEXT_LEN)
  const heroImage = safeHttpUrl(record.heroImage)
  const tweet = sanitizeTweetCapture(record.tweet)
  const media = record.media !== undefined ? sanitizeSniffedMediaList(record.media) : undefined
  return {
    url,
    title,
    platform,
    ...(platformLabel !== undefined ? { platformLabel } : {}),
    pageType,
    ...(author !== undefined ? { author } : {}),
    ...(postText !== undefined ? { postText } : {}),
    ...(selectedText !== undefined ? { selectedText } : {}),
    ...(heroImage !== undefined ? { heroImage } : {}),
    ...(tweet !== undefined ? { tweet } : {}),
    ...(media !== undefined ? { media } : {}),
  }
}
