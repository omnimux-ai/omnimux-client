// @ts-nocheck
import assert, { strictEqual, deepEqual } from 'node:assert/strict'
import { test } from 'node:test'
import { OmnimuxError } from '../media/errors.js'
import { parseGateConfig } from '../gate/config.js'
import { executeOmnimuxText } from './execute.js'
import { parseTextConfig } from './catalog.js'

const PNG_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAAA'
const MP4_DATA_URI = `data:video/mp4;base64,${Buffer.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]).toString('base64')}`
const WAV_DATA_URI = `data:audio/wav;base64,${Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]).toString('base64')}`
const PDF_DATA_URI = `data:application/pdf;base64,${Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35]).toString('base64')}`

/** Settings seam combining omnimux plugin config and llm-pi-ai provider profiles. */
function settingsWith(omnimuxConfig = {}, piAiProviders = {}) {
  return {
    get(section) {
      if (section === 'omnimux') return omnimuxConfig
      if (section === 'llm-pi-ai') return { providers: piAiProviders }
      return {}
    },
    describe() {
      return [
        { ns: 'omnimux', value: omnimuxConfig, user: omnimuxConfig },
        { ns: 'llm-pi-ai', base: { providers: piAiProviders }, user: {} },
      ]
    },
  }
}

function llmRecorder(calls, onStream) {
  return {
    async *stream(options) {
      calls.push(options)
      if (typeof onStream === 'function') {
        const text = await onStream(options)
        yield { type: 'text-delta', text }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      yield { type: 'text-delta', text: `${options.provider}:${options.model} reply` }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
}

test('configured toolModel without a registered adapter fails loudly with zero fallback', async () => {
  const calls = []
  let agentCalls = 0
  let catalogReads = 0
  await assert.rejects(
    () => executeOmnimuxText({
      prompt: '写一句测试',
      text: parseTextConfig(undefined),
      settings: settingsWith({
        toolModel: 'cpa:gpt-6.1-sol',
        runtimeAgentId: 'codex',
        runtimeAgentModel: 'gpt-6.1-sol',
        runtimeAgentVerified: true,
      }),
      llm: llmRecorder(calls, () => { throw new Error('no adapter registered for provider "cpa"') }),
      agentRun: () => { agentCalls += 1; return 'must not run' },
      modelCatalog: () => { catalogReads += 1; return { default: { provider: 'deepseek-official', model: 'deepseek-flash' } } },
      agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }) },
      env: {},
    }),
    /no adapter registered for provider "cpa"/,
  )
  strictEqual(calls.length, 1, 'must not retry another provider')
  strictEqual(calls[0].provider, 'cpa')
  strictEqual(calls[0].model, 'gpt-6.1-sol')
  strictEqual(agentCalls, 0, 'must never fall back to local CLI agent')
  strictEqual(catalogReads, 0, 'must never fall back to catalog default')
})

test('non-adapter tool model failures stay visible', async () => {
  const calls = []
  const llm = {
    async *stream(options) {
      calls.push(options.provider)
      throw new Error('model overloaded')
    },
  }
  await assert.rejects(
    () => executeOmnimuxText({
      prompt: '写一句测试',
      text: parseTextConfig(undefined),
      settings: settingsWith({ toolModel: 'cpa:gpt-6.1-sol' }),
      llm,
      env: {},
    }),
    /model overloaded/,
  )
  deepEqual(calls, ['cpa'])
})

test('when toolModel is auto or unset, execution follows agentDefaultModel and ignores legacy scenarioBindings', async () => {
  for (const toolModel of ['', 'auto']) {
    const calls = []
    let agentCalls = 0
    const result = await executeOmnimuxText({
      prompt: '翻译这段话',
      text: parseTextConfig(undefined),
      settings: settingsWith({
        toolModel,
        defaultTextModel: 'seed-evolving',
        defaultAnalysisModel: 'gemini-3.8-flash',
        runtimeMode: 'agent',
        runtimeAgentId: 'qwen',
        runtimeAgentVerified: true,
        scenarioBindings: { text: { channel: 'agent' }, analysis: { channel: 'official' } },
      }),
      agentDefaultModel: { currentSelection: () => ({ provider: 'custom-gw', model: 'deepseek-v4-flash' }) },
      llm: llmRecorder(calls),
      agentRun: () => { agentCalls += 1; return 'must not hijack' },
      env: {},
    })
    strictEqual(calls.length, 1)
    strictEqual(calls[0].provider, 'custom-gw')
    strictEqual(calls[0].model, 'deepseek-v4-flash')
    strictEqual(result.model, 'custom-gw:deepseek-v4-flash')
    strictEqual(agentCalls, 0)
  }
})

