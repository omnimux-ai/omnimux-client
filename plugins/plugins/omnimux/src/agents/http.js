import { sendJson, readJsonBody } from '../auth/http-routes.js'
import { assertLocalWrite, readOriginHeaders } from '../apps/origin.js'
import { requestRejection } from '../host/request-authorization.js'
import { findDescriptor } from '../catalog/composer-sync.js'
import { resolveScenarioBindings } from '../settings/runtime-mode.js'
import { KNOWN_AGENTS, scanLocalAgents, probeAgentBin, resolveBinPath } from './local.js'
import { probeAgentAuth, launchAgentLogin } from './auth.js'
import { createUpdateChecker, runAgentUpdate, detectInstallShape } from './updates.js'
import {
  inspectLocalCliCredential,
  readLocalCliOAuthGrant,
  subscriptionSpecFor,
} from './cli-credential-import.js'
import {
  activateSubscriptionRoute,
  deactivateSubscriptionRoute,
  hasStoredSubscriptionRecord,
  listLiveProviderModels,
  readPiAiProviderProfile,
} from './llm-route-sync.js'
import { createAgentOAuthManager } from './oauth-session.js'

const NAMESPACE = 'omnimux'

function assertLocal(req, res) {
  try {
    assertLocalWrite({
      ...readOriginHeaders(req),
      host: req.headers?.host,
      secure: Boolean(req.socket?.encrypted),
    }, { rejectSameSite: true })
    return true
  } catch {
    sendJson(res, 403, { error: 'not-local' })
    return false
  }
}

function findAgent(id) {
  const key = typeof id === 'string' ? id.trim() : ''
  return KNOWN_AGENTS.find((row) => row.id === key) || null
}

function methodNotAllowed(req, res, expected) {
  const method = (req.method || 'GET').toUpperCase()
  if (method === 'OPTIONS') {
    sendJson(res, 204, {})
    return true
  }
  if (method !== expected) {
    sendJson(res, 404, { error: 'not found' })
    return true
  }
  return false
}

async function readId(req) {
  const body = await readJsonBody(req)
  return body && typeof body.id === 'string' ? body.id.trim() : ''
}

async function bindAgentTextSettings(settings, agentId, model = '') {
  if (!settings || typeof settings.describe !== 'function' || typeof settings.update !== 'function') {
    return false
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const descriptor = findDescriptor(settings.describe(), NAMESPACE)
    if (!descriptor) return false
    const current = descriptor.value ?? (typeof settings.get === 'function' ? await settings.get(NAMESPACE) : {}) ?? {}
    const currentBindings = resolveScenarioBindings(current)
    const cleanModel = typeof model === 'string' ? model.trim() : ''
    const switchingAgent = current.runtimeAgentId !== agentId
    const nextModel = cleanModel || (switchingAgent ? '' : String(current.runtimeAgentModel || '').trim())
    if (
      !switchingAgent
      && current.runtimeAgentVerified === true
      && currentBindings.text?.channel === 'agent'
      && String(current.runtimeAgentModel || '').trim() === nextModel
    ) {
      return true
    }
    const patch = {
      runtimeAgentId: agentId,
      runtimeAgentVerified: true,
      scenarioBindings: { ...currentBindings, text: { channel: 'agent' } },
      runtimeAgentModel: nextModel,
    }
    try {
      await settings.update(NAMESPACE, patch, descriptor.revision)
      return true
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'SETTINGS_CONFLICT' && attempt === 0) {
        continue
      }
      throw error
    }
  }
  return false
}

function availableOAuthMethodsFor(spec, authorization) {
  if (!spec) return []
  if (!authorization || typeof authorization.begin !== 'function') return []
  if (typeof authorization.describe === 'function') {
    try {
      const entry = authorization.describe(spec.recordKey)
      if (!entry || !Array.isArray(entry.methods) || !entry.methods.some((item) => item?.id === 'oauth')) {
        return []
      }
    } catch (error) {
      if (process.env.OMNIMUX_DEBUG) console.debug('[omnimux] authorization.describe failed:', error?.message || 'error')
      return []
    }
  }
  return [...spec.oauthMethods]
}

