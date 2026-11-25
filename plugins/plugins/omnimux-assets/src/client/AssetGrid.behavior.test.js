/**
 * AssetGrid 16:10 横版托盘卡片运行时交互契约测试（真实 React + 真实 @deepseek-ai/dsh-client-ui-primitives Menu + JSDOM）。
 * 覆盖：点击展台预览/打开、右上角快捷加入会话、多选圆圈点击与键盘不冒泡、
 * 标题行 ... 真实门户 Menu（单开互斥、ArrowDown 键盘导航、查看详情 / 添加到会话 / 打开文件位置 / 移除、无文件省略 reveal）、
 * 媒体 error 降级占位、错误态在下次 reveal 清零，以及视频/上传进度(含 99.6 钳位)/无封面占位态。
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
  globalThis.Element = window.Element
  globalThis.HTMLElement = window.HTMLElement
  globalThis.HTMLButtonElement = window.HTMLButtonElement
  globalThis.HTMLInputElement = window.HTMLInputElement
  globalThis.SVGElement = window.SVGElement
  globalThis.Node = window.Node
  globalThis.Event = window.Event
  globalThis.MouseEvent = window.MouseEvent
  globalThis.KeyboardEvent = window.KeyboardEvent
  globalThis.MutationObserver = window.MutationObserver
  globalThis.getComputedStyle = window.getComputedStyle.bind(window)
  globalThis.requestAnimationFrame = window.requestAnimationFrame || ((cb) => setTimeout(cb, 0))
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame || ((id) => clearTimeout(id))
  if (typeof window.PointerEvent === 'function') {
    globalThis.PointerEvent = window.PointerEvent
  } else {
    globalThis.PointerEvent = window.MouseEvent
    window.PointerEvent = window.MouseEvent
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = window.ResizeObserver
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  return window
}

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
        name: 'stub-css-and-media',
        setup(build) {
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

function dispatchPointerAndClick(window, el) {
  el.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
  el.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
  el.click()
}

test('AssetGrid 托盘卡片：挂接真实宿主 Menu 覆盖交互、键盘导航、互斥关闭、媒体降级与错误清零', async () => {
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
      uploadProgress: 99.6,
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

    const cards = Array.from(container.querySelectorAll('.omnimux-assets-local-grid .omnimux-assets-card'))
    assert.equal(cards.length, 5)

    // 1. 图片卡不含旧 9x16 属性；视频卡渲染 <video> + 播放徽标；上传中 99.6 钳位 99%；无封面知识包渲染占位底座
    const img = cards[0].querySelector('img.omnimux-assets-card-media')
    assert.ok(img)
    assert.equal(img.getAttribute('width'), null)
    assert.equal(img.getAttribute('height'), null)
    assert.ok(cards[1].querySelector('video.omnimux-assets-card-video'))
    assert.ok(cards[1].querySelector('.omnimux-assets-card-video-play'))
    assert.equal(cards[1].querySelector('img'), null)
    assert.equal(cards[2].querySelector('.omnimux-assets-card-progress-pct')?.textContent, '99%')
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
    const quickAddBtn0 = cards[0].querySelector('.omnimux-assets-quick-add')
    await React.act(async () => { dispatchPointerAndClick(window, quickAddBtn0) })
    assert.deepEqual(added, ['ast_img'])
    assert.equal(previewed.length, 1)
    assert.equal(quickAddBtn0.getAttribute('data-added'), 'true')
    assert.equal(quickAddBtn0.disabled, true)

    // 4. 多选圆圈点击与 Enter 键均不触发卡片预览
    const checkBtn0 = cards[0].querySelector('.omnimux-assets-check')
    await React.act(async () => {
      dispatchPointerAndClick(window, checkBtn0)
      checkBtn0.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    assert.deepEqual(toggled, ['ast_img'])
    assert.equal(previewed.length, 1)

    // 5. 真实门户 Menu 互斥关闭：开卡 0 菜单后点卡 1 菜单触发器，全页只剩 1 个 [role="menu"]
    const moreBtn0 = cards[0].querySelector('.omnimux-assets-card-more-btn')
    const moreBtn1 = cards[1].querySelector('.omnimux-assets-card-more-btn')
    const moreBtn2 = cards[2].querySelector('.omnimux-assets-card-more-btn')

    await React.act(async () => { dispatchPointerAndClick(window, moreBtn0) })
    assert.equal(window.document.body.querySelectorAll('[role="menu"]').length, 1)

    await React.act(async () => { dispatchPointerAndClick(window, moreBtn1) })
    assert.equal(window.document.body.querySelectorAll('[role="menu"]').length, 1, '打开另一张卡的菜单时旧菜单必须自动关闭')

    // 6. 真实门户 Menu 键盘导航：触发器与菜单项上的 ArrowDown 均能正常移动焦点且不误触卡片预览
    moreBtn1.focus()
    await React.act(async () => {
      moreBtn1.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    })
    const activeItems1 = Array.from(window.document.body.querySelectorAll('[role="menu"] [role="menuitem"]'))
    assert.equal(activeItems1.length, 4)
    assert.deepEqual(
      activeItems1.map((el) => el.textContent?.trim()),
      [zh['card.view'], zh['card.addToConversation'], zh['browse.revealLocation'], zh['mapping.remove']],
    )
    assert.equal(window.document.activeElement, activeItems1[0], '触发器按 ArrowDown 后焦点应落入首条菜单项')

    await React.act(async () => {
      activeItems1[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    })
    assert.equal(window.document.activeElement, activeItems1[1], '菜单项按 ArrowDown 应前进到下一项')
    assert.equal(previewed.length, 1)

    // 点卡片快捷按钮（外部 pointerdown）时已打开的菜单必须关闭
    const quickAddBtn4 = cards[4].querySelector('.omnimux-assets-quick-add')
    await React.act(async () => { dispatchPointerAndClick(window, quickAddBtn4) })
    assert.equal(window.document.body.querySelectorAll('[role="menu"]').length, 0, '点击外部快捷按钮后菜单应关闭')
    assert.deepEqual(added, ['ast_img', 'ast_doc'])

    // 7. 无文件资产（files: []）菜单省略「打开文件位置」
    await React.act(async () => { dispatchPointerAndClick(window, moreBtn2) })
    const uploadMenuLabels = Array.from(window.document.body.querySelectorAll('[role="menu"] [role="menuitem"]')).map((el) => el.textContent?.trim())
    assert.deepEqual(uploadMenuLabels, [zh['card.view'], zh['card.addToConversation'], zh['mapping.remove']])

    // 8. 真实门户 Menu 四项业务动作 + reveal 失败后再次成功清零旧错误
    const clickMenuByText = async (trigger, label) => {
      await React.act(async () => { dispatchPointerAndClick(window, trigger) })
      const item = Array.from(window.document.body.querySelectorAll('[role="menu"] [role="menuitem"]'))
        .find((el) => el.textContent?.trim() === label)
      assert.ok(item, `未找到菜单项: ${label}`)
      await React.act(async () => { dispatchPointerAndClick(window, item) })
    }

    await clickMenuByText(moreBtn1, zh['card.view'])
    assert.equal(opened[1], 'ast_vid')

    await clickMenuByText(moreBtn1, zh['card.addToConversation'])
    assert.deepEqual(added, ['ast_img', 'ast_doc', 'ast_vid'])

    revealOk = false
    await clickMenuByText(moreBtn1, zh['browse.revealLocation'])
    assert.equal(fetchCalls.length, 1)
    assert.match(fetchCalls[0].url, /\/omnimux\/assets\/library\/reveal$/)
    assert.equal(errors[errors.length - 1], zh['browse.revealFailed'])

    revealOk = true
    await clickMenuByText(moreBtn1, zh['browse.revealLocation'])
    assert.equal(fetchCalls.length, 2)
    assert.equal(errors[errors.length - 1], '', '再次 reveal 成功前应先清空陈旧错误提示')

    await clickMenuByText(moreBtn1, zh['mapping.remove'])
    assert.deepEqual(removed, ['ast_vid'])

    // 9. 图片与视频加载失败时自动降级到居中图标托座
    await React.act(async () => {
      cards[0].querySelector('img.omnimux-assets-card-media').dispatchEvent(new window.Event('error'))
      cards[1].querySelector('video.omnimux-assets-card-video').dispatchEvent(new window.Event('error'))
    })
    assert.equal(cards[0].querySelector('img'), null)
    assert.ok(cards[0].querySelector('.omnimux-assets-card-placeholder'))
    assert.equal(cards[1].querySelector('video'), null)
    assert.ok(cards[1].querySelector('.omnimux-assets-card-placeholder'))
  } finally {
    globalThis.fetch = origFetch
    await React.act(async () => { root.unmount() })
  }
})
