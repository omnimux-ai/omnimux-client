import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import { JSDOM } from 'jsdom'
import { en, zh } from './locales.js'

const bootstrap = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost:3000' })
globalThis.window = bootstrap.window
globalThis.document = bootstrap.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = await import('react')
const { createRoot } = await import('react-dom/client')

const here = fileURLToPath(new URL('.', import.meta.url))
const shimEntry = join(here, '../../tests/fixtures', 'ui-kit-shim.mjs')
const cacheDir = join(here, '.esbuild-cache', 'no-auto-analyze')

let bundleCounter = 0
/** @type {Array<() => Promise<void>>} */
const pendingTeardowns = []

/**
 * @param {string} entryFile
 * @returns {Promise<string>}
 */
async function bundle(entryFile) {
  mkdirSync(cacheDir, { recursive: true })
  const outFile = join(cacheDir, `dialog-${bundleCounter}.mjs`)
  bundleCounter += 1
  const result = await esbuild.build({
    absWorkingDir: join(here, '..', '..'),
    entryPoints: [join(here, entryFile)],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    write: false,
    logLevel: 'silent',
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
    plugins: [{
      name: 'ui-kit-shim',
      setup(build) {
        build.onResolve({ filter: /^dsh-ui-kit$/ }, () => ({ path: shimEntry }))
      },
    }],
  })
  const code = result.outputFiles?.[0]?.text
  if (!code) throw new Error(`esbuild produced no bundle for ${entryFile}`)
  writeFileSync(outFile, code)
  return outFile
}

/**
 * @param {string} entryFile
 * @param {object} props
 * @param {string} exportName
 */
async function mountDialog(entryFile, props, exportName) {
  const modulePath = await bundle(entryFile)
  const mod = await import(`${modulePath}?mount=${bundleCounter}`)
  const Component = mod[exportName]
  assert.equal(typeof Component, 'function', `${entryFile} must export ${exportName}`)

  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>', {
    url: 'http://localhost:3000',
  })
  dom.window.localStorage.setItem('omnimux_inspiration_auto_analyze', 'true')
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT,
  }
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.localStorage = dom.window.localStorage
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  let root = null
  const teardown = async () => {
    if (root) {
      const mounted = root
      root = null
      await React.act(async () => mounted.unmount())
    }
    globalThis.window = previous.window
    globalThis.document = previous.document
    if (previous.localStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previous.localStorage
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act
    dom.window.close()
  }
  pendingTeardowns.push(teardown)

  const container = dom.window.document.getElementById('host')
  try {
    root = createRoot(container)
    await React.act(async () => {
      root.render(React.createElement(Component, props))
    })
  } catch (error) {
    await teardown()
    throw error
  }

  return {
    container,
    window: dom.window,
    async unmount() {
      const index = pendingTeardowns.indexOf(teardown)
      if (index !== -1) pendingTeardowns.splice(index, 1)
      await teardown()
    },
  }
}

function stubFetch(handler) {
  const previous = globalThis.fetch
  const calls = []
  globalThis.fetch = async (path, init) => {
    const call = { path: String(path), body: JSON.parse(init?.body ?? '{}') }
    calls.push(call)
    return handler(call)
  }
  return {
    calls,
    restore() {
      globalThis.fetch = previous
    },
  }
}

async function setInputValue(win, input, value) {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new win.Event('input', { bubbles: true }))
  })
}

