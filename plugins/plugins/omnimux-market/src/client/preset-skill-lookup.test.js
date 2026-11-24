import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  AGENT_PRESET_SKILL_BINDINGS,
  BUNDLED_SKILL_SLUGS,
  findPresetSkill,
  getPresetSkillBinding,
  hydratePresetSkill,
} from './skill-picker-logic.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const MARKET_ROOT = join(HERE, '..', '..')

/** 最小绑定表：测试真实可用集合推导与显式禁用拦截。 */
const bindings = {
  'tiktok-agent': {
    skills: [
      { id: 'sk-tk-other', slug: 'other-skill', installed: true },
      { id: 'sk-tk-video-hook', slug: 'video-hook-analysis', name: '视频拆解', title: '视频拆解' },
    ],
  },
  'omni-agent': {
    skills: [
      { id: 'sk-omx-reverse', slug: 'reverse-video-prompt', name: '反推视频提示词', installed: false },
    ],
  },
  'drama-agent': {
    skills: [
      { id: 'sk-dr-reverse', slug: 'reverse-video-prompt', name: '反推视频提示词' },
    ],
  },
}

describe('按 slug 从出厂预设技能库解析技能', () => {
  it('命中已内置条目，并标明来源预设', () => {
    const hit = findPresetSkill('video-hook-analysis', bindings)
    assert.ok(hit)
    assert.equal(hit.slug, 'video-hook-analysis')
    assert.equal(hit.presetId, 'tiktok-agent')
    assert.equal(hit.bundled, true)
    assert.equal(hit.available, true)
  })

  it('未内置的条目视为解析不到，绝不返回', () => {
    // 1. 显式 installed: false 的 omni-agent 条目被跳过，命中 drama-agent 中真实随包的 reverse-video-prompt
    const hit = findPresetSkill('reverse-video-prompt', bindings)
    assert.ok(hit)
    assert.equal(hit.bundled, true)
    assert.equal(hit.available, true)
    assert.equal(hit.presetId, 'drama-agent')

    // 2. 空壳条目即使在静态绑定里硬写 installed: true，因不在真实随包/已装/Provider 清单中，必须返回 null (#235)
    assert.equal(findPresetSkill('other-skill', bindings), null)

    // 3. 只有由真实 installedSlugs 或 providerSlugs 传入时，才动态可用
    const viaDisk = findPresetSkill('other-skill', bindings, { installedSlugs: ['other-skill'] })
    assert.ok(viaDisk)
    assert.equal(viaDisk.installed, true)
    assert.equal(viaDisk.bundled, false)
    assert.equal(viaDisk.available, true)

    const viaProvider = findPresetSkill('other-skill', bindings, { providerSlugs: ['other-skill'] })
    assert.ok(viaProvider)
    assert.equal(viaProvider.installed, true)
    assert.equal(viaProvider.available, true)
  })

  it('技能库整体没有该 slug 时返回 null，不抛错', () => {
    assert.equal(findPresetSkill('not-a-skill', bindings), null)
    assert.equal(findPresetSkill('', bindings), null)
    assert.equal(findPresetSkill(null, bindings), null)
    assert.equal(findPresetSkill('video-hook-analysis', {}), null)
  })

  it('允许带前导斜杠的 slug（技能手势形态）', () => {
    assert.ok(findPresetSkill('/video-hook-analysis', bindings))
  })
})

/** 四条快捷方式（Issue #2562 / #235）默认绑定的技能。 */
const QUICK_SHORTCUT_SKILLS = [
  { slug: 'replicate-viral-video', name: '复刻爆款视频' },
  { slug: 'video-hook-analysis', name: '视频拆解' },
  { slug: 'create-selling-video', name: '创作带货视频' },
  { slug: 'reverse-video-prompt', name: '反推视频提示词' },
]

