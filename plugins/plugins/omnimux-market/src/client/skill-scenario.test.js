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

test('场景 taxonomy：8 个场景，每个都有成员，114 个技能无未映射孤儿', () => {
  assert.deepEqual(SKILL_SCENARIOS.map((row) => row.id), [
    'scene-seeding', 'scene-brand', 'scene-product', 'scene-performance',
    'scene-app', 'scene-local', 'scene-repurpose', 'scene-tools',
  ])
  const declared = new Set(SKILL_SCENARIOS.map((row) => row.id))
  const orphans = skills.filter((item) => !declared.has(item.scenario)).map((item) => item.id)
  assert.deepEqual(orphans, [], '每个技能必须有已声明的 scenario')
  for (const row of SKILL_SCENARIOS) {
    assert.ok(skills.some((item) => item.scenario === row.id), `${row.id} 必须有成员`)
  }
  const counts = skillScenarioCounts()
  assert.equal(counts.total, skills.length)
  assert.equal(Object.values(counts.byId).reduce((sum, n) => sum + n, 0), skills.length)
})

test('场景过滤：显式 scenario 命中，旧 category 条目按兼容映射命中', () => {
  const ugc = skills.find((item) => item.title === 'UGC 告白')
  assert.equal(scenarioForItem(ugc), 'scene-seeding')
  assert.equal(matchesScenarioTag(ugc, 'scene-seeding'), true)
  assert.equal(matchesScenarioTag(ugc, 'scene-brand'), false)

  // 已安装技能没有 scenario 时，按 slug 从目录回查
  assert.equal(scenarioForItem({ skill: 'ugc-confessional', category: '' }), 'scene-seeding')
  // 既没有 scenario 也没有目录命中的预设条目，按旧 category 兼容映射
  assert.equal(scenarioForItem({ category: 'product-showcase' }), 'scene-product')
  assert.equal(scenarioForItem({ category: 'other' }), 'scene-tools')
})

test('场景分类栏：全部 + 8 个场景，数量为真实目录计数', () => {
  const categories = buildWorkshopCategories(null)
  assert.equal(categories.length, 9)
  assert.equal(categories[0].id, '')
  assert.equal(categories[0].count, skills.length)
  for (const category of categories.slice(1)) {
    assert.ok(category.count > 0, `${category.id} 数量必须为正`)
  }
  assert.equal(categories.slice(1).reduce((sum, category) => sum + category.count, 0), skills.length)
})
