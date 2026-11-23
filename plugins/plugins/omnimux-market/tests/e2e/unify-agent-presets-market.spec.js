/**
 * @file plugins/omnimux-market/tests/e2e/unify-agent-presets-market.spec.js
 * E2E：Agent 预设与专家市场真源统一、8 位跨境 SOP 专家筛选与系统预置防误禁用完整旅程。
 */

import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { DEFAULT_MARKET_EXPERTS, reconcileMarketExperts } from '../../lib/expert-market.js'
import * as plazaUtils from '../../src/client/plaza/plazaUtils.js'
import { filterDisplayedExperts } from '../../src/client/plaza/usePlazaFilter.js'

function buildCardRenderer() {
  const cardJsxCode = readFileSync(new URL('../../src/client/plaza/ExpertCard.jsx', import.meta.url), 'utf8')
    .replace(/^import React.*$/m, '')
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*['"]\.\/plazaUtils\.js['"];/m, '')
    .replaceAll('export function', 'function')

  const sandbox = {
    React: {
      createElement: (type, props, ...children) => ({
        type,
        props: props || {},
        children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false),
      }),
    },
    EXPERT_STATUS_CONFIG: plazaUtils.EXPERT_STATUS_CONFIG,
    getExpertButtonText: plazaUtils.getExpertButtonText,
    getExpertLocalizedNames: plazaUtils.getExpertLocalizedNames,
    getExpertStageLabel: plazaUtils.getExpertStageLabel,
    getExpertStatusText: plazaUtils.getExpertStatusText,
    resolveExpertAvatar: plazaUtils.resolveExpertAvatar,
    resolveIconSrc: plazaUtils.resolveIconSrc,
    resolveInitials: plazaUtils.resolveInitials,
    exports: {},
  }

  runInNewContext(`${cardJsxCode}\nexports.renderExpertCard = renderExpertCard;`, sandbox)
  return sandbox.exports.renderExpertCard
}

test('E2E 旅程一：跨境电商 SOP 专家库包含 8 位角色，全部默认可聘用且支持按 SOP 阶段筛选', () => {
  assert.equal(DEFAULT_MARKET_EXPERTS.length, 8)
  const ids = DEFAULT_MARKET_EXPERTS.map((e) => e.id)
  assert.deepEqual(ids, [
    'ecom-market-research',
    'ecom-product-strategy',
    'ecom-listing-copy',
    'ecom-visual-studio',
    'ecom-video-director',
    'ecom-ads-optimizer',
    'ecom-review-voc',
    'ecom-creator-growth',
  ])

  const research = filterDisplayedExperts(plazaUtils.DEFAULT_MARKET_EXPERTS, true, '', 'research')
  assert.equal(research.length, 2)
  const production = filterDisplayedExperts(plazaUtils.DEFAULT_MARKET_EXPERTS, true, '', 'production')
  assert.equal(production.length, 3)
  const growth = filterDisplayedExperts(plazaUtils.DEFAULT_MARKET_EXPERTS, true, '', 'growth')
  assert.equal(growth.length, 3)

  const searched = filterDisplayedExperts(plazaUtils.DEFAULT_MARKET_EXPERTS, true, 'ROAS', 'all')
  assert.equal(searched.length, 1)
  assert.equal(searched[0].id, 'ecom-ads-optimizer')
})

