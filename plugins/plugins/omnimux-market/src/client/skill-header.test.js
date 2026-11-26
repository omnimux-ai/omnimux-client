import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as SkillShelf from './skill-picker-logic.js'
import { loadClientModule } from '../../tests/helpers/client-esm-loader.mjs'

const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) })
const walk = (node, predicate) => {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const child of node.children || []) {
    const result = walk(child, predicate)
    if (result) return result
  }
  return null
}

function renderWorkshop() {
  const calls = []
  const stateWrites = []
  let index = 0
  const { SkillPlaza: render } = loadClientModule('./skill-plaza.js', {
    modules: {
      './boot.js': {
        h,
        SkillShelf,
        useState: (initial) => { const key = index++; return [initial, (value) => stateWrites.push([key, value])] },
        useCallback: (fn) => fn,
        useEffect: () => {},
        useRef: (init) => ({ current: init }),
        Button: 'Button',
        SearchField: undefined,
        Tabs: undefined,
      },
      './skills-ui.js': { Drawer: 'Drawer', Overlay: 'Overlay' },
      './api.js': { api: async () => ({}), apiCache: new Map(), apiCacheKey: (a, p) => JSON.stringify([a, p]), API_CACHE_TTL_MS: 1000 },
      './session-create.js': { createSkillSession: (options) => calls.push(options) },
      './plugins-column.js': { PluginsColumnTab: 'PluginsColumnTab' },
      './runtime-state.js': { marketRuntime: { plazaSessions: null, plazaWorkspaces: null } },
      './i18n.js': { useTr: () => (key) => key, lookup: (key) => key },
    },
  })
  return { tree: render({}), calls, stateWrites }
}

test('create action delegates only slash prefill to existing session helper', () => {
  const { tree, calls } = renderWorkshop()
  const button = walk(tree, (node) => node.props.className === 'btn-create')
  button.props.onClick()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].text, '/skill-creator')
})

test('install action opens existing modal and category row precedes content', () => {
  const { tree, stateWrites } = renderWorkshop()
  walk(tree, (node) => node.props.className === 'btn-install').props.onClick()
  assert.ok(stateWrites.some(([, value]) => value === true))
  const categories = walk(tree, (node) => node.props.className === 'category-bar')
  const categoryButtons = categories.children.filter((node) => node.type === 'button')
  assert.equal(categoryButtons.length, 7)
  // 按场景分类：「场景分类」标签 +「全部」+ 6 个活跃场景，顺序由 SKILL_SCENARIOS 固定。
  assert.deepEqual(
    categoryButtons.slice(0, 5).map((node) => node.props.key),
    ['', 'scene-seeding', 'scene-brand', 'scene-product', 'scene-performance'],
  )
  // 骨架契约 §二·补：标题/动作行随页面滚走，一级/二级 Tab 行吸附在顶部。
  assert.equal(tree.children[0].props.className, 'workshop-intro')
  const sticky = tree.children[1]
  assert.equal(sticky.props.className, 'omx-stage-sticky')
  assert.equal(sticky.children[0].props.className, 'nav-bar')
  assert.equal(sticky.children[1].props.className, 'category-bar')
})

test('failed installation retains dialog and reports error without installed callback', async () => {
  const writes = []
  let state = 0
  let installed = false
  let closed = false
  const { InstallModal: render } = loadClientModule('./skill-plaza.js', {
    modules: {
      './boot.js': {
        h,
        SkillShelf,
        useState: (value) => [state++ === 0 ? { name: 'example.zip' } : value, (next) => writes.push(next)],
        useRef: () => ({ current: null }),
        useCallback: (fn) => fn,
        useEffect: () => {},
      },
      './skills-ui.js': { Drawer: 'Drawer', Overlay: 'Overlay' },
      './api.js': { api: async () => { throw new Error('installation-rejected') }, apiCache: new Map(), apiCacheKey: () => '', API_CACHE_TTL_MS: 1000 },
      './session-create.js': { createSkillSession: () => {} },
      './plugins-column.js': { PluginsColumnTab: 'PluginsColumnTab' },
      './runtime-state.js': { marketRuntime: { plazaSessions: null, plazaWorkspaces: null } },
      './i18n.js': { useTr: () => (key) => key, lookup: (key) => key },
    },
  })
  const tree = render({ open: true, onClose: () => { closed = true }, onInstalled: () => { installed = true } })
  await walk(tree, (node) => node.props.className?.startsWith('btn-modal-install')).props.onClick()
  assert.equal(installed, false)
  assert.equal(closed, false)
  assert.ok(writes.includes('installation-rejected'))
})

test('Drawer safely renders with Overlay defined in skills-ui', () => {
  const ReactMock = {
    useContext: () => (k) => k,
    useState: (init) => [init, () => {}],
    useEffect: () => {},
    useRef: () => ({ current: null }),
    createContext: () => ({ Provider: 'Provider' }),
  }
  const { Drawer: renderDrawer } = loadClientModule('./skills-ui.js', {
    globals: {
      document: { body: { style: {} } },
      window: { addEventListener: () => {}, removeEventListener: () => {} },
    },
    modules: {
      './boot.js': {
        h,
        React: ReactMock,
        useState: ReactMock.useState,
        useEffect: ReactMock.useEffect,
        Button: 'Button',
        IconButton: 'IconButton',
      },
      './portal.js': { createPortal: (node) => node, fallbackPortal: null },
      './i18n.js': { useTr: () => (k) => k, lookup: (k) => k, catLabel: () => '通用', skillDesc: (x) => x?.description || '', skillTitle: (x) => x?.name || '' },
      './api.js': { api: async () => ({ ok: true }) },
      './session-create.js': { trySkillInSession: async () => ({ ok: true }) },
    },
  })
  const node = renderDrawer({ item: { slug: 'test-skill', name: '测试技能' }, onClose: () => {} })
  assert.ok(node)
  assert.equal(node.type.name, 'Overlay')
})