/**
 * Local agent discovery, sign-in state, version state, and Route 1 (native
 * OAuth via `ctx.authorization`) + Route 2 (read-only local CLI credential
 * reuse) subscription orchestration.
 * @param {{ register: (route: { kind: string, path: string, handler: Function }) => () => void }} webServer
 * @param {{
 *   settings?: any,
 *   getSettings?: () => any,
 *   configEditor?: any,
 *   getConfigEditor?: () => any,
 *   credentials?: any,
 *   getCredentials?: () => any,
 *   authorization?: any,
 *   getAuthorization?: () => any,
 *   llm?: any,
 *   getLlm?: () => any,
 *   agentDefaultModel?: any,
 *   getAgentDefaultModel?: () => any,
 *   hubEvents?: any,
 *   scan?: (options?: { refresh?: boolean }) => Promise<Array<object>>,
 *   probe?: (bin: string) => Promise<{ installed: boolean, version: string }>,
 *   authProbe?: (id: string) => Promise<{ state: string, method: string }>,
 *   inspectCliCredential?: (id: string, options?: object) => object,
 *   readCliGrant?: (id: string, options?: object) => object,
 *   updateCheck?: (agents: Array<object>, options?: { refresh?: boolean }) => Promise<object>,
 *   login?: (id: string) => Promise<object>,
 *   update?: (id: string, options: { shape: string }) => Promise<object>,
 *   installShape?: (agent: object) => string,
 * }} deps
 */
