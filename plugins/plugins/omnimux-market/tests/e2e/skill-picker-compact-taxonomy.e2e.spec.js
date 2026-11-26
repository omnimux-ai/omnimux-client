/**
 * @file plugins/omnimux-market/tests/e2e/skill-picker-compact-taxonomy.e2e.spec.js
 * E2E 契约（Issue #337）：
 *  1. 真实 Chromium（380px + 宿主默认盒模型）下，全部 + 4 个业务分类 Tab 零横向溢出；
 *  2. 全量 33 项技能的标题与单行描述均完整显示、零省略截断（scrollWidth <= clientWidth）；
 *  3. 真实 SkillPickerPanel 组件在 Tab 未溢出时隐藏 .sh-picker-more 箭头，溢出时显示；
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

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function mountPanelHarness(presetBinding, tabsDomMetrics) {
  const slots = []
  const effects = []
  const timers = new Map()
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
  const globals = {
    window: { addEventListener() {}, removeEventListener() {} },
    document: { addEventListener() {}, removeEventListener() {} },
    setTimeout(fn) {
      const id = ++timerId
      timers.set(id, fn)
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
  }
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
      lookup: (key) => (key === 'picker.tab.all' ? '全部' : key),
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
  const props = { open: true, anchorRef: { current: null }, presetBinding, onClose() {}, onPick: () => true }

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
      tree = renderPanel(props)
      bindTabsRef()
      effects.splice(0).forEach((fn) => fn())
      if (!dirty) return
    }
    throw new Error('panel did not settle')
  }
  render()

  return {
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
    dispose() {
      for (const value of slots) value?.cleanup?.()
      timers.clear()
    },
  }
}

test('E2E 真实浏览器几何：380px 技能面板 4 分类 Tab 零溢出且 33 项技能名称/描述零省略截断', () => {
  const binding = SkillShelf.getPresetSkillBinding('omni-agent')
  assert.ok(binding, 'omni-agent 预设必须存在')
  assert.deepEqual(
    binding.categories.map((c) => c.id),
    ['创作视频', '创作图片', '分析洞察', '文案运营'],
  )
  assert.equal(binding.skills.length, 33)

  const tabsHtml = binding.tabs
    .map((tab, idx) => `<button type="button" role="tab" class="sh-picker-tab${idx === 0 ? ' on' : ''}">${escapeHtml(tab.name || tab.id)}</button>`)
    .join('')
  const rowsHtml = binding.skills
    .map(
      (item, idx) => `
      <button type="button" role="option" class="sh-picker-row${idx === 0 ? ' on' : ''}">
        <div class="sh-picker-row-main">
          <div class="sh-picker-row-top"><span class="sh-picker-name">${escapeHtml(item.name)}</span></div>
          <div class="sh-picker-desc">${escapeHtml(item.description)}</div>
        </div>
      </button>`,
    )
    .join('')
  const overflowTabsHtml = ['全部', '创作视频', '创作图片', '选品与需求', '趋势与达人复盘', '文案与运营']
    .map((label, idx) => `<button type="button" role="tab" class="sh-picker-tab${idx === 0 ? ' on' : ''}">${escapeHtml(label)}</button>`)
    .join('')

  const result = runStyleDomProbe({
    name: 'skill-picker-compact-taxonomy',
    viewportHeight: 2200,
    styles: `
      :where(.omnimux-no-reset,.omnimux-no-reset *){box-sizing:content-box}
      body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;font-size:13px}
      ${cssMatch[1]}
      .probe-picker{position:static !important;width:380px;max-height:none !important}
      .probe-picker .sh-picker-list{overflow:visible !important;max-height:none !important}
    `,
    html: `
      <div class="omnimux-no-reset">
        <div id="compact" class="sh-picker probe-picker">
          <div class="sh-picker-cats">
            <div class="sh-picker-tabs" role="tablist">${tabsHtml}</div>
          </div>
          <div class="sh-picker-list" role="listbox">${rowsHtml}</div>
        </div>
        <div id="overflowCase" class="sh-picker probe-picker">
          <div class="sh-picker-cats">
            <div class="sh-picker-tabs" role="tablist">${overflowTabsHtml}</div>
          </div>
        </div>
      </div>`,
    measure: () => {
      const compactTabs = document.querySelector('#compact .sh-picker-tabs')
      const compactAvail = Math.max(compactTabs.clientWidth, compactTabs.parentElement.clientWidth - 16)
      const overflowTabs = document.querySelector('#overflowCase .sh-picker-tabs')
      const overflowAvail = Math.max(overflowTabs.clientWidth, overflowTabs.parentElement.clientWidth - 16)
      const truncatedNames = [...document.querySelectorAll('#compact .sh-picker-name')]
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => ({ text: el.textContent, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
      const truncatedDescs = [...document.querySelectorAll('#compact .sh-picker-desc')]
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => ({ text: el.textContent, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
      return {
        compactTabsScrollWidth: compactTabs.scrollWidth,
        compactTabsAvail: compactAvail,
        compactTabsOverflow: compactTabs.scrollWidth > compactAvail + 1,
        overflowTabsScrollWidth: overflowTabs.scrollWidth,
        overflowTabsAvail: overflowAvail,
        overflowTabsOverflow: overflowTabs.scrollWidth > overflowAvail + 1,
        rowCount: document.querySelectorAll('#compact .sh-picker-row').length,
        truncatedNames,
        truncatedDescs,
      }
    },
  })

  assert.equal(result.rowCount, 33, '应完整渲染 33 项技能')
  assert.equal(
    result.compactTabsOverflow,
    false,
    `4 分类 Tab 不应溢出（scroll=${result.compactTabsScrollWidth}, avail=${result.compactTabsAvail}）`,
  )
  assert.equal(
    result.overflowTabsOverflow,
    true,
    `对照组 5 分类长标签应检测到溢出（scroll=${result.overflowTabsScrollWidth}, avail=${result.overflowTabsAvail}）`,
  )
  assert.deepEqual(result.truncatedNames, [], '所有 33 项技能标题不得截断')
  assert.deepEqual(result.truncatedDescs, [], '所有 33 项技能描述在 380px 单行内不得省略截断')
})

test('E2E 真实面板组件：Tab 未溢出隐藏滚动箭头、溢出时显示，且支持旧术语别名检索', () => {
  const binding = SkillShelf.getPresetSkillBinding('omni-agent')
  assert.ok(binding)

  const compactPanel = mountPanelHarness(binding, {
    scrollWidth: 332,
    clientWidth: 362,
    parentElement: { clientWidth: 378 },
  })
  try {
    assert.deepEqual(compactPanel.tabLabels(), ['全部', '创作视频', '创作图片', '分析洞察', '文案运营'])
    assert.equal(compactPanel.hasMoreButton(), false, 'Tab 未溢出时不得渲染右侧滚动箭头')

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

  const overflowingPanel = mountPanelHarness(binding, {
    scrollWidth: 464,
    clientWidth: 330,
    parentElement: { clientWidth: 378 },
  })
  try {
    assert.equal(overflowingPanel.hasMoreButton(), true, 'Tab 实际溢出时必须渲染右侧滚动箭头')
  } finally {
    overflowingPanel.dispose()
  }
})
