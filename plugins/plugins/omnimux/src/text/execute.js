import { OmnimuxError } from '../media/errors.js'
import {
  assertGuardOutput,
  assertGuardSubmit,
} from '../catalog/contract/submit-guard/index.js'
import { parseTextConfig, resolveTextRoute, CHAT_MODEL_IDS } from './catalog.js'
import { completeTextViaChat } from './chat.js'
import { probeTextImage, saveProbedTextImage, toImageUrlPart } from './image.js'
import { loadTextVideo, toVideoImageUrlPart } from './video.js'
import { loadTextAudio, toAudioImageUrlPart } from './audio.js'
import { loadTextDocument, toDocumentImageUrlPart } from './document.js'
import { normalizeTextReferences } from './references.js'
import { resolveScenarioChoice, readScenarioSettings, assertScenarioRequestIntent } from '../settings/runtime-mode.js'
import { parseModelAndGroup, resolveRequestChannelIntent } from '../catalog/serving/channel-groups.js'
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

/**
 * Resolve the active conversation's model from DSH host services:
 * session-bound `agents.get(sessionId).model.current()` first, then
 * `agentDefaultModel.currentSelection()` (updated whenever the user switches
 * the chat model in the composer).
 * @param {{ sessionId?: unknown, agents?: any, agentDefaultModel?: any }} input
 * @returns {{ provider: string, model: string } | null}
 */
function resolveSessionModel(input) {
  const rawSessionId = input.sessionId
  if (rawSessionId !== undefined && rawSessionId !== null && String(rawSessionId).trim() !== ''
    && input.agents && typeof input.agents.get === 'function') {
    const agent = input.agents.get(rawSessionId)
    if (agent?.model && typeof agent.model.current === 'function') {
      const fromAgent = readSelectionPair(agent.model.current())
      if (fromAgent) return fromAgent
    }
  }
  if (input.agentDefaultModel && typeof input.agentDefaultModel.currentSelection === 'function') {
    return readSelectionPair(input.agentDefaultModel.currentSelection())
  }
  return null
}

/**
 * Read one provider's merged `llm-pi-ai` settings profile (base → value → user).
 * @param {unknown} settingsService
 * @param {string} providerId
 * @returns {Record<string, unknown> | null}
 */
