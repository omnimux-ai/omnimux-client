import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { restoreLegacyMediaState } from './openreel/web/services/legacy-media-state.ts'

const source = new URL('./openreel/', import.meta.url)
const clientBundle = new URL('../../lib/client.js', import.meta.url)

const removedSurfaces = [
  {
    name: 'editing chat',
    paths: ['web/components/editor/chat/', 'web/stores/chat-store.ts', 'agent/llm.ts', 'agent/loop.ts'],
    executable: /\bmakeDirectBYOKClient\b|\bAgentChatPanel\b|\/chat\/completions|\/v1\/messages/,
  },
  {
    name: 'direct generation',
    paths: [
      'web/hooks/useKieAIPoller.ts', 'web/services/kieai/', 'web/services/secure-storage.ts',
      'web/components/editor/settings/MasterPasswordDialog.tsx',
    ],
    executable: /\buseKieAIPoller\b|\bmakeDirectBYOKClient\b|\/api\/v1\/jobs\/createTask|\/api\/v1\/jobs\/recordInfo|openSettings\(["']ai-editor["']\)/,
  },
  {
    name: 'external collaboration',
    paths: ['collab/', 'web/services/collab/', 'web/hooks/useCollabInvite.ts'],
    executable: /\buseCollabInvite\b|\bCollabProvider\b|\bCollabConnectDialog\b|\/ws\/collab\b/,
  },
]

for (const { name, paths, executable } of removedSurfaces) {
  test(`the embedded source and executable omit ${name}`, () => {
    for (const path of paths) {
      assert.equal(existsSync(new URL(path, source)), false, path)
    }
    assert.doesNotMatch(readFileSync(clientBundle, 'utf8'), executable)
  })
}

test('old service preferences are dropped at hydration and on subsequent saves', async () => {
  const key = 'openreel-settings'
  const local = new Map()
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (name) => local.get(name) ?? null, setItem: (name, value) => local.set(name, value) },
  })
  try {
    const fixture = {
      autoSave: false, autoSaveInterval: 12, audioOutputDeviceId: 'local-speakers',
      apiKeys: { old: 'synthetic-test-key' }, configuredServices: ['retired'],
      modelBaseUrl: 'https://example.invalid', agentAutoConfirm: true,
    }
    local.set(key, JSON.stringify({ state: fixture, version: 7 }))
    const { useSettingsStore: settings } = await import('./openreel/web/stores/settings-store.ts')
    for (const version of [7, 8]) {
      local.set(key, JSON.stringify({ state: fixture, version }))
      await settings.persist.rehydrate()
      const state = settings.getState()
      assert.equal(state.autoSave, false)
      assert.equal(state.autoSaveInterval, 12)
      assert.equal(state.audioOutputDeviceId, 'local-speakers')
      for (const name of ['apiKeys', 'configuredServices', 'modelBaseUrl', 'agentAutoConfirm']) {
        assert.equal(Object.hasOwn(state, name), false, name)
      }
      state.setAutoSaveInterval(9)
      const saved = JSON.parse(local.get(key))
      assert.equal(saved.version, 8)
      assert.equal(saved.state.autoSaveInterval, 9)
      assert.doesNotMatch(local.get(key), /synthetic-test-key|example\.invalid|configuredServices|agentAutoConfirm/)
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete globalThis.localStorage
  }
})

test('legacy generation results remain editable or relinkable by their original IDs', () => {
  const metadata = { width: 426, height: 240, duration: 1.5 }
  const pending = { id: 'pending', name: 'Pending clip', metadata, isPending: true, kieaiTaskId: 'old-task' }
  const failed = { id: 'failed', name: 'Offline clip', metadata, kieaiError: true }
  const stillLocal = { ...pending, id: 'recovered', blob: new Blob(['original']) }
  for (const item of [pending, failed, stillLocal]) {
    const migrated = restoreLegacyMediaState(item)
    assert.equal(migrated.id, item.id)
    assert.equal(migrated.name, item.name)
    assert.equal(migrated.metadata, metadata)
    assert.equal(migrated.blob, item.blob)
    assert.equal(migrated.isPlaceholder, !item.blob)
    for (const field of ['isPending', 'kieaiError', 'kieaiTaskId']) {
      assert.equal(Object.hasOwn(migrated, field), false, field)
    }
  }
  const normal = { id: 'real-clip', blob: new Blob(['original']) }
  assert.equal(restoreLegacyMediaState(normal), normal)
})
