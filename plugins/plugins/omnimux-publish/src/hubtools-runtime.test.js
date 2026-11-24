/**
 * 真实 DSH 0.2.2-rc.5 `ToolsService` (`ToolRuntime`) + `ToolExecutionPipeline`
 * + `executeToolBatch` 集成回归测试（Issue #185）。
 *
 * 根治旧单测手写单调用假桩导致的假阳性漏检：直接挂载真实 Cordis Context 与
 * `@deepseek-ai/dsh-tools` 运行时，验证：
 * 1. `createHubChannel({ tools: ctx.tools })` 经真实批次管线调用全部 5 个 hub 工具并解包；
 * 2. `POST /omnimux/publish/drafts` 与 `GET /omnimux/publish/creator-info` 经真实
 *    `ToolsService.execute` 端到端通过（原 502 路径现返回 200）；
 * 3. 错误透传（`needs-omnimux`、`quota-exceeded`、`invalid-provider`、
 *    `account-provider-mismatch`、`UNKNOWN_TOOL`、通用 tool throw）；
 * 4. `signal` 预取消与运行中取消、`tools.guard()` 策略拦截与 `agent` 透传。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime, projectToolSchema } from '@deepseek-ai/dsh-tools'
import { ToolExecutionPipeline, executeToolBatch } from '@deepseek-ai/dsh-tools/pipeline'
import { createHubChannel } from './hubtools.js'
import { apply } from './index.js'
import { PublishError } from './store.js'

const LOCAL_HEADERS = {
  origin: 'http://127.0.0.1:65432',
  'sec-fetch-site': 'same-origin',
}

const jsonOut = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
}

const openObjectParams = {
  type: 'object',
  properties: {},
  additionalProperties: true,
}

/**
 * 挂载真实 DSH 0.2.2-rc.5 `ToolRuntime` + `ToolExecutionPipeline` + `executeToolBatch`。
 * @param {import('node:test').TestContext} t
 * @param {Record<string, (args: Record<string, unknown>, exec: Record<string, unknown>) => unknown | Promise<unknown>>} [handlers]
 */
async function mountRealToolRuntime(t, handlers = {}) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin({
    apply(c) {
      c.provide('systemPrompt', { tools() {}, section() {} })
    },
  })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin({
    inject: ['tools'],
    apply(c) {
      const pipeline = new ToolExecutionPipeline(c)
      c.tools.setExecutor({
        describe: (tools) => ({ schemas: tools.map((def) => projectToolSchema(def, false)) }),
        execute: (input) => executeToolBatch(input, pipeline, () => 10),
      })
    },
  })

  const runtime = ctx.get('tools')
  /** @type {Array<{ name: string, args: unknown, exec: unknown }>} */
  const seen = []
  for (const [name, fn] of Object.entries(handlers)) {
    runtime.register({
      name,
      description: `Test hub tool ${name}`,
      parameters: openObjectParams,
      output: jsonOut,
      async execute(args, exec) {
        seen.push({ name, args, exec })
        return await fn(/** @type {Record<string, unknown>} */ (args), exec)
      },
    })
  }
  return { ctx, runtime, seen }
}

/** 模拟 Node HTTP req/res。 */
function mockReqRes({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))]
  const req = {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
  /** @type {{ status: number, raw: unknown, body: unknown, headers: Record<string, string> }} */
  const captured = { status: 0, raw: undefined, body: undefined, headers: {} }
  const res = {
    writeHead(status, hdrs) {
      captured.status = status
      Object.assign(captured.headers, hdrs || {})
    },
    end(text) {
      captured.raw = text
      if (typeof text !== 'string' || text === '') return
      try {
        captured.body = JSON.parse(text)
      } catch {
        captured.body = text
      }
    },
  }
  return { req, res, captured }
}