function resolveRealSkillMd(slug) {
  const candidates = [
    join(MARKET_ROOT, 'catalog', 'skills', slug, 'SKILL.md'),
    join(MARKET_ROOT, 'skills', slug, 'SKILL.md'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return ''
}

describe('出厂预设技能库的四个快捷方式技能', () => {
  it('四条 slug 都在出厂 Agent 预设技能表里，且均为已内置', async () => {
    // 出厂 Agent 预设真源（仓库根 presets/omni-agent/skills.json），收敛后零空壳、零静态 installed
    const raw = JSON.parse(readFileSync(join(HERE, '../../../../presets/omni-agent/skills.json'), 'utf8'))
    const list = Array.isArray(raw) ? raw : (raw.skills || [])
    for (const { slug } of QUICK_SHORTCUT_SKILLS) {
      const hit = list.find((item) => String(item.slug || item.skill || '') === slug)
      assert.ok(hit, `${slug} 必须在出厂 Agent 预设技能表里`)
      assert.equal(Object.hasOwn(hit, 'installed'), false, `${slug} 不得在静态 JSON 硬编码 installed`)
      const mdPath = resolveRealSkillMd(slug)
      assert.ok(mdPath, `${slug} 必须在仓内拥有真实 SKILL.md`)
      assert.ok(readFileSync(mdPath, 'utf8').trim().length > 100, `${slug} 的 SKILL.md 正文不得为空`)
    }
  })

  it('四条 slug 现在都能从会话技能选择器的预设绑定解析到', () => {
    for (const { slug, name } of QUICK_SHORTCUT_SKILLS) {
      assert.equal(BUNDLED_SKILL_SLUGS.has(slug), true, `${slug} 必须进入真实随包真源 BUNDLED_SKILL_SLUGS`)
      const hit = findPresetSkill(slug)
      assert.ok(hit, `${slug} 必须能从 catalog/preset-skills.json 解析到`)
      assert.equal(hit.slug, slug)
      assert.equal(hit.bundled, true, `${slug} 必须是随包可用（bundled: true）`)
      assert.equal(hit.available, true, `${slug} 必须为可用态（available: true）`)
      assert.equal(hit.installed, false, `未落盘且未传运行态列表时 ${slug} 不应伪造 installed: true`)
      assert.equal(hit.name, name, `${slug} 的名称必须与快捷方式胶囊一致`)
      assert.ok(
        hit.presetId === 'tiktok-agent' || hit.presetId === 'omni-agent',
        `${slug} 应来自默认绑定的社媒预设，实际 ${hit.presetId}`,
      )
    }
  })
})

/**
 * 创作视频 / 创作图片两个分类收敛后的零空壳真实技能清单（Issue #235）。
 * 全部条目均对应仓内真实非空 SKILL.md，不再包含空壳项或静态 installed: true。
 */
const RESTORED_CATEGORIES = [
  {
    id: '创作视频',
    skills: [
      { slug: 'replicate-viral-video', name: '复刻爆款视频', titleEn: 'Replicate Viral Video', description: '参考爆款视频结构，为你的产品一键生成同款带货视频。' },
      { slug: 'create-selling-video', name: '创作带货视频', titleEn: 'Create Selling Video', description: '从商品或参考视频出发，自动编排分析、脚本、提示词与生成全流程。' },
      { slug: 'video-hook-analysis', name: '视频拆解', titleEn: 'Video Breakdown', description: '拆解短视频叙事结构、黄金Hook与逐镜头分镜脚本。' },
      { slug: 'reverse-video-prompt', name: '反推视频提示词', titleEn: 'Reverse Video Prompt', description: '上传TK视频链接，自动反推出该视频背后，可用于AI视频生成的高质量提示词。' },
      { slug: 'omnimux-ecom-video-script', name: '带货短视频脚本', titleEn: 'E-commerce Video Script', description: '结合商品参数真源与 3 秒钩子模型，产出带口播时长与合规校验的跨境带货脚本。' },
      { slug: 'cinematic-motion-language', name: '电影级运镜语言', titleEn: 'Cinematic Motion Language', description: '将分镜创意转化为精准的推拉摇移、景别与运动物理参数，提升视频生成可控性。' },
      { slug: 'kling-global-ad-localizer', name: '多语言出海视频广告', titleEn: 'Global Ad Localizer', description: '面向 TikTok 与跨境电商锁定产品外观、本地化适配人设与语境的多语言广告矩阵。' },
      { slug: 'clip-export', name: '剪辑草稿导出', titleEn: 'Clip Draft Export', description: '将本地多轨素材、字幕与音频装配导出为可编辑的剪映 / CapCut 草稿工程。' },
    ],
  },
  {
    id: '创作图片',
    skills: [
      { slug: 'shoppable-carousel', name: '商品轮播图', titleEn: 'Shoppable Carousel', description: '根据商品图片规划逐页轮播图方案与生图提示词。' },
      { slug: 'replicate-carousel', name: '图文复刻', titleEn: 'Carousel Replication', description: '拆解参考图文结构，为新商品生成原创轮播方案。' },
      { slug: 'ecommerce-image', name: '电商商品套图', titleEn: 'E-commerce Product Images', description: '基于真实商品图规划、生成并评估主图、卖点图与场景图，严格锁定商品外观。' },
      { slug: 'omnimux-ecom-visual-qa', name: '9图视觉矩阵与质检', titleEn: '9-Image Visual QA', description: '规划跨境 9 图商详视觉矩阵并执行白底、主体占比与文字合规质检。' },
      { slug: 'product-photoshoot', name: '商业产品静物摄影', titleEn: 'Product Photoshoot', description: '生成影棚级布光、材质细节与构图控制的商业静物产品摄影方案。' },
      { slug: 'editorial-luxury-ig-carousel', name: '杂志感品牌轮播图', titleEn: 'Editorial Luxury Carousel', description: '面向时尚与生活方式品牌，构建杂志级排版与统一色调的社媒图文轮播。' },
    ],
  },
]

describe('恢复的创作视频 / 创作图片分类与 15 款技能', () => {
  it('tiktok-agent 的分类里含创作视频与创作图片', () => {
    const binding = getPresetSkillBinding('tiktok-agent')
    assert.ok(binding)
    const ids = binding.categories.map((c) => c.id)
    for (const { id } of RESTORED_CATEGORIES) {
      assert.ok(ids.includes(id), `${id} 必须出现在技能菜单分类里，实际 ${ids.join('/')}`)
    }
    const tabIds = binding.tabs.map((t) => t.id)
    assert.equal(tabIds[0], 'all')
    for (const { id } of RESTORED_CATEGORIES) {
      assert.ok(tabIds.includes(id), `${id} 必须出现在分类页签里`)
    }
  })

  it('15 款技能都在货架上，且分类、文案、封面齐备', () => {
    const binding = getPresetSkillBinding('tiktok-agent')
    const bySlug = new Map(binding.skills.map((s) => [String(s.slug || s.skill), s]))
    for (const category of RESTORED_CATEGORIES) {
      const inCategory = binding.skills.filter((s) => s.category === category.id)
      assert.equal(inCategory.length, category.skills.length, `${category.id} 应恰好 ${category.skills.length} 款技能，实际 ${inCategory.length}`)
      for (const expected of category.skills) {
        const hit = bySlug.get(expected.slug)
        assert.ok(hit, `${expected.slug} 必须在 tiktok-agent 货架上`)
        assert.equal(hit.skill, expected.slug, `${expected.slug} 的 skill 应与 slug 同值`)
        assert.equal(hit.name, expected.name)
        assert.equal(hit.title, expected.name)
        assert.equal(hit.titleZh, expected.name)
        assert.equal(hit.titleEn, expected.titleEn, `${expected.slug} 的英文标题必须是行业通行英文名`)
        assert.equal(hit.category, category.id)
        assert.equal(hit.description, expected.description)
        assert.equal(hit.summary, expected.description)
        assert.equal(hit.bundled, true, `${expected.slug} 必须由真实随包清单派生 bundled: true`)
        assert.equal(hit.available, true, `${expected.slug} 必须为可用态`)
        assert.equal(hit.isHot, false)
        assert.equal(hit.isNew, false)
        assert.equal(hit.downloads, 0)
        assert.equal(hit.cover, `catalog/covers/skills/skill-card-${hit.coverIndex}.webp`)
        assert.match(hit.cover, /^catalog\/covers\/skills\/skill-card-[a-z0-9-]+\.webp$/, `${expected.slug} 的封面路径必须合规：${hit.cover}`)
        const localCover = join(MARKET_ROOT, hit.cover)
        const cdnCover = `https://dl.omnimux.ai/market/${hit.cover.slice('catalog/'.length)}`
        assert.ok(existsSync(localCover) || /^https:\/\//.test(cdnCover), `${expected.slug} 的封面必须本地内置或可经 CDN 解析：${hit.cover}`)
        assert.ok(resolveRealSkillMd(expected.slug), `${expected.slug} 必须有真实磁盘 SKILL.md`)
      }
    }
  })

  it('omni-agent 与 tiktok-agent 保持同一份恢复内容（默认菜单与快捷方式不打架）', () => {
    const tiktok = getPresetSkillBinding('tiktok-agent')
    const omni = getPresetSkillBinding('omni-agent')
    assert.ok(omni)
    for (const { id } of RESTORED_CATEGORIES) {
      assert.ok(omni.categories.some((c) => c.id === id), `omni-agent 缺分类 ${id}`)
      assert.equal(
        omni.skills.filter((s) => s.category === id).length,
        tiktok.skills.filter((s) => s.category === id).length,
        `omni-agent 的 ${id} 技能数与 tiktok-agent 不一致`,
      )
    }
    for (const { slug } of QUICK_SHORTCUT_SKILLS) {
      assert.ok(omni.skills.some((s) => String(s.slug || s.skill) === slug), `omni-agent 缺 ${slug}`)
    }
  })

  it('新增 15 款的字段集与既有条目完全一致（不再漏 titleEn）', () => {
    const presetPairs = [
      ['tiktok-agent', AGENT_PRESET_SKILL_BINDINGS['tiktok-agent']],
      ['omni-agent', AGENT_PRESET_SKILL_BINDINGS['omni-agent']],
    ]
    for (const [presetId, presetEntry] of presetPairs) {
      const rawSkills = presetEntry.skills
      const fieldsOf = (item) => Object.keys(item).sort().join(',')
      const rawShapes = new Set(rawSkills.map(fieldsOf))
      assert.equal(rawShapes.size, 1, `${presetId} 原始货架条目的字段集必须只有一种形状`)
      for (const raw of rawSkills) {
        assert.equal(Object.hasOwn(raw, 'installed'), false, `${presetId} 的 ${raw.slug} 不得包含静态 installed 字段`)
        assert.ok(
          typeof raw.titleEn === 'string' && raw.titleEn.trim().length > 0,
          `${presetId} 的 ${raw.slug} 必须有非空 titleEn（英文界面标题）`,
        )
      }
      // hydratePresetSkill 忽略伪造的静态 installed: true
      const fake = hydratePresetSkill({ slug: 'non-existent-hollow-skill', installed: true })
      assert.equal(fake.bundled, false)
      assert.equal(fake.installed, false)
      assert.equal(fake.available, false)
    }
  })
})
