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
