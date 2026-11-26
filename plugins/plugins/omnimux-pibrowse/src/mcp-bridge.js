import { MCP_SERVER_NAME, UPSTREAM_MCP_TOOL_NAMES } from './constants.js'
import { ensurePrivateSocketDir, verifySocketTrust } from './paths.js'
import { resolveAgentBinary, resolveCoreExecutable } from './platform.js'
import { redactLogLine } from './redact.js'

/**
 * Native DSH MCP bridge registering upstream `fury-agent mcp` into
 * `@deepseek-ai/dsh-mcp-manager` under server name `pibrowse`.
 *
 * Exposes all 19 upstream v0.5.5 `mcp__pibrowse__fury_*` tools plus upstream `SKILL.md`
 * instructions while sharing the exact isolated `FURY_HOME` and `FURY_SOCKET`.
 * Explicitly neutralizes `FURY_API_PORT` and `FURY_API_TOKEN` so an ambient parent
 * environment cannot open a local TCP HTTP port if `fury-agent mcp` spawns the daemon.
 *
 * @param {{
 *   paths: ReturnType<import('./paths.js').resolvePibrowsePaths>,
 *   configStore: ReturnType<import('./config-store.js').createConfigStore>,
 *   platform?: NodeJS.Platform,
 *   logger?: { info?: Function, warn?: Function },
 *   getMcpManager: () => any,
 *   getToolsService?: () => any,
 *   mcpArgs?: string[],
 *   startupTimeoutMs?: number,
 *   toolCallTimeoutMs?: number,
 * }} opts
 */
