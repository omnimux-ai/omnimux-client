import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createHubChannel, extractPostId, extractRawStatus } from './hubtools.js'
import { PublishError } from './store.js'

/**
 * Mock ctx.tools: get(name) 返回注册表行；execute 严格对齐 DSH 0.2.2-rc.5
 * 批次契约 ToolBatchInput -> ToolBatchResult。行为可编程。
 * @param {Record<string, (args: object, exec: object) => unknown | Promise<unknown>>} handlers
 * @param {{ getNames?: string[] }} [opts]
 */
function mockTools(handlers, opts = {}) {
  const registered = new Set(opts.getNames ?? Object.keys(handlers))
  const calls = []
  return {
    calls,
    get: (name) => (registered.has(name) ? { name } : undefined),
    async execute(batch) {
      if (!batch || !Array.isArray(batch.calls) || batch.calls.length === 0) {
        throw new Error('Tool batch execution failed')
      }
      const results = []
      for (const block of batch.calls) {
        if (!block || block.type !== 'tool-call' || typeof block.id !== 'string' || typeof block.name !== 'string' || typeof block.arguments !== 'string') {
          throw new Error('Tool batch execution failed')
        }
        const parsedArgs = JSON.parse(block.arguments)
        const recorded = {
          callId: block.id,
          name: block.name,
          arguments: parsedArgs,
          rawArguments: block.arguments,
          signal: batch.signal,
          ...(batch.agent !== undefined ? { agent: batch.agent } : {}),
          batch,
        }
        calls.push(recorded)
        const handler = new Map(Object.entries(handlers)).get(block.name)
        if (!handler) {
          results.push({
            callId: block.id,
            result: { content: [{ type: 'text', text: `UNKNOWN_TOOL ${block.name}` }], isError: true, value: undefined },
          })
          continue
        }
        try {
          const value = await handler(parsedArgs, recorded)
          results.push({
            callId: block.id,
            result: { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false, value },
          })
        } catch (error) {
          const text = `${error instanceof Error ? error.name + ': ' + error.message : String(error)}`
          results.push({
            callId: block.id,
            result: { content: [{ type: 'text', text }], isError: true, value: undefined },
          })
        }
      }
      return { results, additionalContexts: [], concluded: false }
    },
  }
}

const okEnvelope = (data) => ({ success: true, data })

