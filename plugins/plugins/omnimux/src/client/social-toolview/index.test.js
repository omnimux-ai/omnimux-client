import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot } from 'react-dom/client'
import {
  OMNIMUX_SOCIAL_TOOLVIEW_KEYS,
  OmnimuxSocialToolView,
  registerSocialToolViews,
  resolveSocialToolViewLocale,
  savePostToInspiration,
} from './index.js'

const OUTSIDE_OWNED_KEYS = new Set([
  'display_file',
  'read_image',
  'skillhub_search',
  'plaza_search',
  'skillhub_list',
  'inspiration_search',
  'inspiration_get',
  'inspiration_rival_posts',
  'inspiration_rival_post',
])

let activeDom = null

afterEach(() => {
  if (activeDom) {
    activeDom.window.close()
    activeDom = null
  }
})

describe('omnimux social-toolview registration & locale', () => {
  it('registers all 15 unique tool keys lazily on tool.call.toolview with zero collisions', () => {
    assert.equal(OMNIMUX_SOCIAL_TOOLVIEW_KEYS.length, 15)
    assert.equal(new Set(OMNIMUX_SOCIAL_TOOLVIEW_KEYS).size, 15)
    for (const key of OMNIMUX_SOCIAL_TOOLVIEW_KEYS) {
      assert.equal(OUTSIDE_OWNED_KEYS.has(key), false, `${key} must not collide with sibling plugin keys`)
    }

    const injectedSlots = []
    const registrations = new Map()
    const ctx = {
      locale: { getSnapshot: () => ({ locale: 'en-US' }) },
      slots: {
        inject(slotName, fn) {
          injectedSlots.push(slotName)
          fn()
          return () => {}
        },
        register(opts, component) {
          registrations.set(opts.key, { opts, component })
          return () => registrations.delete(opts.key)
        },
      },
    }

    const disposers = registerSocialToolViews(ctx)
    assert.equal(disposers.length, 15)
    assert.equal(registrations.size, 15)
    assert.ok(injectedSlots.every((s) => s === 'tool.call.toolview'))

    for (const key of OMNIMUX_SOCIAL_TOOLVIEW_KEYS) {
      const entry = registrations.get(key)
      assert.ok(entry, `missing registration for ${key}`)
      assert.equal(entry.opts.name, 'tool.call.toolview')
      assert.equal(entry.opts.key, key)
      assert.equal(entry.opts.id, key)
      assert.equal(entry.component, OmnimuxSocialToolView)
      assert.equal(entry.opts.inject().getLocale(), 'en')
    }
  })

  it('resolves locale safely across prop, ctx, and fallback', () => {
    assert.equal(resolveSocialToolViewLocale({ locale: 'en-US' }), 'en')
    assert.equal(resolveSocialToolViewLocale({ locale: 'zh-CN' }), 'zh')
    assert.equal(resolveSocialToolViewLocale({}, { locale: { current: 'en' } }), 'en')
    assert.equal(resolveSocialToolViewLocale({}, {}), 'zh')
  })
})

describe('savePostToInspiration helper', () => {
  it('handles 202 accepted, 409 duplicate, server error, and unsafe URLs', async () => {
    let sent = null
    const okRes = await savePostToInspiration(
      { sourceUrl: 'https://x.com/u/status/12345' },
      async (url, init) => {
        sent = { url, body: JSON.parse(init.body) }
        return { ok: true, status: 202, json: async () => ({ data: { id: 'insp_1' } }) }
      },
    )
    assert.deepEqual(okRes, { ok: true })
    assert.equal(sent.url, '/omnimux/inspiration/local/import-url')
    assert.equal(sent.body.url, 'https://x.com/u/status/12345')
    assert.equal(sent.body.background, true)
    assert.equal(sent.body.auto_analyze, false)

    const dupRes = await savePostToInspiration(
      { sourceUrl: 'https://x.com/u/status/12345' },
      async () => ({ ok: false, status: 409, json: async () => ({ is_duplicate: true }) }),
    )
    assert.deepEqual(dupRes, { ok: true, alreadySaved: true })

    const errRes = await savePostToInspiration(
      { sourceUrl: 'https://x.com/u/status/12345' },
      async () => ({ ok: false, status: 500, json: async () => ({ error: 'disk full' }) }),
    )
    assert.deepEqual(errRes, { ok: false, error: 'disk full' })

    const badUrl = await savePostToInspiration({ sourceUrl: 'javascript:alert(1)' })
    assert.equal(badUrl.ok, false)
  })
})

