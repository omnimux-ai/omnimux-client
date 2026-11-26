import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createAgentOAuthManager } from './oauth-session.js'

describe('createAgentOAuthManager', () => {
  it('auto-selects browser method, exposes auth URL, activates route, and emits hubEvents', async () => {
    const events = []
    let finishFlow = null
    const selectedOptions = []
    const authorization = {
      describe: (key) => ({ key, methods: [{ id: 'oauth' }] }),
      begin: async ({ key, method, interaction }) => {
        assert.equal(key, 'llm-pi-ai/openai-codex')
        assert.equal(method, 'oauth')
        const picked = await interaction.prompt({
          kind: 'select',
          message: 'Choose login method',
          options: [
            { id: 'browser', label: 'Browser' },
            { id: 'device_code', label: 'Device code' },
          ],
        })
        selectedOptions.push(picked)
        interaction.notify({ message: 'Open browser', url: 'https://auth.openai.com/oauth/authorize?state=abc' })
        await new Promise((resolve) => { finishFlow = resolve })
        return { status: 'authorized' }
      },
      cancel: () => {},
    }

    const authorizedCalls = []
    const manager = createAgentOAuthManager({
      getAuthorization: () => authorization,
      hubEvents: { emit: (ev) => events.push(ev) },
      onAuthorized: async (info) => {
        authorizedCalls.push(info)
        return { ok: true, models: ['gpt-6.1-sol', 'gpt-5.6-sol'], defaultModel: 'gpt-6.1-sol' }
      },
      initialWaitMs: 50,
    })

    try {
      const started = await manager.start({ agentId: 'codex', mode: 'browser', setAsDefault: true })
      assert.equal(started.ok, true)
      assert.equal(started.status, 'awaiting_user')
      assert.equal(started.notice.url, 'https://auth.openai.com/oauth/authorize?state=abc')
      assert.deepEqual(selectedOptions, ['browser'])

      finishFlow()
      await new Promise((resolve) => setTimeout(resolve, 20))

      const done = manager.status({ attemptId: started.attemptId })
      assert.equal(done.status, 'authorized')
      assert.equal(done.connected, true)
      assert.deepEqual(done.models, ['gpt-6.1-sol', 'gpt-5.6-sol'])
      assert.equal(done.defaultModel, 'gpt-6.1-sol')
      assert.equal(authorizedCalls.length, 1)
      assert.equal(authorizedCalls[0].providerId, 'openai-codex')
      assert.ok(events.some((ev) => ev.type === 'omnimux:agent-oauth:updated' && ev.payload.status === 'authorized'))
    } finally {
      manager.dispose()
    }
  })

  it('supports manual redirect URL submit and propagates prompt.signal withdrawal as non-declined AbortError', async () => {
    // 1. Manual submit completes flow
    let receivedManual = ''
    const authManual = {
      describe: () => ({ methods: [{ id: 'oauth' }] }),
      begin: async ({ interaction }) => {
        interaction.notify({ message: 'Open link', url: 'https://claude.ai/oauth/authorize' })
        receivedManual = await interaction.prompt({
          kind: 'text',
          message: 'Paste callback URL',
          placeholder: 'http://localhost:53692/callback?code=...',
        })
        return { status: 'authorized' }
      },
    }
    const manualMgr = createAgentOAuthManager({
      getAuthorization: () => authManual,
      onAuthorized: async () => ({ ok: true, models: ['claude-sonnet-4-6'], defaultModel: 'claude-sonnet-4-6' }),
      initialWaitMs: 50,
    })
    try {
      const started = await manualMgr.start({ agentId: 'claude', mode: 'copy_code' })
      assert.equal(started.status, 'awaiting_user')
      assert.ok(started.pendingPrompt?.promptId)

      const submitted = manualMgr.submit({
        attemptId: started.attemptId,
        promptId: started.pendingPrompt.promptId,
        value: 'code123#state456',
      })
      assert.equal(submitted.ok, true)
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert.equal(receivedManual, 'code123#state456')
      assert.equal(manualMgr.status({ attemptId: started.attemptId }).status, 'authorized')
    } finally {
      manualMgr.dispose()
    }

    // 2. Callback wins race: prompt.signal aborts and rejects with AbortError without failing flow
    let withdrawnError = null
    let winCallback = null
    const authRace = {
      describe: () => ({ methods: [{ id: 'oauth' }] }),
      begin: async ({ interaction }) => {
        const promptController = new AbortController()
        const promptPromise = interaction.prompt({
          kind: 'text',
          message: 'Paste callback URL',
          signal: promptController.signal,
        }).catch((err) => { withdrawnError = err })
        await new Promise((resolve) => { winCallback = resolve })
        promptController.abort()
        await promptPromise
        return { status: 'authorized' }
      },
    }
    const raceMgr = createAgentOAuthManager({
      getAuthorization: () => authRace,
      onAuthorized: async () => ({ ok: true, models: ['gpt-6.1-sol'], defaultModel: 'gpt-6.1-sol' }),
      initialWaitMs: 50,
    })
    try {
      const started = await raceMgr.start({ agentId: 'codex', mode: 'browser' })
      assert.ok(started.pendingPrompt?.promptId)
      winCallback()
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert.equal(withdrawnError?.name, 'AbortError')
      assert.equal(raceMgr.status({ attemptId: started.attemptId }).status, 'authorized')
    } finally {
      raceMgr.dispose()
    }
  })

  it('supports device_code flow, explicit cancel, timeout, secret redaction, and graceful degradation', async () => {
    // 1. Unavailable authorization service degrades cleanly
    const noAuthMgr = createAgentOAuthManager({ getAuthorization: () => undefined })
    assert.deepEqual(await noAuthMgr.start({ agentId: 'codex' }), { ok: false, error: 'authorization-unavailable' })

    // 2. Device code + explicit cancel
    const cancelledKeys = []
    const authDevice = {
      describe: () => ({ methods: [{ id: 'oauth' }] }),
      begin: async ({ interaction, signal }) => {
        interaction.notify({ message: 'Enter code', url: 'https://auth.kimi.com/device', code: 'WXYZ-1234' })
        await new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
        })
        return { status: 'cancelled' }
      },
      cancel: (key) => cancelledKeys.push(key),
    }
    const deviceMgr = createAgentOAuthManager({ getAuthorization: () => authDevice, initialWaitMs: 50 })
    try {
      const started = await deviceMgr.start({ agentId: 'kimi', mode: 'device_code' })
      assert.equal(started.ok, true)
      assert.equal(started.notice.code, 'WXYZ-1234')
      const cancelled = await deviceMgr.cancel({ attemptId: started.attemptId })
      assert.equal(cancelled.ok, true)
      assert.equal(cancelled.status, 'cancelled')
      assert.deepEqual(cancelledKeys, ['llm-pi-ai/kimi-coding'])
    } finally {
      deviceMgr.dispose()
    }

    // 3. Secret redaction in failure message
    const secretMgr = createAgentOAuthManager({
      getAuthorization: () => ({
        describe: () => ({ methods: [{ id: 'oauth' }] }),
        begin: async () => { throw new Error('upstream failed: Bearer sk-secret-token-99999999') },
      }),
      initialWaitMs: 50,
    })
    try {
      const started = await secretMgr.start({ agentId: 'codex' })
      await new Promise((resolve) => setTimeout(resolve, 20))
      const view = secretMgr.status({ attemptId: started.attemptId })
      assert.equal(view.status, 'failed')
      assert.equal(view.error.includes('sk-secret-token'), false)
    } finally {
      secretMgr.dispose()
    }
  })
})
