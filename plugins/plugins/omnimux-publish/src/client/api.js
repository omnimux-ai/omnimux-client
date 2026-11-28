import { quotaGuard } from 'dsh-ui-kit/quota-request'
export { isQuotaHttpResult, notifyQuota, quotaGuard } from 'dsh-ui-kit/quota-request'

import { PUBLISH_PROVIDER, isPublishingAccount } from '../account-policy.js'
import { pickSeatsSummary } from '../shared/social-seat.js'
/**
 * fetch 封装 over 本插件 Host 路由（/omnimux/publish/*）与 hub 只读面
 * （/omnimux/accounts，hub 权威合并实现）。同源相对路径，Electron 下走
 * IPC fetch 桥。每次调用解析为 { ok, status, body }；UI 只渲染 body.error /
 * body.message。
 */

/**
 * Host 错误体同时带 error（码）与 message（可读原因）。只露码会把
 * hub-tool-error 原样丢给用户。优先 message，码不同时并列。
 * @param {unknown} body
 * @param {number} [status]
 */
export function errorText(body, status) {
  const row = body && typeof body === 'object' && !Array.isArray(body)
    ? /** @type {Record<string, unknown>} */ (body)
    : null
  const code = row && typeof row.error === 'string' ? row.error.trim() : ''
  const message = row && typeof row.message === 'string' ? row.message.trim() : ''
  if (message && code && message !== code) return `${code}: ${message}`
  if (message) return message
  if (code) return code
  return Number.isFinite(status) ? `HTTP ${status}` : 'request failed'
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, body: any }>}
 */
export async function publishRequest(path, opts = {}) {
  const response = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  let json = {}
  try {
    json = await response.json()
  } catch {
    json = { error: `HTTP ${String(response.status)}` }
  }
  return { ok: response.ok && json?.success !== false, status: response.ok && json?.success === false ? 502 : response.status, body: json }
}

/** 便宜轮询：传当前 revision，未变化时 unchanged:true。 */
export function getState(rev) {
  const suffix = Number.isFinite(rev) ? `?rev=${rev}` : ''
  return publishRequest(`/omnimux/publish/state${suffix}`)
}

/** 列表三 tab 数据（与 publish_list_records 同源过滤）。 */
export function listRecords(query = {}) {
  const params = new URLSearchParams()
  if (query.status) params.set('status', query.status)
  if (query.type) params.set('type', query.type)
  if (query.page) params.set('page', String(query.page))
  const suffix = params.toString() ? `?${params}` : ''
  return publishRequest(`/omnimux/publish/records${suffix}`)
}

/** 记录 + 子任务展开（本地账本快照）。 */
export function recordDetail(id) {
  return publishRequest(`/omnimux/publish/records/detail?id=${encodeURIComponent(id)}`)
}

/**
 * 账号在 TikTok 侧的发布能力（隐私级别选项、互动开关禁用状态、视频最大时长）。
 * @param {string} accountId
 * @param {{ force?: boolean }} [opts]
 */
export function creatorInfo(accountId, opts = {}) {
  const params = new URLSearchParams({ id: String(accountId) })
  if (opts && opts.force === true) params.set('force', '1')
  return publishRequest(`/omnimux/publish/creator-info?${params}`)
}

/** 合并后能力矩阵（表单裁剪数据源，与工具校验同源）。 */
export function getCapabilities() {
  return publishRequest('/omnimux/publish/capabilities')
}

/** 媒体缩略图 URL（Host 只读内容路由）。 */
export function mediaContentUrl(mediaId) {
  return `/omnimux/publish/media/content?id=${encodeURIComponent(mediaId)}`
}

/**
 * 媒体字节上传（raw body → sha256 入库）。
 * @param {File} file
 */