describe('HubPublishChannel lazy resolution', () => {
  it('throws needs-hub when ctx.tools is unavailable', async () => {
    const channel = createHubChannel({ tools: undefined })
    await assert.rejects(() => channel.getPost('p1'), (e) => e instanceof PublishError && e.code === 'needs-hub')
  })

  it('throws needs-hub when the tool is not registered (hub 未装载)', async () => {
    const tools = mockTools({}, { getNames: [] })
    const channel = createHubChannel({ tools })
    await assert.rejects(
      () => channel.presign({ filename: 'a.png' }),
      (e) => e instanceof PublishError && e.code === 'needs-hub' && /omnimux hub/.test(e.message),
    )
  })

  it('resolves tools lazily at call time (not construction time)', async () => {
    const tools = mockTools({})
    const channel = createHubChannel({ tools })
    // 构造时 omnimux_publish_presign 还不存在 → 调用时也不存在 → needs-hub
    await assert.rejects(() => channel.presign({ filename: 'a.png' }), (e) => e.code === 'needs-hub')
  })

  it('probes with tools.executable on 0.2.2-rc.5 and falls back to tools.get on the 0.2.1-rc.3 shell', async () => {
    // 0.2.2-rc.5: executable is the execution lookup, and it must be preferred
    // because `get` also returns conditional registrations the step refused.
    const modernProbes = []
    const modern = {
      executable: (name) => { modernProbes.push(name); return name === 'omnimux_publish_get' ? { name } : undefined },
      get: () => { throw new Error('get() must not be used when executable() exists') },
      async execute(batch) {
        return {
          results: [{ callId: batch.calls[0].id, result: { isError: false, content: [], value: okEnvelope({ id: '1', status: 'published' }) } }],
          additionalContexts: [],
          concluded: false,
        }
      },
    }
    const modernChannel = createHubChannel({ tools: modern })
    assert.deepEqual(await modernChannel.getPost('1'), { id: '1', status: 'published' })
    assert.deepEqual(modernProbes, ['omnimux_publish_get'])

    // 0.2.2-rc.5 hides conditional registrations from executable() unless the
    // step's tool set is supplied; get() still sees them and execute() still
    // dispatches, so a conditional hub tool must not be reported as missing.
    const conditionalProbes = []
    const conditional = {
      executable: (name) => { conditionalProbes.push(['executable', name]); return undefined },
      get: (name) => { conditionalProbes.push(['get', name]); return name === 'omnimux_publish_get' ? { name } : undefined },
      async execute(batch) {
        return {
          results: [{ callId: batch.calls[0].id, result: { isError: false, content: [], value: okEnvelope({ id: 'conditional' }) } }],
          additionalContexts: [],
          concluded: false,
        }
      },
    }
    const conditionalChannel = createHubChannel({ tools: conditional })
    assert.deepEqual(await conditionalChannel.getPost('c1'), { id: 'conditional' })
    assert.deepEqual(conditionalProbes, [['executable', 'omnimux_publish_get'], ['get', 'omnimux_publish_get']])

    // Frozen 0.2.1-rc.3 shell: no executable(); keep the get() probe.
    const legacyProbes = []
    const legacy = {
      executionMode: () => ({ kind: 'exclusive' }),
      get: (name) => { legacyProbes.push(name); return name === 'omnimux_publish_get' ? { name } : undefined },
      async execute(exec) {
        return { isError: false, content: [], value: okEnvelope({ id: '2' }) }
      },
    }
    const legacyChannel = createHubChannel({ tools: legacy })
    assert.deepEqual(await legacyChannel.getPost('2'), { id: '2' })
    assert.deepEqual(legacyProbes, ['omnimux_publish_get'])

    // A registry with neither probe cannot prove the tool exists.
    const blind = { async execute() { throw new Error('must not dispatch') } }
    const blindChannel = createHubChannel({ tools: blind })
    await assert.rejects(
      () => blindChannel.getPost('3'),
      (e) => e instanceof PublishError && e.code === 'needs-hub' && /工具 omnimux_publish_get 不存在/.test(e.message),
    )
  })
})

