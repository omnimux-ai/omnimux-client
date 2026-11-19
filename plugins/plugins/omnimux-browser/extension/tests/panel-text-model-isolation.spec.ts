// @vitest-environment jsdom
// @ts-nocheck
//
// 设置面板「对话模型」/「文本生成模型」的隔离（Issue #3629 · A1）。

import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

const LABEL_CHAT = '对话模型'
const LABEL_TEXT = '文本生成模型'
const TAB_ID = 7
const CONNECTION = { id: 'host-a', url: 'ws://127.0.0.1:45120/ext/bridge' }
const HOST_CATALOG = {
  default: { provider: 'local', model: 'chat-default', reasoningEffort: 'high' },
  groups: [
    { id: 'local', name: 'Local', models: [
      { id: 'chat-default', name: 'Desktop Chat', reasoning: {
        efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low',
      } },
      { id: 'shared', name: 'Shared Local' },
    ] },
    { id: 'relay', name: 'Relay', models: [{ id: 'shared', name: 'Shared Relay' }] },
  ],
}
const modelValue = (provider, model) => JSON.stringify([provider, model])

let panelApi = null
let onStatus = null
let rpc = null
let updateSettings = null
let root = null

vi.mock('../src/panel/api.ts', () => {
  class PanelRpcError extends Error {}
  return {
    connectPanel: () => panelApi,
    PanelRpcError,
  }
})

import { App } from '../src/panel/App.tsx'

