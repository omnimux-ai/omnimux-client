import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import React from 'react'
import { loadClientModule } from '../../tests/helpers/client-esm-loader.mjs'
import * as SkillShelf from './skill-picker-logic.js'
import * as plazaUtils from './plaza/plazaUtils.js'
import * as cardCoversData from './plaza/cardCoversData.js'
import * as auroraGradients from './plaza/auroraGradients.js'

const here = dirname(fileURLToPath(import.meta.url))
const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) })

function loadPlazaJsx(relPath, extraDeps = {}) {
  const src = readFileSync(join(here, relPath), 'utf8')
  const { code } = esbuild.transformSync(src, { loader: 'jsx', format: 'cjs' })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', code)(
    (id) => {
      if (id === 'react') return React
      if (id.includes('plazaUtils')) return plazaUtils
      if (id.includes('cardCoversData')) return cardCoversData
      if (id.includes('auroraGradients')) return auroraGradients
      if (Object.hasOwn(extraDeps, id)) return extraDeps[id]
      if (id.includes('FeaturedCard')) return loadPlazaJsx('./plaza/FeaturedCard.jsx')
      return {}
    },
    mod,
    mod.exports,
  )
  return mod.exports
}

function collectNodes(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const item of node) collectNodes(item, predicate, out)
    return out
  }
  if (typeof node.type === 'function') {
    try {
      return collectNodes(node.type({ ...(node.props || {}), children: node.children }), predicate, out)
    } catch {
      return out
    }
  }
  if (predicate(node)) out.push(node)
  for (const child of node.children || []) collectNodes(child, predicate, out)
  return out
}

