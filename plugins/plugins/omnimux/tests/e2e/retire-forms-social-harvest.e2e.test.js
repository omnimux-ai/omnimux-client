import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { EXPLORE_MENU_ITEMS, filterExploreItemsForChannel, isAlphaEntry, resolveExploreMenuItems } from '../../src/client/sidebar-coordinator.js'
import { WORKBENCH_TAB_TITLE_FALLBACKS, WORKBENCH_TAB_TITLE_FALLBACKS_EN } from '../../src/client/workbench/focus-state.js'
import { mountHubHttp } from '../../src/host/http.js'
import { WORKBENCH_OCCUPANTS } from '../../src/workbench/contract.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../../../..')
const hubRoot = resolve(here, '../..')

test('E2E: retired plugins have zero active UI/runtime entry while session-prefill stays operational', async () => {
  assert.equal(WORKBENCH_OCCUPANTS.includes('omnimux-forms:tasks'), false)
  assert.equal(WORKBENCH_OCCUPANTS.length, 9)
  assert.equal(Object.hasOwn(WORKBENCH_TAB_TITLE_FALLBACKS, 'omnimux-forms:tasks'), false)
  assert.equal(Object.hasOwn(WORKBENCH_TAB_TITLE_FALLBACKS_EN, 'omnimux-forms:tasks'), false)

  assert.equal(EXPLORE_MENU_ITEMS.some((item) => item.pluginId === 'omnimux-forms' || item.pluginId === 'omnimux-social-harvest'), false)
  assert.deepEqual(filterExploreItemsForChannel(EXPLORE_MENU_ITEMS, 'development').map((item) => item.label), [
    '应用', '图像生成', '视频剪辑', '发布', '账号', '手机管理', '数据分析',
  ])
  assert.deepEqual(filterExploreItemsForChannel(EXPLORE_MENU_ITEMS, 'production').map((item) => item.label), ['应用', '图像生成', '视频剪辑'])
  assert.equal(resolveExploreMenuItems().some((item) => item.pluginId === 'omnimux-forms' || item.pluginId === 'omnimux-social-harvest'), false)
  assert.equal(isAlphaEntry('omnimux-forms'), false)
  assert.equal(isAlphaEntry('omnimux-social-harvest'), false)

  const registeredRoutes = []
  mountHubHttp(
    {
      inject(_deps, cb) {
        cb({
          webServer: {
            register(def) {
              registeredRoutes.push(`${def.kind}:${def.path}`)
              return () => {}
            },
          },
          effect(fn) { return fn() },
        })
      },
    },
    {
      homeDir: '/tmp',
      store: { has: async () => false, get: async () => null },
      identity: { getSnapshot: () => ({}), status: () => ({}), require: () => ({}) },
      modelKeys: { status: () => ({}) },
      siteBaseUrl: 'https://omnimux.example',
      accountMetaStore: {},
      accountAvatarStore: {},
      avatarStore: {},
      hubEvents: { subscribe: () => () => {} },
    },
  )
  assert.equal(registeredRoutes.includes('prefix:/omnimux/forms/attachments'), false)
})

test('E2E: shipped hub lib/client.js exposes __omnimuxSessionPrefill without __omnimuxForms and delivers inspiration prefill', async () => {
  const clientCode = readFileSync(join(hubRoot, 'lib', 'client.js'), 'utf8')
  const dom = new JSDOM('<!doctype html><html><body><div id="dock"></div></body></html>', {
    url: 'http://127.0.0.1:43199/',
    runScripts: 'dangerously',
  })
  dom.window.setInterval = () => 0
  dom.window.clearInterval = () => {}
  dom.window.MutationObserver = class {
    observe() {}
    disconnect() {}
    takeRecords() { return [] }
  }
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT,
  }
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  let capturedDef = null
  const slotFactories = []
  const disposers = []
  dom.window.__ModuleLoader__ = {
    load(def) {
      capturedDef = def
    },
  }
  const req = createRequire(import.meta.url)
  const mod = (name) => {
    if (name === 'react') return React
    if (name === 'react/jsx-runtime') return req('react/jsx-runtime')
    if (name === 'react/jsx-dev-runtime') return req('react/jsx-dev-runtime')
    if (name === 'react-dom') return req('react-dom')
    if (name === 'react-dom/client') return req('react-dom/client')
    if (name === '@deepseek-ai/dsh-client-ui-primitives' || name === '@deepseek-ai/dsh-client-ui-renderer') {
      return { register: () => {}, slot: () => null }
    }
    return {}
  }

  try {
    const script = dom.window.document.createElement('script')
    script.textContent = clientCode
    dom.window.document.head.append(script)
    assert.equal(capturedDef?.id, 'omnimux')

    const plugin = capturedDef.factory(mod)
    const ctx = {
      locale: { register: () => {}, bind: () => () => 'zh' },
      effect(fn) {
        const stop = fn()
        if (typeof stop === 'function') disposers.push(stop)
      },
      inject() {},
      slots: {
        inject(_name, factory) { slotFactories.push(factory) },
        register(meta, component) { return { meta, component } },
      },
    }
    plugin.apply(ctx)

    assert.equal(dom.window.__omnimuxForms, undefined)
    assert.equal(typeof dom.window.__omnimuxSessionPrefill?.queueSessionPrefill, 'function')

    const registeredSlots = slotFactories.map((fn) => fn())
    const prefillEntry = registeredSlots.find((s) => s?.meta?.id === 'omnimux:session-prefill')
    assert.equal(prefillEntry?.meta?.name, 'conversation.input.dock')

    const state = { draft: '', phase: 'plain', imageIds: [] }
    const writes = []
    const root = createRoot(dom.window.document.querySelector('#dock'))
    await act(async () => {
      root.render(React.createElement(prefillEntry.component, {
        sessionId: 'sess-e2e',
        useInput: (selector) => selector(state),
        inputActions: { setDraft(next) { writes.push(next); state.draft = next } },
      }))
    })
    let result
    await act(async () => {
      result = dom.window.__omnimuxSessionPrefill.queueSessionPrefill({ targetSessionId: 'sess-e2e', prompt: '/video-deconstruct\n\nremake', attach: () => ({ ok: true }) })
      await new Promise((r) => setTimeout(r, 80))
    })
    assert.deepEqual({ ...(await result) }, { ok: true, via: 'input-actions' })
    assert.deepEqual(writes, ['/video-deconstruct\n\nremake'])
    await act(async () => root.unmount())
    await new Promise((r) => setTimeout(r, 20))
  } finally {
    for (const stop of disposers.reverse()) {
      try { stop() } catch {}
    }
    await new Promise((r) => setTimeout(r, 10))
    globalThis.window = previous.window
    globalThis.document = previous.document
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act
    dom.window.close()
  }
})

