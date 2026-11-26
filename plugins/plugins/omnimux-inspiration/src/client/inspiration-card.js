import {
  estimateArchetypeWeight,
  extractHostname,
  normalizeSocialPlatform,
  resolveOutlierBadges,
  resolveSocialCardArchetype,
} from 'dsh-ui-kit/social-card'
import { pickCoverSrc, pickImageSources, pickVideoSrc } from './api.js'
import { toRivalCardRow } from './rival-filter.js'
import { importErrorText, importPillLabel, importSettledNotice, isImportingRow } from './import-status.js'
import { formatRelativeTime, rivalLocaleOf } from './rival-format.js'
import { COLLECTION_MEMBER_LAYOUT, FEED_LAYOUT } from './rival-masonry.js'

const COLLECTION_CARD_WEIGHT = 1.38

function asFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return undefined
  const num = Number(value)
  return Number.isFinite(num) && num >= 0 ? num : undefined
}

function resolveAuthor(row) {
  const author = row?.author && typeof row.author === 'object' ? row.author : {}
  const name = String(author.name || author.nickname || row?.author_name || '').trim() || undefined
  const handle = String(author.handle || author.username || row?.author_handle || '').trim().replace(/^@+/, '') || undefined
  const avatarUrl = String(
    author.avatar
    || author.avatar_url
    || author.profile_image_url_https
    || row?.avatar_url
    || row?.account?.avatar_url
    || '',
  ).trim() || undefined
  if (!name && !handle && !avatarUrl) return undefined
  return { name, handle, avatarUrl }
}

/**
 * Map a local/cloud inspiration row onto the shared `SocialPostCardItem` contract.
 * Keeps `title`, `excerpt`, and `body` distinct so long articles remain distinguishable
 * from short social posts, and never fabricates outlier metrics or avatars.
 *
 * @param {Record<string, any>} row
 * @param {(key: string) => string} [translate]
 * @returns {import('dsh-ui-kit/social-card').SocialPostCardItem}
 */
export function toSocialPostCardItem(row, translate) {
  const t = typeof translate === 'function' ? translate : (key) => key
  const locale = rivalLocaleOf(t)
  const type = String(row?.type || '').toLowerCase()
  const shape = String(row?.content_shape || '').toLowerCase()
  const sourceUrl = String(row?.source_url || row?.url || '').trim()
  const platform = normalizeSocialPlatform(row?.source_platform || row?.platform || '', sourceUrl)
  const video = pickVideoSrc(row)
  const images = pickImageSources(row)
  const coverUrl = pickCoverSrc(row) || images[0] || ''
  const isVideo = type === 'video' || shape === 'video' || Boolean(video)
  const isImage = !isVideo && (type === 'image' || shape === 'photo' || shape === 'gallery' || images.length > 0)
  const hasSavedMedia = Boolean(video || images.length || coverUrl)
  const hasMedia = row?.import_status === 'failed' && !hasSavedMedia ? false : (isVideo || isImage || Boolean(coverUrl))
  const notice = !hasMedia
    ? (isImportingRow(row)
      ? importPillLabel(row, t)
      : importSettledNotice(row, t) || importErrorText(row, t) || (row?.import_status === 'failed' ? importPillLabel(row, t) : ''))
    : ''

  const rawTitle = String(row?.title || '').trim()
  const rawBody = String(row?.content || row?.caption || row?.text || '').trim()
  const rawExcerpt = String(row?.excerpt || row?.preview_text || '').trim()
  const isArticle = shape === 'article' || row?.is_article === true
  const bodyText = rawBody || (!hasMedia && notice ? notice : '') || (!isArticle ? rawTitle : '') || ''
  const titleText = rawTitle || (isArticle && notice ? notice : '') || undefined
  const excerptText = rawExcerpt || (isArticle && bodyText && bodyText !== rawTitle ? bodyText : '') || undefined

  const stats = row?.stats && typeof row.stats === 'object' ? row.stats : {}
  const metrics = {
    likes: asFiniteNumber(stats.likes ?? stats.like_count ?? stats.digg_count),
    reposts: asFiniteNumber(stats.shares ?? stats.reposts ?? stats.retweet_count ?? stats.share_count),
    views: asFiniteNumber(stats.views ?? stats.play_count ?? stats.view_count),
    comments: asFiniteNumber(stats.comments ?? stats.comment_count ?? stats.reply_count),
  }
  const hasAnyMetric = Object.values(metrics).some((val) => val !== undefined)

  const publishedAt = String(row?.published_at || row?.posted_at || row?.created_at || '').trim() || undefined
  const publishedRaw = publishedAt ? formatRelativeTime(publishedAt, Date.now(), locale) : ''
  const publishedLabel = publishedRaw && publishedRaw !== '--' ? publishedRaw : undefined
  const durationSec = asFiniteNumber(row?.duration)
  const ratio = Number(row?.ratio)
  const coverAspectRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : undefined
  const hostname = extractHostname(sourceUrl) || undefined
  const faviconUrl = String(row?.favicon_url || '').trim() || undefined

  const baseItem = {
    id: String(row?.id ?? ''),
    platform,
    contentShape: shape || undefined,
    mediaType: !hasMedia ? (sourceUrl ? 'link' : 'text') : isVideo ? 'video' : 'image',
    isArticle: isArticle || undefined,
    title: titleText,
    excerpt: excerptText,
    body: bodyText || undefined,
    coverUrl: hasMedia && coverUrl ? coverUrl : undefined,
    coverAlt: titleText || bodyText || hostname || platform,
    coverAspectRatio,
    mediaCount: images.length > 0 ? images.length : undefined,
    isVideo,
    durationSec: durationSec && durationSec > 0 ? durationSec : undefined,
    author: resolveAuthor(row),
    metrics: hasAnyMetric ? metrics : undefined,
    outlierBadges: resolveOutlierBadges(row?.velocity),
    publishedAt,
    publishedLabel,
    sourceUrl: sourceUrl || undefined,
    faviconUrl,
    hostname,
  }

  const archetype = resolveSocialCardArchetype(baseItem)
  return { ...baseItem, archetype }
}

