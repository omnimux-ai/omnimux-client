import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { zh } from './locales.js'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRequire = createRequire(join(here, '..', '..', 'package.json'))

const bundleCache = new Map()

async function loadClientModule(filename) {
  if (bundleCache.has(filename)) return bundleCache.get(filename)
  const esbuild = pluginRequire('esbuild')
  const result = await esbuild.build({
    entryPoints: [join(here, filename)],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    write: false,
    logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
    plugins: [
      {
        name: 'stub-assets',
        setup(build) {
          build.onResolve({ filter: /\.(css|less|scss|woff|woff2|ttf|png|jpg|jpeg|webp|svg|mp3|mp4)$/ }, (args) => ({
            path: args.path,
            namespace: 'stub-assets',
          }))
          build.onLoad({ filter: /./, namespace: 'stub-assets' }, () => ({ contents: 'module.exports = {}', loader: 'js' }))
        },
      },
    ],
  })
  const mod = { exports: {} }
  const customRequire = (id) => {
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      return { Tooltip: ({ children }) => children, Menu: () => null, Modal: () => null }
    }
    return pluginRequire(id)
  }
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(customRequire, mod, mod.exports)
  bundleCache.set(filename, mod.exports)
  return mod.exports
}

function installDom() {
  const { JSDOM } = pluginRequire('jsdom')
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1/',
    pretendToBeVisual: true,
  })
  const { window } = dom
  globalThis.window = window
  globalThis.document = window.document
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true })
  globalThis.HTMLElement = window.HTMLElement
  globalThis.Node = window.Node
  globalThis.Event = window.Event
  globalThis.CustomEvent = window.CustomEvent
  globalThis.MouseEvent = window.MouseEvent
  globalThis.KeyboardEvent = window.KeyboardEvent
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  return window
}

const SAMPLE_ASSETS = [
  {
    id: 'asset-char',
    name: '粉衣女郎 Yuna',
    type: 'character',
    description: '室内自然光立绘\n云端分类：角色 / 女性角色\n云端来源：character-female-yuna',
    files: [{ id: 'f1', original_name: 'yuna.png', real_path: '/tmp/yuna.png', mime: 'image/png' }],
    updated_at: '2026-11-25T18:50:00Z',
  },
  {
    id: 'asset-scene',
    name: '霓虹雨夜便利店',
    type: 'scene',
    description: '16:9 夜景空镜',
    files: [
      { id: 'f2', original_name: 'street.jpg', real_path: '/tmp/street.jpg', mime: 'image/jpeg' },
      { id: 'f3', original_name: 'rain.mp4', real_path: '/tmp/rain.mp4', mime: 'video/mp4' },
      { id: 'f4', original_name: 'note.txt', real_path: '/tmp/note.txt', mime: 'text/plain' },
    ],
    updated_at: '2026-11-25T17:00:00Z',
  },
  {
    id: 'asset-know',
    name: '美妆脚本手册',
    type: 'knowledge',
    description: '云端分类：知识包\n云端来源：doc-beauty-01',
    files: [{ id: 'f5', original_name: 'guide.md', real_path: '/tmp/guide.md', mime: 'text/markdown' }],
    updated_at: '2026-11-24T12:00:00Z',
  },
  {
    id: 'asset-prop',
    name: '机械键盘道具',
    type: 'prop',
    description: '桌面科技风摆件',
    files: [],
    missing_file_count: 1,
    updated_at: '2026-11-20T08:00:00Z',
  },
]

const dictT = (key) => zh[key] ?? key

