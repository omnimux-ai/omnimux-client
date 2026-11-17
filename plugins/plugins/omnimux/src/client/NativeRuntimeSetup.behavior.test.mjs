import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'

const require = createRequire(import.meta.url)
const entry = new URL('./NativeRuntimeSetup.jsx', import.meta.url).pathname

const ZH = {
  'runtime.title': '运行方式',
  'runtime.hint': '文字和媒体由谁生成；账号、发布、额度仍需要登录',
  'runtime.official': '官方',
  'runtime.officialHint': '登录后使用官方默认模型',
  'runtime.officialCta': '登录 OmniMux',
  'runtime.officialContinueLogged': '继续（已登录）',
  'runtime.agent': '本地 Agent',
  'runtime.agentHint': '使用已安装的 Claude、Codex、Kimi、Qwen',
  'runtime.key': '使用自己的 Key',
  'runtime.keyHint': '使用自己的 API Key',
  'runtime.skip': '暂时跳过',
  'runtime.noAgents': '暂无可用 Agent',
  'runtime.scan': '扫描',
  'runtime.cliPanelTitle': '本地 Agent',
  'runtime.cliHeader': '已安装的本地 Agent',
  'runtime.cliCountInstalled': '{installed}/{known} 已安装',
  'runtime.continue': '继续',
  'runtime.testingConnection': '测试连接中…',
  'runtime.modelLabel': '模型',
  'runtime.cliDefaultSetting': '默认',
  'runtime.apiProvider': '服务商',
  'runtime.apiKey': 'API Key',
  'runtime.baseUrl': '接口地址',
  'runtime.model': '模型',
  'runtime.apiKeyPlaceholder': '粘贴 API Key',
  'runtime.keyRequired': '请填写接口地址和模型',
  'runtime.apiKeyRequired': '请填写 API Key',
  'runtime.responseUnconfirmed': '配置响应未确认',
  'runtime.error': '操作失败',
}
const t = (key, params) => {
  const template = ZH[key] ?? key
  return params ? template.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? '') : template
}

const stub = {
  Button: ({ children, variant: _variant, loading: _loading, ...rest }) => React.createElement('button', rest, children),
  InputField: ({ value, onChange, type = 'text', suffix: _suffix, ...rest }) => React.createElement('input', { ...rest, type, value, onChange }),
  DropdownSelect: ({ value, options, onChange, ...rest }) => React.createElement('select', {
    ...rest, value, onChange: (event) => onChange?.(event.target.value),
  }, (options ?? []).map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label))),
}

async function loadSetup() {
  const output = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'dsh-ui-kit'],
    loader: { '.jsx': 'jsx' },
  })
  const mod = { exports: {} }
  const stubRequire = (id) => id === 'dsh-ui-kit' ? stub : require(id)
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(stubRequire, mod, mod.exports)
  return mod.exports.NativeRuntimeSetup
}

const Setup = await loadSetup()

function createScope(values = {}) {
  const snapshot = { status: 'ready', value: { ...values }, writable: true }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    set: async (field, value) => { snapshot.value = { ...snapshot.value, [field]: value } },
  }
}