export function registerAgentRoutes(webServer, deps = {}) {
  const getSettings = () => (typeof deps.getSettings === 'function' ? deps.getSettings() : deps.settings)
  const getConfigEditor = () => (typeof deps.getConfigEditor === 'function' ? deps.getConfigEditor() : deps.configEditor)
  const getCredentials = () => (typeof deps.getCredentials === 'function' ? deps.getCredentials() : deps.credentials)
  const getAuthorization = () => (typeof deps.getAuthorization === 'function' ? deps.getAuthorization() : deps.authorization)
  const getLlm = () => (typeof deps.getLlm === 'function' ? deps.getLlm() : deps.llm)
  const getAgentDefaultModel = () => (typeof deps.getAgentDefaultModel === 'function' ? deps.getAgentDefaultModel() : deps.agentDefaultModel)

  const scan = typeof deps.scan === 'function'
    ? deps.scan
    : (options = {}) => scanLocalAgents(undefined, { refresh: options?.refresh === true })
  const probe = typeof deps.probe === 'function' ? deps.probe : (bin) => probeAgentBin(bin)
  const authProbe = typeof deps.authProbe === 'function' ? deps.authProbe : (id) => probeAgentAuth(id)
  const inspectCli = typeof deps.inspectCliCredential === 'function'
    ? deps.inspectCliCredential
    : (id, options) => inspectLocalCliCredential(id, options)
  const readCliGrant = typeof deps.readCliGrant === 'function'
    ? deps.readCliGrant
    : (id, options) => readLocalCliOAuthGrant(id, options)
  const checker = createUpdateChecker()
  const updateCheck = typeof deps.updateCheck === 'function' ? deps.updateCheck : (agents, options) => checker.check(agents, options)
  const login = typeof deps.login === 'function' ? deps.login : (id) => launchAgentLogin(id)
  const update = typeof deps.update === 'function' ? deps.update : (id, options) => runAgentUpdate(id, options)
  const installShape = typeof deps.installShape === 'function'
    ? deps.installShape
    : (agent) => detectInstallShape(resolveBinPath(agent.bin))
  const updating = new Set()

  const oauthManager = createAgentOAuthManager({
    getAuthorization,
    hubEvents: deps.hubEvents,
    async onAuthorized({ agentId, model, setAsDefault }) {
      const settings = getSettings()
      const configEditor = getConfigEditor()
      const credentials = getCredentials()
      const llm = getLlm()
      const agentDefaultModel = getAgentDefaultModel()
      const activated = await activateSubscriptionRoute({
        settings,
        configEditor,
        credentials,
        llm,
        agentDefaultModel,
        agentId,
        preferredModel: model,
        setAsDefault,
      })
      if (!activated.ok) return activated
      try {
        await bindAgentTextSettings(settings, agentId, activated.defaultModel || '')
      } catch (error) {
        console.warn('[omnimux] companion text settings sync failed after OAuth:', error instanceof Error ? error.message : String(error))
      }
      await deps.refreshLiveLlmSnapshot?.()
      deps.hubEvents?.emit?.({ type: 'omnimux:model-catalog-updated' })
      return activated
    },
  })

  /** Sign-in state is only asked of CLIs that are actually installed; subscription status is always reported. */
  async function withAuthAndSubscription(rows) {
    const settings = getSettings()
    const configEditor = getConfigEditor()
    const credentials = getCredentials()
    const authorization = getAuthorization()
    const llm = getLlm()

    return Promise.all(rows.map(async (row) => {
      const agent = findAgent(row?.id)
      const loginSupported = Boolean(agent && agent.login)
      let auth = { state: 'unknown', method: 'none', loginSupported }
      if (agent && row?.installed === true) {
        let probed = null
        try {
          probed = await authProbe(agent.id)
        } catch {
          probed = null
        }
        auth = {
          state: typeof probed?.state === 'string' ? probed.state : 'unknown',
          method: typeof probed?.method === 'string' ? probed.method : 'none',
          loginSupported,
        }
      }

      const spec = agent ? subscriptionSpecFor(agent.id) : null
      if (!spec) {
        return {
          ...row,
          auth,
          subscription: {
            supported: false,
            providerId: '',
            connected: false,
            credentialStored: false,
            oauthMethods: [],
            cliImport: { supported: false, importable: false, source: 'none', reason: 'unsupported' },
            liveModels: [],
            activeOAuth: null,
          },
        }
      }

      const credentialStored = await hasStoredSubscriptionRecord(credentials, spec.recordKey)
      const routeProfile = readPiAiProviderProfile(settings, configEditor, spec.providerId)
      const hasExplicitApiKey = Boolean(routeProfile && typeof routeProfile.apiKeyEnv === 'string' && routeProfile.apiKeyEnv.trim())
      const connected = Boolean(credentialStored && routeProfile && !hasExplicitApiKey)
      const liveModelRows = connected ? await listLiveProviderModels(llm, spec.providerId) : []
      const liveModels = liveModelRows.map((item) => item.id)
      const oauthMethods = availableOAuthMethodsFor(spec, authorization)
      const cliImport = credentials || deps.inspectCliCredential
        ? inspectCli(agent.id, { cliSignedIn: auth.state === 'signed-in' })
        : { supported: true, importable: false, source: 'none', reason: 'missing' }
      const activeOAuth = oauthManager.status({ agentId: agent.id })

      return {
        ...row,
        ...(liveModels.length > 0 ? { models: liveModels, modelsSource: 'live' } : {}),
        auth,
        subscription: {
          supported: true,
          providerId: spec.providerId,
          connected,
          credentialStored,
          oauthMethods,
          cliImport,
          liveModels,
          activeOAuth,
        },
      }
    }))
  }

  const authorize = (req, res, peer) => {
    if (!assertLocal(req, res)) return false
    const rejection = requestRejection(req, deps.getConnection, peer)
    if (rejection !== undefined) {
      sendJson(res, rejection, { ok: false, error: rejection === 403 ? 'not-local' : 'request-denied' })
      return false
    }
    return true
  }

  const stopScan = webServer.register({
    kind: 'exact',
    path: '/omnimux/agents',
    auth: 'required',
    async handler(req, res, peer) {
      if (methodNotAllowed(req, res, 'GET')) return
      // A scan reveals what lives on this machine; same-origin + Host auth only.
      if (!authorize(req, res, peer)) return
      try {
        const url = new URL(req.url || '/', 'http://localhost')
        const refresh = url.searchParams.get('refresh') === '1'
        const agents = await withAuthAndSubscription(await scan({ refresh }))
        sendJson(res, 200, { agents })
      } catch (error) {
        sendJson(res, 500, { error: typeof error?.message === 'string' ? error.message : String(error) })
      }
    },
  })

  const stopUpdates = webServer.register({
    kind: 'exact',
    path: '/omnimux/agents/updates',
    auth: 'required',
    async handler(req, res, peer) {
      if (methodNotAllowed(req, res, 'GET')) return
      if (!authorize(req, res, peer)) return
      try {
        const url = new URL(req.url || '/', 'http://localhost')
        const refresh = url.searchParams.get('refresh') === '1'
        const agents = await scan({ refresh })
        const result = await updateCheck(agents, { refresh })
        sendJson(res, 200, {
          checkedAt: Number.isFinite(result?.checkedAt) ? result.checkedAt : Date.now(),
          updates: result && typeof result.updates === 'object' && result.updates ? result.updates : {},
        })
      } catch (error) {
        sendJson(res, 500, { error: typeof error?.message === 'string' ? error.message : String(error) })
      }
    },
  })

  const stopLogin = webServer.register({
    kind: 'exact',
    path: '/omnimux/agents/login',
    auth: 'required',
    async handler(req, res, peer) {
      if (methodNotAllowed(req, res, 'POST')) return
      try {
        if (!authorize(req, res, peer)) return
        const id = await readId(req)
        const agent = findAgent(id)
        if (!agent) {
          sendJson(res, 400, { ok: false, error: 'unknown-agent' })
          return
        }
        const info = await probe(agent.bin)
        if (!info || info.installed !== true) {
          sendJson(res, 200, { ok: false, error: 'not-installed' })
          return
        }
        sendJson(res, 200, await login(agent.id))
      } catch (error) {
        const status = typeof error?.status === 'number' ? error.status : 500
        sendJson(res, status, { ok: false, error: typeof error?.message === 'string' ? error.message : String(error) })
      }
    },
  })

  // Route 2: Controlled one-way pull from allowlisted local CLI auth file into DSH ctx.credentials.
  const stopImportAuth = webServer.register({
    kind: 'exact',
    path: '/omnimux/agents/import-auth',
    auth: 'required',
    async handler(req, res, peer) {
      if (methodNotAllowed(req, res, 'POST')) return
      try {
        if (!authorize(req, res, peer)) return
        const body = await readJsonBody(req)
        const id = typeof body?.id === 'string' ? body.id.trim() : ''
        const model = typeof body?.model === 'string' ? body.model.trim() : ''
        const setAsDefault = body?.setAsDefault !== false
        const agent = findAgent(id)
        if (!agent) {
          sendJson(res, 400, { ok: false, error: 'unknown-agent' })
          return
        }
        const spec = subscriptionSpecFor(agent.id)
        if (!spec) {
          sendJson(res, 400, { ok: false, error: 'unsupported-agent' })
          return
        }
        const credentials = getCredentials()
        if (!credentials || typeof credentials.modifyRecord !== 'function') {
          sendJson(res, 503, { ok: false, error: 'credentials-unavailable' })
          return
        }

        const settings = getSettings()
        const configEditor = getConfigEditor()
        const existingProfile = readPiAiProviderProfile(settings, configEditor, spec.providerId)
        if (existingProfile && typeof existingProfile.apiKeyEnv === 'string' && existingProfile.apiKeyEnv.trim()) {
          sendJson(res, 409, { ok: false, error: 'api-key-route-exists', providerId: spec.providerId })
          return
        }

        let cliSignedIn = false
        try {
          const auth = await authProbe(agent.id)
          cliSignedIn = auth?.state === 'signed-in'
        } catch (error) {
          if (process.env.OMNIMUX_DEBUG) console.debug('[omnimux] import-auth pre-probe failed:', error?.message || 'error')
          cliSignedIn = false
        }
        const parsed = readCliGrant(agent.id, { cliSignedIn })
        if (!parsed || parsed.ok !== true || !parsed.grant) {
          sendJson(res, 200, {
            ok: false,
            error: typeof parsed?.reason === 'string' ? parsed.reason : 'missing',
            fallbackOAuth: availableOAuthMethodsFor(spec, getAuthorization()).length > 0,
          })
          return
        }

        await credentials.modifyRecord(spec.recordKey, async () => parsed.grant)
        const activated = await activateSubscriptionRoute({
          settings,
          configEditor,
          credentials,
          llm: getLlm(),
          agentDefaultModel: getAgentDefaultModel(),
          agentId: agent.id,
          preferredModel: model,
          setAsDefault,
        })
        if (!activated.ok) {
          const status = activated.error === 'api-key-route-exists' ? 409 : 500
          sendJson(res, status, { ok: false, error: activated.error, providerId: spec.providerId })
          return
        }
        try {
          await bindAgentTextSettings(settings, agent.id, activated.defaultModel || '')
        } catch (error) {
          console.warn('[omnimux] companion text settings sync failed after CLI import:', error instanceof Error ? error.message : String(error))
        }
        await deps.refreshLiveLlmSnapshot?.()
        deps.hubEvents?.emit?.({ type: 'omnimux:model-catalog-updated' })
        sendJson(res, 200, {
          ok: true,
          connected: true,
          source: 'cli-import',
          providerId: activated.providerId,
          models: activated.models,
          defaultModel: activated.defaultModel,
        })
      } catch (error) {
        const status = typeof error?.status === 'number' ? error.status : 500
        console.warn('[omnimux] import-auth route error:', error instanceof Error ? error.message : String(error))
        sendJson(res, status, { ok: false, error: typeof error?.message === 'string' ? error.message : String(error) })
      }
    },
  })

  // Route 1: In-app native OAuth flow via DSH ctx.authorization.
  const stopOAuthStart = webServer.register({
    kind: 'exact',
    path: '/omnimux/agents/oauth/start',
    auth: 'required',
    async handler(req, res, peer) {
      if (methodNotAllowed(req, res, 'POST')) return
      try {
        if (!authorize(req, res, peer)) return
        const body = await readJsonBody(req)
        const id = typeof body?.id === 'string' ? body.id.trim() : ''
        const agent = findAgent(id)
        if (!agent) {
          sendJson(res, 400, { ok: false, error: 'unknown-agent' })
          return
        }
        const spec = subscriptionSpecFor(agent.id)
        if (!spec) {
          sendJson(res, 400, { ok: false, error: 'unsupported-agent' })
          return
        }
        const existingProfile = readPiAiProviderProfile(getSettings(), getConfigEditor(), spec.providerId)
        if (existingProfile && typeof existingProfile.apiKeyEnv === 'string' && existingProfile.apiKeyEnv.trim()) {
          sendJson(res, 409, { ok: false, error: 'api-key-route-exists', providerId: spec.providerId })
          return
        }
        const result = await oauthManager.start({
          agentId: agent.id,
          mode: typeof body?.mode === 'string' ? body.mode.trim() : undefined,
          model: typeof body?.model === 'string' ? body.model.trim() : '',
          setAsDefault: body?.setAsDefault !== false,
        })
        const status = result.ok ? 200 : (result.error === 'authorization-unavailable' ? 503 : 400)
        sendJson(res, status, result)
      } catch (error) {
        const status = typeof error?.status === 'number' ? error.status : 500
        console.warn('[omnimux] oauth/start route error:', error instanceof Error ? error.message : String(error))
        sendJson(res, status, { ok: false, error: typeof error?.message === 'string' ? error.message : String(error) })
      }
    },
  })

  const stopOAuthStatus = webServer.register({
    kind: 'exact',
    path: '/omnimux/agents/oauth/status',
    auth: 'required',
    async handler(req, res, peer) {
      if (methodNotAllowed(req, res, 'GET')) return
      if (!authorize(req, res, peer)) return
      try {
        const url = new URL(req.url || '/', 'http://localhost')
        const attemptId = url.searchParams.get('attemptId') || ''
        const agentId = url.searchParams.get('id') || ''
        sendJson(res, 200, { ok: true, attempt: oauthManager.status({ attemptId, agentId }) })
      } catch (error) {
        console.warn('[omnimux] oauth/status route error:', error instanceof Error ? error.message : String(error))
        sendJson(res, 500, { ok: false, error: typeof error?.message === 'string' ? error.message : String(error) })
      }
    },
  })

  const stopOAuthSubmit = webServer.register({
    kind: 'exact',
    path: '/omnimux/agents/oauth/submit',
    auth: 'required',
    async handler(req, res, peer) {
      if (methodNotAllowed(req, res, 'POST')) return
      try {
        if (!authorize(req, res, peer)) return
        const body = await readJsonBody(req)
        const result = oauthManager.submit({
          attemptId: typeof body?.attemptId === 'string' ? body.attemptId : '',
          promptId: typeof body?.promptId === 'string' ? body.promptId : '',
          value: typeof body?.value === 'string' ? body.value : '',
        })
        sendJson(res, result.ok ? 200 : 400, result)
      } catch (error) {
        const status = typeof error?.status === 'number' ? error.status : 500
        console.warn('[omnimux] oauth/submit route error:', error instanceof Error ? error.message : String(error))
        sendJson(res, status, { ok: false, error: typeof error?.message === 'string' ? error.message : String(error) })
      }
    },
  })

  const stopOAuthCancel = webServer.register({
    kind: 'exact',
    path: '/omnimux/agents/oauth/cancel',
    auth: 'required',
    async handler(req, res, peer) {
      if (methodNotAllowed(req, res, 'POST')) return
      try {
        if (!authorize(req, res, peer)) return
        const body = await readJsonBody(req)
        const result = await oauthManager.cancel({
          attemptId: typeof body?.attemptId === 'string' ? body.attemptId : '',
          agentId: typeof body?.id === 'string' ? body.id : '',
        })
        sendJson(res, 200, result)
      } catch (error) {
        const status = typeof error?.status === 'number' ? error.status : 500
        console.warn('[omnimux] oauth/cancel route error:', error instanceof Error ? error.message : String(error))
        sendJson(res, status, { ok: false, error: typeof error?.message === 'string' ? error.message : String(error) })
      }
    },
  })

  const stopDisconnect = webServer.register({
    kind: 'exact',
    path: '/omnimux/agents/disconnect',
    auth: 'required',
    async handler(req, res, peer) {
      if (methodNotAllowed(req, res, 'POST')) return
      try {
        if (!authorize(req, res, peer)) return
        const id = await readId(req)
        const agent = findAgent(id)
        if (!agent) {
          sendJson(res, 400, { ok: false, error: 'unknown-agent' })
          return
        }
        const spec = subscriptionSpecFor(agent.id)
        if (!spec) {
          sendJson(res, 400, { ok: false, error: 'unsupported-agent' })
          return
        }
        await oauthManager.cancel({ agentId: agent.id })
        const result = await deactivateSubscriptionRoute({
          settings: getSettings(),
          configEditor: getConfigEditor(),
          credentials: getCredentials(),
          agentId: agent.id,
          deleteCredential: true,
        })
        await deps.refreshLiveLlmSnapshot?.()
        deps.hubEvents?.emit?.({ type: 'omnimux:model-catalog-updated' })
        sendJson(res, result.ok ? 200 : 500, {
          ok: result.ok,
          connected: false,
          providerId: result.providerId,
          routeRemoved: result.routeRemoved,
          ...(result.error ? { error: result.error } : {}),
        })
      } catch (error) {
        const status = typeof error?.status === 'number' ? error.status : 500
        console.warn('[omnimux] disconnect route error:', error instanceof Error ? error.message : String(error))
        sendJson(res, status, { ok: false, error: typeof error?.message === 'string' ? error.message : String(error) })
      }
    },
  })

  const stopUpdate = webServer.register({
    kind: 'exact',
    path: '/omnimux/agents/update',
    auth: 'required',
    async handler(req, res, peer) {
      if (methodNotAllowed(req, res, 'POST')) return
      try {
        if (!authorize(req, res, peer)) return
        const id = await readId(req)
        const agent = findAgent(id)
        if (!agent) {
          sendJson(res, 400, { ok: false, error: 'unknown-agent' })
          return
        }
        const info = await probe(agent.bin)
        if (!info || info.installed !== true) {
          sendJson(res, 200, { ok: false, error: 'not-installed' })
          return
        }
        if (updating.has(agent.id)) {
          sendJson(res, 409, { ok: false, error: 'update-in-progress' })
          return
        }
        updating.add(agent.id)
        let result = null
        try {
          result = await update(agent.id, { shape: installShape(agent) })
        } finally {
          updating.delete(agent.id)
        }
        sendJson(res, 200, result && typeof result === 'object' ? result : { ok: false, error: 'update-failed' })
      } catch (error) {
        const status = typeof error?.status === 'number' ? error.status : 500
        sendJson(res, status, { ok: false, error: typeof error?.message === 'string' ? error.message : String(error) })
      }
    },
  })

  const stopSelect = webServer.register({
    kind: 'exact',
    path: '/omnimux/agents/select',
    auth: 'required',
    async handler(req, res, peer) {
      const method = (req.method || 'GET').toUpperCase()
      if (method === 'OPTIONS') {
        sendJson(res, 204, {})
        return
      }
      if (method !== 'POST') {
        sendJson(res, 404, { error: 'not found' })
        return
      }
      try {
        if (!authorize(req, res, peer)) return
        const body = await readJsonBody(req)
        const id = typeof body?.id === 'string' ? body.id.trim() : ''
        const model = typeof body?.model === 'string' ? body.model.trim() : ''
        const settings = getSettings()
        const descriptor = findDescriptor(settings?.describe?.(), NAMESPACE)
        if (!descriptor) throw Object.assign(new Error('settings unavailable'), { status: 503 })
        const agent = findAgent(id)
        if (!agent) {
          sendJson(res, 400, { ok: false, error: 'unknown agent' })
          return
        }

        const spec = subscriptionSpecFor(agent.id)
        const credentials = getCredentials()
        const hasSubscriptionCredential = spec
          ? await hasStoredSubscriptionRecord(credentials, spec.recordKey)
          : false

        const result = await probe(agent.bin)
        const afterProbe = findDescriptor(settings.describe(), NAMESPACE)
        if (afterProbe?.revision !== descriptor.revision) {
          sendJson(res, 409, { ok: false, error: '配置已变化，请重新检查' })
          return
        }
        const installed = Boolean(result && result.installed === true)
        if (!installed && !hasSubscriptionCredential) {
          sendJson(res, 200, { ok: false, error: 'not-installed' })
          return
        }

        let activated = null
        let importReason = ''
        if (body.checkOnly !== true) {
          const current = descriptor.value ?? settings?.get?.(NAMESPACE) ?? {}
          await settings.update(NAMESPACE, {
            runtimeAgentId: agent.id,
            runtimeAgentVerified: true,
            ...(model ? { runtimeAgentModel: model } : {}),
            scenarioBindings: { ...resolveScenarioBindings(current), text: { channel: 'agent' } },
          }, descriptor.revision)

          // Bridge subscription credential & llm-pi-ai route whenever credentials service is mounted.
          if (spec && credentials) {
            let ready = hasSubscriptionCredential
            if (!ready && typeof credentials.modifyRecord === 'function') {
              const parsed = readCliGrant(agent.id, { cliSignedIn: installed })
              if (parsed && parsed.ok === true && parsed.grant) {
                const existingProfile = readPiAiProviderProfile(settings, getConfigEditor(), spec.providerId)
                if (!existingProfile || !existingProfile.apiKeyEnv) {
                  await credentials.modifyRecord(spec.recordKey, async () => parsed.grant)
                  ready = true
                }
              } else {
                importReason = typeof parsed?.reason === 'string' ? parsed.reason : ''
              }
            }
            if (ready) {
              activated = await activateSubscriptionRoute({
                settings,
                configEditor: getConfigEditor(),
                credentials,
                llm: getLlm(),
                agentDefaultModel: getAgentDefaultModel(),
                agentId: agent.id,
                preferredModel: model,
                setAsDefault: body?.setAsDefault !== false,
              })
            }
          }
        }

        sendJson(res, 200, {
          ok: true,
          checkType: installed ? 'installed-program' : 'subscription-oauth',
          saved: body.checkOnly !== true,
          version: typeof result?.version === 'string' ? result.version : '',
          ...(spec && body.checkOnly !== true
            ? {
                composerConnected: Boolean(activated?.ok),
                ...(activated?.ok
                  ? { providerId: activated.providerId, models: activated.models, defaultModel: activated.defaultModel }
                  : { needsOAuth: true, ...(importReason ? { importReason } : {}) }),
              }
            : {}),
        })
      } catch (error) {
        const status = typeof error?.status === 'number' ? error.status : 500
        sendJson(res, status, { ok: false, error: typeof error?.message === 'string' ? error.message : String(error) })
      }
    },
  })

  return () => {
    oauthManager.dispose()
    stopScan()
    stopUpdates()
    stopLogin()
    stopImportAuth()
    stopOAuthStart()
    stopOAuthStatus()
    stopOAuthSubmit()
    stopOAuthCancel()
    stopDisconnect()
    stopUpdate()
    stopSelect()
  }
}
