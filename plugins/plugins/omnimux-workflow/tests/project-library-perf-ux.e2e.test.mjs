/**
 * E2E 回归测试：创作画布 / 项目库页加载性能与 UI 交互体验优化（Issue #326）
 *
 * 覆盖：
 * 1. 冷启动几何骨架屏（不闪现「暂无项目」），两阶段渐进加载（?covers=none -> POST /covers）；
 * 2. 单行紧凑页头（保留 .omnimux-workflow-library-action-row 契约，移除冗余副标题）+ 整页滚动与吸顶筛选栏；
 * 3. 来源筛选（首项严格为「全部」）、排序切换（最近更新 / 名称 A-Z）、搜索无匹配独立空态与「清空筛选」；
 * 4. 封面无「•••」误导徽标、音频封面单 path 优化、无双图 blur；
 * 5. 二级详情页按需延迟加载项目资产（进入创作页不触发 fetchProjectFiles）、子目录导航与无硬编码假日期。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zh } from '../src/client/locales.js'

const require = createRequire(import.meta.url)
const React = require('react')
const here = dirname(fileURLToPath(import.meta.url))

const CSS_STUB = 'export default new Proxy({}, { get: (_t, k) => (typeof k === "string" ? k : undefined) })'

const API_STUB = `
exports.listProjects = async (opts) => globalThis.__perfTestApi.listProjects(opts)
exports.fetchProjectCovers = async (ids, opts) => globalThis.__perfTestApi.fetchProjectCovers(ids, opts)
exports.getProject = async (id) => globalThis.__perfTestApi.getProject(id)
exports.renameProject = async () => ({ ok: true })
exports.deleteProject = async () => ({ ok: true })
exports.createProjectPage = async () => ({ ok: true })
exports.updateProjectPage = async () => ({ ok: true })
exports.deleteProjectPage = async () => ({ ok: true })
exports.fetchProjectFiles = async (id, subpath) => globalThis.__perfTestApi.fetchProjectFiles(id, subpath)
exports.mkdirProjectFile = async () => ({ ok: true })
exports.uploadProjectFiles = async () => ({ ok: true })
`

const API_CLIENT_STUB = `
exports.getWorkspaceAssets = async () => ({ ok: false })
exports.mkdirWorkspaceAsset = async () => ({ ok: false })
exports.ingestWorkspaceAssets = async () => ({ ok: false })
exports.pickLocalFiles = async () => ({ ok: false, body: { paths: [] } })
`

const NEW_PROJECT_STUB = `
exports.dismissProductStage = () => {}
exports.runNewProject = async () => ({ ok: true, canvasOpened: true })
`

async function loadPageModule() {
  const result = await build({
    absWorkingDir: resolve(here, '..'),
    entryPoints: [resolve(here, '../src/client/projects/ProjectLibraryPage.jsx')],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react-dom/client'],
    logLevel: 'silent',
    plugins: [{
      name: 'perf-e2e-seams',
      setup(builder) {
        builder.onLoad({ filter: /\.css$/ }, () => ({ contents: CSS_STUB, loader: 'js' }))
        builder.onResolve({ filter: /(^|\/)api\.js$/ }, () => ({ path: 'api-seam', namespace: 'seam' }))
        builder.onResolve({ filter: /bridge\/apiClient\.ts$/ }, () => ({ path: 'apiclient-seam', namespace: 'seam' }))
        builder.onResolve({ filter: /newProject\.js$/ }, () => ({ path: 'newproject-seam', namespace: 'seam' }))
        builder.onLoad({ filter: /.*/, namespace: 'seam' }, (args) => {
          if (args.path === 'api-seam') return { contents: API_STUB, loader: 'js' }
          if (args.path === 'apiclient-seam') return { contents: API_CLIENT_STUB, loader: 'js' }
          if (args.path === 'newproject-seam') return { contents: NEW_PROJECT_STUB, loader: 'js' }
          return undefined
        })
      },
    }],
  })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, mod, mod.exports)
  return mod.exports
}

