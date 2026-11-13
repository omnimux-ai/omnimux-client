export const PLATFORMS = /** @type {const} */ (['tiktok', 'twitter', 'youtube', 'instagram'])

export const PLATFORM_LABEL = {
  tiktok: 'TikTok',
  twitter: 'X',
  youtube: 'YouTube',
  instagram: 'Instagram',
}

export const PROFILE_OPTIONS = [
  { value: 'all', labelKey: 'filter.all' },
  { value: 'main', labelKey: 'filter.account.main' },
  { value: 'sub', labelKey: 'filter.account.sub' },
]

export const SOURCE_OPTIONS = [
  { value: 'all', labelKey: 'filter.all' },
  { value: 'manual', labelKey: 'filter.source.manual' },
  { value: 'omnimux', labelKey: 'filter.source.omnimux' },
]

export const RANGE_OPTIONS = [
  { value: '7d', labelKey: 'filter.range.7d' },
  { value: '30d', labelKey: 'filter.range.30d' },
  { value: '90d', labelKey: 'filter.range.90d' },
]

export const METRIC_KEYS = /** @type {const} */ ([
  'likes',
  'comments',
  'shares',
  'saves',
  'views',
  'impressions',
  'reach',
  'clicks',
  'er',
])

export const PLATFORM_TABLE_COLUMNS = [
  { key: 'platformLabel', labelKey: 'table.platform', kind: 'text' },
  { key: 'posts', labelKey: 'table.posts', kind: 'count' },
  { key: 'likes', labelKey: 'table.likes', kind: 'count' },
  { key: 'comments', labelKey: 'table.comments', kind: 'count' },
  { key: 'shares', labelKey: 'table.shares', kind: 'count' },
  { key: 'saves', labelKey: 'table.saves', kind: 'count' },
  { key: 'clicks', labelKey: 'table.clicks', kind: 'count' },
  { key: 'views', labelKey: 'table.views', kind: 'count' },
  { key: 'impressions', labelKey: 'table.impressions', kind: 'count' },
  { key: 'reach', labelKey: 'table.reach', kind: 'count' },
  { key: 'er', labelKey: 'table.er', kind: 'er' },
]

export const POST_TABLE_COLUMNS = [
  { key: 'title', labelKey: 'table.content', kind: 'post', sortable: false },
  { key: 'likes', labelKey: 'table.likes', kind: 'count' },
  { key: 'comments', labelKey: 'table.comments', kind: 'count' },
  { key: 'shares', labelKey: 'table.shares', kind: 'count' },
  { key: 'saves', labelKey: 'table.saves', kind: 'count' },
  { key: 'clicks', labelKey: 'table.clicks', kind: 'count' },
  { key: 'views', labelKey: 'table.play', kind: 'count' },
  { key: 'follows', labelKey: 'table.follows', kind: 'count' },
  { key: 'impressions', labelKey: 'table.impressions', kind: 'count' },
  { key: 'reach', labelKey: 'table.reach', kind: 'count' },
  { key: 'er', labelKey: 'table.er', kind: 'er' },
]

export const CADENCE_BRACKET_LABEL = {
  '1-5/wk': '1-5篇/周',
  '6-10/wk': '6-10篇/周',
  '11+/wk': '11+篇/周',
}
