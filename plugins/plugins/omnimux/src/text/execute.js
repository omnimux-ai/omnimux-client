import { isModelEnabled } from '../gate/guard.js'
import { OmnimuxError } from '../media/errors.js'
import {
  assertGuardOutput,
  assertGuardSubmit,
} from '../catalog/contract/submit-guard/index.js'
import { resolveModelId } from '../catalog/contract/index.js'
import { parseTextConfig, resolveTextRoute, enabledTextModels, CHAT_MODEL_IDS } from './catalog.js'
import { completeTextViaChat } from './chat.js'
import { probeTextImage, saveProbedTextImage, toImageUrlPart } from './image.js'
import { loadTextVideo, toVideoImageUrlPart } from './video.js'
import { loadTextAudio, toAudioImageUrlPart } from './audio.js'
import { loadTextDocument, toDocumentImageUrlPart } from './document.js'
import { normalizeTextReferences } from './references.js'
import { resolveScenarioChoice, readScenarioSettings, assertScenarioRequestIntent } from '../settings/runtime-mode.js'
import { parseModelAndGroup, resolveRequestChannelIntent } from '../catalog/serving/channel-groups.js'
import { ROUTING_STRATEGIES } from '../catalog/serving/id-universe.js'
import { runAgentText } from '../agents/local.js'
import { buildModelCatalog } from '../catalog/list.js'
import { findDescriptor, PI_AI_NAMESPACE } from '../catalog/composer-sync.js'
import { getGatewayTextRows, getRuntimeContractIndex } from '../catalog/runtime-index.js'

