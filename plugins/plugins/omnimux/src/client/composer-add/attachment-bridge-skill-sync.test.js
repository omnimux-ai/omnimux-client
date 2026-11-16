import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const output = await build({
  entryPoints: [new URL('./AttachmentSubmitBridge.jsx', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  external: ['react'],
})
const module = { exports: {} }
new Function('require', 'module', 'exports', output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
const { AttachmentSubmitBridge } = module.exports

async function mount({ draft: initialDraft, activeSkill = null, attachments = [], occurrences = [], linkChip = false } = {}) {
  const chip = linkChip ? '<div class="omx-link-chip-row"><div data-omx-video-token="true"><input value="https://example.com/video" /></div></div>' : ''
  const dom = new JSDOM(`<div data-phase="hero"><div data-composer-card><div id="bridge"></div><div data-composer-input="true"></div>${chip}<button data-send-button type="button">发送</button></div></div>`)
  const previous = { window: globalThis.window, document: globalThis.document, CustomEvent: globalThis.CustomEvent, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.CustomEvent = dom.window.CustomEvent
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let draft = initialDraft
  const writes = []
  const setDraftCalls = []
  const props = {
    sessionId: 'A',
    useInput: selector => selector({ draft, phase: 'plain', draftRev: 1, occurrences }),
    inputActions: {
      setDraft(value) { setDraftCalls.push(value); draft = value; writes.push(value) },
      insertText(text, span) {
        draft = draft.slice(0, span.start) + text + draft.slice(span.end)
        writes.push(draft)
        return true
      },
    },
    attachmentStore: { getSnapshot: () => attachments },
    attachmentAdmission: { arm() {} },
    getCurrentSessionId: () => 'A',
    t: key => key,
  }
  window.__omnimuxActiveSkill = activeSkill
  const root = createRoot(document.querySelector('#bridge'))
  const render = async () => {
    await act(async () => root.render(React.createElement(AttachmentSubmitBridge, props)))
  }
  await render()
  return {
    get draft() { return draft },
    writes, setDraftCalls, occurrences,
    async publish(next) {
      draft = next
      await render()
    },
    clickSend() {
      const button = document.querySelector('[data-send-button]')
      const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
      button.dispatchEvent(event)
      return event
    },
    publishSkill(skill) {
      window.__omnimuxActiveSkill = skill
      window.dispatchEvent(new window.CustomEvent('omnimux:skill:changed', { detail: { skill } }))
    },
    async dispose() {
      await act(async () => root.unmount())
      dom.window.close()
      globalThis.window = previous.window
      globalThis.document = previous.document
      globalThis.CustomEvent = previous.CustomEvent
      globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act
    },
  }
}

test('场景5 退格删除 token：胶囊同步消失，不误删正文/附件', async () => {
  const attachments = [{ id: 'a1', name: '参考图.png' }]
  const env = await mount({
    draft: '/video-hook-analysis hello',
    activeSkill: { slug: 'video-hook-analysis', name: '视频拆解', origin: 'slash' },
    attachments,
  })
  try {
    assert.equal(window.__omnimuxActiveSkill?.slug, 'video-hook-analysis')
    await env.publish('hello')
    assert.equal(window.__omnimuxActiveSkill, null, 'token 删除后必须同步清空胶囊/全局状态')
    assert.equal(env.draft, 'hello', '同步层不得改写正文')
    assert.deepEqual(attachments, [{ id: 'a1', name: '参考图.png' }], '附件真源不得被同步层改写')
  } finally {
    await env.dispose()
  }
})

test('AttachmentSubmitBridge：removeSkillToken 使用 revision 守卫的 insertText，保留正文', async () => {
  const env = await mount({
    draft: '/video-hook-analysis 保留正文',
    activeSkill: { slug: 'video-hook-analysis', name: '视频拆解', origin: 'slash' },
  })
  try {
    const removed = window.__omnimuxComposerActions.removeSkillToken('video-hook-analysis')
    assert.equal(removed, true)
    assert.equal(env.draft, '保留正文')
    assert.ok(env.writes.includes('保留正文'))
  } finally {
    await env.dispose()
  }
})

test('AttachmentSubmitBridge：custom 来源没有 token 时，改正文不误清胶囊', async () => {
  const env = await mount({
    draft: 'hello',
    activeSkill: { slug: 'custom-skill', name: '自定义技能', origin: 'custom' },
  })
  try {
    await env.publish('hello world')
    assert.equal(window.__omnimuxActiveSkill?.slug, 'custom-skill')
  } finally {
    await env.dispose()
  }
})

test('场景1 斜杠选择同步：slash 事件先到、token 后插入时不误清胶囊', async () => {
  const env = await mount({ draft: '正文' })
  try {
    env.publishSkill({ slug: 'new-skill', name: '新技能', origin: 'slash' })
    await env.publish('/new-skill 正文')
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(window.__omnimuxActiveSkill?.slug, 'new-skill', 'token 插入后胶囊必须保留')
    assert.equal(window.__omnimuxActiveSkill?.origin, 'slash')
  } finally {
    await env.dispose()
  }
})

test('场景6 发送预览：native token 原样保留，custom 不写假 slash', async () => {
  const native = await mount({
    draft: '/video-hook-analysis 帮我写文案',
    activeSkill: { slug: 'video-hook-analysis', name: '视频拆解', origin: 'slash' },
  })
  try {
    const event = native.clickSend()
    assert.equal(event.defaultPrevented, false, '原生 token 草稿不得被发送守卫拦截')
    assert.equal(native.draft, '/video-hook-analysis 帮我写文案', '发送时 /slug 必须原样保留给 Host 的 dsh-tool-skill')
    assert.equal(window.__omnimuxActiveSkill?.origin, 'slash')
  } finally {
    await native.dispose()
  }

  const custom = await mount({
    draft: '帮我写文案',
    activeSkill: { slug: 'custom-skill', name: '自定义技能', origin: 'custom' },
  })
  try {
    const event = custom.clickSend()
    assert.equal(event.defaultPrevented, false)
    assert.equal(custom.draft, '帮我写文案', 'custom 通道只显示胶囊/名称，不得向正文补 slash')
    assert.equal(window.__omnimuxActiveSkill?.name, '自定义技能')
    assert.ok(!custom.draft.includes('/custom-skill'))
  } finally {
    await custom.dispose()
  }
})

test('B1 回归：token + link chip 下 removeSkillToken 只删 token，不碰 inline chip', async () => {
  const occurrences = [{ source: 'link', label: '参考视频', clipboardText: 'https://example.com/video' }]
  const env = await mount({
    draft: '/video-hook-analysis 参考 ',
    activeSkill: { slug: 'video-hook-analysis', name: '视频拆解', origin: 'slash' },
    occurrences,
    linkChip: true,
  })
  try {
    assert.ok(document.querySelector('[data-omx-video-token="true"]'), 'link chip 必须已挂载')
    const removed = window.__omnimuxComposerActions.removeSkillToken('video-hook-analysis')
    assert.equal(removed, true)
    assert.equal(env.draft, '参考 ')
    assert.ok(document.querySelector('[data-omx-video-token="true"]'), 'link chip DOM 必须保留')
    assert.equal(env.setDraftCalls.length, 0, 'bridge removeSkillToken 不得调用 setDraft 整段替换')
    assert.deepEqual(env.occurrences, occurrences, 'occurrences 必须原样保留')
  } finally {
    await env.dispose()
  }
})
