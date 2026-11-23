/**
 * @file plugins/omnimux-market/tests/e2e/expert-market-avatars.spec.js
 * E2E：8 位跨境电商 SOP 专家卡片头像像素艺术收敛一致性完整旅程。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { DEFAULT_MARKET_EXPERTS } from '../../lib/expert-market.js'
import * as plazaUtils from '../../src/client/plaza/plazaUtils.js'

test('E2E 专家市场卡片头像渲染：8 位 SOP 电商专家均以确定性像素小人展示、无 Topview 残留且默认可聘用', () => {
  assert.equal(DEFAULT_MARKET_EXPERTS.length, 8)
  assert.equal(plazaUtils.DEFAULT_MARKET_EXPERTS.length, 8)

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
  const renderExpertCard = sandbox.exports.renderExpertCard

  for (const exp of DEFAULT_MARKET_EXPERTS) {
    assert.equal(exp.initialStatus, 'available', `${exp.id} 默认状态必须为 available`)
    assert.match(exp.avatar, /^data:image\/svg\+xml/, `${exp.id} avatar 必须是 SVG Data URI`)
    assert.match(decodeURIComponent(exp.avatar), /shape-rendering="crispEdges"/, `${exp.id} 必须是像素风格`)
    assert.doesNotMatch(`${exp.name} ${exp.description} ${exp.descriptionEn}`, /topview/i, `${exp.id} 禁止 Topview 残留`)

    const cardAvatar = plazaUtils.resolveExpertAvatar(exp)
    assert.equal(cardAvatar, exp.avatar, '卡片头像应与预设数据中的像素头像完全一致')

    const cardVNode = renderExpertCard({ ...exp, status: 'available' }, {
      tr: () => '',
      isEn: false,
      expertMarketToggling: null,
      onToggle: () => {},
    })
    assert.ok(cardVNode, 'ExpertCard 应正常渲染')
    assert.equal(cardVNode.props.className, 'expert-card')

    const avatarWrap = cardVNode.children.find((c) => c?.props?.className === 'expert-card-avatar-wrap')
    assert.ok(avatarWrap, '必须包含头像包装容器')
    const imgNode = avatarWrap.children.find((c) => c?.type === 'img')
    assert.ok(imgNode, '必须包含 img 节点')
    assert.equal(imgNode.props.src, exp.avatar, 'img src 必须指向像素头像数据')
    assert.doesNotMatch(imgNode.props.src, /\.png$/, '严禁出现写实 PNG 封面')

    const statusNode = cardVNode.children.find((c) => c?.props?.className?.includes('expert-card-status'))
    assert.equal(statusNode?.children?.[0], '[ 可聘用 ]')
    const stagePill = statusNode?.children?.find((c) => c?.props?.className === 'expert-card-stage')
    assert.ok(stagePill, `${exp.id} 市场专家应显示 SOP 阶段标签`)
  }
})
