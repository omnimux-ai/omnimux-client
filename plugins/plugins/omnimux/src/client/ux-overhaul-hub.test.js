import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { createAttachmentStore } from './attachments/store.ts'
import { createLinkReference, normalizeUserLinkInput, validLinkUrl } from './attachments/linkReference.ts'
import { createComposerAddController } from './composer-add/controller.js'
import { en, zh } from './locales.js'
import { createWelcomeHeaderElement, resolveGreetingUserName } from './welcome-greeting.js'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')
const require = createRequire(import.meta.url)

async function loadJsxModule(relPath, extraStubs = {}) {
  const output = await build({
    entryPoints: [join(here, relPath)],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    nodePaths: [resolve(repo, 'plugins/omnimux/node_modules')],
    external: ['react', 'react-dom', 'dsh-ui-kit', '@deepseek-ai/dsh-client-ui-primitives', ...Object.keys(extraStubs)],
    loader: { '.jsx': 'jsx', '.js': 'jsx', '.ts': 'ts', '.tsx': 'tsx' },
  })
  const dshStub = {
    Button: ({ children, role, onClick, disabled, ...rest }) => React.createElement('button', { type: 'button', role, disabled, onClick, ...rest }, children),
    IconButton: ({ children, onClick, ...rest }) => React.createElement('button', { type: 'button', onClick, ...rest }, children),
    IconCloseOutline16: () => React.createElement('span', { 'aria-hidden': 'true' }, 'x'),
    InputField: ({ label, value, onChange, disabled, type = 'text', placeholder }) => React.createElement('label', null,
      label,
      React.createElement('input', { type, value: value ?? '', disabled, placeholder, onChange }),
    ),
    DropdownSelect: ({ id, value, options = [], onChange, disabled, ...rest }) => React.createElement('select', {
      id, value, disabled, onChange: (e) => onChange?.(e.target.value), ...rest,
    }, options.map((opt) => React.createElement('option', { key: opt.value, value: opt.value }, opt.label))),
    ConfirmModal: ({ open, title, message, cancelLabel, confirmLabel, onConfirm, onClose }) => (
      open ? React.createElement('div', { role: 'dialog', 'aria-label': title },
        message,
        React.createElement('button', { type: 'button', onClick: onClose }, cancelLabel || 'Cancel'),
        React.createElement('button', { type: 'button', onClick: onConfirm }, confirmLabel || 'Confirm'),
      ) : null
    ),
    CopyButton: () => React.createElement('button', { type: 'button' }, 'Copy'),
  }
  const primitivesStub = {
    IconSparkleMedium: () => React.createElement('span', { 'data-icon': 'sparkle' }),
  }
  const mod = { exports: {} }
  const customRequire = (id) => {
    if (extraStubs[id]) return extraStubs[id]
    if (id === 'dsh-ui-kit') return dshStub
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub
    return require(id)
  }
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(customRequire, mod, mod.exports)
  return mod.exports
}

