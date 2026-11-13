import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createTestToolContext } from './tool-context.js'
import { JSON_TOOL_OUTPUT } from '../tools/schema.js'

describe('createTestToolContext', () => {
  it('accepts a complete dsh-tools-shaped registration', () => {
    const { tools, ctx } = createTestToolContext()
    ctx.tools.register({
      name: 'demo_tool',
      description: 'demo',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: JSON_TOOL_OUTPUT,
      execute: async () => ({ ok: true }),
    })
    assert.equal(tools.size, 1)
    assert.ok(tools.has('demo_tool'))
  })

  it('rejects missing output the same way dsh-tools does', () => {
    const { ctx } = createTestToolContext()
    assert.throws(
      () =>
        ctx.tools.register({
          name: 'broken',
          description: 'missing output',
          parameters: { type: 'object', properties: {} },
          execute: async () => ({}),
        }),
      /must declare output/,
    )
  })

  it('rejects empty name and missing execute in strict mode', () => {
    const { ctx } = createTestToolContext()
    assert.throws(
      () =>
        ctx.tools.register({
          name: '',
          description: 'x',
          parameters: {},
          output: JSON_TOOL_OUTPUT,
          execute: async () => ({}),
        }),
      /non-empty name/,
    )
    assert.throws(
      () =>
        ctx.tools.register({
          name: 'no_exec',
          description: 'x',
          parameters: { type: 'object', properties: {} },
          output: JSON_TOOL_OUTPUT,
        }),
      /must declare execute/,
    )
  })
})
