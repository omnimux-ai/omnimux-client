import { OmnimuxError } from './errors.js'
import { resolveCurrentSnapshot } from '../catalog/cloud/current.js'
import { findSnapshotModel } from '../catalog/cloud/view.js'
import { effectiveVideoRequestedGroup } from '../catalog/serving/channel-groups.js'
import {
  gatewayCandidates,
  getModelChannelGroups,
  PRODUCT_ID_ALIASES,
  parseModelAndGroup,
  resolveChannelCandidates,
  resolveChannelPlan,
  ROUTING_STRATEGIES,
  toProductId,
} from '../catalog/serving/id-universe.js'

export {
  gatewayCandidates,
  parseModelAndGroup,
  resolveChannelCandidates,
  resolveChannelPlan,
  ROUTING_STRATEGIES,
  toProductId,
}
export const PROTOCOLS = Object.freeze(['openai-media'])
export const AUTH_MODES = Object.freeze(['auto', 'token', 'custom'])

/** @deprecated Compatibility names; these normalize to product IDs, not wire IDs. */
export const MEDIA_WIRE_MODEL_IDS = PRODUCT_ID_ALIASES
export const toMediaWireModelId = toProductId

export const DEFAULT_MEDIA = Object.freeze({
  defaultProvider: 'omnimux',
  authMode: 'auto',
  providers: Object.freeze({
    omnimux: Object.freeze({
      protocol: 'openai-media',
      baseUrl: 'https://api.omnimux.ai/v1',
      apiKeyEnv: 'OMNIMUX_API_KEY',
      models: Object.freeze({
        video: 'seedance-2-5',
        image: 'gpt-image-2.5',
        audio: 'suno',
        stt: 'whisper-1',
      }),
    }),
  }),
})

/**
 * @param {unknown} value
 * @returns {typeof DEFAULT_MEDIA}
 */
export function parseMediaConfig(value) {
  if (value == null) return structuredClone(DEFAULT_MEDIA)
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('omnimux: media config must be an object')
  }
  const input = /** @type {Record<string, unknown>} */ (value)
  const authMode = typeof input.authMode === 'string' && input.authMode.trim()
    ? input.authMode.trim()
    : DEFAULT_MEDIA.authMode
  if (!AUTH_MODES.includes(authMode)) {
    throw new Error(`omnimux: media.authMode must be one of ${AUTH_MODES.join(', ')}`)
  }
  const defaultProvider = typeof input.defaultProvider === 'string' && input.defaultProvider.trim()
    ? input.defaultProvider.trim()
    : DEFAULT_MEDIA.defaultProvider
  const rawProviders = input.providers == null
    ? DEFAULT_MEDIA.providers
    : input.providers
  if (typeof rawProviders !== 'object' || rawProviders == null || Array.isArray(rawProviders)) {
    throw new Error('omnimux: media.providers must be an object')
  }
  /** @type {Record<string, { protocol: string, baseUrl: string, apiKeyEnv?: string, apiKey?: string, models: Record<string, string> }>} */
  const providers = {}
  for (const [id, row] of Object.entries(rawProviders)) {
    if (!id.trim()) throw new Error('omnimux: media provider id must be non-empty')
    if (typeof row !== 'object' || row == null || Array.isArray(row)) {
      throw new Error(`omnimux: media.providers.${id} must be an object`)
    }
    const spec = /** @type {Record<string, unknown>} */ (row)
    const fallback = DEFAULT_MEDIA.providers[id]
    const protocol = String(spec.protocol ?? fallback?.protocol ?? '')
    if (!PROTOCOLS.includes(protocol)) {
      throw new Error(`omnimux: media.providers.${id}.protocol must be one of ${PROTOCOLS.join(', ')}`)
    }
    const baseUrl = String(spec.baseUrl ?? fallback?.baseUrl ?? '').replace(/\/+$/, '')
    if (!baseUrl) throw new Error(`omnimux: media.providers.${id}.baseUrl is required`)
    const apiKeyEnv = spec.apiKeyEnv !== undefined
      ? String(spec.apiKeyEnv)
      : (fallback?.apiKeyEnv !== undefined ? String(fallback.apiKeyEnv) : '')
    const apiKey = typeof spec.apiKey === 'string'
      ? spec.apiKey
      : (typeof fallback?.apiKey === 'string' ? fallback.apiKey : undefined)
    if (!apiKeyEnv && apiKey === undefined) {
      throw new Error(`omnimux: media.providers.${id}.apiKeyEnv is required`)
    }
    const modelsIn = spec.models && typeof spec.models === 'object' && !Array.isArray(spec.models)
      ? /** @type {Record<string, unknown>} */ (spec.models)
      : {}
    /** @type {Record<string, string>} */
    const models = { ...(fallback?.models ?? {}) }
    for (const [cap, model] of Object.entries(modelsIn)) {
      if (typeof model === 'string' && model.trim()) models[cap] = model.trim()
    }
    /** @type {{ protocol: string, baseUrl: string, apiKeyEnv?: string, apiKey?: string, models: Record<string, string> }} */
    const rowObj = { protocol, baseUrl, models }
    if (apiKeyEnv) rowObj.apiKeyEnv = apiKeyEnv
    if (apiKey !== undefined) rowObj.apiKey = apiKey
    providers[id] = rowObj
  }
  if (!providers[defaultProvider]) {
    throw new Error(`omnimux: media.defaultProvider '${defaultProvider}' is not in media.providers`)
  }
  return { authMode, defaultProvider, providers }
}

