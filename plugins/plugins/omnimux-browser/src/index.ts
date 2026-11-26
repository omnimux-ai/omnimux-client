/**
 * `@yuxianglin/dsh-bridge-browser`: token-authenticated WebSocket bridge for
 * the browser extension plus the text-only `browser_*` tool set.
 *
 * The bridge mounts its own upgrade route (`/ext/bridge`) on the host
 * webserver, OUTSIDE the /api trust fence — so it brings its own bearer-token
 * authentication (first frame `hello` within HELLO_TIMEOUT_MS). Extension
 * calls, Session streams, and Host waterfalls use the Typert Gateway
 * wireStream and Connection services (dsh ≥0.2.1-rc.3 contract).
 * Tools execute by dispatching
 * `tool.call` frames to the connected extension, which performs the action in
 * the tab explicitly controlled by the user.
 *
 * Opt-in by design: nothing is registered unless this plugin appears in the
 * composition. No dsh core code is touched.
 *
 * @module @yuxianglin/dsh-bridge-browser
 */

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-attachment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { BridgeServer, isLoopbackAddress } from './server.ts'
import { BrowserContextInjector } from './browser-context.ts'
import { DRAFT_FORMAT_INSTRUCTIONS } from './draft.ts'
import { createBrowserToolRegistrar } from './tools.ts'
import {
  BRIDGE_CONFIG_PATH,
  BRIDGE_PATH,
  DEFAULT_SNAPSHOT_MAX_CHARS,
  MIN_SNAPSHOT_MAX_CHARS,
  type BridgeConfig,
  type TextGenerationRequest,
} from './protocol.ts'
import { createPairingRoutes } from './pairing-routes.ts'
import {
  flattenModelCandidates,
  normalizeMode,
  withAutoModelRouting,
  type AutoModelEvaluate,
  type SubscriptionModelGroup,
} from './auto-model.ts'
import { createSessionDeferral } from './session-deferral.ts'
import { bindTextSessionModel } from './text-session-model.ts'
import { withSessionWorkspace } from './session-workspace.ts'
import { purgeSessionFiles, type SessionPurgeDeps } from './session-purge.ts'
import { resolveToken } from './token.ts'
import {
  createRemoteHostApi,
  type BrowserHostConnection,
  type BrowserHostGateway,
} from './remote-host-api.ts'
import { createProducedRegistry, type ProducedRegistry } from './produced-registry.ts'
import { createImageAssetSaveDeps, saveImageAsset } from './image-assets.ts'
import { isRecord, type BrowserHostApi } from './host-api.ts'
import { appendCopilotLog } from './copilot-log.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'bridge-browser'

/** Services required by this plugin. */
export const inject = ['webServer', 'typertGateway', 'connection', 'tools', 'agents', 'llm']

/** Default per-tool-call budget (ms). */
const DEFAULT_TOOL_TIMEOUT_MS = 90_000

/** Default cap on interactive inventory items per snapshot. */
const DEFAULT_MAX_INTERACTIVE_ITEMS = 60

/** Default directory backing the browser extension's session group. */
const DEFAULT_SESSION_WORKSPACE_PATH = dshHomePath('browser-sessions')

/** Durable session storage root written by the JSONL persistence plugin. */
const SESSIONS_ROOT = dshHomePath('sessions')

/** Default: sessions materialize only on the first message (open-and-close leaves no trace). */
const DEFAULT_DEFER_SESSION_CREATE = true

/**
 * Release-channel identity published on the zero-config discovery endpoint.
 *
 * The desktop launcher sets `OMNIMUX_CHANNEL` / `OMNIMUX_DEV` before the Host
 * boots; a plain `dsh web` keeps the Prod identity. The extension prefers these
 * fields over its port table because 44120 may be either channel.
 */
export function bridgeInstanceIdentity(env: NodeJS.ProcessEnv = process.env): Pick<BridgeConfig, 'channel' | 'name'> {
  const channel = (env.OMNIMUX_CHANNEL ?? '').trim().toLowerCase()
  const dev = channel === 'dev' || env.OMNIMUX_DEV === '1'
  return dev
    ? { channel: 'dev', name: 'OmniMux Dev' }
    : { channel: 'prod', name: 'OmniMux Prod' }
}

