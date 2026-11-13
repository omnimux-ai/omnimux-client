import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPlazaTools, listPlazaLocal, PLAZA_PROMPT_LINES, renderPlazaSearch, tokenizePlazaQuery } from '../plaza-tools.js'

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..')

type Item = Record<string, unknown>

function item(partial: Item): Item {
  return {
    tab: 'experts',
    kind: 'expert',
    subtitle: '',
    summary: '领域摘要',
    category: 'product',
    tags: [],
    avatar: '',
    installed: false,
    skill: 'esc-demo-note',
    source: { type: 'bundled', path: 'catalog/skills/esc-demo-note/SKILL.md' },
    ...partial,
  }
}

function catalog(items: Item[]) {
  return { schema: 1, generated_at: 't', tabs: ['experts', 'skills', 'connectors'], categories: [], featured: [], items }
}

function roots() {
  const home = mkdtempSync(join(tmpdir(), 'omx-plaza-'))
  const profileDir = join(home, 'profiles', 'omnimux')
  mkdirSync(profileDir, { recursive: true })
  mkdirSync(join(home, 'skills'), { recursive: true })
  return { home, profileDir, packageRoot: PACKAGE_ROOT }
}

function toolsFor(items: Item[], env = roots()) {
  const doc = catalog(items)
  const all = createPlazaTools(() => env, () => doc)
  const byName = Object.fromEntries(all.map((t) => [t.name, t]))
  return { env, byName, doc }
}

test('PLAZA_PROMPT_LINES require composer chips and persist attachment', () => {
  const text = PLAZA_PROMPT_LINES.join(' ')
  assert.match(text, /plaza_search/)
  assert.match(text, /same user message/)
  assert.match(text, /ask_user_question/)
  assert.match(text, /id · /)
  assert.match(text, /skip · 不用专家/)
  assert.match(text, /plaza_summon\(\{ id \}\)/)
  assert.match(text, /persists the expert/)
  assert.match(text, /Copy each expert option label VERBATIM/)
  assert.match(text, /skillhub_search/)
  // 判别式触发：心理测试/测评/MBTI 这类任务也应触发，避免枚举过窄漏触发
  assert.match(text, /psychological tests\/assessments/)
  assert.match(text, /expert methodology, rubric, or framework materially improves the outcome/)
  // 老板决策：「专家 > 技能」。优先分配专家身份（自带 skill），技能只在无专家时才兜底
  assert.match(text, /PRIORITY RULE \(experts beat skills\)/)
  assert.match(text, /Do NOT use the skill tool to inject a matching-sounding skill/)
  assert.match(text, /fall back to the skill tool after plaza_search returns zero experts/)
  assert.doesNotMatch(text, /Never plaza_summon unless the user clicked a card/)
})

test('plaza_search has no hub parameter', () => {
  const { byName } = toolsFor([])
  assert.equal((byName.plaza_search.parameters as { hub?: unknown }).hub, undefined)
})

test('keyword filter matches title summary tags id', () => {
  const found = listPlazaLocal(catalog([
    item({ id: 'exp-prd', title: '产品通', summary: '写 PRD 和路线图', tags: ['产品'] }),
    item({ id: 'exp-legal', title: '法务顾问', summary: '审合同', tags: ['法律'] }),
  ]), 'prd', 'experts', 3)
  assert.equal(found.list.length, 1)
  assert.equal(found.list[0].id, 'exp-prd')
})

test('tokenizePlazaQuery splits phrases and keeps chinese bigrams', () => {
  const tokens = tokenizePlazaQuery('PRD 产品经理 插件产品需求')
  assert.equal(tokens.includes('prd'), true)
  assert.equal(tokens.includes('产品'), true)
  assert.equal(tokens.includes('经理'), true)
  assert.equal(tokens.includes('插件'), true)
  assert.equal(tokens.includes('prd 产品经理 插件产品需求'), false)
})

test('model phrase query still hits product experts', () => {
  const found = listPlazaLocal(catalog([
    item({ id: 'exp-product-management', title: '产品管理专家', summary: '功能规格编写、路线图规划' }),
    item({ id: 'exp-product-strategy-team', title: '产品战略与管理', kind: 'team', summary: '需求分析师（PRD/功能规格书）' }),
    item({ id: 'exp-legal', title: '法务顾问', summary: '审合同', tags: ['法律'] }),
    item({ id: 'exp-video', title: '视频生成专家', summary: 'Remotion 渲染' }),
  ]), 'PRD 产品经理 插件产品需求', 'experts', 3)
  assert.equal(found.list.length >= 2, true)
  const ids = found.list.map((it) => it.id)
  assert.equal(ids.includes('exp-product-management'), true)
  assert.equal(ids.includes('exp-product-strategy-team'), true)
  assert.equal(ids.includes('exp-legal'), false)
})

test('default tab is experts; skills and connectors are dropped by kind', () => {
  const found = listPlazaLocal(catalog([
    item({ id: 'exp-a', title: '专家甲', summary: '擅长产品' }),
    item({ id: 'team-a', title: '专家团', summary: '团', kind: 'team' }),
    item({ id: 'sk-pdf', title: 'PDF', summary: '技能', tab: 'skills', kind: 'skill', skill: 'pdf' }),
    item({ id: 'cn-x', title: '连接器', summary: 'mcp', tab: 'connectors', kind: 'connector', skill: undefined, serverName: 'x' }),
  ]), '', 'experts', 3)
  assert.deepEqual(found.list.map((it) => it.id), ['exp-a', 'team-a'])
})