test('session-bound agent.model.current() wins over agentDefaultModel and tracks live model switches', async () => {
  let defaultSelection = { provider: 'prov-a', model: 'model-a' }
  const calls = []
  const agents = {
    get(id) {
      if (id === 'sess-1') return { model: { current: () => ({ provider: 'prov-session', model: 'model-session' }) } }
      return undefined
    },
  }
  const agentDefaultModel = { currentSelection: () => defaultSelection }

  const r1 = await executeOmnimuxText({
    prompt: 'first',
    sessionId: 'sess-1',
    settings: settingsWith({ toolModel: 'auto' }),
    agents,
    agentDefaultModel,
    llm: llmRecorder(calls),
    env: {},
  })
  strictEqual(r1.model, 'prov-session:model-session')

  const r2 = await executeOmnimuxText({
    prompt: 'second',
    settings: settingsWith({ toolModel: '' }),
    agents,
    agentDefaultModel,
    llm: llmRecorder(calls),
    env: {},
  })
  strictEqual(r2.model, 'prov-a:model-a')

  defaultSelection = { provider: 'prov-b', model: 'model-b' }
  const r3 = await executeOmnimuxText({
    prompt: 'third',
    settings: settingsWith({ toolModel: '' }),
    agents,
    agentDefaultModel,
    llm: llmRecorder(calls),
    env: {},
  })
  strictEqual(r3.model, 'prov-b:model-b')
  deepEqual(calls.map((c) => `${c.provider}:${c.model}`), [
    'prov-session:model-session',
    'prov-a:model-a',
    'prov-b:model-b',
  ])
})

test('unsupported image modality on the followed session model fails naturally without falling back', async () => {
  const calls = []
  let httpCalls = 0
  await assert.rejects(
    () => executeOmnimuxText({
      prompt: '看图分析',
      image: PNG_DATA_URI,
      settings: settingsWith({ toolModel: 'auto', scenarioBindings: { analysis: { channel: 'official' } } }),
      agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'text-only-chat' }) },
      attachments: { saveImage: async (img) => ({ attachmentId: 'att-img', mediaType: img.mediaType, bytes: img.data.byteLength }) },
      llm: llmRecorder(calls, () => {
        throw Object.assign(new Error('pi-ai model "text-only-chat" does not support image input'), { code: 'UNSUPPORTED_CONTENT' })
      }),
      fetcher: async () => { httpCalls += 1; throw new Error('must not call official fallback') },
      env: { OMNIMUX_API_KEY: 'unused-official-key' },
    }),
    /does not support image input/,
  )
  strictEqual(calls.length, 1)
  strictEqual(calls[0].provider, 'deepseek')
  strictEqual(calls[0].model, 'text-only-chat')
  strictEqual(httpCalls, 0)
})

test('video on an anthropic-messages session model fails loudly without switching to omnimux', async () => {
  let httpCalls = 0
  let credCalls = 0
  await assert.rejects(
    () => executeOmnimuxText({
      prompt: '拆解视频',
      video: MP4_DATA_URI,
      settings: settingsWith(
        { toolModel: 'auto', scenarioBindings: { analysis: { channel: 'official' } } },
        { 'my-anthropic': { api: 'anthropic-messages', baseURL: 'https://anthropic.example', apiKeyEnv: 'ANTHROPIC_KEY' } },
      ),
      agentDefaultModel: { currentSelection: () => ({ provider: 'my-anthropic', model: 'claude-sonnet' }) },
      credentials: { resolve: async () => { credCalls += 1; return { value: 'sk-unused' } } },
      fetcher: async () => { httpCalls += 1; throw new Error('must not call network') },
      env: { OMNIMUX_API_KEY: 'unused-official-key' },
    }),
    (err) => err instanceof OmnimuxError && err.code === 'omnimux-invalid-request' && /my-anthropic:claude-sonnet/.test(err.message),
  )
  strictEqual(httpCalls, 0)
  strictEqual(credCalls, 0)
})

