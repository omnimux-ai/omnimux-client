import { OmnimuxError } from '../media/errors.js'

const HTTPS_URL_RE = /^https:\/\//

function firstNonEmptyString(values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function firstHttpsUrl(values) {
  for (const value of values) {
    if (typeof value === 'string' && HTTPS_URL_RE.test(value.trim())) return value.trim()
  }
  return ''
}

/** Extract X Article metadata from Syndication payloads (`data.article` or `article_results.result`). */
function extractArticle(data) {
  const raw = data?.article
  if (!raw || typeof raw !== 'object') return null
  const node = raw.article_results?.result && typeof raw.article_results.result === 'object'
    ? raw.article_results.result
    : raw
  const title = firstNonEmptyString([node.title, raw.title])
  const excerpt = firstNonEmptyString([node.preview_text, node.excerpt, node.description, raw.preview_text])
  const cover_url = firstHttpsUrl([
    node.cover_media?.media_info?.original_img_url,
    node.cover_media?.original_img_url,
    node.cover_image_url,
    node.cover_url,
    raw.cover_media?.media_info?.original_img_url,
    raw.cover_image_url,
    raw.cover_url,
  ])
  const text = firstNonEmptyString([node.plain_text, node.body, node.text, raw.plain_text, raw.body])
  if (!title && !excerpt && !cover_url && !text) return null
  return { title, excerpt, cover_url, text }
}

function extractNoteTweetText(data) {
  return firstNonEmptyString([
    data?.note_tweet?.note_tweet_results?.result?.text,
    data?.note_tweet?.text,
  ])
}

/**
 * Read X's public embed data without credentials. Only the requested post's own
 * attachments are returned; quoted posts and card previews are separate works.
 * @param {string} id numeric post identity, never a URL or arbitrary host
 * @param {{ fetcher?: typeof fetch, signal?: AbortSignal, timeoutMs?: number }} [options]
 */
export async function fetchPublicTweet(id, options = {}) {
  if (!/^\d+$/.test(id)) throw new OmnimuxError('omnimux-invalid-request', 'invalid tweet id')
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 8000)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  signal.throwIfAborted()
  try {
    const response = await (options.fetcher ?? fetch)(
      `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=0`,
      { signal, redirect: 'error', headers: { accept: 'application/json' } },
    )
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    signal.throwIfAborted()
    if (String(data?.id_str || '') !== id) throw new Error('public post unavailable')
    const details = Array.isArray(data.mediaDetails) ? data.mediaDetails : []
    const videos = details.filter((item) => item?.type === 'video' || item?.type === 'animated_gif')
    if (videos.some((item) => !item.video_info?.variants?.some((variant) => variant.content_type === 'video/mp4' && HTTPS_URL_RE.test(variant.url || '')))) {
      throw new Error('public video has no downloadable variant')
    }
    if (details.some((item) => item?.type === 'photo' && !HTTPS_URL_RE.test(item.media_url_https || ''))) {
      throw new Error('public photo has no download address')
    }
    const article = extractArticle(data)
    const noteText = extractNoteTweetText(data)
    const rawText = String(data.text || '').trim()
    const resolvedText = noteText.length > rawText.length
      ? noteText
      : (rawText || article?.text || article?.excerpt || '')
    if (!details.length && !resolvedText && !article?.title) {
      throw new Error('public post has no content')
    }
    const images = details.filter((item) => item?.type === 'photo').map((item) => item.media_url_https).filter(Boolean)
    return {
      ...data,
      text: resolvedText || data.text,
      ...(noteText ? { full_text: noteText } : {}),
      ...(article ? {
        article,
        content_shape: 'article',
        title: article.title || undefined,
        excerpt: article.excerpt || undefined,
      } : {}),
      media: { video: videos },
      images,
      cover_url: article?.cover_url || videos[0]?.media_url_https || images[0] || '',
      duration: videos[0]?.video_info?.duration_millis != null ? videos[0].video_info.duration_millis / 1000 : undefined,
    }
  } catch (cause) {
    if (options.signal?.aborted) options.signal.throwIfAborted()
    throw new OmnimuxError('omnimux-request-failed', '推特公开素材暂时无法读取', { cause })
  }
}
