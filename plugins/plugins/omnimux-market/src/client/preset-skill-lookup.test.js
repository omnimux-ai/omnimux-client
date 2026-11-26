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

/** 四条快捷方式（Issue #2562 / #235 / #337）默认绑定的技能。 */
const QUICK_SHORTCUT_SKILLS = [
  { slug: 'replicate-viral-video', name: '复刻爆款视频' },
  { slug: 'video-hook-analysis', name: '拆解视频' },
  { slug: 'create-selling-video', name: '创作带货视频' },
  { slug: 'reverse-video-prompt', name: '视频转提示词' },
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
      { slug: 'replicate-viral-video', name: '复刻爆款视频', titleEn: 'Replicate Viral Video', description: '参考爆款视频结构，生成同款商品带货视频' },
      { slug: 'create-selling-video', name: '创作带货视频', titleEn: 'Create Selling Video', description: '从商品或参考视频出发，直接生成带货视频' },
      { slug: 'video-hook-analysis', name: '拆解视频', titleEn: 'Video Breakdown', description: '提取字幕与脚本，拆解钩子、卖点和分镜' },
      { slug: 'reverse-video-prompt', name: '视频转提示词', titleEn: 'Reverse Video Prompt', description: '解析参考视频镜头与动作，生成 AI 视频提示词' },
      { slug: 'omnimux-ecom-video-script', name: '写带货脚本', titleEn: 'E-commerce Video Script', description: '提炼商品卖点，生成分镜、口播与时长脚本' },
      { slug: 'cinematic-motion-language', name: '生成运镜提示词', titleEn: 'Cinematic Motion Language', description: '将画面创意转为推拉摇移与景别运镜提示词' },
      { slug: 'global-ad-localizer', name: '视频多语改编', titleEn: 'Global Ad Localizer', description: '保留商品画面，将视频适配为多国家语言版本' },
      { slug: 'clip-export', name: '导出剪辑草稿', titleEn: 'Clip Draft Export', description: '将素材、字幕与配音打包为剪映/CapCut 草稿' },
    ],
  },
  {
    id: '创作图片',
    skills: [
      { slug: 'shoppable-carousel', name: '制作商品轮播图', titleEn: 'Shoppable Carousel', description: '按商品图规划逐页轮播文案与生图提示词' },
      { slug: 'replicate-carousel', name: '复刻爆款图文', titleEn: 'Carousel Replication', description: '拆解参考图文结构，为商品生成原创轮播图' },
      { slug: 'ecommerce-image', name: '生成电商套图', titleEn: 'E-commerce Product Images', description: '保留商品外观，一键生成主图、卖点与场景图' },
      { slug: 'omnimux-ecom-visual-qa', name: '商详9图质检', titleEn: '9-Image Visual QA', description: '规划 9 张商详套图，检查白底、占比与合规' },
      { slug: 'dynamic-poster', name: '生成动态海报', titleEn: 'Dynamic Poster', description: '基于产品实拍图，制作带微动态效果的海报' },
      { slug: 'character-scene-storyboard', name: '生成分镜设定图', titleEn: 'Character & Scene Storyboard', description: '根据参考图和剧本，生成三视图与 12 格分镜' },
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