/** Plugin config: deployment-varying tunables only; the wire contract stays fixed. */
export interface Config {
  /** Fixed bearer token. When absent, a token is generated on first boot and persisted under the dsh home (0600). */
  token?: string
  /** Per-tool-call timeout in ms. Defaults to 90000. */
  toolTimeoutMs?: number
  /** Upper bound on one snapshot's rendered characters. Defaults to 32000; minimum 500. */
  snapshotMaxChars?: number
  /** Upper bound on interactive inventory items per snapshot. Defaults to 60. */
  maxInteractiveItems?: number
  /** Dedicated workspace path for extension-created sessions. Empty disables grouping. */
  sessionWorkspacePath?: string
  /** Defer real session creation until the first prompt. Defaults to true. */
  deferSessionCreate?: boolean
}

export const Config: z<Config> = z.object({
  token: z.string(),
  toolTimeoutMs: z.number().step(1).min(1).default(DEFAULT_TOOL_TIMEOUT_MS),
  snapshotMaxChars: z.number().step(1).min(MIN_SNAPSHOT_MAX_CHARS).default(DEFAULT_SNAPSHOT_MAX_CHARS),
  maxInteractiveItems: z.number().step(1).min(1).default(DEFAULT_MAX_INTERACTIVE_ITEMS),
  sessionWorkspacePath: z.string().default(DEFAULT_SESSION_WORKSPACE_PATH),
  deferSessionCreate: z.boolean().default(DEFAULT_DEFER_SESSION_CREATE),
})

/** The shape after schemastery applies its defaults to every field. */
type ResolvedConfig = Required<Omit<Config, 'token'>> & Pick<Config, 'token'>

/** Configured budgets must be positive integers. Exported for validation tests. */
export function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`bridge-browser: ${name} must be a positive integer`)
  }
}

/**
 * Apply defaults and direct-call validation at the plugin boundary.
 * @param config - Loader-resolved or directly supplied plugin configuration.
 * @returns a complete configuration ready for runtime use.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    ...(config.token === undefined ? {} : { token: config.token }),
    toolTimeoutMs: config.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
    snapshotMaxChars: config.snapshotMaxChars ?? DEFAULT_SNAPSHOT_MAX_CHARS,
    maxInteractiveItems: config.maxInteractiveItems ?? DEFAULT_MAX_INTERACTIVE_ITEMS,
    sessionWorkspacePath: config.sessionWorkspacePath ?? DEFAULT_SESSION_WORKSPACE_PATH,
    deferSessionCreate: config.deferSessionCreate ?? DEFAULT_DEFER_SESSION_CREATE,
  }
  assertPositiveInteger('toolTimeoutMs', resolved.toolTimeoutMs)
  assertPositiveInteger('snapshotMaxChars', resolved.snapshotMaxChars)
  if (resolved.snapshotMaxChars < MIN_SNAPSHOT_MAX_CHARS) {
    throw new Error(`bridge-browser: snapshotMaxChars must be at least ${MIN_SNAPSHOT_MAX_CHARS}`)
  }
  assertPositiveInteger('maxInteractiveItems', resolved.maxInteractiveItems)
  return resolved
}


/**
 * Sessions whose model the panel pinned for one-shot text generation
 * (Issue #3629). Process-level state, like the composer model mode: a pin lives
 * only as long as the mount that recorded it and never touches durable storage.
 */
export interface TextGenerationPinRegistry {
  /** Whether `sessionId` currently carries a text-generation pin. */
  isPinned(sessionId: string): boolean
  /** Record one session as pinned; idempotent. */
  pin(sessionId: string, dispose?: () => void): void
  /** Drop one session's pin; unknown ids are ignored. */
  unpin(sessionId: string): void
  clear(): void
}

/**
 * Create an empty pin registry for one bridge mount.
 * @returns a registry the auto router and the purge path share.
 */