describe('PR 2A Layer 2: omnimux UX overhaul regressions', () => {
  it('H-01: welcome greeting falls back to 创作者/Creator and escapes untrusted usernames', () => {
    assert.equal(resolveGreetingUserName({ __omnimuxAuth: null }), '创作者')
    const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', { url: 'http://127.0.0.1/' })
    const prevDocument = globalThis.document
    globalThis.document = dom.window.document
    try {
      assert.equal(resolveGreetingUserName({ __omnimuxAuth: null, document: dom.window.document }), 'Creator')
      const el = createWelcomeHeaderElement(dom.window.document, '<img src=x onerror=1>Creator')
      assert.equal(el.querySelectorAll('.omnimux-welcome-texts img').length, 0)
      assert.match(el.querySelector('.omnimux-welcome-title').textContent, /<img src=x onerror=1>Creator/)
    } finally {
      globalThis.document = prevDocument
    }
  })

  it('H-19: normalizeUserLinkInput auto-prepends https:// only at UI boundary while preserving strict validLinkUrl', () => {
    assert.equal(validLinkUrl('example.com/video'), null, 'codec boundary rejects bare domain')
    const normalized = normalizeUserLinkInput('  example.com/video?a=1  ')
    assert.equal(normalized, 'https://example.com/video?a=1')
    assert.equal(validLinkUrl(normalized), 'https://example.com/video?a=1')
    assert.equal(normalizeUserLinkInput('javascript:alert(1)'), 'javascript:alert(1)')
    assert.equal(validLinkUrl(normalizeUserLinkInput('javascript:alert(1)')), null)
    const ref = createLinkReference('video', 'https://example.com/v')
    assert.ok(!ref.label.includes('·'))
    assert.equal(ref.label, '参考视频：example.com')

    const popoverSrc = readFileSync(join(here, 'attachments/VideoLinkPopover.tsx'), 'utf8')
    assert.match(popoverSrc, /validLinkUrl\(normalizeUserLinkInput\(url\)\)/)
  })

  it('H-16: composer add suppresses pure-success toast while surfacing errors without middle dot', async () => {
    const store = createAttachmentStore()
    const notices = []
    let model1 = null
    const controller = createComposerAddController({
      store,
      t: (k) => zh[k] || k,
      getCurrentSessionId: () => 's1',
      subscribeCurrentSession: () => () => {},
      renderLibrary: (next) => { model1 = next },
      notify: (msg) => notices.push(msg),
      request: async () => ({
        ok: true,
        status: 200,
        body: { results: [{ ok: true, id: 'a1', entityId: 'a1', title: 'One', kind: 'asset', relativePath: 'assets/a1.png' }] },
      }),
    })
    await controller.openLibrary('s1')
    await model1.onConfirm([{ id: 'a1' }])
    assert.deepEqual(notices, [], 'clean single add updates composer tray directly without toast')

    let model2 = null
    const mixedController = createComposerAddController({
      store: createAttachmentStore(),
      t: (k) => zh[k] || k,
      getCurrentSessionId: () => 's2',
      subscribeCurrentSession: () => () => {},
      renderLibrary: (next) => { model2 = next },
      notify: (msg) => notices.push(msg),
      request: async () => ({
        ok: true,
        status: 200,
        body: {
          results: [
            { ok: true, id: 'a2', entityId: 'a2', title: 'Two', kind: 'asset', relativePath: 'assets/a2.png' },
            { ok: false, id: 'bad', message: 'failed' },
          ],
        },
      }),
    })
    await mixedController.openLibrary('s2')
    await model2.onConfirm([{ id: 'a2' }, { id: 'bad' }])
    assert.equal(notices.length, 1)
    assert.ok(!notices[0].includes('·'))
  })

  it('H-11: ScenarioSelection omits single-option scenarios and separates provider/model with slash', async () => {
    const { ScenarioSelection } = await loadJsxModule('ScenarioSelection.jsx')
    const singleHtml = renderToStaticMarkup(React.createElement(ScenarioSelection, {
      t: (k) => zh[k] || k,
      scope: { getSnapshot: () => ({ value: {} }) },
      value: { byokProviders: [] },
      busy: false,
      setBusy: () => {},
      setError: () => {},
    }))
    assert.equal(singleHtml, '')

    const multiHtml = renderToStaticMarkup(React.createElement(ScenarioSelection, {
      t: (k) => zh[k] || k,
      scope: { getSnapshot: () => ({ value: {} }) },
      value: {
        byokProviders: [
          { provider: 'openai', capabilities: ['text'], models: { text: 'gpt-5' }, saveState: 'saved' },
        ],
      },
      busy: false,
      setBusy: () => {},
      setError: () => {},
    }))
    assert.match(multiHtml, /openai \/ gpt-5/)
    assert.ok(!multiHtml.includes('·'))
  })

  it('H-13: ReferenceStorageSection hides credential inputs and Save CTA until enabled', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1/' })
    const prevWin = globalThis.window
    const prevDoc = globalThis.document
    globalThis.window = dom.window
    globalThis.document = dom.window.document
    let root
    try {
      const { ReferenceStorageSection } = await loadJsxModule('ReferenceStorageSection.jsx', {
        './reference-storage-api.js': {
          readStorageSettings: async () => ({
            config: { enabled: false, endpoint: '', bucket: '', region: 'auto', publicBaseUrl: '' },
            revision: 1,
            hasCredentials: false,
            credentialsWritable: true,
          }),
          saveStorageSettings: async (v) => ({ config: v, revision: 2, hasCredentials: true, credentialsWritable: true }),
        },
      })
      const container = dom.window.document.getElementById('root')
      root = createRoot(container)
      await act(async () => {
        root.render(React.createElement(ReferenceStorageSection, { t: (k) => zh[k] || k }))
      })
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10))
      })
      assert.equal(container.querySelectorAll('input').length, 0, 'disabled S3 hides empty credential fields')
      assert.equal(
        [...container.querySelectorAll('button')].filter((b) => b.textContent === zh['referenceStorage.save']).length,
        0,
        'disabled clean S3 hides Save button',
      )

      const toggleBtn = container.querySelector('[role="switch"]')
      await act(async () => {
        toggleBtn.click()
      })
      assert.ok(container.querySelectorAll('input').length > 0, 'enabling S3 reveals configuration fields')
      assert.equal(
        [...container.querySelectorAll('button')].filter((b) => b.textContent === zh['referenceStorage.save']).length,
        1,
      )
    } finally {
      if (root) await act(async () => { root.unmount() })
      globalThis.window = prevWin
      globalThis.document = prevDoc
    }
  })

  it('H-15: ClipContextChip omits revision/project IDs and middle dot separators', async () => {
    const { ClipContextChip } = await loadJsxModule('attachments/ClipContextChip.jsx')
    let cachedSnapshot = { anchor: null, clip: null }
    const listeners = new Set()
    const clipPayload = {
      mode: 'studio',
      title: 'Demo Cut',
      revision: 42,
      projectId: 'proj_secret_99',
      playheadSec: 1.5,
      durationSec: 10,
      selectedClips: [{ id: 'clip-1', name: 'Intro', startSec: 0, endSec: 2.5 }],
    }
    const bridge = {
      register: (node) => {
        cachedSnapshot = { anchor: node, clip: clipPayload }
        for (const cb of listeners) cb()
        return () => {}
      },
      subscribe: (cb) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
      getSnapshot: () => cachedSnapshot,
      dismiss: () => {},
    }
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1/' })
    const prevWin = globalThis.window
    const prevDoc = globalThis.document
    globalThis.window = dom.window
    globalThis.document = dom.window.document
    let root
    try {
      const container = dom.window.document.getElementById('root')
      root = createRoot(container)
      await act(async () => {
        root.render(React.createElement(ClipContextChip, { bridge, sessionId: 's1', t: (k) => zh[k] || k }))
      })
      const text = container.textContent || ''
      assert.match(text, /Demo Cut/)
      assert.ok(!text.includes('·'))
      assert.ok(!text.includes('r42'))
      assert.ok(!text.includes('proj_secret_99'))
    } finally {
      if (root) await act(async () => { root.unmount() })
      globalThis.window = prevWin
      globalThis.document = prevDoc
    }
  })

  it('H-05/H-06/H-08/H-09: destructive confirmations, modal reset & copy contracts hold', () => {
    assert.ok(zh['profile.confirmLogout'] && en['profile.confirmLogout'])
    assert.ok(zh['runtime.confirmDisconnect'] && en['runtime.confirmDisconnect'])
    for (const [k, v] of Object.entries(zh)) {
      if (k.startsWith('auth.gate.')) assert.ok(!String(v).includes('·'), k)
    }

    const runtimeSrc = readFileSync(join(here, 'RuntimeModeSection.jsx'), 'utf8')
    const profileSrc = readFileSync(join(here, 'ProfileSection.jsx'), 'utf8')
    assert.match(runtimeSrc, /confirmDisconnectTarget/)
    assert.match(runtimeSrc, /confirmVariant="danger"/)
    assert.match(profileSrc, /confirmLogoutOpen/)
    assert.match(profileSrc, /confirmVariant="danger"/)

    const pickerSrc = readFileSync(join(here, 'components/product-picker/ProductPicker.jsx'), 'utf8')
    assert.match(pickerSrc, /if \(!open\)[\s\S]*setSelectedProduct\(null\)[\s\S]*setSearchQuery\(''\)/)
    assert.ok(!/if\s*\(\s*e\.key\s*===\s*'Enter'[\s\S]{0,160}custom-/.test(pickerSrc), 'Enter key must never create synthetic custom-* product')

    const presetsSrc = readFileSync(join(here, 'presets/CreativePresetsModal.jsx'), 'utf8')
    assert.match(presetsSrc, /if \(!isOpen\)\s*\{\s*setSearchQuery\(''\)\s*setSelectedSubCategory\('all'\)/)
    assert.match(presetsSrc, /黄金钩子/)
    assert.ok(!presetsSrc.includes('黄金亮点 / Hook'))
    assert.ok(!presetsSrc.includes('全部 ({currentList.length})'))
  })
})