export function createMcpBridge(opts) {
  let registered = false
  let registeredCommand = null
  let registeredCorePath = null
  let disposeRegistration = null
  let lastStatus = {
    registered: false,
    serverName: MCP_SERVER_NAME,
    state: 'idle',
    toolPrefix: `mcp__${MCP_SERVER_NAME}__`,
    expectedToolsCount: UPSTREAM_MCP_TOOL_NAMES.length,
    registeredTools: [],
    command: null,
    error: null,
    updatedAt: null,
  }

  function listMountedMcpTools() {
    const toolsSvc = opts.getToolsService?.()
    if (!toolsSvc) return []
    const prefix = `mcp__${MCP_SERVER_NAME}__`
    // Real @deepseek-ai/dsh-tools exposes `definitions()` / `schemas()`; fall back to `list()` for tests.
    const raw =
      typeof toolsSvc.definitions === 'function'
        ? toolsSvc.definitions()
        : typeof toolsSvc.schemas === 'function'
          ? toolsSvc.schemas()
          : typeof toolsSvc.list === 'function'
            ? toolsSvc.list()
            : []
    if (!Array.isArray(raw)) return []
    return raw
      .map((t) => (typeof t === 'string' ? t : t?.name))
      .filter((n) => typeof n === 'string' && n.startsWith(prefix))
  }

  function readManagerServerStatus(manager) {
    if (!manager) return null
    if (typeof manager.list === 'function') {
      const list = manager.list()
      if (Array.isArray(list)) {
        const entry = list.find((item) => item && item.name === MCP_SERVER_NAME)
        if (entry) return entry.status ?? entry.state ?? null
      }
    }
    if (typeof manager.getStatus === 'function') {
      return manager.getStatus(MCP_SERVER_NAME)
    }
    return null
  }

  /**
   * Handle `@deepseek-ai/dsh-mcp-manager` `'mcp-manager/status'` event.
   * Real DSH Host emits 2 args `(name: string, status: McpManagedServerStatus)`;
   * also tolerates single-object `{ name, status }` payloads.
   */
  function handleManagerStatusEvent(nameOrPayload, statusArg) {
    let eventName = null
    let statusObj = null
    if (typeof nameOrPayload === 'string') {
      eventName = nameOrPayload
      statusObj = statusArg
    } else if (nameOrPayload && typeof nameOrPayload === 'object') {
      eventName = nameOrPayload.name ?? null
      statusObj = nameOrPayload
    }
    if (eventName !== MCP_SERVER_NAME) return

    const nextState =
      typeof statusObj === 'string'
        ? statusObj
        : typeof statusObj?.status === 'string'
          ? statusObj.status
          : typeof statusObj?.state === 'string'
            ? statusObj.state
            : lastStatus.state
    const rawErr = statusObj && typeof statusObj === 'object' ? statusObj.error ?? statusObj.lastError : null
    const errText = rawErr ? redactLogLine(String(rawErr)) : null

    lastStatus = {
      ...lastStatus,
      state: nextState,
      error: errText,
      registeredTools: listMountedMcpTools(),
      updatedAt: new Date().toISOString(),
    }
  }

  function getStatus() {
    const mounted = listMountedMcpTools()
    return {
      ...lastStatus,
      registered,
      managerAvailable: Boolean(opts.getMcpManager?.()),
      registeredTools: mounted,
      mountedToolsCount: mounted.length,
    }
  }

  function unregister() {
    const manager = opts.getMcpManager?.()
    if (typeof disposeRegistration === 'function') {
      try {
        disposeRegistration()
      } catch (err) {
        opts.logger?.warn?.('omnimux-pibrowse: mcp dispose callback failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
      disposeRegistration = null
    } else if (registered && manager && typeof manager.unregister === 'function') {
      try {
        manager.unregister(MCP_SERVER_NAME)
      } catch (err) {
        opts.logger?.warn?.('omnimux-pibrowse: mcp unregister failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    registered = false
    registeredCommand = null
    registeredCorePath = null
    lastStatus = {
      ...lastStatus,
      registered: false,
      state: 'stopped',
      command: null,
      registeredTools: [],
      updatedAt: new Date().toISOString(),
    }
    return getStatus()
  }

  async function sync({ force = false } = {}) {
    const manager = opts.getMcpManager?.()
    if (!manager || typeof manager.register !== 'function') {
      lastStatus = {
        ...lastStatus,
        registered: false,
        state: 'unavailable',
        error: 'Host mcpManager service is not mounted',
        updatedAt: new Date().toISOString(),
      }
      return getStatus()
    }

    const config = await opts.configStore.load()
    const resolved = await resolveAgentBinary({
      paths: opts.paths,
      config,
      platform: opts.platform,
    })

    if (!resolved.installed || !resolved.path) {
      if (registered) unregister()
      lastStatus = {
        ...lastStatus,
        registered: false,
        state: 'not-installed',
        command: null,
        error: 'fury-agent binary is not installed yet',
        updatedAt: new Date().toISOString(),
      }
      return getStatus()
    }

    // Only inject FURY_CORE when it resolves to a real executable; never pass a raw
    // directory or non-executable file into upstream fury-agent.
    const resolvedCorePath = config.corePath
      ? await resolveCoreExecutable(config.corePath, opts.platform)
      : null

    if (
      !force &&
      registered &&
      registeredCommand === resolved.path &&
      registeredCorePath === resolvedCorePath
    ) {
      return getStatus()
    }

    if (registered) {
      unregister()
    }

    // Ensure private 0700 socket directory and verify no untrusted socket exists BEFORE spawning `fury-agent mcp`.
    try {
      await ensurePrivateSocketDir(opts.paths.socketPath, { platform: opts.platform, uid: opts.uid, lstatImpl: opts.lstatImpl })
      await verifySocketTrust(opts.paths.socketPath, { platform: opts.platform, uid: opts.uid, lstatImpl: opts.lstatImpl })
    } catch (err) {
      const safeErr = redactLogLine(err instanceof Error ? err.message : String(err))
      if (registered) unregister()
      lastStatus = {
        ...lastStatus,
        registered: false,
        state: 'error',
        command: resolved.path,
        error: safeErr,
        updatedAt: new Date().toISOString(),
      }
      opts.logger?.warn?.('omnimux-pibrowse: mcpBridge refused untrusted IPC socket', { error: safeErr })
      return getStatus()
    }

    // Explicitly neutralize FURY_API_PORT / FURY_API_TOKEN so parent env cannot open a TCP port.
    const env = {
      FURY_HOME: opts.paths.dataDir,
      FURY_SOCKET: opts.paths.socketPath,
      FURY_API_PORT: '',
      FURY_API_TOKEN: '',
      ...(resolvedCorePath ? { FURY_CORE: resolvedCorePath } : {}),
    }

    try {
      const res = manager.register(MCP_SERVER_NAME, {
        transport: 'stdio',
        command: resolved.path,
        args: opts.mcpArgs ?? ['mcp'],
        env,
        startupTimeoutMs: opts.startupTimeoutMs ?? 30_000,
        toolCallTimeoutMs: opts.toolCallTimeoutMs ?? 120_000,
      })
      disposeRegistration = typeof res === 'function'
        ? res
        : res && typeof res.dispose === 'function'
          ? () => res.dispose()
          : null
      registered = true
      registeredCommand = resolved.path
      registeredCorePath = resolvedCorePath

      const managerSnap = readManagerServerStatus(manager)
      lastStatus = {
        ...lastStatus,
        registered: true,
        state:
          typeof managerSnap === 'string'
            ? managerSnap
            : managerSnap?.status || managerSnap?.state || 'registered',
        command: resolved.path,
        error: null,
        registeredTools: listMountedMcpTools(),
        updatedAt: new Date().toISOString(),
      }
      return getStatus()
    } catch (err) {
      const safeErr = redactLogLine(err instanceof Error ? err.message : String(err))
      lastStatus = {
        ...lastStatus,
        registered: false,
        state: 'error',
        command: resolved.path,
        error: safeErr,
        updatedAt: new Date().toISOString(),
      }
      opts.logger?.warn?.('omnimux-pibrowse: mcpManager.register failed', {
        error: safeErr,
      })
      return getStatus()
    }
  }

  async function restart() {
    return sync({ force: true })
  }

  async function probe() {
    const status = await sync({ force: false })
    const manager = opts.getMcpManager?.()
    const rawSnapshot = manager && typeof manager.list === 'function'
      ? manager.list()
      : null
    return {
      ...status,
      managerSnapshot: rawSnapshot,
    }
  }

  return {
    getStatus,
    sync,
    restart,
    probe,
    unregister,
    dispose: unregister,
    handleManagerStatusEvent,
  }
}
