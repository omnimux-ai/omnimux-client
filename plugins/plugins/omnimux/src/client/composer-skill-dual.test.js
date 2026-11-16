import test from 'node:test'
import assert from 'node:assert/strict'
import { wrapSkillInputTriggerSource } from './composer-commands-i18n.js'
import {
  draftHasSkillToken,
  findSkillTokenRange,
  removeSkillTokenFromDraft,
} from './composer-add/skill-token.ts'

function installWindow({ activeSkill = null, draft = '' } = {}) {
  const events = []
  const removed = []
  const actions = {
    getDraft: () => draft,
    setDraft: (next) => { draft = next },
    removeSkillToken: (slug) => {
      removed.push(slug)
      const next = removeSkillTokenFromDraft(draft, slug)
      if (next === draft) return false
      draft = next
      return true
    },
  }
  const win = {
    __omnimuxActiveSkill: activeSkill,
    __omnimuxComposerActions: actions,
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type
        this.detail = init?.detail
      }
    },
    dispatchEvent(event) { events.push(event) },
  }
  globalThis.window = win
  return {
    win,
    actions,
    events,
    removed,
    get draft() { return draft },
    setDraft(next) { draft = next },
  }
}

function makeSource(rawName = 'new-skill', displayName = rawName) {
  return {
    trigger: '/',
    name: 'skill',
    async candidates() {
      return [{ name: displayName, rawName }]
    },
    onPick({ candidate }) { return { text: `/${candidate.name} ` } },
  }
}

function makeWrapped(source) {
  return wrapSkillInputTriggerSource(source, { getSnapshot: () => ({ active: 'zh-CN' }) })
}

test('skill-token：按 ui-conversation 词边界识别并删除 /slug token', () => {
  assert.deepEqual(findSkillTokenRange('/alpha hi', 'alpha'), { start: 0, end: 7 })
  assert.deepEqual(findSkillTokenRange('hello /alpha world', 'alpha'), { start: 6, end: 13 })
  assert.equal(removeSkillTokenFromDraft('/alpha hi', 'alpha'), 'hi')
  assert.equal(removeSkillTokenFromDraft('hello /alpha world', 'alpha'), 'hello world')
  assert.equal(removeSkillTokenFromDraft('x/alpha hi', 'alpha'), 'x/alpha hi')
  assert.equal(draftHasSkillToken('/alpha', 'alpha'), true)
  assert.equal(draftHasSkillToken('/alpha.md', 'alpha'), false)
})

test('场景1 斜杠选择：保留 /slug token，广播 origin=slash 供胶囊同步', () => {
  const env = installWindow()
  try {
    const wrapped = makeWrapped(makeSource('new-skill', '新技能'))
    const outcome = wrapped.onPick({
      candidate: { name: '新技能', rawName: 'new-skill' },
      session: { sessionId: 's1' },
      position: 'leading',
      via: 'menu',
      action: 'pick',
      span: { start: 0, end: 1 },
    })
    assert.equal(outcome.text, '/new-skill ', '必须把官方 /raw-slug 文本交回编辑器')
    assert.equal(env.win.__omnimuxActiveSkill.slug, 'new-skill')
    assert.equal(env.win.__omnimuxActiveSkill.name, '新技能')
    assert.equal(env.win.__omnimuxActiveSkill.origin, 'slash')
    const changed = env.events.find((event) => event.type === 'omnimux:skill:changed')
    assert.equal(changed?.detail?.skill?.origin, 'slash', '胶囊订阅方必须收到同一个 slash 身份')
    assert.ok(!env.events.some((event) => event.type === 'omnimux:skill:attach-request'), '原生斜杠不得请求会话试用挂载')
  } finally {
    delete globalThis.window
  }
})

test('wrapSkillInputTriggerSource：切换到另一个原生技能时异步移除旧 token', async () => {
  const env = installWindow({
    activeSkill: { slug: 'old-skill', origin: 'slash' },
    draft: '/old-skill 保留正文',
  })
  try {
    const wrapped = makeWrapped(makeSource('new-skill'))
    const outcome = wrapped.onPick({
      candidate: { name: 'new-skill' },
      session: { sessionId: 's1' },
      position: 'leading',
      via: 'menu',
      action: 'pick',
      span: { start: 0, end: 1 },
    })
    assert.equal(outcome.text, '/new-skill ')
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.deepEqual(env.removed, ['old-skill'])
    assert.equal(env.win.__omnimuxActiveSkill.slug, 'new-skill')
    assert.equal(env.win.__omnimuxActiveSkill.origin, 'slash')
  } finally {
    delete globalThis.window
  }
})

test('场景3 自定义→原生：正文插入 /native-b，胶囊切换为 origin=slash', () => {
  const env = installWindow({
    activeSkill: { slug: 'custom-a', name: '自定义 A', origin: 'custom' },
    draft: '保留正文',
  })
  try {
    const wrapped = makeWrapped(makeSource('native-b', '原生 B'))
    const outcome = wrapped.onPick({
      candidate: { name: '原生 B', rawName: 'native-b' },
      session: { sessionId: 's1' },
      position: 'leading',
      via: 'menu',
      action: 'pick',
      span: { start: 0, end: 1 },
    })
    assert.equal(outcome.text, '/native-b ', '自定义切原生必须把官方 token 插入正文')
    assert.equal(env.win.__omnimuxActiveSkill.slug, 'native-b')
    assert.equal(env.win.__omnimuxActiveSkill.origin, 'slash')
    const changed = env.events.at(-1)
    assert.equal(changed.type, 'omnimux:skill:changed')
    assert.equal(changed.detail.skill.origin, 'slash')
    assert.ok(!env.events.some((event) => event.type === 'omnimux:skill:attach-request'))
  } finally {
    delete globalThis.window
  }
})

test('场景3 同一技能重复选择：只保留一个 /slug token', async () => {
  const env = installWindow({
    activeSkill: { slug: 'same-skill', origin: 'slash' },
    draft: '正文 /same-skill /',
  })
  try {
    const wrapped = makeWrapped(makeSource('same-skill'))
    const outcome = wrapped.onPick({
      candidate: { name: 'same-skill' },
      session: { sessionId: 's1' },
      position: 'leading',
      via: 'menu',
      action: 'pick',
      span: { start: 0, end: 1 },
    })
    assert.equal(outcome.text, '/same-skill ')
    // 模拟官方 onPick 插入：新 token 替换刚输入的 `/`，此时草稿里短暂有两个 token。
    env.setDraft('正文 /same-skill /same-skill ')
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal((env.draft.match(/\/same-skill/g) || []).length, 1, '同一技能不能并存两个 token')
    assert.equal(env.win.__omnimuxActiveSkill.slug, 'same-skill')
  } finally {
    delete globalThis.window
  }
})