/** 识别已知思考通道引导词/纯思考断言的前缀特征 */
const REASONING_PREAMBLE_RE = /^(?:i['’]?m\s+thinking\s+through|let\s+me\s+think|thinking\s+process|thought\s*:)/i

/**
 * One-shot expert completion. Default path: `ctx.llm.stream` (text / image).
 * Video path: bypass stream + attachments and POST chat completions with
 * `image_url` + `data:video/…` (spike-locked protocol). Not a chat turn: no
 * tools, no parent messages, no dest, no poll.
 *
 * SubmitGuard admits every normalized reference and its probed metadata before
 * the attachment store or provider is called. Unsupported media is rejected.
 *
 * @param {{
 *   prompt?: string,
 *   model?: string,
 *   operation?: string,
 *   image?: string,
 *   video?: string,
 *   audio?: string,
 *   document?: string,
 *   audioTrack?: object,
 *   references?: import('./references.js').TextReference[],
 *   system?: string,
 *   maxTokens?: number,
 *   signal?: AbortSignal,
 *   sessionId?: unknown,
 *   env?: Record<string, string | undefined>,
 *   text?: unknown,
 *   gate?: object,
 *   hub?: { gate?: object, text?: unknown },
 *   llm?: { stream: (options: object) => AsyncIterable<object> },
 *   attachments?: { saveImage: Function, imageLimits?: object },
 *   fetcher?: typeof fetch,
 *   apiKey?: string,
 *   baseUrl?: string,
 *   credentials?: { resolve: (ref: string) => Promise<{ value?: string } | undefined> },
 *   settings?: { get?: (section: string) => any, describe?: () => Array<Record<string, unknown>> },
 *   agents?: { get?: (id: unknown) => { model?: { current?: () => { provider?: string, model?: string } | undefined } } | undefined },
 *   agentDefaultModel?: { currentSelection?: () => { provider?: string, model?: string } | undefined },
 *   toolModel?: string,
 *   assetMeta?: object,
 * }} input
 */
const MEDIA_TYPE_LABELS = Object.freeze({
  image: '图片',
  video: '视频',
  audio: '音频',
  document: '文档',
})

function describeMediaTypes(references) {
  const labels = [...new Set(references.map((asset) => MEDIA_TYPE_LABELS[asset.type] || asset.type))]
  return labels.join(' / ') || '多模态'
}

/**
 * Parse a stored `omnimux.toolModel` value ('provider:modelId').
 * @param {unknown} value
 * @returns {{ provider: string, model: string } | null}
 */
function parseToolModel(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'auto') return null
  const sep = trimmed.indexOf(':')
  // The provider key never contains a colon, but a session model id can
  // (Ollama-style tags like 'llama3.1:8b'): split on the FIRST separator only
  // and let the non-empty halves decide validity.
  if (sep < 0) return { provider: '', model: '' }
  return { provider: trimmed.slice(0, sep).trim(), model: trimmed.slice(sep + 1).trim() }
}

/**
 * Normalize one `{ provider, model }` selection pair, or null when incomplete.
 * @param {unknown} selection
 * @returns {{ provider: string, model: string } | null}
 */
function readSelectionPair(selection) {
  if (!selection || typeof selection !== 'object') return null
  const row = /** @type {Record<string, unknown>} */ (selection)
  const provider = typeof row.provider === 'string' ? row.provider.trim() : ''
  const model = typeof row.model === 'string' ? row.model.trim() : ''
  return provider && model ? { provider, model } : null
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function ownPlainEntry(map, key) {
  if (!isPlainObject(map) || !Object.hasOwn(map, key)) return null
  const entry = map[key]
  return isPlainObject(entry) ? entry : null
}

function readAgentModel(agent) {
  if (!agent?.model || typeof agent.model.current !== 'function') return null
  try {
    return readSelectionPair(agent.model.current())
  } catch (cause) {
    console.debug('omnimux:text agent.model.current failed', cause instanceof Error ? cause.message : String(cause))
    return null
  }
}

/**
 * Resolve the active conversation's model from DSH host services:
 *   1. Session-bound `agents.get(sessionId).model.current()` when `sessionId` is provided
 *   2. Ambient `agents.currentInitiator().model.current()` inside an active agent turn
 *   3. `agentDefaultModel.currentSelection()` (updated whenever the user switches
 *      the chat model in the composer)
 * @param {{ sessionId?: unknown, agents?: any, agentDefaultModel?: any }} input
 * @returns {{ provider: string, model: string } | null}
 */
function resolveSessionModel(input) {
  const rawSessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : input.sessionId
  const hasSessionId = rawSessionId !== undefined && rawSessionId !== null
    && (typeof rawSessionId !== 'string' || rawSessionId !== '')
  if (hasSessionId && input.agents && typeof input.agents.get === 'function') {
    try {
      const fromAgent = readAgentModel(input.agents.get(rawSessionId))
      if (fromAgent) return fromAgent
    } catch (cause) {
      console.debug('omnimux:text agents.get failed', cause instanceof Error ? cause.message : String(cause))
    }
  }
  if (input.agents && typeof input.agents.currentInitiator === 'function') {
    try {
      const fromInitiator = readAgentModel(input.agents.currentInitiator())
      if (fromInitiator) return fromInitiator
    } catch (cause) {
      console.debug('omnimux:text agents.currentInitiator failed', cause instanceof Error ? cause.message : String(cause))
    }
  }
  if (input.agentDefaultModel && typeof input.agentDefaultModel.currentSelection === 'function') {
    try {
      return readSelectionPair(input.agentDefaultModel.currentSelection())
    } catch (cause) {
      console.debug('omnimux:text agentDefaultModel.currentSelection failed', cause instanceof Error ? cause.message : String(cause))
      return null
    }
  }
  return null
}

/**
 * Read one provider's effective `llm-pi-ai` settings profile.
 * When DSH supplies `descriptor.value.providers`, treat it as authoritative
 * (already applying `base` + `user` + unset removals) so deleted base providers
 * or fields are never resurrected.
 * @param {unknown} settingsService
 * @param {string} providerId
 * @returns {Record<string, unknown> | null}
 */
function resolvePiAiProviderProfile(settingsService, providerId) {
  if (!settingsService || typeof settingsService !== 'object' || !providerId) return null
  const service = /** @type {{ describe?: Function, get?: Function }} */ (settingsService)
  if (typeof service.describe === 'function') {
    let descriptor = null
    try {
      descriptor = findDescriptor(service.describe(), PI_AI_NAMESPACE)
    } catch (cause) {
      console.debug('omnimux:text settings.describe failed', cause instanceof Error ? cause.message : String(cause))
    }
    if (descriptor) {
      if (isPlainObject(descriptor.value) && isPlainObject(descriptor.value.providers)) {
        return ownPlainEntry(descriptor.value.providers, providerId)
      }
      const base = ownPlainEntry(descriptor.base?.providers, providerId)
      const user = ownPlainEntry(descriptor.user?.providers, providerId)
      if (base || user) {
        return { ...(base ?? {}), ...(user ?? {}) }
      }
    }
  }
  if (typeof service.get === 'function') {
    try {
      const raw = service.get(PI_AI_NAMESPACE)
      return ownPlainEntry(raw?.providers, providerId)
    } catch (cause) {
      console.debug('omnimux:text settings.get failed', cause instanceof Error ? cause.message : String(cause))
      return null
    }
  }
  return null
}

/**
 * One-shot calls may ask for a cheaper reasoning policy than the session
 * default. `inherit` keeps whatever the route resolves on its own; `minimal`
 * picks the lowest level the selected model actually declares. It never
 * invents a level the route did not advertise.
 */
const REASONING_POLICIES = Object.freeze(['inherit', 'minimal'])

/** DSH reasoning levels, least to greatest effort. */
const THINKING_ORDER = Object.freeze(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

/**
 * @param {unknown} value
 * @returns {'inherit' | 'minimal'}
 */
function normalizeReasoningPolicy(value) {
  if (value === undefined || value === null || value === '') return 'inherit'
  const policy = typeof value === 'string' ? value.trim() : ''
  if (!REASONING_POLICIES.includes(policy)) {
    throw new OmnimuxError('omnimux-invalid-request', `reasoning must be one of: ${REASONING_POLICIES.join(', ')}`)
  }
  return /** @type {'inherit' | 'minimal'} */ (policy)
}

/**
 * Lowest reasoning level a provider profile explicitly declares for one model,
 * together with the wire value that level maps to.
 *
 * Only the declaration is trusted: an undeclared dialect is never guessed, so a
 * route that publishes no `reasoningEfforts` keeps its own default. `off` is
 * skipped because it means "omit the option", which is the provider default
 * rather than a downgrade.
 * @param {unknown} settingsService
 * @param {string} providerId
 * @param {string} modelId
 * @param {'inherit' | 'minimal'} policy
 * @returns {{ effort: string, wire: string } | null}
 */
function resolveDeclaredReasoning(settingsService, providerId, modelId, policy) {
  if (policy !== 'minimal') return null
  const profile = resolvePiAiProviderProfile(settingsService, providerId)
  if (!profile || !modelId) return null
  const compat = isPlainObject(profile.compat) ? profile.compat : {}
  if (compat.supportsReasoningEffort === false) return null
  const entry = Array.isArray(profile.models)
    ? profile.models.find((row) => isPlainObject(row) && row.id === modelId)
    : undefined
  const declared = isPlainObject(entry) && isPlainObject(entry.reasoningEfforts) ? entry.reasoningEfforts : null
  if (!declared) return null
  const effort = THINKING_ORDER.find((level) => level !== 'off'
    && typeof declared[level] === 'string' && declared[level].trim() !== '')
  if (!effort) return null
  return { effort, wire: String(declared[effort]).trim() }
}

/**
 * Pick the effort to send on a prepared `ctx.llm` call.
 *
 * A declared level is sent only when the adapter advertises it. With no
 * declaration, or with a level the adapter does not accept, nothing is sent and
 * the route keeps its own default. Returning `null` leaves the call untouched.
 * @param {{ reasoning?: { efforts?: Array<{ id?: unknown }> } }} model
 * @param {string | undefined} preferredEffort
 * @returns {string | null}
 */
function selectAdapterEffort(model, preferredEffort) {
  // Only a level the provider profile actually declared may be sent: pi-ai
  // reports synthetic `off`/`minimal` entries for hand-declared models, and
  // sending one would name a level the upstream never promised.
  if (!preferredEffort) return null
  const efforts = Array.isArray(model?.reasoning?.efforts)
    ? model.reasoning.efforts.map((row) => row?.id).filter((id) => typeof id === 'string' && id)
    : []
  return efforts.includes(preferredEffort) ? preferredEffort : null
}

function safeReadScenarioSettings(settingsService) {
  try {
    return readScenarioSettings(settingsService)
  } catch (cause) {
    console.debug('omnimux:text readScenarioSettings failed', cause instanceof Error ? cause.message : String(cause))
    return {}
  }
}

function readCustomHeaders(profile, modelEntry) {
  const merged = {
    ...(isPlainObject(profile?.headers) ? profile.headers : {}),
    ...(isPlainObject(modelEntry?.headers) ? modelEntry.headers : {}),
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

function isExplicitlyDisabledOfficialModel(baseModelId, text, gate) {
  if (!baseModelId) return false
  if (!isModelEnabled(gate, baseModelId)) return true
  return (text.models ?? []).some((row) => row.id === baseModelId && row.enabled === false)
}

function contractAcceptedModalities(runtimeIndex, modelId) {
  if (!runtimeIndex || !modelId) return null
  const canonicalId = resolveModelId(runtimeIndex, modelId) ?? modelId
  const model = typeof runtimeIndex.get === 'function' ? runtimeIndex.get(canonicalId) : undefined
  if (!model || !Array.isArray(model.operations)) return null
  const modalities = new Set()
  for (const op of model.operations) {
    if (op?.output?.type !== 'text') continue
    for (const slot of Array.isArray(op.inputs) ? op.inputs : []) {
      if (typeof slot?.type === 'string' && slot.type) modalities.add(slot.type)
    }
  }
  return modalities.size > 0 ? modalities : null
}

async function probeMediaReferences(references, input, { requireAttachments = false } = {}) {
  const hasImage = references.some((asset) => asset.type === 'image')
  if (hasImage && requireAttachments && (!input.attachments || typeof input.attachments.saveImage !== 'function')) {
    throw new OmnimuxError('needs-provider', 'image input requires ctx.attachments')
  }
  const probed = []
  const assets = []
  const imageAttachments = input.attachments ?? {}
  for (const asset of references) {
    const media = asset.type === 'image'
      ? await probeTextImage(asset.pathOrUrl, { attachments: imageAttachments, fetcher: input.fetcher, signal: input.signal })
      : asset.type === 'video'
        ? await loadTextVideo(asset.pathOrUrl, { signal: input.signal, fetcher: input.fetcher })
        : asset.type === 'audio'
          ? await loadTextAudio(asset.pathOrUrl, { signal: input.signal, fetcher: input.fetcher })
          : asset.type === 'document'
            ? await loadTextDocument(asset.pathOrUrl, { signal: input.signal, fetcher: input.fetcher })
            : null
    if (!media) {
      throw new OmnimuxError('omnimux-invalid-request', `text completion does not support ${asset.type} input`)
    }
    probed.push(media)
    assets.push({ ...asset, mime: media.mediaType, sizeBytes: media.sizeBytes ?? media.bytes })
  }
  return { probed, assets }
}

function packMediaParts(references, probed) {
  const mediaParts = []
  for (const [index, asset] of references.entries()) {
    const media = probed[index]
    if (!media) continue
    if (asset.type === 'video') mediaParts.push(toVideoImageUrlPart(media))
    else if (asset.type === 'image') mediaParts.push(toImageUrlPart(media))
    else if (asset.type === 'audio') mediaParts.push(toAudioImageUrlPart(media))
    else if (asset.type === 'document') mediaParts.push(toDocumentImageUrlPart(media))
  }
  return mediaParts
}

function buildGateAllows(gate) {
  if (!gate) return undefined
  return (modelId) => {
    const models = gate.models
    if (models && typeof models === 'object' && modelId in models) {
      return models[modelId] !== false
    }
    return true
  }
}

export async function executeOmnimuxText(input) {
  if (input.model === '@agent' || input.model === '@local') {
    const alias = input.model.slice(1)
    if (input.group && !['agent', 'local'].includes(input.group)) throw new OmnimuxError('omnimux-invalid-request', '本机助手与所选渠道相互冲突')
    if (Array.isArray(input.allowedGroups) && input.allowedGroups.length
      && !input.allowedGroups.some((group) => group === 'agent' || group === 'local')) throw new OmnimuxError('omnimux-invalid-request', '本机助手不在允许渠道范围内')
    input = { ...input, model: undefined, group: alias }
  }
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
  if (!prompt) {
    throw new OmnimuxError('omnimux-invalid-request', 'prompt is required')
  }
  // Reasoning policy is opt-in per call. Background mechanical work asks for
  // `minimal`; anything unset keeps the route default so analysis and
  // multimodal deconstruction are never silently weakened.
  const reasoning = normalizeReasoningPolicy(input.reasoning)
  const text = parseTextConfig(input.text)
  const references = normalizeTextReferences(input)
  // `minimal` exists for zero-side-effect text work only. Media analysis and
  // deconstruction must keep the route default: the repair retry is text-only,
  // so a weaker first pass would ask the model to fill gaps without the source.
  if (reasoning === 'minimal' && references.length > 0) {
    throw new OmnimuxError('omnimux-invalid-request', 'reasoning: minimal 只适用于纯文本机械环节，媒体分析请使用 inherit')
  }
  const hasImage = references.some((asset) => asset.type === 'image')
  const hasVideo = references.some((asset) => asset.type === 'video')
  const hasAudio = references.some((asset) => asset.type === 'audio')
  const hasDocument = references.some((asset) => asset.type === 'document')
  const hasComplexMedia = hasVideo || hasAudio || hasDocument
  const gate = input.gate ?? input.hub?.gate

  // Model resolution when the caller did not pin an explicit model or channel:
  //   1. Plugin config `omnimux.toolModel` (or per-call `input.toolModel`) when set;
  //   2. Otherwise the active session model (`agents.get(sessionId).model.current()`
  //      → `agents.currentInitiator().model.current()` → `agentDefaultModel.currentSelection()`).
  // No silent fallback or implicit model switching: unsupported modalities,
  // missing providers, or upstream errors fail loudly so the user can switch
  // models or configure `toolModel`.
  try { assertScenarioRequestIntent(input) }
  catch (cause) { throw new OmnimuxError('omnimux-invalid-request', cause.message) }
  const requestedIntent = resolveRequestChannelIntent(input)
  const explicitModel = typeof input.model === 'string' ? input.model.trim() : ''
  const normalizedStrategy = typeof input.strategy === 'string' ? input.strategy.trim() : ''
  const hasExplicitStrategy = ROUTING_STRATEGIES.includes(normalizedStrategy)
  const hasExplicitAllowedGroups = Array.isArray(input.allowedGroups)
    && input.allowedGroups.some((group) => typeof group === 'string' && group.trim() !== '')
  const hasExplicitCallerRoute = Boolean(
    explicitModel
    || requestedIntent.requestedChannel
    || requestedIntent.effectiveChannel
    || hasExplicitStrategy
    || hasExplicitAllowedGroups,
  )
  const rawToolModel = input.toolModel !== undefined
    ? input.toolModel
    : safeReadScenarioSettings(input.settings).toolModel
  const parsedToolModel = hasExplicitCallerRoute ? null : parseToolModel(rawToolModel)
  let pinnedTarget = null
  if (parsedToolModel !== null) {
    if (!parsedToolModel.provider || !parsedToolModel.model) {
      const stored = typeof rawToolModel === 'string' ? rawToolModel.trim() : ''
      throw new OmnimuxError('omnimux-unconfigured',
        `工具模型不可用${stored ? `（${stored}）` : ''}，请在设置中重新选择`)
    }
    pinnedTarget = parsedToolModel
  } else if (!hasExplicitCallerRoute) {
    pinnedTarget = resolveSessionModel(input)
  }

  if (pinnedTarget !== null) {
    const pinnedMaxTokens = typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens) && input.maxTokens > 0
      ? input.maxTokens
      : text.maxTokens
    const pinnedSystem = typeof input.system === 'string' ? input.system.trim() : ''
    const compositeModel = `${pinnedTarget.provider}:${pinnedTarget.model}`

    // Official OmniMux provider: enforce gate/disable rules symmetrically,
    // honor Contract v2 whitelist + SubmitGuard + @group candidates for
    // whitelisted models, and keep unlisted official session models (such as
    // the fresh desktop default `deepseek-v4-flash`) working on their
    // supported modalities while failing loudly on unsupported media.
    if (pinnedTarget.provider === text.defaultProvider) {
      const { modelId: pinnedBaseModel, group: pinnedInlineGroup } = parseModelAndGroup(pinnedTarget.model)
      if (isExplicitlyDisabledOfficialModel(pinnedBaseModel, text, gate)) {
        throw new OmnimuxError('unknown-model', `model '${pinnedBaseModel}' is not on the enabled text whitelist`)
      }
      const officialEnv = input.env ?? process.env
      const runtime = getRuntimeContractIndex(
        input.catalogIndex ? { localIndex: input.catalogIndex } : {},
      )
      const gatewayTextRows = getGatewayTextRows(
        input.catalogIndex ? { localIndex: input.catalogIndex } : {},
      )
      const enabledOfficial = enabledTextModels(text, gate, gatewayTextRows)
      const isWhitelisted = enabledOfficial.some((row) => row.id === pinnedBaseModel)

      if (isWhitelisted) {
        const route = resolveTextRoute({
          model: pinnedTarget.model,
          references,
        }, text, officialEnv, gate, gatewayTextRows)
        // Declared downgrade target for this exact route: chat and stream lanes
        // read the same declaration so the reported effort cannot drift.
        const declaredReasoning = resolveDeclaredReasoning(input.settings, text.defaultProvider, route.modelId, reasoning)
        const reasoningOut = reasoning === 'inherit' ? {} : { reasoningEffort: declaredReasoning?.effort ?? null }
        const wantsDirectChat = hasComplexMedia
          || (route.routed && route.candidates.length > 0)
          || typeof input.resolveOfficialApiKey === 'function'
        if (wantsDirectChat) {
          const { probed, assets } = await probeMediaReferences(references, input, { requireAttachments: false })
          const guardPlan = assertGuardSubmit(
            {
              prompt,
              model: route.modelId,
              operation: input.operation,
              assets,
              system: pinnedSystem,
              maxTokens: pinnedMaxTokens,
              seam: 'textComplete',
              capability: 'text',
            },
            {
              index: runtime.index,
              specsDir: input.specsDir,
              seam: 'textComplete',
              capability: 'text',
              outputType: 'text',
              gateAllows: buildGateAllows(gate),
            },
          )
          const mediaParts = packMediaParts(references, probed)
          const officialResult = await completeTextViaChat({
            model: route.modelId,
            candidates: route.candidates,
            prompt,
            system: pinnedSystem,
            maxTokens: pinnedMaxTokens,
            mediaParts,
            env: officialEnv,
            fetcher: input.fetcher,
            signal: input.signal,
            apiKey: input.apiKey,
            baseUrl: input.baseUrl,
            credentials: input.credentials,
            settings: input.settings,
            resolveOfficialApiKey: input.resolveOfficialApiKey,
            ...(declaredReasoning ? { reasoningEffort: declaredReasoning.wire } : {}),
          })
          assertGuardOutput(guardPlan, officialResult, { capability: 'text' })
          return { ...officialResult, model: compositeModel, ...reasoningOut }
        }
        if (!input.llm || typeof input.llm.stream !== 'function') {
          throw new OmnimuxError('needs-provider', 'textComplete requires ctx.llm')
        }
        const { probed, assets } = await probeMediaReferences(references, input, { requireAttachments: true })
        const guardPlan = assertGuardSubmit(
          {
            prompt,
            model: route.modelId,
            operation: input.operation,
            assets,
            system: pinnedSystem,
            maxTokens: pinnedMaxTokens,
            seam: 'textComplete',
            capability: 'text',
          },
          {
            index: runtime.index,
            specsDir: input.specsDir,
            seam: 'textComplete',
            capability: 'text',
            outputType: 'text',
            gateAllows: buildGateAllows(gate),
          },
        )
        const content = [{ type: 'text', text: prompt }]
        for (const media of probed) {
          const attachment = await saveProbedTextImage(media, input.attachments)
          content.push({ type: 'image', attachment })
        }
        const streamed = await streamTextReply(input.llm, {
          provider: pinnedTarget.provider,
          model: route.modelId,
          prompt,
          system: pinnedSystem,
          maxTokens: pinnedMaxTokens,
          content,
          signal: input.signal,
          sessionId: input.sessionId,
          reasoningPolicy: reasoning,
          ...(declaredReasoning ? { preferredEffort: declaredReasoning.effort } : {}),
        })
        assertGuardOutput(guardPlan, streamed, { capability: 'text' })
        return { ...streamed, model: compositeModel }
      }

      // Unlisted official session models (for example the desktop default) have
      // no whitelist row; resolve their declaration by the same base model id.
      const unlistedReasoning = resolveDeclaredReasoning(input.settings, text.defaultProvider, pinnedBaseModel, reasoning)

      if (references.length > 0) {
        const accepted = contractAcceptedModalities(runtime.index, pinnedBaseModel)
        if (accepted) {
          const unsupported = references.filter((asset) => !accepted.has(asset.type))
          if (unsupported.length > 0) {
            throw new OmnimuxError(
              'omnimux-invalid-request',
              `当前模型（${compositeModel}）不支持${describeMediaTypes(unsupported)}输入，请切换支持多模态的模型或在插件设置中指定工具模型`,
            )
          }
        }
      }
      if (hasComplexMedia || Boolean(pinnedInlineGroup) || typeof input.resolveOfficialApiKey === 'function') {
        const { probed } = await probeMediaReferences(references, input, { requireAttachments: false })
        const mediaParts = packMediaParts(references, probed)
        const officialResult = await completeTextViaChat({
          model: pinnedTarget.model,
          prompt,
          system: pinnedSystem,
          maxTokens: pinnedMaxTokens,
          mediaParts,
          env: officialEnv,
          fetcher: input.fetcher,
          signal: input.signal,
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
          credentials: input.credentials,
          settings: input.settings,
          resolveOfficialApiKey: input.resolveOfficialApiKey,
          ...(unlistedReasoning ? { reasoningEffort: unlistedReasoning.wire } : {}),
        })
        return {
          ...officialResult,
          model: compositeModel,
          ...(reasoning === 'inherit' ? {} : { reasoningEffort: unlistedReasoning?.effort ?? null }),
        }
      }
    }

    // Text and image inputs ride DSH native `ctx.llm.stream` on the exact
    // pinned provider:model; adapter, modality, and upstream errors surface
    // directly with zero fallback.
    if (!hasComplexMedia) {
      if (!input.llm || typeof input.llm.stream !== 'function') {
        throw new OmnimuxError('needs-provider', 'textComplete requires ctx.llm')
      }
      const { probed } = await probeMediaReferences(references, input, { requireAttachments: true })
      const content = [{ type: 'text', text: prompt }]
      for (const media of probed) {
        const attachment = await saveProbedTextImage(media, input.attachments)
        content.push({ type: 'image', attachment })
      }
      const pinnedReasoning = resolveDeclaredReasoning(input.settings, pinnedTarget.provider, pinnedTarget.model, reasoning)
      const streamed = await streamTextReply(input.llm, {
        provider: pinnedTarget.provider,
        model: pinnedTarget.model,
        prompt,
        system: pinnedSystem,
        maxTokens: pinnedMaxTokens,
        content,
        signal: input.signal,
        sessionId: input.sessionId,
        reasoningPolicy: reasoning,
        ...(pinnedReasoning ? { preferredEffort: pinnedReasoning.effort } : {}),
      })
      return { ...streamed, model: compositeModel }
    }

    // Complex media (video / audio / document) on a non-omnimux session or
    // tool provider: stay strictly on the pinned provider:model. Only an
    // `openai-completions` profile with an explicit http(s) baseURL can carry
    // inline data URIs; every other protocol fails loudly without switching
    // models or leaking official credentials.
    const profile = resolvePiAiProviderProfile(input.settings, pinnedTarget.provider)
    const modelEntry = Array.isArray(profile?.models)
      ? profile.models.find((entry) => entry && typeof entry === 'object' && entry.id === pinnedTarget.model)
      : null
    const api = (typeof modelEntry?.api === 'string' && modelEntry.api.trim())
      || (typeof profile?.api === 'string' && profile.api.trim())
      || ''
    const providerBaseUrl = (typeof modelEntry?.baseUrl === 'string' && modelEntry.baseUrl.trim())
      || (typeof modelEntry?.baseURL === 'string' && modelEntry.baseURL.trim())
      || (typeof profile?.baseURL === 'string' && profile.baseURL.trim())
      || (typeof profile?.baseUrl === 'string' && profile.baseUrl.trim())
      || ''
    const complexReferences = references.filter((asset) => asset.type !== 'image')
    if (api !== 'openai-completions' || !/^https?:\/\//i.test(providerBaseUrl)) {
      throw new OmnimuxError(
        'omnimux-invalid-request',
        `当前模型（${compositeModel}）不支持${describeMediaTypes(complexReferences)}输入，请切换支持多模态的模型或在插件设置中指定工具模型`,
      )
    }
    const keyRef = typeof profile?.apiKeyEnv === 'string' ? profile.apiKeyEnv.trim() : ''
    if (!keyRef) {
      throw new OmnimuxError(
        'omnimux-unconfigured',
        `当前模型提供方（${pinnedTarget.provider}）未配置凭据引用，无法发送${describeMediaTypes(complexReferences)}请求`,
      )
    }
    let providerApiKey = ''
    if (input.credentials && typeof input.credentials.resolve === 'function') {
      try {
        const hit = await input.credentials.resolve(keyRef)
        providerApiKey = typeof hit?.value === 'string' ? hit.value.trim() : ''
      } catch {
        throw new OmnimuxError(
          'omnimux-unconfigured',
          `无法读取模型提供方（${pinnedTarget.provider}）凭据 ${keyRef}，请检查凭据服务`,
        )
      }
    }
    const lookupEnv = input.env ?? process.env
    if (!providerApiKey && Object.hasOwn(lookupEnv, keyRef) && typeof lookupEnv[keyRef] === 'string') {
      providerApiKey = lookupEnv[keyRef].trim()
    }
    if (!providerApiKey) {
      throw new OmnimuxError(
        'omnimux-unconfigured',
        `当前模型提供方（${pinnedTarget.provider}）缺少凭据 ${keyRef}，请在模型设置中配置后重试`,
      )
    }
    const { probed } = await probeMediaReferences(references, input, { requireAttachments: false })
    const mediaParts = packMediaParts(references, probed)
    const customHeaders = readCustomHeaders(profile, modelEntry)
    const directResult = await completeTextViaChat({
      model: pinnedTarget.model,
      prompt,
      system: pinnedSystem,
      maxTokens: pinnedMaxTokens,
      mediaParts,
      env: {},
      fetcher: input.fetcher,
      signal: input.signal,
      apiKey: providerApiKey,
      baseUrl: providerBaseUrl,
      preserveBaseUrl: true,
      ...(customHeaders ? { headers: customHeaders } : {}),
      credentialScope: 'byok',
    })
    return { ...directResult, model: compositeModel }
  }

  const runtimeSettings = safeReadScenarioSettings(input.settings)
  const runtime = getRuntimeContractIndex(
    input.catalogIndex ? { localIndex: input.catalogIndex } : {},
  )
  const gatewayTextRows = getGatewayTextRows(
    input.catalogIndex ? { localIndex: input.catalogIndex } : {},
  )
  const gatewayTextIds = new Set(gatewayTextRows.map((row) => row.id))
  const scenario = references.length ? 'analysis' : 'text'
  const { modelId: inputModelId } = parseModelAndGroup(input.model)
  const channelIntent = requestedIntent
  const targetChannel = String(channelIntent.requestedChannel || channelIntent.effectiveChannel || '').toLowerCase().trim()
  const isExplicitAgent = targetChannel === 'agent' || targetChannel === 'local'
  const explicitOfficial = channelIntent.isOfficialChannel
    || Boolean(inputModelId && (CHAT_MODEL_IDS.includes(inputModelId) || gatewayTextIds.has(inputModelId)) && !targetChannel)
  let scenarioSettings = runtimeSettings
  if (channelIntent.isByokChannel || isExplicitAgent || explicitOfficial) {
    const binding = channelIntent.isByokChannel
      ? { channel: 'byok', provider: channelIntent.byokProvider }
      : { channel: isExplicitAgent ? 'agent' : 'official' }
    scenarioSettings = { ...runtimeSettings,
      scenarioBindings: { ...runtimeSettings.scenarioBindings, [scenario]: binding } }
  }
  const choice = resolveScenarioChoice(scenarioSettings, scenario)
  if (isExplicitAgent && references.length) throw new OmnimuxError('omnimux-invalid-request', '本机助手只承接纯文字，请配置素材理解服务')
  if (targetChannel && !channelIntent.isByokChannel && !isExplicitAgent && !channelIntent.isOfficialChannel) {
    throw new OmnimuxError('unknown-group', '所选文字渠道不可用')
  }
  if (!choice.configured) {
    if (scenario === 'analysis' && choice.channel === 'pending') {
      throw new OmnimuxError('analysis-service-unconfigured', '素材理解服务尚未确认，请选择分析服务')
    }
    throw new OmnimuxError('omnimux-unconfigured', choice.reason || '此用途尚未配置')
  }
  const useByok = choice.channel === 'byok'
  const useAgent = choice.channel === 'agent'
  if (useAgent && references.length) throw new OmnimuxError('omnimux-invalid-request', '本机助手只承接纯文字，请配置素材理解服务')
  const isOfficialRequest = choice.channel === 'official'
  if (isOfficialRequest && !input.env) input = { ...input, env: process.env }

  // Local agent: text goes to the selected CLI and back. Media references are
  // out of scope for the agent path in this version — only plain text rides it.
  if (useAgent) {
    if (references.length > 0) {
      throw new OmnimuxError('omnimux-invalid-request', '本机助手目前只承接纯文字任务')
    }
    try {
      const agentRun = typeof input.agentRun === 'function' ? input.agentRun : runAgentText
      const agentModel = inputModelId || String(runtimeSettings?.runtimeAgentModel ?? '').trim()
      const text2 = await agentRun({
        id: String(runtimeSettings?.runtimeAgentId ?? ''),
        prompt,
        model: agentModel,
      })
      const result = {
        mode: 'live',
        model: String(runtimeSettings?.runtimeAgentId ?? 'agent'),
        text: text2,
      }
      if (agentModel) {
        result.agentModel = agentModel
      }
      return result
    } catch (error) {
      const message = typeof error?.message === 'string' ? error.message : String(error)
      throw new OmnimuxError('omnimux-failed', message)
    }
  }

  // The official route — its whitelist, channel plan and submit guard — only
  // applies when the request actually rides it. A BYOK endpoint knows its own
  // model names, so none of that machinery may run for it.
  //
  // Task-model split: pure text rides `defaultTextModel`; multimodal
  // understanding (references.length > 0 → analysis scenario) rides
  // `defaultAnalysisModel`. Both must still be a catalog row whose `input`
  // covers every reference asset type — a saved id that the hub no longer
  // serves or that cannot take the asset simply falls back to the catalog
  // recommendation rather than silently submitting an incompatible call.
  let officialText = text
  if (isOfficialRequest && !input.model) {
    const catalog = buildModelCatalog({ text, gate, env: input.env || {}, settingsDefaults: runtimeSettings })
    // `defaults.text` is the plain-text pick; `defaults.analysis` is already a
    // compatibility-filtered multimodal pick (catalog/list.js), so a saved id
    // that can't take the references degrades to it instead of an invalid call.
    const candidate = references.length
      ? catalog.defaults.analysis || catalog.defaults.text
      : catalog.defaults.text
    const compatible = catalog.text.find((row) => row.id === candidate)
    if (compatible && references.every((asset) => (compatible.input ?? ['text']).includes(asset.type))) {
      officialText = { ...text, defaultModel: candidate }
    } else if (references.length === 0 && candidate) {
      officialText = { ...text, defaultModel: candidate }
    }
  }
  const route = useByok
    ? null
    : resolveTextRoute({
      model: input.model,
      references,
      strategy: input.strategy,
      group: input.group,
      allowedGroups: input.allowedGroups,
    }, officialText, input.env, gate, gatewayTextRows)

  const maxTokens = typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens) && input.maxTokens > 0
    ? input.maxTokens
    : (route ? route.maxTokens : text.maxTokens)
  const system = typeof input.system === 'string' ? input.system.trim() : ''

  const { probed, assets } = await probeMediaReferences(references, input, { requireAttachments: true })
  // BYOK models are user-defined; the official submit/output guard does not
  // know them, so it only runs for the official route.
  const guardPlan = useByok
    ? { plan: null, byok: true }
    : assertGuardSubmit(
    {
      prompt,
      model: route.modelId,
      operation: input.operation,
      assets,
      system,
      maxTokens,
      seam: 'textComplete',
      capability: 'text',
    },
    {
      // Runtime index includes gateway Contract v2 models; tests may inject a
      // fixture local index, which is promoted through the same overlay.
      index: runtime.index,
      specsDir: input.specsDir,
      seam: 'textComplete',
      capability: 'text',
      outputType: 'text',
      gateAllows: buildGateAllows(gate),
    },
  )

  // BYOK mode: every text request goes directly to the user's endpoint.
  // This runs before the official channel/stream split so it always wins.
  if (useByok) {
    const mediaParts = packMediaParts(references, probed)
    const hit = await input.credentials?.resolve?.(choice.credentialRef)
    const byokKey = typeof hit?.value === 'string' ? hit.value.trim() : ''
    if (!byokKey) {
      throw new OmnimuxError('omnimux-unconfigured', '自备密钥未找到，请在设置中重新填写')
    }
    const byokEndpoint = choice.endpoint
    if (!byokEndpoint) {
      throw new OmnimuxError('omnimux-unconfigured', '自备密钥缺少接口地址')
    }
    // The user's endpoint knows their model, not the official directory's.
    // An explicit caller model wins; otherwise the tested runtimeKeyModel goes.
    const byokModel = (typeof input.model === 'string' ? input.model.split('@')[0].trim() : '') || choice.model
    if (!byokModel) {
      throw new OmnimuxError('omnimux-unconfigured', '自备密钥缺少模型名')
    }
    const result = await completeTextViaChat({
      model: byokModel,
      prompt,
      system,
      maxTokens,
      mediaParts,
      env: input.env,
      fetcher: input.fetcher,
      signal: input.signal,
      apiKey: byokKey,
      credentialScope: 'byok',
      baseUrl: byokEndpoint,
      credentials: input.credentials,
    })
    if (!guardPlan?.byok) {
      assertGuardOutput(guardPlan, result, { capability: 'text' })
    }
    return result
  }

  // A channel selection cannot ride `ctx.llm.stream`: the harness resolves the
  // model id against the provider's declared list, so `model@group` fails before
  // any request. Routing intent therefore uses the same direct chat path as a
  // video input, which carries the group and its failover candidates.
  const wantsChannels = route.routed && route.candidates.length > 0
  const usesAccountKeyResolver = isOfficialRequest && typeof input.resolveOfficialApiKey === 'function'
  const declaredReasoning = resolveDeclaredReasoning(input.settings, route.providerId, route.modelId, reasoning)
  if (hasComplexMedia || wantsChannels || usesAccountKeyResolver) {
    const mediaParts = packMediaParts(references, probed)
    const result = await completeTextViaChat({
      model: route.modelId,
      candidates: route.candidates,
      prompt,
      system,
      maxTokens,
      mediaParts,
      env: input.env,
      fetcher: input.fetcher,
      signal: input.signal,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      credentials: input.credentials,
      settings: input.settings,
      resolveOfficialApiKey: input.resolveOfficialApiKey,
      ...(declaredReasoning ? { reasoningEffort: declaredReasoning.wire } : {}),
    })
    assertGuardOutput(guardPlan, result, { capability: 'text' })
    return reasoning === 'inherit'
      ? result
      : { ...result, reasoningEffort: declaredReasoning?.effort ?? null }
  }

  if (!input.llm || typeof input.llm.stream !== 'function') {
    throw new OmnimuxError('needs-provider', 'textComplete requires ctx.llm')
  }
  const content = [{ type: 'text', text: prompt }]
  for (const media of probed) {
    const attachment = await saveProbedTextImage(media, input.attachments)
    content.push({ type: 'image', attachment })
  }
  const result = await streamTextReply(input.llm, {
    provider: route.providerId,
    model: route.modelId,
    prompt,
    system,
    maxTokens,
    content,
    signal: input.signal,
    sessionId: input.sessionId,
    reasoningPolicy: reasoning,
    ...(declaredReasoning ? { preferredEffort: declaredReasoning.effort } : {}),
  })
  assertGuardOutput(guardPlan, result, { capability: 'text' })
  return result
}

/**
 * Collect one ctx.llm.stream completion into the textComplete result shape.
 *
 * Shared by the catalog route (provider=hub default) and the pinned session /
 * tool-model lane (provider=session provider key) so reasoning-channel
 * filtering, finish-error mapping, and the empty-body guard stay identical on
 * both paths.
 *
 * @param {{ stream: (options: object) => AsyncIterable<object>, prepareCall?: (config: object, signal: AbortSignal | undefined, configure: (controls: object, model: object) => object) => Promise<{ config: object, stream: (options: object) => AsyncIterable<object> }> }} llm
 * @param {{ provider: string, model: string, prompt: string, system: string, maxTokens: number, content: Array<object>, signal?: AbortSignal, sessionId?: unknown, reasoningPolicy?: string, preferredEffort?: string }} input
 */
async function streamTextReply(llm, input) {
  const policy = normalizeReasoningPolicy(input.reasoningPolicy)
  const config = { provider: input.provider, model: input.model, maxTokens: input.maxTokens }
  const request = {
    messages: [{ role: 'user', content: input.content }],
    ...(input.system ? { system: input.system } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
  }
  /** Effective level, recorded only when a downgrade was requested. */
  let appliedEffort = null
  let stream
  if (policy === 'minimal' && typeof llm.prepareCall === 'function') {
    // `prepareCall` resolves the exact model metadata and materializes adapter
    // defaults before dispatch; it also re-validates the level, so an effort the
    // adapter does not advertise is never sent.
    const prepared = await llm.prepareCall(config, input.signal, (controls, model) => {
      const effort = selectAdapterEffort(model, input.preferredEffort)
      if (!effort) return controls
      appliedEffort = effort
      return { ...controls, reasoningEffort: effort }
    })
    stream = prepared.stream({ ...prepared.config, ...request })
  } else {
    // Legacy or test hosts expose only `stream`; keep the untouched call.
    stream = llm.stream({ ...config, ...request })
  }
  let assembled = ''
  let sawReasoning = false
  let finish
  for await (const chunk of stream) {
    if (!chunk || typeof chunk !== 'object') continue
    const row = /** @type {Record<string, unknown>} */ (chunk)
    // Reasoning is a separate channel: it must never accumulate into the body,
    // otherwise a thinking preamble ships as the business answer.
    if (typeof row.type === 'string' && (row.type === 'reasoning-delta' || row.type === 'reasoning'
      || row.type === 'thinking-delta' || row.type === 'thinking')) {
      sawReasoning = true
      continue
    }
    if (row.type === 'text-delta' && typeof row.text === 'string') assembled += row.text
    if (row.type === 'block-end' && row.block && typeof row.block === 'object') {
      const block = /** @type {Record<string, unknown>} */ (row.block)
      if (block.type === 'reasoning' || block.type === 'thinking') {
        sawReasoning = true
        continue
      }
      if (block.type === 'text' && typeof block.text === 'string') {
        // A closed text block is authoritative for its own content: prefer it
        // over whatever partial deltas preceded it, especially if preceding deltas
        // only held reasoning preambles.
        const trimmedCurrent = assembled.trim()
        if (!trimmedCurrent || REASONING_PREAMBLE_RE.test(trimmedCurrent) || block.text.length > assembled.length) {
          assembled = block.text
        }
      }
    }
    if (row.type === 'finish') finish = row
  }
  const reason = finish && typeof finish.reason === 'object' && finish.reason
    ? /** @type {Record<string, unknown>} */ (finish.reason)
    : undefined
  if (reason?.kind === 'error' || reason?.kind === 'aborted') {
    const failure = reason.failure && typeof reason.failure === 'object'
      ? /** @type {Record<string, unknown>} */ (reason.failure)
      : undefined
    const message = typeof failure?.message === 'string' && failure.message.trim()
      ? failure.message
      : `text complete ${reason.kind}`
    throw new OmnimuxError('omnimux-failed', message)
  }
  const trimmedFinal = assembled.trim()
  if (!trimmedFinal || (REASONING_PREAMBLE_RE.test(trimmedFinal) && trimmedFinal.length < 120)) {
    throw new OmnimuxError('omnimux-invalid-response', (sawReasoning || REASONING_PREAMBLE_RE.test(trimmedFinal))
      ? '模型只返回了思考过程，没有给出正文，请重试或降低推理等级'
      : 'text complete produced no text')
  }
  return {
    mode: 'live',
    model: input.model,
    text: assembled,
    ...(policy === 'inherit' ? {} : { reasoningEffort: appliedEffort }),
  }
}