async function blurInput(win, input) {
  await React.act(async () => {
    input.dispatchEvent(new win.FocusEvent('blur'))
    input.dispatchEvent(new win.FocusEvent('focusout', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function settle(predicate) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return true
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
  return false
}

process.on('exit', () => {
  rmSync(cacheDir, { recursive: true, force: true })
})

after(async () => {
  while (pendingTeardowns.length > 0) {
    await pendingTeardowns.pop()()
  }
  rmSync(cacheDir, { recursive: true, force: true })
  await esbuild.stop()
})

const SAMPLE_URL = 'https://x.com/thedankoe/status/2125643815122002300'
const t = (key) => zh[key] || key

describe('import dialogs — no auto-analyze switch e2e regression', () => {
  it('InspirationInlineImportDialog renders no auto-analyze switch and always submits auto_analyze: false even when legacy localStorage is true', async () => {
    const placeholder = {
      id: 'insp_no_auto_1',
      title: SAMPLE_URL,
      source_url: SAMPLE_URL,
      auto_analyze: false,
      import_status: 'importing',
      import_stage: 'resolving',
    }
    const fetchStub = stubFetch((call) => {
      if (call.path.includes('/classify')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { kind: 'content', platform: 'x' } }),
        }
      }
      return {
        ok: true,
        status: 202,
        json: async () => ({ data: placeholder }),
      }
    })
    const imported = []
    let closed = 0
    let mounted
    try {
      mounted = await mountDialog('InspirationInlineImportDialog.jsx', {
        open: true,
        t,
        onClose() { closed += 1 },
        onImported(item) { imported.push(item) },
      }, 'InspirationInlineImportDialog')

      const urlInput = mounted.container.querySelector('input[type="url"]')
      await setInputValue(mounted.window, urlInput, SAMPLE_URL)
      await blurInput(mounted.window, urlInput)
      await settle(() => mounted.container.querySelector('.omnimux-inspiration-import-echo') !== null)

      const echo = mounted.container.querySelector('.omnimux-inspiration-import-echo')
      assert.equal(echo?.getAttribute('data-kind'), 'content')
      assert.equal(echo?.textContent, zh['add.echoContent'])

      assert.equal(mounted.container.querySelectorAll('[role="switch"]').length, 0)
      assert.equal(mounted.container.textContent.includes('导入后自动执行 AI 多维内容解构分析'), false)
      assert.equal(mounted.container.textContent.includes('Automatically run AI multi-dimensional breakdown'), false)

      const tagsToggle = mounted.container.querySelector('.omnimux-inspiration-tags-toggle')
      await React.act(async () => {
        tagsToggle.dispatchEvent(new mounted.window.MouseEvent('click', { bubbles: true }))
      })
      const tagsInput = mounted.container.querySelector('input[type="text"]')
      await setInputValue(mounted.window, tagsInput, '钩子, 测试')

      const form = mounted.container.querySelector('form')
      await React.act(async () => {
        form.dispatchEvent(new mounted.window.Event('submit', { bubbles: true, cancelable: true }))
      })
      await settle(() => imported.length === 1)

      const importCalls = fetchStub.calls.filter((call) => call.path.includes('/import-url'))
      assert.equal(importCalls.length, 1)
      assert.deepEqual(importCalls[0].body, {
        url: SAMPLE_URL,
        tags: ['钩子', '测试'],
        auto_analyze: false,
        background: true,
      })
      assert.equal(closed, 1)
      assert.deepEqual(imported.map((item) => item.id), ['insp_no_auto_1'])
    } finally {
      await mounted?.unmount()
      fetchStub.restore()
    }
  })

  it('RivalImportDialog renders no auto-analyze switch and always submits auto_analyze: false for content URLs', async () => {
    const placeholder = {
      id: 'insp_no_auto_2',
      title: SAMPLE_URL,
      source_url: SAMPLE_URL,
      auto_analyze: false,
      import_status: 'importing',
      import_stage: 'resolving',
    }
    const fetchStub = stubFetch((call) => {
      if (call.path.includes('/classify')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { kind: 'content', platform: 'x' } }),
        }
      }
      return {
        ok: true,
        status: 202,
        json: async () => ({ data: placeholder }),
      }
    })
    const imported = []
    let mounted
    try {
      mounted = await mountDialog('RivalImportDialog.jsx', {
        open: true,
        t: (key) => en[key] || key,
        onClose() {},
        onImported(item) { imported.push(item) },
      }, 'RivalImportDialog')

      const urlInput = mounted.container.querySelector('input[type="url"]')
      await setInputValue(mounted.window, urlInput, SAMPLE_URL)
      await blurInput(mounted.window, urlInput)
      await settle(() => mounted.container.querySelector('.omnimux-rival-import-echo') !== null)

      const echo = mounted.container.querySelector('.omnimux-rival-import-echo')
      assert.equal(echo?.getAttribute('data-kind'), 'content')
      assert.equal(echo?.textContent, en['rivalAccounts.import.echoContent'])

      assert.equal(mounted.container.querySelectorAll('[role="switch"]').length, 0)
      assert.equal(mounted.container.textContent.includes('导入后自动执行 AI 多维内容解构分析'), false)
      assert.equal(mounted.container.textContent.includes('Automatically run AI multi-dimensional breakdown'), false)

      const tagsToggle = mounted.container.querySelector('.omnimux-inspiration-tags-toggle')
      await React.act(async () => {
        tagsToggle.dispatchEvent(new mounted.window.MouseEvent('click', { bubbles: true }))
      })
      const tagsInput = mounted.container.querySelector('input[type="text"]')
      await setInputValue(mounted.window, tagsInput, 'rival, ref')

      const form = mounted.container.querySelector('form')
      await React.act(async () => {
        form.dispatchEvent(new mounted.window.Event('submit', { bubbles: true, cancelable: true }))
      })
      await settle(() => imported.length === 1)

      const importCalls = fetchStub.calls.filter((call) => call.path.includes('/import-url'))
      assert.equal(importCalls.length, 1)
      assert.deepEqual(importCalls[0].body, {
        url: SAMPLE_URL,
        tags: ['rival', 'ref'],
        auto_analyze: false,
        background: true,
      })
      assert.deepEqual(imported.map((item) => item.id), ['insp_no_auto_2'])
    } finally {
      await mounted?.unmount()
      fetchStub.restore()
    }
  })
})
