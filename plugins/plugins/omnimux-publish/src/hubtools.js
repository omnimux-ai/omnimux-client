import { PUBLISH_PROVIDER } from './account-policy.js'
/**
 * HubPublishChannel: 懒封装 `ctx.tools.executable/execute` 程序化调用 hub
 * `omnimux_publish_*` / `omnimux_accounts_list` 官方工具。
 *
 * - 懒解析：调用时才探测工具（0.2.2-rc.5 起用 `tools.executable`，它排除不满足
 *   `when` 条件的注册；旧壳 0.2.1-rc.3 无该方法时回退 `tools.get`），规避插件
 *   加载顺序；不存在 → 确定性 `needs-hub`，不假装成功。
 * - 探测只用于存在性与错误分流；实际执行一律走 `ctx.tools.execute` 批次契约，
 *   绝不直接调用工具定义上的 `execute`（那会绕过策略、审批与结果审计）。
 * - `ctx.tools.execute` 走完整策略/审批管线（与模型直调同一条路）：
 *   - 默认按 DSH 0.2.2-rc.5 批次契约传 `ToolBatchInput`（`{ calls: [{ type: 'tool-call', id, name, arguments: JSON.stringify(...) }], signal, agent? }`），
 *     从 `ToolBatchResult.results` 按 `callId` 解出 `{ content, isError, value, error }`；
 *   - 仅当检测到冻结旧壳 DSH 0.2.1-rc.3 特征（`typeof tools.executionMode === 'function' && typeof tools.setExecutor !== 'function'`）时回退单调用格式。
 * - jsonOut 工具的 `value` 即上游 JSON 原样。
 * - 媒体 PUT 走预签名 URL（自授权），不带任何 secret header。
 */
import { PublishError } from './publish-error.js'
import { isObject } from './shared/values.js'
/** @typedef {{ type: 'tool-call', id: string, name: string, arguments: string }} ToolBatchCall */
/** @typedef {{ calls: ToolBatchCall[], signal: AbortSignal, agent?: unknown }} ToolBatchInput */
/** @typedef {{ callId: string, name: string, arguments: Record<string, unknown>, signal: AbortSignal, agent?: unknown }} LegacyToolExecution */
/** @typedef {{ get?: (name: string) => unknown, executable?: (name: string) => unknown, execute?: (input: ToolBatchInput | LegacyToolExecution) => Promise<unknown>, executionMode?: (...args: unknown[]) => unknown, setExecutor?: (...args: unknown[]) => unknown }} ToolRegistry */

/**
 * 探测一个工具定义：0.2.2-rc.5 用 `executable`（不含被 `when` 排除的注册），
 * 旧壳回退 `get`。两者都缺时返回 undefined，由调用方报确定性 `needs-hub`。
 * @param {ToolRegistry} tools
 * @param {string} name
 * @returns {unknown}
 */
function resolveToolDefinition(tools, name) {
  if (typeof tools.executable === 'function') return tools.executable(name)
  if (typeof tools.get === 'function') return tools.get(name)
  return undefined
}

/**
 * 精准识别冻结旧壳 DSH 0.2.1-rc.3 的单调用 ToolsService：
 * 0.2.1-rc.3 暴露 `executionMode()` 且无 `setExecutor()`；0.2.2-rc.5 及极简 mock 一律走批次契约。
 * @param {ToolRegistry} tools
 */
function usesLegacySingleExecute(tools) {
  return typeof tools.executionMode === 'function' && typeof tools.setExecutor !== 'function'
}

/**
 * 从 DSH 0.2.2-rc.5 `ToolBatchResult` 按 `callId`（或唯一条目）解出 `ToolExecutionResult`。
 * 任何畸形/空结果一律显式抛 `PublishError('hub-tool-error', ...)`，绝不静默吞错。
 * @param {unknown} batch
 * @param {string} callId
 * @param {string} toolName
 * @returns {Record<string, unknown>}
 */