test('E2E 旅程二：官方系统预置、已入职市场专家与用户自建 Agent 真源聚合，系统预置不渲染禁用按钮', () => {
  const home = mkdtempSync(join(tmpdir(), 'e2e-unify-market-'))
  try {
    const mockOfficialPresets = [
      { id: 'omni-agent', trust: 'system', name: 'OmniMux' },
      { id: 'cordis', trust: 'system', name: 'cordis' },
      { id: 'ecom-listing-copy', name: '跨境 Listing 与合规文案专家' },
      { id: 'user-custom-marketer', trust: 'user', name: '出海营销助理', description: '自建私有营销 Agent' },
    ]

    const reconciled = reconcileMarketExperts(home, mockOfficialPresets)
    assert.equal(reconciled.length, 11, '2 系统预置 + 8 市场专家 + 1 用户自建')

    const omni = reconciled.find((it) => it.id === 'omni-agent')
    assert.equal(omni?.group, 'system')
    assert.equal(omni?.status, 'system')

    const cordis = reconciled.find((it) => it.id === 'cordis')
    assert.equal(cordis?.group, 'system')
    assert.equal(cordis?.status, 'system')
    assert.equal(cordis?.name, '创建Agent')

    const hired = reconciled.find((it) => it.id === 'ecom-listing-copy')
    assert.equal(hired?.status, 'enabled')

    const unhired = reconciled.find((it) => it.id === 'ecom-market-research')
    assert.equal(unhired?.status, 'available')

    const customAgent = reconciled.find((it) => it.id === 'user-custom-marketer')
    assert.equal(customAgent?.group, 'custom')
    assert.equal(customAgent?.status, 'custom')

    const renderCard = buildCardRenderer()
    const trMap = {
      'expertMarket.system': '系统预置',
      'expertMarket.custom': '用户自建',
      'expertMarket.enabled': '已入职',
      'expertMarket.available': '可聘用',
      'expertMarket.install': '安装',
      'expertMarket.disable': '禁用',
    }
    const renderOpts = {
      tr: (k) => trMap[k] || '',
      isEn: false,
      expertMarketToggling: null,
      onToggle: () => {},
    }

    // 系统预置：显示 [ 系统预置 ]，无禁用按钮，无冗余阶段标签
    const sysVNode = renderCard(cordis, renderOpts)
    const sysStatusNode = sysVNode.children.find((c) => c?.props?.className?.includes('expert-card-status'))
    assert.equal(sysStatusNode?.children?.[0], '[ 系统预置 ]')
    assert.equal(sysVNode.children.find((c) => c?.props?.className?.includes('expert-card-action')), undefined, '系统预置不得显示禁用按钮')
    assert.equal(sysStatusNode?.children?.find((c) => c?.props?.className === 'expert-card-stage'), undefined, '系统预置不重复显示阶段标签')

    // 用户自建：显示 [ 用户自建 ]，无市场禁用按钮
    const customVNode = renderCard(customAgent, renderOpts)
    const customStatusNode = customVNode.children.find((c) => c?.props?.className?.includes('expert-card-status'))
    assert.equal(customStatusNode?.children?.[0], '[ 用户自建 ]')
    assert.equal(customVNode.children.find((c) => c?.props?.className?.includes('expert-card-action')), undefined)

    // 未安装市场专家：显示 [ 可聘用 ] + 安装按钮
    const availVNode = renderCard(unhired, renderOpts)
    const availAction = availVNode.children.find((c) => c?.props?.className?.includes('expert-card-action'))
    assert.ok(availAction, '可聘用专家必须渲染安装按钮')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('E2E 旅程三：安装失败时前端回滚卡片状态并记录可恢复错误信息', async () => {
  let current = [{ id: 'ecom-visual-studio', name: '电商主图与商详视觉专家', status: 'available' }]
  let toggling = ''
  let lastError = ''
  const state = {
    get expertMarketToggling() { return toggling },
    setExpertMarketToggling(v) { toggling = v },
    setExpertMarketItems(updater) { current = updater(current) },
    setExpertMarketError(msg) { lastError = msg },
  }
  await plazaUtils.executeToggleExpert(current[0], state, async () => {
    throw new Error('模拟挂载校验失败')
  })
  assert.equal(current[0].status, 'available', '失败后必须回滚到原状态')
  assert.equal(toggling, '', '必须释放 toggling 锁')
  assert.match(lastError, /模拟挂载校验失败/, '必须把可恢复错误透出给前端错误浮层')
})