/** 设置面板需要的扩展 API 面；settings 读始终回 dshSettings 信封。 */
function stubChrome(storedSettings) {
  const set = vi.fn(async () => undefined)
  const get = vi.fn(async () => ({ dshSettings: storedSettings }))
  globalThis.chrome = {
    // 中文 UI，断言读到的就是用户看到的文案。
    i18n: { getUILanguage: () => 'zh-CN' },
    storage: {
      local: { get, set },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
    runtime: {
      getURL: (path) => 'chrome-extension://test/' + path,
      sendMessage: vi.fn(async () => undefined),
      onMessage: { addListener: () => {}, removeListener: () => {} },
    },
    tabs: { query: vi.fn(async () => [{ id: TAB_ID }]), sendMessage: vi.fn(async () => undefined) },
    windows: { getCurrent: vi.fn(async () => ({ id: 1 })) },
  }
  return { set, get }
}

/** 按行标签取该行自己的模型选择器。 */
function selectIn(labelText) {
  const row = Array.from(document.querySelectorAll('.settings-panel label'))
    .find((label) => (label.querySelector('span')?.textContent || '').includes(labelText))
  assert.ok(row, '找不到设置行：' + labelText)
  const select = row.querySelector('select')
  assert.ok(select, '设置行里没有 select：' + labelText)
  return select
}

async function openSettings({ connected = true } = {}) {
  await act(async () => { root.render(createElement(App)) })
  if (connected) await connect(CONNECTION)
  await vi.waitFor(() => { assert.ok(document.querySelector('.settings-trigger')) })
  await act(async () => { document.querySelector('.settings-trigger').click() })
  await vi.waitFor(() => { assert.ok(document.querySelector('.settings-actions')) })
}

async function connect(connection) {
  await act(async () => { onStatus('connected', null, undefined, connection) })
}

function catalogValues(label) {
  return Array.from(selectIn(label).querySelectorAll('optgroup option')).map((option) => option.value)
}

async function choose(select, value) {
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

beforeEach(() => {
  const storage = globalThis.localStorage
  if (storage !== undefined && typeof storage.clear === 'function') storage.clear()
  document.body.innerHTML = '<div id="root"></div>'
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  HTMLElement.prototype.scrollTo = () => {}
  globalThis.fetch = async () => { throw new Error('offline') }
  stubChrome({})

  rpc = vi.fn(async (method) => {
    if (method === 'session.create') return { sessionId: 'session-current' }
    if (method === 'session.history') return { events: [] }
    if (method === 'settings.describe') return { namespaces: [] }
    if (method === 'session.modelCatalog') return HOST_CATALOG
    if (['settings.mutate', 'session.selectModel', 'bridge.modelMode'].includes(method)) return {}
    if (method === 'credentials.describe') return { credentials: {} }
    throw new Error('unexpected RPC: ' + method)
  })
  updateSettings = vi.fn(async () => undefined)
  const unsubscribe = () => {}
  panelApi = {
    rpc: (...args) => rpc(...args),
    respond: vi.fn(async () => undefined),
    onStatus: vi.fn((callback) => { onStatus = callback; return unsubscribe }),
    onEvent: vi.fn(() => unsubscribe),
    onApprovalRequest: vi.fn(() => unsubscribe),
    onApprovalResolved: vi.fn(() => unsubscribe),
    onTabAffinity: vi.fn(() => unsubscribe),
    onSelection: vi.fn(() => unsubscribe),
    onMediaAttach: vi.fn(() => unsubscribe),
    onSessionResumeHint: vi.fn(() => unsubscribe),
    onTaskLocate: vi.fn(() => unsubscribe),
    respondToApproval: vi.fn(async () => undefined),
    resolveTabAffinity: vi.fn(async () => undefined),
    rebindTabAffinity: vi.fn(async () => undefined),
    clearSelection: vi.fn(async () => undefined),
    registerWindow: vi.fn(async () => undefined),
    setActiveSession: vi.fn(async () => undefined),
    updateSettings,
    requestStatus: vi.fn(async () => undefined),
  }
  root = createRoot(document.querySelector('#root'))
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  delete globalThis.chrome
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

describe('Settings model catalog', () => {
  it('loads one host catalog for both rows after cold connection without mutating chat defaults', async () => {
    globalThis.localStorage.setItem('omnimux_default_model', 'stale-browser-model')
    await openSettings({ connected: false })
    assert.equal(selectIn(LABEL_CHAT).disabled, true)
    assert.deepEqual(catalogValues(LABEL_CHAT), [])

    await connect(CONNECTION)
    const expected = [modelValue('local', 'chat-default'), modelValue('local', 'shared'), modelValue('relay', 'shared')]
    assert.deepEqual(catalogValues(LABEL_CHAT), expected)
    assert.deepEqual(catalogValues(LABEL_TEXT), expected)
    assert.equal(selectIn(LABEL_CHAT).value, expected[0])
    assert.equal(selectIn(LABEL_TEXT).value, '')
    assert.deepEqual(rpc.mock.calls.filter(([method, , id]) => method === 'session.modelCatalog' && id !== undefined), [
      ['session.modelCatalog', {}, CONNECTION.id],
    ])
    assert.equal(rpc.mock.calls.some(([method]) => method === 'settings.mutate'), false)
    assert.equal(globalThis.localStorage.getItem('omnimux_default_model'), 'stale-browser-model')
  })

  it('selects an exact text provider and clears only the text override when following chat', async () => {
    await openSettings()
    await choose(selectIn(LABEL_TEXT), modelValue('local', 'shared'))
    await choose(selectIn(LABEL_TEXT), modelValue('relay', 'shared'))
    assert.deepEqual(updateSettings.mock.calls.at(-1), [{ textModel: 'shared', textProvider: 'relay', textEffort: '' }])
    await choose(selectIn(LABEL_TEXT), '')
    assert.deepEqual(updateSettings.mock.calls.at(-1), [{ textModel: '', textProvider: '', textEffort: '' }])
    assert.equal(selectIn(LABEL_CHAT).value, modelValue('local', 'chat-default'))
    assert.equal(rpc.mock.calls.some(([method]) => method === 'settings.mutate'), false)
  })

  it('updates the complete chat selection on its host and keeps the saved text setting', async () => {
    stubChrome({ textModel: 'shared', textProvider: 'local' })
    await openSettings()
    await choose(selectIn(LABEL_CHAT), modelValue('relay', 'shared'))
    assert.equal(selectIn(LABEL_CHAT).value, modelValue('relay', 'shared'))
    assert.equal(selectIn(LABEL_TEXT).value, modelValue('local', 'shared'))
    assert.deepEqual(updateSettings.mock.calls, [])
    assert.ok(rpc.mock.calls.some(([method, payload, id]) => method === 'bridge.modelMode' && payload.auto === false && id === CONNECTION.id))
    assert.deepEqual(rpc.mock.calls.find(([method]) => method === 'settings.mutate'), [
      'settings.mutate', {
        ns: 'agent-default-model',
        ops: [
          { op: 'set', path: ['model'], value: 'shared' },
          { op: 'set', path: ['provider'], value: 'relay' },
          { op: 'unset', path: ['reasoningEffort'] },
        ],
      }, CONNECTION.id,
    ])
  })

  it('keeps the explicitly chosen chat route when saving with an existing relay', async () => {
    const base = rpc.getMockImplementation()
    rpc.mockImplementation((method, payload, id) => method === 'settings.describe' ? Promise.resolve({
      namespaces: [
        { ns: 'agent-default-model', value: { provider: 'relay-existing', model: 'old-model' } },
        { ns: 'llm-pi-ai', value: { providers: {
          'relay-existing': { displayName: 'Existing Relay', models: [{ id: 'old-model' }] },
        } } },
      ],
    }) : base(method, payload, id))

    await openSettings()
    await vi.waitFor(() => assert.ok(document.querySelector('.relay-profile-actions')))
    await choose(selectIn(LABEL_CHAT), modelValue('relay', 'shared'))
    await act(async () => { document.querySelector('.settings-actions button.primary').click() })
    await vi.waitFor(() => assert.equal(updateSettings.mock.calls.length, 1))
    const writes = rpc.mock.calls.filter(([method, payload]) =>
      method === 'settings.mutate' && payload.ns === 'agent-default-model')
    assert.equal(writes.length, 1)
    assert.equal(writes[0][1].ops.find((op) => op.path[0] === 'model').value, 'shared')
  })

  it('refreshes the shared directory and desktop default when settings regain focus', async () => {
    await openSettings()
    const refreshed = { groups: [HOST_CATALOG.groups[1]], default: { model: 'shared', provider: 'relay' } }
    const defaultRpc = rpc.getMockImplementation()
    rpc.mockImplementation((method, payload, id) => method === 'session.modelCatalog'
      ? Promise.resolve(refreshed)
      : defaultRpc(method, payload, id))

    await act(async () => { window.dispatchEvent(new Event('focus')) })
    const expected = [modelValue('relay', 'shared')]
    assert.deepEqual(catalogValues(LABEL_CHAT), expected)
    assert.deepEqual(catalogValues(LABEL_TEXT), expected)
    assert.equal(selectIn(LABEL_CHAT).value, expected[0])
    assert.equal(rpc.mock.calls.some(([method]) => method === 'settings.mutate'), false)
  })

  it('ignores a stale response and honors an empty catalog on the replacement connection', async () => {
    let resolveStale
    const stale = new Promise((resolve) => { resolveStale = resolve })
    const defaultRpc = rpc.getMockImplementation()
    rpc.mockImplementation((method, payload, id) => method === 'session.modelCatalog'
      ? id === CONNECTION.id ? stale : Promise.resolve({ groups: [] })
      : defaultRpc(method, payload, id))

    await openSettings()
    await connect({ id: 'host-b', url: 'ws://127.0.0.1:45121/ext/bridge' })
    await act(async () => { resolveStale(HOST_CATALOG) })
    assert.ok(selectIn(LABEL_CHAT).textContent.includes('暂无可用模型'))
    assert.deepEqual(catalogValues(LABEL_CHAT), [])
    assert.deepEqual(catalogValues(LABEL_TEXT), [])
  })
})
