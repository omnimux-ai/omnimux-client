import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseGateConfig } from '../gate/config.js'
import { apply } from '../index.js'
import { OmnimuxError } from '../media/errors.js'
import { objectParams, JSON_TOOL_OUTPUT, rethrow } from '../tools/schema.js'
import { mountReader } from './mount.js'

describe('mountReader', () => {
  it('registers omnimux_page_fetch when official.mount is true and gate is enabled', () => {
    const names = []
    mountReader(
      { tools: { register(tool) { names.push(tool.name) } } },
      { hub: { official: { mount: true }, gate: parseGateConfig(undefined) }, objectParams, jsonOut: JSON_TOOL_OUTPUT, rethrow },
    )
    assert.deepEqual(names, ['omnimux_page_fetch'])
  })

  it('skips when official.mount is false', () => {
    const names = []
    mountReader(
      { tools: { register(tool) { names.push(tool.name) } } },
      { hub: { official: { mount: false }, gate: parseGateConfig(undefined) }, objectParams, jsonOut: JSON_TOOL_OUTPUT, rethrow },
    )
    assert.deepEqual(names, [])
  })

  it('skips when gate.tools.omnimux_page_fetch is false', () => {
    const names = []
    mountReader(
      { tools: { register(tool) { names.push(tool.name) } } },
      { hub: { official: { mount: true }, gate: parseGateConfig({ tools: { omnimux_page_fetch: false } }) }, objectParams, jsonOut: JSON_TOOL_OUTPUT, rethrow },
    )
    assert.deepEqual(names, [])
  })

  it('execute without a key throws omnimux-unconfigured', async () => {
    const tools = {}
    const previousKey = process.env.OMNIMUX_API_KEY
    const previousToken = process.env.OMNIMUX_TOKEN
    delete process.env.OMNIMUX_API_KEY
    delete process.env.OMNIMUX_TOKEN
    try {
      mountReader(
        { tools: { register(tool) { tools[tool.name] = tool } } },
        {
          hub: { official: { mount: true }, gate: parseGateConfig(undefined) },
          env: {},
          objectParams,
          jsonOut: JSON_TOOL_OUTPUT,
          rethrow,
        },
      )
      await assert.rejects(
        () => tools.omnimux_page_fetch.execute({ url: 'https://example.com' }),
        (error) => error instanceof OmnimuxError && error.code === 'omnimux-unconfigured',
      )
    } finally {
      if (previousKey === undefined) delete process.env.OMNIMUX_API_KEY
      else process.env.OMNIMUX_API_KEY = previousKey
      if (previousToken === undefined) delete process.env.OMNIMUX_TOKEN
      else process.env.OMNIMUX_TOKEN = previousToken
    }
  })
})

describe('apply registers reader with official tools', () => {
  it('includes omnimux_page_fetch by default', () => {
    const names = []
    apply({
      tools: { register(tool) { names.push(tool.name) } },
      provide() {},
      get() { return undefined },
    })
    assert.ok(names.includes('omnimux_page_fetch'))
    assert.ok(names.includes('omnimux_social_data'))
  })

  it('execute resolves OMNIMUX_API_KEY from credentials when env is empty', async () => {
    const tools = {}
    const previousKey = process.env.OMNIMUX_API_KEY
    const previousToken = process.env.OMNIMUX_TOKEN
    delete process.env.OMNIMUX_API_KEY
    delete process.env.OMNIMUX_TOKEN
    const markdown = 'Title: Example Domain\n\n# Example Domain\n'
    try {
      apply({
        tools: { register(tool) { tools[tool.name] = tool } },
        provide() {},
        get(name) {
          if (name !== 'credentials') return undefined
          return {
            resolve: async (ref) => (ref === 'OMNIMUX_API_KEY' ? { value: 'sk-yaml', source: 'file' } : undefined),
          }
        },
      })
      const originalFetch = globalThis.fetch
      globalThis.fetch = async (_url, init) => {
        assert.match(String(init.headers.authorization), /^Bearer sk-yaml$/)
        return { ok: true, status: 200, text: async () => markdown, json: async () => { throw new Error('no json') } }
      }
      try {
        const result = await tools.omnimux_page_fetch.execute({ url: 'https://example.com' })
        assert.equal(result.title, 'Example Domain')
        assert.equal(result.mode, 'live')
      } finally {
        globalThis.fetch = originalFetch
      }
    } finally {
      if (previousKey === undefined) delete process.env.OMNIMUX_API_KEY
      else process.env.OMNIMUX_API_KEY = previousKey
      if (previousToken === undefined) delete process.env.OMNIMUX_TOKEN
      else process.env.OMNIMUX_TOKEN = previousToken
    }
  })

  it('omits omnimux_page_fetch when official.mount is false', () => {
    const names = []
    apply({
      tools: { register(tool) { names.push(tool.name) } },
      provide() {},
      get() { return undefined },
    }, { official: { mount: false } })
    assert.equal(names.includes('omnimux_page_fetch'), false)
    assert.ok(names.includes('omnimux_text_complete'))
  })
})