export function createTextGenerationPinRegistry(): TextGenerationPinRegistry {
  const pinned = new Map<string, (() => void) | undefined>()
  return {
    isPinned: sessionId => pinned.has(sessionId),
    pin: (sessionId, dispose) => {
      pinned.get(sessionId)?.()
      pinned.set(sessionId, dispose)
    },
    unpin: sessionId => {
      pinned.get(sessionId)?.()
      pinned.delete(sessionId)
    },
    clear: () => {
      for (const dispose of pinned.values()) dispose?.()
      pinned.clear()
    },
  }
}

/** Model selection input one pin performs through the gateway. */
export interface TextGenerationModelSelection {
  readonly sessionId: string
  readonly model: string
  /** Provider of an automatically selected chat model, when known. */
  readonly provider?: string
  readonly reasoningEffort?: string
}

/**
 * Pin one temporary session to an explicit text-generation model.
 *
 * Materialize the Agent before installing its route and registering it with
 * the auto router. The carrier orders the pin before the first prompt.
 * A failed materialization or selection registers nothing.
 *
 * @param deps - on-demand materialization, session-scoped selection and registry.
 * @param request - validated `bridge.textGeneration` payload.
 */
export async function pinTextGenerationSession(
  deps: {
    /**
     * Materialize a session the panel created provisionally. Absent when
     * session deferral is disabled, where the create already persisted.
     */
    materialize?: (sessionId: string) => Promise<void>
    selectModel: (input: TextGenerationRequest) => Promise<void | (() => void)>
    pin: (sessionId: string, dispose?: () => void) => void
  },
  request: TextGenerationRequest,
): Promise<void> {
  await deps.materialize?.(request.sessionId)
  const dispose = await deps.selectModel(request)
  deps.pin(request.sessionId, dispose || undefined)
}

/**
 * Drop one session's pin without ever failing the caller: `purgeSession` must
 * keep its own result even when the registry cannot forget the id. The
 * optional `warn` keeps a broken registry observable instead of silent.
 *
 * @param pins - registry to forget the id in.
 * @param sessionId - session whose pin is being dropped.
 * @param warn - trace sink; omitted in tests that only assert the contract.
 */
export function unpinTextGenerationSession(
  pins: Pick<TextGenerationPinRegistry, 'unpin'>,
  sessionId: string,
  warn?: (message: string) => void,
): void {
  try {
    pins.unpin(sessionId)
  } catch (error: unknown) {
    warn?.(`browser bridge: could not drop the text-generation pin for ${sessionId}: ${String(error)}`)
  }
}


/** Connected-state prompt contribution; kept as a section-shaped constant so the shared draft instructions stay single-sourced. */
const BROWSER_PROMPT_CONNECTED = {
  text: 'A browser extension is connected. To read or operate the user\'s active browser page, call browser_snapshot '
    + '(text-only; numbered items are the click/type targets), unless the current turn already includes a plugin-provided '
    + 'followed-page browser_snapshot. Reuse that injected snapshot and its indices directly. Never assume page content you have not snapshotted.'
    + DRAFT_FORMAT_INSTRUCTIONS,
} as const

/**
 * System-prompt contribution for the browser bridge. Returns an empty string
 * while no extension is connected: the browser tools are not registered in
 * that state, and any prompt that suggests calling them would only produce a
 * guaranteed-failure turn. The text is evaluated per assembly, so a connect or
 * disconnect is reflected on the next model request without re-registering
 * the section.
 *
 * @param connected - whether an authenticated extension is connected.
 * @returns the model-facing browser guidance, or `''` when disconnected.
 */
export function browserBridgePrompt(connected: boolean): string {
  return connected ? BROWSER_PROMPT_CONNECTED.text : ''
}

