import { PIBROWSE_TOOL_NAMES, PLUGIN_ID } from './constants.js'
import { createConfigStore } from './config-store.js'
import { createPibrowseDispatcher } from './dispatcher.js'
import { PibrowseError } from './errors.js'
import { registerPibrowseRoutes } from './http-routes.js'
import { createInstaller } from './installer.js'
import { createIpcClient } from './ipc-client.js'
import { createMcpBridge } from './mcp-bridge.js'
import { resolvePibrowsePaths } from './paths.js'
import { redactAny, redactLogLine, toLosslessJson } from './redact.js'
import { createSidecarSupervisor } from './sidecar.js'
import { createTeamClient } from './team-client.js'

export const name = PLUGIN_ID
export const inject = ['tools']
export { PIBROWSE_TOOL_NAMES }

const PIBROWSE_SYSTEM_PROMPT = `This workspace includes the OmniMux Fingerprint Browser plugin (omnimux-pibrowse), backed by an isolated fury-agent sidecar and native MCP bridge.
Use omnimux-pibrowse for isolated multi-account fingerprint browser profiles, proxy pools, domain blocklists, extensions, multi-window mirror sync, and E2E encrypted Team Server sync. Keep omnimux-browser for attaching to the user's everyday Chrome tabs.
When fury-agent MCP is connected, prefer mcp__pibrowse__fury_* tools for profile listing, launching, navigation, snapshots, clicks, typing, and warming; use pibrowse_* tools for runtime lifecycle, proxy verification/diagnostics/rotation, blocklists, extensions/mirror, Team Sync, and destructive actions (which require confirm: true). Never request or echo raw proxy passwords or encryption keys.`

function objectParams(fields) {
  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(fields)) {
    const { required: isRequired, ...rest } = spec
    properties[key] = rest
    if (isRequired) required.push(key)
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }
}

const jsonOut = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

