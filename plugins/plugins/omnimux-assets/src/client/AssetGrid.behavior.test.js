/**
 * AssetGrid 16:10 横版托盘卡片运行时交互契约测试（真实 React + JSDOM）。
 * 覆盖：点击展台预览/打开、右上角快捷加入会话、多选圆圈点击与键盘不冒泡、
 * 标题行 ... 菜单（查看详情 / 添加到会话 / 打开文件位置 / 移除）与视频/上传进度/无封面占位态。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { zh } from './locales.js'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRequire = createRequire(join(here, '..', '..', 'package.json'))
const { JSDOM } = pluginRequire('jsdom')

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
  globalThis.Node = window.Node
  globalThis.Event = window.Event
  globalThis.MouseEvent = window.MouseEvent
  globalThis.KeyboardEvent = window.KeyboardEvent
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  return window
}

const PRIMITIVES_SHIM = `
import React from 'react'
export function Tooltip({ children }) { return children }
export function Modal({ open, children }) { return open ? <div role="dialog">{children}</div> : null }
export function Menu({ open, anchor, items = [], onSelect, onClose }) {
  return (
    <span data-test-menu-wrap="true">
      {anchor}
      {open ? (
        <div role="menu" data-test-menu="true">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              data-menu-id={item.id}
              disabled={item.disabled}
              onClick={(e) => { e.stopPropagation(); if (!item.disabled) onSelect?.(item.id) }}
            >
              {item.label}
            </button>
          ))}
          <button type="button" data-menu-close="true" onClick={() => onClose?.()}>close</button>
        </div>
      ) : null}
    </span>
  )
}
const Icon = () => <svg />
export const IconEllipsisOutline16 = Icon
export const IconTrashOutline16 = Icon
export const IconSearchOutline16 = Icon
export const IconCloseOutline16 = Icon
export const IconCloseFill14 = Icon
export const IconLoadingOutline16 = Icon
export const IconCheckOutline16 = Icon
export const IconRefreshOutline16 = Icon
export const IconRefreshOutline14 = Icon
export const IconDownloadOutline16 = Icon
export const IconPlusOutline16 = Icon
export const IconChevronDownOutline14 = Icon
export const IconChevronUpOutline14 = Icon
export const IconChevronLeftOutline14 = Icon
export const IconEditOutline16 = Icon
export const IconCopyOutline16 = Icon
export const IconPaperclipOutline16 = Icon
export const IconPlayOutline16 = Icon
export const IconRightUpOutline14 = Icon
`

async function loadAssetGrid() {
  const esbuild = pluginRequire('esbuild')
  const result = await esbuild.build({
    entryPoints: [join(here, 'AssetGrid.jsx')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    write: false,
    logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
    plugins: [
      {
        name: 'shim-primitives-and-css',
        setup(build) {
          build.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({
            path: 'primitives-shim',
            namespace: 'shim',
          }))
          build.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({
            contents: PRIMITIVES_SHIM,
            loader: 'jsx',
            resolveDir: here,
          }))
          build.onResolve({ filter: /\.(css|less|scss|woff|woff2|ttf|png|jpg|jpeg|webp|svg|mp3|mp4)$/ }, (args) => ({
            path: args.path,
            namespace: 'stub-assets',
          }))
          build.onLoad({ filter: /./, namespace: 'stub-assets' }, () => ({
            contents: 'module.exports = {}',
            loader: 'js',
          }))
        },
      },
    ],
  })
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(pluginRequire, mod, mod.exports)
  return mod.exports
}

test('AssetGrid 托盘卡片：预览/打开、快捷加入、多选防冒泡、... 菜单四项动作及视频/上传/无封面态', async () => {
  const window = installDom()
  const React = pluginRequire('react')
  const { createRoot } = pluginRequire('react-dom/client')
  const { AssetGrid } = await loadAssetGrid()
  const t = (key) => zh[key] ?? key

  const opened = []
  const previewed = []
  const added = []
  const toggled = []
  const removed = []
  const errors = []
  const fetchCalls = []

  const origFetch = globalThis.fetch
  let revealOk = true
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init })
    return {
      ok: revealOk,
      status: revealOk ? 200 : 404,
      json: async () => (revealOk ? { path: '/mock/file', isDirectory: false } : { error: 'missing' }),
      text: async () => JSON.stringify(revealOk ? { path: '/mock/file' } : { error: 'missing' }),
    }
  }

  const assets = [
    {
      id: 'ast_img',
      name: '科技主播 Yuna',
      type: 'character',
      created_at: new Date().toISOString(),
      files: [{ id: 'f_img', original_name: 'yuna.png', kind: 'image' }],
      cover: { id: 'f_img', original_name: 'yuna.png', kind: 'image' },
    },
    {
      id: 'ast_vid',
      name: '产品展示短视频',
      type: 'scene',
      created_at: new Date().toISOString(),
      files: [{ id: 'f_vid', original_name: 'demo.mp4', kind: 'video' }],
      cover: null,
    },
    {
      id: 'ast_upload',
      name: '风格包导入中',
      type: 'style',
      uploadProgress: 95,
      created_at: new Date().toISOString(),
      files: [],
      cover: null,
    },
    {
      id: 'ast_folder',
      name: '商品实拍目录',
      type: 'prop',
      created_at: new Date().toISOString(),
      files: [{ id: 'f_dir', original_name: 'photos', kind: 'directory', is_dir: true }],
      cover: null,
    },
    {
      id: 'ast_doc',
      name: '无封面知识包',
      type: 'knowledge',
      created_at: new Date().toISOString(),
      files: [{ id: 'f_doc', original_name: 'guide.md', kind: 'document' }],
      cover: null,
    },
  ]

  const container = window.document.getElementById('root')
  const root = createRoot(container)
  try {
    await React.act(async () => {
      root.render(React.createElement(AssetGrid, {
        t,
        assets,
        emptyLabel: '空',
        selectedIds: new Set(),
        onToggleSelect: (a) => toggled.push(a.id),
        onOpen: (a) => opened.push(a.id),
        onPreview: (item) => previewed.push(item),
        onAddToConversation: (a) => added.push(a.id),
        onRemove: (a) => removed.push(a.id),
        onError: (msg) => errors.push(msg),
      }))
    })

    const cards = [...container.querySelectorAll('.omnimux-assets-local-grid .omnimux-assets-card')]
    assert.equal(cards.length, 5)

    // 1. 图片卡不含旧 9x16 属性；视频卡渲染 <video> + 播放徽标；上传中渲染 95% 环；无封面知识包渲染占位底座
    const img = cards[0].querySelector('img.omnimux-assets-card-media')
    assert.ok(img)
    assert.equal(img.getAttribute('width'), null)
    assert.equal(img.getAttribute('height'), null)
    assert.ok(cards[1].querySelector('video.omnimux-assets-card-video'))
    assert.ok(cards[1].querySelector('.omnimux-assets-card-video-play'))
    assert.equal(cards[1].querySelector('img'), null)
    assert.equal(cards[2].querySelector('.omnimux-assets-card-progress-pct')?.textContent, '95%')
    assert.ok(cards[3].querySelector('.omnimux-assets-card-placeholder'))
    assert.ok(cards[4].querySelector('.omnimux-assets-card-placeholder'))

    // 2. 点击单图展台触发预览，点击文件夹展台触发打开
    await React.act(async () => {
      cards[0].click()
      cards[3].click()
    })
    assert.equal(previewed.length, 1)
    assert.equal(opened.length, 1)
    assert.equal(opened[0], 'ast_folder')

    // 3. 右上角快捷加入不冒泡触发卡片预览，且立即切换 data-added="true" 与 disabled
    const quickAddBtn = cards[0].querySelector('.omnimux-assets-quick-add')
    await React.act(async () => { quickAddBtn.click() })
    assert.deepEqual(added, ['ast_img'])
    assert.equal(previewed.length, 1)
    assert.equal(quickAddBtn.getAttribute('data-added'), 'true')
    assert.equal(quickAddBtn.disabled, true)

    // 4. 多选圆圈点击与 Enter/Space 键均不触发卡片预览
    const checkBtn = cards[0].querySelector('.omnimux-assets-check')
    await React.act(async () => {
      checkBtn.click()
      checkBtn.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    assert.deepEqual(toggled, ['ast_img'])
    assert.equal(previewed.length, 1)

    // 5. 标题行 ... 菜单覆盖查看详情 / 添加到会话 / 打开文件位置（成功与失败回调）/ 移除
    const moreBtn = cards[1].querySelector('.omnimux-assets-card-more-btn')
    await React.act(async () => { moreBtn.click() })
    const menuItems = [...cards[1].querySelectorAll('[role="menuitem"]')].map((el) => el.getAttribute('data-menu-id'))
    assert.deepEqual(menuItems, ['view', 'add', 'reveal', 'remove'])

    await React.act(async () => {
      cards[1].querySelector('[data-menu-id="view"]').click()
    })
    assert.equal(opened[1], 'ast_vid')

    await React.act(async () => { moreBtn.click() })
    await React.act(async () => {
      cards[1].querySelector('[data-menu-id="add"]').click()
    })
    assert.deepEqual(added, ['ast_img', 'ast_vid'])

    await React.act(async () => { moreBtn.click() })
    await React.act(async () => {
      cards[1].querySelector('[data-menu-id="reveal"]').click()
    })
    assert.equal(fetchCalls.length, 1)
    assert.match(fetchCalls[0].url, /\/omnimux\/assets\/library\/reveal$/)
    assert.equal(errors.length, 0)

    revealOk = false
    await React.act(async () => { moreBtn.click() })
    await React.act(async () => {
      cards[1].querySelector('[data-menu-id="reveal"]').click()
    })
    assert.equal(errors.length, 1)
    assert.equal(errors[0], zh['browse.revealFailed'])

    await React.act(async () => { moreBtn.click() })
    await React.act(async () => {
      cards[1].querySelector('[data-menu-id="remove"]').click()
    })
    assert.deepEqual(removed, ['ast_vid'])
  } finally {
    globalThis.fetch = origFetch
    await React.act(async () => { root.unmount() })
  }
})
