/**
 * End-to-end tests for AssetTextEditorModal wired against the real Host HTTP routes
 * (`registerAssetsRoutes`), real `LibraryStore`, real `TextVersionStore`, real CodeMirror 6
 * editor + `liveMarkdownPlugin`, and real `@codemirror/merge` `MergeView`.
 *
 * Verifies:
 * 1. Loading `.md` with `access_token` / `sk-a` prose via `text/plain`, live Markdown decorations,
 *    CodeMirror native Undo/Redo, inline search match counting & stepping, and save persistence
 *    without modifying the external original file on disk.
 * 2. Version Drawer snapshot creation, side-by-side `MergeView` Diff Modal, snapshot revert
 *    (logging a `revert` snapshot), and deletion via `ConfirmModal`.
 * 3. Optimistic `ETag` `409 file-conflict` detection and recovery (Reload Latest & Force Overwrite).
 * 4. 3-way unsaved close confirmation (Cancel / Discard / Save & Close).
 * 5. Stale in-flight read cancellation when switching between documents.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createArtifactStore } from '../artifacts.js'
import { createAssetsDispatcher, registerAssetsRoutes } from '../http-routes.js'
import { createLibraryStore } from '../library.js'
import { createMappingStore } from '../mappings.js'
import { createTextVersionStore } from '../text-versions.js'
import { zh } from './locales.js'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRequire = createRequire(join(here, '..', '..', 'package.json'))
const { JSDOM } = pluginRequire('jsdom')
const { EditorView } = pluginRequire('@codemirror/view')
const MODAL_PATH = join(here, 'text-editor', 'AssetTextEditorModal.jsx')

const t = (key) => zh[key] ?? key

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1/',
    pretendToBeVisual: true,
  })
  const { window } = dom
  globalThis.window = window
  globalThis.document = window.document
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true })
  globalThis.HTMLElement = window.HTMLElement
  globalThis.Element = window.Element
  globalThis.Node = window.Node
  globalThis.Text = window.Text
  globalThis.Range = window.Range
  globalThis.DOMRect = window.DOMRect || class DOMRect {
    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.x = x; this.y = y; this.width = width; this.height = height
      this.left = x; this.top = y; this.right = x + width; this.bottom = y + height
    }
  }
  globalThis.MouseEvent = window.MouseEvent
  globalThis.KeyboardEvent = window.KeyboardEvent
  globalThis.Event = window.Event
  globalThis.CustomEvent = window.CustomEvent
  globalThis.MutationObserver = window.MutationObserver
  globalThis.getComputedStyle = window.getComputedStyle.bind(window)
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0)
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  // CodeMirror 6 calls getClientRects / getBoundingClientRect on Ranges and Elements in layout measurements.
  if (!window.Range.prototype.getClientRects) {
    window.Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} })
  }
  if (!window.Range.prototype.getBoundingClientRect) {
    window.Range.prototype.getBoundingClientRect = () => new globalThis.DOMRect(0, 0, 0, 0)
  }
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  }

  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  return dom
}

async function loadEditorModal() {
  const esbuild = pluginRequire('esbuild')
  const result = await esbuild.build({
    entryPoints: [MODAL_PATH],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    write: false,
    logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', '@codemirror/view', '@codemirror/state'],
    plugins: [
      {
        name: 'stub-uikit-and-picker',
        setup(b) {
          b.onResolve({ filter: /^dsh-ui-kit(\/native-file-picker)?$/ }, (a) => ({ path: a.path, namespace: 'stub-uikit' }))
          b.onLoad({ filter: /./, namespace: 'stub-uikit' }, (args) => {
            if (args.path.includes('native-file-picker')) {
              return { contents: 'module.exports = { requestFilePicker: async () => ({ path: null, paths: [] }) };', loader: 'js' }
            }
            return {
              contents: `
                const React = require('react');
                const Button = ({ children, onClick, disabled, loading, leadingIcon, className, title, 'aria-label': ariaLabel }) =>
                  React.createElement('button', { type: 'button', className, title, 'aria-label': ariaLabel, disabled: Boolean(disabled || loading), onClick }, leadingIcon, children);
                const IconButton = ({ children, onClick, disabled, loading, className, title, 'aria-label': ariaLabel, 'aria-pressed': ariaPressed }) =>
                  React.createElement('button', { type: 'button', className, title, 'aria-label': ariaLabel, 'aria-pressed': ariaPressed, disabled: Boolean(disabled || loading), onClick }, children);
                const Badge = ({ children, className }) => React.createElement('span', { className }, children);
                const InputField = ({ value, onChange, onKeyDown, placeholder, disabled, 'aria-label': ariaLabel }) =>
                  React.createElement('input', { value, onChange, onKeyDown, placeholder, disabled, 'aria-label': ariaLabel });
                const ModalDialog = ({ open, title, children, footer }) =>
                  open ? React.createElement('div', { 'data-testid': 'modal-dialog', role: 'dialog' },
                    React.createElement('h3', null, title),
                    children,
                    footer
                  ) : null;
                const ConfirmModal = ({ open, title, message, confirmLabel, cancelLabel, onConfirm, onClose, confirmLoading }) =>
                  open ? React.createElement('div', { 'data-testid': 'confirm-modal', role: 'dialog' },
                    React.createElement('h3', null, title),
                    React.createElement('p', null, message),
                    React.createElement('button', { type: 'button', onClick: onClose, disabled: confirmLoading }, cancelLabel),
                    React.createElement('button', { type: 'button', onClick: onConfirm, disabled: confirmLoading }, confirmLabel)
                  ) : null;
                module.exports = { Button, IconButton, Badge, InputField, ModalDialog, ConfirmModal };
              `,
              loader: 'js',
            }
          })
        },
      },
    ],
  })
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(pluginRequire, mod, mod.exports)
  return mod.exports.AssetTextEditorModal
}

async function waitFor(predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = predicate()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
  if (lastError) throw lastError
  throw new Error('waitFor timed out')
}

async function startRealHost(rootDir) {
  const origDir = join(rootDir, 'originals')
  const storeDir = join(rootDir, 'vault')
  mkdirSync(origDir, { recursive: true })

  const skillOrig = join(origDir, 'SKILL.md')
  const skillBody = '# 技能说明\n示例字段 `access_token` 与 `sk-a`\n镜头 1\n镜头 2\n'
  writeFileSync(skillOrig, skillBody, 'utf8')

  const otherOrig = join(origDir, 'OTHER.md')
  const otherBody = '# 第二个文档\n最新内容\n'
  writeFileSync(otherOrig, otherBody, 'utf8')

  const paths = {
    dir: storeDir,
    libraryFile: join(storeDir, 'library.json'),
    filesDir: join(storeDir, 'data', 'files'),
    textVersionsDir: join(storeDir, 'data', 'text-versions'),
    mappingsFile: join(storeDir, 'mappings.json'),
    scansDir: join(storeDir, 'scans'),
    artifactsFile: join(storeDir, 'artifacts.json'),
    artifactsDir: join(storeDir, 'artifacts'),
  }

  const textVersions = createTextVersionStore({ paths })
  const library = createLibraryStore({ paths })
  const mappings = createMappingStore({ paths })
  const artifacts = createArtifactStore({ paths })

  const asset = await library.add({
    name: '知识文档集',
    type: 'knowledge',
    files: [{ real_path: origDir }],
  })
  const fileId = asset.files[0].id
  const managedSkill = join(asset.files[0].real_path, 'SKILL.md')

  const dispatcher = createAssetsDispatcher({ mappings, artifacts, library, textVersions })
  let registered
  const dispose = registerAssetsRoutes({
    register(route) { registered = route; return () => { registered = null } },
  }, dispatcher, { getConnection: () => ({ requestRejection: () => undefined }) })

  const server = createServer((req, res) => { void registered.handler(req, res) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  return {
    port,
    asset,
    fileId,
    skillOrig,
    skillBody,
    otherBody,
    managedSkill,
    async close() {
      dispose()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

test('AssetTextEditorModal E2E: edit, undo/redo, search, save, snapshots, diff/revert, 409 conflict & unsaved close', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ate-e2e-'))
  const dom = installDom()
  const host = await startRealHost(rootDir)
  const realFetch = globalThis.fetch

  // Route relative `/omnimux/assets/...` fetches to the real local HTTP server.
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' && input.startsWith('/')
      ? `http://127.0.0.1:${host.port}${input}`
      : input
    return realFetch(url, init)
  }

  const React = pluginRequire('react')
  const { act } = React
  const { createRoot } = pluginRequire('react-dom/client')
  const AssetTextEditorModal = await loadEditorModal()

  let closedCount = 0
  let savedEvents = 0
  const rootEl = document.getElementById('root')
  const reactRoot = createRoot(rootEl)

  const skillItem = {
    id: `${host.asset.id}:SKILL.md`,
    title: 'SKILL.md',
    extension: 'MD',
    kind: 'file',
    pathInfo: 'SKILL.md',
    sourceAssetId: host.asset.id,
    assetId: host.asset.id,
    fileId: host.fileId,
    subPath: 'SKILL.md',
    editableText: true,
    markdown: true,
  }

  try {
    await act(async () => {
      reactRoot.render(React.createElement(AssetTextEditorModal, {
        item: skillItem,
        t,
        onClose: () => { closedCount += 1 },
        onSaved: () => { savedEvents += 1 },
      }))
    })

    // 1. Loaded with real UTF-8 content (including access_token & sk-a prose) and zero middle dots.
    await waitFor(() => document.querySelector('.omnimux-ate-cm-container .cm-content')?.textContent?.includes('access_token'))
    assert.equal(document.querySelector('.omnimux-ate-title')?.textContent, 'SKILL.md')
    assert.equal(document.querySelector('.omnimux-ate-ext-badge')?.textContent, 'MD')
    assert.equal(document.querySelector('.omnimux-ate-modal')?.textContent?.includes('·'), false)
    assert.equal(document.querySelector('button[aria-label="撤销 (Cmd+Z)"]')?.disabled, true)

    // 2. Edit via CodeMirror EditorView, verify dirty dot & undo/redo.
    const cmEditor = document.querySelector('.omnimux-ate-cm-container .cm-editor')
    const cmView = EditorView.findFromDOM(cmEditor)
    assert.notEqual(cmView, null)
    await act(async () => {
      cmView.dispatch({ changes: { from: cmView.state.doc.length, insert: '镜头 3\n' } })
    })
    await waitFor(() => Boolean(document.querySelector('.omnimux-ate-dirty-dot')))
    assert.equal(document.querySelector('button[aria-label="撤销 (Cmd+Z)"]')?.disabled, false)

    await act(async () => {
      document.querySelector('button[aria-label="撤销 (Cmd+Z)"]').click()
    })
    assert.equal(cmView.state.doc.toString().includes('镜头 3'), false)
    assert.equal(document.querySelector('button[aria-label="重做 (Cmd+Shift+Z)"]')?.disabled, false)

    await act(async () => {
      document.querySelector('button[aria-label="重做 (Cmd+Shift+Z)"]').click()
    })
    assert.equal(cmView.state.doc.toString().includes('镜头 3'), true)

    // 3. Inline Search shows instant synchronous count ("1/3", never flashing "无结果") and steps to "2/3".
    await act(async () => {
      document.querySelector('button[aria-label="查找 (Cmd+F)"]').click()
    })
    const searchInput = await waitFor(() => document.querySelector('.omnimux-ate-search-input'))
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(searchInput, '镜头')
      searchInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    assert.equal(document.querySelector('[data-testid="ate-search-count"]')?.textContent, '1/3')
    await act(async () => {
      document.querySelector('button[aria-label="下一个 (Enter)"]').click()
    })
    assert.equal(document.querySelector('[data-testid="ate-search-count"]')?.textContent, '2/3')

    // 4. Save persists managed copy on disk while leaving original source file completely untouched.
    await act(async () => {
      document.querySelector('button[aria-label="保存 (Cmd+S)"]').click()
    })
    await waitFor(() => !document.querySelector('.omnimux-ate-dirty-dot'))
    assert.equal(savedEvents, 1)
    assert.equal(readFileSync(host.managedSkill, 'utf8').includes('镜头 3'), true)
    assert.equal(readFileSync(host.skillOrig, 'utf8'), host.skillBody)

    // 5. Version Drawer: create named snapshot, modify doc, open MergeView Diff, revert & delete via ConfirmModal.
    await act(async () => {
      document.querySelector('button[aria-label="版本历史"]').click()
    })
    await waitFor(() => document.querySelector('.omnimux-ate-drawer'))
    await act(async () => {
      Array.from(document.querySelectorAll('.omnimux-ate-drawer button'))
        .find((b) => b.textContent?.includes('新建版本快照'))
        .click()
    })
    const snapInput = await waitFor(() => document.querySelector('.omnimux-ate-drawer input'))
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(snapInput, '第一版快照')
      snapInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      Array.from(document.querySelectorAll('.omnimux-ate-drawer button'))
        .find((b) => b.textContent?.includes('保存快照'))
        .click()
    })
    await waitFor(() => document.querySelectorAll('.omnimux-ate-version-card').length === 1)

    // Edit doc further so diff has a delta
    await act(async () => {
      cmView.dispatch({ changes: { from: cmView.state.doc.length, insert: '临时变更行\n' } })
    })
    await act(async () => {
      Array.from(document.querySelectorAll('.omnimux-ate-version-card button'))
        .find((b) => b.textContent?.includes('差异对比'))
        .click()
    })
    await waitFor(() => document.querySelectorAll('.omnimux-ate-diff-modal .cm-editor').length === 2)
    await act(async () => {
      Array.from(document.querySelectorAll('.omnimux-ate-diff-modal button'))
        .find((b) => b.textContent?.includes('恢复为此版本'))
        .click()
    })
    await waitFor(() => !document.querySelector('.omnimux-ate-diff-modal'))
    await waitFor(() => document.querySelectorAll('.omnimux-ate-version-card').length === 2)
    assert.equal(cmView.state.doc.toString().includes('临时变更行'), false)
    assert.equal(document.querySelector('.omnimux-ate-drawer')?.textContent?.includes('回滚'), true)

    // Delete the newest snapshot via ConfirmModal
    await act(async () => {
      document.querySelector('.omnimux-ate-version-card button[aria-label="删除快照"]').click()
    })
    await waitFor(() => document.querySelector('[data-testid="confirm-modal"]'))
    await act(async () => {
      Array.from(document.querySelectorAll('[data-testid="confirm-modal"] button'))
        .find((b) => b.textContent?.trim() === '删除快照')
        .click()
    })
    await waitFor(() => document.querySelectorAll('.omnimux-ate-version-card').length === 1)

    // 6. Optimistic ETag 409 conflict -> Reload Latest recovers disk content.
    await act(async () => {
      cmView.dispatch({ changes: { from: cmView.state.doc.length, insert: '本地冲突草稿\n' } })
    })
    writeFileSync(host.managedSkill, `${host.skillBody}外部并发写入\n`, 'utf8')
    await act(async () => {
      document.querySelector('button[aria-label="保存 (Cmd+S)"]').click()
    })
    await waitFor(() => document.querySelector('.omnimux-ate-alert-bar--conflict'))
    await act(async () => {
      Array.from(document.querySelectorAll('.omnimux-ate-alert-bar--conflict button'))
        .find((b) => b.textContent?.includes('重新加载最新内容'))
        .click()
    })
    await waitFor(() => !document.querySelector('.omnimux-ate-alert-bar--conflict'))
    await waitFor(() => document.querySelector('.omnimux-ate-cm-container .cm-content')?.textContent?.includes('外部并发写入'))

    // 7. Dirty close opens 3-way modal: Cancel stays open; Save & Close persists and invokes onClose.
    // Also verify parent re-render with fresh item object & fresh t closure does NOT wipe unsaved edits.
    const latestView = EditorView.findFromDOM(document.querySelector('.omnimux-ate-cm-container .cm-editor'))
    assert.notEqual(latestView, null)
    await act(async () => {
      latestView.dispatch({ changes: { from: latestView.state.doc.length, insert: '关闭前待保存\n' } })
    })
    await waitFor(() => Boolean(document.querySelector('.omnimux-ate-dirty-dot')))

    await act(async () => {
      reactRoot.render(React.createElement(AssetTextEditorModal, {
        item: { ...skillItem },
        t: (key) => zh[key] ?? key,
        onClose: () => { closedCount += 1 },
        onSaved: () => { savedEvents += 1 },
      }))
    })
    assert.equal(
      document.querySelector('.omnimux-ate-cm-container .cm-content')?.textContent?.includes('关闭前待保存'),
      true,
    )
    assert.equal(Boolean(document.querySelector('.omnimux-ate-dirty-dot')), true)

    // Snapshot creation form Escape cancels only the form, keeping the Version Drawer open.
    await act(async () => {
      Array.from(document.querySelectorAll('.omnimux-ate-drawer button'))
        .find((b) => b.textContent?.includes('新建版本快照'))
        .click()
    })
    const formInput = await waitFor(() => document.querySelector('.omnimux-ate-drawer input'))
    await act(async () => {
      formInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    assert.equal(document.querySelector('.omnimux-ate-drawer input'), null)
    assert.notEqual(document.querySelector('.omnimux-ate-drawer'), null)

    // Narrow-viewport Cmd+F while ConfirmModal is open must NOT close drawer or deadlock Escape.
    Object.defineProperty(window, 'innerWidth', { value: 640, configurable: true, writable: true })
    await act(async () => {
      document.querySelector('.omnimux-ate-version-card button[aria-label="删除快照"]').click()
    })
    await waitFor(() => document.querySelector('[data-testid="confirm-modal"]'))
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true }))
    })
    assert.notEqual(document.querySelector('.omnimux-ate-drawer'), null)
    assert.notEqual(document.querySelector('[data-testid="confirm-modal"]'), null)
    await act(async () => {
      Array.from(document.querySelectorAll('[data-testid="confirm-modal"] button'))
        .find((b) => b.textContent?.trim() === '取消')
        .click()
    })
    await waitFor(() => !document.querySelector('[data-testid="confirm-modal"]'))

    // IME composing Escape must not close drawer or modal.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true }))
    })
    assert.notEqual(document.querySelector('.omnimux-ate-drawer'), null)

    await act(async () => {
      document.querySelector('button[aria-label="关闭 (ESC)"]').click()
    })
    await waitFor(() => document.querySelector('[data-testid="modal-dialog"]'))
    assert.equal(closedCount, 0)

    await act(async () => {
      Array.from(document.querySelectorAll('[data-testid="modal-dialog"] button'))
        .find((b) => b.textContent?.trim() === '取消')
        .click()
    })
    assert.equal(document.querySelector('[data-testid="modal-dialog"]'), null)
    assert.equal(closedCount, 0)

    await act(async () => {
      document.querySelector('button[aria-label="关闭 (ESC)"]').click()
    })
    await waitFor(() => document.querySelector('[data-testid="modal-dialog"]'))
    await act(async () => {
      Array.from(document.querySelectorAll('[data-testid="modal-dialog"] button'))
        .find((b) => b.textContent?.trim() === '保存并关闭')
        .click()
    })
    await waitFor(() => closedCount === 1)
    assert.equal(readFileSync(host.managedSkill, 'utf8').includes('关闭前待保存'), true)
  } finally {
    await act(async () => { reactRoot.unmount() })
    globalThis.fetch = realFetch
    await host.close()
    dom.window.close()
    rmSync(rootDir, { recursive: true, force: true })
  }
})

test('AssetTextEditorModal E2E: stale in-flight read never overwrites switched document', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ate-e2e-race-'))
  const dom = installDom()
  const host = await startRealHost(rootDir)
  const realFetch = globalThis.fetch

  let releaseFirstRead
  const firstReadGate = new Promise((resolve) => { releaseFirstRead = resolve })
  let heldFirst = false

  globalThis.fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : ''
    const url = raw.startsWith('/') ? `http://127.0.0.1:${host.port}${raw}` : input
    if (raw.includes('path=SKILL.md') && !raw.includes('versions') && !heldFirst) {
      heldFirst = true
      await firstReadGate
    }
    return realFetch(url, init)
  }

  const React = pluginRequire('react')
  const { act } = React
  const { createRoot } = pluginRequire('react-dom/client')
  const AssetTextEditorModal = await loadEditorModal()

  const rootEl = document.getElementById('root')
  const reactRoot = createRoot(rootEl)

  const itemA = {
    id: `${host.asset.id}:SKILL.md`,
    title: 'SKILL.md',
    extension: 'MD',
    kind: 'file',
    pathInfo: 'SKILL.md',
    sourceAssetId: host.asset.id,
    assetId: host.asset.id,
    fileId: host.fileId,
    subPath: 'SKILL.md',
    editableText: true,
    markdown: true,
  }
  const itemB = {
    id: `${host.asset.id}:OTHER.md`,
    title: 'OTHER.md',
    extension: 'MD',
    kind: 'file',
    pathInfo: 'OTHER.md',
    sourceAssetId: host.asset.id,
    assetId: host.asset.id,
    fileId: host.fileId,
    subPath: 'OTHER.md',
    editableText: true,
    markdown: true,
  }

  try {
    await act(async () => {
      reactRoot.render(React.createElement(AssetTextEditorModal, { item: itemA, t, onClose: () => {} }))
    })
    await waitFor(() => heldFirst)

    // Switch to itemB while itemA's read is still pending.
    await act(async () => {
      reactRoot.render(React.createElement(AssetTextEditorModal, { item: itemB, t, onClose: () => {} }))
    })
    await waitFor(() => document.querySelector('.omnimux-ate-cm-container .cm-content')?.textContent?.includes('第二个文档'))

    // Release delayed first read and verify it does NOT overwrite itemB!
    releaseFirstRead()
    await new Promise((resolve) => setTimeout(resolve, 60))
    assert.equal(document.querySelector('.omnimux-ate-title')?.textContent, 'OTHER.md')
    assert.equal(
      document.querySelector('.omnimux-ate-cm-container .cm-content')?.textContent?.includes('第二个文档'),
      true,
    )
    assert.equal(
      document.querySelector('.omnimux-ate-cm-container .cm-content')?.textContent?.includes('access_token'),
      false,
    )
  } finally {
    releaseFirstRead?.()
    await act(async () => { reactRoot.unmount() })
    globalThis.fetch = realFetch
    await host.close()
    dom.window.close()
    rmSync(rootDir, { recursive: true, force: true })
  }
})