test('video on an openai-completions session model uses only that provider baseURL and apiKeyEnv and surfaces upstream errors', async () => {
  const requests = []
  const credRefs = []
  let officialKeyCalls = 0

  const result = await executeOmnimuxText({
    prompt: '拆解视频',
    video: MP4_DATA_URI,
    settings: settingsWith(
      { toolModel: 'auto' },
      { 'custom-oai': { api: 'openai-completions', baseURL: 'https://gateway.example/v1', apiKeyEnv: 'CUSTOM_OAI_KEY' } },
    ),
    agentDefaultModel: { currentSelection: () => ({ provider: 'custom-oai', model: 'gemini-proxy' }) },
    credentials: {
      async resolve(ref) {
        credRefs.push(ref)
        if (ref === 'CUSTOM_OAI_KEY') return { value: 'sk-provider-only' }
        return { value: 'sk-wrong-key' }
      },
    },
    resolveOfficialApiKey: async () => { officialKeyCalls += 1; return 'sk-official-must-not-leak' },
    fetcher: async (url, init) => {
      requests.push({ url, auth: init.headers.authorization, body: JSON.parse(init.body) })
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'video ok on session model' } }] }) }
    },
    env: { OMNIMUX_API_KEY: 'sk-official-env-must-not-leak' },
  })

  strictEqual(result.model, 'custom-oai:gemini-proxy')
  strictEqual(result.text, 'video ok on session model')
  deepEqual(credRefs, ['CUSTOM_OAI_KEY'])
  strictEqual(officialKeyCalls, 0)
  strictEqual(requests.length, 1)
  strictEqual(requests[0].url, 'https://gateway.example/v1/chat/completions')
  strictEqual(requests[0].auth, 'Bearer sk-provider-only')
  strictEqual(requests[0].body.model, 'gemini-proxy')

  // Upstream rejection (e.g., text-only model on openai-completions) propagates naturally
  await assert.rejects(
    () => executeOmnimuxText({
      prompt: '拆解视频',
      video: MP4_DATA_URI,
      settings: settingsWith(
        { toolModel: 'auto' },
        { 'custom-oai': { api: 'openai-completions', baseURL: 'https://gateway.example/v1', apiKeyEnv: 'CUSTOM_OAI_KEY' } },
      ),
      agentDefaultModel: { currentSelection: () => ({ provider: 'custom-oai', model: 'text-only-model' }) },
      credentials: { async resolve(ref) { return ref === 'CUSTOM_OAI_KEY' ? { value: 'sk-provider-only' } : undefined } },
      fetcher: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'video input is not supported by text-only-model' } }) }),
      env: {},
    }),
    (err) => err instanceof OmnimuxError && /video input is not supported/.test(err.message),
  )
})

test('plugin toolModel overrides the current session model across text, image, and video', async () => {
  const requests = []
  const sessionModel = { currentSelection: () => ({ provider: 'other-provider', model: 'other-chat-model' }) }
  const settings = settingsWith({ toolModel: 'omnimux:gemini-3.8-flash' })
  const fetcher = async (url, init) => {
    requests.push({ url, auth: init.headers.authorization, body: JSON.parse(init.body) })
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'pinned official reply' } }] }) }
  }
  const resolveOfficialApiKey = async () => `sk-${'a'.repeat(48)}`

  for (const media of [{}, { image: PNG_DATA_URI }, { video: MP4_DATA_URI }]) {
    const res = await executeOmnimuxText({
      prompt: '分析素材',
      ...media,
      settings,
      agentDefaultModel: sessionModel,
      resolveOfficialApiKey,
      fetcher,
      env: {},
    })
    strictEqual(res.model, 'omnimux:gemini-3.8-flash')
    strictEqual(res.text, 'pinned official reply')
  }
  strictEqual(requests.length, 3)
  deepEqual(requests.map((r) => r.body.model), ['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.8-flash'])
})