test('limit clamps to 3 even when caller asks for more', async () => {
  const items = [1, 2, 3, 4, 5].map((n) => item({ id: `exp-${n}`, title: `专家${n}`, summary: `摘要${n}` }))
  const { byName } = toolsFor(items)
  const result = await byName.plaza_search.execute({ query: '', limit: 99 }) as { items: Item[] }
  assert.equal(result.items.length, 3)
  assert.deepEqual(result.items.map((it) => it.id), ['exp-1', 'exp-2', 'exp-3'])
  for (const card of result.items) {
    assert.equal('id' in card && 'title' in card && 'summary' in card, true)
    assert.equal('kind' in card && 'avatar' in card && 'installed' in card && 'skill' in card, true)
  }
})

test('plaza_search model render lists catalog id labels so chips are not invented', async () => {
  const items = [
    item({ id: 'exp-product-management', title: '产品管理专家', summary: '写 PRD 和路线图' }),
    item({ id: 'exp-legal', title: '法务顾问', summary: '审合同' }),
  ]
  const { byName } = toolsFor(items)
  const result = await byName.plaza_search.execute({ query: '' }) as { items: Item[] }
  const rendered = byName.plaza_search.output.render({}, result) as Array<{ text?: string }>
  const text = rendered.map((block) => block.text || '').join('\n')
  assert.match(text, /exp-product-management · 产品管理专家/)
  assert.match(text, /exp-legal · 法务顾问/)
  assert.match(text, /skip · 不用专家/)
  assert.match(text, /禁止发明 id/)
  const standalone = renderPlazaSearch({ items: result.items })
  assert.match(standalone, /label=`exp-product-management · 产品管理专家`/)
})

test('zero hits return an empty items array, not an error object', async () => {
  const { byName } = toolsFor([item({ id: 'exp-prd', title: '产品通', summary: '写 PRD' })])
  const result = await byName.plaza_search.execute({ query: 'zzz-no-such-keyword' }) as { items: Item[], total: number }
  assert.deepEqual(result.items, [])
  assert.equal(result.total, 0)
  assert.equal((result as { ok?: boolean }).ok, undefined)
})

test('connector summon throws; does not return {ok:false}', async () => {
  const { byName } = toolsFor([
    item({
      id: 'cn-tencent-docs',
      tab: 'connectors',
      kind: 'connector',
      title: '腾讯文档',
      summary: '连接器',
      skill: undefined,
      serverName: 'tencent-docs',
      source: { type: 'mcp', transport: 'stdio', command: 'npx', args: [] },
    }),
  ])
  await assert.rejects(() => byName.plaza_summon.execute({ id: 'cn-tencent-docs' }), /not summoned/)
})

test('unknown id and non-expert skill throw', async () => {
  const { byName } = toolsFor([
    item({ id: 'sk-note', tab: 'skills', kind: 'skill', title: '笔记', summary: '技能条目' }),
  ])
  await assert.rejects(() => byName.plaza_summon.execute({ id: 'no-such' }), /unknown item/)
  await assert.rejects(() => byName.plaza_summon.execute({ id: 'sk-note' }), /not an expert or team/)
})

test('summon installs first then returns full fields', async () => {
  const env = roots()
  const { byName } = toolsFor([
    item({ id: 'exp-demo', title: '产品通', summary: '写 PRD 的专家', skill: 'esc-demo-note' }),
  ], env)
  const result = await byName.plaza_summon.execute({ id: 'exp-demo' }) as Record<string, unknown>
  assert.equal(result.id, 'exp-demo')
  assert.equal(result.skill, 'esc-demo-note')
  assert.equal(result.gesture, '/esc-demo-note')
  assert.equal(result.installed, true)
  assert.equal('stagePreset' in result, true)
  assert.equal((result as { ok?: boolean }).ok, undefined)
  assert.equal(existsSync(join(env.home, 'skills', 'esc-demo-note', 'SKILL.md')), true)
})

test('summon with session exec writes durable attach; later search skips', async () => {
  const env = roots()
  const { byName } = toolsFor([
    item({ id: 'exp-demo', title: '产品通', summary: '写 PRD 的专家', skill: 'esc-demo-note' }),
  ], env)
  const exec = { agent: { session: { header: { id: 'sess-qa-1' } } } }
  const summoned = await byName.plaza_summon.execute({ id: 'exp-demo' }, exec) as Record<string, unknown>
  assert.equal(summoned.attached, true)
  assert.equal(summoned.sessionId, 'sess-qa-1')
  assert.equal(existsSync(join(env.home, 'omnimux-market', 'sessions', 'sess-qa-1.json')), true)
  const search = await byName.plaza_search.execute({ query: 'prd' }, exec) as { items: unknown[]; skipped?: string }
  assert.deepEqual(search.items, [])
  assert.equal(search.skipped, 'already-attached')
})

test('plaza_install rejects the expert path', async () => {
  const { byName } = toolsFor([item({ id: 'exp-demo', title: '产品通', summary: '写 PRD' })])
  await assert.rejects(() => byName.plaza_install.execute({ id: 'exp-demo' }), /disabled for experts/)
})

test('plaza_install description points Agent to connector_install', () => {
  const { byName } = toolsFor([])
  assert.match(byName.plaza_install.description, /connector_install/)
})
