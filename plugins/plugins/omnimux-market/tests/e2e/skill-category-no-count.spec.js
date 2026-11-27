import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as SkillShelf from '../../src/client/skill-picker-logic.js'
import { loadClientModule } from '../helpers/client-esm-loader.mjs'

const EXPECTED_ZH_LABELS = ['全部', '视频创作', '爆款复刻', '商品视觉', '市场洞察', '营销增长', '效率工具']
const EXPECTED_EN_LABELS = ['All', 'Video Creation', 'Viral Replication', 'Product Visuals', 'Market Insights', 'Growth Marketing', 'Editing & Tools']

const h = (type, props, ...children) => ({
  type,
  props: props || {},
  children: children.flat(Infinity),
})

function walkAll(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const item of node) walkAll(item, predicate, out)
    return out
  }
  if (predicate(node)) out.push(node)
  for (const child of node.children || []) walkAll(child, predicate, out)
  return out
}

function collectText(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(collectText).join('')
  if (typeof node === 'object') return (node.children || []).map(collectText).join('')
  return ''
}

function renderPlazaWithDict(dict) {
  const tr = (key) => dict.get(key) || key
  const { SkillPlaza: render } = loadClientModule('./skill-plaza.js', {
    modules: {
      './boot.js': {
        h,
        SkillShelf,
        useState: (initial) => [initial, () => {}],
        useCallback: (fn) => fn,
        useEffect: () => {},
        useRef: (init) => ({ current: init }),
        Button: 'Button',
        SearchField: undefined,
        Tabs: undefined,
      },
      './skills-ui.js': { Drawer: 'Drawer', Overlay: 'Overlay' },
      './api.js': {
        api: async () => ({}),
        apiCache: new Map(),
        apiCacheKey: (a, p) => JSON.stringify([a, p]),
        API_CACHE_TTL_MS: 1000,
      },
      './session-create.js': { createSkillSession: () => {} },
      './plugins-column.js': { PluginsColumnTab: 'PluginsColumnTab' },
      './runtime-state.js': { marketRuntime: { plazaSessions: null, plazaWorkspaces: null } },
      './i18n.js': { useTr: () => tr, lookup: tr },
    },
  })
  return render({})
}

test('e2e: SkillPlaza（中英双语）分类胶囊栏只展示分类名称，不渲染 .cat-count 数字统计', () => {
  const zhDict = new Map([
    ['locale', 'zh'],
    ['workshop.catAll', '全部'],
    ['workshop.category', '场景分类'],
    ['workshop.scenarioLabel', '场景分类'],
    ['cat.scene-video', '视频创作'],
    ['cat.scene-replicate', '爆款复刻'],
    ['cat.scene-visual', '商品视觉'],
    ['cat.scene-research', '市场洞察'],
    ['cat.scene-growth', '营销增长'],
    ['cat.scene-tools', '效率工具'],
  ])
  const enDict = new Map([
    ['locale', 'en'],
    ['workshop.catAll', 'All'],
    ['workshop.category', 'Scenario'],
    ['workshop.scenarioLabel', 'Scenario'],
    ['cat.scene-video', 'Video Creation'],
    ['cat.scene-replicate', 'Viral Replication'],
    ['cat.scene-visual', 'Product Visuals'],
    ['cat.scene-research', 'Market Insights'],
    ['cat.scene-growth', 'Growth Marketing'],
    ['cat.scene-tools', 'Editing & Tools'],
  ])

  for (const [localeLabel, dict, expected] of [
    ['中文', zhDict, EXPECTED_ZH_LABELS],
    ['英文', enDict, EXPECTED_EN_LABELS],
  ]) {
    const tree = renderPlazaWithDict(dict)
    const bars = walkAll(tree, (node) => node.props && node.props.className === 'category-bar')
    assert.equal(bars.length, 1, `${localeLabel}：发现页必须渲染 1 个 .category-bar`)

    const catButtons = walkAll(bars[0], (node) => node.type === 'button' && String(node.props?.className || '').split(/\s+/).includes('cat-btn'))
    assert.equal(catButtons.length, 7, `${localeLabel}：应渲染 1 个全选 + 6 个垂直场景胶囊`)

    const countNodes = walkAll(tree, (node) => String(node.props?.className || '').split(/\s+/).includes('cat-count'))
    assert.equal(countNodes.length, 0, `${localeLabel}：不得渲染 .cat-count 数字角标节点`)

    const actualLabels = catButtons.map((btn) => collectText(btn).trim())
    assert.deepEqual(actualLabels, expected, `${localeLabel}：胶囊文本应仅为分类名称，不含计数数字`)
    for (const label of actualLabels) {
      assert.equal(/\d/.test(label), false, `${localeLabel}：分类胶囊 "${label}" 不得包含数字`)
    }
  }

  const cssSource = readFileSync(new URL('../../src/client/css.js', import.meta.url), 'utf8')
  assert.equal(cssSource.includes('.cat-count'), false, 'css.js 不得残留无用 .cat-count 样式规则')
  assert.equal(cssSource.includes('.cat-btn.active'), true, 'css.js 应保留 .cat-btn.active 交互样式')
})