export async function uploadMedia(file) {
  const response = await fetch(`/omnimux/publish/media?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  let json = {}
  try {
    json = await response.json()
  } catch {
    json = { error: `HTTP ${String(response.status)}` }
  }
  return { ok: response.ok, status: response.status, body: json }
}

/** 建草稿。payload 与 publish_create_draft 同构（media 用 media_id 引用已上传条目）。 */
export function createDraft(type, payload) {
  return publishRequest('/omnimux/publish/drafts', { method: 'POST', body: { type, payload } })
}

/** 改草稿（同一份校验）。 */
export function updateDraft(draftId, patch) {
  return publishRequest('/omnimux/publish/drafts/update', { method: 'POST', body: { draft_id: draftId, patch } })
}

/** 删草稿（confirm 由调用方弹窗确认后置 true）。 */
export function deleteDraft(draftId) {
  return publishRequest('/omnimux/publish/drafts/delete', { method: 'POST', body: { draft_id: draftId, confirm: true } })
}

/** 挂账号（存在性/可用性/能力冲突校验在 Host，与 submit 同源）。 */
export function assignAccounts(draftId, accountIds) {
  return publishRequest('/omnimux/publish/drafts/update', {
    method: 'POST',
    body: { draft_id: draftId, patch: { account_ids: accountIds } },
  })
}

/** 一键发布：立即返回，进度经 state?rev= 轮询。 */
export function submitRecord(recordId) {
  return quotaGuard(() => publishRequest('/omnimux/publish/records/submit', { method: 'POST', body: { record_id: recordId } }), { capability: 'publish', userInitiated: true })()
}

/** 手动状态同步（publish_get_record refresh 同源）。 */
export function refreshRecord(recordId) {
  return quotaGuard(() => publishRequest('/omnimux/publish/records/refresh', { method: 'POST', body: { record_id: recordId } }), { capability: 'publish', userInitiated: true })()
}

/** 单账号重试（复用已上传媒体）。 */
export function retryTask(taskId) {
  return quotaGuard(() => publishRequest('/omnimux/publish/tasks/retry', { method: 'POST', body: { task_id: taskId } }), { capability: 'publish', userInitiated: true })()
}

/**
 * 账号列表：hub 现有只读面（权威 ViewRow 合并）——本插件不自建账号路由。
 * @param {{ platform?: string }} [filters]
 */
export async function listHubAccounts(filters = {}) {
  const query = new URLSearchParams({ provider: PUBLISH_PROVIDER, platform: 'tiktok' })
  // 读取账号列表跳过本地余额预检，确保 0 积分用户仍可看到冻结/待激活账号并执行续费或解绑。
  const result = await quotaGuard(
    () => publishRequest(`/omnimux/accounts?${query}`),
    { capability: 'publish' },
    { precheck: false },
  )()
  if (result.ok && Array.isArray(result.body?.accounts)) {
    return { ...result, body: { ...result.body, accounts: result.body.accounts.filter(isPublishingAccount) } }
  }
  if (result.ok) return { ok: false, status: 502, body: { error: 'invalid account list response' } }
  return result
}

/**
 * 发起 TikTok 授权：hub `POST /omnimux/accounts`（中枢 withPat → 网关
 * /api/social/v1/connect，pickConnectView 保证仅 https auth_url 透出）。
 * 跳过本地余额预检，允许 0 积分复用空余席位并由网关返回真实 402/409 语义；
 * 若网关返回 402，quotaGuard 仍会自动唤起原生充值弹窗。
 * 成功响应体 { auth_url }；401/needs-omnimux 走登录引导。
 */
export function connectTikTokAccount() {
  return quotaGuard(
    () => publishRequest('/omnimux/accounts', { method: 'POST', body: { platform: 'tiktok', provider: PUBLISH_PROVIDER } }),
    { capability: 'publish', userInitiated: true },
    { precheck: false },
  )()
}

/**
 * 断开一个已连接账号。该请求只移除 OmniMux 中的账号连接，不宣称撤销
 * TikTok 的全局 token；Host 仍负责同源写入保护与上游协议转换。
 * 解绑不扣费，跳过本地余额预检以免 0 积分用户无法释放账号。
 * @param {string} accountId
 * @returns {Promise<{ ok: boolean, status: number, body: any }>}
 */
export function disconnectHubAccount(accountId) {
  if (typeof accountId !== 'string') {
    return Promise.resolve({ ok: false, status: 400, body: { error: 'id is required' } })
  }
  const id = accountId.trim()
  if (id === '') {
    return Promise.resolve({ ok: false, status: 400, body: { error: 'id is required' } })
  }
  return quotaGuard(
    () => publishRequest(`/omnimux/accounts/${encodeURIComponent(id)}?provider=${PUBLISH_PROVIDER}`, { method: 'DELETE' }),
    { capability: 'publish', userInitiated: true },
    { precheck: false },
  )()
}

/**
 * 读取当前社媒账号席位汇总与空席列表（hub `GET /omnimux/accounts/seats`）。
 * 读取态不触发 quotaGuard 预检，以免余额不足时无法查看席位与点击续费。
 * @returns {Promise<{ ok: boolean, status: number, body: any }>}
 */
export async function getHubSeats() {
  const result = await publishRequest('/omnimux/accounts/seats')
  if (!result.ok) return result
  const summary = pickSeatsSummary(result.body)
  if (!summary) return { ok: false, status: 502, body: { error: 'invalid seats response' } }
  return { ...result, body: summary }
}

/**
 * 手动续费/激活指定账号的席位（+30 天）。
 * 跳过本地 quota 缓存预检，以网关真实扣费校验为唯一真源；遇到 402 时由
 * quotaGuard 自动唤起原生充值弹窗。
 * @param {string} accountId
 * @returns {Promise<{ ok: boolean, status: number, body: any }>}
 */
export function renewHubAccountSeat(accountId) {
  if (typeof accountId !== 'string') {
    return Promise.resolve({ ok: false, status: 400, body: { error: 'id is required' } })
  }
  const id = accountId.trim()
  if (id === '') {
    return Promise.resolve({ ok: false, status: 400, body: { error: 'id is required' } })
  }
  return quotaGuard(
    () => publishRequest(`/omnimux/accounts/${encodeURIComponent(id)}/renew?provider=${PUBLISH_PROVIDER}`, {
      method: 'POST',
      body: { provider: PUBLISH_PROVIDER },
    }),
    { capability: 'publish', userInitiated: true },
    { precheck: false },
  )()
}
