import { findDescriptor, PI_AI_NAMESPACE } from '../catalog/composer-sync.js'
import { SUBSCRIPTION_PROVIDERS, subscriptionSpecFor } from './cli-credential-import.js'

const BYOK_DISPLAY_NAMES = Object.freeze({
  anthropic: 'Anthropic (BYOK)',
  openai: 'OpenAI (BYOK)',
  azure: 'Azure OpenAI (BYOK)',
  google: 'Google Gemini (BYOK)',
  ollama: 'Ollama Cloud (BYOK)',
  senseaudio: 'SenseAudio (BYOK)',
  aihubmix: 'AIHubMix (BYOK)',
  openrouter: 'OpenRouter (BYOK)',
  siliconflow: 'SiliconFlow (BYOK)',
  fal: 'Fal (BYOK)',
  custom: 'Custom (BYOK)',
})

const BYOK_API_PROTOCOL = Object.freeze({
  anthropic: 'anthropic-messages',
})

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : ''
}

/** @param {string} provider */
export function byokPiAiRouteId(provider) {
  const normalized = nonEmptyString(provider).toLowerCase().replace(/[^a-z0-9-]/g, '-')
  return normalized ? `byok-${normalized}` : ''
}

/** @param {string} provider */
export function byokPiAiApiFor(provider) {
  const key = nonEmptyString(provider).toLowerCase()
  return BYOK_API_PROTOCOL[key] || 'openai-completions'
}

/** @param {string} provider */
export function byokPiAiDisplayName(provider) {
  const key = nonEmptyString(provider).toLowerCase()
  return BYOK_DISPLAY_NAMES[key] || `${key.toUpperCase()} (BYOK)`
}

function findPiAiConfigEntry(configEditor) {
  if (!configEditor || typeof configEditor.entries !== 'function') return null
  try {
    const rows = configEditor.entries()
    return Array.isArray(rows)
      ? rows.find((row) => row && row.options && row.options.id === PI_AI_NAMESPACE) ?? null
      : null
  } catch (error) {
    if (process.env.OMNIMUX_DEBUG) console.debug('[omnimux] llm-route-sync configEditor entries failed:', error?.message || 'error')
    return null
  }
}

/**
 * Read the effective `llm-pi-ai` provider profile for one route id without
 * throwing when the settings service is unavailable.
 * @param {any} settings
 * @param {any} configEditor
 * @param {string} routeId
 * @returns {Record<string, unknown> | null}
 */
export function readPiAiProviderProfile(settings, configEditor, routeId) {
  if (!routeId) return null
  if (settings && typeof settings.describe === 'function') {
    try {
      const descriptor = findDescriptor(settings.describe(), PI_AI_NAMESPACE)
      if (descriptor) {
        const effectiveProviders = isPlainObject(descriptor.value?.providers) ? descriptor.value.providers : null
        if (effectiveProviders && isPlainObject(effectiveProviders[routeId])) {
          return effectiveProviders[routeId]
        }
        const userProviders = isPlainObject(descriptor.user?.providers) ? descriptor.user.providers : null
        const baseProviders = isPlainObject(descriptor.base?.providers) ? descriptor.base.providers : null
        if (userProviders?.[routeId] || baseProviders?.[routeId]) {
          return {
            ...(isPlainObject(baseProviders?.[routeId]) ? baseProviders[routeId] : {}),
            ...(isPlainObject(userProviders?.[routeId]) ? userProviders[routeId] : {}),
          }
        }
        return null
      }
    } catch (error) {
      if (process.env.OMNIMUX_DEBUG) console.debug('[omnimux] llm-route-sync describe failed:', error?.message || 'error')
    }
  }
  const entry = findPiAiConfigEntry(configEditor)
  const providers = isPlainObject(entry?.options?.config?.providers) ? entry.options.config.providers : null
  return providers && isPlainObject(providers[routeId]) ? providers[routeId] : null
}

/**
 * Atomically set or unset one `providers.<routeId>` entry in `llm-pi-ai` while
 * preserving `providers.omnimux` and every unrelated route untouched.
 * @param {{ settings?: any, configEditor?: any, routeId: string, value: Record<string, unknown> | undefined }} input
 * @returns {Promise<{ ok: boolean, changed: boolean, reason: string, error?: unknown }>}
 */
