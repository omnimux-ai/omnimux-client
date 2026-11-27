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
      locale: {
        getSnapshot: () => ({ active: 'en', locales: [], revision: 1 }),
        subscribe: () => () => {},
      },
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
      assert.equal(entry.opts.inject().getLocale(), 'en')
      assert.equal(entry.opts.inject().localeRuntime, ctx.locale)
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

  it('returns cover_url and account.avatar_url on inspiration_rival_post and renders via LocaleRuntime active', async () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'insp-tv-rival-'))
    tempDirs.push(tempHome)
    const { createRivalAccountsService } = await import('../rival/rival-accounts-service.js')
    const { registerRivalTools } = await import('../rival/rival-agent-tools.js')

    const tools = new Map()
    const fakeStore = {
      posts: [
        {
          id: 'p_local_1',
          account_id: 'riv_1',
          title: 'Local cached rival',
          url: 'https://www.tiktok.com/@creator/video/7412345678901234567',
          posted_at: '2026-11-26T00:00:00.000Z',
          type: 'video',
          duration: 21,
          cover_url: 'https://remote.expired.cdn/c.jpg',
          cover_http_url: '/omnimux/inspiration/local/media/rival-accounts/covers/cached.jpg',
          stats: { likes: 99, views: 1200 },
        },
      ],
      accounts: [
        {
          id: 'riv_1',
          platform: 'tiktok',
          handle: '@creator',
          nickname: 'Creator Lab',
          avatar_http_url: '/omnimux/inspiration/local/media/rival-accounts/avatars/av.jpg',
          followers: 5000,
        },
      ],
      requireAccount(id) {
        return this.accounts.find((a) => a.id === id)
      },
      requirePost(_aid, pid) {
        return this.posts.find((p) => p.id === pid)
      },
    }
    registerRivalTools({ register: (t) => tools.set(t.name, t) }, fakeStore)
    assert.ok(createRivalAccountsService)

    const rivalPost = await tools.get('inspiration_rival_post').execute({ account_id: 'riv_1', post_id: 'p_local_1' })
    assert.equal(rivalPost.post.cover_url, '/omnimux/inspiration/local/media/rival-accounts/covers/cached.jpg')
    assert.equal(rivalPost.account.avatar_url, '/omnimux/inspiration/local/media/rival-accounts/avatars/av.jpg')

    const html = renderToStaticMarkup(
      createElement(InspirationSocialToolView, {
        toolName: 'inspiration_rival_post',
        localeRuntime: { getSnapshot: () => ({ active: 'en', locales: [], revision: 1 }) },
        block: {
          kind: 'tool-result',
          callId: 'riv-single-1',
          call: { name: 'inspiration_rival_post', argsRaw: '{"account_id":"riv_1","post_id":"p_local_1"}' },
          content: [{ type: 'text', text: JSON.stringify(rivalPost) }],
        },
      }),
    )
    assert.match(html, /Fetched rival posts/)
    assert.match(html, /\/omnimux\/inspiration\/local\/media\/rival-accounts\/covers\/cached\.jpg/)
    assert.match(html, /\/omnimux\/inspiration\/local\/media\/rival-accounts\/avatars\/av\.jpg/)
  })
})
