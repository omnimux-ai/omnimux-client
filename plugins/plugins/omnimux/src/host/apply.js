import { createHubEventBus } from '../events/hub-event-bus.js'
import { registerHubEventStream } from '../events/stream.js'
import { createWorkbenchMailbox } from '../workbench/mailbox.js'
import { registerWorkbenchHttpRoutes } from '../workbench/http-routes.js'
import { mountWorkbenchTools } from '../workbench/tools.js'
import { mountWorkbenchContextInjector } from '../workbench/context-injector.js'
import { mountCanvasGenerationEvents } from '../workbench/generation-events.js'
import { mountSurfaceFollow } from '../workbench/surface-follow.js'
import { mountCommentInjector } from '../workbench/comment-injector.js'
import { mountContractsPrompt } from '../agents/contracts-loader.js'
import { executeOmnimuxAudio } from '../media/audio.js'
import { executeOmnimuxImage } from '../media/image.js'
import { executeOmnimuxVideo } from '../media/video.js'
import { DEFAULT_MEDIA } from '../media/route.js'
import { CLIENT_NAME, DEFAULT_SITE, resolveSiteBaseUrl } from '../auth/omnimux-auth.js'
import { createAppsStore } from '../apps/store.js'
import { createTabsStore } from '../apps/tabs.js'
import { createIdentity } from '../auth/identity.js'
import { createAccountModelKeyService } from '../auth/model-key.js'
import { createTokenStore } from '../auth/store.js'
import { parseHubConfig } from '../config.js'
import { createAccountAvatarStore } from '../official/account-avatar.js'
import { createAccountMetaStore } from '../official/account-meta.js'
import { mountOfficial } from '../official/mount.js'
import { mountReader } from '../reader/mount.js'
import { createAvatarStore } from '../avatar/store.js'
import { JSON_TOOL_OUTPUT, objectParams, rethrow } from '../tools/schema.js'
import { mountMedia } from '../media/mount.js'
import { createMediaInspector } from '../media/inspect.js'
import { createSessionModelPreference } from '../session/model-preference.js'
import { registerSessionModelRoutes } from '../session/http.js'
import { registerDirectMediaRoutes } from '../media/direct-http.js'
import { mountSessionModelInjector } from '../session/context-injector.js'
import { mountSpeechToText } from '../media/stt-mount.js'
import { mountAudioVoices } from '../media/voices-mount.js'
import { executeOmnimuxSpeechToText } from '../media/stt.js'
import { mountTextComplete } from '../text/mount.js'
import { mountHeadlessSkill } from '../headless/mount.js'
import { buildModelCatalog } from '../catalog/list.js'
import { createAccountCatalog } from '../catalog/cloud/account-view.js'
import { setCurrentSnapshotResolver } from '../catalog/cloud/current.js'
import { resolvePricingUrl } from '../catalog/cloud/config.js'
import { createCatalogDiagnostics } from '../catalog/cloud/diagnostics.js'
import { createGenerationProducts } from '../catalog/generation-products.js'
import { createGenerationMapping } from '../media/generation-mapping.js'
import { listSessionModels } from '../catalog/session-models.js'
import { createComposerListSync, PI_AI_NAMESPACE } from '../catalog/composer-sync.js'
import { reconcileSubscriptionRoutes } from '../agents/llm-route-sync.js'
import { SettingsConfig } from '../settings/schema.js'
import { readScenarioSettings } from '../settings/runtime-mode.js'
import { mountHubHttp } from './http.js'
import { mountComposerCommands } from './composer-commands.js'
import { createProducedAttachmentService } from './produced-attachments.js'
import { join } from 'node:path'
import { hubHomeDir, hubProfileName } from './paths.js'
import { mountWebSocketHmr } from '../hmr/host.js'
import { mountPresetsTools } from '../presets/tools.js'
import { mountTemplatesTools } from '../templates/tools.js'
import { mountDecisions } from '../decisions/mount.js'
import { createNativeFilePicker } from './native-picker.js'
import { createMediaResolver } from './media-resolver.js'
import { mountRetiredPresetRedirect } from './retired-presets.js'
import { reclaimLegacyManagedPluginSkills } from './legacy-skill-reclaim.js'