test('unlisted official session model (fresh desktop default omnimux:deepseek-v4-flash) works for text/image and rejects video cleanly', async () => {
  const requests = []
  const resolveOfficialApiKey = async () => `sk-${'b'.repeat(48)}`
  const agentDefaultModel = { currentSelection: () => ({ provider: 'omnimux', model: 'deepseek-v4-flash' }) }
  const fetcher = async (url, init) => {
    requests.push({ url, auth: init.headers.authorization, body: JSON.parse(init.body) })
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'deepseek reply' } }] }) }
  }

  // Plain text and image succeed via account execution key on the exact session model
  for (const media of [{}, { image: PNG_DATA_URI }]) {
    const res = await executeOmnimuxText({
      prompt: '翻译并分析',
      ...media,
      settings: settingsWith({ toolModel: 'auto' }),
      agentDefaultModel,
      resolveOfficialApiKey,
      fetcher,
      env: {},
    })
    strictEqual(res.model, 'omnimux:deepseek-v4-flash')
    strictEqual(res.text, 'deepseek reply')
  }
  strictEqual(requests.length, 2)
  deepEqual(requests.map((r) => r.body.model), ['deepseek-v4-flash', 'deepseek-v4-flash'])

  // Video is unsupported by deepseek-v4-flash contract -> fails loudly with zero HTTP calls
  await assert.rejects(
    () => executeOmnimuxText({
      prompt: '拆解视频',
      video: MP4_DATA_URI,
      settings: settingsWith({ toolModel: 'auto' }),
      agentDefaultModel,
      resolveOfficialApiKey,
      fetcher,
      env: {},
    }),
    (err) => err instanceof OmnimuxError && err.code === 'omnimux-invalid-request' && /omnimux:deepseek-v4-flash/.test(err.message),
  )
  strictEqual(requests.length, 2)

  // Text-only unlisted official model (deepseek-v4-pro) rejects image cleanly
  await assert.rejects(
    () => executeOmnimuxText({
      prompt: '看图',
      image: PNG_DATA_URI,
      settings: settingsWith({ toolModel: 'auto' }),
      agentDefaultModel: { currentSelection: () => ({ provider: 'omnimux', model: 'deepseek-v4-pro' }) },
      resolveOfficialApiKey,
      fetcher,
      env: {},
    }),
    (err) => err instanceof OmnimuxError && err.code === 'omnimux-invalid-request' && /omnimux:deepseek-v4-pro/.test(err.message),
  )
  strictEqual(requests.length, 2)

  // Whitelisted seed-evolving (text/image/video) rejects audio and document
  for (const unsupported of [{ audio: WAV_DATA_URI }, { document: PDF_DATA_URI }]) {
    await assert.rejects(
      () => executeOmnimuxText({
        prompt: '解析附件',
        ...unsupported,
        settings: settingsWith({ toolModel: 'auto' }),
        agentDefaultModel: { currentSelection: () => ({ provider: 'omnimux', model: 'seed-evolving' }) },
        resolveOfficialApiKey,
        fetcher,
        env: {},
      }),
      (err) => err instanceof OmnimuxError && err.code === 'omnimux-invalid-request',
    )
  }
  strictEqual(requests.length, 2)
})

test('gate-disabled official model fails symmetrically with or without resolveOfficialApiKey, and @group candidates are preserved', async () => {
  const gate = parseGateConfig({ models: { textComplete: { 'gemini-3.8-flash': false } } })
  const calls = []
  let httpCalls = 0
  for (const extra of [
    { llm: llmRecorder(calls) },
    { resolveOfficialApiKey: async () => `sk-${'c'.repeat(48)}`, fetcher: async () => { httpCalls += 1; throw new Error('must not call') } },
  ]) {
    await assert.rejects(
      () => executeOmnimuxText({
        prompt: 'hello',
        gate,
        agentDefaultModel: { currentSelection: () => ({ provider: 'omnimux', model: 'gemini-3.8-flash' }) },
        env: {},
        ...extra,
      }),
      (err) => err instanceof OmnimuxError && err.code === 'unknown-model',
    )
  }
  strictEqual(calls.length, 0)
  strictEqual(httpCalls, 0)

  // Pinned omnimux model with @group preserves route.candidates on direct chat
  const groupBodies = []
  const grouped = await executeOmnimuxText({
    prompt: 'hello',
    settings: settingsWith({ toolModel: 'omnimux:gemini-3.8-flash@standard' }),
    apiKey: `sk-${'d'.repeat(48)}`,
    fetcher: async (_url, init) => {
      groupBodies.push(JSON.parse(init.body))
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'grouped ok' } }] }) }
    },
    env: {},
  })
  strictEqual(grouped.model, 'omnimux:gemini-3.8-flash@standard')
  strictEqual(groupBodies.length, 1)
  strictEqual(groupBodies[0].model, 'gemini-3.8-flash@default')
  strictEqual(grouped.routedModel, 'gemini-3.8-flash@default')
})

