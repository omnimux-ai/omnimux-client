import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import * as SkillShelf from './skill-picker-logic.js'

const source = readFileSync(new URL('./skill-picker.js', import.meta.url), 'utf8')
const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) })
function walk(node, predicate) {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const child of node.children || []) {
    const match = walk(child, predicate)
    if (match) return match
  }
  return null
}

function sameDeps(a, b) {
  if (!a || !b || a.length !== b.length) return false
  return a.every((value, index) => Object.is(value, b[index]))
}

function harness({ draft = '', activeSkill = null, occurrences = [], withComposerActions = true } = {}) {
  const writes = []
  const events = []
  const apiCalls = []
  const setDraftCalls = []
  const removeCalls = []
  const insertCalls = []
  const slots = new Map()
  const effects = new Map()
  const listeners = new Map()
  let owner
  let cursor = 0
  let effectCursor = 0
  function slot(init) {
    const index = cursor++
    const state = slots.get(owner)
    if (!(index in state)) state[index] = init()
    return [state, index]
  }
  function render(name, component, props) {
    owner = name
    cursor = 0
    effectCursor = 0
    if (!slots.has(name)) slots.set(name, [])
    return component(props)
  }
  const window = {
    __omnimuxActiveSkill: activeSkill,
    __omnimuxSessions: { list: { getSnapshot: () => ({ current: 's1' }) } },
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type
        this.detail = init?.detail
      }
    },
    dispatchEvent(event) {
      events.push(event)
      for (const listener of listeners.get(event.type) || []) listener(event)
      return true
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(listener)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
  }
  const document = { body: {}, documentElement: { getAttribute: () => null }, querySelector: () => null }
  // skill-picker-logic.js 的订阅函数在自身模块作用域读取 window；测试宿主必须
  // 把同一份 window 暴露为全局，订阅链路才与浏览器里一致。
  globalThis.window = window
  const input = { draft, phase: 'plain', draftRev: 1, occurrences: [...occurrences] }
  const inputActions = {
    setDraft(value) {
      setDraftCalls.push(value)
      input.draft = value
      // 官方契约：整段替换纯文本时 inline reference chips 一并消失。
      input.occurrences = []
      writes.push(value)
    },
    insertText(text, span) {
      insertCalls.push({ text, span: { ...span } })
      input.draft = input.draft.slice(0, span.start) + text + input.draft.slice(span.end)
      writes.push(input.draft)
      return true
    },
  }
  if (withComposerActions) {
    window.__omnimuxComposerActions = {
      removeSkillToken(slug) {
        removeCalls.push(slug)
        const range = SkillShelf.findSkillTokenRange(input.draft, slug)
        if (!range) return false
        input.draft = input.draft.slice(0, range.start) + input.draft.slice(range.end)
        writes.push(input.draft)
        return true
      },
    }
  }
  const context = {
    h, SkillShelf, lookup: (key) => key, api: async (name, payload) => { apiCalls.push({ name, payload }); return { ok: true } },
    createSkillSession: async () => ({ ok: true, prefilled: true, sessionId: 's1' }),
    I18nProvider: 'I18nProvider', skillCreationInputs: new Map(), currentPlazaSessionId: () => 's1', CustomEvent: window.CustomEvent,
    activateSharedToolSkill: (value) => apiCalls.push({ name: 'activate', value }),
    useInput: (selector) => selector(input), inputActions,
    useState: (initial) => {
      const [state, index] = slot(() => (typeof initial === 'function' ? initial() : initial))
      return [state[index], (value) => {
        state[index] = typeof value === 'function' ? value(state[index]) : value
        writes.push(state[index])
      }]
    },
    useRef: (initial) => {
      const [state, index] = slot(() => ({ current: initial }))
      return state[index]
    },
    useEffect: (callback, deps) => {
      const key = `${owner}:${effectCursor++}`
      const previous = effects.get(key)
      if (previous && sameDeps(previous.deps, deps)) return
      try { previous?.cleanup?.() } catch {}
      const cleanup = callback()
      effects.set(key, { deps, cleanup })
    },
    useLayoutEffect: () => {},
    useCallback: (fn) => fn,
    SearchField: 'SearchField', createPortal: (node) => node, document, window,
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout,
  }
  const { SkillPickerButton, SkillPickerPanel } = runInNewContext(`${source}\n({SkillPickerButton,SkillPickerPanel})`, context)
  const buttonProps = { sessionId: 's1', inputActions, useInput: context.useInput }
  let button = render('button', SkillPickerButton, buttonProps)
  const renderButton = () => {
    button = render('button', SkillPickerButton, buttonProps)
    return button
  }
  const panel = walk(button, (node) => node.type === SkillPickerPanel)
  return {
    writes, events, apiCalls, window, input,
    setDraftCalls, removeCalls, insertCalls,
    renderButton,
    pick: panel.props.onPick,
    get button() { return button },
    get chip() {
      return walk(renderButton(), (node) => node.props && node.props.className === 'sh-active-skill-chip')
    },
    get chipLabel() {
      const chip = walk(renderButton(), (node) => node.props && node.props.className === 'sh-chip-label')
      return chip ? chip.children.join('') : ''
    },
    get close() {
      return walk(renderButton(), (node) => node.props && node.props.className === 'sh-chip-close')
    },
    emitSkillChanged(skill) {
      window.__omnimuxActiveSkill = skill
      window.dispatchEvent(new window.CustomEvent('omnimux:skill:changed', { detail: { skill } }))
      return renderButton()
    },
  }
}