describe('OmnimuxSocialToolView multi-state SSR & interactive DOM rendering', () => {
  it('renders running, ready cards, empty, error, and passthrough states accurately', () => {
    const runningHtml = renderToStaticMarkup(
      createElement(OmnimuxSocialToolView, {
        toolName: 'omnimux_x_search',
        locale: 'zh',
        block: { phase: 'start', callId: 'c-run', name: 'omnimux_x_search', argsRaw: '{"query":"gemini"}' },
      }),
    )
    assert.match(runningHtml, /正在搜索 X 帖子/)
    assert.match(runningHtml, /gemini/)

    const readyHtml = renderToStaticMarkup(
      createElement(OmnimuxSocialToolView, {
        toolName: 'omnimux_x_search',
        locale: 'en',
        block: {
          kind: 'tool-result',
          callId: 'c-ready',
          call: { name: 'omnimux_x_search', argsRaw: '{"query":"gemini"}' },
          content: [{
            type: 'text',
            text: JSON.stringify({
              platform: 'x',
              capability: 'search',
              data: {
                timeline: [
                  {
                    id_str: '201',
                    content_shape: 'article',
                    article: { title: 'Deep Work Article', preview_text: 'Morning routine' },
                    user: { name: 'Dan Koe', screen_name: 'thedankoe' },
                    engagement: { likes: 5700, retweets: 750 },
                  },
                  {
                    id_str: '202',
                    text: 'Regular X post text',
                    user: { name: 'Elena', screen_name: 'elena' },
                    engagement: { likes: 120, retweets: 10 },
                  },
                ],
              },
            }),
          }],
        },
      }),
    )
    assert.match(readyHtml, /Searched X posts/)
    assert.match(readyHtml, /×2/)
    assert.match(readyHtml, /data-archetype="article"/)
    assert.match(readyHtml, /data-archetype="social-post"/)
    assert.match(readyHtml, /Deep Work Article/)
    assert.match(readyHtml, /Regular X post text/)

    const inspHtml = renderToStaticMarkup(
      createElement(OmnimuxSocialToolView, {
        toolName: 'omnimux_inspiration_list',
        locale: 'zh',
        block: {
          kind: 'tool-result',
          callId: 'c-insp',
          call: { name: 'omnimux_inspiration_list', argsRaw: '{"q":"ai"}' },
          content: [{
            type: 'text',
            text: JSON.stringify({
              items: [{ id: 'i1', source_platform: 'tiktok', title: 'Clip 1', source_url: 'https://www.tiktok.com/@a/video/7412345678901234567' }],
            }),
          }],
        },
      }),
    )
    assert.match(inspHtml, /已检索灵感库/)
    assert.doesNotMatch(inspHtml, /存为灵感/)

    const passthroughHtml = renderToStaticMarkup(
      createElement(OmnimuxSocialToolView, {
        toolName: 'omnimux_social_data',
        locale: 'zh',
        block: {
          kind: 'tool-result',
          callId: 'c-pass',
          call: { name: 'omnimux_social_data', argsRaw: '{"platform":"x","capability":"user","id":"thedankoe"}' },
          content: [{ type: 'text', text: JSON.stringify({ platform: 'x', capability: 'user', data: { followers: 700000 } }) }],
        },
      }),
    )
    assert.match(passthroughHtml, /data-phase="passthrough"/)
    assert.match(passthroughHtml, /JSON/)
  })

  it('toggles collapse, JSON output, and show-more button in interactive DOM', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    activeDom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1/' })
    globalThis.window = activeDom.window
    globalThis.document = activeDom.window.document

    const items = Array.from({ length: 8 }, (_, idx) => ({
      id_str: String(1000 + idx),
      text: `Post ${idx + 1}`,
      user: { name: `Author ${idx + 1}`, screen_name: `author_${idx + 1}` },
    }))
    const block = {
      kind: 'tool-result',
      callId: 'c-dom',
      call: { name: 'omnimux_x_search', argsRaw: '{"query":"agent"}' },
      content: [{ type: 'text', text: JSON.stringify({ platform: 'x', capability: 'search', data: { timeline: items } }) }],
    }

    const container = activeDom.window.document.getElementById('root')
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(OmnimuxSocialToolView, { toolName: 'omnimux_x_search', block, locale: 'zh' }))
    })

    assert.equal(container.querySelectorAll('article[data-archetype]').length, 6)
    const moreBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('展开其余 2 条'))
    assert.ok(moreBtn, 'expected progressive disclosure button for >6 cards')

    await act(async () => {
      moreBtn.click()
    })
    assert.equal(container.querySelectorAll('article[data-archetype]').length, 8)

    const jsonBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'JSON')
    assert.ok(jsonBtn)
    await act(async () => {
      jsonBtn.click()
    })
    assert.ok(container.querySelector('pre'), 'expected raw JSON box after clicking JSON toggle')

    const headerBtn = container.querySelector('[aria-expanded]')
    assert.ok(headerBtn)
    await act(async () => {
      headerBtn.click()
    })
    assert.equal(container.querySelectorAll('article[data-archetype]').length, 0, 'cards collapse cleanly')

    await act(async () => {
      root.unmount()
    })
  })
})
