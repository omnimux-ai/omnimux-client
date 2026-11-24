// @ts-nocheck
import assert, { strictEqual, deepEqual } from 'node:assert/strict'
import { test } from 'node:test'
import { OmnimuxError } from '../media/errors.js'
import { executeOmnimuxText } from './execute.js'
import { parseTextConfig } from './catalog.js'

const PNG_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAAA'
const MP4_DATA_URI = `data:video/mp4;base64,${Buffer.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]).toString('base64')}`

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
