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
import { createWelcomeHeaderElement, resolveGreetingUserName, syncWelcomeGreeting } from './welcome-greeting.js'

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

      // Verify existing split-mode header updates in English instead of mixing 你好 into EN UI
      const heroShell = dom.window.document.createElement('div')
      heroShell.innerHTML = '<div data-phase="hero"><div class="composerHero"><div></div></div></div>'
      const splitPanel = dom.window.document.createElement('aside')
      splitPanel.setAttribute('data-sidebar-right-open', '')
      splitPanel.setAttribute('data-sidebar-right-panel', 'split')
      dom.window.document.body.append(heroShell, splitPanel)
      const targetShell = heroShell.querySelector('.composerHero > :first-child')
      const existing = createWelcomeHeaderElement(dom.window.document, 'Alice')
      targetShell.append(existing)
      syncWelcomeGreeting(dom.window.document)
      assert.equal(existing.querySelector('.omnimux-welcome-title').textContent, 'Hi, Creator')
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

    const bridgeSrc = readFileSync(join(here, 'composer-add/AttachmentSubmitBridge.jsx'), 'utf8')
    assert.match(bridgeSrc, /blockedPointerRef\.current = false\s+const before = armedCountRef\.current\s+btn\.click\(\)\s+return armedCountRef\.current > before/)
    assert.match(profileSrc, /phase !== 'saved'/)
    const catalogSrc = readFileSync(join(here, 'session-guide/catalog.js'), 'utf8')
    assert.ok(!catalogSrc.includes('BGGG Amazon Data · Review Scraper'))

    const presetsSrc = readFileSync(join(here, 'presets/CreativePresetsModal.jsx'), 'utf8')
    assert.match(presetsSrc, /if \(!isOpen\)\s*\{\s*setSearchQuery\(''\)\s*setSelectedSubCategory\('all'\)/)
    assert.match(presetsSrc, /黄金钩子/)
    assert.ok(!presetsSrc.includes('黄金亮点 / Hook'))
    assert.ok(!presetsSrc.includes('全部 ({currentList.length})'))
  })

  it('H-02: AttachmentSubmitBridge auto-resumes after pointerdown interception without swallowing the synthetic send click', async () => {
    const out = await build({
      stdin: { contents: `export { AttachmentSubmitBridge } from './AttachmentSubmitBridge.jsx';`, resolveDir: join(here, 'composer-add'), loader: 'js' },
      bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'],
    })
    const mod = { exports: {} }
    new Function('require', 'module', 'exports', out.outputFiles[0].text)(require, mod, mod.exports)
    const { AttachmentSubmitBridge } = mod.exports

    const dom = new JSDOM('<div data-phase="hero"><div data-composer-card><div id="bridge"></div><div data-composer-input="true"></div><button data-send-button>Send</button></div></div>', { url: 'http://127.0.0.1/' })
    const saved = { window: globalThis.window, document: globalThis.document, CustomEvent: globalThis.CustomEvent, Event: globalThis.Event, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT }
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true })
    let snapshot = { draft: 'hi', draftRev: 1, phase: 'plain', occurrences: [] }
    const insertions = []
    const arms = []
    let sends = 0
    const attachmentStore = { getSnapshot: () => [] }
    const attachmentAdmission = { arm: (...args) => arms.push(args) }
    const getCurrentSessionId = () => 'stable-sid'
    const inputActions = { setDraft: () => {} }
    const insertText = (text, span) => { insertions.push({ text, span }); return true }
    const root = createRoot(dom.window.document.getElementById('bridge'))
    try {
      const chip = dom.window.document.createElement('span')
      chip.setAttribute('data-omx-product-token', 'true')
      const inp = dom.window.document.createElement('input')
      inp.value = 'prod_9'
      chip.appendChild(inp)
      dom.window.document.querySelector('[data-composer-input]').appendChild(chip)

      const sendBtn = dom.window.document.querySelector('[data-send-button]')
      sendBtn.addEventListener('click', () => { sends += 1 })
      const render = () => act(async () => root.render(React.createElement(AttachmentSubmitBridge, {
        sessionId: 'stable-sid',
        useInput: (sel) => sel(snapshot),
        t: (k) => k,
        inputActions,
        insertText,
        attachmentStore,
        attachmentAdmission,
        getCurrentSessionId,
      })))
      await render()
      await act(async () => {
        sendBtn.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true, cancelable: true }))
      })
      assert.equal(insertions.length, 1)
      assert.equal(sends, 0)

      snapshot = { draft: snapshot.draft + insertions[0].text, draftRev: 2, phase: 'plain', occurrences: [] }
      await render()
      assert.equal(sends, 1, 'confirmed draft after pointerdown must auto-resume synthetic send')
      assert.equal(arms.length, 1)
      assert.equal(dom.window.document.querySelector('[role="status"]'), null)
    } finally {
      await act(async () => root.unmount())
      dom.window.close()
      Object.assign(globalThis, saved)
    }
  })

  it('Drawer + ConfirmModal JSDOM: simultaneous mount never steals focus or lets Escape close outer Drawer during loading or alertdialog', async () => {
    const out = await build({
      stdin: {
        contents: `export { Drawer } from './drawer/Drawer.tsx'; export { ConfirmModal } from './dialog/Dialog.tsx';`,
        resolveDir: join(repo, 'packages/dsh-ui-kit/src'),
        loader: 'ts',
      },
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'node',
      jsx: 'automatic',
      nodePaths: [resolve(repo, 'packages/dsh-ui-kit/node_modules'), resolve(repo, '../node_modules')],
      external: ['react', 'react-dom'],
      plugins: [{
        name: 'css-module-stub',
        setup(b) {
          b.onLoad({ filter: /\.css$/ }, () => ({ contents: 'export default new Proxy({}, { get: (_, k) => String(k) })', loader: 'js' }))
        },
      }],
    })
    const kitMod = { exports: {} }
    new Function('require', 'module', 'exports', out.outputFiles[0].text)((id) => {
      if (id === 'react') return React
      if (id === 'react-dom') return require('react-dom')
      return require(id)
    }, kitMod, kitMod.exports)
    const { Drawer, ConfirmModal } = kitMod.exports

    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1/' })
    const saved = {
      window: globalThis.window,
      document: globalThis.document,
      HTMLElement: globalThis.HTMLElement,
      Element: globalThis.Element,
      Node: globalThis.Node,
      KeyboardEvent: globalThis.KeyboardEvent,
      requestAnimationFrame: globalThis.requestAnimationFrame,
      cancelAnimationFrame: globalThis.cancelAnimationFrame,
      matchMedia: globalThis.matchMedia,
      IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
    }
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, KeyboardEvent: dom.window.KeyboardEvent, IS_REACT_ACT_ENVIRONMENT: true })
    const root = createRoot(dom.window.document.getElementById('root'))
    let drawerCloses = 0
    let confirmCloses = 0
    try {
      // Mount external alertdialog BEFORE Drawer in DOM order + simultaneous loading ConfirmModal inside Drawer
      const preAlert = dom.window.document.createElement('div')
      preAlert.setAttribute('role', 'alertdialog')
      preAlert.setAttribute('aria-modal', 'true')
      const alertBtn = dom.window.document.createElement('button')
      alertBtn.textContent = 'Alert Action'
      preAlert.appendChild(alertBtn)
      dom.window.document.body.prepend(preAlert)

      await act(async () => {
        root.render(React.createElement(Drawer, {
          open: true,
          title: 'Details',
          onClose: () => { drawerCloses += 1 },
        },
          React.createElement('button', { type: 'button', id: 'drawer-inner-btn' }, 'Inner'),
          React.createElement(ConfirmModal, {
            open: true,
            title: 'Confirm Delete',
            message: 'Sure?',
            confirmVariant: 'danger',
            confirmLoading: true,
            onConfirm: () => {},
            onClose: () => { confirmCloses += 1 },
          }),
        ))
      })
      // Let Drawer's 16ms startup timer fire
      await new Promise((r) => setTimeout(r, 35))

      // Drawer startup timer must NOT steal focus away into #drawer-inner-btn while modal/alertdialog exists
      assert.notEqual(dom.window.document.activeElement?.id, 'drawer-inner-btn')

      // Escape inside pre-DOM-order alertdialog must NOT close Drawer
      alertBtn.focus()
      await act(async () => {
        alertBtn.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      })
      assert.equal(drawerCloses, 0)

      // Escape inside portaled loading ConfirmModal must NOT close Drawer OR ConfirmModal
      const modalBtns = dom.window.document.querySelectorAll('[role="dialog"][aria-modal="true"] button')
      const targetInConfirm = modalBtns[modalBtns.length - 1]
      targetInConfirm.focus()
      await act(async () => {
        targetInConfirm.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      })
      assert.equal(drawerCloses, 0)
      assert.equal(confirmCloses, 0)

      // Remove alertdialog and close ConfirmModal -> Escape now closes Drawer cleanly
      preAlert.remove()
      await act(async () => {
        root.render(React.createElement(Drawer, {
          open: true,
          title: 'Details',
          onClose: () => { drawerCloses += 1 },
        }, React.createElement('button', { type: 'button', id: 'drawer-inner-btn' }, 'Inner')))
      })
      const innerBtn = dom.window.document.getElementById('drawer-inner-btn')
      innerBtn.focus()
      await act(async () => {
        innerBtn.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      })
      assert.equal(drawerCloses, 1)
    } finally {
      await act(async () => root.unmount())
      dom.window.close()
      Object.assign(globalThis, saved)
    }
  })

  it('Drawer stacked JSDOM: false->true upper Drawer takes focus/Escape and closing upper restores lower Drawer trigger focus', async () => {
    const out = await build({
      stdin: {
        contents: `export { Drawer } from './drawer/Drawer.tsx';`,
        resolveDir: join(repo, 'packages/dsh-ui-kit/src'),
        loader: 'ts',
      },
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'node',
      jsx: 'automatic',
      nodePaths: [resolve(repo, 'packages/dsh-ui-kit/node_modules'), resolve(repo, '../node_modules')],
      external: ['react', 'react-dom'],
      plugins: [{
        name: 'css-module-stub',
        setup(b) {
          b.onLoad({ filter: /\.css$/ }, () => ({ contents: 'export default new Proxy({}, { get: (_, k) => String(k) })', loader: 'js' }))
        },
      }],
    })
    const kitMod = { exports: {} }
    new Function('require', 'module', 'exports', out.outputFiles[0].text)((id) => {
      if (id === 'react') return React
      if (id === 'react-dom') return require('react-dom')
      return require(id)
    }, kitMod, kitMod.exports)
    const { Drawer } = kitMod.exports

    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1/' })
    const saved = {
      window: globalThis.window,
      document: globalThis.document,
      HTMLElement: globalThis.HTMLElement,
      Element: globalThis.Element,
      Node: globalThis.Node,
      KeyboardEvent: globalThis.KeyboardEvent,
      requestAnimationFrame: globalThis.requestAnimationFrame,
      cancelAnimationFrame: globalThis.cancelAnimationFrame,
      matchMedia: globalThis.matchMedia,
      IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
    }
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, KeyboardEvent: dom.window.KeyboardEvent, IS_REACT_ACT_ENVIRONMENT: true })
    const root = createRoot(dom.window.document.getElementById('root'))
    let lowerCloses = 0
    let upperCloses = 0
    const renderBoth = (upperOpen, triggerId) => act(async () => {
      root.render(React.createElement(React.Fragment, null,
        React.createElement(Drawer, {
          open: true,
          title: 'Lower',
          closable: false,
          onClose: () => { lowerCloses += 1 },
        }, React.createElement('button', { type: 'button', id: triggerId }, 'Lower Trigger')),
        React.createElement(Drawer, {
          open: upperOpen,
          title: 'Upper',
          closable: false,
          onClose: () => { upperCloses += 1 },
        }, React.createElement('button', { type: 'button', id: 'upper-btn' }, 'Upper Action')),
      ))
    })
    try {
      // Flow A: upper Drawer transitions false -> true over already-open lower Drawer
      await renderBoth(false, 'lower-trigger')
      await new Promise((r) => setTimeout(r, 35))
      const lowerTrigger = dom.window.document.getElementById('lower-trigger')
      lowerTrigger.focus()
      assert.equal(dom.window.document.activeElement?.id, 'lower-trigger')

      await renderBoth(true, 'lower-trigger')
      // Even before 16ms startup focus timer runs (focus still on #lower-trigger), 1st Escape closes ONLY upper Drawer
      await act(async () => {
        lowerTrigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      })
      assert.equal(upperCloses, 1, 'Escape while focus still inside lower Drawer must target upper Drawer')
      assert.equal(lowerCloses, 0)

      await new Promise((r) => setTimeout(r, 35))
      const upperDialog = [...dom.window.document.querySelectorAll('[role="dialog"]')].find((d) => d.textContent?.includes('Upper Action'))
      assert.ok(upperDialog && upperDialog.contains(dom.window.document.activeElement), 'upper Drawer transition false->true must take focus')

      // Escape inside upper Drawer closes ONLY upper Drawer
      await act(async () => {
        dom.window.document.getElementById('upper-btn').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      })
      assert.equal(upperCloses, 2)
      assert.equal(lowerCloses, 0)

      // Closing upper restores lower trigger focus, and 2nd Escape closes lower Drawer
      await renderBoth(false, 'lower-trigger')
      assert.equal(dom.window.document.activeElement?.id, 'lower-trigger', 'closing transitioned upper Drawer restores lower trigger focus')
      await act(async () => {
        dom.window.document.getElementById('lower-trigger').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      })
      assert.equal(lowerCloses, 1)

      // Flow B: remount clean stack where lower Drawer is open with #lower-trigger-2 focused and upper mounts already open={true}
      await act(async () => root.render(null))
      await act(async () => {
        root.render(React.createElement(Drawer, {
          open: true,
          title: 'Lower2',
          closable: false,
          onClose: () => { lowerCloses += 1 },
        }, React.createElement('button', { type: 'button', id: 'lower-trigger-2' }, 'Lower Trigger 2')))
      })
      await new Promise((r) => setTimeout(r, 35))
      const lowerTrigger2 = dom.window.document.getElementById('lower-trigger-2')
      lowerTrigger2.focus()
      assert.equal(dom.window.document.activeElement?.id, 'lower-trigger-2')

      await renderBoth(true, 'lower-trigger-2')
      await new Promise((r) => setTimeout(r, 35))
      const upperDialogB = [...dom.window.document.querySelectorAll('[role="dialog"]')].find((d) => d.textContent?.includes('Upper Action'))
      assert.ok(upperDialogB && upperDialogB.contains(dom.window.document.activeElement), 'upper Drawer mounted open=true must take focus')

      await renderBoth(false, 'lower-trigger-2')
      assert.equal(dom.window.document.activeElement?.id, 'lower-trigger-2', 'closing upper Drawer mounted over lower Drawer must restore #lower-trigger-2 focus')

      // Flow C: exiting upper Drawer when trigger was detached + container swap while open + exiting external dialog startup focus
      await act(async () => root.render(null))
      const containerA = dom.window.document.createElement('div')
      const containerB = dom.window.document.createElement('div')
      dom.window.document.body.append(containerA, containerB)

      // Enable rAF & matchMedia so usePresence retains upper Drawer in data-phase="exiting" on close
      const fakeRaf = (cb) => setTimeout(() => cb(Date.now()), 0)
      const fakeCancelRaf = (id) => clearTimeout(id)
      const fakeMatchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
      dom.window.requestAnimationFrame = fakeRaf
      dom.window.cancelAnimationFrame = fakeCancelRaf
      dom.window.matchMedia = fakeMatchMedia
      globalThis.requestAnimationFrame = fakeRaf
      globalThis.cancelAnimationFrame = fakeCancelRaf
      globalThis.matchMedia = fakeMatchMedia

      let flowCLowerCloses = 0
      let flowCUpperCloses = 0
      const renderFlowC = (showTrigger, upperOpen, upperContainer) => act(async () => {
        root.render(React.createElement(React.Fragment, null,
          React.createElement(Drawer, {
            open: true,
            title: 'LowerC',
            closable: false,
            onClose: () => { flowCLowerCloses += 1 },
          },
            React.createElement('button', { type: 'button', id: 'lower-c-btn' }, 'Lower C Action'),
            showTrigger ? React.createElement('button', { type: 'button', id: 'ephemeral-trigger' }, 'Ephemeral') : null,
          ),
          React.createElement(Drawer, {
            open: upperOpen,
            title: 'UpperC',
            closable: false,
            container: upperContainer,
            onClose: () => { flowCUpperCloses += 1 },
          }, React.createElement('button', { type: 'button', id: 'upper-c-btn' }, 'Upper C Action')),
        ))
      })

      await renderFlowC(true, false, containerA)
      await act(async () => new Promise((r) => setTimeout(r, 35)))
      dom.window.document.getElementById('ephemeral-trigger').focus()
      await renderFlowC(true, true, containerA)
      await act(async () => new Promise((r) => setTimeout(r, 35)))
      assert.ok(containerA.contains(dom.window.document.activeElement), 'upper Drawer starts in containerA')

      // Change container while upper Drawer remains open
      await renderFlowC(true, true, containerB)
      await act(async () => new Promise((r) => setTimeout(r, 35)))
      assert.ok(containerB.contains(dom.window.document.activeElement), 'moving open Drawer to containerB re-registers and focuses new node')
      await act(async () => {
        dom.window.document.getElementById('upper-c-btn').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      })
      assert.equal(flowCUpperCloses, 1, 'Escape must still close upper Drawer after container change')
      assert.equal(flowCLowerCloses, 0)

      // Detach trigger before closing upper Drawer while exit animation keeps exiting DOM alive
      await renderFlowC(false, false, containerB)
      assert.ok(containerB.querySelector('[data-phase="exiting"]'), 'exiting upper Drawer DOM stays mounted during 190ms exit')
      // Even if an exiting overlay node receives Escape directly, LowerC still closes immediately
      const exitingUpperBtn = containerB.querySelector('#upper-c-btn')
      await act(async () => {
        exitingUpperBtn.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      })
      assert.equal(flowCLowerCloses, 1, '2nd Escape during upper exit animation with detached trigger must close lower Drawer')
      // Also activeElement was safely moved back to LowerC instead of remaining in exiting aria-hidden DOM
      await act(async () => {
        dom.window.document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      })
      assert.equal(flowCLowerCloses, 2, 'activeElement after detached-trigger exit also closes LowerC on Escape')

      // Startup focus guard ignores an exiting external dialog holding activeElement
      await act(async () => root.render(null))
      const exitingExt = dom.window.document.createElement('div')
      exitingExt.setAttribute('role', 'dialog')
      exitingExt.setAttribute('aria-modal', 'true')
      exitingExt.setAttribute('data-phase', 'exiting')
      const exitingBtn = dom.window.document.createElement('button')
      exitingBtn.id = 'exiting-ext-btn'
      exitingBtn.textContent = 'Exiting'
      exitingExt.appendChild(exitingBtn)
      dom.window.document.body.appendChild(exitingExt)
      exitingBtn.focus()
      let soloCloses = 0
      await act(async () => {
        root.render(React.createElement(Drawer, {
          open: true,
          title: 'Solo',
          closable: false,
          onClose: () => { soloCloses += 1 },
        }, React.createElement('button', { type: 'button', id: 'solo-btn' }, 'Solo Action')))
      })
      await act(async () => new Promise((r) => setTimeout(r, 35)))
      const soloDialog = [...dom.window.document.querySelectorAll('[role="dialog"]')].find((d) => d.textContent?.includes('Solo Action'))
      assert.ok(soloDialog && soloDialog.contains(dom.window.document.activeElement), 'Drawer startup focus must not be stranded in an exiting external dialog')
      assert.equal(soloCloses, 0)

      // Flow D: moving lower Drawer container preserves stack order, and stable getter container switching target works cleanly
      await act(async () => root.render(null))
      exitingExt.remove()
      const lowerC1 = dom.window.document.createElement('div')
      const lowerC2 = dom.window.document.createElement('div')
      const upperHost = dom.window.document.createElement('div')
      const getterHost1 = dom.window.document.createElement('div')
      const getterHost2 = dom.window.document.createElement('div')
      dom.window.document.body.append(lowerC1, lowerC2, upperHost, getterHost1, getterHost2)

      let activeGetterTarget = getterHost1
      const getStableContainer = () => activeGetterTarget
      let dLowerCloses = 0
      let dUpperCloses = 0
      let getterCloses = 0

      const renderFlowD = (lowerHost, upperOpen) => act(async () => {
        root.render(React.createElement(React.Fragment, null,
          React.createElement(Drawer, {
            open: true,
            title: 'LowerD',
            closable: false,
            container: lowerHost,
            onClose: () => { dLowerCloses += 1 },
          }, React.createElement('button', { type: 'button', id: 'lower-d-btn' }, 'Lower D')),
          React.createElement(Drawer, {
            open: upperOpen,
            title: 'UpperD',
            closable: false,
            container: upperHost,
            onClose: () => { dUpperCloses += 1 },
          }, React.createElement('button', { type: 'button', id: 'upper-d-btn' }, 'Upper D')),
        ))
      })

      await renderFlowD(lowerC1, true)
      await act(async () => new Promise((r) => setTimeout(r, 35)))
      assert.ok(upperHost.contains(dom.window.document.activeElement), 'UpperD starts on top')

      // Move LOWER Drawer container while UpperD is on top -> UpperD must retain focus and 1st Escape
      await renderFlowD(lowerC2, true)
      await act(async () => new Promise((r) => setTimeout(r, 35)))
      assert.ok(upperHost.contains(dom.window.document.activeElement), 'moving lower Drawer container must NOT steal focus from UpperD')
      await act(async () => {
        dom.window.document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      })
      assert.equal(dUpperCloses, 1, '1st Escape after lower Drawer container move must close UpperD only')
      assert.equal(dLowerCloses, 0)

      // Close UpperD -> 2nd Escape closes moved LowerD inside lowerC2
      await renderFlowD(lowerC2, false)
      await act(async () => new Promise((r) => setTimeout(r, 35)))
      await act(async () => {
        dom.window.document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      })
      assert.equal(dLowerCloses, 1, '2nd Escape must close LowerD in its new container')

      // Stable getter container function switching return element mid-open
      await act(async () => root.render(null))
      const renderGetterDrawer = (tick) => act(async () => {
        root.render(React.createElement(Drawer, {
          open: true,
          title: `Getter-${tick}`,
          closable: false,
          container: getStableContainer,
          onClose: () => { getterCloses += 1 },
        }, React.createElement('button', { type: 'button', id: 'getter-btn' }, 'Getter Action')))
      })
      await renderGetterDrawer(1)
      await act(async () => new Promise((r) => setTimeout(r, 35)))
      assert.ok(getterHost1.contains(dom.window.document.activeElement), 'getter Drawer mounts & focuses in getterHost1')

      activeGetterTarget = getterHost2
      await renderGetterDrawer(2)
      await act(async () => new Promise((r) => setTimeout(r, 35)))
      assert.ok(getterHost2.contains(dom.window.document.activeElement), 'stable getter container switching target moves focus to getterHost2')
      await act(async () => {
        dom.window.document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      })
      assert.equal(getterCloses, 1, 'Escape closes getter Drawer after target element switch')

      // Shared container ref-counted scroll lock: two Drawers on hostA (overflow: auto); lower moves to hostB, upper closes
      await act(async () => root.render(null))
      const sharedHostA = dom.window.document.createElement('div')
      const sharedHostB = dom.window.document.createElement('div')
      sharedHostA.style.overflow = 'auto'
      sharedHostB.style.overflow = 'scroll'
      dom.window.document.body.append(sharedHostA, sharedHostB)
      let lockLowerTarget = sharedHostA
      const getLockLowerContainer = () => lockLowerTarget
      const renderSharedLock = (lowerOpen, upperOpen) => act(async () => {
        root.render(React.createElement(React.Fragment, null,
          React.createElement(Drawer, {
            open: lowerOpen,
            title: 'LockLower',
            closable: false,
            container: getLockLowerContainer,
            onClose: () => {},
          }, React.createElement('button', { type: 'button' }, 'LL')),
          React.createElement(Drawer, {
            open: upperOpen,
            title: 'LockUpper',
            closable: false,
            container: sharedHostA,
            onClose: () => {},
          }, React.createElement('button', { type: 'button' }, 'LU')),
        ))
      })
      await renderSharedLock(true, true)
      assert.equal(sharedHostA.style.overflow, 'hidden')

      // Lower moves off sharedHostA -> sharedHostB while LockUpper remains open on sharedHostA
      lockLowerTarget = sharedHostB
      await renderSharedLock(true, true)
      assert.equal(sharedHostA.style.overflow, 'hidden', 'sharedHostA stays locked while LockUpper remains open')
      assert.equal(sharedHostB.style.overflow, 'hidden', 'sharedHostB locks when LockLower moves there')

      // Close LockUpper -> sharedHostA restores original 'auto' (not 'hidden')
      await renderSharedLock(true, false)
      assert.equal(sharedHostA.style.overflow, 'auto', 'closing last Drawer on sharedHostA restores original overflow')
      assert.equal(sharedHostB.style.overflow, 'hidden')

      // Close LockLower -> sharedHostB restores original 'scroll'
      await renderSharedLock(false, false)
      assert.equal(sharedHostB.style.overflow, 'scroll', 'closing moved LockLower restores sharedHostB original overflow')
    } finally {
      await act(async () => root.unmount())
      dom.window.close()
      Object.assign(globalThis, saved)
    }
  })
})