async function mountLibrary(apiOverrides) {
  const { JSDOM } = require('jsdom')
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  })
  const defineGlobal = (name, value) => Object.defineProperty(globalThis, name, { value, writable: true, configurable: true })
  defineGlobal('window', dom.window)
  defineGlobal('document', dom.window.document)
  defineGlobal('navigator', dom.window.navigator)
  defineGlobal('localStorage', dom.window.localStorage)
  defineGlobal('CustomEvent', dom.window.CustomEvent)
  defineGlobal('Event', dom.window.Event)
  defineGlobal('MouseEvent', dom.window.MouseEvent)
  defineGlobal('KeyboardEvent', dom.window.KeyboardEvent)
  defineGlobal('PointerEvent', dom.window.PointerEvent || dom.window.MouseEvent)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.__perfTestApi = apiOverrides

  const { ProjectLibraryPage, resetProjectLibraryCache } = await loadPageModule()
  resetProjectLibraryCache()
  const reactDomClient = require('react-dom/client')
  const { act } = require('react')
  const container = document.getElementById('root')
  const root = reactDomClient.createRoot(container)
  const t = (key) => zh[key] || key

  await act(async () => {
    root.render(React.createElement(ProjectLibraryPage, {
      t,
      stage: { set() {} },
      store: null,
      visible: true,
      sessions: { list: { getSnapshot: () => ({ current: null, byId: {}, archivedSessionIds: [] }), subscribe: () => () => {} } },
      workspaces: { list: { getSnapshot: () => ({ items: [] }), subscribe: () => () => {} } },
      layout: { closeDetails() {} },
      betterSidebar: null,
    }))
  })

  return {
    dom,
    act,
    container,
    root,
    async teardown() {
      await act(async () => root.unmount())
      dom.window.close()
      delete globalThis.window
      delete globalThis.document
      delete globalThis.localStorage
      delete globalThis.CustomEvent
      delete globalThis.Event
      delete globalThis.MouseEvent
      delete globalThis.KeyboardEvent
      delete globalThis.PointerEvent
      delete globalThis.__perfTestApi
    },
  }
}

