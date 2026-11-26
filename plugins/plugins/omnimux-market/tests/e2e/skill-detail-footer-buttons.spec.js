import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadClientModule } from '../helpers/client-esm-loader.mjs'

const h = (type, props, ...children) => ({
  type,
  props: props || {},
  children: children.flat(),
})

function walkAll(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const item of node) walkAll(item, predicate, out)
    return out
  }
  if (typeof node.type === 'function') {
    try {
      const expanded = node.type({ ...node.props, children: node.children })
      return walkAll(expanded, predicate, out)
    } catch (_) {}
  }
  if (predicate(node)) out.push(node)
  for (const child of node.children || []) walkAll(child, predicate, out)
  return out
}

const withClass = (tree, className) => walkAll(tree, (node) => {
  const cls = node.props && node.props.className
  return typeof cls === 'string' && cls.split(' ').includes(className)
})

test('技能详情弹窗底栏按钮布局契约：分享与安装按钮消费 leadingIcon，严禁将 svg 作为 children 导致断行 (Issue #2418)', () => {
  const ReactMock = {
    useContext: () => (k) => k,
    useState: (init) => [init, () => {}],
    useEffect: () => {},
    useRef: () => ({ current: null }),
    createContext: () => ({ Provider: 'Provider' }),
  }

  // 模拟 dsh-ui-kit 组件规范
  const ButtonMock = (props) => {
    return h('button', { ...props, className: `dshUk-Button ${props.className || ''}` },
      props.leadingIcon ? h('span', { className: 'dshUk-Button-slot' }, props.leadingIcon) : null,
      props.children ? h('span', { className: 'dshUk-Button-label' }, props.children) : null,
    )
  }

  const IconButtonMock = (props) => {
    return h('button', { ...props, className: `dshUk-Button dshUk-IconButton ${props.className || ''}` },
      h('span', { className: 'dshUk-Button-slot' }, props.children),
    )
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
        Button: ButtonMock,
        IconButton: IconButtonMock,
      },
      './portal.js': { createPortal: (node) => node, fallbackPortal: null },
      './i18n.js': {
        useTr: () => (k) => (k === 'action.install' ? '安装' : k === 'workshop.try' ? '去对话中试试' : k),
        lookup: (k) => k,
        catLabel: () => '通用',
        skillDesc: (x) => x?.description || x?.summary || '',
        skillTitle: (x) => x?.name || '',
      },
      './api.js': { api: async () => ({ ok: true }) },
      './session-create.js': { trySkillInSession: async () => ({ ok: true }) },
    },
  })
  const tree = renderDrawer({
    item: { slug: 'test-skill', name: '测试技能', summary: '测试摘要' },
    onClose: () => {},
  })

  assert.ok(tree, 'Drawer 必须正常渲染')

  // 1. 验证底栏操作栏 ws-footer-actions 存在
  const footerActions = withClass(tree, 'ws-footer-actions')
  assert.equal(footerActions.length, 1, '应有且仅有 1 个 ws-footer-actions 容器')

  // 2. 验证分享按钮
  const shareBtns = withClass(tree, 'ws-footer-share-btn')
  assert.equal(shareBtns.length, 1, '应存在 1 个 ws-footer-share-btn')
  const shareBtn = shareBtns[0]
  const shareSlots = withClass(shareBtn, 'dshUk-Button-slot')
  const shareLabels = withClass(shareBtn, 'dshUk-Button-label')
  assert.equal(shareSlots.length, 1, '分享按钮必须具备独立图标 slot')
  assert.equal(shareLabels.length, 1, '分享按钮必须具备独立文本 label')
  assert.equal(shareSlots[0].children[0].type, 'svg', 'slot 内部必须为 svg 图标')
  assert.deepEqual(shareLabels[0].children, ['分享'], 'label 内部只能为纯文案，严禁混入 svg 触发宿主断行')

  // 3. 验证安装按钮
  const installBtns = withClass(tree, 'ws-footer-install-btn')
  assert.equal(installBtns.length, 1, '应存在 1 个 ws-footer-install-btn')
  const installBtn = installBtns[0]
  const installSlots = withClass(installBtn, 'dshUk-Button-slot')
  const installLabels = withClass(installBtn, 'dshUk-Button-label')
  assert.equal(installSlots.length, 1, '安装按钮必须具备独立图标 slot')
  assert.equal(installLabels.length, 1, '安装按钮必须具备独立文本 label')
  assert.equal(installSlots[0].children[0].type, 'svg', 'slot 内部必须为 svg 图标')
  assert.deepEqual(installLabels[0].children, ['安装'], 'label 内部只能为纯文案，严禁混入 svg 触发宿主断行')

  // 4. 验证更多按钮
  const moreBtns = withClass(tree, 'ws-footer-more-btn')
  assert.equal(moreBtns.length, 1, '应存在 1 个 ws-footer-more-btn 纯图标按钮')
  assert.equal(moreBtns[0].props['aria-label'], '更多操作', '更多按钮必须具备明确的无障碍名称')
})

