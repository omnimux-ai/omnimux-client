import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  SKILL_SCENARIOS,
  matchesScenarioTag,
  scenarioForItem,
  skillScenarioCounts,
} from './skill-picker-logic.js'
import { buildWorkshopCategories } from './plaza/usePlazaFilter.js'

const catalog = JSON.parse(readFileSync(new URL('../../catalog/index.json', import.meta.url), 'utf8'))
const skills = catalog.items.filter((item) => item.kind === 'skill')

test('场景 taxonomy：6 个垂直场景，每个都有成员，36 个技能无未映射孤儿', () => {
  assert.deepEqual(SKILL_SCENARIOS.map((row) => row.id), [
    'scene-video', 'scene-replicate', 'scene-visual', 'scene-research',
    'scene-growth', 'scene-tools',
  ])
  const declared = new Set(SKILL_SCENARIOS.map((row) => row.id))
  const orphans = skills.filter((item) => !declared.has(item.scenario)).map((item) => item.id)
  assert.deepEqual(orphans, [], '每个技能必须有已声明的 scenario')
  for (const row of SKILL_SCENARIOS) {
    assert.ok(skills.some((item) => item.scenario === row.id), `${row.id} 必须有成员`)
  }
  const counts = skillScenarioCounts()
  assert.equal(counts.total, 36)
  assert.equal(counts.total, skills.length)
  assert.equal(Object.values(counts.byId).reduce((sum, n) => sum + n, 0), skills.length)
})

test('场景过滤：显式 scenario 命中，旧 category 条目按兼容映射命中', () => {
  const sample = skills.find((item) => item.skill === 'stickman-video-director')
  assert.equal(scenarioForItem(sample), 'scene-video')
  assert.equal(matchesScenarioTag(sample, 'scene-video'), true)
  assert.equal(matchesScenarioTag(sample, 'scene-visual'), false)

  // 已安装技能没有 scenario 时，按 slug 从目录回查
  assert.equal(scenarioForItem({ skill: 'stickman-video-director', category: '' }), 'scene-video')
  // 既没有 scenario 也没有目录命中的预设条目，按旧 category 兼容映射
  assert.equal(scenarioForItem({ category: 'product-showcase' }), 'scene-visual')
  assert.equal(scenarioForItem({ category: 'other' }), 'scene-tools')
})

test('场景分类栏：全部 + 6 个垂直场景，数量为真实目录计数', () => {
  const categories = buildWorkshopCategories(null)
  assert.equal(categories.length, 7)
  assert.equal(categories[0].id, '')
  assert.equal(categories[0].count, 36)
  for (const category of categories.slice(1)) {
    assert.ok(category.count > 0, `${category.id} 数量必须为正`)
  }
  assert.equal(categories.slice(1).reduce((sum, category) => sum + category.count, 0), skills.length)
})

