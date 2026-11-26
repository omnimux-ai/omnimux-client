import { createAuthDispatcher, registerAuthRoutes } from '../auth/http-routes.js'
import { createPendingStore } from '../auth/pending.js'
import { registerPluginRoutes, createPluginDispatcher } from '../plugins/http-routes.js'
import { createAppsDispatcher, registerAppsRoutes } from '../apps/http-routes.js'
import { createOfficialDispatcher, registerOfficialRoutes } from '../official/http-routes.js'
import { createInspirationDispatcher, registerInspirationRoutes } from '../official/inspiration-http.js'
import { createAvatarDispatcher, registerAvatarRoutes } from '../avatar/routes.js'
import { injectBrandBoot } from '../brand/inject-index.js'
import { registerCatalogRoutes, registerGenerationProductRoutes } from '../catalog/http.js'
import { createComposerAttachmentsDispatcher, registerComposerAttachmentRoutes } from './composer-attachments-http.js'
import { registerTextCompleteRoutes } from '../text/http.js'
import { registerByokRoutes } from '../byok/http.js'
import { registerAgentRoutes } from '../agents/http.js'
import { registerReferenceStorageRoutes } from '../reference-storage/http.js'
import { createTemplatesDispatcher, registerTemplatesRoutes } from '../templates/http.js'

/**
 * Mount Host HTTP faces. Match order is auth → plugins → apps → official → inspiration → avatar.
 * @param {{
 *   webServer?: { register: Function, tapIndex?: Function },
 *   get?: Function,
 *   effect?: Function,
 * }} httpCtx
 * deps.getConnection supplies Host authorization to protected HTTP mounts.
 * @param {{
 *   store: object,
 *   identity: object,
 *   siteBaseUrl: string,
 *   clientName: string,
 *   hub: object,
 *   brand: object,
 *   homeDir: string,
 *   profile: string,
 *   appsStore: { view: Function },
 *   tabsStore: { remove: Function },
 *   accountMetaStore: object,
 *   accountAvatarStore?: object,
 *   avatarStore: object,
 *   listCatalog?: () => object,
 *   accountCatalogScoped?: () => boolean,
 *   onIdentityChanged?: () => void,
 *   getConnection?: () => { requestRejection: Function } | undefined,
 * }} deps
 */
