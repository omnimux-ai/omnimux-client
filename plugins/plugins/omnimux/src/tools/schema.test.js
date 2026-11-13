import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { JSON_TOOL_OUTPUT, objectParams, rethrow } from './schema.js'

describe('objectParams', () => {
  it('compiles required fields into a JSON Schema object', () => {
    const schema = objectParams({
      dest: { type: 'string', required: true, description: 'path' },
      wait: { type: 'boolean', description: 'optional' },
    })
    assert.deepEqual(schema, {
      type: 'object',
      properties: {
        dest: { type: 'string', description: 'path' },
        wait: { type: 'boolean', description: 'optional' },
      },
      required: ['dest'],
      additionalProperties: false,
    })
  })

  it('omits required when every field is optional', () => {
    const schema = objectParams({ prompt: { type: 'string' } })
    assert.equal('required' in schema, false)
  })
})

describe('tool helpers', () => {
  it('renders JSON tool output as a text block', () => {
    const blocks = JSON_TOOL_OUTPUT.render({}, { mode: 'live' })
    assert.deepEqual(blocks, [{ type: 'text', text: '{\n  "mode": "live"\n}' }])
  })

  it('rethrows the same error object', () => {
    const error = new Error('boom')
    assert.throws(() => rethrow(error), error)
  })
})
