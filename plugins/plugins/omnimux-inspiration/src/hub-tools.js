/**
 * Hub tool dispatch for domain plugins.
 *
 * A tool definition read out of the registry and executed in place bypasses the
 * host's policy, approval and audit pipeline. Non-hub plugins must either
 * consume a Hub seam (`ctx.get('...')`) or dispatch through
 * `ctx.tools.execute`. This module owns the second path for the few tools that
 * have no seam yet, and keeps the 0.2.2 batch contract and the frozen 0.2.1
 * single-call fallback in one place.
 */

/** Code raised when the registry or the named tool is unavailable. */
export const HUB_TOOL_NOT_READY = 'hub-tool-not-ready'

const TOOL_NOT_READY_MESSAGE = '工具 %s 未就绪：ctx.tools.execute 不可用'

/**
 * @typedef {{ type: 'tool-call', id: string, name: string, arguments: string }} ToolBatchCall
 * @typedef {{ calls: ToolBatchCall[], signal: AbortSignal, agent?: unknown }} ToolBatchInput
 * @typedef {{ callId: string, name: string, arguments: Record<string, unknown>, signal: AbortSignal, agent?: unknown }} LegacyToolExecution
 * @typedef {{ get?: (name: string) => unknown, executable?: (name: string) => unknown, execute?: (input: ToolBatchInput | LegacyToolExecution) => Promise<unknown>, executionMode?: (...args: unknown[]) => unknown, setExecutor?: (...args: unknown[]) => unknown }} ToolRegistry
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Frozen 0.2.1-rc.3 exposes `executionMode()` and no `setExecutor()`.
 * @param {ToolRegistry} tools
 */
function usesLegacySingleExecute(tools) {
  return typeof tools.executionMode === 'function' && typeof tools.setExecutor !== 'function'
}

/**
 * @param {unknown} batch
 * @param {string} callId
 * @param {string} toolName
 * @returns {Record<string, unknown>}
 */
function extractBatchResult(batch, callId, toolName) {
  const results = isObject(batch) && Array.isArray(batch.results) ? batch.results : []
  if (results.length === 0) {
    throw new Error(`工具 ${toolName} 未返回有效批次结果`)
  }
  const matched = results.find((item) => isObject(item) && item.callId === callId)
  const entry = matched ?? (results.length === 1 ? results[0] : undefined)
  if (!isObject(entry) || !isObject(entry.result)) {
    throw new Error(`工具 ${toolName} 批次结果缺少 callId=${callId} 的条目`)
  }
  return /** @type {Record<string, unknown>} */ (entry.result)
}

/**
 * @param {Record<string, unknown>} result
 * @param {string} toolName
 * @returns {never}
 */
function throwToolResult(result, toolName) {
  const content = Array.isArray(result.content) ? result.content : []
  const text = content
    .map((block) => (isObject(block) && typeof block.text === 'string' ? block.text : ''))
    .join('\n')
    .trim()
  const errorInfo = isObject(result.error) ? result.error : {}
  const info = isObject(errorInfo.info) ? errorInfo.info : {}
  const rawMessage = text || String(errorInfo.message || '').trim() || `工具 ${toolName} 执行失败`
  const errText = `${text}\n${String(errorInfo.message || '')}\n${String(info.code || '')}\n${String(info.name || '')}`
  if (/UNKNOWN_TOOL|unknown tool/i.test(errText)) {
    const error = new Error(`工具 ${toolName} 不存在`)
    error.code = HUB_TOOL_NOT_READY
    throw error
  }
  if (info.name === 'AbortError' || info.code === 'ABORT_ERR' || info.code === 'ABORTED') {
    const error = new Error(rawMessage)
    error.name = 'AbortError'
    error.code = 'ABORT_ERR'
    throw error
  }
  const error = new Error(rawMessage)
  if (typeof info.code === 'string' && info.code.trim()) error.code = info.code.trim()
  throw error
}

/**
 * @param {{ resolveTools?: () => ToolRegistry | undefined, idFactory?: () => string }} [deps]
 */
export function createHubToolExecutor(deps = {}) {
  const resolveTools = typeof deps.resolveTools === 'function' ? deps.resolveTools : () => undefined
  let sequence = 0
  const newCallId = typeof deps.idFactory === 'function'
    ? deps.idFactory
    : () => `omnimux-inspiration-${Date.now().toString(36)}-${sequence++}`

  return {
    /**
     * Dispatch one registered tool through the host pipeline.
     * @param {string} name
     * @param {Record<string, unknown>} args
     * @param {{ signal?: AbortSignal, agent?: unknown }} [opts]
     * @returns {Promise<unknown>}
     */
    async execute(name, args, opts = {}) {
      const tools = resolveTools()
      if (!tools || typeof tools.execute !== 'function') {
        const error = new Error(TOOL_NOT_READY_MESSAGE.replace('%s', name))
        error.code = HUB_TOOL_NOT_READY
        throw error
      }
      const signal = opts.signal || new AbortController().signal
      const callId = newCallId()
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
        if (signal.aborted) {
          const abortError = new Error(`工具 ${name} 已取消`)
          abortError.name = 'AbortError'
          abortError.code = 'ABORT_ERR'
          throw abortError
        }
        throw new Error(`工具 ${name} 执行失败: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (legacySingle && isObject(raw) && !('isError' in raw) && !('content' in raw) && !('value' in raw)) {
        return raw
      }
      const result = legacySingle ? raw : extractBatchResult(raw, callId, name)
      if (!isObject(result)) throw new Error(`工具 ${name} 未返回结果对象`)
      if (result.isError) throwToolResult(result, name)
      return result.value
    },
  }
}

/**
 * `ctx.get('textComplete')` wrapper. The Hub seam takes one request object and
 * resolves the signal inside it, unlike the old `execute(args, exec)` tool
 * definition.
 *
 * @param {{ resolveTextComplete?: () => { execute?: (req: object) => Promise<unknown> } | undefined }} [deps]
 */
export function createTextCompleteAdapter(deps = {}) {
  const resolveTextComplete = typeof deps.resolveTextComplete === 'function' ? deps.resolveTextComplete : () => undefined
  return {
    /**
     * @param {Record<string, unknown>} args
     * @param {{ signal?: AbortSignal }} [exec]
     * @returns {Promise<unknown>}
     */
    async execute(args, exec = {}) {
      const seam = resolveTextComplete()
      if (!seam || typeof seam.execute !== 'function') {
        throw new Error('omnimux_text_complete 未就绪')
      }
      const req = { ...args }
      if (exec.signal !== undefined) req.signal = exec.signal
      return seam.execute(req)
    },
  }
}

/**
 * `video_analyze` has no Hub seam; dispatch it through `ctx.tools.execute` and
 * keep the actionable "video plugin not loaded" message for the caller.
 *
 * @param {{ resolveTools?: () => ToolRegistry | undefined, idFactory?: () => string }} [deps]
 */
export function createVideoAnalyzeAdapter(deps = {}) {
  const executor = createHubToolExecutor(deps)
  return {
    /**
     * @param {Record<string, unknown>} args
     * @param {{ signal?: AbortSignal }} [exec]
     * @returns {Promise<unknown>}
     */
    async execute(args, exec = {}) {
      try {
        return await executor.execute('video_analyze', args, { signal: exec.signal })
      } catch (error) {
        if (error?.code === HUB_TOOL_NOT_READY) {
          throw new Error('多模态视频分析工具 (video_analyze) 未就绪，请检查 omnimux-video 插件是否加载')
        }
        throw error
      }
    },
  }
}