describe('HubPublishChannel error mapping', () => {
  it('maps needs-omnimux from an error result', async () => {
    const tools = mockTools({
      omnimux_accounts_list: () => {
        throw new Error('OmnimuxError: needs-omnimux sign in to OmniMux or set OMNIMUX_ACCESS_TOKEN')
      },
    })
    const channel = createHubChannel({ tools })
    await assert.rejects(
      () => channel.listAccounts(),
      (e) => e instanceof PublishError && e.code === 'needs-omnimux',
    )
  })

  it('maps structured quota-exceeded tool errors without any UI global', async () => {
    const tools = {
      get: () => ({ name: 'omnimux_publish_get' }),
      async execute(batch) {
        return {
          results: [{
            callId: batch.calls[0].id,
            result: {
              content: [{ type: 'text', text: 'quota failure' }],
              isError: true,
              error: { message: '当前操作需要更多额度', info: { code: 'quota-exceeded' } },
            },
          }],
          additionalContexts: [],
          concluded: false,
        }
      },
    }
    const channel = createHubChannel({ tools })
    await assert.rejects(
      () => channel.getPost('p1'),
      (e) => e instanceof PublishError && e.code === 'quota-exceeded' && /更多额度/.test(e.message),
    )
    assert.equal(typeof globalThis.window, 'undefined')
  })

  it('surfaces SOCIAL_TIKTOK_* structured errors and never downgrades them to quota/needs-omnimux', async () => {
    const tools = {
      get: () => ({ name: 'omnimux_publish_get' }),
      async execute(batch) {
        return {
          results: [{
            callId: batch.calls[0].id,
            result: {
              content: [{ type: 'text', text: 'rate limited' }],
              isError: true,
              error: {
                message: 'quota-exceeded must not win',
                info: {
                  code: 'SOCIAL_TIKTOK_RATE_LIMITED',
                  upstream_code: 'rate_limit_exceeded',
                  upstream_log_id: 'log-1',
                },
              },
            },
          }],
          additionalContexts: [],
          concluded: false,
        }
      },
    }
    const channel = createHubChannel({ tools })
    await assert.rejects(
      () => channel.getPost('p1'),
      (e) => e instanceof PublishError
        && e.code === 'SOCIAL_TIKTOK_RATE_LIMITED'
        && e.message === 'rate limited'
        && e.details.upstream_code === 'rate_limit_exceeded'
        && e.details.upstream_log_id === 'log-1',
    )
  })

  it('parses a trailing structured TikTok tag before legacy text classification', async () => {
    const tools = {
      get: () => ({ name: 'omnimux_publish_get' }),
      async execute(batch) {
        return {
          results: [{
            callId: batch.calls[0].id,
            result: {
              content: [{ type: 'text', text: 'rate limited [code=SOCIAL_TIKTOK_RATE_LIMITED upstream_code=rate_limit_exceeded upstream_log_id=log-2]' }],
              isError: true,
            },
          }],
          additionalContexts: [],
          concluded: false,
        }
      },
    }
    const channel = createHubChannel({ tools })
    await assert.rejects(
      () => channel.getPost('p1'),
      (e) => e instanceof PublishError
        && e.code === 'SOCIAL_TIKTOK_RATE_LIMITED'
        && e.message === 'rate limited'
        && e.details.upstream_code === 'rate_limit_exceeded'
        && e.details.upstream_log_id === 'log-2',
    )
  })

  it('unwraps success:false with a structured SOCIAL_TIKTOK_* envelope into a typed error', async () => {
    const tools = mockTools({
      omnimux_accounts_creator_info: () => ({
        success: false,
        error: 'SOCIAL_TIKTOK_TOKEN_INVALID',
        upstream_code: 'access_token_invalid',
        upstream_log_id: 'log-3',
      }),
    })
    const channel = createHubChannel({ tools })
    await assert.rejects(
      () => channel.creatorInfo('a1'),
      (e) => e instanceof PublishError
        && e.code === 'SOCIAL_TIKTOK_TOKEN_INVALID'
        && e.details.upstream_code === 'access_token_invalid'
        && e.details.upstream_log_id === 'log-3',
    )
  })

  it('preserves quota-exceeded when a non-TikTok error includes an arbitrary upstream_code', async () => {
    const tools = {
      get: () => ({ name: 'omnimux_publish_create' }),
      async execute(batch) {
        return {
          results: [{
            callId: batch.calls[0].id,
            result: {
              content: [{ type: 'text', text: 'insufficient_user_quota: top up required' }],
              isError: true,
              error: {
                message: 'insufficient_user_quota',
                info: {
                  code: 'insufficient_user_quota',
                  upstream_code: 'billing_cap_reached',
                },
              },
            },
          }],
          additionalContexts: [],
          concluded: false,
        }
      },
    }
    const channel = createHubChannel({ tools })
    await assert.rejects(
      () => channel.createPost({ provider: 'tiktok_direct', account_ids: ['a1'], media_items: [{ url: 'https://example.com/a.mp4' }] }),
      (e) => e instanceof PublishError && e.code === 'quota-exceeded',
    )
  })

  it('maps UNKNOWN_TOOL to needs-hub', async () => {
    const tools = mockTools({ omnimux_publish_get: () => ({}) }, { getNames: ['omnimux_publish_get'] })
    // get 允许（lazy 存在），execute 走 UNKNOWN_TOOL 分支：用 getNames 排除法模拟
    const missing = mockTools({}, { getNames: ['omnimux_publish_get'] })
    const channel = createHubChannel({ tools: missing })
    await assert.rejects(() => channel.getPost('p1'), (e) => e.code === 'needs-hub')
  })

  it('surfaces generic tool errors as hub-tool-error with text', async () => {
    const tools = mockTools({
      omnimux_publish_create: () => {
        throw new Error('omnimux-request-failed: HTTP 500 Internal server error')
      },
    })
    const channel = createHubChannel({ tools })
    await assert.rejects(
      () => channel.createPost({ account_ids: ['1'], content: 'x', media_items: [] }),
      (e) => e instanceof PublishError && e.code === 'hub-tool-error' && /HTTP 500/.test(e.message),
    )
  })

  it('unwraps success:false envelopes into a deterministic error', async () => {
    const tools = mockTools({
      omnimux_publish_get: () => ({ success: false, message: 'Insufficient quota. Please top up your account.' }),
    })
    const channel = createHubChannel({ tools })
    await assert.rejects(
      () => channel.getPost('p1'),
      (e) => e instanceof PublishError && e.code === 'hub-tool-error' && /Insufficient quota/.test(e.message),
    )
  })

  it('preserves structured SOCIAL_SEAT_* tail tags and envelopes without downgrading to hub-tool-error (#412)', async () => {
    const taggedTools = {
      get: () => ({ name: 'omnimux_publish_create' }),
      async execute(batch) {
        return {
          results: [{
            callId: batch.calls[0].id,
            result: {
              content: [{ type: 'text', text: 'OmnimuxError: 社媒绑定席位已过期，请续费或解绑 [code=SOCIAL_SEAT_EXPIRED]' }],
              isError: true,
            },
          }],
          additionalContexts: [],
          concluded: false,
        }
      },
    }
    const channel = createHubChannel({ tools: taggedTools })
    await assert.rejects(
      () => channel.createPost({ account_ids: ['12'], content: 'hi', media_items: [] }),
      (e) => e instanceof PublishError
        && e.code === 'SOCIAL_SEAT_EXPIRED'
        && e.details?.code === 'SOCIAL_SEAT_EXPIRED'
        && !e.message.includes('[code='),
    )

    const quotaEnvelopeTools = mockTools({
      omnimux_publish_create: () => ({
        success: false,
        code: 'SOCIAL_SEAT_QUOTA',
        message: '社媒绑定席位不足或余额不够',
        need_credits: 20,
      }),
    })
    const quotaChannel = createHubChannel({ tools: quotaEnvelopeTools })
    await assert.rejects(
      () => quotaChannel.createPost({ account_ids: ['12'], content: 'hi', media_items: [] }),
      (e) => e instanceof PublishError
        && e.code === 'quota-exceeded'
        && e.details?.code === 'SOCIAL_SEAT_QUOTA'
        && e.details?.need_credits === 20,
    )
  })
})

