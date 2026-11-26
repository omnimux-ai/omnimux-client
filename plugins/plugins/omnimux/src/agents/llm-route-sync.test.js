import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  activateSubscriptionRoute,
  byokPiAiApiFor,
  byokPiAiRouteId,
  deactivateSubscriptionRoute,
  reconcileSubscriptionRoutes,
  removeByokTextRoute,
  syncByokTextRoute,
} from './llm-route-sync.js'

function createFakePiAiSettings(initialUserProviders = {}, { failFirstMutateConflict = false } = {}) {
  let revision = 1
  let conflictRemaining = failFirstMutateConflict ? 1 : 0
  const baseProviders = {
    omnimux: {
      displayName: 'OmniMux',
      api: 'openai-completions',
      baseURL: 'https://api.omnimux.ai/v1',
      apiKeyEnv: 'OMNIMUX_API_KEY',
      models: [{ id: 'gemini-3.8-flash' }],
    },
  }
  const userProviders = structuredClone(initialUserProviders)

  const effectiveProviders = () => ({ ...baseProviders, ...userProviders })

  return {
    get revision() { return revision },
    get userProviders() { return structuredClone(userProviders) },
    get baseProviders() { return structuredClone(baseProviders) },
    describe: () => [{
      ns: 'llm-pi-ai',
      revision,
      base: { providers: structuredClone(baseProviders) },
      user: { providers: structuredClone(userProviders) },
      value: { providers: effectiveProviders() },
    }],
    mutate: async (ns, ops, expectedRevision) => {
      assert.equal(ns, 'llm-pi-ai')
      if (conflictRemaining > 0) {
        conflictRemaining -= 1
        revision += 1
        throw Object.assign(new Error('revision conflict'), { code: 'SETTINGS_CONFLICT' })
      }
      assert.equal(expectedRevision, revision)
      for (const op of ops) {
        const [section, key] = op.path
        assert.equal(section, 'providers')
        if (op.op === 'set') userProviders[key] = structuredClone(op.value)
        else if (op.op === 'unset') delete userProviders[key]
      }
      revision += 1
    },
  }
}

function createFakeCredentials(records = []) {
  const store = new Map(records)
  return {
    store,
    describeRecord: async (key) => ({ configured: store.has(key) }),
    readRecord: async (key) => store.get(key),
    deleteRecord: async (key) => { store.delete(key) },
  }
}