test('场景命名规范：4 字纯中文上位词（禁拼接）与多源字典一致 (Issue #397)', () => {
  assert.equal(SKILL_SCENARIOS.length, 6)

  const categoriesTs = readFileSync(new URL('../categories.ts', import.meta.url), 'utf8')
  const marketI18n = readFileSync(new URL('./i18n.js', import.meta.url), 'utf8')
  const featuredCard = readFileSync(new URL('./plaza/FeaturedCard.jsx', import.meta.url), 'utf8')
  const hubCatalog = readFileSync(new URL('../../../omnimux/src/client/session-guide/catalog.js', import.meta.url), 'utf8')
  const skillCard = readFileSync(new URL('../../../omnimux/src/client/session-guide/skills/SkillCard.jsx', import.meta.url), 'utf8')

  const catalogCats = Array.isArray(catalog.categories) ? catalog.categories : []
  const skillCats = Array.isArray(catalog.skillCategories) ? catalog.skillCategories : []
  const catalogScenarios = Array.isArray(catalog.skillScenarios) ? catalog.skillScenarios : []

  for (const row of SKILL_SCENARIOS) {
    assert.match(row.titleZh, /^[\p{Script=Han}]{4}$/u, `${row.id} 中文名须为 4 字纯汉字: ${row.titleZh}`)
    assert.doesNotMatch(row.titleZh, /[与和及、/·]/, `${row.id} 不得使用拼接符: ${row.titleZh}`)
    assert.match(row.titleEn, /^[A-Za-z][A-Za-z &]{2,22}[A-Za-z]$/, `${row.id} 英文名须精炼且 <= 24 字符: ${row.titleEn}`)

    const catRow = catalogCats.find((entry) => entry.id === row.id)
    assert.equal(catRow?.title, row.titleZh, `catalog.categories ${row.id} title 须对齐`)

    const skillCatRow = skillCats.find((entry) => entry.id === row.id)
    assert.equal(skillCatRow?.title, row.titleZh, `catalog.skillCategories ${row.id} title 须对齐`)
    assert.equal(skillCatRow?.titleZh, row.titleZh, `catalog.skillCategories ${row.id} titleZh 须对齐`)
    assert.equal(skillCatRow?.titleEn, row.titleEn, `catalog.skillCategories ${row.id} titleEn 须对齐`)

    const scenarioRow = catalogScenarios.find((entry) => entry.id === row.id)
    assert.equal(scenarioRow?.title, row.titleZh, `catalog.skillScenarios ${row.id} title 须对齐`)
    assert.equal(scenarioRow?.titleZh, row.titleZh, `catalog.skillScenarios ${row.id} titleZh 须对齐`)
    assert.equal(scenarioRow?.titleEn, row.titleEn, `catalog.skillScenarios ${row.id} titleEn 须对齐`)

    assert.ok(
      categoriesTs.includes(`id: '${row.id}', titleZh: '${row.titleZh}', titleEn: '${row.titleEn}'`),
      `categories.ts 须同步 ${row.id} -> ${row.titleZh} / ${row.titleEn}`,
    )
    assert.ok(marketI18n.includes(`"cat.${row.id}": "${row.titleZh}"`), `market i18n.js ZH 缺少 ${row.id}`)
    assert.ok(marketI18n.includes(`"cat.${row.id}": "${row.titleEn}"`), `market i18n.js EN 缺少 ${row.id}`)
    assert.ok(featuredCard.includes(`'${row.id}': '${row.titleZh}'`), `FeaturedCard.jsx ZH 缺少 ${row.id}`)
    assert.ok(featuredCard.includes(`'${row.id}': '${row.titleEn}'`), `FeaturedCard.jsx EN 缺少 ${row.id}`)
    assert.ok(hubCatalog.includes(`"skills.category.${row.id}": "${row.titleZh}"`), `hub catalog.js ZH 缺少 ${row.id}`)
    assert.ok(hubCatalog.includes(`"skills.category.${row.id}": "${row.titleEn}"`), `hub catalog.js EN 缺少 ${row.id}`)
    assert.ok(skillCard.includes(`'${row.id}': '${row.titleZh}'`), `SkillCard.jsx 缺少 ${row.id}`)
  }

  const retiredLabels = [
    '短视频创作',
    '爆款复刻与再制',
    '商品视觉与海报',
    '选品与社媒洞察',
    '投放与增长运营',
    '剪辑与效率工具',
    'Visual & Product',
    'Market & Social Research',
    'Ads & Growth Ops',
  ]
  for (const retired of retiredLabels) {
    assert.ok(!featuredCard.includes(retired), `FeaturedCard.jsx 不得残留旧场景名: ${retired}`)
    assert.ok(!skillCard.includes(retired), `SkillCard.jsx 不得残留旧场景名: ${retired}`)
    assert.ok(!marketI18n.includes(`"${retired}"`), `market i18n.js 不得残留旧场景名: ${retired}`)
    assert.ok(!hubCatalog.includes(`"${retired}"`), `hub catalog.js 不得残留旧场景名: ${retired}`)
    for (const item of skills) {
      assert.notEqual(item.subtitle, retired, `${item.id} subtitle 不得残留旧场景名: ${retired}`)
      const itemTags = Array.isArray(item.tags) ? item.tags : []
      assert.ok(!itemTags.includes(retired), `${item.id} tags 不得残留旧场景名: ${retired}`)
    }
  }
})
