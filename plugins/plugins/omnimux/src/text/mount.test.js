import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseGateConfig } from '../gate/config.js'
import { OmnimuxError } from '../media/errors.js'
import { parseTextConfig } from './catalog.js'
import { mountTextComplete } from './mount.js'

describe('mountTextComplete capability gate', () => {
  it('registers omnimux_text_complete tool and provides textComplete seam by default', () => {
    const tools = []
    const provided = {}
    const ctx = {
      tools: { register(t) { tools.push(t) } },
      provide(name, api) { provided[name] = api },
    }
    const hub = {
      text: parseTextConfig(undefined),
      gate: parseGateConfig(undefined),
    }

    mountTextComplete(ctx, hub, {}, () => {})
    assert.equal(tools.length, 1)
    assert.equal(tools[0].name, 'omnimux_text_complete')
    assert.ok(provided.textComplete)
    // 2026-10-21 #3527：路由声明只剩网关现役文本型号。
    assert.deepEqual(tools[0].parameters.properties.model.enum, ['gemini-3.8-flash', 'gemini-4-argon', 'seed-evolving'])
    assert.equal(tools[0].parameters.properties.metadata, undefined)
    assert.ok(tools[0].parameters.properties.strategy)
    assert.ok(tools[0].parameters.properties.group)
    assert.ok(tools[0].parameters.properties.allowed_groups)
  })

  it('skips register and provide when omnimux_text_complete tool is disabled in gate', () => {
    const tools = []
    const provided = {}
    const ctx = {
      tools: { register(t) { tools.push(t) } },
      provide(name, api) { provided[name] = api },
    }
    const hub = {
      text: parseTextConfig(undefined),
      gate: parseGateConfig({ tools: { omnimux_text_complete: false } }),
    }

    mountTextComplete(ctx, hub, {}, () => {})
    assert.equal(tools.length, 0)
    assert.equal(provided.textComplete, undefined)
  })

  it('filters enum in tool parameters when gate disables specific models', () => {
    const tools = []
    const ctx = {
      tools: { register(t) { tools.push(t) } },
      provide() {},
    }
    const hub = {
      text: parseTextConfig(undefined),
      gate: parseGateConfig({
        models: {
          textComplete: {
            'gemini-3.8-flash': false,
          },
        },
      }),
    }

    mountTextComplete(ctx, hub, {}, () => {})
    assert.equal(tools.length, 1)
    // The local model is hidden; the gateway-only text model remains offered.
    assert.deepEqual(tools[0].parameters.properties.model.enum, ['gemini-4-argon', 'seed-evolving'])
    assert.equal(tools[0].parameters.properties.model.enum.includes('gemini-3.8-flash'), false)
  })

  it('throws capability-disabled at execution time when calling a disabled model', async () => {
    const tools = []
    const provided = {}
    const ctx = {
      tools: { register(t) { tools.push(t) } },
      provide(name, api) { provided[name] = api },
    }
    const hub = {
      text: parseTextConfig(undefined),
      gate: parseGateConfig({
        models: {
          textComplete: {
            'gemini-3.8-flash': false,
          },
        },
      }),
    }

    mountTextComplete(ctx, hub, {}, () => {})

    await assert.rejects(
      async () => {
        await tools[0].execute({ prompt: 'test', reason: 'benchmark', model: 'gemini-3.8-flash' })
      },
      (err) => {
        assert.ok(err instanceof OmnimuxError)
        assert.equal(err.code, 'capability-disabled')
        assert.equal(err.message, "Model 'gemini-3.8-flash' on textComplete is disabled by capability gate")
        return true
      },
    )

    await assert.rejects(
      async () => {
        await provided.textComplete.execute({ prompt: 'test', model: 'gemini-3.8-flash' })
      },
      (err) => {
        assert.ok(err instanceof OmnimuxError)
        assert.equal(err.code, 'capability-disabled')
        return true
      },
    )
  })

  it('registered tool and seam reject an incompatible operation before llm.stream', async () => {
    const tools = []
    const provided = {}
    let vendorCalls = 0
    const ctx = {
      tools: { register(tool) { tools.push(tool) } },
      provide(name, api) { provided[name] = api },
      get(name) {
        if (name !== 'llm') return undefined
        return {
          async * stream() {
            vendorCalls += 1
            yield { type: 'text-delta', text: 'must not run' }
          },
        }
      },
    }
    const hub = { text: parseTextConfig(undefined), gate: parseGateConfig(undefined) }
    mountTextComplete(ctx, hub, {}, (error) => { throw error })
    const request = {
      prompt: 'describe',
      model: 'gemini-3.8-flash',
      operation: 'digital_human',
      bypassSubmitGuard: true,
      reason: 'guard regression',
    }
    await assert.rejects(
      () => tools[0].execute(request, {}),
      (error) => error instanceof OmnimuxError && error.code === 'omnimux-invalid-request',
    )
    await assert.rejects(
      () => provided.textComplete.execute(request),
      (error) => error instanceof OmnimuxError && error.code === 'omnimux-invalid-request',
    )
    assert.equal(vendorCalls, 0)
  })
})

