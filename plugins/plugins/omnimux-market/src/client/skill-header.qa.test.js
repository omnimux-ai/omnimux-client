import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { listInstalled } from '../../lib/install.js'
import * as SkillShelf from './skill-picker-logic.js'
import { loadClientModule } from '../../tests/helpers/client-esm-loader.mjs'

const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) })
function nodes(node, predicate) {
  if (!node || typeof node !== 'object') return []
  return [...(predicate(node) ? [node] : []), ...(node.children || []).flatMap(child => nodes(child, predicate))]
}
function loadPlaza(bootOverrides = {}, extraModules = {}) {
  return loadClientModule('./skill-plaza.js', {
    modules: {
      './boot.js': {
        h,
        SkillShelf,
        Button: 'Button',
        useCallback: fn => fn,
        useEffect: () => {},
        useState: value => [value, () => {}],
        useRef: () => ({ current: null }),
        ...bootOverrides,
      },
      './skills-ui.js': { Drawer: 'Drawer', Overlay: 'Overlay' },
      './api.js': { api: async () => ({}), apiCache: new Map(), apiCacheKey: (a, p) => JSON.stringify([a, p]), API_CACHE_TTL_MS: 1000 },
      './session-create.js': { createSkillSession: () => {} },
      './plugins-column.js': { PluginsColumnTab: 'PluginsColumnTab' },
      './runtime-state.js': { marketRuntime: { plazaSessions: null, plazaWorkspaces: null } },
      './i18n.js': { useTr: () => key => key, lookup: key => key },
      ...extraModules,
    },
  })
}
function workshop(initial = {}, api = async () => ({})) {
  const state = new Map(Object.entries(initial).map(([key, value]) => [Number(key), value]))
  let cursor = 0
  const { SkillPlaza: render } = loadPlaza({
    useState: value => {
      const index = cursor++
      if (!state.has(index)) state.set(index, value)
      return [state.get(index), next => state.set(index, typeof next === 'function' ? next(state.get(index)) : next)]
    },
  }, {
    './api.js': { api, apiCache: new Map(), apiCacheKey: (a, p) => JSON.stringify([a, p]), API_CACHE_TTL_MS: 1000 },
  })
  return { state, render: () => { cursor = 0; return render({}) } }
}

test('QA: closed/open/closed installation modal retains identical hook sequence', () => {
  let hooks = []
  const { InstallModal: render } = loadPlaza({
    useState: value => { hooks.push('state'); return [value, () => {}] },
    useRef: () => { hooks.push('ref'); return { current: null } },
  })
  for (const open of [false, true, false]) {
    hooks = []
    render({ open, onClose() {} })
    assert.deepEqual(hooks, ['state', 'state', 'state', 'ref'])
  }
})

test('QA: category-bar is removed in My Skills; discover tab keeps category-bar', () => {
  const ui = workshop({ 0: 'mine', 3: 'video', 10: [
    { slug: 'ad', name: 'video ad', tags: ['商业广告'] },
    { slug: 'music', name: 'video music', tags: ['音频音乐'] },
  ] })
  // 验收标准：在我的 Skill (mine) 标签页下，彻底移除 category-bar 胶囊栏
  assert.equal(nodes(ui.render(), n => n.props.className === 'category-bar').length, 0)
  assert.ok(nodes(ui.render(), n => n.type?.name === 'MineToolbar').length >= 1, 'mine tab must render MineToolbar')

  // 切换到 discover 发现页，category-bar 正常呈现
  nodes(ui.render(), n => n.type === 'button' && n.props.className?.startsWith('nav-tab'))[0].props.onClick()
  const category = nodes(ui.render(), n => n.props.className === 'category-bar')[0]
  assert.ok(category, 'discover tab must render category-bar')
  assert.ok(category.children.length > 0)
})

test('QA: featured My Skills retains a recommended skill returned by real listInstalled', async () => {
  const catalog = JSON.parse(readFileSync(new URL('../../catalog/index.json', import.meta.url), 'utf8'))
  const installed = await listInstalled(new URL('../../catalog/skills', import.meta.url).pathname)
  const clip = installed.find(item => item.slug === 'replicate-carousel')
  assert.ok(clip, 'bundled installed-shape fixture exists')
  assert.equal(catalog.items.find(item => item.skill === clip.slug).recommended, true)
  const ui = workshop({ 0: 'mine', 1: 'featured', 10: [{ ...clip, installed: true, enabled: true }] })
  assert.equal(nodes(ui.render(), n => n.props.className === 'regular-card').length, 1,
    'recommended installed skill must not disappear solely because list API omits catalog flags')
})