function resolvePiAiProviderProfile(settingsService, providerId) {
  if (!settingsService || typeof settingsService !== 'object' || !providerId) return null
  const service = /** @type {{ describe?: Function, get?: Function }} */ (settingsService)
  if (typeof service.describe === 'function') {
    const descriptor = findDescriptor(service.describe(), PI_AI_NAMESPACE)
    if (descriptor) {
      const base = descriptor.base?.providers?.[providerId]
      const value = descriptor.value?.providers?.[providerId]
      const user = descriptor.user?.providers?.[providerId]
      const merged = {
        ...(base && typeof base === 'object' ? base : {}),
        ...(value && typeof value === 'object' ? value : {}),
        ...(user && typeof user === 'object' ? user : {}),
      }
      if (Object.keys(merged).length > 0) return merged
    }
  }
  if (typeof service.get === 'function') {
    const raw = service.get(PI_AI_NAMESPACE)
    const entry = raw && typeof raw === 'object' ? raw.providers?.[providerId] : null
    if (entry && typeof entry === 'object') return entry
  }
  return null
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
  const text = parseTextConfig(input.text)
  const references = normalizeTextReferences(input)
  const hasImage = references.some((asset) => asset.type === 'image')
  const hasVideo = references.some((asset) => asset.type === 'video')
  const hasAudio = references.some((asset) => asset.type === 'audio')
  const hasDocument = references.some((asset) => asset.type === 'document')
  const hasComplexMedia = hasVideo || hasAudio || hasDocument
  const gate = input.gate ?? input.hub?.gate

  // Model resolution when the caller did not pin an explicit model or channel:
  //   1. Plugin config `omnimux.toolModel` (or per-call `input.toolModel`) when set;
  //   2. Otherwise the active session model (`agents.get(sessionId).model.current()`
  //      → `agentDefaultModel.currentSelection()`).
  // No silent fallback or implicit model switching: unsupported modalities,
  // missing providers, or upstream errors fail loudly so the user can switch
  // models or configure `toolModel`.
  try { assertScenarioRequestIntent(input) }
  catch (cause) { throw new OmnimuxError('omnimux-invalid-request', cause.message) }
  const requestedIntent = resolveRequestChannelIntent(input)
  const hasExplicitCallerRoute = Boolean(
    input.model
    || requestedIntent.requestedChannel
    || requestedIntent.effectiveChannel
    || input.strategy
    || (Array.isArray(input.allowedGroups) && input.allowedGroups.length > 0),
  )
  const rawToolModel = input.toolModel ?? readScenarioSettings(input.settings).toolModel
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

    // Official OmniMux provider: when complex media is present (ctx.llm.stream
    // only carries text/image) or when the host supplies an account key
    // resolver, execute strictly on this exact model through direct chat.
    if (pinnedTarget.provider === text.defaultProvider
      && (hasComplexMedia || typeof input.resolveOfficialApiKey === 'function')) {
      const officialEnv = input.env ?? process.env
      const runtime = getRuntimeContractIndex(
        input.catalogIndex ? { localIndex: input.catalogIndex } : {},
      )
      const gatewayTextRows = getGatewayTextRows(
        input.catalogIndex ? { localIndex: input.catalogIndex } : {},
      )
      const route = resolveTextRoute({
        model: pinnedTarget.model,
        references,
      }, text, officialEnv, gate, gatewayTextRows)
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
      })
      assertGuardOutput(guardPlan, officialResult, { capability: 'text' })
      return { ...officialResult, model: compositeModel }
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
      const streamed = await streamTextReply(input.llm, {
        provider: pinnedTarget.provider,
        model: pinnedTarget.model,
        prompt,
        system: pinnedSystem,
        maxTokens: pinnedMaxTokens,
        content,
        signal: input.signal,
        sessionId: input.sessionId,
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
    if (api !== 'openai-completions' || !/^https?:\/\//i.test(providerBaseUrl)) {
      throw new OmnimuxError(
        'omnimux-invalid-request',
        `当前模型（${compositeModel}）不支持${describeMediaTypes(references)}输入，请切换支持多模态的模型或在插件设置中指定工具模型`,
      )
    }
    const keyRef = typeof profile?.apiKeyEnv === 'string' ? profile.apiKeyEnv.trim() : ''
    if (!keyRef) {
      throw new OmnimuxError(
        'omnimux-unconfigured',
        `当前模型提供方（${pinnedTarget.provider}）未配置凭据引用，无法发送${describeMediaTypes(references)}请求`,
      )
    }
    let providerApiKey = ''
    if (input.credentials && typeof input.credentials.resolve === 'function') {
      try {
        const hit = await input.credentials.resolve(keyRef)
        providerApiKey = typeof hit?.value === 'string' ? hit.value.trim() : ''
      } catch (cause) {
        throw new OmnimuxError(
          'omnimux-unconfigured',
          `无法读取模型提供方（${pinnedTarget.provider}）凭据 ${keyRef}：${cause instanceof Error ? cause.message : String(cause)}`,
        )
      }
    }
    const lookupEnv = input.env ?? process.env
    if (!providerApiKey && typeof lookupEnv[keyRef] === 'string') {
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
      credentialScope: 'byok',
    })
    return { ...directResult, model: compositeModel }
  }

  const runtimeSettings = readScenarioSettings(input.settings)
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
    })
    assertGuardOutput(guardPlan, result, { capability: 'text' })
    return result
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
  })
  assertGuardOutput(guardPlan, result, { capability: 'text' })
  return result
}

/**
 * Collect one ctx.llm.stream completion into the textComplete result shape.
 *
 * Shared by the catalog route (provider=hub default) and the tool-model bypass
 * (provider=session provider key) so reasoning-channel filtering, finish-error
 * mapping, and the empty-body guard stay identical on both paths.
 *
 * @param {{ stream: (options: object) => AsyncIterable<object> }} llm
 * @param {{ provider: string, model: string, prompt: string, system: string, maxTokens: number, content: Array<object>, signal?: AbortSignal, sessionId?: unknown }} input
 */
async function streamTextReply(llm, input) {
  const options = {
    provider: input.provider,
    model: input.model,
    messages: [{ role: 'user', content: input.content }],
    maxTokens: input.maxTokens,
    ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
    ...(input.system ? { system: input.system } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
  }
  let assembled = ''
  let sawReasoning = false
  let finish
  for await (const chunk of llm.stream(options)) {
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
  return { mode: 'live', model: input.model, text: assembled }
}