describe('presign / create / get payload handling', () => {
  it('presign returns upload_url + public_url from the data envelope', async () => {
    const tools = mockTools({
      omnimux_publish_presign: (args) => okEnvelope({ upload_url: 'https://up', public_url: 'https://pub' }),
    })
    const channel = createHubChannel({ tools })
    const result = await channel.presign({ filename: 'a.png', content_type: 'image/png' })
    assert.deepEqual(result, {
      upload_url: 'https://up',
      public_url: 'https://pub',
      headers: {},
      upload_method: 'PUT',
    })
    // 工具入参按 hub schema：filename + content_type
    assert.deepEqual(tools.calls[0].arguments, { filename: 'a.png', content_type: 'image/png' })
  })

  it('presign omits content_type when absent', async () => {
    const tools = mockTools({ omnimux_publish_presign: () => okEnvelope({ upload_url: 'u', public_url: 'p' }) })
    const channel = createHubChannel({ tools })
    await channel.presign({ filename: 'a.mp4' })
    assert.deepEqual(tools.calls[0].arguments, { filename: 'a.mp4' })
  })

  it('presign fails deterministically on missing url fields (防御性解析)', async () => {
    const tools = mockTools({ omnimux_publish_presign: () => okEnvelope({ foo: 'bar' }) })
    const channel = createHubChannel({ tools })
    await assert.rejects(() => channel.presign({ filename: 'a.png' }), (e) => e.code === 'hub-tool-error')
  })

  it('create/get pass agent through to ctx.tools.execute (exec.agent 透传)', async () => {
    const tools = mockTools({
      omnimux_publish_create: () => okEnvelope({ id: 42, status: 'scheduled' }),
    })
    const channel = createHubChannel({ tools })
    await channel.createPost({ account_ids: ['7'], content: 'hi', media_items: [] }, { agent: 'agent-1' })
    assert.equal(tools.calls[0].agent, 'agent-1')
    assert.ok(tools.calls[0].callId)
    assert.equal(tools.calls[0].name, 'omnimux_publish_create')
  })

  it('signal passes through to ctx.tools.execute', async () => {
    const controller = new AbortController()
    const tools = mockTools({ omnimux_publish_get: () => okEnvelope({ id: 1, status: 'published' }) })
    const channel = createHubChannel({ tools })
    await channel.getPost('1', { signal: controller.signal })
    assert.equal(tools.calls[0].signal, controller.signal)
  })

  it('fills in a live AbortSignal when execute is called without one (UI/HTTP 路径)', async () => {
    const tools = mockTools({ omnimux_accounts_list: () => ({ accounts: [{ id: '1' }] }) })
    const channel = createHubChannel({ tools })
    await channel.listAccounts()
    const signal = tools.calls[0].signal
    assert.ok(signal instanceof AbortSignal)
    assert.equal(signal.aborted, false)
  })

  it('fills in a live AbortSignal on create/presign when opts omit signal', async () => {
    const tools = mockTools({
      omnimux_publish_presign: () => okEnvelope({ upload_url: 'https://up', public_url: 'https://pub' }),
    })
    const channel = createHubChannel({ tools })
    await channel.presign({ filename: 'a.png' })
    assert.ok(tools.calls[0].signal instanceof AbortSignal)
    assert.equal(tools.calls[0].signal.aborted, false)
  })
})

