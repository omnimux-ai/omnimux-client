/**
 * E2E：首页新会话 composer 从探索区连续选素材时，附件必须追加、保序、不覆盖。
 *
 * 真实挂载 SessionGuide + 真实 AttachmentStore，点击真实卡片 DOM；
 * 修复前每次选卡都会先 clear() 再 add()，第二个素材会把第一个冲掉。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createGuideStore } from '../../../omnimux/src/client/session-guide/state.js'
import { guideZh } from '../../../omnimux/src/client/session-guide/catalog.js'

async function loadBundledModule(relPath) {
  const output = await build({
    entryPoints: [new URL(relPath, import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    external: ['react'],
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  return module.exports
}

const { SessionGuide } = await loadBundledModule('./SessionGuide.jsx')

async function loadAttachmentStore() {
  const output = await build({
    entryPoints: [new URL('../../../omnimux/src/client/attachments/store.ts', import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    external: ['react'],
  })
  const attachments = { exports: {} }
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(createRequire(import.meta.url), attachments, attachments.exports)
  return attachments.exports
}

function assetRow(id, name) {
  return { id, name, type: 'image', url: `/x/${id}.png` }
}

function productRow(id, name) {
  return { id, name, price: '99', image: `/x/${id}.png` }
}

test('E2E：首页连续从资产库/商品库选素材，附件全部追加且保序，重复素材不丢其他素材', async () => {
  const dom = new JSDOM(
    '<div id="root" data-phase="hero"><div id="guide"></div><div data-composer-card><div data-composer-input="true" contenteditable="true"></div></div></div>',
    { url: 'http://localhost/' },
  )
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT,
    fetch: globalThis.fetch,
    CustomEvent: globalThis.CustomEvent,
  }
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.CustomEvent = dom.window.CustomEvent
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  const attachmentStore = await loadAttachmentStore()
  const store = createGuideStore()
  const sessionId = 'sess-home-append-e2e'
  let draft = ''
  const workbench = { subscribe: () => () => {}, getSnapshot: () => ({ sessionId, state: { panelOpen: false } }) }
  const props = {
    sessionId,
    useSession: (selector) => selector({ blank: true }),
    useConversation: (selector) => selector({ activeTargets: new Set() }),
    useInput: (selector) => selector({ draft, phase: 'plain' }),
    inputActions: { setDraft(value) { draft = value } },
    getCurrentSessionId: () => sessionId,
    store,
    workbench,
    t: (key) => guideZh[key] || key,
  }
  const globalStore = attachmentStore.getGlobalAttachmentStore()
  dom.window.__omnimuxAttachments = globalStore
  globalStore.clear(sessionId)
  globalStore.setActiveSessionId(sessionId)

  const fixtures = {
    '/omnimux/assets/library': { assets: [assetRow('ast-a', '素材 A'), assetRow('ast-b', '素材 B')], total: 2 },
    '/omnimux/products': { products: [productRow('prd-x', '商品 X'), productRow('prd-y', '商品 Y')], total: 2 },
  }
  globalThis.fetch = async (path) => {
    const request = String(path)
    const hit = Object.entries(fixtures).find(([prefix]) => request.includes(prefix))
    return { ok: true, status: 200, json: async () => (hit ? hit[1] : {}) }
  }
  dom.window.fetch = globalThis.fetch

  const root = createRoot(document.querySelector('#guide'))
  const click = (el) => act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  const clickTab = (tab) => click(document.querySelector(`[data-primary-tab="${tab}"]`))
  const clickCard = (index) => {
    const cell = document.querySelectorAll('[data-omnimux-explore-section] .omx-library-flow-cell')[index]
    assert.ok(cell, `第 ${index + 1} 张素材卡片必须渲染`)
    const card = cell.querySelector('[role="checkbox"], button, [role="button"]') || cell.firstElementChild
    return click(card)
  }
  const entityIds = () => globalStore.getSnapshot(sessionId).map((row) => row.entityId)

  try {
    await act(async () => root.render(React.createElement(SessionGuide, props)))
    await settle()

    await clickTab('assets')
    await settle()
    await clickCard(0)
    await settle()
    await clickCard(1)
    await settle()
    assert.deepEqual(entityIds(), ['ast-a', 'ast-b'], '资产库连续两次选择必须两个都在且保序')

    await clickTab('products')
    await settle()
    await clickCard(0)
    await settle()
    await clickCard(1)
    await settle()
    assert.deepEqual(entityIds(), ['ast-a', 'ast-b', 'prd-x', 'prd-y'], '资产库 + 商品库混合选择必须全部保留且保序')

    // 重复选择已经选过的素材：只去重，不得把其他素材冲掉
    await clickTab('assets')
    await settle()
    await clickCard(0)
    await settle()
    assert.deepEqual(entityIds(), ['ast-a', 'ast-b', 'prd-x', 'prd-y'], '重复素材只去重，其他素材必须保留')
  } finally {
    await act(async () => root.unmount())
    globalStore.clear(sessionId)
    delete dom.window.__omnimuxAttachments
    store.dispose()
    dom.window.close()
    globalThis.window = previous.window
    globalThis.document = previous.document
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act
    globalThis.fetch = previous.fetch
    globalThis.CustomEvent = previous.CustomEvent
  }
})