export async function mutatePiAiProviderRoute({ settings, configEditor, routeId, value }) {
  if (!routeId) return { ok: false, changed: false, reason: 'invalid-route' }

  const op = value === undefined
    ? { op: 'unset', path: ['providers', routeId] }
    : { op: 'set', path: ['providers', routeId], value }

  if (settings && typeof settings.describe === 'function' && typeof settings.mutate === 'function') {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let descriptor = null
      try {
        descriptor = findDescriptor(settings.describe(), PI_AI_NAMESPACE)
      } catch (error) {
        console.warn('[omnimux] llm-route-sync describe failed:', error instanceof Error ? error.message : String(error))
        return { ok: false, changed: false, reason: 'describe-failed', error }
      }
      if (!descriptor) break
      if (value === undefined) {
        const userHas = isPlainObject(descriptor.user?.providers) && Object.prototype.hasOwnProperty.call(descriptor.user.providers, routeId)
        const baseHas = isPlainObject(descriptor.base?.providers) && Object.prototype.hasOwnProperty.call(descriptor.base.providers, routeId)
        if (!userHas && !baseHas) {
          return { ok: true, changed: false, reason: 'already-absent' }
        }
      }
      try {
        await settings.mutate(PI_AI_NAMESPACE, [op], descriptor.revision)
        return { ok: true, changed: true, reason: value === undefined ? 'unset' : 'set' }
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'SETTINGS_CONFLICT' && attempt === 0) {
          if (process.env.OMNIMUX_DEBUG) console.debug('[omnimux] llm-route-sync retrying mutate after conflict')
          continue
        }
        console.warn('[omnimux] llm-route-sync mutate failed:', error instanceof Error ? error.message : String(error))
        // Try configEditor fallback before failing.
        break
      }
    }
  }

  // Fallback for hosts where settings.mutate is absent (or tests providing only settings.update).
  if (value !== undefined && settings && typeof settings.describe === 'function' && typeof settings.update === 'function') {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let descriptor = null
      try {
        descriptor = findDescriptor(settings.describe(), PI_AI_NAMESPACE)
      } catch (error) {
        console.warn('[omnimux] llm-route-sync describe failed:', error instanceof Error ? error.message : String(error))
        return { ok: false, changed: false, reason: 'describe-failed', error }
      }
      if (!descriptor) break
      try {
        await settings.update(PI_AI_NAMESPACE, { providers: { [routeId]: value } }, descriptor.revision)
        return { ok: true, changed: true, reason: 'updated' }
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'SETTINGS_CONFLICT' && attempt === 0) {
          if (process.env.OMNIMUX_DEBUG) console.debug('[omnimux] llm-route-sync retrying update after conflict')
          continue
        }
        console.warn('[omnimux] llm-route-sync update failed:', error instanceof Error ? error.message : String(error))
        break
      }
    }
  }

  if (configEditor && typeof configEditor.edit === 'function') {
    const entry = findPiAiConfigEntry(configEditor)
    if (!entry) return { ok: false, changed: false, reason: 'namespace-absent' }
    try {
      await configEditor.edit(entry, (raw) => {
        const config = isPlainObject(raw) ? raw : {}
        const providers = isPlainObject(config.providers) ? { ...config.providers } : {}
        if (value === undefined) delete providers[routeId]
        else providers[routeId] = value
        return { ...config, providers }
      })
      return { ok: true, changed: true, reason: value === undefined ? 'unset-config-editor' : 'set-config-editor' }
    } catch (error) {
      console.warn('[omnimux] llm-route-sync configEditor edit failed:', error instanceof Error ? error.message : String(error))
      return { ok: false, changed: false, reason: 'write-failed', error }
    }
  }

  return { ok: false, changed: false, reason: 'settings-unavailable' }
}

/**
 * Inspect whether a DSH credential record exists, is confirmed missing, or
 * could not be read due to a transient storage error.
 * @param {any} credentials
 * @param {string} recordKey
 * @returns {Promise<'configured' | 'missing' | 'unknown'>}
 */
async function querySubscriptionRecordState(credentials, recordKey) {
  if (!credentials || !recordKey) return 'unknown'
  if (typeof credentials.describeRecord === 'function') {
    try {
      const info = await credentials.describeRecord(recordKey)
      return info?.configured === true ? 'configured' : 'missing'
    } catch (error) {
      if (process.env.OMNIMUX_DEBUG) console.debug('[omnimux] describeRecord failed:', error?.code || 'error')
      return 'unknown'
    }
  }
  if (typeof credentials.readRecord === 'function') {
    try {
      const record = await credentials.readRecord(recordKey)
      return record !== undefined && record !== null ? 'configured' : 'missing'
    } catch (error) {
      if (process.env.OMNIMUX_DEBUG) console.debug('[omnimux] readRecord failed:', error?.code || 'error')
      return 'unknown'
    }
  }
  return 'unknown'
}