test('QA: rejected confirm install must not mark a skill installed or close confirmation', async () => {
  const item = { slug: 'qa-unavailable-skill', id: 'qa-item', name: 'QA skill', installed: false }
  const ui = workshop({ 9: [item], 18: item }, async () => { throw new Error('install-rejected') })
  const confirm = nodes(ui.render(), n => n.type?.name === 'ConfirmInstallModal')[0]
  confirm.props.onConfirm()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(ui.state.get(9)[0].installed, false, 'rejected install must not claim success')
  assert.equal(ui.state.get(10).length, 0)
  assert.equal(ui.state.get(18), item)
})

test('regression: installed featured identity survives tab/category reentry and rejects unknown flags', () => {
  const clip = { slug: 'replicate-carousel', name: 'Replicate Carousel', installed: true }
  const unknown = { slug: 'not-in-catalog', name: 'Unknown', recommended: true, tags: ['精选'] }
  // 从 discover 发现页开始
  const ui = workshop({ 0: 'discover', 1: 'featured', 10: [clip, unknown] })
  const categories = () => nodes(ui.render(), n => n.props.className === 'category-bar')[0]
  assert.ok(categories(), 'discover tab renders category-bar')

  // 切换为全部分类
  categories().children.find(n => n.props.key === '').props.onClick()

  // 切换到我的 Skill (mine)
  nodes(ui.render(), n => n.type === 'button' && (n.props.role === 'tab' || n.props.className?.startsWith('nav-tab')))[1].props.onClick()
  const cards = () => nodes(ui.render(), n => n.props.className === 'regular-card')
  assert.equal(cards().length, 2)
  assert.equal(nodes(ui.render(), n => n.props.className === 'category-bar').length, 0)

  // 切回 discover 发现页并切到全部（featured 页签已随 013fcb898 收敛移除）
  nodes(ui.render(), n => n.type === 'button' && (n.props.role === 'tab' || n.props.className?.startsWith('nav-tab')))[0].props.onClick()
  categories().children.find(n => n.props.key === '').props.onClick()

  // 再次切回 mine：伪造 recommended 标记的未知条目仍不得混入
  nodes(ui.render(), n => n.type === 'button' && (n.props.role === 'tab' || n.props.className?.startsWith('nav-tab')))[1].props.onClick()
  assert.equal(cards().length, 2)
  assert.equal(SkillShelf.isRecommendedInstalledSkill(clip), true)
  assert.equal(SkillShelf.isRecommendedInstalledSkill(unknown), false)
  assert.equal(SkillShelf.isRecommendedInstalledSkill({}), false)

  ui.state.set(10, [{ ...clip }]) // list refresh still has no recommendation flags
  assert.equal(cards().length, 1)
})

test('regression: confirm installation exposes error, clears it on retry, and only marks success', async () => {
  const item = { slug: 'retry-skill', id: 'retry-id', installed: false }
  let calls = 0
  let succeed
  const ui = workshop({ 9: [item], 18: item }, async () => {
    if (++calls === 1) throw new Error('install-rejected')
    await new Promise(resolve => { succeed = resolve })
  })
  const modal = () => nodes(ui.render(), n => n.type?.name === 'ConfirmInstallModal')[0]
  await modal().props.onConfirm()
  assert.equal(modal().props.error, 'install-rejected')
  assert.equal(modal().props.installing, false)
  const { ConfirmInstallModal: renderModal } = loadPlaza()
  assert.equal(nodes(renderModal(modal().props), n => n.props.role === 'alert')[0].children[0], 'install-rejected')
  const pending = modal().props.onConfirm()
  assert.equal(modal().props.error, '')
  assert.equal(modal().props.installing, true)
  assert.ok(nodes(renderModal(modal().props), n => n.type === 'Button').every(n => n.props.disabled))
  await modal().props.onConfirm()
  modal().props.onClose()
  assert.equal(calls, 2)
  assert.equal(ui.state.get(18), item)
  assert.equal(ui.state.get(9)[0].installed, false)
  succeed()
  await pending
  assert.equal(ui.state.get(9)[0].installed, true)
  assert.equal(ui.state.get(10).length, 1)
  assert.equal(ui.state.get(18), null)
  assert.equal(modal().props.installing, false)
})