/**
 * How often the process checks whether the gateway snapshot is due. The TTL
 * decides whether a check actually fetches, so this only bounds reaction time.
 */
const CATALOG_REFRESH_TICK_MS = 60 * 60 * 1000

/**
 * @param {{
 *   tools: { register: (tool: object) => unknown },
 *   jobs?: { start: (spec: object) => string },
 *   provide?: (name: string, value: unknown) => void,
 *   get?: (name: string) => unknown,
 *   effect?: (factory: () => () => void, label?: string) => void,
 *   inject?: (deps: string[], callback: (inner: object) => void) => void,
 * }} ctx
 * @param {{ siteBaseUrl?: string, clientName?: string, productName?: string, logoSvg?: string, wordmarkText?: string, replaceHeroMark?: boolean, hidePreviewBadge?: boolean, rewriteWelcome?: boolean, heroHeadline?: string, heroHeadlineFit?: boolean, heroHeadlineMaxPx?: number, heroHeadlineMinPx?: number, media?: unknown }} [config]
 */
export function apply(ctx, config = {}) {
  const hub = parseHubConfig(config)
  const readReferenceStorageConfig = () => config.referenceStorage?.get ? config.referenceStorage.get() : config.referenceStorage
  const siteBaseUrl = resolveSiteBaseUrl(config.siteBaseUrl || process.env.OMNIMUX_SITE_URL || DEFAULT_SITE)
  const clientName = config.clientName || CLIENT_NAME
  const brand = hub
  const homeDir = hubHomeDir()
  const store = createTokenStore({
    credentials: ctx.get?.('credentials'),
    homeDir,
  })
  const identity = createIdentity({ store, siteBaseUrl })
  const modelKeys = createAccountModelKeyService({ store, identity, siteBaseUrl,
    catalogGatewayBaseUrl: siteBaseUrl === DEFAULT_SITE ? DEFAULT_MEDIA.providers.omnimux.baseUrl : siteBaseUrl,
    getCredentials: () => ctx.get?.('credentials') })
  ctx.provide('identity', { status: identity.status, require: identity.require, getSnapshot: identity.getSnapshot })
  const profile = hubProfileName()
  const appsStore = createAppsStore({
    home: homeDir,
    profile,
    apps: hub.apps,
    siteBaseUrl,
  })
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => appsStore.dispose(), 'omnimux: apps catalog')
  }
  appsStore.maybeRefresh()
  const hubEvents = createHubEventBus()
  // Gateway snapshot (P1a, now the catalog's authority since P1b): resolved for
  // diagnostics, for membership/lines/prices, and shared with every catalog
  // consumer through the current-snapshot seam below.
  // Set once the settings surface is ready; lets a manual catalog refresh
  // rewrite the composer provider list without waiting for another startup.
  let syncComposerListAfterCatalogRefresh = null;
  const accountCatalog = createAccountCatalog({
    home: homeDir,
    bundledDir: hub.catalog.bundledDir || undefined,
    identity,
    store,
    resolveCatalogKey: modelKeys.resolveCatalogKey,
    remote: hub.catalog.remote,
    siteBaseUrl,
    url: resolvePricingUrl(hub.catalog, siteBaseUrl),
    ttlSeconds: hub.catalog.ttlSeconds,
    timeoutMs: hub.catalog.timeoutMs,
    onChanged: () => {
      // The event carries invalidation only. Each consumer reloads its current
      // authorized catalog through the existing HTTP route.
      hubEvents.emit({ type: 'omnimux:model-catalog-updated' })
      ctx.emit?.('omnimux/model-catalog-updated')
      syncComposerListAfterCatalogRefresh?.()
    },
    onError: (error) => {
      console.error('[omnimux] gateway catalog refresh failed:', String(error?.message ?? error))
    },
  })
  setCurrentSnapshotResolver(accountCatalog.resolve)

  let catalogTimer
  const kickCatalogRefresh = () => {
    accountCatalog.maybeRefresh().catch((error) => {
      console.error('[omnimux] gateway catalog refresh failed:', String(error?.message ?? error))
    })
  }
  if (hub.catalog.remote) {
    kickCatalogRefresh()
    catalogTimer = setInterval(kickCatalogRefresh, CATALOG_REFRESH_TICK_MS)
    catalogTimer.unref?.()
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      if (catalogTimer) clearInterval(catalogTimer)
      setCurrentSnapshotResolver(null)
    }, 'omnimux: gateway catalog')
  }
  const avatarStore = createAvatarStore({ home: homeDir })
  const accountMetaStore = createAccountMetaStore({ home: homeDir })
  const accountAvatarStore = createAccountAvatarStore({
    home: homeDir,
    config: hub.official.accountAvatars,
  })
  const tabsStore = createTabsStore({ home: homeDir })

  // Initialize the Workbench mailbox using the shared in-process event bus.
  const mailbox = createWorkbenchMailbox({ hubEvents })
  ctx.provide?.('hubEvents', hubEvents)
  // Vertical tools (workflow_*) may read last-known viewport for default workspace targeting.
  // Read-only seam: getActiveView only — no open/RPC.
  ctx.provide?.('workbenchMailbox', {
    getActiveView: (sessionId) => mailbox.getActiveView(sessionId),
  })

  // Live snapshot of registered ctx.llm models so catalog-backed routes without
  // an explicit `models` array in settings (e.g. openai-codex, anthropic) also
  // surface in the synchronous `listCatalog().tools` picker.
  /** @type {Array<{ providerId: string, providerName: string, models: Array<{ id: string, name?: string, inputModalities?: string[] }> }>} */
  let liveLlmModelSnapshot = []
  let liveLlmSnapshotGen = 0
  const refreshLiveLlmSnapshot = async () => {
    const llm = typeof ctx.get === 'function' ? ctx.get('llm') : undefined
    if (!llm || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') return
    const gen = ++liveLlmSnapshotGen
    try {
      const providers = llm.listProviders()
      const groups = await Promise.all((Array.isArray(providers) ? providers : []).map(async (entry) => {
        if (!entry || typeof entry.id !== 'string' || !entry.id.trim()) return null
        try {
          const models = await llm.listModels(entry.id)
          if (!Array.isArray(models) || models.length === 0) return null
          return {
            providerId: entry.id,
            providerName: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : entry.id,
            models,
          }
        } catch (error) {
          console.warn('[omnimux] live llm listModels failed:', entry.id, error instanceof Error ? error.message : String(error))
          return null
        }
      }))
      if (gen === liveLlmSnapshotGen) {
        liveLlmModelSnapshot = groups.filter(Boolean)
      }
    } catch (error) {
      console.warn('[omnimux] live llm snapshot refresh failed:', error instanceof Error ? error.message : String(error))
    }
  }

  const listCatalog = () => {
    const currentCatalogView = accountCatalog.resolve()
    const settingsService = typeof ctx.get === 'function' ? ctx.get('settings') : undefined
    const settingsDefaults = settingsService && typeof settingsService.get === 'function'
      ? settingsService.get('omnimux')
      : undefined
    return {
      ...buildModelCatalog({
        text: hub.text,
        media: hub.media,
        gate: hub.gate,
        env: process.env,
        settingsDefaults,
        // P1b: the runtime catalog follows the refreshed gateway view, so the
        // composer, the canvas and the submit guard all read one snapshot.
        snapshot: currentCatalogView.snapshot,
        snapshotSource: currentCatalogView.source,
        snapshotDigest: currentCatalogView.digest,
      }),
      // Session-reachable provider:model pairs for the tool-model picker.
      tools: listSessionModels(settingsService, liveLlmModelSnapshot),
    }
  }

  const catalogDiagnostics = createCatalogDiagnostics({
    live: { resolve: accountCatalog.diagnosticsView },
    refresher: accountCatalog,
    listCatalog,
  })

  const generationProducts = createGenerationProducts({ readMapping: createGenerationMapping(hub.media) })
  const httpDeps = {
    products: generationProducts,
    store,
    identity,
    modelKeys,
    siteBaseUrl,
    clientName,
    hub,
    brand,
    homeDir,
    profile,
    appsStore,
    tabsStore,
    accountMetaStore,
    accountAvatarStore,
    avatarStore,
    listCatalog,
    accountCatalogScoped: accountCatalog.isAccountScoped,
    onIdentityChanged: () => { accountCatalog.resolve() },
    catalogDiagnostics,
    refreshCatalog: async () => {
      const result = await accountCatalog.refreshOnce(true)
      syncComposerListAfterCatalogRefresh?.()
      return result
    },
    hubEvents,
    mailbox,
    sessionQuery: null,
    getWorkspaceRegistry: () => ctx.get?.('workspaceRegistry'),
    getConnection: () => ctx.get?.('connection'),
    getConfigEditor: () => ctx.get?.('configEditor') ?? ctx.get?.('settings')?.ownerContext?.configEditor,
    getAuthorization: () => ctx.get?.('authorization'),
    getLlm: () => ctx.get?.('llm'),
    getAgentDefaultModel: () => ctx.get?.('agentDefaultModel'),
    refreshLiveLlmSnapshot,
    settings: ctx.get?.('settings'),
    readReferenceStorageConfig,
    credentials: ctx.get?.('credentials'),
  }
  ctx.provide?.('composerAttachments', createProducedAttachmentService({
    getSessionQuery: () => httpDeps.sessionQuery ?? ctx.get?.('sessionQuery'),
    receiptRoot: join(homeDir, 'omnimux', 'composer-attachments', 'handoffs'),
  }))
  mountComposerCommands(ctx)
  // Session model pin: the composer's picker writes it here, the agent is told
  // about it each turn, and the media tools fall back to it when `model` is
  // omitted. Owned by the hub so both readers share one authority.
  const sessionModelPreference = createSessionModelPreference()
  const mountHttp = (httpCtx) => mountHubHttp(httpCtx, httpDeps)
  if (typeof ctx.inject === 'function') {
    ctx.inject(['clientModules', 'webServer', 'loader', 'connection'], async hmrCtx => {
      const { apply: applyWatcher } = await hmrCtx.loader.import('@deepseek-ai/dsh-client-hmr')
      mountWebSocketHmr(hmrCtx, hubEvents, applyWatcher)
    })
    ctx.inject(['webServer'], (httpCtx) => {
      mountHttp(httpCtx)
      const server = httpCtx.webServer ?? httpCtx.get?.('webServer')
      if (server && typeof server.register === 'function') {
        httpCtx.effect(() => registerWorkbenchHttpRoutes(server, {
          mailbox,
          hubEvents,
          getConnection: () => ctx.get?.('connection'),
          async verifySession(id) {
            const query = httpDeps.sessionQuery ?? ctx.get?.('sessionQuery')
            let observation
            try {
              observation = await query?.observeSession?.(id, { projectionMode: 'none' })
              return Boolean(observation?.header)
            } catch {
              return false
            } finally {
              observation?.[Symbol.dispose]?.()
            }
          },
        }), 'omnimux: workbench HTTP')
        httpCtx.effect(() => registerSessionModelRoutes(server, { preference: sessionModelPreference }), 'omnimux: session model HTTP')
        httpCtx.effect(() => registerDirectMediaRoutes(server, {
          executeImage: (req) => executeOmnimuxImage({ ...req, media: hub.media, store, credentials: ctx.get?.('credentials'), runtimeSettings: Object.assign({}, readScenarioSettings(ctx.get?.('settings')), { referenceStorage: readReferenceStorageConfig() }) }),
          executeVideo: (req) => executeOmnimuxVideo({ ...req, media: hub.media, store, credentials: ctx.get?.('credentials'), runtimeSettings: Object.assign({}, readScenarioSettings(ctx.get?.('settings')), { referenceStorage: readReferenceStorageConfig() }) }),
          getRuntimeSettings: () => Object.assign({}, readScenarioSettings(ctx.get?.('settings')), { referenceStorage: readReferenceStorageConfig() }),
          media: hub.media,
          getConnection: () => ctx.get?.('connection'),
          gate: hub.gate,
        }), 'omnimux: direct media generate HTTP')
      }
    })
    ctx.inject(['webServer', 'connection'], (streamCtx) => {
      streamCtx.effect(() => registerHubEventStream(streamCtx.webServer, {
        hubEvents,
        connection: streamCtx.connection,
      }), 'omnimux: hub event stream')
    })
    ctx.inject(['sessionQuery'], (inner) => {
      httpDeps.sessionQuery = inner.sessionQuery ?? inner.get?.('sessionQuery') ?? null
    })
  } else {
    mountHttp(ctx)
  }

  // settings 服务仅在组合了 profileContext 时存在；桌面宿主没有它。改为按需取用，
  // 缺席时跳过 BYOK 命名空间注册，不阻塞激活。
  const omnimuxSettingsService = typeof ctx.get === 'function' ? ctx.get('settings') : undefined
  if (omnimuxSettingsService && typeof omnimuxSettingsService.register === 'function') {
    const settings = omnimuxSettingsService
      httpDeps.settings = settings
      if (!settings || typeof settings.register !== 'function') return
      // The settings service arrives after httpDeps is built; hand it to the
      // HTTP faces (BYOK / agent routes) only once it actually exists.
      httpDeps.settings = settings
      const scope = settings.register('omnimux', SettingsConfig, {
        base: {
          defaultTextModel: '',
          defaultImageModel: '',
          defaultVideoModel: '',
          defaultAudioModel: '',
        },
      })
      // The composer's text-model list is a settings surface of the pi-ai
      // provider route. Keep it in step with the hub: the hub decides which
      // models are in play, the shipped profile describes them, and the
      // visibility field below can only subtract from that set.
      const logComposerSync = (event, detail) => {
        try {
          ctx.logger?.info?.(`omnimux: ${event}`, detail ?? {})
        } catch {
          /* logging must never break the sync */
        }
      }
      const configEditor = (typeof ctx.get === 'function' ? ctx.get('configEditor') : undefined)
        ?? settings.ownerContext?.configEditor
      const composerSync = createComposerListSync({ settings, configEditor, log: logComposerSync })
      if (!configEditor) logComposerSync('composer-list-config-editor-missing')
      /**
       * The stored OmniMux settings. `register()` hands back a scope carrying
       * `get()`; the service read is the fallback, so a scope without it still
       * yields the stored value instead of silently dropping the user's
       * visibility choice.
       */
      const readOmnimuxSettings = () => {
        if (scope && typeof scope.get === 'function') return scope.get()
        const settingsService = typeof ctx.get === 'function' ? ctx.get('settings') : undefined
        return settingsService && typeof settingsService.get === 'function'
          ? settingsService.get('omnimux')
          : undefined
      }
      let retryTimer = null
      const syncComposerList = async (retryStep = 0) => {
        if (retryTimer) {
          clearTimeout(retryTimer)
          retryTimer = null
        }
        const current = readOmnimuxSettings()
        const hiddenIds = current && typeof current === 'object' ? current.composerHiddenModels : undefined
        let hubText
        try {
          hubText = listCatalog().text
        } catch (error) {
          // `buildModelCatalog` is fail-closed: an unhealthy contract throws
          // rather than serving a partial directory. The composer keeps its last
          // accepted list, and plugin startup must not fail because of it.
          logComposerSync('composer-list-hub-unavailable', {
            message: error instanceof Error ? error.message : String(error),
          })
          return
        }
        try {
          const res = await composerSync.sync({ hubText, hiddenIds })
          if (res && res.reason !== 'unchanged') {
            logComposerSync('composer-list-sync', {
              reason: res.reason,
              written: res.written,
              modelIds: res.modelIds,
            })
          }
          // If llm-pi-ai settings namespace registration lagged behind in
          // Cordis startup order, back off and retry up to 3 times so the list
          // converges without waiting for an external settings change.
          if (res && res.reason === 'namespace-absent' && retryStep < 3) {
            const delays = [300, 1000, 2500]
            retryTimer = setTimeout(() => {
              retryTimer = null
              void syncComposerList(retryStep + 1)
            }, delays[retryStep])
          }
        } catch {
          /* fail-closed: unhandled error must not propagate */
        }
      }

      syncComposerListAfterCatalogRefresh = () => {
        void syncComposerList(0)
      }
      if (scope && typeof scope.watch === 'function') {
        scope.watch(() => {
          ctx.emit?.('omnimux/model-catalog-updated')
          void syncComposerList(0)
        })
      }

      // Re-sync on adapter mount/update so lagging provider registrations converge.
      if (typeof ctx.on === 'function') {
        ctx.on('llm/adapters-updated', () => {
          void syncComposerList(0)
        })
        ctx.on('omnimux/model-catalog-updated', () => {
          void syncComposerList(0)
        })
        ctx.on('settings/document-updated', (ns) => {
          if (ns === 'omnimux' || ns === PI_AI_NAMESPACE) {
            void syncComposerList(0)
          }
        })
      }

      void syncComposerList(0)
  }

  // Subscription route lifecycle & live ctx.llm model snapshot work across both
  // legacy settings.register hosts and DSH 0.2.2-rc.5 schema-backed hosts.
  const runSubscriptionReconcile = () => {
    const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined
    const settingsService = typeof ctx.get === 'function' ? ctx.get('settings') : undefined
    const editor = (typeof ctx.get === 'function' ? ctx.get('configEditor') : undefined)
      ?? settingsService?.ownerContext?.configEditor
    if (!credentials || (!settingsService && !editor)) return
    void reconcileSubscriptionRoutes({
      settings: settingsService,
      configEditor: editor,
      credentials,
    }).then((removed) => {
      if (removed.length > 0) {
        hubEvents.emit({ type: 'omnimux:model-catalog-updated' })
        ctx.emit?.('omnimux/model-catalog-updated')
      }
    }).catch((error) => {
      console.warn('[omnimux] subscription route reconcile failed:', error instanceof Error ? error.message : String(error))
    })
  }
  if (typeof ctx.on === 'function') {
    ctx.on('llm/adapters-updated', () => {
      void refreshLiveLlmSnapshot()
    })
    ctx.on('llm/models-updated', () => {
      void refreshLiveLlmSnapshot()
    })
    ctx.on('credentials/record-updated', () => {
      runSubscriptionReconcile()
      void refreshLiveLlmSnapshot().then(() => {
        hubEvents.emit({ type: 'omnimux:model-catalog-updated' })
        ctx.emit?.('omnimux/model-catalog-updated')
      })
    })
    ctx.on('settings/document-updated', (ns) => {
      if (ns === 'omnimux' || ns === PI_AI_NAMESPACE) {
        void refreshLiveLlmSnapshot()
      }
    })
  }
  void refreshLiveLlmSnapshot()
  runSubscriptionReconcile()

  // The settings service may not be available at apply time in the desktop
  // host. The official config editor is a separate service; use it directly so
  // the composer still converges to the gateway text directory.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['configEditor'], (editorCtx) => {
      runSubscriptionReconcile()
      void refreshLiveLlmSnapshot()
      const editor = editorCtx.configEditor ?? editorCtx.get?.('configEditor')
      if (!editor) return
      const logComposerSync = (event, detail) => {
        try {
          ctx.logger?.info?.(`omnimux: ${event}`, detail ?? {})
        } catch {
          /* logging must never break the sync */
        }
      }
      const sync = createComposerListSync({ configEditor: editor, log: logComposerSync })
      const run = () => {
        try {
          const settingsService = typeof ctx.get === 'function' ? ctx.get('settings') : undefined
          const current = settingsService && typeof settingsService.get === 'function'
            ? settingsService.get('omnimux')
            : undefined
          const hiddenIds = current && typeof current === 'object' ? current.composerHiddenModels : undefined
          void sync.sync({ hubText: listCatalog().text, hiddenIds }).catch((error) => {
            logComposerSync('composer-list-write-failed', {
              message: error instanceof Error ? error.message : String(error),
            })
          })
        } catch (error) {
          logComposerSync('composer-list-hub-unavailable', {
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
      syncComposerListAfterCatalogRefresh = run
      run()
    })
  }

  const jsonOut = JSON_TOOL_OUTPUT
  const mediaDeps = { media: hub.media, gate: hub.gate, store, jsonOut, sessionModel: sessionModelPreference, readReferenceStorageConfig }
  mountMedia(ctx, { kind: 'video', execute: executeOmnimuxVideo, ...mediaDeps })
  mountMedia(ctx, { kind: 'image', execute: executeOmnimuxImage, ...mediaDeps })
  mountMedia(ctx, { kind: 'audio', execute: executeOmnimuxAudio, ...mediaDeps })
  mountAudioVoices(ctx, { gate: hub.gate, jsonOut })
  mountSpeechToText(ctx, { execute: executeOmnimuxSpeechToText, media: hub.media, gate: hub.gate, store, jsonOut })
  const textCompleteApi = mountTextComplete(ctx, hub, jsonOut, rethrow, { resolveOfficialApiKey: (env) => modelKeys.resolve({ env }) })
  if (textCompleteApi) {
    mountHeadlessSkill(ctx, { hubEvents, textComplete: textCompleteApi })
  }
  mountOfficial(ctx, {
    accountMetaStore,
    hub,
    identity,
    store,
    siteBaseUrl,
    objectParams,
    jsonOut,
    rethrow,
    resolveApiKey: resolveOfficialApiKey,
  })
  mountReader(ctx, {
    hub,
    objectParams,
    jsonOut,
    rethrow,
    resolveApiKey: resolveOfficialApiKey,
  })
  mountDecisions(ctx, {
    hub,
    objectParams,
    jsonOut,
    rethrow,
    credentials: ctx.get?.('credentials'),
    resolveApiKey: resolveOfficialApiKey,
  })
  mountWorkbenchTools(ctx, {
    mailbox,
    getSettings: () => {
      const s = typeof ctx.get === 'function' ? ctx.get('settings') : null
      return s && typeof s.get === 'function' ? s.get('omnimux') : null
    },
    jsonOut,
  })
  mountPresetsTools(ctx)
  mountTemplatesTools(ctx)
  mountRetiredPresetRedirect(ctx)
  void reclaimLegacyManagedPluginSkills(hubHomeDir(), { logger: ctx.logger }).catch((error) => {
    ctx.logger?.warn?.('omnimux: legacy managed skill reclaim failed', {
      message: error instanceof Error ? error.message : String(error),
    })
  })
  mountCanvasGenerationEvents(ctx, { hubEvents })
  mountSurfaceFollow(ctx, {
    mailbox,
    getSettings: () => {
      const s = typeof ctx.get === 'function' ? ctx.get('settings') : null
      return s && typeof s.get === 'function' ? s.get('omnimux') : null
    },
  })
  mountWorkbenchContextInjector(ctx, { mailbox, hubEvents })
  mountSessionModelInjector(ctx, { preference: sessionModelPreference })
  if (typeof ctx.on === 'function') mountCommentInjector(ctx)
  mountContractsPrompt(ctx)
  if (typeof ctx.provide === 'function') {
    ctx.provide('modelCatalog', { list: listCatalog, isAccountScoped: accountCatalog.isAccountScoped })
    ctx.provide('generationProducts', generationProducts)
    ctx.provide('mediaInspect', createMediaInspector())
    // Shared macOS file/folder chooser: assets, products and workflow consume
    // this seam instead of shipping three copies of the JXA script.
    ctx.provide('nativeFilePicker', createNativeFilePicker())
    // Federated cross-plugin media handle registry; domain plugins own bytes & ACLs.
    ctx.provide('mediaResolver', createMediaResolver())
  }

  /**
   * Chat (`llm-pi-ai`) resolves `OMNIMUX_API_KEY` from `$DSH_HOME/.credentials.yaml`.
   * Official tools historically only read `process.env`. Prefer env, then the
   * credentials store, so L2 / App sessions with a yaml key can fetch pages.
   */
  async function resolveOfficialApiKey() {
    const fromEnv = String(process.env.OMNIMUX_API_KEY || process.env.OMNIMUX_TOKEN || '').trim()
    if (fromEnv) return fromEnv
    const credentials = ctx.get?.('credentials')
    if (!credentials || typeof credentials.resolve !== 'function') return undefined
    for (const ref of ['OMNIMUX_API_KEY', 'OMNIMUX_TOKEN']) {
      try {
        const hit = await credentials.resolve(ref)
        const value = hit && typeof hit.value === 'string' ? hit.value.trim() : ''
        if (value) return value
      } catch (error) {
        ctx.logger?.warn?.('omnimux: credential resolve failed', {
          ref,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return undefined
  }
}