describe('llm-route-sync · subscription routes', () => {
  it('activates openai-codex with transport=sse, preserves providers.omnimux, and saves default model', async () => {
    const settings = createFakePiAiSettings({}, { failFirstMutateConflict: true })
    const credentials = createFakeCredentials([['llm-pi-ai/openai-codex', { kind: 'grant', payload: { type: 'oauth' } }]])
    const savedDefaults = []
    const llm = {
      listModels: async (providerId) => providerId === 'openai-codex'
        ? [{ id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }, { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' }]
        : [],
    }

    const res = await activateSubscriptionRoute({
      settings,
      credentials,
      llm,
      agentDefaultModel: { saveSelection: async (sel) => savedDefaults.push(sel) },
      agentId: 'codex',
      setAsDefault: true,
    })

    assert.equal(res.ok, true)
    assert.equal(res.providerId, 'openai-codex')
    assert.equal(res.defaultModel, 'gpt-6.1-sol')
    assert.deepEqual(res.models, ['gpt-5.6-sol', 'gpt-6.1-sol'])
    assert.deepEqual(settings.userProviders['openai-codex'], { displayName: 'Codex', transport: 'sse' })
    assert.equal(settings.baseProviders.omnimux.apiKeyEnv, 'OMNIMUX_API_KEY')
    assert.deepEqual(savedDefaults, [{ provider: 'openai-codex', model: 'gpt-6.1-sol' }])
  })

  it('refuses activation when credential record is missing and never writes empty route', async () => {
    const settings = createFakePiAiSettings()
    const credentials = createFakeCredentials()
    const res = await activateSubscriptionRoute({
      settings,
      credentials,
      agentId: 'codex',
    })
    assert.deepEqual(res, { ok: false, error: 'credential-missing', providerId: 'openai-codex' })
    assert.deepEqual(settings.userProviders, {})
  })

  it('refuses to overwrite an existing explicit apiKeyEnv route on anthropic', async () => {
    const settings = createFakePiAiSettings({
      anthropic: { displayName: 'Anthropic API', apiKeyEnv: 'ANTHROPIC_API_KEY' },
    })
    const credentials = createFakeCredentials([['llm-pi-ai/anthropic', { kind: 'grant', payload: { type: 'oauth' } }]])

    const res = await activateSubscriptionRoute({
      settings,
      credentials,
      agentId: 'claude',
    })
    assert.deepEqual(res, { ok: false, error: 'api-key-route-exists', providerId: 'anthropic' })
    assert.equal(settings.userProviders.anthropic.apiKeyEnv, 'ANTHROPIC_API_KEY')
  })

  it('deactivates keyless subscription route + credential while sparing apiKeyEnv routes', async () => {
    const settings = createFakePiAiSettings({
      'openai-codex': { displayName: 'Codex', transport: 'sse' },
      anthropic: { displayName: 'Anthropic API', apiKeyEnv: 'ANTHROPIC_API_KEY' },
    })
    const credentials = createFakeCredentials([
      ['llm-pi-ai/openai-codex', { kind: 'grant' }],
      ['llm-pi-ai/anthropic', { kind: 'grant' }],
    ])

    const codexOut = await deactivateSubscriptionRoute({ settings, credentials, agentId: 'codex', deleteCredential: true })
    assert.equal(codexOut.ok, true)
    assert.equal(codexOut.routeRemoved, true)
    assert.equal('openai-codex' in settings.userProviders, false)
    assert.equal(credentials.store.has('llm-pi-ai/openai-codex'), false)

    const claudeOut = await deactivateSubscriptionRoute({ settings, credentials, agentId: 'claude', deleteCredential: true })
    assert.equal(claudeOut.ok, true)
    assert.equal(claudeOut.routeRemoved, false)
    assert.equal(settings.userProviders.anthropic.apiKeyEnv, 'ANTHROPIC_API_KEY')
  })

  it('reconcileSubscriptionRoutes removes zombie keyless routes when credentials were deleted externally', async () => {
    const settings = createFakePiAiSettings({
      'openai-codex': { displayName: 'Codex', transport: 'sse' },
      'kimi-coding': { displayName: 'Kimi Code' },
      anthropic: { displayName: 'Anthropic API', apiKeyEnv: 'ANTHROPIC_API_KEY' },
    })
    const credentials = createFakeCredentials([['llm-pi-ai/kimi-coding', { kind: 'grant' }]])

    const removed = await reconcileSubscriptionRoutes({ settings, credentials })
    assert.deepEqual(removed, ['openai-codex'])
    assert.equal('openai-codex' in settings.userProviders, false)
    assert.ok(settings.userProviders['kimi-coding'])
    assert.equal(settings.userProviders.anthropic.apiKeyEnv, 'ANTHROPIC_API_KEY')
  })
})

describe('llm-route-sync · BYOK text route sync', () => {
  it('writes collision-free byok-* routes with right protocol and removes cleanly', async () => {
    const settings = createFakePiAiSettings({
      anthropic: { displayName: 'Claude' },
    })
    const defaults = []

    assert.equal(byokPiAiRouteId('anthropic'), 'byok-anthropic')
    assert.equal(byokPiAiApiFor('anthropic'), 'anthropic-messages')
    assert.equal(byokPiAiApiFor('openai'), 'openai-completions')

    const synced = await syncByokTextRoute({
      settings,
      agentDefaultModel: { saveSelection: async (sel) => defaults.push(sel) },
      provider: 'anthropic',
      endpoint: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-6',
      credentialRef: 'OMNIMUX_MEDIA_KEY_ANTHROPIC',
      bindAsDefault: true,
    })
    assert.deepEqual(synced, { ok: true, routeId: 'byok-anthropic', model: 'claude-sonnet-4-6' })
    assert.deepEqual(settings.userProviders['byok-anthropic'], {
      displayName: 'Anthropic (BYOK)',
      api: 'anthropic-messages',
      baseURL: 'https://api.anthropic.com',
      apiKeyEnv: 'OMNIMUX_MEDIA_KEY_ANTHROPIC',
      models: [{ id: 'claude-sonnet-4-6' }],
    })
    assert.deepEqual(settings.userProviders.anthropic, { displayName: 'Claude' })
    assert.deepEqual(defaults, [{ provider: 'byok-anthropic', model: 'claude-sonnet-4-6' }])

    const removed = await removeByokTextRoute({ settings, provider: 'anthropic' })
    assert.equal(removed.ok, true)
    assert.equal('byok-anthropic' in settings.userProviders, false)
    assert.deepEqual(settings.userProviders.anthropic, { displayName: 'Claude' })
  })
})

describe('llm-route-sync · reconcile resilience on transient credential errors', () => {
  it('preserves keyless subscription routes when credentials.describeRecord throws transiently', async () => {
    const settings = createFakePiAiSettings({
      'openai-codex': { displayName: 'Codex', transport: 'sse' },
    })
    const removed = await reconcileSubscriptionRoutes({
      settings,
      credentials: {
        describeRecord: async () => { throw new Error('transient-io-error') },
      },
    })
    assert.deepEqual(removed, [])
    assert.deepEqual(settings.userProviders['openai-codex'], { displayName: 'Codex', transport: 'sse' })
  })
})
