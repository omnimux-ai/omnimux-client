import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  INSPIRATION_SOCIAL_TOOLVIEW_KEYS,
  InspirationSocialToolView,
  registerInspirationSocialToolViews,
} from './social-toolview.js'
import { OMNIMUX_SOCIAL_TOOLVIEW_KEYS } from '../../../omnimux/src/client/social-toolview/index.js'
import { apply as applyHostTools } from '../index.js'

const tempDirs = []
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

describe('omnimux-inspiration social toolview registration & rendering', () => {
  it('registers all 4 keys cleanly with zero overlap with omnimux or host slots', () => {
    assert.equal(INSPIRATION_SOCIAL_TOOLVIEW_KEYS.length, 4)
    assert.equal(new Set(INSPIRATION_SOCIAL_TOOLVIEW_KEYS).size, 4)
    const hubKeys = new Set(OMNIMUX_SOCIAL_TOOLVIEW_KEYS)
    for (const key of INSPIRATION_SOCIAL_TOOLVIEW_KEYS) {
      assert.equal(hubKeys.has(key), false, `${key} must not overlap with omnimux keys`)
    }

    const registrations = new Map()
    const ctx = {
      locale: { getSnapshot: () => ({ locale: 'en' }) },
      slots: {
        inject(_name, fn) {
          fn()
          return () => {}
        },
        register(opts, component) {
          registrations.set(opts.key, { opts, component })
          return () => registrations.delete(opts.key)
        },
      },
    }

    const disposers = registerInspirationSocialToolViews(ctx)
    assert.equal(disposers.length, 4)
    assert.equal(registrations.size, 4)
    for (const key of INSPIRATION_SOCIAL_TOOLVIEW_KEYS) {
      const entry = registrations.get(key)
      assert.ok(entry)
      assert.equal(entry.opts.name, 'tool.call.toolview')
      assert.equal(entry.opts.key, key)
      assert.equal(entry.opts.id, key)
      assert.equal(entry.component, InspirationSocialToolView)
    }
  })

  it('additively enriches inspiration_search output while keeping all legacy keys', async () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'insp-tv-home-'))
    tempDirs.push(tempHome)
    const prevHome = process.env.DSH_HOME
    process.env.DSH_HOME = tempHome
    try {
      const tools = new Map()
      applyHostTools({
        tools: { register: (t) => tools.set(t.name, t) },
      })

      // Seed via HTTP/store indirectly through create tool? No, use mock empty + verify contract keys,
      // then exercise rich render against both inspiration_search & inspiration_rival_posts outputs.
      const searchTool = tools.get('inspiration_search')
      assert.ok(searchTool)
      const res = await searchTool.execute({ query: '' })
      assert.equal(res.count, 0)
      assert.ok(Array.isArray(res.items))
      assert.ok(Array.isArray(res.inspirations))
    } finally {
      if (prevHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prevHome
    }
  })

  it('renders enriched inspiration_search and inspiration_rival_posts cards accurately', () => {
    const searchHtml = renderToStaticMarkup(
      createElement(InspirationSocialToolView, {
        toolName: 'inspiration_search',
        locale: 'zh',
        block: {
          kind: 'tool-result',
          callId: 'insp-1',
          call: { name: 'inspiration_search', argsRaw: '{"query":"routine"}' },
          content: [{
            type: 'text',
            text: JSON.stringify({
              count: 1,
              inspirations: [
                {
                  id: 'insp_art_1',
                  title: 'Morning Deep Work',
                  excerpt: 'One focused hour every day',
                  content_shape: 'article',
                  platform: 'x',
                  type: 'link',
                  url: 'https://x.com/thedankoe/status/2094',
                  cover_url: '/omnimux/inspiration/local/media/covers/art.jpg',
                  author: { name: 'DAN KOE', handle: 'thedankoe' },
                  stats: { likes: 5700, shares: 750 },
                },
              ],
            }),
          }],
        },
      }),
    )
    assert.match(searchHtml, /已检索灵感库/)
    assert.match(searchHtml, /data-archetype="article"/)
    assert.match(searchHtml, /Morning Deep Work/)
    assert.doesNotMatch(searchHtml, /存为灵感/)

    const rivalHtml = renderToStaticMarkup(
      createElement(InspirationSocialToolView, {
        toolName: 'inspiration_rival_posts',
        locale: 'zh',
        block: {
          kind: 'tool-result',
          callId: 'riv-1',
          call: { name: 'inspiration_rival_posts', argsRaw: '{"platform":"tiktok","handle":"@creator"}' },
          content: [{
            type: 'text',
            text: JSON.stringify({
              count: 1,
              account: {
                id: 'riv_1',
                platform: 'tiktok',
                handle: '@creator',
                nickname: 'Creator Lab',
                avatar_url: '/omnimux/inspiration/local/media/rival-accounts/avatars/a1.jpg',
              },
              posts: [
                {
                  id: '7412345678901234567',
                  title: 'Rival viral hook',
                  text: 'Rival viral hook',
                  url: 'https://www.tiktok.com/@creator/video/7412345678901234567',
                  posted_at: '2026-11-26T00:00:00.000Z',
                  type: 'video',
                  duration: 31,
                  cover_url: '/omnimux/inspiration/local/media/rival-accounts/covers/c1.jpg',
                  stats: { likes: 12000, views: 340000 },
                  velocity: { multiplier: 4.5 },
                },
              ],
            }),
          }],
        },
      }),
    )
    assert.match(rivalHtml, /已读取对标作品/)
    assert.match(rivalHtml, /data-archetype="short-video"/)
    assert.match(rivalHtml, /Creator Lab/)
  })
})
