import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { OmnimuxError } from '../media/errors.js'
import { executeOmnimuxText } from './execute.js'

/**
 * One `llm-pi-ai` profile declaring an explicit reasoning ladder for the
 * official text model, matching the shipped `cordis.patch.yml` route.
 */
const OMNIMUX_PROVIDER = {
  api: 'openai-completions',
  baseURL: 'https://api.omnimux.ai/v1',
  apiKeyEnv: 'OMNIMUX_API_KEY',
  compat: { supportsReasoningEffort: true },
  models: [{
    id: 'gemini-3.8-flash',
    reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', max: 'max' },
  }],
}

const NO_LADDER_PROVIDER = {
  api: 'openai-completions',
  baseURL: 'https://api.omnimux.ai/v1',
  apiKeyEnv: 'OMNIMUX_API_KEY',
  compat: { supportsReasoningEffort: true },
  models: [{ id: 'gemini-3.8-flash' }],
}

function settingsWith(provider) {
  return {
    get(section) {
      return section === 'llm-pi-ai' ? { providers: { omnimux: provider } } : undefined
    },
  }
}

function chatFetcher(captured) {
  return async (url, opts) => {
    captured.push({ url, body: JSON.parse(opts.body) })
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'translated' } }] }),
    }
  }
}

/**
 * A `ctx.llm` fake that implements the 0.2.2-rc.5 `prepareCall` contract:
 * `configure` receives frozen controls plus the exact model metadata, and the
 * returned config is what dispatch revalidates.
 * @param {unknown[]} seen
 * @param {{ efforts: string[], throwOn?: string }} options
 */