describe('putBytes (预签名自授权 PUT)', () => {
  it('PUTs bytes with content-type and no auth header', async () => {
    const seen = []
    const fetcher = async (url, init) => {
      seen.push({ url, init })
      return { ok: true, status: 200 }
    }
    const channel = createHubChannel({ tools: mockTools({}), fetcher })
    await channel.putBytes('https://signed/upload', Buffer.from('bytes'), 'video/mp4')
    assert.equal(seen[0].url, 'https://signed/upload')
    assert.equal(seen[0].init.method, 'PUT')
    assert.equal(seen[0].init.headers['content-type'], 'video/mp4')
    assert.equal(seen[0].init.headers.authorization, undefined) // 预签名自授权，无 secret
  })

  it('maps non-2xx to upload-failed', async () => {
    const channel = createHubChannel({ tools: mockTools({}), fetcher: async () => ({ ok: false, status: 403 }) })
    await assert.rejects(() => channel.putBytes('https://u', Buffer.from('b'), 'image/png'), (e) => e.code === 'upload-failed')
  })

  it('network failure maps to upload-failed with the cause', async () => {
    const channel = createHubChannel({
      tools: mockTools({}),
      fetcher: async () => {
        throw new Error('ECONNREFUSED')
      },
    })
    await assert.rejects(() => channel.putBytes('https://u', Buffer.from('b'), 'image/png'), (e) => e.code === 'upload-failed' && /ECONNREFUSED/.test(e.message))
  })
})

describe('extract helpers', () => {
  it('extractPostId normalizes numbers and accepts post_id fallbacks', () => {
    assert.equal(extractPostId({ id: 7 }, 't'), '7')
    assert.equal(extractPostId({ post_id: 'abc' }, 't'), 'abc')
    assert.equal(extractPostId({ taskId: 'x' }, 't'), 'x')
    assert.throws(() => extractPostId({ status: 'published' }, 't'), (e) => e.code === 'hub-tool-error')
  })

  it('extractRawStatus returns null when status is missing', () => {
    assert.equal(extractRawStatus({ id: 1 }), null)
    assert.equal(extractRawStatus({ status: 'review' }), 'review')
  })
})

describe('presign ticket headers (Issue #3938)', () => {
  it('passes through signed headers and upload_method', async () => {
    const tools = mockTools({
      omnimux_publish_presign: () => okEnvelope({
        upload_url: 'https://up',
        public_url: 'https://pub',
        upload_method: 'put',
        headers: { 'content-type': 'image/png', 'if-none-match': '*' },
      }),
    })
    const channel = createHubChannel({ tools })
    const ticket = await channel.presign({ filename: 'a.png', content_type: 'image/png' })
    assert.equal(ticket.upload_method, 'PUT')
    assert.deepEqual(ticket.headers, { 'content-type': 'image/png', 'if-none-match': '*' })
  })

  it('defaults to PUT and empty headers when the gateway omits them', async () => {
    const tools = mockTools({ omnimux_publish_presign: () => okEnvelope({ upload_url: 'u', public_url: 'p' }) })
    const channel = createHubChannel({ tools })
    const ticket = await channel.presign({ filename: 'a.png' })
    assert.equal(ticket.upload_method, 'PUT')
    assert.deepEqual(ticket.headers, {})
  })
})