test('样式表加固断言：包含底栏防挤压与防折行防御规则 (Issue #2418)', () => {
  const cssSource = readFileSync(new URL('../../src/client/css.js', import.meta.url), 'utf8')

  assert.ok(cssSource.includes('.ws-footer-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}'), 'ws-footer-actions 必须具备 flex-shrink:0')
  assert.ok(cssSource.includes('.ws-footer-btn{display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;flex-shrink:0}'), 'ws-footer-btn 必须保持水平不折行与防挤压')
  assert.ok(cssSource.includes('.ws-footer-actions .dshUk-Button-label{display:inline;white-space:nowrap}'), '按钮标签必须显式声明 white-space:nowrap 防折行')
})

test('DetailCard 从 handleSkillDetail({ card }) 水合 preinstalled 与 installed 状态，并隐藏卸载入口 (#350)', async () => {
  const stateSlots = new Map()
  let hookIdx = 0
  const effects = []
  const ReactMock = {
    useContext: () => (k) => k,
    useState: (init) => {
      const idx = hookIdx++
      if (!stateSlots.has(idx)) stateSlots.set(idx, init)
      const setter = (next) => {
        const cur = stateSlots.get(idx)
        stateSlots.set(idx, typeof next === 'function' ? next(cur) : next)
      }
      return [stateSlots.get(idx), setter]
    },
    useEffect: (fn) => { effects.push(fn) },
    useRef: () => ({ current: null }),
    createContext: () => ({ Provider: 'Provider' }),
  }
  const ButtonMock = (props) => h('button', { ...props, className: `dshUk-Button ${props.className || ''}` },
    props.leadingIcon ? h('span', { className: 'dshUk-Button-slot' }, props.leadingIcon) : null,
    props.children ? h('span', { className: 'dshUk-Button-label' }, props.children) : null,
  )
  const IconButtonMock = (props) => h('button', { ...props, className: `dshUk-Button dshUk-IconButton ${props.className || ''}` },
    h('span', { className: 'dshUk-Button-slot' }, props.children),
  )

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
        Button: ButtonMock,
        IconButton: IconButtonMock,
      },
      './portal.js': { createPortal: (node) => node, fallbackPortal: null },
      './i18n.js': {
        useTr: () => (k) => (k === 'action.install' ? '安装' : k === 'workshop.try' ? '去对话中试试' : k),
        lookup: (k) => k,
        catLabel: () => '剪辑与效率工具',
        skillDesc: (x) => x?.description || x?.summary || '',
        skillTitle: (x) => x?.name || '',
      },
      './api.js': {
        api: async (method) => {
          if (method === 'detail') {
            return {
              ok: true,
              card: { slug: 'clip-craft', installed: true, preinstalled: true, description: 'Hydrated plugin detail' },
            }
          }
          if (method === 'skillContent') {
            return { ok: true, found: true, tree: [{ name: 'SKILL.md', isDir: false }], skillMd: '---\nname: clip-craft\n---\n# Clip Craft' }
          }
          return { ok: true }
        },
      },
      './session-create.js': { trySkillInSession: async () => ({ ok: true }) },
    },
  })

  const expandNode = (node) => {
    if (!node || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map(expandNode)
    if (typeof node.type === 'function') {
      return expandNode(node.type({ ...node.props, children: node.children }))
    }
    return {
      ...node,
      children: (node.children || []).map(expandNode),
    }
  }

  const findInExpanded = (node, className, out = []) => {
    if (!node || typeof node !== 'object') return out
    if (Array.isArray(node)) {
      for (const item of node) findInExpanded(item, className, out)
      return out
    }
    const cls = node.props && node.props.className
    if (typeof cls === 'string' && cls.split(' ').includes(className)) out.push(node)
    for (const child of node.children || []) findInExpanded(child, className, out)
    return out
  }

  const renderPass = () => {
    hookIdx = 0
    effects.length = 0
    return expandNode(renderDrawer({
      item: { slug: 'clip-craft', name: '智能视频剪辑', installed: false },
      onClose: () => {},
    }))
  }

  renderPass()
  for (const fn of effects) fn()
  await new Promise((resolve) => setTimeout(resolve, 10))

  const hydratedTree = renderPass()
  const installBtns = findInExpanded(hydratedTree, 'ws-footer-install-btn')
  assert.equal(installBtns.length, 1)
  assert.deepEqual(findInExpanded(installBtns[0], 'dshUk-Button-label')[0].children, ['去对话中试试'])

  const statusText = JSON.stringify(findInExpanded(hydratedTree, 'ws-footer-status')[0])
  assert.ok(statusText.includes('已启用'), 'DetailCard hydrated from d.card.installed should show 已启用')

  // Open more-menu and re-render to assert preinstalled hides 卸载技能
  findInExpanded(hydratedTree, 'ws-footer-more-btn')[0].props.onClick()
  const menuTree = renderPass()
  const menuItems = findInExpanded(menuTree, 'ws-more-item').flatMap((n) => n.children || [])
  assert.ok(menuItems.includes('复制标识'))
  assert.equal(menuItems.includes('卸载技能'), false, 'preinstalled plugin skill must not offer 卸载技能')
})