export function apply(ctx, config = {}) {
  const paths = resolvePibrowsePaths({
    home: config.home,
    rootDir: config.rootDir,
    socketPath: config.socketPath,
    socketDir: config.socketDir,
    platform: config.platform,
  })

  const configStore = createConfigStore({
    configFile: paths.configFile,
    logger: ctx.logger,
  })

  const ipcClient = createIpcClient({
    socketPath: paths.socketPath,
    platform: config.platform,
    defaultTimeoutMs: config.ipcTimeoutMs ?? 15_000,
    logger: ctx.logger,
  })

  const installer = createInstaller({
    paths,
    configStore,
    platform: config.platform,
    arch: config.arch,
    fetchImpl: config.fetchImpl,
    execFileImpl: config.execFileImpl,
    logger: ctx.logger,
  })

  const sidecar = createSidecarSupervisor({
    paths,
    configStore,
    ipcClient,
    spawnImpl: config.spawnImpl,
    platform: config.platform,
    startupTimeoutMs: config.startupTimeoutMs,
    shutdownTimeoutMs: config.shutdownTimeoutMs,
    logger: ctx.logger,
  })

  let currentMcpManager = null
  const mcpBridge = createMcpBridge({
    paths,
    configStore,
    platform: config.platform,
    logger: ctx.logger,
    getMcpManager: () => currentMcpManager ?? ctx.get?.('mcpManager') ?? ctx.mcpManager ?? null,
    getToolsService: () => ctx.tools ?? ctx.get?.('tools') ?? null,
    mcpArgs: config.mcpArgs,
    startupTimeoutMs: config.mcpStartupTimeoutMs,
    toolCallTimeoutMs: config.mcpToolCallTimeoutMs,
  })

  const teamClient = createTeamClient({
    paths,
    configStore,
    ipcClient,
    fetchImpl: config.fetchImpl,
    kdfOpts: config.kdfOpts,
    logger: ctx.logger,
  })

  const dispatcher = createPibrowseDispatcher({
    paths,
    configStore,
    ipcClient,
    installer,
    sidecar,
    mcpBridge,
    teamClient,
    platform: config.platform,
    arch: config.arch,
    widevineProbeOpts: config.widevineProbeOpts,
    standaloneCandidates: config.standaloneCandidates,
    logger: ctx.logger,
  })

  if (typeof ctx.effect === 'function') {
    ctx.effect(
      () => () => {
        mcpBridge.dispose()
        void sidecar
          .dispose()
          .catch((err) => {
            ctx.logger?.warn?.('omnimux-pibrowse: sidecar dispose failed', {
              error: redactLogLine(err instanceof Error ? err.message : String(err)),
            })
          })
          .finally(() => {
            void teamClient.dispose().catch((err) => {
              ctx.logger?.warn?.('omnimux-pibrowse: teamClient dispose failed', {
                error: redactLogLine(err instanceof Error ? err.message : String(err)),
              })
            })
          })
      },
      'omnimux-pibrowse: lifecycle',
    )
  }

  // Optional HTTP routes on webServer
  const mountHttp = (httpCtx) => {
    const webServer = httpCtx.webServer ?? httpCtx.get?.('webServer')
    if (!webServer || typeof webServer.register !== 'function') return
    const mount = () => registerPibrowseRoutes(webServer, dispatcher, ctx.logger, {
      getConnection: () => httpCtx.get?.('connection') ?? ctx.get?.('connection'),
    })
    if (typeof httpCtx.effect === 'function') httpCtx.effect(mount, 'omnimux-pibrowse: http routes')
    else mount()
  }
  if (typeof ctx.inject === 'function') ctx.inject(['webServer'], mountHttp)
  else mountHttp(ctx)

  // Optional native MCP registration via DSH mcpManager
  const mountMcp = (mcpCtx) => {
    const manager = mcpCtx.mcpManager ?? mcpCtx.get?.('mcpManager')
    if (!manager || typeof manager.register !== 'function') return
    currentMcpManager = manager
    if (typeof mcpCtx.on === 'function') {
      const offStatus = mcpCtx.on('mcp-manager/status', (serverName, status) => {
        mcpBridge.handleManagerStatusEvent(serverName, status)
      })
      if (typeof mcpCtx.effect === 'function') {
        mcpCtx.effect(() => () => {
          offStatus?.()
          mcpBridge.dispose()
          if (currentMcpManager === manager) currentMcpManager = null
        }, 'omnimux-pibrowse: mcp bridge')
      }
    } else if (typeof mcpCtx.effect === 'function') {
      mcpCtx.effect(() => () => {
        mcpBridge.dispose()
        if (currentMcpManager === manager) currentMcpManager = null
      }, 'omnimux-pibrowse: mcp bridge')
    }
    if (config.autoRegisterMcp !== false) {
      void mcpBridge.sync({ force: false }).catch((err) => {
        ctx.logger?.warn?.('omnimux-pibrowse: initial mcpBridge sync failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['mcpManager'], mountMcp)
  else mountMcp(ctx)

  // Optional static system prompt section
  const mountPrompt = (promptCtx) => {
    const promptService = promptCtx.systemPrompt ?? promptCtx.get?.('systemPrompt')
    if (!promptService || typeof promptService.section !== 'function') return
    const register = () =>
      promptService.section({
        name: 'pibrowse:ops',
        order: 73,
        text: PIBROWSE_SYSTEM_PROMPT,
      })
    if (typeof promptCtx.effect === 'function') promptCtx.effect(register, 'pibrowse:ops')
    else register()
  }
  if (typeof ctx.inject === 'function') ctx.inject(['systemPrompt'], mountPrompt)
  else mountPrompt(ctx)

  async function safeTool(fn, args) {
    try {
      const result = await fn(args || {})
      return toLosslessJson(result)
    } catch (err) {
      const code = err instanceof PibrowseError ? err.code : 'internal'
      const message = redactLogLine(err instanceof Error ? err.message : String(err))
      const details = err instanceof PibrowseError && err.details ? redactAny(err.details) : undefined
      ctx.logger?.warn?.('omnimux-pibrowse: tool execution returned domain error', { code, message })
      return toLosslessJson({
        ok: false,
        error: code,
        message,
        ...(details ? { details } : {}),
      })
    }
  }

  // ---- 8 Lean Non-Overlapping Management & Guarded Agent Tools ----

  ctx.tools.register({
    name: 'pibrowse_runtime_status',
    description:
      'Inspect PiBrowse platform compatibility, fury-agent sidecar state, Chromium Core version, Widevine CDM availability, MCP bridge status, and Team Sync overview.',
    parameters: objectParams({}),
    output: jsonOut,
    execute: (args) => safeTool(() => dispatcher.getOverview(), args),
  })

  ctx.tools.register({
    name: 'pibrowse_manage_runtime',
    description:
      'Start, stop, or restart the fury-agent sidecar, install verified agent/Core binaries, reuse a detected standalone PiBrowse installation, probe/restart MCP, or clear cached archives (clear_cache requires confirm: true). Custom binary path overrides are restricted to direct UI settings.',
    parameters: objectParams({
      action: {
        type: 'string',
        required: true,
        enum: [
          'status',
          'start',
          'stop',
          'restart',
          'install_agent',
          'install_core',
          'core_download_status',
          'reuse_standalone',
          'probe_agent',
          'probe_mcp',
          'restart_mcp',
          'clear_cache',
        ],
        description: 'Runtime lifecycle or installer operation to run',
      },
      stopProfiles: { type: 'boolean', description: 'Stop running browser profiles when action=stop' },
      confirm: { type: 'boolean', description: 'Must be true when action=clear_cache' },
    }),
    output: jsonOut,
    execute: (args) => safeTool((a) => dispatcher.manageRuntime(a, { caller: 'agent' }), args),
  })

  ctx.tools.register({
    name: 'pibrowse_manage_profiles',
    description:
      'Clone profiles, re-randomize or reset hardware fingerprints, list/restore/purge trashed profiles (purge requires confirm: true), or launch the fingerprint detect-suite.',
    parameters: objectParams({
      action: {
        type: 'string',
        required: true,
        enum: ['clone', 'rerandomize', 'reset_fingerprint', 'trash', 'trash_list', 'restore', 'purge', 'detect_suite'],
        description: 'Profile maintenance operation',
      },
      profileId: { type: 'string', description: 'Target profile ID (required for all actions except trash_list)' },
      name: { type: 'string', description: 'Optional new profile name when action=clone' },
      count: { type: 'number', description: 'Optional clone count when action=clone' },
      detectUrl: { type: 'string', description: 'Optional fingerprint check URL when action=detect_suite' },
      confirm: { type: 'boolean', description: 'Must be true when action=purge' },
    }),
    output: jsonOut,
    execute: (args) => safeTool((a) => dispatcher.manageProfiles(a), args),
  })

  ctx.tools.register({
    name: 'pibrowse_check_proxy',
    description:
      'Probe a proxy pool entry for exit IP, country, and timezone (with optional offline MaxMind .mmdb), run staged connectivity diagnostics, or invoke mobile proxy IP rotation.',
    parameters: objectParams({
      proxyId: { type: 'string', required: true, description: 'Target proxy ID from the PiBrowse proxy pool' },
      action: {
        type: 'string',
        enum: ['check', 'diagnose', 'rotate'],
        description: 'Probe mode: check exit IP, staged diagnose, or trigger mobile rotate URL (default check)',
      },
      geoipPath: { type: 'string', description: 'Optional absolute path to a local MaxMind .mmdb database' },
    }),
    output: jsonOut,
    execute: (args) => safeTool((a) => dispatcher.checkProxy(a), args),
  })

  ctx.tools.register({
    name: 'pibrowse_delete_proxy',
    description:
      'Delete a proxy pool entry after verifying no browser profile still references it. Destructive operation requiring confirm: true.',
    parameters: objectParams({
      proxyId: { type: 'string', required: true, description: 'Target proxy ID to delete' },
      confirm: { type: 'boolean', required: true, description: 'Must be true to confirm permanent proxy removal' },
    }),
    output: jsonOut,
    execute: (args) => safeTool((a) => dispatcher.deleteProxy(a), args),
  })

  ctx.tools.register({
    name: 'pibrowse_manage_blocklists',
    description:
      'List, read, save (supporting @allow-only whitelist directives), bind to browser profiles, or delete domain blocklist rulesets (delete requires confirm: true).',
    parameters: objectParams({
      action: {
        type: 'string',
        required: true,
        enum: ['list', 'get', 'save', 'bind', 'delete'],
        description: 'Blocklist operation',
      },
      name: { type: 'string', description: 'Ruleset name for get/save/delete' },
      content: { type: 'string', description: 'Newline-delimited domain rules (supports @allow-only) for save' },
      profileId: { type: 'string', description: 'Target profile ID when action=bind' },
      blocklists: { type: 'array', items: { type: 'string' }, description: 'Blocklist names to bind to the profile' },
      confirm: { type: 'boolean', description: 'Must be true when action=delete' },
    }),
    output: jsonOut,
    execute: (args) => safeTool((a) => dispatcher.manageBlocklists(a), args),
  })

  ctx.tools.register({
    name: 'pibrowse_manage_extensions_and_mirror',
    description:
      'List, install (.crx package or 32-char Chrome Web Store ID), or remove browser extensions (remove_extension requires confirm: true), and start or stop multi-window mirror input broadcasting.',
    parameters: objectParams({
      action: {
        type: 'string',
        required: true,
        enum: ['list_extensions', 'install_extension', 'remove_extension', 'mirror_status', 'mirror_start', 'mirror_stop'],
        description: 'Extension or multi-window mirror operation',
      },
      source: { type: 'string', description: 'Local .crx package path or 32-char Chrome Web Store ID for install_extension' },
      kind: { type: 'string', enum: ['crx', 'store'], description: 'Optional extension source kind' },
      extensionId: { type: 'string', description: 'Extension ID for remove_extension' },
      profileId: { type: 'string', description: 'Optional target profile ID for list_extensions, install_extension, or remove_extension' },
      profileIds: { type: 'array', items: { type: 'string' }, description: 'Target profile IDs for install_extension or mirror_start' },
      sourceProfileId: { type: 'string', description: 'Master profile ID for mirror_start' },
      targetProfileIds: { type: 'array', items: { type: 'string' }, description: 'Follower profile IDs for mirror_start' },
      typing: { type: 'boolean', description: 'Broadcast keyboard typing during mirror_start' },
      confirm: { type: 'boolean', description: 'Must be true when action=remove_extension' },
    }),
    output: jsonOut,
    execute: (args) => safeTool((a) => dispatcher.manageExtensionsAndMirror(a), args),
  })

  ctx.tools.register({
    name: 'pibrowse_team_sync',
    description:
      'Inspect self-hosted Team Server status, projects, profiles, members, and audit logs; acquire distributed locks to launch or stop synced profiles; upload local profiles; or disconnect (confirm: true).',
    parameters: objectParams({
      action: {
        type: 'string',
        required: true,
        enum: [
          'status',
          'probe',
          'list_projects',
          'create_project',
          'list_profiles',
          'list_members',
          'launch_profile',
          'stop_profile',
          'share_local_profile',
          'audit_logs',
          'disconnect',
        ],
        description: 'Team Server E2E sync action',
      },
      serverUrl: { type: 'string', description: 'Team Server base URL when action=probe' },
      projectId: { type: 'string', description: 'Team project ID filter or upload target' },
      profileId: { type: 'string', description: 'Team profile ID for launch_profile, stop_profile, or audit_logs' },
      localProfileId: { type: 'string', description: 'Local profile ID when action=share_local_profile' },
      name: { type: 'string', description: 'Project or uploaded profile name' },
      description: { type: 'string', description: 'Optional project description for create_project' },
      force: { type: 'boolean', description: 'Force takeover of an existing distributed lock on launch_profile' },
      cdp: { type: 'boolean', description: 'Enable CDP port when launching a synced profile' },
      limit: { type: 'number', description: 'Audit log page size (1-200)' },
      confirm: { type: 'boolean', description: 'Must be true when action=disconnect' },
    }),
    output: jsonOut,
    execute: (args) => safeTool((a) => dispatcher.manageTeamSync(a), args),
  })

  return {
    paths,
    configStore,
    ipcClient,
    installer,
    sidecar,
    mcpBridge,
    teamClient,
    dispatcher,
  }
}