/**
 * Check whether a DSH credential record exists for a subscription route.
 * @param {any} credentials
 * @param {string} recordKey
 * @returns {Promise<boolean>}
 */
export async function hasStoredSubscriptionRecord(credentials, recordKey) {
  return (await querySubscriptionRecordState(credentials, recordKey)) === 'configured'
}

/**
 * List currently routable models for a registered `ctx.llm` provider.
 * Retries once after a microtask when `loader/volatile-update` settles asynchronously.
 * @param {any} llm
 * @param {string} providerId
 * @returns {Promise<Array<{ id: string, name: string }>>}
 */
export async function listLiveProviderModels(llm, providerId) {
  if (!llm || typeof llm.listModels !== 'function' || !providerId) return []
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const models = await llm.listModels(providerId)
      if (Array.isArray(models) && models.length > 0) {
        return models
          .filter((model) => model && typeof model.id === 'string' && model.id.trim())
          .map((model) => ({
            id: model.id.trim(),
            name: nonEmptyString(model.name) || model.id.trim(),
          }))
      }
    } catch (error) {
      if (process.env.OMNIMUX_DEBUG) console.debug('[omnimux] listModels retrying:', providerId, error?.message || 'error')
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return []
}

/**
 * Pick the deterministic default model for a subscription provider strictly from
 * its live routable models — never inventing an unlisted model id.
 * @param {{ preferredDefaultModels?: readonly string[] }} spec
 * @param {Array<{ id: string }>} liveModels
 * @param {string} [preferredModel]
 */
export function pickSubscriptionModel(spec, liveModels, preferredModel = '') {
  const ids = liveModels.map((item) => item.id)
  if (ids.length === 0) return ''
  const chosen = nonEmptyString(preferredModel)
  if (chosen && ids.includes(chosen)) return chosen
  for (const candidate of spec?.preferredDefaultModels ?? []) {
    if (ids.includes(candidate)) return candidate
  }
  return ids[0]
}

/**
 * Activate a subscription provider route in `settings('llm-pi-ai')` after
 * verifying that its `ctx.credentials` grant record is stored.
 *
 * Refuses to overwrite an existing route that carries an explicit `apiKeyEnv`
 * (e.g. a user-configured Anthropic API key route in DSH Models settings).
 */
export async function activateSubscriptionRoute({
  settings,
  configEditor,
  credentials,
  llm,
  agentDefaultModel,
  agentId,
  preferredModel = '',
  setAsDefault = false,
}) {
  const spec = subscriptionSpecFor(agentId)
  if (!spec) return { ok: false, error: 'unsupported-agent' }

  const stored = await hasStoredSubscriptionRecord(credentials, spec.recordKey)
  if (!stored) return { ok: false, error: 'credential-missing', providerId: spec.providerId }

  const existing = readPiAiProviderProfile(settings, configEditor, spec.providerId)
  if (existing && nonEmptyString(existing.apiKeyEnv)) {
    return { ok: false, error: 'api-key-route-exists', providerId: spec.providerId }
  }

  const profile = { ...spec.profile }
  const written = await mutatePiAiProviderRoute({
    settings,
    configEditor,
    routeId: spec.providerId,
    value: profile,
  })
  if (!written.ok) {
    return { ok: false, error: written.reason || 'route-write-failed', providerId: spec.providerId }
  }

  const liveModels = await listLiveProviderModels(llm, spec.providerId)
  const defaultModel = pickSubscriptionModel(spec, liveModels, preferredModel)
  if (setAsDefault && defaultModel && agentDefaultModel && typeof agentDefaultModel.saveSelection === 'function') {
    try {
      await agentDefaultModel.saveSelection({ provider: spec.providerId, model: defaultModel })
    } catch (error) {
      console.warn('[omnimux] saveSelection failed after subscription activate:', error instanceof Error ? error.message : String(error))
    }
  }

  return {
    ok: true,
    providerId: spec.providerId,
    models: liveModels.map((item) => item.id),
    defaultModel,
  }
}

/**
 * Disconnect a subscription provider: delete its `ctx.credentials` record (when
 * requested) and remove its keyless route from `settings('llm-pi-ai')` so no
 * unauthenticated zombie models linger in the composer dropdown.
 */
