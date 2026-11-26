import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const localRequire = createRequire(import.meta.url)
const React = localRequire('react')
const reactDomClient = localRequire('react-dom/client')
const { JSDOM } = localRequire('jsdom')

function loadExpertBootstrapBar() {
  const built = buildSync({
    entryPoints: [resolve(here, 'ExpertBootstrapBar.jsx')],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react-dom/client'],
  })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', built.outputFiles[0].text)(localRequire, mod, mod.exports)
  return mod.exports
}

function loadCatalog() {
  const built = buildSync({
    entryPoints: [resolve(here, 'expertBootstrapCatalog.js')],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
  })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', built.outputFiles[0].text)(localRequire, mod, mod.exports)
  return mod.exports
}

function setupDom(t) {
  const dom = new JSDOM('<!doctype html><html lang="zh-CN"><body><div id="root"></div></body></html>')
  const keys = ['window', 'document', 'MutationObserver', 'CustomEvent', 'IS_REACT_ACT_ENVIRONMENT']
  const prev = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]))
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  const container = dom.window.document.getElementById('root')
  const root = reactDomClient.createRoot(container)
  t.after(async () => {
    await React.act(async () => root.unmount())
    dom.window.close()
    for (const k of keys) {
      const desc = prev.get(k)
      if (desc) Object.defineProperty(globalThis, k, desc)
      else delete globalThis[k]
    }
  })
  return { dom, container, root }
}