function preparedLlm(seen, { efforts, throwOn } = { efforts: [] }) {
  const calls = []
  return {
    calls,
    async prepareCall(config, _signal, configure) {
      calls.push(config.model)
      const modelInfo = {
        provider: config.provider,
        id: config.model,
        name: config.model,
        ...(efforts.length ? { reasoning: { efforts: efforts.map((id) => ({ id, name: id })) } } : {}),
      }
      const proposed = { ...configure({}, modelInfo), provider: config.provider, model: config.model }
      if (throwOn && proposed.reasoningEffort === throwOn) {
        throw new OmnimuxError('UNSUPPORTED_REASONING_EFFORT', `unsupported effort ${throwOn}`)
      }
      const resolved = { ...proposed, maxTokens: config.maxTokens }
      return {
        config: resolved,
        stream(options) {
          seen.push(options)
          return (async function* stream() {
            yield { type: 'text-delta', index: 0, text: 'structure' }
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        },
      }
    },
    async * stream(options) {
      seen.push(options)
      yield { type: 'text-delta', index: 0, text: 'structure' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
}

describe('textComplete reasoning policy', () => {
  it('sends the lowest declared level on the official chat lane and reports it', async () => {
    const captured = []
    const result = await executeOmnimuxText({
      prompt: 'translate this',
      model: 'gemini-3.8-flash',
      apiKey: 'sk-test',
      env: {},
      settings: settingsWith(OMNIMUX_PROVIDER),
      resolveOfficialApiKey: async () => 'sk-account',
      fetcher: chatFetcher(captured),
      reasoning: 'minimal',
    })
    assert.equal(captured.length, 1)
    assert.equal(captured[0].body.reasoning_effort, 'low')
    assert.equal(result.reasoningEffort, 'low')
  })

  it('keeps the route default when the caller inherits', async () => {
    const captured = []
    const result = await executeOmnimuxText({
      prompt: 'analyse this market',
      model: 'gemini-3.8-flash',
      apiKey: 'sk-test',
      env: {},
      settings: settingsWith(OMNIMUX_PROVIDER),
      resolveOfficialApiKey: async () => 'sk-account',
      fetcher: chatFetcher(captured),
    })
    assert.equal(captured.length, 1)
    assert.equal(Object.hasOwn(captured[0].body, 'reasoning_effort'), false)
    assert.equal(Object.hasOwn(result, 'reasoningEffort'), false)
  })

  it('never invents a level for a model without a declared ladder', async () => {
    const captured = []
    const result = await executeOmnimuxText({
      prompt: 'translate this',
      model: 'gemini-3.8-flash',
      apiKey: 'sk-test',
      env: {},
      settings: settingsWith(NO_LADDER_PROVIDER),
      resolveOfficialApiKey: async () => 'sk-account',
      fetcher: chatFetcher(captured),
      reasoning: 'minimal',
    })
    assert.equal(captured.length, 1)
    assert.equal(Object.hasOwn(captured[0].body, 'reasoning_effort'), false)
    assert.equal(result.reasoningEffort, null)
  })

  it('respects a profile that declares no reasoning-effort support', async () => {
    const captured = []
    await executeOmnimuxText({
      prompt: 'translate this',
      model: 'gemini-3.8-flash',
      apiKey: 'sk-test',
      env: {},
      settings: settingsWith({ ...OMNIMUX_PROVIDER, compat: { supportsReasoningEffort: false } }),
      resolveOfficialApiKey: async () => 'sk-account',
      fetcher: chatFetcher(captured),
      reasoning: 'minimal',
    })
    assert.equal(Object.hasOwn(captured[0].body, 'reasoning_effort'), false)
  })

  it('rejects an unknown policy instead of silently ignoring it', async () => {
    await assert.rejects(
      () => executeOmnimuxText({ prompt: 'hi', model: 'gemini-3.8-flash', reasoning: 'max', llm: preparedLlm([]) }),
      (error) => error instanceof OmnimuxError
        && error.code === 'omnimux-invalid-request'
        && /reasoning must be one of/.test(error.message),
    )
  })

  it('selects a declared level through prepareCall and reports the materialized effort', async () => {
    const seen = []
    const llm = preparedLlm(seen, { efforts: ['off', 'minimal', 'low', 'medium', 'high', 'max'] })
    const result = await executeOmnimuxText({
      prompt: 'split this script',
      model: 'gemini-3.8-flash',
      llm,
      settings: settingsWith(OMNIMUX_PROVIDER),
      reasoning: 'minimal',
    })
    assert.equal(seen.length, 1)
    assert.equal(seen[0].reasoningEffort, 'low')
    assert.equal(result.reasoningEffort, 'low')
  })

  it('inherits when the adapter does not advertise the declared level', async () => {
    const seen = []
    const llm = preparedLlm(seen, { efforts: ['off', 'high', 'max'] })
    const result = await executeOmnimuxText({
      prompt: 'split this script',
      model: 'gemini-3.8-flash',
      llm,
      settings: settingsWith(OMNIMUX_PROVIDER),
      reasoning: 'minimal',
    })
    assert.equal(Object.hasOwn(seen[0], 'reasoningEffort'), false)
    assert.equal(result.reasoningEffort, null)
    // A level the adapter rejects must never be dispatched at all.
    assert.deepEqual(llm.calls, ['gemini-3.8-flash'])
  })

  it('uses the least advertised level when the provider declares none', async () => {
    const seen = []
    const llm = preparedLlm(seen, { efforts: ['off', 'low', 'high'] })
    const result = await executeOmnimuxText({
      prompt: 'split this script',
      model: 'gemini-3.8-flash',
      llm,
      settings: settingsWith(NO_LADDER_PROVIDER),
      reasoning: 'minimal',
    })
    assert.equal(seen[0].reasoningEffort, 'off')
    assert.equal(result.reasoningEffort, 'off')
  })

  it('keeps the plain stream path on a host without prepareCall', async () => {
    const seen = []
    const legacy = {
      async * stream(options) {
        seen.push(options)
        yield { type: 'text-delta', index: 0, text: 'structure' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    const result = await executeOmnimuxText({
      prompt: 'split this script',
      model: 'gemini-3.8-flash',
      llm: legacy,
      settings: settingsWith(OMNIMUX_PROVIDER),
      reasoning: 'minimal',
    })
    assert.equal(Object.hasOwn(seen[0], 'reasoningEffort'), false)
    assert.equal(result.reasoningEffort, null)
  })

  it('does not prepare a call when the policy inherits', async () => {
    const seen = []
    const llm = preparedLlm(seen, { efforts: ['off', 'low', 'high'] })
    const result = await executeOmnimuxText({
      prompt: 'analyse this clip',
      model: 'gemini-3.8-flash',
      llm,
      settings: settingsWith(OMNIMUX_PROVIDER),
    })
    assert.deepEqual(llm.calls, [], 'inherit must not touch the prepared-call path')
    assert.equal(Object.hasOwn(seen[0], 'reasoningEffort'), false)
    assert.equal(result.text, 'structure')
  })
})
