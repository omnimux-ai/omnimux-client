/**
 * @file plugins/omnimux-market/tests/e2e/aigc-category.spec.js
 * E2E：技能工坊分类栏旅程（分类可见 → 目录成员 → 安装源）。
 *
 * 本 spec 以目录 `skillScenarios` 为场景分类真源，断言「全部」+ 8 个场景均有成员，
 * 且每个技能恰好归属一个场景。
 *
 * - 数据真源：`plugins/omnimux-market/catalog/index.json`（直接读文件，不另造 fixture）。
 * - 文案真源：`src/client/i18n.js` 的真实字典（断言用户可见中文/英文，不是 key）。
 * - 规则真源：`src/client/plaza/usePlazaFilter.js` 的真实实现，不复制第二份过滤逻辑。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { buildWorkshopCategories } from '../../src/client/plaza/usePlazaFilter.js'

const catalog = JSON.parse(readFileSync(new URL('../../catalog/index.json', import.meta.url), 'utf8'))
const i18nSrc = readFileSync(new URL('../../src/client/i18n.js', import.meta.url), 'utf8')

function label(locale, key) {
  const hits = [...i18nSrc.matchAll(new RegExp('"' + key + '":\\s*"([^"]+)"', 'g'))].map((m) => m[1])
  return locale === 'zh' ? hits[0] : hits[1]
}

function tr(locale) {
  return (key) => (key === 'locale' ? locale : (label(locale, key) || key))
}

const skillScenarios = Array.isArray(catalog.skillScenarios) ? catalog.skillScenarios : []
const skills = catalog.items.filter((it) => it.kind === 'skill' && (it.tab || 'skills') === 'skills')

test('E2E 分类栏：中英文界面与目录声明的场景分类一致', () => {
  const zh = buildWorkshopCategories(null, tr('zh'))
  const en = buildWorkshopCategories(null, tr('en'))
  assert.deepEqual(zh.map((c) => c.id), ['', ...skillScenarios.map((c) => c.id)])
  assert.equal(zh.length, 7)
  for (const cat of skillScenarios) {
    assert.ok(zh.find((c) => c.id === cat.id).label, `zh label missing for ${cat.id}`)
    assert.ok(en.find((c) => c.id === cat.id).label, `en label missing for ${cat.id}`)
  }
})

test('E2E 目录数据：每个场景分类都真实拥有技能成员', () => {
  const members = (id) => skills.filter((it) => it.scenario === id)
  for (const cat of skillScenarios) {
    assert.ok(members(cat.id).length > 0, `${cat.id} must have members`)
  }
  // 全部技能只落在声明过的场景内，不漂移
  const declared = new Set(skillScenarios.map((c) => c.id))
  const orphans = skills.filter((it) => !declared.has(it.scenario)).map((it) => it.id)
  assert.deepEqual(orphans, [], 'skills must belong to a declared scenario')
})

test('E2E 安装源：场景技能全部为内置 bundled 源', () => {
  for (const item of skills) {
    assert.equal(item.source?.type, 'bundled', `${item.id} must be bundled`)
    assert.ok(String(item.source.path || '').startsWith('catalog/skills/'), `${item.id} bad bundled path`)
  }
})