test('agents.currentInitiator() prevents cross-session bleed, tolerates disposed scope, and trims sessionId', async () => {
  const calls = []
  const llm = llmRecorder(calls)
  const agentDefaultModel = { currentSelection: () => ({ provider: 'session-b', model: 'model-b' }) }

  // 1. Ambient currentInitiator wins over agentDefaultModel when sessionId is absent
  const r1 = await executeOmnimuxText({
    prompt: 'from session A tool',
    agents: {
      currentInitiator: () => ({ model: { current: () => ({ provider: 'session-a', model: 'model-a' }) } }),
    },
    agentDefaultModel,
    llm,
    env: {},
  })
  strictEqual(r1.model, 'session-a:model-a')

  // 2. Disposed currentInitiator degrades cleanly to agentDefaultModel
  const r2 = await executeOmnimuxText({
    prompt: 'after scope disposed',
    agents: {
      currentInitiator: () => { throw new Error('agent initiator scope is disposed') },
    },
    agentDefaultModel,
    llm,
    env: {},
  })
  strictEqual(r2.model, 'session-b:model-b')

  // 3. Whitespace-padded sessionId is trimmed before agents.get()
  const r3 = await executeOmnimuxText({
    prompt: 'trimmed session',
    sessionId: '  sess-trim  ',
    agents: {
      get: (id) => id === 'sess-trim'
        ? { model: { current: () => ({ provider: 'trimmed-provider', model: 'trimmed-model' }) } }
        : undefined,
    },
    agentDefaultModel,
    llm,
    env: {},
  })
  strictEqual(r3.model, 'trimmed-provider:trimmed-model')
})

test('explicit caller routes override session model, while blank or unknown strategy does not bypass it', async () => {
  const llmCalls = []
  const httpModels = []
  const agentDefaultModel = { currentSelection: () => ({ provider: 'session-gw', model: 'session-m' }) }
  const settings = settingsWith({ toolModel: 'auto', runtimeAgentId: 'codex', runtimeAgentVerified: true })

  // Explicit model overrides session model
  const explicit = await executeOmnimuxText({
    prompt: 'explicit official',
    model: 'gemini-3.8-flash',
    settings,
    agentDefaultModel,
    apiKey: `sk-${'e'.repeat(48)}`,
    resolveOfficialApiKey: async () => `sk-${'e'.repeat(48)}`,
    fetcher: async (_url, init) => {
      httpModels.push(JSON.parse(init.body).model)
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'explicit reply' } }] }) }
    },
    env: {},
  })
  strictEqual(explicit.model, 'gemini-3.8-flash')
  deepEqual(httpModels, ['gemini-3.8-flash'])

  // Explicit @agent overrides session model
  let agentCalls = 0
  const localAgent = await executeOmnimuxText({
    prompt: 'explicit local agent',
    model: '@agent',
    settings,
    agentDefaultModel,
    agentRun: async () => { agentCalls += 1; return 'agent reply' },
    env: {},
  })
  strictEqual(localAgent.text, 'agent reply')
  strictEqual(agentCalls, 1)

  // Explicit strategy ('cost_first') overrides session model
  const strat = await executeOmnimuxText({
    prompt: 'explicit strategy',
    strategy: 'cost_first',
    settings,
    agentDefaultModel,
    apiKey: `sk-${'e'.repeat(48)}`,
    fetcher: async (_url, init) => {
      httpModels.push(JSON.parse(init.body).model)
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'strat reply' } }] }) }
    },
    env: {},
  })
  strictEqual(strat.text, 'strat reply')
  strictEqual(httpModels.length, 2)

  // Whitespace-only or unknown strategy does NOT bypass session model
  for (const badStrategy of ['   ', 'not-a-strategy']) {
    const res = await executeOmnimuxText({
      prompt: 'keep session model',
      strategy: badStrategy,
      settings,
      agentDefaultModel,
      llm: llmRecorder(llmCalls),
      env: {},
    })
    strictEqual(res.model, 'session-gw:session-m')
  }
  strictEqual(llmCalls.length, 2)
})