/**
 * Mount the bridge: resolve the token, register the upgrade route, the tool
 * set, and an optional system-prompt section, all effect-scoped for HMR.
 *
 * @param ctx - Cordis context.
 * @param config - plugin config (schema defaults applied).
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = resolveConfig(config)

  const gateway = ctx.get('typertGateway') as unknown as GatewayCandidate | undefined
  const connection = ctx.get('connection') as unknown as BrowserHostConnection | undefined
  if (gateway === undefined || !hasRemoteWireStream(gateway)) {
    throw new Error('bridge-browser: dsh 0.1.5-rc.2 or a compatible newer runtime is required (Gateway wireStream unavailable)')
  }
  if (typeof connection?.createSharedFetchHandler !== 'function') {
    throw new Error('bridge-browser: dsh connection service is required')
  }
  const tokenRes = await resolveToken(resolved.token)
  // One registry shared by both halves: the Host adapter writes it from the
  // event stream and history, the WebSocket server reads it for
  // `omnimux.producedMedia`. Two instances would silently disagree.
  const produced = createProducedRegistry()
  mountBridge(ctx, resolved, tokenRes, createRemoteHostApi(gateway, connection, produced), produced)
}

function mountBridge(
  ctx: Context,
  resolved: ResolvedConfig,
  tokenRes: Awaited<ReturnType<typeof resolveToken>>,
  hostApi: BrowserHostApi,
  produced: ProducedRegistry,
): void {
  // Process-level composer model mode, pushed by the panel via
  // `bridge.modelMode`. Never persisted; defaults to auto so a fresh host
  // routes prompts through Jev until the panel says otherwise.
  let modelMode = { auto: true }
  const getMode = (): { auto: boolean } => modelMode
  const setModelMode = (mode: { auto: boolean }): void => {
    modelMode = normalizeMode(mode)
  }

  // Issue #3629: text-generation sessions the panel pinned to an explicit
  // model. Shared by the auto router (skip routing) and the purge path (drop).
  const textGenerationPins = createTextGenerationPinRegistry()
  ctx.effect(() => () => textGenerationPins.clear(), 'bridge-browser: temporary text model selections')
  ctx.on('agent/disposed', ({ agent }) => { textGenerationPins.unpin(String(agent.id)) })

  const routerDeps = {
    // Resolved per call: the hub's `decisions` seam may mount after this
    // plugin, and a missing seam must degrade to passthrough, not an error.
    evaluate: (args: Parameters<AutoModelEvaluate>[0], options?: { signal?: AbortSignal }) =>
      ctx.get('decisions')?.evaluate?.(args, options) as ReturnType<AutoModelEvaluate>,
    selectModel: async (input: TextGenerationModelSelection) => {
      const result = await hostApi.call({
        rpcId: crypto.randomUUID(),
        method: 'session.selectModel',
        payload: input,
        signal: new AbortController().signal,
      })
      if (!result.ok) throw new Error(result.error.message)
    },
    candidates: () => flattenModelCandidates(loadSubscriptionModelGroups()),
    getMode,
    isPinned: (sessionId: string) => textGenerationPins.isPinned(sessionId),
    warn: (message: string) => { ctx.logger.warn(message) },
    onRouted: (info: { sessionId: string; model?: string; outcome: 'routed' | 'fallback'; reason?: string }) => {
      ctx.logger.info(
        info.outcome === 'routed'
          ? `browser bridge: auto-routed session ${info.sessionId} to model ${info.model ?? '?'}`
          : `browser bridge: auto-routing fell back for session ${info.sessionId} (${info.reason ?? 'unknown'})`,
      )
    },
  }

  // Auto-model routing wraps the gateway adapter directly; session deferral
  // stays outermost so a provisional session materializes before selectModel
  // runs, and workspace grouping sits between the two. The deferral handle is
  // kept because the explicit text model is bound to a live Agent.
  const workspaceApi = withSessionWorkspace(
    withAutoModelRouting(hostApi, routerDeps),
    resolved.sessionWorkspacePath,
    message => { ctx.logger.warn(message) },
  )
  const deferral = createSessionDeferral(workspaceApi, resolved.deferSessionCreate, ctx.get('attachments')?.imageLimits)
  const api = deferral?.api ?? workspaceApi
  const browserContext = new BrowserContextInjector(ctx.agents)
  // rc.3 dropped `agent/session-start`; `agent/created` is the registry event a
  // new Agent is published through, and its listener contract requires an
  // explicit `undefined` return.
  ctx.on('agent/created', ({ agent }) => {
    browserContext.activate(agent)
    return undefined
  })

  const purgeSession = async (sessionId: string): Promise<void> => {
    const runningSessionIds = new Set<string>()
    try {
      const listed = await api.call({
        rpcId: randomUUID(),
        method: 'session.list',
        payload: {},
        signal: new AbortController().signal,
      })
      if (listed.ok && isRecord(listed.value) && Array.isArray(listed.value.items)) {
        for (const entry of listed.value.items) {
          if (isRecord(entry) && entry.running === true && typeof entry.sessionId === 'string') {
            runningSessionIds.add(entry.sessionId)
          }
        }
      }
    } catch {
      // Listing is advisory; the required exclusive persistence handle below
      // protects both active and idle sessions, including in other processes.
    }
    const deps: SessionPurgeDeps = {
      sessionsRoot: SESSIONS_ROOT,
      runningSessionIds,
      acquireOwnership: async (id) => {
        const persistence = ctx.get('sessionPersistence')
        if (persistence === undefined) {
          throw new Error('browser bridge: session persistence is required to safely purge a session')
        }
        return persistence.open(id as Parameters<typeof persistence.open>[0], 'write')
      },
      archiveSession: async (id) => {
        const archived = await api.call({
          rpcId: randomUUID(),
          method: 'workspace.archiveSession',
          payload: { sessionId: id },
          signal: new AbortController().signal,
        })
        if (!archived.ok) throw new Error(archived.error.message)
      },
    }
    await purgeSessionFiles(deps, sessionId)
    unpinTextGenerationSession(textGenerationPins, sessionId, message => { ctx.logger.warn(message) })
  }

  function getDshHostLocale(): 'zh' | 'en' {
    try {
      const candidates = [
        process.env.DSH_HOME ? join(process.env.DSH_HOME, 'settings.yaml') : '',
        join(homedir(), '.dsh', 'settings.yaml'),
      ].filter(Boolean)
      for (const p of candidates) {
        if (existsSync(p)) {
          const text = readFileSync(p, 'utf8')
          const m = /locale:\s*\n\s*preference:\s*["']?(zh|en)["']?/i.exec(text)
          if (m?.[1]) {
            return m[1].toLowerCase() as 'zh' | 'en'
          }
        }
      }
    } catch {}
    return 'zh'
  }

  const hostLocale = getDshHostLocale()

  // Issue #3052: the image-asset save reuses the host's own seams — the
  // attachments validateImage for real raster decoding, and the assets
  // plugin's `assetLibrary` service for the one live LibraryStore. All of
  // them resolve per call so a plugin mounting after the bridge can still
  // serve (Q5); when either is absent the RPC answers `unavailable`, never
  // a degraded check and never a second store.
  const imageSaveDeps = createImageAssetSaveDeps(ctx)

  const server = new BridgeServer({
    token: tokenRes.token,
    api,
    toolTimeoutMs: resolved.toolTimeoutMs,
    caps: {
      textOnly: true,
      snapshotMaxChars: resolved.snapshotMaxChars,
      maxInteractiveItems: resolved.maxInteractiveItems,
      locale: hostLocale,
      imageAssetSave: true,
    },
    injectBrowserSnapshot: (sessionId, snapshot) => { browserContext.inject(sessionId, snapshot) },
    purgeSession,
    pinTextGeneration: request => pinTextGenerationSession(
      {
        // Undefined when deferral is off: the create already persisted.
        ...(deferral === undefined ? {} : { materialize: deferral.materialize }),
        selectModel: input => bindTextSessionModel(ctx, input),
        pin: textGenerationPins.pin,
      },
      request,
    ),
    produced,
    saveImageAsset: (request, { signal }) => saveImageAsset(request, imageSaveDeps, signal),
    completeText: async (request) => {
      const service = ctx.get('textComplete') as { execute?: (input: typeof request) => Promise<unknown> } | undefined
      if (typeof service?.execute !== 'function') throw new Error('Text completion service unavailable')
      return service.execute(request)
    },
    evaluateDecision: async (args, { signal }) => {
      const decisions = ctx.get('decisions') as { evaluate?: AutoModelEvaluate } | undefined
      if (typeof decisions?.evaluate !== 'function') throw new Error('Decision service unavailable')
      return decisions.evaluate(args, { signal })
    },
    appendCopilotLog: (entry) => appendCopilotLog(entry),
    setModelMode,
  })

  const route: WebUpgradeRoute & { auth: 'anonymous' } = {
    path: BRIDGE_PATH,
    auth: 'anonymous',
    handler: (req, socket, head) => { server.handleUpgrade(req, socket, head) },
  }
  ctx.effect(() => ctx.webServer.registerUpgrade(route), 'bridge-browser: /ext/bridge upgrade route')
  // 异步 disposer：HMR/卸载时先等桥完全关闭（socket/泵/acceptor 静默）再继续。
  ctx.effect(() => () => server.close(), 'bridge-browser: bridge server')

  // Zero-config discovery endpoint: the extension fetches this to learn the
  // bridge WebSocket URL without any manual configuration. The URL carries no
  // secret (loopback connections skip the token); non-loopback deployments
  // keep requiring the token on the WS itself.
  const configRoute: WebRoute & { auth: 'anonymous' } = {
    kind: 'exact',
    path: BRIDGE_CONFIG_PATH,
    auth: 'anonymous',
    handler: (req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': '*',
        'access-control-allow-private-network': 'true',
        'cache-control': 'no-store, no-cache, must-revalidate',
      })
      if (req.method === 'OPTIONS') {
        res.end()
        return
      }
      res.end(JSON.stringify({
        ...bridgeInstanceIdentity(),
        wsUrl: `ws://127.0.0.1:${ctx.webServer.port}${BRIDGE_PATH}`,
        locale: hostLocale,
        modelGroups: loadSubscriptionModelGroups(),
      } satisfies BridgeConfig))
    },
  }
  ctx.effect(() => ctx.webServer.register(configRoute), 'bridge-browser: /ext/bridge-config route')

  // Pairing: the host's own page approves a pending request, and the extension
  // picks the token up from a loopback poll. Admission rules live in pairing.ts.
  for (const route of createPairingRoutes({
    // rc.3 types the getter as `number | undefined` (the server may not be
    // listening yet). A pairing route only runs while a request is in flight,
    // so an unknown port here is a real fault and must fail loudly rather than
    // compare an origin against a placeholder port.
    port: () => {
      const port = ctx.webServer.port
      if (port === undefined) {
        throw new Error('bridge-browser: host webserver port is unknown while serving a pairing route')
      }
      return port
    },
    token: () => tokenRes.token,
    isLoopback: isLoopbackAddress,
    authorizeHost: (req, peer) => {
      if (peer !== undefined) return undefined
      const conn = (ctx.connection ?? ctx.get?.('connection')) as {
        requestRejection?: (request: unknown) => number | undefined
      } | undefined
      if (typeof conn?.requestRejection !== 'function') return 503
      try {
        const rejection = conn.requestRejection(req)
        if (rejection === undefined) return undefined
        return typeof rejection === 'number' && Number.isInteger(rejection) && rejection >= 400 && rejection <= 599
          ? (rejection as 401 | 403 | 503)
          : 403
      } catch {
        return 503
      }
    },
  })) {
    ctx.effect(() => ctx.webServer.register(route as unknown as WebRoute), `bridge-browser: ${route.path} route`)
  }


  const browserTools = createBrowserToolRegistrar(ctx, server, {
    toolTimeoutMs: resolved.toolTimeoutMs,
    snapshotMaxChars: resolved.snapshotMaxChars,
    maxInteractiveItems: resolved.maxInteractiveItems,
  })
  const syncBrowserTools = (connected: boolean): void => { browserTools.sync(connected) }
  const stopBrowserToolSync = server.onConnectionChange(syncBrowserTools)
  syncBrowserTools(server.hasConnection())
  ctx.effect(() => () => {
    stopBrowserToolSync()
    browserTools.dispose()
  }, 'bridge-browser: browser tools')

  // Optional system-prompt contribution: a one-line hint only — the model is
  // told to fetch snapshots on demand instead of hoarding page text. The text
  // is a provider evaluated per assembly so it follows the live connection
  // state; when disconnected it renders empty and the tools above are absent.
  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt !== undefined) {
    ctx.effect(() => systemPrompt.section({
      name: 'tool:bridge-browser',
      order: 107,
      text: () => browserBridgePrompt(server.hasConnection()),
    }), 'bridge-browser: system prompt section')
  }

  ctx.logger.info(
    tokenRes.generated
      ? `browser bridge: new token generated and persisted at ${tokenRes.file} (chmod 0600); connect the extension and paste it in its settings`
      : `browser bridge: using token from ${tokenRes.file}`,
  )
  ctx.logger.info(`browser bridge: listening on ${BRIDGE_PATH}`)
}

/**
 * Load the host's subscription model groups (`~/.dsh/plugins/subscriptions/
 * models.json` and its documented fallback homes). Exported at module scope
 * so the routing candidate list and the discovery endpoint share one source.
 * @returns subscription groups, or an empty list when none are readable.
 */