describe('AssetListRow interactive behavior (JSDOM)', () => {
  it('renders 16:10 thumbnails, semantic fallback icons, cleaned descriptions, and updated column', async () => {
    const window = installDom()
    const React = pluginRequire('react')
    const { createRoot } = pluginRequire('react-dom/client')
    const { AssetGrid } = await loadClientModule('AssetGrid.jsx')

    const container = window.document.getElementById('root')
    const root = createRoot(container)
    await React.act(async () => {
      root.render(React.createElement(AssetGrid, {
        t: dictT,
        assets: SAMPLE_ASSETS,
        viewMode: 'list',
        emptyLabel: 'empty',
        selectedIds: new Set(),
        onSelectionChange: () => {},
        onOpen: () => {},
      }))
    })

    const headers = Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent.trim())
    assert.deepEqual(headers, ['', '名称', '类型', '描述', '素材', '更新时间', '操作'])

    const rows = Array.from(container.querySelectorAll('tbody tr.omnimux-assets-list-row'))
    assert.equal(rows.length, 4)

    const img0 = rows[0].querySelector('.omnimux-assets-list-thumb-img')
    assert.ok(img0, 'character row with cover renders thumbnail img')
    assert.match(img0.getAttribute('src'), /\/omnimux\/assets\/library\/preview\?id=asset-char&file=f1/)
    const desc0 = rows[0].querySelector('.omnimux-assets-td-desc')
    assert.equal(desc0.textContent.trim(), '室内自然光立绘')
    assert.match(desc0.getAttribute('title'), /云端分类：角色/)

    const knowRow = rows.find((r) => r.getAttribute('data-asset-id') === 'asset-know')
    assert.equal(knowRow.querySelector('.omnimux-assets-list-thumb-img'), null)
    const knowSvg = knowRow.querySelector('.omnimux-assets-list-thumb svg')
    assert.ok(knowSvg, 'knowledge asset without cover renders semantic SVG icon')
    assert.equal(knowRow.querySelector('.omnimux-assets-td-desc').textContent.trim(), '—')

    const propRow = rows.find((r) => r.getAttribute('data-asset-id') === 'asset-prop')
    const propSvg = propRow.querySelector('.omnimux-assets-list-thumb svg')
    assert.ok(propSvg, 'prop asset without cover renders semantic SVG icon')
    assert.notEqual(knowSvg.innerHTML, propSvg.innerHTML, 'different asset types must render distinct semantic icons')
    const missingBadge = propRow.querySelector('.omnimux-assets-list-missing')
    assert.match(missingBadge.textContent, /缺失/)
    assert.equal(missingBadge.classList.contains('omnimux-assets-missing'), false, 'must not inherit card overlay class')

    const row0Buttons = Array.from(rows[0].querySelectorAll('.omnimux-assets-list-actions button'))
    assert.equal(row0Buttons.length, 2)
    assert.equal(row0Buttons[0].textContent.trim(), '添加到会话')
    assert.equal(row0Buttons[1].getAttribute('aria-label'), '更多操作')

    await React.act(async () => { root.unmount() })
  })

  it('supports header select-all, Shift+Click range selection, and anchor recovery after filtering', async () => {
    const window = installDom()
    const React = pluginRequire('react')
    const { createRoot } = pluginRequire('react-dom/client')
    const { AssetGrid } = await loadClientModule('AssetGrid.jsx')

    const container = window.document.getElementById('root')
    const root = createRoot(container)
    let latestSelected = new Set()
    let setVisibleAssets = null

    function Harness() {
      const [selectedIds, setSelectedIds] = React.useState(() => new Set())
      const [items, setItems] = React.useState(SAMPLE_ASSETS)
      latestSelected = selectedIds
      setVisibleAssets = setItems
      return React.createElement(AssetGrid, {
        t: dictT,
        assets: items,
        viewMode: 'list',
        emptyLabel: 'empty',
        selectedIds,
        onSelectionChange: setSelectedIds,
        onOpen: () => {},
      })
    }

    await React.act(async () => { root.render(React.createElement(Harness)) })

    const headerCb = () => container.querySelector('thead [role="checkbox"]')
    const rowCbs = () => Array.from(container.querySelectorAll('tbody [role="checkbox"]'))

    assert.equal(headerCb().getAttribute('aria-checked'), 'false')

    // Plain click sets anchor at row 0 (asset-char)
    await React.act(async () => { rowCbs()[0].click() })
    assert.equal(headerCb().getAttribute('aria-checked'), 'mixed')
    assert.equal(latestSelected.size, 1)

    // Shift+Click prevents native selection on mousedown and selects range 0..2
    const shiftDown = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, shiftKey: true })
    rowCbs()[2].dispatchEvent(shiftDown)
    assert.equal(shiftDown.defaultPrevented, true, 'Shift+mousedown must prevent native text highlight')
    await React.act(async () => {
      rowCbs()[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true, shiftKey: true }))
    })
    assert.equal(latestSelected.size, 3)

    // Header click selects all, then clears all (and resets anchor)
    await React.act(async () => { headerCb().click() })
    assert.equal(latestSelected.size, 4)
    assert.equal(headerCb().getAttribute('aria-checked'), 'true')
    await React.act(async () => { headerCb().click() })
    assert.equal(latestSelected.size, 0)
    assert.equal(headerCb().getAttribute('aria-checked'), 'false')

    // Anchor recovery after filtering out previous anchor:
    // 1. Anchor on row 0 (asset-char)
    await React.act(async () => { rowCbs()[0].click() })
    // 2. Filter out asset-char so visible rows are [asset-scene, asset-know, asset-prop]
    await React.act(async () => { setVisibleAssets(SAMPLE_ASSETS.slice(1)) })
    // 3. Shift+Click row 0 (asset-scene) -> previous anchor gone, toggles asset-scene AND promotes it as new anchor
    await React.act(async () => {
      rowCbs()[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true, shiftKey: true }))
    })
    assert.equal(latestSelected.has('asset-scene'), true)
    // 4. Subsequent Shift+Click row 2 (asset-prop) -> selects entire range [asset-scene, asset-know, asset-prop]
    await React.act(async () => {
      rowCbs()[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true, shiftKey: true }))
    })
    assert.equal(latestSelected.has('asset-know'), true)
    assert.equal(latestSelected.has('asset-prop'), true)

    await React.act(async () => { root.unmount() })
  })

  it('sorts rows, routes Space on folder assets to onOpen, handles overflow menu Copy/Tab, and builds drag payload', async () => {
    const window = installDom()
    const React = pluginRequire('react')
    const { createRoot } = pluginRequire('react-dom/client')
    const { AssetGrid, buildAssetDragData } = await loadClientModule('AssetGrid.jsx')

    const folderAsset = {
      id: 'asset-dir',
      name: '角色立绘目录',
      type: 'character',
      description: '单目录挂载资产',
      files: [{ id: 'd1', kind: 'directory', original_name: 'chars', real_path: '/tmp/chars' }],
      updated_at: 1764090000000,
    }
    const assetsWithFolder = [...SAMPLE_ASSETS, folderAsset]

    const container = window.document.getElementById('root')
    const root = createRoot(container)
    const calls = { opened: [], previewed: [], copied: [], removed: [], revealed: [], added: [] }

    await React.act(async () => {
      root.render(React.createElement(AssetGrid, {
        t: dictT,
        assets: assetsWithFolder,
        viewMode: 'list',
        emptyLabel: 'empty',
        selectedIds: new Set(),
        onSelectionChange: () => {},
        onOpen: (a) => calls.opened.push(a.id),
        onPreview: (item) => calls.previewed.push(item.sourceAssetId),
        onCopy: (a) => calls.copied.push(a.id),
        onRemove: (a) => calls.removed.push(a.id),
        onReveal: (a) => calls.revealed.push(a.id),
        onAddToConversation: (a) => calls.added.push(a.id),
      }))
    })

    // Numeric timestamp produces a non-empty title tooltip
    const dirRowInitial = container.querySelector('tr[data-asset-id="asset-dir"]')
    assert.ok(dirRowInitial.querySelector('.omnimux-assets-td-updated').getAttribute('title'), 'numeric timestamp renders tooltip')

    // Space on folder/directory asset MUST route to onOpen, NOT onPreview
    await React.act(async () => {
      dirRowInitial.focus()
      dirRowInitial.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    })
    assert.deepEqual(calls.previewed, [], 'folder asset must not be sent to media preview modal on Space')
    assert.deepEqual(calls.opened, ['asset-dir'])
    calls.opened.length = 0

    // Sort by files count desc/asc
    const filesTh = container.querySelector('th[data-sort-key="files"]')
    await React.act(async () => { filesTh.click() })
    assert.equal(filesTh.getAttribute('aria-sort'), 'descending')
    let orderedIds = Array.from(container.querySelectorAll('tbody tr')).map((r) => r.getAttribute('data-asset-id'))
    assert.equal(orderedIds[0], 'asset-scene')
    assert.equal(orderedIds[orderedIds.length - 1], 'asset-prop')

    await React.act(async () => { filesTh.click() })
    assert.equal(filesTh.getAttribute('aria-sort'), 'ascending')
    orderedIds = Array.from(container.querySelectorAll('tbody tr')).map((r) => r.getAttribute('data-asset-id'))
    assert.equal(orderedIds[0], 'asset-prop')

    // Sort by updated_at desc
    const updatedTh = container.querySelector('th[data-sort-key="updated_at"]')
    await React.act(async () => { updatedTh.click() })
    const rows = () => Array.from(container.querySelectorAll('tbody tr'))
    assert.equal(rows()[0].getAttribute('data-asset-id'), 'asset-char')

    // Primary Add to Chat button switches to 已添加
    const addBtn = rows()[0].querySelector('.omnimux-assets-list-add-btn')
    await React.act(async () => { addBtn.click() })
    assert.deepEqual(calls.added, ['asset-char'])
    assert.equal(addBtn.textContent.trim(), '已添加')
    assert.equal(addBtn.disabled, true)

    // Overflow menu shows all 4 items, displays 已复制 confirmation on Copy, and closes on Tab
    const moreBtn = rows()[0].querySelector('.omnimux-assets-list-more-btn')
    await React.act(async () => { moreBtn.click() })
    let menu = window.document.querySelector('.omnimux-assets-list-more-menu')
    assert.ok(menu, 'overflow menu portals into document.body')
    const menuLabels = Array.from(menu.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent.trim())
    assert.deepEqual(menuLabels, ['查看详情', '打开文件位置', '复制引用', '移除'])
    await React.act(async () => { menu.querySelectorAll('[role="menuitem"]')[2].click() })
    assert.deepEqual(calls.copied, ['asset-char'])
    assert.equal(menu.querySelectorAll('[role="menuitem"]')[2].textContent.trim(), '已复制')

    // Tab closes the portaled menu immediately
    await React.act(async () => {
      menu.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    assert.equal(window.document.querySelector('.omnimux-assets-list-more-menu'), null)

    // Keyboard navigation: ArrowDown -> Space -> Enter on media row
    await React.act(async () => {
      rows()[0].focus()
      rows()[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    assert.equal(window.document.activeElement, rows()[1])
    await React.act(async () => {
      rows()[0].focus()
      rows()[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }))
      rows()[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    assert.deepEqual(calls.previewed, ['asset-char'])
    assert.deepEqual(calls.opened, ['asset-char'])

    // Drag contract
    assert.equal(rows()[0].getAttribute('draggable'), 'true')
    const dragData = buildAssetDragData(SAMPLE_ASSETS[0], '/omnimux/assets/library/preview?id=asset-char&file=f1')
    const parsed = JSON.parse(dragData.json)
    assert.equal(parsed.type, 'omnimux-asset')
    assert.equal(parsed.asset.id, 'asset-char')
    assert.equal(parsed.asset.real_path, '/tmp/yuna.png')
    assert.equal(dragData.text, '@character/粉衣女郎 Yuna')

    await React.act(async () => { root.unmount() })
  })

  it('AssetsSelectionBar batch-adds selected assets to conversation and resets cooldown when selection changes', async () => {
    const window = installDom()
    const React = pluginRequire('react')
    const { createRoot } = pluginRequire('react-dom/client')
    const { AssetsSelectionBar } = await loadClientModule('AssetsStage.jsx')

    const dispatched = []
    window.addEventListener('omnimux:add-to-conversation', (e) => dispatched.push(e.detail))

    const container = window.document.getElementById('root')
    const root = createRoot(container)
    let setSel = null

    function BarHarness() {
      const [selectedIds, setSelectedIds] = React.useState(() => new Set(['asset-char', 'asset-scene']))
      setSel = setSelectedIds
      const feed = {
        selecting: selectedIds.size > 0,
        selectedCount: selectedIds.size,
        selectedIds,
        visible: SAMPLE_ASSETS,
        assets: SAMPLE_ASSETS,
        busy: false,
        clearSelection: () => setSelectedIds(new Set()),
        handleOpenBatchDelete: () => {},
      }
      return React.createElement(AssetsSelectionBar, { t: dictT, feed })
    }

    await React.act(async () => { root.render(React.createElement(BarHarness)) })
    const batchAddBtn = () => container.querySelector('.omnimux-assets-selection-actions button')
    assert.equal(batchAddBtn().textContent.trim(), '批量加入会话')

    // Click batch add -> dispatches 2 events and enters cooldown
    await React.act(async () => { batchAddBtn().click() })
    assert.equal(dispatched.length, 2)
    assert.equal(batchAddBtn().textContent.trim(), '已加入会话')
    assert.equal(batchAddBtn().disabled, true)

    // Adding a 3rd selected item immediately resets cooldown so user can add the new selection
    await React.act(async () => { setSel(new Set(['asset-char', 'asset-scene', 'asset-know'])) })
    assert.equal(batchAddBtn().textContent.trim(), '批量加入会话')
    assert.equal(batchAddBtn().disabled, false)

    await React.act(async () => { root.unmount() })
  })
})
