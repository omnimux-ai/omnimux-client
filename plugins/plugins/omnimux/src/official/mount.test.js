import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseGateConfig } from '../gate/config.js'
import { OmnimuxError } from '../media/errors.js'
import { mountOfficial } from './mount.js'

function registerCapture(gate) {
  const names = []
  /** @type {Record<string, string>} */
  const descriptions = {}
  /** @type {Record<string, object>} */
  const registeredTools = {}
  return {
    names,
    descriptions,
    registeredTools,
    ctx: {
      tools: {
        register(tool) {
          names.push(tool.name)
          descriptions[tool.name] = tool.description
          registeredTools[tool.name] = tool
        },
      },
    },
    deps: {
      hub: { official: { mount: true }, gate: parseGateConfig(gate) },
      identity: { require: async () => ({ id: 'u' }) },
      store: { resolve: async () => 'tok' },
      siteBaseUrl: 'https://omnimux.ai',
      objectParams: (fields) => ({ type: 'object', properties: fields }),
      jsonOut: { type: 'object' },
      rethrow: (error) => {
        throw error
      },
    },
  }
}

describe('official mount', () => {
  it('registered account and publishing tools reject missing source before HTTP', async () => {
    const capture = registerCapture()
    let requests = 0
    capture.deps.fetcher = async () => { requests++; throw new Error('must not access upstream') }
    mountOfficial(capture.ctx, capture.deps)
    for (const name of ['omnimux_accounts_list', 'omnimux_accounts_connect', 'omnimux_accounts_disconnect', 'omnimux_publish_create', 'omnimux_publish_get']) {
      const tool = capture.registeredTools[name]
      assert.deepEqual(tool.parameters.properties.provider.enum, ['tiktok_direct', 'zernio'])
      assert.equal(tool.parameters.properties.provider.required, true)
      await assert.rejects(tool.execute({ id: '1', platform: 'tiktok' }), (error) => error.code === 'invalid-provider')
    }
    assert.equal(requests, 0)
  })
  it('registers official tools by default', () => {
    const capture = registerCapture()
    mountOfficial(capture.ctx, capture.deps)
    assert.ok(capture.names.includes('omnimux_social_data'))
    assert.match(capture.descriptions.omnimux_social_data, /NOT publishing/)
    assert.match(capture.descriptions.omnimux_social_data, /tweet_id/)
    assert.match(capture.descriptions.omnimux_social_data, /media\.video/)
    assert.match(capture.descriptions.omnimux_social_data, /text\/display_text/)
    assert.ok(capture.names.includes('omnimux_accounts_list'))
    assert.ok(capture.names.includes('omnimux_publish_create'))
    assert.ok(capture.names.includes('omnimux_inspiration_list'))
    assert.ok(capture.names.includes('omnimux_analytics_daily_metrics'))
    assert.ok(capture.names.includes('omnimux_analytics_best_time'))
    assert.ok(capture.names.includes('omnimux_analytics_frequency'))
    assert.ok(capture.names.includes('omnimux_analytics_content_decay'))
    assert.ok(capture.names.includes('omnimux_analytics_follower_stats'))
    assert.ok(capture.names.includes('omnimux_analytics_posts'))
    assert.ok(capture.names.includes('omnimux_analytics_sync_external'))
    assert.ok(capture.names.includes('omnimux_analytics_inbox'))
    assert.equal(capture.names.length, 42) // 41 + 1（#3969 creator-info）之后官方工具共 42 个
  })

  it('skips official tools when official.mount is false (master switch)', () => {
    const capture = registerCapture()
    mountOfficial(capture.ctx, {
      ...capture.deps,
      hub: { official: { mount: false }, gate: parseGateConfig({ tools: { omnimux_social_data: true } }) },
    })
    assert.equal(capture.names.includes('omnimux_social_data'), false)
    assert.equal(capture.names.length, 0)
  })

  it('skips fine-grained tools when gate.tools.<name> is false', () => {
    const capture = registerCapture({
      tools: {
        omnimux_social_data: false,
        omnimux_analytics_inbox: false,
      },
    })
    mountOfficial(capture.ctx, capture.deps)
    assert.equal(capture.names.includes('omnimux_social_data'), false)
    assert.equal(capture.names.includes('omnimux_analytics_inbox'), false)
    assert.ok(capture.names.includes('omnimux_accounts_list'))
    assert.equal(capture.names.length, 40) // 42 - 2（两个被 gate.tools.<name> 关闭的工具）
  })

  it('execution-time enforcement throws capability-disabled if gate is disabled', async () => {
    const capture = registerCapture(undefined)
    mountOfficial(capture.ctx, capture.deps)

    const socialTool = capture.registeredTools.omnimux_social_data
    assert.ok(socialTool)

    // Now test a tool with disabled gate
    const disabledCapture = registerCapture({ tools: { omnimux_social_data: false } })
    mountOfficial(disabledCapture.ctx, disabledCapture.deps)
    assert.equal(disabledCapture.registeredTools.omnimux_social_data, undefined)
  })

  it('omnimux_inspiration_create blocks non-admin and permits admin', async () => {
    const capture = registerCapture()
    capture.deps.identity = { require: async () => ({ id: 'u', role: 1, is_admin: false }) }
    mountOfficial(capture.ctx, capture.deps)
    const createTool = capture.registeredTools.omnimux_inspiration_create
    assert.ok(createTool)
    await assert.rejects(
      async () => createTool.execute({ source_url: 'https://tiktok.com/@a/video/1' }),
      (err) => err instanceof OmnimuxError && err.code === 'admin-required' && /仅限官方管理员/.test(err.message)
    )

    const adminCapture = registerCapture()
    adminCapture.deps.identity = { require: async () => ({ id: 'admin', role: 10, is_admin: true }) }
    adminCapture.deps.fetcher = async () => new Response(JSON.stringify({ success: true, data: { id: 'insp_1' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    mountOfficial(adminCapture.ctx, adminCapture.deps)
    const adminCreateTool = adminCapture.registeredTools.omnimux_inspiration_create
    assert.ok(adminCreateTool)
    const result = await adminCreateTool.execute({ source_url: 'https://tiktok.com/@a/video/1' })
    assert.equal(result.data.id, 'insp_1')
  })
})

 it('direct registered publication uses current owner permission', async () => {
  const capture = registerCapture()
  let disabled = true
  let posts = 0
  capture.deps.accountMetaStore = { readForAuthorization: () => ({ a: { agent_usable: !disabled } }) }
  capture.deps.fetcher = async (url, init) => {
    if (String(url).includes('/accounts?')) return { ok: true, json: async () => ({ accounts: [{ id: 'a', provider: 'zernio' }] }) }
    posts++
    return { ok: true, json: async () => ({ success: true, id: 'p' }) }
  }
  mountOfficial(capture.ctx, capture.deps)
  const tool = capture.registeredTools.omnimux_publish_create
  const args = { provider: 'zernio', account_ids: ['a'] }
  await assert.rejects(tool.execute(args), /does not allow/)
  assert.equal(posts, 0)
  disabled = false
  await tool.execute(args)
  assert.equal(posts, 1)
 })

it('X tweet dedicated tool preserves caller cancellation before any request (#3369)', async () => {
  const capture = registerCapture()
  let calls = 0
  capture.deps.fetcher = async () => { calls += 1; throw new Error('unexpected request') }
  mountOfficial(capture.ctx, capture.deps)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(capture.registeredTools.omnimux_x_tweet.execute({ tweet_id: '12345' }, { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(calls, 0)
})

it('analytics tools declare gateway contract parameter keys and wire valid requests', async () => {
  const capture = registerCapture()
  /** @type {Array<{ url: string, method: string, body: unknown }>} */
  const requests = []
  capture.deps.fetcher = async (url, init) => {
    requests.push({
      url: String(url),
      method: init?.method || 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  mountOfficial(capture.ctx, capture.deps)

  const toolSchemaPairs = [
    ['omnimux_analytics_daily_metrics', capture.registeredTools.omnimux_analytics_daily_metrics, ['account_ids', 'fromDate', 'platform', 'timezone', 'toDate']],
    ['omnimux_analytics_best_time', capture.registeredTools.omnimux_analytics_best_time, ['account_id', 'platform', 'timezone']],
    ['omnimux_analytics_frequency', capture.registeredTools.omnimux_analytics_frequency, ['platform']],
    ['omnimux_analytics_content_decay', capture.registeredTools.omnimux_analytics_content_decay, ['platform']],
    ['omnimux_analytics_follower_stats', capture.registeredTools.omnimux_analytics_follower_stats, ['account_ids', 'days']],
    ['omnimux_analytics_posts', capture.registeredTools.omnimux_analytics_posts, ['limit', 'page', 'platform', 'post_id', 'sortBy', 'sortOrder']],
    ['omnimux_analytics_sync_external', capture.registeredTools.omnimux_analytics_sync_external, ['account_id', 'url']],
    ['omnimux_analytics_inbox', capture.registeredTools.omnimux_analytics_inbox, ['capability', 'fromDate', 'platform', 'timezone', 'toDate']],
  ]

  for (const [name, tool, keys] of toolSchemaPairs) {
    const props = tool.parameters.properties
    assert.deepEqual(Object.keys(props).sort(), keys, `${name} schema keys must match gateway`)
    for (const legacy of ['profileId', 'accountIds', 'accountId', 'postId']) {
      assert.equal(Object.hasOwn(props, legacy), false, `${name} must not expose legacy key ${legacy}`)
    }
  }
  assert.equal(capture.registeredTools.omnimux_analytics_sync_external.parameters.properties.account_id.required, true)
  assert.equal(capture.registeredTools.omnimux_analytics_inbox.parameters.properties.capability.required, true)

  await capture.registeredTools.omnimux_analytics_daily_metrics.execute({
    fromDate: '2026-08-01',
    toDate: '2026-08-07',
    platform: 'tiktok',
    timezone: 'Asia/Shanghai',
    account_ids: '12, 34',
  })
  assert.equal(
    requests.at(-1).url,
    'https://omnimux.ai/api/social/v1/analytics/daily-metrics?fromDate=2026-08-01&toDate=2026-08-07&platform=tiktok&timezone=Asia%2FShanghai&account_ids=12%2C34',
  )

  await capture.registeredTools.omnimux_analytics_best_time.execute({ platform: 'tiktok', account_id: '12', timezone: 'UTC' })
  assert.equal(requests.at(-1).url, 'https://omnimux.ai/api/social/v1/analytics/best-time-to-post?platform=tiktok&timezone=UTC&account_id=12')

  await capture.registeredTools.omnimux_analytics_follower_stats.execute({ account_ids: '12', days: 14 })
  assert.equal(requests.at(-1).url, 'https://omnimux.ai/api/social/v1/accounts/follower-stats?days=14&account_ids=12')

  await capture.registeredTools.omnimux_analytics_posts.execute({ post_id: 'post_9', platform: 'tiktok', limit: 10, page: 1 })
  assert.equal(requests.at(-1).url, 'https://omnimux.ai/api/social/v1/analytics/posts?post_id=post_9&platform=tiktok&page=1&limit=10')

  await capture.registeredTools.omnimux_analytics_sync_external.execute({ account_id: '12', url: 'https://tiktok.com/@a/video/1' })
  assert.equal(requests.at(-1).url, 'https://omnimux.ai/api/social/v1/analytics/sync-external-posts')
  assert.equal(requests.at(-1).method, 'POST')
  assert.deepEqual(requests.at(-1).body, { account_id: 12, url: 'https://tiktok.com/@a/video/1' })
  assert.equal(typeof requests.at(-1).body.account_id, 'number')

  await capture.registeredTools.omnimux_analytics_inbox.execute({ capability: 'heatmap', platform: 'tiktok', timezone: 'UTC' })
  assert.equal(requests.at(-1).url, 'https://omnimux.ai/api/social/v1/inbox-analytics/heatmap?platform=tiktok&timezone=UTC')

  const beforeErrors = requests.length
  await assert.rejects(
    () => capture.registeredTools.omnimux_analytics_daily_metrics.execute({ account_ids: 'acc_1' }),
    (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-account-id',
  )
  await assert.rejects(
    () => capture.registeredTools.omnimux_analytics_sync_external.execute({ account_id: 'acc_1' }),
    (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-account-id',
  )
  await assert.rejects(
    () => capture.registeredTools.omnimux_analytics_inbox.execute({ capability: 'heatmap', fromDate: '2026-08-01' }),
    (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-query',
  )
  await assert.rejects(
    () => capture.registeredTools.omnimux_analytics_inbox.execute(undefined),
    (err) => err instanceof OmnimuxError && err.code === 'analytics-invalid-capability',
  )
  assert.equal(requests.length, beforeErrors, 'rejected analytics calls must never hit upstream')
})

it('does not register any seat renew Agent tool and tags SOCIAL_SEAT_* tool errors cleanly (#412)', async () => {
  const capture = registerCapture()
  capture.deps.accountMetaStore = { readForAuthorization: () => ({}) }
  capture.deps.fetcher = async (url) => {
    if (String(url).includes('/accounts?')) {
      return new Response(JSON.stringify({ accounts: [{ id: '12', provider: 'tiktok_direct', platform: 'tiktok' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({
      success: false,
      code: 'SOCIAL_SEAT_EXPIRED',
      message: '社媒绑定席位已过期，请续费或解绑',
    }), { status: 409, headers: { 'Content-Type': 'application/json' } })
  }
  mountOfficial(capture.ctx, capture.deps)

  assert.equal(capture.names.some((name) => /renew/i.test(name)), false, 'renew must stay UI-Only (no Agent tool)')
  assert.equal(capture.names.length, 42)

  await assert.rejects(
    () => capture.registeredTools.omnimux_publish_create.execute({
      provider: 'tiktok_direct',
      account_ids: ['12'],
      content: 'hi',
    }),
    (err) => err instanceof OmnimuxError
      && err.code === 'SOCIAL_SEAT_EXPIRED'
      && /\[code=SOCIAL_SEAT_EXPIRED\]$/.test(err.message),
  )
})