describe('ExpertBootstrapBar blank-session guidance & strict role mutual exclusion', () => {
  it('catalog covers all 10 ecom-* SOP experts with 3 bilingual starters and zero middle-dot separators', () => {
    const { BUILTIN_EXPERT_BOOTSTRAP_STARTERS, resolveExpertBootstrapStarters } = loadCatalog()
    const ids = Object.keys(BUILTIN_EXPERT_BOOTSTRAP_STARTERS)
    assert.equal(ids.length, 10)
    assert.ok(ids.includes('ecom-brand-curator'))
    assert.ok(ids.includes('ecom-global-localizer'))

    for (const id of ids) {
      const zh = resolveExpertBootstrapStarters(id, { lang: 'zh', seam: null })
      const en = resolveExpertBootstrapStarters(id, { lang: 'en', seam: null })
      assert.equal(zh.length, 3, `${id} zh must have 3 starters`)
      assert.equal(en.length, 3, `${id} en must have 3 starters`)
      for (const item of [...zh, ...en]) {
        assert.ok(item.label.length >= 4)
        assert.ok(item.prompt.length >= 16)
        assert.ok(!item.label.includes('·'), `${id} starter label must not contain middle dot`)
      }
    }

    assert.deepEqual(resolveExpertBootstrapStarters('omni-agent', { lang: 'zh', seam: null }), [])
    assert.deepEqual(resolveExpertBootstrapStarters('cordis', { lang: 'zh', seam: null }), [])
    assert.deepEqual(resolveExpertBootstrapStarters('standard', { lang: 'zh', seam: null }), [])
  })

  it('strictly renders null (0 DOM) for omni-agent, cordis, and non-blank conversations', async (t) => {
    const { ExpertBootstrapBar } = loadExpertBootstrapBar()
    const { container, root } = setupDom(t)

    const blankSession = { id: 'sess-1', blank: true, running: false }
    const nonBlankSession = { id: 'sess-2', blank: false, running: false }

    for (const props of [
      { agentPreset: 'omni-agent', sessionId: 'sess-1', useSession: (s) => s(blankSession) },
      { agentPreset: 'cordis', sessionId: 'sess-1', useSession: (s) => s(blankSession) },
      { agentPreset: 'standard', sessionId: 'sess-1', useSession: (s) => s(blankSession) },
      { agentPreset: 'ecom-brand-curator', sessionId: 'sess-2', useSession: (s) => s(nonBlankSession) },
    ]) {
      await React.act(async () => {
        root.render(React.createElement(ExpertBootstrapBar, props))
      })
      assert.equal(container.querySelector('[data-omnimux-expert-bootstrap="true"]'), null)
      assert.equal(container.innerHTML, '')
    }
  })

  it('renders 3 starters for hired ecom-* expert in blank session, fills composer via mutatePrompt on click without auto-sending, and retracts on second click', async (t) => {
    const { ExpertBootstrapBar } = loadExpertBootstrapBar()
    const { container, root } = setupDom(t)

    let inputState = { draft: '', draftRev: 1, phase: 'plain', occurrences: [] }
    const mutations = []
    const blankSession = { id: 'sess-localizer', blank: true, running: false }

    const renderBar = (extra = {}) => React.createElement(ExpertBootstrapBar, {
      agentPreset: 'ecom-global-localizer',
      sessionId: 'sess-localizer',
      locale: 'zh',
      useSession: (sel) => sel(blankSession),
      useInput: (sel) => sel(inputState),
      mutatePrompt: (text, span) => {
        mutations.push({ text, span })
        inputState = {
          ...inputState,
          draft: text,
          draftRev: inputState.draftRev + 1,
        }
        return true
      },
      ...extra,
    })

    await React.act(async () => {
      root.render(renderBar())
    })

    const bar = container.querySelector('[data-omnimux-expert-bootstrap="true"]')
    assert.ok(bar, 'bootstrap bar must render for hired ecom-* blank session')
    assert.equal(bar.getAttribute('data-omnimux-expert-id'), 'ecom-global-localizer')
    assert.ok(bar.classList.contains('omx-quick-shortcuts'), 'must reuse .omx-quick-shortcuts layout/tokens')

    const btns = Array.from(bar.querySelectorAll('button[data-omx-expert-starter]'))
    assert.equal(btns.length, 3)
    assert.equal(btns[0].textContent, '拆解四栏跨国本地化方案')

    // Click first starter -> writes prompt without submitting
    await React.act(async () => {
      btns[0].click()
    })
    assert.equal(mutations.length, 1)
    assert.match(mutations[0].text, /四栏本地化方案/)

    // Re-render with updated host input snapshot so useOwnedPrompt observes ownership
    await React.act(async () => {
      root.render(renderBar())
    })
    assert.equal(bar.querySelector('button[data-omx-expert-starter]').getAttribute('aria-pressed'), 'true')

    // Click again -> retracts owned prompt
    await React.act(async () => {
      bar.querySelector('button[data-omx-expert-starter]').click()
    })
    assert.equal(mutations.length, 2)
    assert.equal(mutations[1].text, '')

    // Switch to English locale & live seam override (canonical labelZh/labelEn/promptZh/promptEn shape)
    globalThis.window.__omnimuxExpertStarters = {
      resolveStarters: (id) => id === 'ecom-brand-curator'
        ? [{ id: 'custom-1', labelZh: '自定义建档', labelEn: 'Custom brand kit', promptZh: '中文提示词', promptEn: 'Build custom brand kit now:' }]
        : [],
    }
    await React.act(async () => {
      root.render(renderBar({ agentPreset: 'ecom-brand-curator', locale: 'en' }))
    })
    const enBtns = Array.from(container.querySelectorAll('button[data-omx-expert-starter]'))
    assert.equal(enBtns.length, 1)
    assert.equal(enBtns[0].textContent, 'Custom brand kit')
  })

  it('detects English under real Host injection (no locale prop) via window.__omnimuxLocale.active and injected t("quickShortcuts.group")', async (t) => {
    const { ExpertBootstrapBar } = loadExpertBootstrapBar()
    const { container, root } = setupDom(t)
    const blankSession = { id: 'sess-locale', blank: true, running: false }

    // 1. Real Host injects only { t, mutatePrompt } with no locale prop; document lang is empty
    globalThis.document.documentElement.lang = ''
    delete globalThis.window.__omnimuxLocale
    await React.act(async () => {
      root.render(React.createElement(ExpertBootstrapBar, {
        agentPreset: 'ecom-brand-curator',
        sessionId: 'sess-locale',
        useSession: (sel) => sel(blankSession),
        t: (key) => (key === 'quickShortcuts.group' ? 'Quick start' : key),
      }))
    })
    let btns = Array.from(container.querySelectorAll('button[data-omx-expert-starter]'))
    assert.equal(btns.length, 3)
    assert.equal(btns[0].textContent, 'Onboard from Product URL')

    // 2. Real Host publishes window.__omnimuxLocale.active + subscribe()
    let listener = null
    globalThis.window.__omnimuxLocale = {
      active: 'en-US',
      subscribe(fn) {
        listener = fn
        return () => { listener = null }
      },
    }
    await React.act(async () => {
      root.render(React.createElement(ExpertBootstrapBar, {
        agentPreset: 'ecom-global-localizer',
        sessionId: 'sess-locale',
        useSession: (sel) => sel(blankSession),
      }))
    })
    btns = Array.from(container.querySelectorAll('button[data-omx-expert-starter]'))
    assert.equal(btns[0].textContent, 'Build 4-Column Plan')

    // Live locale switch en-US -> zh-CN updates rendered starter labels reactively
    globalThis.window.__omnimuxLocale.active = 'zh-CN'
    await React.act(async () => {
      listener?.()
    })
    btns = Array.from(container.querySelectorAll('button[data-omx-expert-starter]'))
    assert.equal(btns[0].textContent, '拆解四栏跨国本地化方案')
  })
})