test('场景2 按钮面板选择：只显示胶囊，正文不出现假 slash', async () => {
  const run = harness({ draft: '保留正文' })
  const picked = await run.pick({ slug: 'new-skill', name: '新技能', installed: true })
  assert.equal(picked, true)
  assert.equal(run.input.draft, '保留正文', '自定义选择不得改写正文')
  assert.ok(!run.input.draft.includes('/new-skill'), '自定义选择不得写假 token')
  assert.equal(run.window.__omnimuxActiveSkill.slug, 'new-skill')
  assert.equal(run.window.__omnimuxActiveSkill.origin, 'custom')
  assert.ok(run.chip, '选择后应渲染技能胶囊')
  assert.equal(run.chipLabel, '新技能')
  assert.ok(run.events.some((event) => event.detail?.skill?.origin === 'custom'))
  assert.equal(run.setDraftCalls.length, 0, '自定义选择不得用 setDraft 整段替换')
})

test('场景3 原生→自定义：移除已有 slash token，胶囊切到 custom，link chip 保留', async () => {
  const occurrences = [{ source: 'link', label: '参考视频', clipboardText: 'https://example.com/video' }]
  const run = harness({ draft: '/old-skill 保留正文', activeSkill: { slug: 'old-skill', name: '旧技能', origin: 'slash' }, occurrences })
  const picked = await run.pick({ slug: 'new-skill', name: '新技能', installed: true })
  assert.equal(picked, true)
  assert.equal(run.input.draft, '保留正文', '必须移除旧 slash token')
  assert.equal(run.window.__omnimuxActiveSkill.slug, 'new-skill')
  assert.equal(run.window.__omnimuxActiveSkill.origin, 'custom')
  assert.ok(!run.input.draft.includes('/new-skill'), '自定义选择不得写假 token')
  assert.equal(run.chipLabel, '新技能')
  assert.ok(run.events.some((event) => event.detail?.skill?.origin === 'custom'))
  assert.deepEqual(run.removeCalls, ['old-skill'], '必须走 bridge 的 revision 守卫 removeSkillToken')
  assert.equal(run.setDraftCalls.length, 0, '不得用 setDraft 整段替换（会清 inline reference chips）')
  assert.deepEqual(run.input.occurrences, occurrences, 'occurrences / link chip 必须保留')
})

test('场景3 自定义→原生：胶囊订阅 omnimux:skill:changed 后立即切到 slash 身份', async () => {
  const run = harness({ draft: '保留正文' })
  await run.pick({ slug: 'custom-a', name: '自定义 A', installed: true })
  assert.equal(run.chipLabel, '自定义 A')
  run.emitSkillChanged({ slug: 'native-b', name: '原生 B', origin: 'slash' })
  assert.equal(run.window.__omnimuxActiveSkill.slug, 'native-b')
  assert.equal(run.window.__omnimuxActiveSkill.origin, 'slash')
  assert.equal(run.chipLabel, '原生 B', '原生选择后胶囊必须跟随全局通道切到同一技能')
})

test('场景4 胶囊 ✕：清除 token + 胶囊 + 全局状态，link chip 保留', () => {
  const occurrences = [{ source: 'link', label: '参考视频', clipboardText: 'https://example.com/video' }]
  const run = harness({ draft: '/old-skill 保留正文', activeSkill: { slug: 'old-skill', name: '旧技能', origin: 'slash' }, occurrences })
  assert.ok(run.close, '应渲染技能胶囊关闭按钮')
  run.close.props.onClick({ stopPropagation() {} })
  assert.equal(run.input.draft, '保留正文', '清除时删除对应 slash token')
  assert.equal(run.window.__omnimuxActiveSkill, null)
  assert.ok(run.events.some((event) => event.detail?.skill === null))
  assert.equal(run.chip, null, '清除后胶囊必须消失')
  assert.deepEqual(run.removeCalls, ['old-skill'], '必须走 bridge 的 revision 守卫 removeSkillToken')
  assert.equal(run.setDraftCalls.length, 0, '不得用 setDraft 整段替换（会清 inline reference chips）')
  assert.deepEqual(run.input.occurrences, occurrences, 'occurrences / link chip 必须保留')
})

test('场景4 胶囊 ✕ 无 bridge 时回退官方 insertText，不用 setDraft', () => {
  const run = harness({ draft: '/old-skill 保留正文', activeSkill: { slug: 'old-skill', name: '旧技能', origin: 'slash' }, withComposerActions: false })
  assert.ok(run.close, '应渲染技能胶囊关闭按钮')
  run.close.props.onClick({ stopPropagation() {} })
  assert.equal(run.input.draft, '保留正文', '回退 insertText 必须只删 token 范围')
  assert.equal(run.setDraftCalls.length, 0, '回退路径也不得调用 setDraft')
  assert.equal(run.insertCalls.length, 1)
  assert.equal(run.insertCalls[0].text, '')
  assert.deepEqual(run.insertCalls[0].span, { start: 0, end: 11, draftRev: 1 })
})