describe('putBytes replays signed headers (Issue #3938)', () => {
  it('sends every signed header, including if-none-match', async () => {
    const seen = []
    const channel = createHubChannel({
      tools: mockTools({}),
      fetcher: async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200 } },
    })
    await channel.putBytes('https://signed/upload', Buffer.from('bytes'), 'image/png', {}, {
      headers: { 'content-type': 'image/png', 'if-none-match': '*' },
      upload_method: 'PUT',
    })
    assert.equal(seen[0].init.headers['if-none-match'], '*')
    assert.equal(seen[0].init.headers['content-type'], 'image/png')
  })

  it('keeps the legacy content-type-only request when no ticket headers exist', async () => {
    const seen = []
    const channel = createHubChannel({
      tools: mockTools({}),
      fetcher: async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200 } },
    })
    await channel.putBytes('https://u', Buffer.from('b'), 'image/png')
    assert.deepEqual(seen[0].init.headers, { 'content-type': 'image/png' })
  })

  it('fails loudly on a non-PUT upload method instead of guessing', async () => {
    let called = 0
    const channel = createHubChannel({
      tools: mockTools({}),
      fetcher: async () => { called += 1; return { ok: true, status: 200 } },
    })
    await assert.rejects(
      () => channel.putBytes('https://u', Buffer.from('b'), 'image/png', {}, { upload_method: 'POST' }),
      (error) => error.code === 'upload-failed' && /POST/.test(error.message),
    )
    assert.equal(called, 0)
  })
})

describe('presign header normalization (Issue #3943)', () => {
  it('drops host and collapses case-duplicate header names', async () => {
    const tools = mockTools({
      omnimux_publish_presign: () => okEnvelope({
        upload_url: 'https://up',
        public_url: 'https://pub',
        headers: {
          Host: 'bucket.r2.cloudflarestorage.com',
          'Content-Type': 'IMAGE/PNG',
          'content-type': 'image/png',
          'If-None-Match': '*',
        },
      }),
    })
    const channel = createHubChannel({ tools })
    const ticket = await channel.presign({ filename: 'a.png', content_type: 'image/png' })
    assert.deepEqual(ticket.headers, { 'content-type': 'image/png', 'if-none-match': '*' })
    assert.equal(Object.hasOwn(ticket.headers, 'host'), false)
  })

  it('putBytes never sends host and keeps a single content-type', async () => {
    const seen = []
    const channel = createHubChannel({
      tools: mockTools({}),
      fetcher: async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200 } },
    })
    await channel.putBytes('https://signed/upload', Buffer.from('b'), 'image/png', {}, {
      headers: { Host: 'x', 'Content-Type': 'image/png', 'If-None-Match': '*' },
      upload_method: 'PUT',
    })
    const sent = seen[0].init.headers
    assert.deepEqual(Object.keys(sent).sort(), ['content-type', 'if-none-match'])
    assert.equal(sent['content-type'], 'image/png')
    assert.equal(sent['if-none-match'], '*')
  })
})

describe('creatorInfo (TikTok 发布能力)', () => {
  it('calls omnimux_accounts_creator_info with the publishing provider', async () => {
    const tools = mockTools({
      omnimux_accounts_creator_info: () => okEnvelope({ privacy_level_options: ['SELF_ONLY'], comment_disabled: false }),
    })
    const channel = createHubChannel({ tools })
    const info = await channel.creatorInfo('42')
    assert.deepEqual(info, { privacy_level_options: ['SELF_ONLY'], comment_disabled: false })
    assert.deepEqual(tools.calls[0].arguments, { id: '42', provider: 'tiktok_direct' })
  })
})