test('E2E: omnimux-market plugins-column renders zero omnimux-forms or omnimux-social-harvest cards', async () => {
  const marketBootStubPlugin = {
    name: 'market-client-ui-stubs',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^\.\/(boot|skills-ui)\.js$/ }, (args) => ({
        path: args.path,
        namespace: 'market-ui-stub',
      }))
      pluginBuild.onLoad({ filter: /.*/, namespace: 'market-ui-stub' }, (args) => {
        if (args.path === './boot.js') {
          return { contents: `export { createElement as h, useState } from 'react';`, loader: 'js', resolveDir: join(repoRoot, 'plugins/plugins/omnimux-market') }
        }
        return {
          contents: `
            import { createElement as h } from 'react';
            export const DetailSwitch = ({ checked, disabled, onChange }) =>
              h('input', { type: 'checkbox', checked, disabled, onChange: (e) => onChange?.(e.target.checked) });
          `,
          loader: 'js',
          resolveDir: join(repoRoot, 'plugins/plugins/omnimux-market'),
        }
      })
    },
  }
  const built = await build({
    absWorkingDir: join(repoRoot, 'plugins/plugins/omnimux-market'),
    stdin: {
      contents: `
        import * as React from 'react';
        import * as ReactDOMClient from 'react-dom/client';
        import { PluginsColumnTab } from './plugins-column.js';
        window.__marketColTest = { PluginsColumnTab, React, ReactDOMClient };
      `,
      resolveDir: join(repoRoot, 'plugins/plugins/omnimux-market/src/client'),
      loader: 'js',
    },
    plugins: [marketBootStubPlugin],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    logLevel: 'warning',
  })

  const dom = new JSDOM('<!doctype html><html><body><div id="market"></div></body></html>', {
    url: 'http://127.0.0.1:43198/',
    runScripts: 'dangerously',
  })
  dom.window.IS_REACT_ACT_ENVIRONMENT = true
  dom.window.MessageChannel = class {
    constructor() {
      this.port1 = { onmessage: null }
      this.port2 = { postMessage: () => setImmediate(() => this.port1.onmessage?.()) }
    }
  }

  try {
    const script = dom.window.document.createElement('script')
    script.textContent = built.outputFiles[0].text
    dom.window.document.head.append(script)
    const { PluginsColumnTab, React: R, ReactDOMClient } = dom.window.__marketColTest
    const root = ReactDOMClient.createRoot(dom.window.document.querySelector('#market'))
    await R.act(async () => {
      root.render(R.createElement(PluginsColumnTab, { searchQuery: '', tr: (k) => k, isEn: false }))
    })
    const names = [...dom.window.document.querySelectorAll('.sh-plugin-name')].map((el) => el.textContent)
    assert.equal(names.includes('动态表单'), false)
    assert.equal(names.includes('社媒采集'), false)
    assert.equal(names.includes('灵感工作台'), true)
    assert.equal(names.includes('创意资产库'), true)

    for (const q of ['omnimux-forms', 'omnimux-social-harvest', '动态表单', '社媒采集']) {
      await R.act(async () => {
        root.render(R.createElement(PluginsColumnTab, { searchQuery: q, tr: (k) => k, isEn: false }))
      })
      assert.equal(dom.window.document.querySelectorAll('.sh-plugin-card').length, 0, `search "${q}" must yield 0 cards`)
      assert.equal(Boolean(dom.window.document.querySelector('.sh-plugins-empty-container')), true)
    }
    await R.act(async () => root.unmount())
  } finally {
    dom.window.close()
  }
})
