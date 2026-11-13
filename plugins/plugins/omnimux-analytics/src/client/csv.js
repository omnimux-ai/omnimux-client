import { formatCount, formatEr } from './format.js'

const PLATFORM_COLUMNS = [
  ['platformLabel', '平台'],
  ['posts', '发帖数'],
  ['likes', '点赞'],
  ['comments', '评论'],
  ['shares', '分享'],
  ['saves', '收藏'],
  ['clicks', '点击'],
  ['views', '播放/浏览'],
  ['impressions', '曝光'],
  ['reach', '触达'],
  ['er', '互动率 (ER)'],
]

const POST_COLUMNS = [
  ['title', '内容摘要'],
  ['publishedLabel', '发布时间'],
  ['platform', '平台'],
  ['likes', '点赞'],
  ['comments', '评论'],
  ['shares', '分享'],
  ['saves', '收藏'],
  ['clicks', '点击'],
  ['views', '播放量'],
  ['follows', '引流涨粉'],
  ['impressions', '曝光'],
  ['reach', '触达'],
  ['er', '互动率 (ER)'],
]

function csvEscape(value) {
  const text = String(value ?? '')
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

function cellValue(row, key) {
  const value = row[key]
  if (key === 'er') return formatEr(/** @type {number | null} */ (value))
  if (typeof value === 'number') return formatCount(value)
  if (value == null) return '-'
  return String(value)
}

function tableToCsv(rows, columns) {
  const header = columns.map(([, label]) => csvEscape(label)).join(',')
  const body = rows.map((row) => columns.map(([key]) => csvEscape(cellValue(row, key))).join(','))
  return [header, ...body].join('\n')
}

/**
 * @param {Record<string, unknown> | null | undefined} payload
 * @returns {string}
 */
export function buildDashboardCsv(payload) {
  const platforms = Array.isArray(payload?.platformBreakdown) ? payload.platformBreakdown : []
  const posts = Array.isArray(payload?.topPosts) ? payload.topPosts : []
  const parts = [
    '# Platform Breakdown',
    tableToCsv(platforms, PLATFORM_COLUMNS),
    '',
    '# Top Posts',
    tableToCsv(posts, POST_COLUMNS),
  ]
  return `${parts.join('\n')}\n`
}

/**
 * Trigger a CSV download in the browser. No-op outside a document.
 * @param {string} csv
 * @param {string} filename
 */
export function downloadCsv(csv, filename) {
  if (typeof document === 'undefined') return
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