export async function deactivateSubscriptionRoute({
  settings,
  configEditor,
  credentials,
  agentId,
  deleteCredential = true,
}) {
  const spec = subscriptionSpecFor(agentId)
  if (!spec) return { ok: false, error: 'unsupported-agent' }

  const existingBefore = readPiAiProviderProfile(settings, configEditor, spec.providerId)
  const hadKeylessRoute = Boolean(existingBefore && !nonEmptyString(existingBefore.apiKeyEnv))

  if (deleteCredential && credentials && typeof credentials.deleteRecord === 'function') {
    await credentials.deleteRecord(spec.recordKey)
  }

  const existing = readPiAiProviderProfile(settings, configEditor, spec.providerId)
  if (!existing) {
    return { ok: true, providerId: spec.providerId, routeRemoved: hadKeylessRoute }
  }
  if (nonEmptyString(existing.apiKeyEnv)) {
    return { ok: true, providerId: spec.providerId, routeRemoved: false }
  }

  const removed = await mutatePiAiProviderRoute({
    settings,
    configEditor,
    routeId: spec.providerId,
    value: undefined,
  })
  return {
    ok: removed.ok,
    providerId: spec.providerId,
    routeRemoved: removed.ok && (removed.changed || hadKeylessRoute),
    ...(removed.ok ? {} : { error: removed.reason }),
  }
}

/**
 * Reconcile keyless subscription routes against `ctx.credentials`.
 * Removes any OmniMux-managed subscription route whose `llm-pi-ai/<id>` grant
 * was externally deleted so `dsh-llm-pi-ai.listModels()` never advertises
 * unauthenticated models. Never touches routes that specify `apiKeyEnv`.
 */
export async function reconcileSubscriptionRoutes({ settings, configEditor, credentials }) {
  if (!credentials) return []
  const removed = []
  for (const spec of Object.values(SUBSCRIPTION_PROVIDERS)) {
    const existing = readPiAiProviderProfile(settings, configEditor, spec.providerId)
    if (!existing || nonEmptyString(existing.apiKeyEnv)) continue
    const recordState = await querySubscriptionRecordState(credentials, spec.recordKey)
    if (recordState !== 'missing') continue
    const res = await mutatePiAiProviderRoute({
      settings,
      configEditor,
      routeId: spec.providerId,
      value: undefined,
    })
    if (res.ok && res.changed) removed.push(spec.providerId)
  }
  return removed
}

/**
 * Sync a BYOK text provider (`TextKeyPanel` / `PUT /omnimux/byok/config`) into
 * a collision-free `byok-<provider>` route in `settings('llm-pi-ai')`.
 */
export async function syncByokTextRoute({
  settings,
  configEditor,
  agentDefaultModel,
  provider,
  endpoint,
  model,
  credentialRef,
  bindAsDefault = false,
}) {
  const routeId = byokPiAiRouteId(provider)
  const cleanEndpoint = nonEmptyString(endpoint)
  const cleanModel = nonEmptyString(model)
  const cleanRef = nonEmptyString(credentialRef)
  if (!routeId || !cleanEndpoint || !cleanModel || !cleanRef) {
    return { ok: false, reason: 'invalid-byok-route' }
  }

  const profile = {
    displayName: byokPiAiDisplayName(provider),
    api: byokPiAiApiFor(provider),
    baseURL: cleanEndpoint,
    apiKeyEnv: cleanRef,
    models: [{ id: cleanModel }],
  }
  const written = await mutatePiAiProviderRoute({
    settings,
    configEditor,
    routeId,
    value: profile,
  })
  if (!written.ok) {
    return { ok: false, routeId, reason: written.reason }
  }

  if (bindAsDefault && agentDefaultModel && typeof agentDefaultModel.saveSelection === 'function') {
    try {
      await agentDefaultModel.saveSelection({ provider: routeId, model: cleanModel })
    } catch (error) {
      console.warn('[omnimux] saveSelection failed after BYOK sync:', error instanceof Error ? error.message : String(error))
    }
  }
  return { ok: true, routeId, model: cleanModel }
}

/** Remove a previously synced `byok-<provider>` text route from `settings('llm-pi-ai')`. */
export async function removeByokTextRoute({ settings, configEditor, provider }) {
  const routeId = byokPiAiRouteId(provider)
  if (!routeId) return { ok: true, changed: false, reason: 'invalid-route' }
  return mutatePiAiProviderRoute({
    settings,
    configEditor,
    routeId,
    value: undefined,
  })
}