describe('DSH 0.2.2-rc.5 batch contract & 0.2.1-rc.3 fallback (#185)', () => {
  it('sends canonical ToolBatchInput by default and matches results by callId', async () => {
    const seen = []
    const tools = {
      get: () => ({ name: 'omnimux_publish_get' }),
      async execute(input) {
        seen.push(input)
        return {
          results: [
            { callId: 'unrelated-call', result: { isError: false, content: [], value: okEnvelope({ id: 'wrong' }) } },
            { callId: 'fixed-call-id', result: { isError: false, content: [], value: okEnvelope({ id: 'right', status: 'published' }) } },
          ],
          additionalContexts: [],
          concluded: false,
        }
      },
    }
    const channel = createHubChannel({ tools, idFactory: () => 'fixed-call-id' })
    const data = await channel.getPost('99', { agent: 'agent-batch' })
    assert.deepEqual(data, { id: 'right', status: 'published' })
    assert.equal(seen.length, 1)
    assert.equal(seen[0].agent, 'agent-batch')
    assert.ok(seen[0].signal instanceof AbortSignal)
    assert.deepEqual(seen[0].calls, [{
      type: 'tool-call',
      id: 'fixed-call-id',
      name: 'omnimux_publish_get',
      arguments: JSON.stringify({ id: '99', provider: 'tiktok_direct' }),
    }])
  })

  it('rejects malformed or empty batch results loudly with hub-tool-error', async () => {
    const malformedResponses = [
      null,
      undefined,
      'not-an-object',
      {},
      { results: 'not-an-array' },
      { results: [] },
      { results: [{ callId: 'call-1', result: null }] },
      { results: [{ callId: 'other-1', result: { isError: false, value: {} } }, { callId: 'other-2', result: { isError: false, value: {} } }] },
      // Legacy bare single-call result when running on default batch contract must fail loudly
      { isError: false, content: [], value: okEnvelope({ id: '1' }) },
    ]
    for (const payload of malformedResponses) {
      const tools = {
        get: () => ({ name: 'omnimux_publish_get' }),
        async execute() { return payload },
      }
      const channel = createHubChannel({ tools, idFactory: () => 'call-1' })
      await assert.rejects(
        () => channel.getPost('1'),
        (e) => e instanceof PublishError && e.code === 'hub-tool-error',
        `expected hub-tool-error for malformed payload: ${JSON.stringify(payload)}`,
      )
    }
  })

  it('falls back to legacy single-call execute ONLY when executionMode exists without setExecutor (DSH 0.2.1-rc.3)', async () => {
    const legacySeen = []
    const legacyTools = {
      executionMode: () => ({ kind: 'exclusive' }),
      get: () => ({ name: 'omnimux_accounts_list' }),
      async execute(exec) {
        legacySeen.push(exec)
        return {
          isError: false,
          content: [{ type: 'text', text: '{}' }],
          value: okEnvelope({ accounts: [{ id: 'legacy-1' }] }),
        }
      },
    }
    const legacyChannel = createHubChannel({ tools: legacyTools, idFactory: () => 'legacy-call' })
    const legacyData = await legacyChannel.listAccounts({ agent: 'legacy-agent' })
    assert.deepEqual(legacyData, { accounts: [{ id: 'legacy-1' }] })
    assert.equal(legacySeen.length, 1)
    assert.equal(legacySeen[0].callId, 'legacy-call')
    assert.equal(legacySeen[0].name, 'omnimux_accounts_list')
    assert.deepEqual(legacySeen[0].arguments, { provider: 'tiktok_direct' })
    assert.equal(legacySeen[0].agent, 'legacy-agent')
    assert.equal(Object.hasOwn(legacySeen[0], 'calls'), false)

    // When both executionMode and setExecutor exist, stay on canonical batch contract
    const hybridSeen = []
    const hybridTools = {
      executionMode: () => ({ kind: 'exclusive' }),
      setExecutor: () => () => {},
      get: () => ({ name: 'omnimux_accounts_list' }),
      async execute(input) {
        hybridSeen.push(input)
        return {
          results: [{ callId: input.calls[0].id, result: { isError: false, content: [], value: okEnvelope({ accounts: [] }) } }],
          additionalContexts: [],
          concluded: false,
        }
      },
    }
    const hybridChannel = createHubChannel({ tools: hybridTools, idFactory: () => 'hybrid-call' })
    await hybridChannel.listAccounts()
    assert.ok(Array.isArray(hybridSeen[0].calls))
    assert.equal(hybridSeen[0].calls[0].type, 'tool-call')
  })
})