function extractBatchResult(batch, callId, toolName) {
  if (!isObject(batch) || !Array.isArray(batch.results) || batch.results.length === 0) {
    throw new PublishError('hub-tool-error', `tool ${toolName} returned invalid batch result`)
  }
  const matched = batch.results.find((/** @type {unknown} */ item) => isObject(item) && item.callId === callId)
  const entry = matched ?? (batch.results.length === 1 ? batch.results[0] : undefined)
  if (!isObject(entry) || !isObject(entry.result)) {
    throw new PublishError('hub-tool-error', `tool ${toolName} batch result missing entry for call ${callId}`)
  }
  return entry.result
}

/**
 * @param {{ tools?: ToolRegistry, fetcher?: typeof fetch, now?: () => number, idFactory?: () => string }} [deps]
 */
export function createHubChannel(deps = {}) {
  const tools = deps.tools
  const fetcher = deps.fetcher ?? fetch
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
  const newCallId = deps.idFactory ?? (() => `omnimux-publish-${now().toString(36)}`)

  /**
   * @param {string} name
   * @param {Record<string, unknown>} args
   * @param {{ agent?: unknown, signal?: AbortSignal }} [opts]
   * @returns {Promise<unknown>}
   */
  async function exec(name, args, opts = {}) {
    if (!tools || typeof tools.execute !== 'function') {
      throw new PublishError('needs-hub', 'omnimux hub 插件未装载（ctx.tools 不可用），请安装/启用 omnimux hub 插件后再使用发布通道')
    }
    const tool = resolveToolDefinition(tools, name)
    if (!tool) {
      throw new PublishError('needs-hub', `omnimux hub 插件未装载（工具 ${name} 不存在），请安装/启用 omnimux hub 插件后再使用发布通道`)
    }
    const callId = newCallId()
    const signal = opts.signal || new AbortController().signal
    const normalizedArgs = args ?? {}
    const legacySingle = usesLegacySingleExecute(tools)
    /** @type {ToolBatchInput | LegacyToolExecution} */
    const input = legacySingle
      ? {
          callId,
          name,
          arguments: normalizedArgs,
          signal,
          ...(opts.agent !== undefined ? { agent: opts.agent } : {}),
        }
      : {
          calls: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(normalizedArgs) ?? '{}' }],
          signal,
          ...(opts.agent !== undefined ? { agent: opts.agent } : {}),
        }
    let raw
    try {
      raw = await tools.execute(input)
    } catch (error) {
      throw new PublishError('hub-tool-error', `tool ${name} threw: ${error instanceof Error ? error.message : String(error)}`)
    }
    /** @type {Record<string, unknown>} */
    let result
    if (legacySingle) {
      if (!isObject(raw)) {
        throw new PublishError('hub-tool-error', `tool ${name} returned no result object`)
      }
      result = raw
    } else {
      result = extractBatchResult(raw, callId, name)
    }
    const text = Array.isArray(result.content)
      ? result.content.map((/** @type {unknown} */ block) => (isObject(block) && typeof block.text === 'string' ? block.text : '')).join('\n')
      : ''
    if (result.isError) {
      // harness 把 execute 抛错物化为 content 文本 `Error: <message>`；
      // hub OmnimuxError 的 code 不进 content（errorInfo 只认 HarnessError），
      // 所以 needs-omnimux 要按 code + 已知消息特征双路识别（client.js 实证的消息串）。
      const errorInfo = isObject(result.error) ? result.error : {}
      const info = isObject(errorInfo.info) ? errorInfo.info : {}
      const structured = `${String(errorInfo.message || '')} ${String(info.code || '')}`
      const errText = `${text}\n${structured}`
      const sourceError = ['invalid-provider', 'account-provider-mismatch', 'post-provider-mismatch']
        .find((code) => errText.includes(code))
      if (sourceError) throw new PublishError(sourceError, text.trim() || sourceError)
      if (/needs-omnimux/i.test(errText)
        || /sign in to OmniMux/i.test(errText)
        || /OMNIMUX_ACCESS_TOKEN/.test(errText)
        || /official request unauthorized/i.test(errText)) {
        throw new PublishError('needs-omnimux', 'OmniMux 未登录：请先在 OmniMux 登录或设置 OMNIMUX_ACCESS_TOKEN，再执行发布相关操作')
      }
      if (/quota-exceeded|insufficient_user_quota|预扣费额度失败/i.test(errText)) {
        throw new PublishError('quota-exceeded', '当前操作需要更多额度，充值后即可继续使用 OmniMux。')
      }
      if (/UNKNOWN_TOOL/i.test(errText) || /unknown tool/i.test(errText)) {
        throw new PublishError('needs-hub', `omnimux hub 插件未装载（工具 ${name} 未知），请安装/启用 omnimux hub 插件`)
      }
      if (info.name === 'AbortError' || info.code === 'ABORTED' || info.code === 'ABORTED_BEFORE_DISPATCH') {
        const abortError = new Error(text.trim() || String(errorInfo.message || '').trim() || `tool ${name} aborted`)
        abortError.name = 'AbortError'
        throw abortError
      }
      throw new PublishError('hub-tool-error', text.trim() || String(errorInfo.message || '').trim() || `tool ${name} failed`)
    }
    return result.value
  }

  /**
   * 解包 `{ success, data }` 上游信封（docs/hub-tool-contracts.md）。
   * 兼容无信封的直返对象；success:false → 确定性错误。
   * @param {unknown} value
   * @param {string} toolName
   */
  function unwrap(value, toolName) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new PublishError('hub-tool-error', `${toolName} returned a non-object payload`)
    }
    const row = /** @type {Record<string, unknown>} */ (value)
    if ('success' in row && row.success === false) {
      throw new PublishError('hub-tool-error', String(row.message || row.error || `${toolName} upstream success:false`))
    }
    if ('data' in row && row.data && typeof row.data === 'object' && !Array.isArray(row.data)) {
      return /** @type {Record<string, unknown>} */ (row.data)
    }
    return row
  }

  /**
   * presign 媒体上传许可。
   * @param {{ filename: string, content_type?: string }} args
   * @param {{ agent?: unknown, signal?: AbortSignal }} [opts]
   */
  async function presign(args, opts = {}) {
    const value = await exec('omnimux_publish_presign', {
      filename: args.filename,
      ...(args.content_type ? { content_type: args.content_type } : {}),
    }, opts)
    const data = unwrap(value, 'omnimux_publish_presign')
    const uploadUrl = typeof data.upload_url === 'string' && data.upload_url ? data.upload_url : ''
    const publicUrl = typeof data.public_url === 'string' && data.public_url ? data.public_url : ''
    if (!uploadUrl || !publicUrl) {
      throw new PublishError('hub-tool-error', `presign response missing upload_url/public_url: ${JSON.stringify(data).slice(0, 300)}`)
    }
    // A presigned ticket may bind extra headers (for example R2's If-None-Match).
    // Replay them, but normalize the name to lower case and drop `host`: the HTTP
    // stack owns Host and signs it implicitly, so echoing it breaks the signature.
    /** @type {Record<string, string>} */
    const headers = {}
    if (isObject(data.headers)) {
      for (const [key, value] of Object.entries(data.headers)) {
        const name = key.trim().toLowerCase()
        if (name === '' || name === 'host') continue
        if (typeof value === 'string' && value !== '') headers[name] = value
      }
    }
    const uploadMethod = typeof data.upload_method === 'string' && data.upload_method !== ''
      ? data.upload_method.toUpperCase()
      : 'PUT'
    return { upload_url: uploadUrl, public_url: publicUrl, headers, upload_method: uploadMethod }
  }

  /**
   * @param {{
   *   account_ids: string[],
   *   content: string,
   *   media_items: Array<Record<string, unknown>>,
   *   tiktok_options?: Record<string, unknown>,
   *   title?: string,
   *   description?: string,
   *   photo_cover_index?: number,
   *   is_aigc?: boolean,
   * }} args
   * @param {{ agent?: unknown, signal?: AbortSignal }} [opts]
   */
  async function createPost(args, opts = {}) {
    const value = await exec('omnimux_publish_create', { ...args, provider: PUBLISH_PROVIDER }, opts)
    return unwrap(value, 'omnimux_publish_create')
  }

  /**
   * @param {string} postId
   * @param {{ agent?: unknown, signal?: AbortSignal }} [opts]
   */
  async function getPost(postId, opts = {}) {
    const value = await exec('omnimux_publish_get', { id: String(postId), provider: PUBLISH_PROVIDER }, opts)
    return unwrap(value, 'omnimux_publish_get')
  }

  /**
   * 读取账号在 TikTok 侧的发布能力（可用隐私级别、禁用的互动项）。
   * @param {string} accountId
   * @param {{ agent?: unknown, signal?: AbortSignal }} [opts]
   */
  async function creatorInfo(accountId, opts = {}) {
    const value = await exec('omnimux_accounts_creator_info', { id: String(accountId), provider: PUBLISH_PROVIDER }, opts)
    return unwrap(value, 'omnimux_accounts_creator_info')
  }

  /**
   * @param {{ agent?: unknown, signal?: AbortSignal }} [opts]
   */
  async function listAccounts(opts = {}) {
    const value = await exec('omnimux_accounts_list', { provider: PUBLISH_PROVIDER }, opts)
    return unwrap(value, 'omnimux_accounts_list')
  }

  /**
   * 把字节发到预签名 URL（预签名自授权，不带任何 auth header）。
   * `headers` 来自 presign 响应：签名绑定的头必须原样回放，否则对象存储会以 403 拒绝。
   * @param {string} uploadUrl
   * @param {Buffer} buffer
   * @param {string} contentType
   * @param {{ signal?: AbortSignal }} [opts]
   * @param {{ headers?: Record<string, string>, upload_method?: string }} [ticket]
   */
  async function putBytes(uploadUrl, buffer, contentType, opts = {}, ticket = {}) {
    const method = typeof ticket.upload_method === 'string' && ticket.upload_method !== ''
      ? ticket.upload_method.toUpperCase()
      : 'PUT'
    if (method !== 'PUT') {
      throw new PublishError('upload-failed', `unsupported presign upload method: ${method}`)
    }
    /** @type {Record<string, string>} */
    const headers = { 'content-type': contentType }
    if (isObject(ticket.headers)) {
      for (const [key, value] of Object.entries(ticket.headers)) {
        const name = key.trim().toLowerCase()
        if (name === '' || name === 'host') continue
        if (typeof value === 'string' && value !== '') headers[name] = value
      }
    }
    let response
    try {
      response = await fetcher(uploadUrl, {
        method,
        headers,
        body: buffer,
        ...(opts.signal ? { signal: opts.signal } : {}),
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new PublishError('upload-failed', `media upload request failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!response.ok) {
      throw new PublishError('upload-failed', `media upload failed (HTTP ${response.status})`)
    }
    return { ok: true, status: response.status }
  }

  return { exec, unwrap, presign, createPost, getPost, listAccounts, creatorInfo, putBytes }
}

/**
 * 从 create/get 响应中提取 post_id（data.id；number 归一为 string）。
 * @param {Record<string, unknown>} data
 * @param {string} toolName
 */
export function extractPostId(data, toolName) {
  const id = data.id ?? data.post_id ?? data.taskId ?? data.task_id
  if (id === undefined || id === null || id === '') {
    throw new PublishError('hub-tool-error', `${toolName} response missing post id: ${JSON.stringify(data).slice(0, 300)}`)
  }
  return String(id)
}

/**
 * 从 get 响应中提取平台原始状态（data.status；缺失返回 null）。
 * @param {Record<string, unknown>} data
 */
export function extractRawStatus(data) {
  const status = data.status ?? data.platform_status ?? data.raw_status
  return typeof status === 'string' && status.trim() !== '' ? status : null
}
