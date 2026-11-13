import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { apply, name as pluginName, Config } from './index.js'

/**
 * Minimal cordis-like context: captures listeners and effects.
 * @param {Record<string, unknown>} handlers
 * @param {Array<() => unknown>} effects
 */
function makeCtx(handlers, effects) {
  return {
    on(event, listener) {
      assert.equal(handlers[event], undefined, `listener registered twice: ${event}`)
      handlers[event] = listener
      return listener
    },
    effect(fn, label) {
      effects.push([fn, label])
      return fn
    },
  }
}

const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms))

let captured /** @type {Array<Record<string, unknown>>} */
let originalFetch

beforeEach(() => {
  captured = []
  originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const request = /** @type {Record<string, unknown>} */ (JSON.parse(init.body))
    captured.push({ url: String(url), ...request })
    return { ok: true }
  }
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('registers pipeline listeners and reports a tool call without arguments', async () => {
  /** @type {Record<string, unknown>} */
  const handlers = {}
  /** @type {Array<[() => unknown, string]>} */
  const effects = []
  const ctx = makeCtx(handlers, effects)

  apply(ctx, { websiteId: 'w-1', flushIntervalMs: 5 })

  assert.equal(typeof handlers['tools/execute'], 'function')
  assert.equal(typeof handlers['tools/result'], 'function')
  assert.equal(typeof handlers['agent/session-start'], 'function')
  assert.equal(effects.length, 1)

  const token = Symbol('t')
  const exec = {
    name: 'workflow_run',
    token,
    arguments: { secretInput: 'never-send-this' },
    agent: { name: 'alpha' },
  }
  await handlers['tools/execute'](exec, async () => ({ isError: false }))
  handlers['tools/result'](exec, { isError: false })

  await tick()
  const sent = captured.filter((c) => c.payload?.name === 'tool-call')
  assert.equal(sent.length, 1)
  const data = /** @type {Record<string, unknown>} */ (sent[0].payload.data)
  assert.equal(data.plugin, 'omnimux-workflow')
  assert.equal(data.tool, 'workflow_run')
  assert.equal(data.isError, false)
  assert.equal(data.agent, 'alpha')
  assert.equal(typeof data.durationMs, 'number')
  assert.ok(!('secretInput' in data), 'arguments must never reach analytics')
  assert.ok(!('arguments' in data), 'arguments must never reach analytics')
})

test('error results carry name/code but never the message', async () => {
  /** @type {Record<string, unknown>} */
  const handlers = {}
  /** @type {Array<[() => unknown, string]>} */
  const effects = []
  apply(makeCtx(handlers, effects), { websiteId: 'w-1', flushIntervalMs: 5 })

  const token = Symbol('t')
  const exec = { name: 'video_process', token, agent: { name: 'beta' } }
  await handlers['tools/execute'](exec, async () => ({ isError: true, error: { message: 'sensitive echo', info: { name: 'VideoError', code: 'VIDEO_FAILED' } } }))
  handlers['tools/result'](exec, {
    isError: true,
    error: { message: 'sensitive echo', info: { name: 'VideoError', code: 'VIDEO_FAILED' } },
  })

  await tick()
  const sent = captured.filter((c) => c.payload?.name === 'tool-call')
  assert.equal(sent.length, 1)
  const data = /** @type {Record<string, unknown>} */ (sent[0].payload.data)
  assert.equal(data.plugin, 'omnimux-video')
  assert.equal(data.isError, true)
  assert.equal(data.errorName, 'VideoError')
  assert.equal(data.errorCode, 'VIDEO_FAILED')
  assert.ok(!('message' in data), 'error message must never reach analytics')
})

test('sub-dispatch calls are skipped unless trackSubCalls', async () => {
  /** @type {Record<string, unknown>} */
  const handlers = {}
  /** @type {Array<[() => unknown, string]>} */
  const effects = []
  apply(makeCtx(handlers, effects), { websiteId: 'w-1', flushIntervalMs: 5 })

  const exec = { name: 'assets_list', token: Symbol('t'), parent: Symbol('outer'), agent: { name: 'a' } }
  await handlers['tools/execute'](exec, async () => ({ isError: false }))
  handlers['tools/result'](exec, { isError: false })
  await tick()
  assert.equal(captured.filter((c) => c.payload?.name === 'tool-call').length, 0)
})

test('session-start reports agent and source', async () => {
  /** @type {Record<string, unknown>} */
  const handlers = {}
  /** @type {Array<[() => unknown, string]>} */
  const effects = []
  apply(makeCtx(handlers, effects), { websiteId: 'w-1', flushIntervalMs: 5 })

  handlers['agent/session-start']({ agent: { name: 'gamma' }, source: { kind: 'manual' } })
  await tick()
  const sent = captured.filter((c) => c.payload?.name === 'session-start')
  assert.equal(sent.length, 1)
  const data = /** @type {Record<string, unknown>} */ (sent[0].payload.data)
  assert.equal(data.agent, 'gamma')
  assert.equal(data.source, 'manual')
})

test('plugin-load event fires once at apply', async () => {
  /** @type {Record<string, unknown>} */
  const handlers = {}
  /** @type {Array<[() => unknown, string]>} */
  const effects = []
  apply(makeCtx(handlers, effects), { websiteId: 'w-1', flushIntervalMs: 5 })
  await tick()
  const sent = captured.filter((c) => c.payload?.name === 'plugin-load')
  assert.equal(sent.length, 1)
  const data = /** @type {Record<string, unknown>} */ (sent[0].payload.data)
  assert.equal(data.plugin, pluginName)
  assert.equal(typeof data.version, 'string')
})

test('unconfigured apply is a safe no-op (soft-disable)', () => {
  /** @type {Record<string, unknown>} */
  const handlers = {}
  /** @type {Array<[() => unknown, string]>} */
  const effects = []
  apply(makeCtx(handlers, effects), undefined)
  assert.deepEqual(handlers, {})
  assert.deepEqual(effects, [])
})

test('trackSessions: false drops the session listener', () => {
  /** @type {Record<string, unknown>} */
  const handlers = {}
  /** @type {Array<[() => unknown, string]>} */
  const effects = []
  apply(makeCtx(handlers, effects), { websiteId: 'w-1', trackSessions: false })
  assert.equal(typeof handlers['tools/result'], 'function')
  assert.equal(handlers['agent/session-start'], undefined)
})

test('Config validates: enabled without websiteId is an issue', () => {
  const result = Config['~standard'].validate({ enabled: true })
  assert.ok(Array.isArray(result.issues))
  assert.equal(result.issues[0].message.includes('websiteId'), true)
})

test('effect label is clear and disposal is idempotent', async () => {
  /** @type {Record<string, unknown>} */
  const handlers = {}
  /** @type {Array<[() => unknown, string]>} */
  const effects = []
  apply(makeCtx(handlers, effects), { websiteId: 'w-1', flushIntervalMs: 5 })
  assert.equal(effects[0][1], 'omnimux-analytics: dispose event queue')
  effects[0][0]()
  effects[0][0]()
  await tick()
  assert.equal(captured.length, 0)
})