describe('HubPublishChannel with real DSH 0.2.2-rc.5 ToolRuntime + executeToolBatch (#185)', () => {
  it('invokes all 5 registered hub tools through real ToolRuntime.execute batch pipeline and unwraps envelopes', async (t) => {
    const { runtime, seen } = await mountRealToolRuntime(t, {
      omnimux_accounts_list: () => ({
        success: true,
        data: {
          accounts: [
            { id: 'acc-tt-1', provider: 'tiktok_direct', platform: 'tiktok', username: 'creator1', status: 'active' },
          ],
        },
      }),
      omnimux_publish_presign: (args) => ({
        success: true,
        data: {
          upload_url: `https://upload.example.invalid/${args.filename}`,
          public_url: `https://cdn.example.invalid/${args.filename}`,
          upload_method: 'PUT',
          headers: { 'Content-Type': String(args.content_type || 'video/mp4') },
        },
      }),
      omnimux_publish_create: (args) => ({
        success: true,
        data: { id: `post-${/** @type {string[]} */ (args.account_ids)[0]}`, status: 'SEND_TO_USER_INBOX' },
      }),
      omnimux_publish_get: (args) => ({
        success: true,
        data: { id: args.id, status: 'published' },
      }),
      omnimux_accounts_creator_info: (args) => ({
        success: true,
        data: {
          account_id: args.id,
          privacy_level_options: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'],
          comment_disabled: false,
        },
      }),
    })

    // Confirm we are testing against the genuine 0.2.2-rc.5 ToolsService shape
    assert.equal(typeof runtime.setExecutor, 'function')
    assert.equal(typeof runtime.executionMode, 'undefined')

    const channel = createHubChannel({ tools: runtime })

    const accounts = await channel.listAccounts()
    assert.deepEqual(accounts, {
      accounts: [{ id: 'acc-tt-1', provider: 'tiktok_direct', platform: 'tiktok', username: 'creator1', status: 'active' }],
    })

    const ticket = await channel.presign({ filename: 'clip.mp4', content_type: 'video/mp4' })
    assert.deepEqual(ticket, {
      upload_url: 'https://upload.example.invalid/clip.mp4',
      public_url: 'https://cdn.example.invalid/clip.mp4',
      upload_method: 'PUT',
      headers: { 'content-type': 'video/mp4' },
    })

    const created = await channel.createPost({
      account_ids: ['acc-tt-1'],
      content: 'hello tiktok',
      media_items: [{ type: 'video', url: ticket.public_url }],
    })
    assert.deepEqual(created, { id: 'post-acc-tt-1', status: 'SEND_TO_USER_INBOX' })

    const fetched = await channel.getPost('post-acc-tt-1')
    assert.deepEqual(fetched, { id: 'post-acc-tt-1', status: 'published' })

    const info = await channel.creatorInfo('acc-tt-1')
    assert.deepEqual(info, {
      account_id: 'acc-tt-1',
      privacy_level_options: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'],
      comment_disabled: false,
    })

    assert.deepEqual(
      seen.map((entry) => entry.name),
      [
        'omnimux_accounts_list',
        'omnimux_publish_presign',
        'omnimux_publish_create',
        'omnimux_publish_get',
        'omnimux_accounts_creator_info',
      ],
    )
    assert.deepEqual(seen[0].args, { provider: 'tiktok_direct' })
    assert.deepEqual(seen[1].args, { filename: 'clip.mp4', content_type: 'video/mp4' })
    assert.equal(/** @type {Record<string, unknown>} */ (seen[2].args).provider, 'tiktok_direct')
    assert.deepEqual(seen[3].args, { id: 'post-acc-tt-1', provider: 'tiktok_direct' })
    assert.deepEqual(seen[4].args, { id: 'acc-tt-1', provider: 'tiktok_direct' })
  })

  it('completes POST /omnimux/publish/drafts end-to-end through real ToolRuntime without 502', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-publish-rt-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))

    const { ctx } = await mountRealToolRuntime(t, {
      omnimux_accounts_list: () => ({
        success: true,
        data: {
          accounts: [
            {
              id: 'acc-tt-draft',
              provider: 'tiktok_direct',
              platform: 'tiktok',
              username: 'draft_creator',
              status: 'active',
              capabilities: { upload_draft: true, publish_direct: false },
            },
          ],
        },
      }),
      omnimux_accounts_creator_info: () => ({
        success: true,
        data: { privacy_level_options: ['SELF_ONLY'], comment_disabled: false },
      }),
    })

    /** @type {Map<string, Function>} */
    const routeHandlers = new Map()
    await ctx.plugin({
      apply(c) {
        c.provide('webServer', {
          register(route) {
            routeHandlers.set(route.path, route.handler)
            return () => { routeHandlers.delete(route.path) }
          },
        })
      },
    })
    await ctx.plugin({
      name: 'omnimux-publish',
      inject: ['tools', 'systemPrompt'],
      apply(c) {
        apply(c, { dataDir: dir })
      },
    })

    const handler = routeHandlers.get('/omnimux/publish')
    assert.equal(typeof handler, 'function', '/omnimux/publish route must be registered')

    // 1. Import video media first
    const upload = mockReqRes({
      method: 'POST',
      url: '/omnimux/publish/media?filename=demo.mp4',
      headers: { ...LOCAL_HEADERS, 'content-type': 'video/mp4' },
      body: Buffer.from('fake-mp4-bytes'),
    })
    await handler(upload.req, upload.res)
    assert.equal(upload.captured.status, 200)
    const mediaId = /** @type {{ media: { id: string } }} */ (upload.captured.body).media.id
    assert.ok(mediaId)

    // 2. POST /omnimux/publish/drafts with account_ids triggers omnimux_accounts_list via real ToolRuntime.execute
    //    (Previously threw HTTP 502: "tool omnimux_accounts_list threw: Tool batch execution failed")
    const createDraft = mockReqRes({
      method: 'POST',
      url: '/omnimux/publish/drafts',
      headers: { ...LOCAL_HEADERS, 'content-type': 'application/json' },
      body: {
        type: 'video',
        payload: {
          title: 'Real Runtime Draft',
          description: 'End-to-end batch contract test',
          media: [{ media_id: mediaId, kind: 'video' }],
        },
        account_ids: ['acc-tt-draft'],
      },
    })
    await handler(createDraft.req, createDraft.res)
    assert.equal(createDraft.captured.status, 200, `expected 200, got ${createDraft.captured.status}: ${JSON.stringify(createDraft.captured.body)}`)
    const draftBody = /** @type {{ record: { id: string, account_ids: string[], status: string } }} */ (createDraft.captured.body)
    assert.match(draftBody.record.id, /^rec_/)
    assert.deepEqual(draftBody.record.account_ids, ['acc-tt-draft'])
    assert.equal(draftBody.record.status, 'draft')

    // 3. GET /omnimux/publish/creator-info also routes through real ToolRuntime.execute
    const creatorInfo = mockReqRes({
      method: 'GET',
      url: '/omnimux/publish/creator-info?id=acc-tt-draft',
    })
    await handler(creatorInfo.req, creatorInfo.res)
    assert.equal(creatorInfo.captured.status, 200)
    assert.deepEqual(creatorInfo.captured.body, {
      privacy_level_options: ['SELF_ONLY'],
      comment_disabled: false,
    })
  })

  it('propagates domain errors, UNKNOWN_TOOL, and generic throws cleanly through real ToolExecutionPipeline', async (t) => {
    const cases = [
      {
        tool: 'omnimux_accounts_list',
        invoke: (ch) => ch.listAccounts(),
        error: new Error('OmnimuxError: needs-omnimux sign in to OmniMux'),
        expectedCode: 'needs-omnimux',
      },
      {
        tool: 'omnimux_publish_create',
        invoke: (ch) => ch.createPost({ account_ids: ['acc-1'], content: 'c', media_items: [] }),
        error: new Error('quota-exceeded: insufficient_user_quota'),
        expectedCode: 'quota-exceeded',
      },
      {
        tool: 'omnimux_accounts_list',
        invoke: (ch) => ch.listAccounts(),
        error: new Error('invalid-provider: unsupported provider'),
        expectedCode: 'invalid-provider',
      },
      {
        tool: 'omnimux_publish_create',
        invoke: (ch) => ch.createPost({ account_ids: ['acc-1'], content: 'c', media_items: [] }),
        error: new Error('account-provider-mismatch: account belongs to another provider'),
        expectedCode: 'account-provider-mismatch',
      },
      {
        tool: 'omnimux_publish_get',
        invoke: (ch) => ch.getPost('p-500'),
        error: new Error('upstream gateway HTTP 503 unavailable'),
        expectedCode: 'hub-tool-error',
        expectedMessage: /HTTP 503 unavailable/,
      },
    ]

    for (const tc of cases) {
      const { runtime } = await mountRealToolRuntime(t, {
        [tc.tool]: () => { throw tc.error },
      })
      const channel = createHubChannel({ tools: runtime })
      await assert.rejects(
        () => tc.invoke(channel),
        (err) => err instanceof PublishError
          && err.code === tc.expectedCode
          && (!tc.expectedMessage || tc.expectedMessage.test(err.message)),
        `expected ${tc.expectedCode} for ${tc.tool}`,
      )
    }

    // UNKNOWN_TOOL through real pipeline: conditional registration is visible to `get(name)`
    // without a step `toolSet`, but `executable(name)` returns undefined -> pipeline yields
    // real ToolNotFoundError (`code: 'UNKNOWN_TOOL'`), which hubtools maps to `needs-hub`.
    const { runtime } = await mountRealToolRuntime(t, {})
    runtime.register(
      {
        name: 'omnimux_publish_get',
        description: 'Conditional tool unavailable outside step admission',
        parameters: openObjectParams,
        output: jsonOut,
        async execute() { return { success: true, data: { id: 'never' } } },
      },
      { when: () => false },
    )
    const channel = createHubChannel({ tools: runtime })
    await assert.rejects(
      () => channel.getPost('p-unknown'),
      (err) => err instanceof PublishError && err.code === 'needs-hub',
    )
  })

  it('honors AbortSignal cancellation (pre-aborted and in-flight) through real ToolExecutionPipeline', async (t) => {
    let preAbortedRuns = 0
    const { runtime } = await mountRealToolRuntime(t, {
      omnimux_accounts_list: () => {
        preAbortedRuns += 1
        return { success: true, data: { accounts: [] } }
      },
      omnimux_publish_get: (_args, exec) => new Promise((_resolve, reject) => {
        const sig = /** @type {AbortSignal} */ (exec.signal)
        const onAbort = () => {
          const err = new Error('aborted during execution')
          err.name = 'AbortError'
          reject(err)
        }
        if (sig.aborted) onAbort()
        else sig.addEventListener('abort', onAbort, { once: true })
      }),
    })
    const channel = createHubChannel({ tools: runtime })

    // Pre-aborted signal must skip tool body and reject with AbortError
    const preController = new AbortController()
    preController.abort()
    await assert.rejects(
      () => channel.listAccounts({ signal: preController.signal }),
      (err) => err instanceof Error && err.name === 'AbortError',
    )
    assert.equal(preAbortedRuns, 0)

    // In-flight abort propagates exec.signal to tool body and rejects with AbortError
    const liveController = new AbortController()
    const pending = channel.getPost('p-abort', { signal: liveController.signal })
    setTimeout(() => liveController.abort(), 15)
    await assert.rejects(
      () => pending,
      (err) => err instanceof Error && err.name === 'AbortError',
    )
  })

  it('enforces tools.guard() policy interception and forwards agent through real ToolRuntime', async (t) => {
    let bodyRuns = 0
    /** @type {unknown[]} */
    const guardSeenAgents = []
    /** @type {unknown[]} */
    const bodySeenAgents = []
    let shouldDeny = true

    const { runtime } = await mountRealToolRuntime(t, {
      omnimux_publish_create: (_args, exec) => {
        bodyRuns += 1
        bodySeenAgents.push(exec.agent)
        return { success: true, data: { id: 'post-guarded', status: 'submitted' } }
      },
    })

    runtime.guard((exec) => {
      guardSeenAgents.push(exec.agent)
      if (shouldDeny && exec.name === 'omnimux_publish_create') {
        return { reason: 'publish blocked by guard policy' }
      }
      return undefined
    })

    const channel = createHubChannel({ tools: runtime })
    const agentScope = { id: 'agent-publish-session' }

    // 1. Guard denies -> tool body MUST NOT run, error surfaces cleanly
    await assert.rejects(
      () => channel.createPost({ account_ids: ['acc-1'], content: 'blocked', media_items: [] }, { agent: agentScope }),
      (err) => err instanceof PublishError && err.code === 'hub-tool-error' && /publish blocked by guard policy/.test(err.message),
    )
    assert.equal(bodyRuns, 0)
    assert.equal(guardSeenAgents[0], agentScope)

    // 2. Guard allows -> tool body runs and receives the exact same agent
    shouldDeny = false
    const allowed = await channel.createPost({ account_ids: ['acc-1'], content: 'allowed', media_items: [] }, { agent: agentScope })
    assert.deepEqual(allowed, { id: 'post-guarded', status: 'submitted' })
    assert.equal(bodyRuns, 1)
    assert.equal(guardSeenAgents[1], agentScope)
    assert.equal(bodySeenAgents[0], agentScope)
  })
})