describe('mountTextComplete toolModel bypass', () => {
  it('execute() skips the runtime-mode gate when omnimux.toolModel is configured', async () => {
    const tools = []
    const provided = {}
    const seen = []
    const ctx = {
      tools: { register(t) { tools.push(t) } },
      provide(name, api) { provided[name] = api },
      get(name) {
        if (name === 'llm') {
          return {
            async * stream(options) {
              seen.push(options)
              yield { type: 'text-delta', text: 'tool answer' }
              yield { type: 'finish', reason: { kind: 'stop' } }
            },
          }
        }
        if (name === 'settings') {
          return {
            get(key) {
              return key === 'omnimux'
                ? { runtimeMode: 'agent', runtimeAgentId: '', runtimeAgentVerified: false, toolModel: 'cpa:gpt-6.1-sol' }
                : undefined
            },
          }
        }
        return undefined
      },
    }
    const hub = { text: parseTextConfig(undefined), gate: parseGateConfig(undefined) }
    mountTextComplete(ctx, hub, {}, (error) => { throw error })

    const result = await provided.textComplete.execute({ prompt: 'say hi' })
    assert.equal(result.model, 'cpa:gpt-6.1-sol')
    assert.equal(result.text, 'tool answer')
    assert.equal(seen[0].provider, 'cpa')
    assert.equal(seen[0].model, 'gpt-6.1-sol')
  })

  it('gate-disabled tool still intercepts before any model routing', async () => {
    const provided = {}
    const ctx = {
      tools: { register() {} },
      provide(name, api) { provided[name] = api },
      get(name) {
        if (name === 'settings') return { get: () => ({ runtimeMode: 'agent', toolModel: 'cpa:x' }) }
        return undefined
      },
    }
    const hub = { text: parseTextConfig(undefined), gate: parseGateConfig({ tools: { omnimux_text_complete: false } }) }
    mountTextComplete(ctx, hub, {}, () => {})
    assert.equal(provided.textComplete, undefined)
  })

  it('execute() follows agentDefaultModel and agents.get(sessionId) when toolModel is auto/unset', async () => {
    let textComplete
    const seen = []
    let defaultSelection = { provider: 'session-provider', model: 'session-default-model' }
    const ctx = {
      tools: { register() {} },
      provide(name, api) { if (name === 'textComplete') textComplete = api },
      get(name) {
        if (name === 'llm') {
          return {
            async * stream(options) {
              seen.push(options)
              yield { type: 'text-delta', text: 'followed session answer' }
              yield { type: 'finish', reason: { kind: 'stop' } }
            },
          }
        }
        if (name === 'settings') return { get: (k) => k === 'omnimux' ? { toolModel: 'auto' } : undefined }
        if (name === 'agentDefaultModel') return { currentSelection: () => defaultSelection }
        if (name === 'agents') {
          return {
            get: (id) => id === 'sess-active'
              ? { model: { current: () => ({ provider: 'active-provider', model: 'active-model' }) } }
              : undefined,
          }
        }
        return undefined
      },
    }
    const hub = { text: parseTextConfig(undefined), gate: parseGateConfig(undefined) }
    mountTextComplete(ctx, hub, {}, (error) => { throw error })

    const r1 = await textComplete.execute({ prompt: 'background task' })
    assert.equal(r1.model, 'session-provider:session-default-model')
    assert.equal(seen[0].provider, 'session-provider')
    assert.equal(seen[0].model, 'session-default-model')

    const r2 = await textComplete.execute({ prompt: 'session task', sessionId: 'sess-active' })
    assert.equal(r2.model, 'active-provider:active-model')
    assert.equal(seen[1].provider, 'active-provider')
    assert.equal(seen[1].model, 'active-model')

    defaultSelection = { provider: 'switched-provider', model: 'switched-model' }
    const r3 = await textComplete.execute({ prompt: 'after switch' })
    assert.equal(r3.model, 'switched-provider:switched-model')
  })

  it('omnimux_text_complete tool follows session model when model is omitted and delegates explicitly when model is named', async () => {
    let registeredTool
    const llmSeen = []
    const httpSeen = []
    const ctx = {
      tools: { register(tool) { if (tool.name === 'omnimux_text_complete') registeredTool = tool } },
      provide() {},
      get(name) {
        if (name === 'llm') {
          return {
            async * stream(options) {
              llmSeen.push(options)
              yield { type: 'text-delta', text: 'session tool answer' }
              yield { type: 'finish', reason: { kind: 'stop' } }
            },
          }
        }
        if (name === 'settings') return { get: (k) => k === 'omnimux' ? { toolModel: 'auto' } : undefined }
        if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'session-provider', model: 'session-chat' }) }
        if (name === 'agents') {
          return {
            get: (id) => id === 'sess-tool-1'
              ? { model: { current: () => ({ provider: 'bound-provider', model: 'bound-chat' }) } }
              : undefined,
          }
        }
        return undefined
      },
    }
    const hub = { text: parseTextConfig(undefined), gate: parseGateConfig(undefined) }
    mountTextComplete(ctx, hub, {}, (error) => { throw error }, {
      resolveOfficialApiKey: async () => `sk-${'f'.repeat(48)}`,
    })

    assert.ok(registeredTool)
    assert.match(registeredTool.description, /explicit whitelist model id/i)

    // Omitted model follows exec.agent.session.id -> bound-provider:bound-chat
    const r1 = await registeredTool.execute(
      { prompt: 'follow current session', reason: 'isolated summary' },
      { agent: { session: { id: 'sess-tool-1' } } },
    )
    assert.equal(r1.model, 'bound-provider:bound-chat')
    assert.equal(llmSeen.length, 1)
    assert.equal(llmSeen[0].provider, 'bound-provider')

    // Explicit whitelist model delegates to official gemini-3.8-flash instead of session model
    const prevFetch = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      httpSeen.push({ url, body: JSON.parse(init.body) })
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'delegated official answer' } }] }) }
    }
    try {
      const r2 = await registeredTool.execute(
        { model: 'gemini-3.8-flash', prompt: 'delegate to whitelist', reason: 'session model lacks video' },
        { agent: { session: { id: 'sess-tool-1' } } },
      )
      assert.equal(r2.model, 'gemini-3.8-flash')
      assert.equal(httpSeen.length, 1)
      assert.equal(httpSeen[0].body.model, 'gemini-3.8-flash')
    } finally {
      globalThis.fetch = prevFetch
    }
  })
})