/**
 * @param {string} capability
 * @param {{ provider?: string, model?: string, group?: string, strategy?: string, allowedGroups?: unknown, taskId?: string, taskRef?: string, resolution?: string }} request
 * @param {ReturnType<typeof parseMediaConfig>} media
 * @param {Record<string, string | undefined>} [env]
 * @param {object} [snapshot]
 */
export function resolveMediaRoute(capability, request, media, env = process.env, snapshot = resolveCurrentSnapshot().snapshot) {
  const providerId = typeof request.provider === 'string' && request.provider.trim()
    ? request.provider.trim()
    : media.defaultProvider
  const row = media.providers[providerId]
  if (!row) {
    throw new OmnimuxError('unknown-provider', `unknown media provider '${providerId}'`)
  }
  if (!PROTOCOLS.includes(row.protocol)) {
    throw new OmnimuxError('unknown-protocol', `unsupported media protocol '${row.protocol}'`)
  }
  const envBase = providerId === 'omnimux' ? env.OMNIMUX_BASE_URL : undefined
  const baseUrl = (envBase || row.baseUrl).replace(/\/+$/, '')
  const envModel = providerId === 'omnimux'
    ? (capability === 'video'
      ? env.OMNIMUX_VIDEO_MODEL
      : capability === 'image'
        ? env.OMNIMUX_IMAGE_MODEL
        : capability === 'audio'
          ? env.OMNIMUX_AUDIO_MODEL
          : capability === 'stt'
            ? env.OMNIMUX_STT_MODEL
            : undefined)
    : undefined
  const catalogModelId = (typeof request.model === 'string' && request.model.trim()
    ? request.model.trim()
    : (envModel || row.models[capability] || ''))
  const { modelId, group: inlineGroup } = parseModelAndGroup(catalogModelId)
  if (!modelId) {
    throw new OmnimuxError('unknown-model', `no model configured for ${providerId}/${capability}`)
  }
  const fieldGroup = typeof request.group === 'string' && request.group.trim() ? request.group.trim() : undefined
  const requestedGroup = inlineGroup || fieldGroup
  const explicitStrategy = typeof request.strategy === 'string' && ROUTING_STRATEGIES.includes(request.strategy)
  const hasAllowedIntent = request.allowedGroups != null
    && (!Array.isArray(request.allowedGroups) || request.allowedGroups.length > 0)
  const allowedGroups = hasAllowedIntent ? request.allowedGroups : undefined
  const callerIntent = Boolean(requestedGroup || hasAllowedIntent || explicitStrategy)
  const catalogModel = providerId === 'omnimux' ? findSnapshotModel(snapshot, modelId) : undefined
  const isCollect = [request.taskId, request.taskRef].some((id) => typeof id === 'string' && id.trim())
  const effective = capability === 'video' && !isCollect ? catalogModel?.effectiveVideo : undefined
  const effectiveGroup = effective ? effectiveVideoRequestedGroup(request) : undefined
  if (effective && !effectiveGroup) {
    throw new OmnimuxError('unknown-group', '请选择一条可用的视频线路并传入 group')
  }

  const hasPublishedDefault = Object.hasOwn(catalogModel ?? {}, 'defaultGroup')
  const hasPublishedOrder = Object.hasOwn(catalogModel ?? {}, 'groupOrder')
  const hasSelectedLine = Boolean(requestedGroup || (Array.isArray(allowedGroups) && allowedGroups.length === 1))
  // Catalogs predating both fields retain their legacy route compatibility.
  const needsDefault = !isCollect && (hasPublishedDefault || hasPublishedOrder) && !hasSelectedLine
  const groups = providerId === 'omnimux' && (!callerIntent || needsDefault) ? getModelChannelGroups(modelId, snapshot) : []
  const preferred = groups.find((group) => group.default === true)
  const lineSelectionRequired = needsDefault && !preferred

  // Pin the selected default to the same snapshot used for route admission.
  // A default cannot fail over into a differently priced group.
  const pinned = callerIntent || lineSelectionRequired || (hasPublishedDefault && !preferred)
    ? undefined : pinnedChannelGroup(groups, preferred, request)
  const pinnedWire = pinned ? (pinned.wireGroup || pinned.id) : undefined
  const group = effectiveGroup ?? requestedGroup ?? pinnedWire
  // This model's lines use incompatible size protocols; an explicitly selected
  // line cannot silently fail over with a body built for another line.
  const effectiveAllowedGroups = effective ? undefined : allowedGroups
    ?? (modelId === 'gpt-image-2.5' && ['standard', 'default', 'economy', 'pro', 'gpt-image-2.5-economy', 'gpt-image-2.5-pro'].includes(requestedGroup) ? [requestedGroup] : undefined)
    ?? (pinnedWire ? [pinnedWire] : undefined)
  const hasRoutingIntent = Boolean(group || hasAllowedIntent || effectiveAllowedGroups || explicitStrategy)

  const plan = providerId === 'omnimux' && !lineSelectionRequired
    ? resolveChannelPlan(catalogModelId, {
      ...(explicitStrategy ? { strategy: request.strategy } : {}),
      group: effectiveGroup ?? fieldGroup ?? pinnedWire,
      allowedGroups: effectiveAllowedGroups,
      snapshot,
    })
    : { candidates: lineSelectionRequired ? [] : [modelId], unresolvedGroups: [] }
  if (!lineSelectionRequired && hasRoutingIntent && plan.candidates.length === 0) {
    // Fail closed: an empty plan means every requested channel was excluded or
    // unknown. Falling back to the bare model would silently widen the pool.
    const detail = plan.unresolvedGroups.length > 0 ? plan.unresolvedGroups.join(', ') : 'no enabled channel group'
    throw new OmnimuxError('unknown-group', `所选渠道分组不可用于 ${modelId}（${detail}）`)
  }

  const apiKey = readProviderKey(providerId, row.apiKeyEnv, row.apiKey, env)
  return {
    providerId,
    protocol: row.protocol,
    baseUrl,
    apiKey,
    apiKeyEnv: row.apiKeyEnv,
    authMode: media.authMode || 'auto',
    modelId,
    group,
    // Reported only when the caller actually asked for a policy, so a legacy
    // request can never be mistaken for an explicit strategy choice.
    strategy: hasRoutingIntent ? (explicitStrategy ? request.strategy : 'auto') : undefined,
    candidates: plan.candidates,
    // Channel ids the plan could not resolve (unknown group, or a model with no pool).
    unresolvedGroups: plan.unresolvedGroups,
    lineSelectionRequired,
    capability,
  }
}