test('E2E: 冷启动骨架屏、两阶段封面渐进加载、紧凑顶栏、来源筛选与排序及搜索无匹配清空闭环', async () => {
  let resolveList
  let resolveCovers
  const listCalls = []
  const coverCalls = []
  const fileCalls = []

  const sampleProjects = [
    {
      id: 'p_beta',
      title: 'Beta 品牌短片',
      updatedAt: '2026-11-25T10:00:00.000Z',
      bound: true,
      workspaceDir: '/ws/brand-studio',
      path: '/ws/brand-studio',
      pages: [
        { id: 'pg_1', title: '分镜页', canvasWorkspaceId: 'ws_pg1', updatedAt: '2026-11-25T10:00:00.000Z' },
        { id: 'pg_2', title: '剪辑页', canvasWorkspaceId: 'ws_pg2' },
      ],
    },
    {
      id: 'p_alpha',
      title: 'Alpha 音频工程',
      updatedAt: '2026-11-20T08:00:00.000Z',
      bound: false,
      workspaceDir: null,
      path: '/lib/alpha',
      pages: [{ id: 'pg_a', title: '音频页', canvasWorkspaceId: 'ws_pga' }],
    },
  ]

  const page = await mountLibrary({
    listProjects: (opts) => {
      listCalls.push(opts)
      return new Promise((resolve) => { resolveList = resolve })
    },
    fetchProjectCovers: (ids) => {
      coverCalls.push(ids)
      return new Promise((resolve) => { resolveCovers = resolve })
    },
    getProject: async (id) => ({ ok: true, body: { project: sampleProjects.find((p) => p.id === id) } }),
    fetchProjectFiles: async (id, subpath) => {
      fileCalls.push({ id, subpath: subpath || '' })
      if (subpath === '素材目录') {
        return {
          ok: true,
          body: {
            currentSubpath: '素材目录',
            items: [{ id: '素材目录/intro.mp4', name: 'intro.mp4', isFolder: false, size: 2048, updatedAt: '', type: 'video' }],
          },
        }
      }
      return {
        ok: true,
        body: {
          currentSubpath: '',
          items: [
            { id: '素材目录', name: '素材目录', isFolder: true, size: 0, updatedAt: '', type: 'other' },
            { id: 'cover.png', name: 'cover.png', isFolder: false, size: 1024, updatedAt: '', type: 'image' },
          ],
        },
      }
    },
  })

  try {
    // 1. 冷启动在列表未返回前展示 12 张几何骨架卡，严禁闪现「暂无项目」
    assert.equal(listCalls[0]?.covers, 'none', '首屏必须请求 ?covers=none 快路径')
    assert.ok(page.container.querySelector('[data-loading-skeleton="true"]'), '冷启动应渲染骨架屏')
    assert.equal(page.container.querySelectorAll('.omnimux-folder-skeleton').length, 12)
    assert.equal(page.container.querySelector('.omnimux-workflow-library-empty'), null, '加载中不得闪现空态')

    // 紧凑单行页头 + 整页滚动与吸顶契约
    const rootEl = page.container.querySelector('.omnimux-workflow-library-page')
    assert.ok(rootEl.classList.contains('omx-stage-scroll'), '根节点必须挂载整页滚动类 omx-stage-scroll')
    const filterEl = page.container.querySelector('.omnimux-workflow-library-filter')
    assert.ok(filterEl.classList.contains('omx-stage-sticky'), '筛选栏必须挂载吸顶类 omx-stage-sticky')
    assert.equal(page.container.textContent.includes('管理项目工程、查看创作页面与项目资产'), false, '必须移除冗余副标题')
    assert.ok(page.container.querySelector('.omnimux-workflow-library-action-row button'), '主操作区必须保留新建项目按钮')

    // 2. Phase 1 列表快速返回 -> 立即渲染文件夹卡片，且不出现误导性的「•••」加载文本
    await page.act(async () => {
      resolveList({ ok: true, body: { projects: sampleProjects, coversIncluded: false } })
      await Promise.resolve()
    })
    assert.equal(page.container.querySelectorAll('.omnimux-folder').length, 2)
    assert.equal(page.container.textContent.includes('•••'), false, '不得再渲染误导性的 ••• 加载文本徽标')
    assert.equal(page.container.querySelectorAll('.omnimux-folder-glass-image').length, 0, '不得渲染双份模糊封面图')
    assert.equal(coverCalls.length, 1, 'Phase 1 返回后应触发 Phase 2 批量封面回填')
    assert.deepEqual(coverCalls[0], ['p_beta', 'p_alpha'])

    // 3. Phase 2 封面回填 -> 音频卡只渲染 1 条合并 <path>
    await page.act(async () => {
      resolveCovers({
        ok: true,
        body: {
          covers: {
            p_beta: { cover: { kind: 'empty' }, pages: [{ id: 'pg_1', cover: { kind: 'empty' } }] },
            p_alpha: { cover: { kind: 'audio' }, pages: [{ id: 'pg_a', cover: { kind: 'audio' } }] },
          },
        },
      })
      await Promise.resolve()
    })
    const audioPaths = page.container.querySelectorAll('.omnimux-cover-audio path')
    assert.equal(audioPaths.length, 1, '音频波形必须合并为单条 <path>')

    // 4. 排序：默认按最近更新（Beta 在前），切换「名称 A-Z」后 Alpha 在前
    const titles = () => [...page.container.querySelectorAll('.omnimux-folder-name')].map((el) => el.textContent.trim())
    assert.deepEqual(titles(), ['Beta 品牌短片', 'Alpha 音频工程'])
    const sortTrigger = page.container.querySelector('[aria-label="排序方式"]')
    assert.ok(sortTrigger, '应存在排序方式下拉')
    await page.act(async () => sortTrigger.click())
    const titleSortOpt = [...document.querySelectorAll('[role="menuitem"], [role="option"], button')].find((el) => el.textContent.trim() === '名称 A-Z')
    assert.ok(titleSortOpt, '应存在「名称 A-Z」选项')
    await page.act(async () => titleSortOpt.click())
    assert.deepEqual(titles(), ['Alpha 音频工程', 'Beta 品牌短片'])

    // 5. 来源筛选：首项必须严格为「全部」，筛选「关联工作区」只留 Beta
    const sourceTrigger = page.container.querySelector('[aria-label="项目来源"]')
    assert.ok(sourceTrigger)
    assert.equal(sourceTrigger.textContent.trim(), '全部', '来源筛选默认展示且首项必须为「全部」')
    await page.act(async () => sourceTrigger.click())
    const boundOpt = [...document.querySelectorAll('[role="menuitem"], [role="option"], button')].find((el) => el.textContent.trim() === '关联工作区')
    assert.ok(boundOpt)
    await page.act(async () => boundOpt.click())
    assert.deepEqual(titles(), ['Beta 品牌短片'])

    // 6. 搜索无匹配 -> 显示独立搜索空态而非「暂无项目」，点「清空筛选」恢复全量列表
    const searchInput = page.container.querySelector('.omnimux-workflow-library-filter input')
    await page.act(async () => {
      const setter = Object.getOwnPropertyDescriptor(page.dom.window.HTMLInputElement.prototype, 'value').set
      setter.call(searchInput, '绝对不存在的项目词')
      searchInput.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }))
    })
    const emptySearch = page.container.querySelector('[data-empty-kind="search"]')
    assert.ok(emptySearch, '搜索无匹配必须渲染独立搜索空态')
    assert.match(emptySearch.textContent, /没有匹配的项目/)
    const clearBtn = [...emptySearch.querySelectorAll('button')].find((b) => b.textContent.trim() === '清空筛选')
    assert.ok(clearBtn)
    await page.act(async () => clearBtn.click())
    assert.equal(page.container.querySelectorAll('.omnimux-folder').length, 2, '清空筛选后必须恢复全部项目')

    // 7. 二级详情页按需加载：进入项目默认看「创作页」，此时不得触发 fetchProjectFiles；且无硬编码假日期
    const betaOpen = [...page.container.querySelectorAll('.omnimux-folder-open')].find((el) => el.textContent.includes('Beta 品牌短片'))
    await page.act(async () => betaOpen.click())
    await page.act(async () => { await Promise.resolve() })
    assert.equal(fileCalls.length, 0, '停留在「创作页」时不得提前扫描项目物理文件')
    assert.equal(page.container.textContent.includes('2026.9.10'), false, '创作页不得出现硬编码假日期 2026.9.10')

    // 面包屑「项目库」必须是可键盘聚焦的真实 <button>
    const crumbBtn = page.container.querySelector('.omnimux-project-breadcrumbs button.omnimux-project-crumb-link')
    assert.ok(crumbBtn, '面包屑「项目库」必须是真实 button 元素')

    // 切换到「项目资产」才按需拉文件，且支持点击子目录继续加载，且无 2026.8.28 假日期
    const assetsTab = [...page.container.querySelectorAll('[role="tab"]')].find((el) => el.textContent.trim() === '项目资产')
    await page.act(async () => assetsTab.click())
    await page.act(async () => { await Promise.resolve() })
    assert.deepEqual(fileCalls, [{ id: 'p_beta', subpath: '' }])
    assert.equal(page.container.textContent.includes('2026.8.28'), false, '项目资产不得出现硬编码假日期 2026.8.28')

    const folderBtn = [...page.container.querySelectorAll('.omnimux-file-folder-btn')].find((el) => el.textContent.includes('素材目录'))
    assert.ok(folderBtn, '子文件夹应为可点击按钮')
    await page.act(async () => folderBtn.click())
    await page.act(async () => { await Promise.resolve() })
    assert.deepEqual(fileCalls, [
      { id: 'p_beta', subpath: '' },
      { id: 'p_beta', subpath: '素材目录' },
    ])
    assert.match(page.container.textContent, /intro\.mp4/)
  } finally {
    await page.teardown()
  }
})