describe('PR 2A Layer 3: omnimux-market UX overhaul regressions', () => {
  it('M-01: InstallModal parses skill slugs/URLs honestly and rejects fake local .zip/.md filenames', async () => {
    const { parseSkillSlugInput, InstallModal } = loadPlazaJsx('./plaza/InstallModal.jsx')
    assert.deepEqual(parseSkillSlugInput('video-hook-analysis'), { ok: true, slug: 'video-hook-analysis' })
    assert.deepEqual(parseSkillSlugInput('https://skillhub.cn/skills/demo-skill?tab=overview'), { ok: true, slug: 'demo-skill' })
    assert.deepEqual(parseSkillSlugInput('my-skill.zip'), { ok: false, reason: 'local-file-unsupported' })
    assert.deepEqual(parseSkillSlugInput('SKILL.md'), { ok: false, reason: 'local-file-unsupported' })

    const calls = []
    let closeCalls = 0
    let errorMsg = ''
    let stateIdx = 0
    const slots = ['local-pkg.zip', false, '']
    const tree = InstallModal({
      open: true,
      onClose: () => { closeCalls += 1 },
      api: async (method, payload) => { calls.push([method, payload]) },
      h,
      hooks: {
        useState: (init) => {
          const idx = stateIdx++
          return [slots[idx] ?? init, (v) => { if (idx === 2) errorMsg = v }]
        },
        useRef: () => ({ current: null }),
      },
    })
    const submitBtn = collectNodes(tree, (n) => n.props?.className?.includes('btn-modal-install'))[0]
    await submitBtn.props.onClick()
    assert.equal(calls.length, 0, 'local .zip filename must never call remote install')
    assert.match(errorMsg, /skill-creator/)
    assert.equal(closeCalls, 0)

    // While uploading, backdrop/close button must lock
    stateIdx = 0
    const busySlots = ['demo-skill', true, '']
    const busyTree = InstallModal({
      open: true,
      onClose: () => { closeCalls += 1 },
      h,
      hooks: {
        useState: (init) => {
          const idx = stateIdx++
          return [busySlots[idx] ?? init, () => {}]
        },
        useRef: () => ({ current: null }),
      },
    })
    const closeBtn = collectNodes(busyTree, (n) => n.props?.className?.includes('omnimux-modal-close-btn'))[0]
    assert.equal(closeBtn.props.disabled, true)
    closeBtn.props.onClick()
    assert.equal(closeCalls, 0)
  })

  it('M-02: DetailCard removes fake DetailSwitch, never fabricates references/meta.yaml, and guards uninstall with confirmation', async () => {
    const src = readFileSync(join(here, 'skills-ui.js'), 'utf8')
    assert.ok(!src.includes('handleToggleEnable'), 'dead toggle helper must be removed')
    assert.ok(!src.includes('overview.md'), 'fabricated references/overview.md must be removed')

    const stateSlots = new Map()
    let hookIdx = 0
    let apiCalls = []
    const effects = []
    const ReactMock = {
      useContext: () => (k) => k,
      useState: (init) => {
        const idx = hookIdx++
        if (!stateSlots.has(idx)) stateSlots.set(idx, init)
        return [stateSlots.get(idx), (v) => stateSlots.set(idx, typeof v === 'function' ? v(stateSlots.get(idx)) : v)]
      },
      useEffect: (fn) => { effects.push(fn) },
      useRef: () => ({ current: null }),
      createContext: () => ({ Provider: 'Provider' }),
    }
    const { Drawer } = loadClientModule('./skills-ui.js', {
      globals: {
        document: { body: { style: {} }, addEventListener: () => {}, removeEventListener: () => {} },
        window: { addEventListener: () => {}, removeEventListener: () => {} },
      },
      modules: {
        './boot.js': {
          h,
          React: ReactMock,
          useState: ReactMock.useState,
          useEffect: ReactMock.useEffect,
          Button: (props) => h('button', props, props.children),
          IconButton: (props) => h('button', props, props.children),
          ConfirmModal: (props) => (props.open ? h('div', { className: 'confirm-modal-stub', ...props }) : null),
        },
        './portal.js': { createPortal: (node) => node, fallbackPortal: null },
        './i18n.js': { useTr: () => (k) => k, lookup: (k) => k, catLabel: () => '通用', skillDesc: () => 'desc', skillTitle: () => 'Demo' },
        './api.js': {
          api: async (method) => {
            apiCalls.push(method)
            if (method === 'detail') return { ok: true, card: { slug: 'demo', installed: true } }
            if (method === 'skillContent') return { ok: true, found: false }
            return { ok: true }
          },
        },
        './session-create.js': { trySkillInSession: async () => ({}) },
      },
    })

    const expandTree = (node) => {
      if (!node || typeof node !== 'object') return node
      if (Array.isArray(node)) return node.map(expandTree)
      if (typeof node.type === 'function') {
        return expandTree(node.type({ ...(node.props || {}), children: node.children }))
      }
      return { ...node, children: (node.children || []).map(expandTree) }
    }

    const renderPass = () => {
      hookIdx = 0
      effects.length = 0
      return expandTree(Drawer({ item: { slug: 'demo', name: 'Demo', installed: true }, onClose: () => {} }))
    }
    renderPass()
    for (const fn of effects) await fn()
    const tree = renderPass()

    // Footer must have status tag and zero interactive DetailSwitch
    assert.equal(collectNodes(tree, (n) => n.props?.role === 'switch').length, 0)
    // Multi-file sidebar must stay hidden when no real multi-file tree exists
    assert.equal(collectNodes(tree, (n) => n.props?.className === 'ws-detail-tree').length, 0)

    // Clicking Uninstall menu item opens ConfirmModal instead of calling uninstall directly
    apiCalls = []
    collectNodes(tree, (n) => n.props?.className?.includes('ws-footer-more-btn'))[0].props.onClick()
    const withMenu = renderPass()
    const uninstallItem = collectNodes(withMenu, (n) => n.props?.className?.includes('danger') && n.children?.includes('卸载技能'))[0]
    uninstallItem.props.onClick()
    assert.equal(apiCalls.length, 0, 'opening confirm dialog must not uninstall yet')
    const withConfirm = renderPass()
    const confirmModal = collectNodes(withConfirm, (n) => n.props?.className === 'confirm-modal-stub')[0]
    assert.ok(confirmModal)
    assert.equal(confirmModal.props.confirmVariant, 'danger')
  })

  it('M-03: PluginsColumnTab removes fake localStorage switches and uses honest 4-char categories', () => {
    const { PluginsColumnTab } = loadClientModule('./plugins-column.js', {
      modules: { './boot.js': { h } },
    })
    const zhDict = { locale: 'zh' }
    const tree = PluginsColumnTab({ searchQuery: '', tr: (k) => zhDict[k] || '', isEn: false })
    assert.equal(collectNodes(tree, (n) => n.props?.role === 'switch').length, 0)
    const catTitles = collectNodes(tree, (n) => n.props?.className === 'sh-plugins-category-title').map((n) => n.children[0])
    assert.deepEqual(catTitles, ['内容创作', '视频媒体', '社媒运营', '系统能力'])
    const badges = collectNodes(tree, (n) => n.props?.className?.includes('sh-tag')).map((n) => n.children[0])
    assert.ok(badges.includes('核心内置'))
    assert.ok(badges.includes('已内置'))
  })

  it('M-04/M-05: MineToolbar hides volatile autoUpdate, uses 全部, and MineCard replaces destructive switch with Uninstall button', async () => {
    const { MineToolbar, renderMineCard } = loadPlazaJsx('./plaza/PlazaCardGrid.jsx')
    let stateVal = 'category'
    const toolbarTree = MineToolbar({
      mineCategory: '',
      setMineCategory: () => {},
      mineSource: '',
      setMineSource: () => {},
      availableSources: ['OmniMux'],
      tr: (k) => (k === 'locale' ? 'zh' : ''),
      h,
      hooks: {
        useState: () => [stateVal, (v) => { stateVal = v }],
        useRef: () => ({ current: null }),
        useEffect: () => {},
      },
    })
    assert.equal(collectNodes(toolbarTree, (n) => n.props?.className === 'auto-update-wrap').length, 0)
    const menuItems = collectNodes(toolbarTree, (n) => n.props?.className?.includes('mine-dropdown-item')).flatMap((n) => n.children)
    const texts = collectNodes({ children: menuItems }, (n) => typeof n === 'string' || typeof n.children?.[0] === 'string')
      .map((n) => (typeof n === 'string' ? n : n.children[0]))
    assert.ok(texts.includes('全部'))
    assert.ok(!texts.includes('全部分类'))
    assert.ok(!texts.includes('短剧/漫剧'))
    assert.ok(texts.includes('短剧漫剧'))

    const zhTr = (k) => (k === 'locale' ? 'zh' : k)
    const card = renderMineCard({ slug: 's1', name: 'Skill 1', preinstalled: false }, { tr: zhTr, h, onOpen: () => {}, onToggle: () => {} })
    assert.equal(collectNodes(card, (n) => n.props?.role === 'switch').length, 0)
    assert.equal(collectNodes(card, (n) => n.props?.className === 'omx-mine-uninstall-btn').length, 1)

    const builtinCard = renderMineCard({ slug: 's2', name: 'Built-in Skill', preinstalled: true }, { tr: zhTr, h, onOpen: () => {}, onToggle: () => {} })
    assert.equal(collectNodes(builtinCard, (n) => n.props?.className === 'omx-mine-uninstall-btn').length, 0)
  })

  it('M-16/i18n: SuiteDetailModal defaults to global without projectDir, uses danger uninstall, and i18n removes · and half-translated strings', async () => {
    const { SuiteDetailModal } = loadPlazaJsx('./plaza/SuiteDetailModal.jsx')
    let idx = 0
    const slots = [true, false, true] // installedLocal, confirmOpen, confirmUninstallOpen
    const modalNodes = SuiteDetailModal({
      item: {
        id: 'suite-1',
        name: 'Suite',
        installed: true,
        initialAction: 'uninstall',
        suite: { skills: [], rules: [{ title: 'R', content: 'C' }], agents: [] },
      },
      projectDir: '',
      tr: (k) => k,
      h,
      Overlay: 'Overlay',
      Button: 'Button',
      hooks: {
        useState: (init) => {
          const i = idx++
          return [i < slots.length ? slots[i] : init, () => {}]
        },
      },
    })
    const uninstallBtn = collectNodes(modalNodes, (n) => n.type === 'Button' && n.children?.includes('确认卸载'))[0]
    assert.ok(uninstallBtn)
    assert.equal(uninstallBtn.props.variant, 'danger')

    const { suiteCompositionText } = await import('./plaza/plazaUtils.js')
    const compZh = suiteCompositionText({ suite: { skills: [1], rules: [1, 2], agents: [] } }, (k) => k)
    assert.ok(!compZh.includes('·'))
    assert.equal(compZh, '技能 1、规则 2、Agent 0')

    const i18nSrc = readFileSync(join(here, 'i18n.js'), 'utf8')
    const enIdx = i18nSrc.indexOf('const EN = {')
    assert.ok(enIdx > 0, 'EN dictionary marker must exist in i18n.js')
    const zhSection = i18nSrc.slice(0, enIdx)
    assert.ok(!/适用于[A-Za-z]/.test(zhSection), 'no half-translated 适用于<english> in zh i18n')
    assert.ok(!/当需要时使用本技能：[A-Za-z]/.test(zhSection), 'no half-translated 当需要时使用本技能 in zh i18n')
    assert.ok(!/"skill\.desc\.guofeng-palace-drama-single-call":\s*"Cinematic/.test(zhSection))
    assert.ok(!i18nSrc.includes('安装Skill'))
    assert.ok(!i18nSrc.includes('其他Skill'))
    assert.ok(!i18nSrc.includes('"cfg.updateHint": "当前 {cur} ·'))
    assert.ok(!i18nSrc.includes('"suite.receipt.failed": "未完成 ·'))
    assert.ok(!i18nSrc.includes('"skill.name.bggg-data-amazon": "BGGG Amazon Data ·'))
  })
})