test('non-omnimux openai-completions complex media preserves non-/v1 baseURL, forwards custom headers, redacts credential errors, supports env fallback, audio/PDF, and respects unset base providers', async () => {
  const seen = []
  const fetcher = async (url, init) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body) })
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) }
  }

  // 1. Non-/v1 baseURL (e.g. Volcengine Ark /api/v3) + custom headers + env fallback + audio & PDF
  for (const media of [{ audio: WAV_DATA_URI }, { document: PDF_DATA_URI }]) {
    const res = await executeOmnimuxText({
      prompt: '理解多模态',
      ...media,
      settings: settingsWith(
        { toolModel: 'auto' },
        {
          ark: {
            api: 'openai-completions',
            baseURL: 'https://ark.cn-beijing.volces.com/api/v3/',
            apiKeyEnv: 'ARK_API_KEY',
            headers: {
              'cf-aig-authorization': 'Bearer gw-token',
              'X-Title': 'OmniMux',
              Authorization: 'Bearer must-not-override',
            },
          },
        },
      ),
      agentDefaultModel: { currentSelection: () => ({ provider: 'ark', model: 'doubao-multimodal' }) },
      fetcher,
      env: { ARK_API_KEY: 'sk-ark-env-key' },
    })
    strictEqual(res.model, 'ark:doubao-multimodal')
  }
  strictEqual(seen.length, 2)
  strictEqual(seen[0].url, 'https://ark.cn-beijing.volces.com/api/v3/chat/completions')
  strictEqual(seen[0].headers.authorization, 'Bearer sk-ark-env-key')
  strictEqual(seen[0].headers['cf-aig-authorization'], 'Bearer gw-token')
  strictEqual(seen[0].headers['X-Title'], 'OmniMux')
  strictEqual(seen[0].headers.Authorization, undefined)
  strictEqual(seen[1].url, 'https://ark.cn-beijing.volces.com/api/v3/chat/completions')

  // 2. Credential resolution failure never leaks raw cause message
  await assert.rejects(
    () => executeOmnimuxText({
      prompt: '拆解视频',
      video: MP4_DATA_URI,
      settings: settingsWith(
        { toolModel: 'auto' },
        { ark: { api: 'openai-completions', baseURL: 'https://ark.example/api/v3', apiKeyEnv: 'ARK_API_KEY' } },
      ),
      agentDefaultModel: { currentSelection: () => ({ provider: 'ark', model: 'doubao-multimodal' }) },
      credentials: { resolve: async () => { throw new Error('secret-vault-internal-value') } },
      fetcher,
      env: {},
    }),
    (err) => err instanceof OmnimuxError
      && err.code === 'omnimux-unconfigured'
      && !err.message.includes('secret-vault-internal-value'),
  )

  // 3. Missing baseURL, missing apiKeyEnv, and openai-responses reject cleanly
  await assert.rejects(
    () => executeOmnimuxText({
      prompt: '拆解视频',
      video: MP4_DATA_URI,
      settings: settingsWith({ toolModel: 'auto' }, { nobase: { api: 'openai-completions', apiKeyEnv: 'K' } }),
      agentDefaultModel: { currentSelection: () => ({ provider: 'nobase', model: 'm' }) },
      env: { K: 'sk-1' },
    }),
    (err) => err instanceof OmnimuxError && err.code === 'omnimux-invalid-request',
  )
  await assert.rejects(
    () => executeOmnimuxText({
      prompt: '拆解视频',
      video: MP4_DATA_URI,
      settings: settingsWith({ toolModel: 'auto' }, { nokey: { api: 'openai-completions', baseURL: 'https://x.example/v1' } }),
      agentDefaultModel: { currentSelection: () => ({ provider: 'nokey', model: 'm' }) },
      env: {},
    }),
    (err) => err instanceof OmnimuxError && err.code === 'omnimux-unconfigured',
  )
  await assert.rejects(
    () => executeOmnimuxText({
      prompt: '拆解视频',
      video: MP4_DATA_URI,
      settings: settingsWith({ toolModel: 'auto' }, { resp: { api: 'openai-responses', baseURL: 'https://x.example/v1', apiKeyEnv: 'K' } }),
      agentDefaultModel: { currentSelection: () => ({ provider: 'resp', model: 'm' }) },
      env: { K: 'sk-1' },
    }),
    (err) => err instanceof OmnimuxError && err.code === 'omnimux-invalid-request',
  )

  // 4. descriptor.value omitting a deleted/unset base provider never resurrects base
  let resurrectedCalls = 0
  await assert.rejects(
    () => executeOmnimuxText({
      prompt: '拆解视频',
      video: MP4_DATA_URI,
      settings: {
        describe: () => [
          { ns: 'omnimux', value: { toolModel: 'auto' }, user: {} },
          {
            ns: 'llm-pi-ai',
            base: { providers: { deleted: { api: 'openai-completions', baseURL: 'https://stale.example/v1', apiKeyEnv: 'STALE_KEY' } } },
            value: { providers: {} },
            user: {},
          },
        ],
      },
      agentDefaultModel: { currentSelection: () => ({ provider: 'deleted', model: 'm' }) },
      fetcher: async () => { resurrectedCalls += 1; throw new Error('must not resurrect deleted base provider') },
      env: { STALE_KEY: 'sk-stale' },
    }),
    (err) => err instanceof OmnimuxError && err.code === 'omnimux-invalid-request',
  )
  strictEqual(resurrectedCalls, 0)
})