/**
 * Pin the catalog default for a legacy request. Keep resolution-based routing
 * for old callers that specify a resolution without choosing a line.
 *
 * @param {ReturnType<typeof getModelChannelGroups>} groups
 * @param {ReturnType<typeof getModelChannelGroups>[number] | undefined} preferred
 * @param {{ resolution?: unknown }} request
 * @returns {{ wireGroup?: string, id: string } | undefined}
 */
function pinnedChannelGroup(groups, preferred, request) {
  const resolution = typeof request?.resolution === 'string' ? request.resolution.trim() : ''
  if (resolution) {
    const matchesResolution = (group) => {
      const constraint = group?.constraints?.parameters?.resolution
      return constraint?.fixed === resolution
        || (Array.isArray(constraint?.only) && constraint.only.includes(resolution))
    }
    if (preferred && (!preferred.constraints?.parameters?.resolution || matchesResolution(preferred))) return preferred
    const matching = groups.find(matchesResolution)
    if (matching) return matching
  }
  return preferred
}

/**
 * @param {string} providerId
 * @param {string | undefined} apiKeyEnv
 * @param {string | undefined} inlineApiKey
 * @param {Record<string, string | undefined>} env
 */
function readProviderKey(providerId, apiKeyEnv, inlineApiKey, env) {
  const primary = apiKeyEnv ? env[apiKeyEnv] ?? '' : ''
  if (primary) return primary
  if (providerId === 'omnimux' && env.OMNIMUX_TOKEN) return env.OMNIMUX_TOKEN
  if (typeof inlineApiKey === 'string') return inlineApiKey
  return ''
}

