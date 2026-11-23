import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bindTextSessionModel } from '../src/text-session-model.ts'

function createCtx(agent: Record<string, unknown>) {
  return {
    agents: { get: (id: string) => (id === 'sess-1' ? agent : undefined) },
    get: (name: string) => (name === 'llm' ? {
      listModels: async () => [{ id: 'model-b' }],
      resolveCallConfig: async (input: Record<string, unknown>) => input,
    } : undefined),
  } as unknown as Parameters<typeof bindTextSessionModel>[0]
}

test('bindTextSessionModel uses agent.model.select when available and restores previous selection on dispose', async () => {
  const calls: unknown[] = []
  const previous = { provider: 'prov-a', model: 'model-a' }
  const agent = {
    model: {
      current: () => previous,
      select: (selection: unknown) => { calls.push(selection) },
    },
    ctx: { on: () => { throw new Error('legacy waterfall hook must not be used when agent.model exists') } },
  }
  const dispose = await bindTextSessionModel(createCtx(agent), {
    sessionId: 'sess-1',
    provider: 'prov-b',
    model: 'model-b',
    reasoningEffort: 'medium',
  } as Parameters<typeof bindTextSessionModel>[1])

  assert.deepEqual(calls, [{ provider: 'prov-b', model: 'model-b', reasoningEffort: 'medium' }])
  dispose()
  assert.deepEqual(calls, [
    { provider: 'prov-b', model: 'model-b', reasoningEffort: 'medium' },
    previous,
  ])
})

test('bindTextSessionModel falls back to agent/request hooks when agent.model is absent (0.2.1-rc.3)', async () => {
  const hooks: string[] = []
  const disposed: string[] = []
  const agent = {
    ctx: {
      on: (event: string) => {
        hooks.push(event)
        return () => { disposed.push(event) }
      },
    },
  }
  const dispose = await bindTextSessionModel(createCtx(agent), {
    sessionId: 'sess-1',
    provider: 'prov-b',
    model: 'model-b',
  } as Parameters<typeof bindTextSessionModel>[1])

  assert.deepEqual(hooks, ['system-prompt/assemble', 'agent/request'])
  dispose()
  assert.deepEqual(disposed, ['agent/request', 'system-prompt/assemble'])
})