/** Cache for {@link loadSubscriptionModelGroups}: the routing path calls this
 * on every auto-mode prompt, so the file is only re-read after `TTL_MS`. */
const SUBSCRIPTION_MODELS_CACHE_TTL_MS = 30_000
let subscriptionModelsCache: { readonly at: number; readonly groups: SubscriptionModelGroup[] } | null = null

export function loadSubscriptionModelGroups(): SubscriptionModelGroup[] {
  const now = Date.now()
  if (subscriptionModelsCache !== null && now - subscriptionModelsCache.at < SUBSCRIPTION_MODELS_CACHE_TTL_MS) {
    return subscriptionModelsCache.groups
  }
  const groups = readSubscriptionModelGroups()
  subscriptionModelsCache = { at: now, groups }
  return groups
}

function readSubscriptionModelGroups(): SubscriptionModelGroup[] {
  const candidateHomes = [
    dshHomePath(),
    process.env.DSH_HOME,
    join(homedir(), '.dsh'),
    join(homedir(), '.omnimux'),
  ].filter(Boolean) as string[]

  for (const home of candidateHomes) {
    const modelsPath = join(home, 'plugins', 'subscriptions', 'models.json')
    try {
      if (existsSync(modelsPath)) {
        const raw = JSON.parse(readFileSync(modelsPath, 'utf8')) as {
          codex?: { models?: Array<{ id: string; name?: string; reasoning?: unknown }> }
          grok?: { models?: Array<{ id: string; name?: string; reasoning?: unknown }> }
        }
        const groups: SubscriptionModelGroup[] = []

        if (Array.isArray(raw.codex?.models) && raw.codex.models.length > 0) {
          groups.push({
            group: 'ChatGPT (Codex)',
            models: raw.codex.models.map(m => ({
              id: m.id,
              name: m.name || m.id,
              reasoning: m.reasoning,
            })),
          })
        }

        if (Array.isArray(raw.grok?.models) && raw.grok.models.length > 0) {
          groups.push({
            group: 'Grok (Subscription)',
            models: raw.grok.models.map(m => ({
              id: m.id,
              name: m.name || m.id,
              reasoning: m.reasoning,
            })),
          })
        }

        if (groups.length > 0) return groups
      }
    } catch {
      // Ignore
    }
  }
  return []
}

type GatewayCandidate = Pick<BrowserHostGateway, 'invoke'> & {
  readonly wireStream?: BrowserHostGateway['wireStream']
}

/** Check the minimum supported Gateway contract before mounting the bridge. */
function hasRemoteWireStream(gateway: GatewayCandidate): gateway is BrowserHostGateway {
  return gateway.wireStream !== undefined
    && typeof gateway.wireStream.open === 'function'
    && typeof gateway.wireStream.failure === 'function'
}