/**
 * @param {ReturnType<typeof resolveMediaRoute>} route
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   store?: { resolve: () => Promise<string | undefined> },
 *   credentials?: { resolve: (ref: string) => Promise<{ value?: string } | undefined> },
 *   allowMissingOfficialKey?: boolean,
 * }} [deps]
 * @returns {Promise<{ apiKey: string, authType: 'api-key' | 'none' }>}
 */
export async function resolveMediaAuth(route, deps = {}) {
  const env = deps.env !== undefined ? deps.env : process.env

  // The official media API accepts API keys, not console access tokens.
  // Custom providers retain their own credential format without prefix inference.
  const isUsableKey = (value) => typeof value === 'string' && Boolean(value.trim())
    && (route.providerId !== 'omnimux' || value.trim().startsWith('sk-'))
  const envKeys = [
    route.apiKeyEnv ? env?.[route.apiKeyEnv] : undefined,
    ...(route.providerId === 'omnimux' ? [env?.OMNIMUX_API_KEY, env?.OMNIMUX_TOKEN] : []),
  ]
  const envKey = envKeys.find(isUsableKey)
  if (envKey) {
    return { apiKey: envKey.trim(), authType: 'api-key' }
  }

  // Inline provider configuration follows the same policy; only custom providers
  // may explicitly opt out of authentication with 'none'.
  if (typeof route.apiKey === 'string') {
    if (route.providerId !== 'omnimux' && route.apiKey.trim() === 'none') {
      return { apiKey: '', authType: 'none' }
    }
    if (isUsableKey(route.apiKey)) {
      return { apiKey: route.apiKey.trim(), authType: 'api-key' }
    }
  }

  // Resolve only API-key references from the current operation's credential service.
  // Login PATs and account stores are not media API credentials.
  if (route.providerId === 'omnimux' && deps.credentials && typeof deps.credentials.resolve === 'function') {
    let resolutionError
    for (const ref of ['OMNIMUX_API_KEY', 'OMNIMUX_TOKEN']) {
      try {
        const hit = await deps.credentials.resolve(ref)
        if (isUsableKey(hit?.value)) {
          return { apiKey: hit.value.trim(), authType: 'api-key' }
        }
      } catch (cause) {
        resolutionError ??= cause
      }
    }
    if (resolutionError) {
      throw new OmnimuxError('needs-omnimux', '读取生成服务 API 密钥失败，请检查当前凭证配置', { cause: resolutionError })
    }
  }

  // 4. 若均未获取到：
  if (route.providerId === 'omnimux') {
    if (deps.allowMissingOfficialKey === true) return { apiKey: '', authType: 'none' }
    throw new OmnimuxError('needs-omnimux', '生成服务需要 API 密钥，请在当前凭证中配置 OMNIMUX_API_KEY；登录凭证不能用于生成')
  }
  throw new OmnimuxError('omnimux-unconfigured', `media provider '${route.providerId}' has no apiKey configured`)
}
