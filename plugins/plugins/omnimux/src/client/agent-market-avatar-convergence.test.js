/**
 * @file plugins/omnimux/src/client/agent-market-avatar-convergence.test.js
 * 验证输入框 Agent 头像与专家市场头像 100% 同源收敛契约。
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BUILTIN_EXPERT_COVERS,
  resolveAgentPresetAvatar,
  resolveAgentPresetId,
  resolvePresetCoverUrl,
} from './agent-preset-enhancer.js'
import { generatePixelAvatarDataUrl, generatePixelAvatarSvg } from './pixel-avatar.js'

describe('Agent 输入框与专家市场头像收敛一致性契约', () => {
  const factoryPresets = [
    { name: '全能社媒操盘手', id: 'omni-agent' },
    { name: '全能营销操盘手', id: 'marketing-agent' },
    { name: '全能短剧操盘手', id: 'drama-agent' },
    { name: '代码开发', id: 'standard' },
    { name: '日常工作', id: 'daily-work' },
    { name: '创造模式', id: 'cordis' },
    { name: 'PTC 模式', id: 'ptc' },
    { name: '极简模式', id: 'minimal' },
  ]

  it('内置 Agent 预设在输入框与专家市场生成的头像完全 1:1 逐字相等', () => {
    for (const preset of factoryPresets) {
      const fromEnhancerByName = resolveAgentPresetAvatar(preset.name, { size: 20 })
      const fromEnhancerById = resolveAgentPresetAvatar(preset.id, { size: 20 })
      const fromMarketGenerator = generatePixelAvatarDataUrl(preset.id, { size: 20 })

      assert.ok(fromEnhancerByName, `${preset.name} 应能成功解析出头像`)
      assert.ok(fromEnhancerById, `${preset.id} 应能成功解析出头像`)

      // 1. 中文名称与预设 ID 得到相同结果
      assert.equal(
        fromEnhancerByName.src,
        fromEnhancerById.src,
        `预设名称「${preset.name}」与 ID「${preset.id}」解析得到的头像必须完全一致`
      )

      // 2. 与专家市场的像素头像生成器输出 100% 一致
      assert.equal(
        fromEnhancerByName.src,
        fromMarketGenerator,
        `输入框中「${preset.name}」的头像必须与专家市场生成的像素头像完全一致`
      )
    }
  })

  it('所有预设头像输出均为锐利像素艺术矢量，彻底告别 blobatar 简笔圆脸表情', () => {
    for (const preset of factoryPresets) {
      const svg = generatePixelAvatarSvg(preset.id, { size: 20 })
      assert.match(svg, /shape-rendering="crispEdges"/, '必须具备像素艺术抗模糊渲染标记')
      assert.match(svg, /viewBox="0 0 16 16"/, '必须基于 16x16 精致对称像素网格')
      assert.doesNotMatch(svg, /blobatar/, '严禁出现任何旧版 blobatar 痕迹')
    }
  })

  it('市场垂直专家在输入框与专家市场全部统一收敛至确定性像素艺术头像', () => {
    const marketHiredExperts = [
      { name: '市场选品与竞品调研专家', id: 'ecom-market-research' },
      { name: '产品定位与定价策略专家', id: 'ecom-product-strategy' },
      { name: '跨境 Listing 与合规文案专家', id: 'ecom-listing-copy' },
      { name: '电商主图与商详视觉专家', id: 'ecom-visual-studio' },
      { name: '带货短视频与爆款复刻导演', id: 'ecom-video-director' },
      { name: '跨境广告诊断与买量优化专家', id: 'ecom-ads-optimizer' },
      { name: '评论 VOC 与售后话术专家', id: 'ecom-review-voc' },
      { name: '达人建联与社媒增长专家', id: 'ecom-creator-growth' },
    ]

    for (const exp of marketHiredExperts) {
      const resolved = resolveAgentPresetAvatar(exp.name, { size: 20 })
      const expectedDataUrl = generatePixelAvatarDataUrl(exp.id, { size: 20 })
      assert.ok(resolved, `市场专家「${exp.name}」应能被输入框识别`)
      assert.equal(resolved.id, exp.id)
      assert.equal(resolved.src, expectedDataUrl, `输入框中「${exp.name}」必须展示确定性像素头像`)
      assert.doesNotMatch(resolved.src, /\.png$/, '严禁回退或读取写实人物封面图片')
    }
  })

  it('当官方封面路径需要解析时，能按插件规范解析出代理地址或透传合法地址', () => {
    assert.equal(resolvePresetCoverUrl('data:image/png;base64,123'), 'data:image/png;base64,123')
    assert.equal(resolvePresetCoverUrl('https://example.com/a.png'), 'https://example.com/a.png')
    assert.equal(
      resolvePresetCoverUrl('catalog/covers/test.png'),
      '/api/plugin/omnimux-market/icon?url=catalog%2Fcovers%2Ftest.png'
    )
  })
})
