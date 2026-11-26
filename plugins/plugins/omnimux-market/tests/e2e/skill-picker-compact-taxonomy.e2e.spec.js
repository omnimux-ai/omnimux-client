/**
 * @file plugins/omnimux-market/tests/e2e/skill-picker-compact-taxonomy.e2e.spec.js
 * E2E 契约（Issue #337）：
 *  1. 真实 Chromium（360px 最小宽与 380px 默认宽 + 宿主默认盒模型）下，全部 + 4 个业务分类 Tab 零横向溢出；
 *  2. 经真实 i18n.js（ZH）解析后的全量 33 项技能标题与单行描述均完整显示、零省略截断（scrollWidth <= clientWidth）；
 *  3. 真实 SkillPickerPanel 组件在 Tab 未溢出（含滞回区间）时隐藏 .sh-picker-more 箭头、溢出时显示，且正确清理 ResizeObserver；
 *  4. 旧术语（VOC、单元经济、CR10、社媒聆听、反推）通过 aliases 仍可检索命中新技能。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as SkillShelf from '../../src/client/skill-picker-logic.js'
import { loadClientModule } from '../helpers/client-esm-loader.mjs'
import { runStyleDomProbe } from '../../../../scripts/test-fixtures/style-dom-probe.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const marketRoot = join(here, '../..')
const cssSource = readFileSync(join(marketRoot, 'src/client/css.js'), 'utf8')
const cssMatch = /const CSS = `([\s\S]*?)`;/.exec(cssSource)
assert.ok(cssMatch, '市场样式源必须包含 CSS 模板')

function loadRealZhLookup() {
  const { lookup } = loadClientModule('./i18n.js', {
    globals: {
      navigator: { language: 'zh-CN' },
      document: { documentElement: { lang: 'zh-CN' } },
      localStorage: { getItem: () => null },
    },
    modules: {
      './boot.js': {
        React: { createContext: () => ({ Provider: 'Provider' }), useContext: () => null },
        h: () => null,
      },
    },
  })
  return lookup
}

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function mountPanelHarness(presetBinding, tabsDomMetrics, { realLookup } = {}) {
  const slots = []
  const effects = []
  const timers = new Map()
  const observers = []
  let cursor = 0
  let dirty = false
  let timerId = 0
  let tree = null
  const h = (type, props, ...children) => ({
    type,
    props: props || {},
    children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false),
  })
  const findNodes = (node, predicate) => {
    if (!node || typeof node !== 'object') return []
    return [...(predicate(node) ? [node] : []), ...(node.children || []).flatMap((child) => findNodes(child, predicate))]
  }
  const effect = (fn, deps) => {
    const index = cursor++
    const previous = slots[index]
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      slots[index] = { deps, cleanup: previous?.cleanup }
      effects.push(() => {
        slots[index].cleanup?.()
        slots[index].cleanup = fn()
      })
    }
  }
  class FakeResizeObserver {
    constructor(cb) {
      this.cb = cb
      this.observed = []
      this.disconnected = false
      observers.push(this)
    }
    observe(target) {
      this.observed.push(target)
    }
    disconnect() {
      this.disconnected = true
    }
  }
  const globals = {
    window: {
      addEventListener() {},
      removeEventListener() {},
      getComputedStyle: () => ({ paddingLeft: '8px', paddingRight: '8px' }),
    },
    document: { addEventListener() {}, removeEventListener() {} },
    ResizeObserver: FakeResizeObserver,
    setTimeout(fn) {
      const id = ++timerId
      timers.set(id, fn)
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
  }
  const lookupFn = realLookup || ((key) => (key === 'picker.tab.all' ? '全部' : key))
  const modules = {
    './boot.js': {
      h,
      SkillShelf,
      SearchField: 'SearchField',
      useState(initial) {
        const index = cursor++
        if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
        return [
          slots[index],
          (value) => {
            const next = typeof value === 'function' ? value(slots[index]) : value
            if (!Object.is(next, slots[index])) {
              slots[index] = next
              dirty = true
            }
          },
        ]
      },
      useRef(initial) {
        const index = cursor++
        return (slots[index] ||= { current: initial })
      },
      useEffect: effect,
      useLayoutEffect: effect,
      useCallback: (fn) => fn,
    },
    './api.js': { api: async () => ({ items: [] }) },
    './i18n.js': {
      I18nProvider: 'I18nProvider',
      lookup: lookupFn,
    },
    './portal.js': { createPortal: (node) => node },
    './session-create.js': {
      activateSharedToolSkill: () => {},
      createSkillSession: async () => ({ ok: true }),
      currentPlazaSessionId: () => '',
      skillCreationInputs: new Map(),
    },
    './runtime-state.js': { marketRuntime: { plazaSessions: null } },
  }
  const { SkillPickerPanel: renderPanel } = loadClientModule('./skill-picker.js', { globals, modules })
  let currentProps = { open: true, anchorRef: { current: null }, presetBinding, onClose() {}, onPick: () => true }

  const bindTabsRef = () => {
    const tablist = findNodes(tree, (node) => node.props.role === 'tablist')[0]
    if (tablist && tablist.props.ref && tabsDomMetrics) {
      tablist.props.ref.current = tabsDomMetrics
    }
  }

  const render = () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      cursor = 0
      dirty = false
      tree = renderPanel(currentProps)
      bindTabsRef()
      effects.splice(0).forEach((fn) => fn())
      if (!dirty) return
    }
    throw new Error('panel did not settle')
  }
  render()

  return {
    observers,
    rerenderWithFreshBinding(nextBinding) {
      currentProps = { ...currentProps, presetBinding: nextBinding }
      render()
    },
    hasMoreButton() {
      return findNodes(tree, (node) => node.props.className === 'sh-picker-more').length > 0
    },
    tabLabels() {
      return findNodes(tree, (node) => node.props.role === 'tab').map((node) => node.children.join(''))
    },
    search(query) {
      findNodes(tree, (node) => node.type === 'SearchField')[0].props.onValueChange(query)
      render()
      const pending = [...timers.values()]
      timers.clear()
      pending.forEach((fn) => fn())
      render()
    },
    names() {
      return findNodes(tree, (node) => node.props.className === 'sh-picker-name').map((node) => node.children.join(''))
    },
    descs() {
      return findNodes(tree, (node) => node.props.className === 'sh-picker-desc').map((node) => node.children.join(''))
    },
    dispose() {
      for (const value of slots) value?.cleanup?.()
      timers.clear()
    },
  }
}

test('E2E 真实浏览器几何：360px/380px 技能面板 4 分类 Tab 零溢出且经真实 i18n 解析的 33 项技能零省略截断', () => {
  const zhLookup = loadRealZhLookup()
  const binding = SkillShelf.getPresetSkillBinding('omni-agent')
  assert.ok(binding, 'omni-agent 预设必须存在')
  assert.deepEqual(
    binding.categories.map((c) => c.id),
    ['创作视频', '创作图片', '分析洞察', '文案运营'],
  )
  assert.equal(binding.skills.length, 33)

  const tabsHtml = binding.tabs
    .map((tab, idx) => {
      const label = (tab.labelKey && zhLookup(tab.labelKey)) || tab.name || tab.id
      return `<button type="button" role="tab" class="sh-picker-tab${idx === 0 ? ' on' : ''}">${escapeHtml(label)}</button>`
    })
    .join('')
  const rowsHtml = binding.skills
    .map((item, idx) => {
      const resolvedName = SkillShelf.skillTitle(item, zhLookup)
      const resolvedDesc = SkillShelf.skillDesc(item, zhLookup)
      return `
      <button type="button" role="option" class="sh-picker-row${idx === 0 ? ' on' : ''}">
        <div class="sh-picker-row-main">
          <div class="sh-picker-row-top"><span class="sh-picker-name">${escapeHtml(resolvedName)}</span></div>
          <div class="sh-picker-desc">${escapeHtml(resolvedDesc)}</div>
        </div>
      </button>`
    })
    .join('')
  const overflowTabsHtml = ['全部', '创作视频', '创作图片', '选品与需求', '趋势与达人复盘', '文案与运营']
    .map((label, idx) => `<button type="button" role="tab" class="sh-picker-tab${idx === 0 ? ' on' : ''}">${escapeHtml(label)}</button>`)
    .join('')

  const result = runStyleDomProbe({
    name: 'skill-picker-compact-taxonomy',
    viewportHeight: 1600,
    styles: `
      :where(.omnimux-no-reset,.omnimux-no-reset *){box-sizing:content-box}
      body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;font-size:13px}
      ${cssMatch[1]}
      .probe-picker{position:static !important;margin-bottom:16px}
      .probe-picker.w380{width:380px}
      .probe-picker.w360{width:360px}
      .probe-picker .sh-picker-list{max-height:360px;overflow-y:scroll}
    `,
    html: `
      <div class="omnimux-no-reset">
        <div id="compact380" class="sh-picker probe-picker w380">
          <div class="sh-picker-cats">
            <div class="sh-picker-tabs" role="tablist">${tabsHtml}</div>
          </div>
          <div class="sh-picker-list" role="listbox">${rowsHtml}</div>
        </div>
        <div id="compact360" class="sh-picker probe-picker w360">
          <div class="sh-picker-cats">
            <div class="sh-picker-tabs" role="tablist">${tabsHtml}</div>
          </div>
          <div class="sh-picker-list" role="listbox">${rowsHtml}</div>
        </div>
        <div id="overflowCase" class="sh-picker probe-picker w380">
          <div class="sh-picker-cats">
            <div class="sh-picker-tabs" role="tablist">${overflowTabsHtml}</div>
          </div>
        </div>
      </div>`,
    measure: () => {
      const inspect = (rootSel) => {
        const tabs = document.querySelector(`${rootSel} .sh-picker-tabs`)
        const cs = getComputedStyle(tabs.parentElement)
        const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
        const avail = Math.max(tabs.clientWidth, tabs.parentElement.clientWidth - padX)
        const truncatedNames = [...document.querySelectorAll(`${rootSel} .sh-picker-name`)]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => ({ text: el.textContent, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
        const truncatedDescs = [...document.querySelectorAll(`${rootSel} .sh-picker-desc`)]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => ({ text: el.textContent, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
        return {
          tabsScrollWidth: tabs.scrollWidth,
          tabsAvail: avail,
          tabsOverflow: tabs.scrollWidth > avail + 1,
          rowCount: document.querySelectorAll(`${rootSel} .sh-picker-row`).length,
          truncatedNames,
          truncatedDescs,
        }
      }
      return {
        w380: inspect('#compact380'),
        w360: inspect('#compact360'),
        overflow: inspect('#overflowCase'),
      }
    },
  })

  for (const [label, metrics] of [['380px', result.w380], ['360px', result.w360]]) {
    assert.equal(metrics.rowCount, 33, `${label} 应完整渲染 33 项技能`)
    assert.equal(
      metrics.tabsOverflow,
      false,
      `${label} 下 4 分类 Tab 不应溢出（scroll=${metrics.tabsScrollWidth}, avail=${metrics.tabsAvail}）`,
    )
    assert.deepEqual(metrics.truncatedNames, [], `${label} 下所有 33 项技能标题不得截断`)
    assert.deepEqual(metrics.truncatedDescs, [], `${label} 下所有 33 项技能描述不得省略截断`)
  }
  assert.equal(
    result.overflow.tabsOverflow,
    true,
    `对照组 5 分类长标签应检测到溢出（scroll=${result.overflow.tabsScrollWidth}, avail=${result.overflow.tabsAvail}）`,
  )
})

test('E2E 真实面板组件：未溢出/滞回区隐藏箭头、溢出时显示、稳定依赖不重复重建 Observer 且支持旧词检索', () => {
  const zhLookup = loadRealZhLookup()
  const binding = SkillShelf.getPresetSkillBinding('omni-agent')
  assert.ok(binding)

  // 1. 正常未溢出态（scrollWidth === clientWidth === 362）
  const compactPanel = mountPanelHarness(
    binding,
    { scrollWidth: 362, clientWidth: 362, parentElement: { clientWidth: 378 } },
    { realLookup: zhLookup },
  )
  try {
    assert.deepEqual(compactPanel.tabLabels(), ['全部', '创作视频', '创作图片', '分析洞察', '文案运营'])
    assert.equal(compactPanel.hasMoreButton(), false, 'Tab 未溢出时不得渲染右侧滚动箭头')
    assert.equal(compactPanel.observers.length, 1, '首次打开应只创建 1 个 ResizeObserver')

    // 用新数组引用重渲染（模拟输入框每次按键重建 presetBinding），不得重复重建 ResizeObserver
    compactPanel.rerenderWithFreshBinding({ ...binding, tabs: binding.tabs.map((t) => ({ ...t })) })
    assert.equal(compactPanel.observers.length, 1, '同等标签序列重渲染不得触发 ResizeObserver 反复重建')

    // 真实 i18n 覆写键（replicate-viral-video / video-hook-analysis）也必须是精简后的短描述
    const descs = compactPanel.descs()
    assert.ok(descs.includes('参考爆款视频结构，生成同款商品带货视频'))
    assert.ok(descs.includes('提取字幕与脚本，拆解钩子、卖点和分镜'))

    const legacyQueries = [
      ['VOC', '分析商品评论'],
      ['单元经济', '测算定价利润'],
      ['CR10', '分析类目市场'],
      ['社媒聆听', '分析品牌口碑'],
      ['反推', '视频转提示词'],
    ]
    for (const [query, expectedName] of legacyQueries) {
      compactPanel.search(query)
      assert.ok(
        compactPanel.names().includes(expectedName),
        `搜索旧词 "${query}" 必须命中重命名后的 "${expectedName}"，实际：${compactPanel.names().join(', ')}`,
      )
    }
  } finally {
    compactPanel.dispose()
  }
  assert.equal(compactPanel.observers[0].disconnected, true, '组件卸载时必须断开 ResizeObserver')

  // 2. 滞回区间（330 < scrollWidth=350 <= parentAvail=362）：按钮隐藏后刚好放下，不应振荡显示箭头
  const hysteresisPanel = mountPanelHarness(
    binding,
    { scrollWidth: 350, clientWidth: 330, parentElement: { clientWidth: 378 } },
    { realLookup: zhLookup },
  )
  try {
    assert.equal(hysteresisPanel.hasMoreButton(), false, '总宽 <= 父容器可用宽（362px）时不应显示箭头')
  } finally {
    hysteresisPanel.dispose()
  }

  // 3. 真实溢出态（scrollWidth=464 > parentAvail=362）
  const overflowingPanel = mountPanelHarness(
    binding,
    { scrollWidth: 464, clientWidth: 330, parentElement: { clientWidth: 378 } },
    { realLookup: zhLookup },
  )
  try {
    assert.equal(overflowingPanel.hasMoreButton(), true, 'Tab 实际溢出时必须渲染右侧滚动箭头')
  } finally {
    overflowingPanel.dispose()
  }
})
