/**
 * Analytics library — official-only PAT lane to OmniMux cloud / Zernio.
 * Verticals must not import this file; they hit Host `/omnimux/analytics/*` or tools.
 */

const API = '/api/social/v1/analytics'

/**
 * @param {Record<string, unknown>} [query]
 */
export function analyticsQueryString(query = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === '') continue
    params.set(key, String(value))
  }
  const suffix = params.toString()
  return suffix ? `?${suffix}` : ''
}

/**
 * 1. 每日时序大盘与各平台走势
 * @param {{ withPat: Function }} client
 * @param {Record<string, unknown>} [query]
 */
export function getDailyMetrics(client, query = {}) {
  return client.withPat(`${API}/daily-metrics${analyticsQueryString(query)}`)
}

/**
 * 2. 7x24小时最佳发布时间热力矩阵
 * @param {{ withPat: Function }} client
 * @param {Record<string, unknown>} [query]
 */
export function getBestTimeToPost(client, query = {}) {
  return client.withPat(`${API}/best-time-to-post${analyticsQueryString(query)}`)
}

/**
 * 3. 发帖频次 vs 互动率模型
 * @param {{ withPat: Function }} client
 * @param {Record<string, unknown>} [query]
 */
export function getPostingFrequency(client, query = {}) {
  return client.withPat(`${API}/posting-frequency${analyticsQueryString(query)}`)
}

/**
 * 4. 互动生命周期累积衰减曲线
 * @param {{ withPat: Function }} client
 * @param {Record<string, unknown>} [query]
 */
export function getContentDecay(client, query = {}) {
  return client.withPat(`${API}/content-decay${analyticsQueryString(query)}`)
}

/**
 * 5. 账号粉丝历史演进统计
 * @param {{ withPat: Function }} client
 * @param {Record<string, unknown>} [query]
 */
export function getFollowerStats(client, query = {}) {
  return client.withPat(`/api/social/v1/accounts/follower-stats${analyticsQueryString(query)}`)
}

/**
 * 6. 帖子列表与排行 / 单帖深度分析
 * @param {{ withPat: Function }} client
 * @param {Record<string, unknown>} [query]
 */
export function getPostAnalytics(client, query = {}) {
  // OmniMux gateway rejects the Zernio collection root GET /analytics as
  // "Invalid URL". Posts list lives at the /posts suffix, same pattern as
  // daily-metrics / best-time-to-post.
  return client.withPat(`${API}/posts${analyticsQueryString(query)}`)
}

/**
 * 7. 即时增量拉取外部帖子
 * @param {{ withPat: Function }} client
 * @param {Record<string, unknown>} body
 */
export function syncExternalPosts(client, body = {}) {
  return client.withPat(`${API}/sync-external-posts`, {
    method: 'POST',
    body,
  })
}

/**
 * 8. 私信与收件箱分析系列
 * @param {{ withPat: Function }} client
 * @param {string} capability volume | response-time | heatmap | source-breakdown
 * @param {Record<string, unknown>} [query]
 */
export function getInboxAnalytics(client, capability, query = {}) {
  const cap = encodeURIComponent(String(capability || 'volume'))
  return client.withPat(`/api/social/v1/inbox-analytics/${cap}${analyticsQueryString(query)}`)
}