function installFetch({ agents = [], modeError = '', onMode } = {}) {
  const calls = []
  globalThis.fetch = async (path, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {}
    calls.push({ path, method: init.method ?? 'GET', body })
    if (path.startsWith('/omnimux/auth/status')) return { ok: true, status: 200, json: async () => ({ logged_in: false }) }
    if (path.startsWith('/omnimux/agents?refresh=1') || path === '/omnimux/agents') return { ok: true, status: 200, json: async () => ({ agents }) }
    if (path === '/omnimux/agents/select') return { ok: true, status: 200, json: async () => ({ ok: true }) }
    if (path === '/omnimux/agents/login') return { ok: true, status: 200, json: async () => ({ ok: true, launched: true, mode: 'background' }) }
    if (path === '/omnimux/byok/config' && init.method === 'PUT') return { ok: true, status: 200, json: async () => ({ saved: true, revision: 2 }) }
    if (path === '/omnimux/byok/config') return { ok: true, status: 200, json: async () => ({ revision: 1 }) }
    if (path === '/omnimux/runtime/mode') {
      if (modeError) return { ok: false, status: 400, json: async () => ({ error: modeError }) }
      onMode?.(body.mode)
      return { ok: true, status: 200, json: async () => ({ ok: true, mode: body.mode }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  }
  return calls
}

async function renderSetup(values = {}, props = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1/' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('main')
  document.body.appendChild(container)
  const root = createRoot(container)
  const scope = createScope(values)
  await act(async () => {
    root.render(React.createElement(Setup, { t, scope, renderSurface: (children) => children, accountStatus: 'signed-out', ...props }))
  })
  await flush()
  return { document: dom.window.document, root, scope }
}

async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

function byText(document, text) {
  return [...document.querySelectorAll('button')].find((node) => node.textContent.includes(text))
}

async function click(node) {
  assert.ok(node, 'button must exist')
  await act(async () => { node.click() })
  await flush()
}

function setInput(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
  descriptor.set.call(input, value)
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
}

test('hides for every configured channel and renders the fresh-install page', async () => {
  for (const values of [
    { runtimeMode: 'official' },
    { runtimeAgentId: 'claude' },
    { byokProviders: [{ provider: 'openai' }] },
    { runtimeKeyEndpoint: 'https://example.test' },
  ]) {
    const { document, root } = await renderSetup(values)
    assert.equal(document.querySelector('[data-omnimux-native-runtime]'), null)
    await act(async () => { root.unmount() })
  }
  const { document, root } = await renderSetup({})
  assert.ok(document.querySelector('[data-omnimux-native-runtime]'))
  assert.ok(byText(document, '官方'))
  assert.ok(byText(document, '本地 Agent'))
  assert.ok(byText(document, '使用自己的 Key'))
  await act(async () => { root.unmount() })
})

test('official signed-out and signed-in actions write runtimeMode and close the page', async () => {
  const calls = installFetch()
  const signedOut = await renderSetup({})
  await click(byText(signedOut.document, '官方'))
  const login = byText(signedOut.document, '登录 OmniMux')
  assert.ok(login)
  globalThis.window.__omnimuxAuth = { ensureLogin: (options) => { options.onSuccess?.(); return Promise.resolve() } }
  await click(login)
  assert.ok(calls.some((call) => call.path === '/omnimux/runtime/mode' && call.body.mode === 'official'))
  assert.equal(signedOut.document.querySelector('[data-omnimux-native-runtime]'), null)
  await act(async () => { signedOut.root.unmount() })
  delete globalThis.window.__omnimuxAuth

  const signedIn = await renderSetup({}, { accountStatus: 'credential-stored' })
  await click(byText(signedIn.document, '官方'))
  await click(byText(signedIn.document, '继续（已登录）'))
  assert.ok(calls.filter((call) => call.path === '/omnimux/runtime/mode').length === 2)
  await act(async () => { signedIn.root.unmount() })
})

test('agent scans, selects and tests an installed agent before writing runtimeMode', async () => {
  const calls = installFetch({ agents: [
    { id: 'claude', name: 'Claude', installed: true, version: '1.0', auth: { state: 'signed-in' }, models: ['sonnet'] },
    { id: 'codex', name: 'Codex', installed: false },
  ] })
  const { document, root } = await renderSetup({})
  await click(byText(document, '本地 Agent'))
  assert.ok(document.body.textContent.includes('Claude'))
  assert.ok(document.body.textContent.includes('Codex'))
  await click(byText(document, '扫描'))
  assert.ok(calls.some((call) => call.path === '/omnimux/agents?refresh=1'))
  const card = [...document.querySelectorAll('.omx-agent-card')].find((node) => node.textContent.includes('Claude'))
  await click(card)
  await click(byText(document, '继续'))
  assert.ok(calls.some((call) => call.path === '/omnimux/agents/select' && call.body.checkOnly === true))
  assert.ok(calls.some((call) => call.path === '/omnimux/agents/select' && call.body.checkOnly === undefined))
  assert.ok(calls.some((call) => call.path === '/omnimux/runtime/mode' && call.body.mode === 'agent'))
  await act(async () => { root.unmount() })
})

test('agent empty state is visible', async () => {
  installFetch({ agents: [] })
  const { document, root } = await renderSetup({})
  await click(byText(document, '本地 Agent'))
  assert.ok(document.body.textContent.includes('暂无可用 Agent'))
  await act(async () => { root.unmount() })
})

test('key validation stays on the page, then saves text-only config and writes runtimeMode', async () => {
  const calls = installFetch()
  const { document, root } = await renderSetup({})
  await click(byText(document, '使用自己的 Key'))
  const key = document.querySelector('#omnimux-key-api-key')
  const endpoint = document.querySelector('#omnimux-key-base-url')
  assert.ok(key && endpoint)
  await click(byText(document, '继续'))
  assert.ok(document.body.textContent.includes('请填写 API Key'))
  setInput(key, 'sk-test')
  setInput(endpoint, 'https://example.test/v1')
  await click(byText(document, '继续'))
  const saved = calls.find((call) => call.path === '/omnimux/byok/config' && call.method === 'PUT')
  assert.ok(saved)
  assert.equal(typeof saved.body.models.text, 'string')
  assert.ok(saved.body.models.text.length > 0)
  assert.deepEqual(saved.body.capabilities, ['text'])
  assert.ok(calls.some((call) => call.path === '/omnimux/runtime/mode' && call.body.mode === 'key'))
  assert.equal(document.querySelector('[data-omnimux-native-runtime]'), null)
  await act(async () => { root.unmount() })
})

test('a failed runtime mode write keeps the page and shows the error', async () => {
  installFetch({ modeError: 'save failed' })
  const { document, root } = await renderSetup({}, { accountStatus: 'credential-stored' })
  await click(byText(document, '官方'))
  await click(byText(document, '继续（已登录）'))
  assert.ok(document.querySelector('[data-omnimux-native-runtime]'))
  assert.ok(document.body.textContent.includes('save failed'))
  await act(async () => { root.unmount() })
})

test('skip is local-only and does not write runtimeMode', async () => {
  const calls = installFetch()
  const renderNavigation = ({ onSkip }) => React.createElement('button', { onClick: onSkip }, '暂时跳过')
  const { document, root } = await renderSetup({}, { renderNavigation })
  await click(byText(document, '暂时跳过'))
  assert.equal(document.querySelector('[data-omnimux-native-runtime]'), null)
  assert.equal(calls.some((call) => call.path === '/omnimux/runtime/mode'), false)
  await act(async () => { root.unmount() })
})