export function mountHubHttp(httpCtx, deps) {
  const webServer = httpCtx.webServer ?? httpCtx.get?.('webServer')
  if (!webServer || typeof webServer.register !== 'function') return
  const dispatcher = createAuthDispatcher({
    store: deps.store,
    pending: createPendingStore(),
    siteBaseUrl: deps.siteBaseUrl,
    clientName: deps.clientName,
    identity: deps.identity,
    onIdentityChanged: deps.onIdentityChanged,
    modelKeys: deps.modelKeys,
    capabilities: {
      identity: true,
      videoGenerate: true,
      imageGenerate: true,
      textComplete: true,
      official: deps.hub.official.mount,
    },
  })
  const shelfApps = () => {
    const body = deps.appsStore.view()
    return Array.isArray(body.apps) ? body.apps : []
  }
  const mount = () => {
    const stopAuth = registerAuthRoutes(webServer, dispatcher, { getConnection: deps.getConnection })
    const stopCatalog = registerCatalogRoutes(webServer, {
      list: typeof deps.listCatalog === 'function' ? deps.listCatalog : () => null,
      isAccountScoped: deps.accountCatalogScoped,
      diagnostics: typeof deps.catalogDiagnostics === 'function' ? deps.catalogDiagnostics : () => null,
      refresh: typeof deps.refreshCatalog === 'function' ? deps.refreshCatalog : undefined,
      getConnection: deps.getConnection,
    })
    const stopProducts = registerGenerationProductRoutes(webServer, { products: deps.products, getConnection: deps.getConnection })
    const stopPlugins = registerPluginRoutes(webServer, createPluginDispatcher({
      appsView: shelfApps,
      tabsRemove: (id) => { deps.tabsStore.remove(id) },
      bundledDir: deps.hub.apps.bundledDir || process.env.OMNIMUX_APPS_BUNDLED_DIR || '',
    }), { getConnection: deps.getConnection })
    const stopApps = registerAppsRoutes(webServer, createAppsDispatcher({
      homeDir: deps.homeDir,
      profile: deps.profile,
      apps: deps.hub.apps,
      siteBaseUrl: deps.siteBaseUrl,
      store: deps.appsStore,
      tabsStore: deps.tabsStore,
    }), { getConnection: deps.getConnection })
    const officialDeps = {
      official: deps.hub.official,
      identity: deps.identity,
      store: deps.store,
      siteBaseUrl: deps.siteBaseUrl,
    }
    const stopOfficial = registerOfficialRoutes(webServer, createOfficialDispatcher({
      ...officialDeps,
      metaStore: deps.accountMetaStore,
      avatarStore: deps.accountAvatarStore,
    }), { getConnection: deps.getConnection })
    const stopInspiration = registerInspirationRoutes(webServer, createInspirationDispatcher(officialDeps), { getConnection: deps.getConnection })
    const stopAvatar = registerAvatarRoutes(webServer, createAvatarDispatcher({
      store: deps.avatarStore,
      identity: deps.identity,
    }), { getConnection: deps.getConnection })
    const stopComposerAttachments = registerComposerAttachmentRoutes(
      webServer,
      createComposerAttachmentsDispatcher({
        getSessionQuery: () => deps.sessionQuery ?? null,
      }),
      { getConnection: deps.getConnection },
    )
    const stopTextComplete = registerTextCompleteRoutes(webServer, {
      getConnection: deps.getConnection,
      getTextComplete: deps.getTextComplete || (() => httpCtx.get?.('textComplete')),
      credentials: deps.credentials || httpCtx.get?.('credentials'),
      settings: deps.settings || httpCtx.get?.('settings'),
      env: process.env,
    })
    const stopByok = registerByokRoutes(webServer, {
      // Services arrive after mount; resolve them per request, never eagerly.
      getSettings: () => deps.settings ?? httpCtx.get?.('settings'),
      getCredentials: () => deps.credentials ?? httpCtx.get?.('credentials'),
      getConfigEditor: () => deps.getConfigEditor?.() ?? httpCtx.get?.('configEditor'),
      getAgentDefaultModel: () => deps.getAgentDefaultModel?.() ?? httpCtx.get?.('agentDefaultModel'),
      getConnection: deps.getConnection,
      hubEvents: deps.hubEvents,
      onCredentialUpdated: typeof httpCtx.on === 'function'
        ? (listener) => httpCtx.on('credentials/reference-updated', listener) : undefined,
    })
    const stopReferenceStorage = registerReferenceStorageRoutes(webServer, {
      getSettings: () => deps.settings ?? httpCtx.get?.('settings'),
      getCredentials: () => deps.credentials ?? httpCtx.get?.('credentials'),
      getConnection: deps.getConnection,
      readConfig: deps.readReferenceStorageConfig,
    })
    const stopAgents = registerAgentRoutes(webServer, {
      getSettings: () => deps.settings ?? httpCtx.get?.('settings'),
      getConfigEditor: () => deps.getConfigEditor?.() ?? httpCtx.get?.('configEditor'),
      getCredentials: () => deps.credentials ?? httpCtx.get?.('credentials'),
      getAuthorization: () => deps.getAuthorization?.() ?? httpCtx.get?.('authorization'),
      getLlm: () => deps.getLlm?.() ?? httpCtx.get?.('llm'),
      getAgentDefaultModel: () => deps.getAgentDefaultModel?.() ?? httpCtx.get?.('agentDefaultModel'),
      getConnection: deps.getConnection,
      refreshLiveLlmSnapshot: deps.refreshLiveLlmSnapshot,
      hubEvents: deps.hubEvents,
    })
    const stopTemplates = registerTemplatesRoutes(webServer, createTemplatesDispatcher(), { getConnection: deps.getConnection })
    return () => {
      stopAuth()
      stopCatalog()
      stopProducts()
      stopPlugins()
      stopApps()
      stopOfficial()
      stopInspiration()
      stopAvatar()
      stopComposerAttachments()
      stopTextComplete()
      stopByok()
      stopAgents()
      stopReferenceStorage()
      stopTemplates()
    }
  }
  if (typeof httpCtx.effect === 'function') httpCtx.effect(mount, 'omnimux: http routes')
  else mount()
  if (typeof webServer.tapIndex !== 'function') return
  const tap = () => webServer.tapIndex(html => injectBrandBoot(html, deps.brand))
  if (typeof httpCtx.effect === 'function') httpCtx.effect(tap, 'omnimux: brand boot')
  else tap()
}
