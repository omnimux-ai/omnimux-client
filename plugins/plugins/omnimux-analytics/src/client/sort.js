/**
 * Table sort: missing values (`null` / `undefined` / NaN) sink in both
 * directions so they never masquerade as zeros.
 */

function isMissing(value) {
  return value == null || (typeof value === 'number' && Number.isNaN(value))
}

/**
 * @param {unknown} a
 * @param {unknown} b
 * @param {'asc' | 'desc'} dir
 */
export function compareNullable(a, b, dir = 'asc') {
  const aN = isMissing(a)
  const bN = isMissing(b)
  if (aN && bN) return 0
  if (aN) return 1
  if (bN) return -1
  if (typeof a === 'number' && typeof b === 'number') {
    const cmp = a < b ? -1 : a > b ? 1 : 0
    return dir === 'asc' ? cmp : -cmp
  }
  const left = String(a)
  const right = String(b)
  const cmp = left.localeCompare(right, 'zh-CN')
  return dir === 'asc' ? cmp : -cmp
}

/**
 * @template {Record<string, unknown>} T
 * @param {T[]} rows
 * @param {string} key
 * @param {'asc' | 'desc'} dir
 * @returns {T[]}
 */
export function sortRows(rows, key, dir = 'asc') {
  if (!Array.isArray(rows) || !key) return Array.isArray(rows) ? rows.slice() : []
  return rows.slice().sort((a, b) => compareNullable(a[key], b[key], dir))
}

/**
 * Top posts default: ER desc, views desc on ties.
 * @param {Array<Record<string, unknown>>} rows
 */
export function sortTopPostsDefault(rows) {
  if (!Array.isArray(rows)) return []
  return rows.slice().sort((a, b) => {
    const er = compareNullable(a.er, b.er, 'desc')
    if (er !== 0) return er
    return compareNullable(a.views, b.views, 'desc')
  })
}

/**
 * @param {Array<{ title?: string, postId?: string }>} posts
 * @param {string} searchQuery
 */
export function filterTopPosts(posts, searchQuery) {
  if (!Array.isArray(posts)) return []
  const q = String(searchQuery || '').trim().toLowerCase()
  if (!q) return posts.slice()
  return posts.filter((post) => {
    const title = String(post.title || '').toLowerCase()
    const id = String(post.postId || '').toLowerCase()
    return title.includes(q) || id.includes(q)
  })
}