/** Adapt a saved/public item to the shared feed descriptor without changing its source row. */
export function toInspirationCardRow(row, translate) {
  const t = typeof translate === 'function' ? translate : (key) => key
  const type = String(row?.type || '').toLowerCase()
  const shape = String(row?.content_shape || '').toLowerCase()
  const video = pickVideoSrc(row)
  const images = pickImageSources(row)
  const cover = pickCoverSrc(row) || images[0] || ''
  const isVideo = type === 'video' || shape === 'video' || Boolean(video)
  const isImage = !isVideo && (type === 'image' || shape === 'photo' || shape === 'gallery' || images.length > 0)
  const hasSavedMedia = Boolean(video || images.length || cover)
  const hasMedia = row?.import_status === 'failed' && !hasSavedMedia ? false : isVideo || isImage || Boolean(cover)
  const account = row?.author || {}
  const notice = !hasMedia
    ? (isImportingRow(row)
      ? importPillLabel(row, t)
      : importSettledNotice(row, t) || importErrorText(row, t) || (row?.import_status === 'failed' ? importPillLabel(row, t) : ''))
    : ''
  const normalized = toRivalCardRow({
    ...row,
    row_id: row?.id,
    title: notice || String(row?.content || row?.title || row?.source_url || row?.id || ''),
    url: row?.source_url,
    cover_src: cover,
    type: isVideo ? 'video' : isImage ? 'image' : 'text',
    media_kind: !hasMedia ? '' : isVideo ? 'video' : 'image',
    has_media: hasMedia,
    card_type: !hasMedia ? 'text' : undefined,
    account: {
      nickname: account.name || row?.author_name || '',
      handle: account.handle || '',
      platform: row?.source_platform || '',
      avatar_url: account.avatar || account.avatar_url || account.profile_image_url_https || '',
    },
  })
  const social_item = toSocialPostCardItem(row, t)
  return {
    ...normalized,
    source_row: row,
    social_item,
    archetype: social_item.archetype,
    image_count: images.length,
    notice_kind: notice ? (isImportingRow(row) ? 'importing' : 'error') : '',
    layout: FEED_LAYOUT,
    in_collection: false,
  }
}

export { COLLECTION_MEMBER_LAYOUT }

/**
 * Adapt a collection member row using the shared 6-archetype presentation.
 * Preserves `collection` membership flag so context/⋯ menus expose "remove from collection".
 *
 * @param {Record<string, any>} row
 * @param {(key: string) => string} [translate]
 * @returns {Record<string, any>}
 */
export function toCollectionMemberCard(row, translate) {
  return {
    ...toInspirationCardRow(row, translate),
    layout: COLLECTION_MEMBER_LAYOUT,
    in_collection: true,
  }
}

/** Heuristic weight estimator passed to `<MasonryGrid>` for balanced column height distribution. */
export function estimateInspirationCardWeight(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') return 1
  if (descriptor.card_type === 'collection') return COLLECTION_CARD_WEIGHT
  if (descriptor.social_item) return estimateArchetypeWeight(descriptor.social_item)
  return estimateArchetypeWeight(toSocialPostCardItem(descriptor.source_row || descriptor))
}
