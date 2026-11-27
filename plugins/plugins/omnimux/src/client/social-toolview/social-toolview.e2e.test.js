import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SocialSearchToolView } from 'dsh-ui-kit/social-card'
import { runStyleDomProbe } from '../../../../../scripts/test-fixtures/style-dom-probe.mjs'

const here = dirname(fileURLToPath(import.meta.url))

// Note: Intentionally NO global `* { box-sizing: border-box }` reset inside test styles (LESSONS.md #19).
const HOST_TOKEN_CSS = `
:root, body {
  --dsw-alias-bg-base: #131417;
  --dsw-alias-bg-layer-1: #181a1f;
  --dsw-alias-bg-layer-2: #202329;
  --dsw-alias-bg-layer-3: #2a2e36;
  --dsw-alias-card-fill: #1c1e23;
  --dsw-alias-card-fill-hover: #21242a;
  --dsw-alias-interactive-bg-hover: #282c34;
  --dsw-alias-border-l1: rgba(255, 255, 255, 0.08);
  --dsw-alias-border-l2: rgba(255, 255, 255, 0.12);
  --dsw-alias-border-l3: rgba(255, 255, 255, 0.24);
  --dsw-alias-label-primary: #f2f4f8;
  --dsw-alias-label-secondary: #b5bcc9;
  --dsw-alias-label-tertiary: #848d9e;
  --dsw-alias-brand-primary: #f2f4f8;
  --dsw-alias-state-business-primary: #93c5fd;
  --dsw-alias-state-business-tertiary: rgba(59, 130, 246, 0.2);
  --dsw-alias-state-done-primary: #c4b5fd;
  --dsw-alias-state-warn-label: #fbbf24;
  --dsw-alias-state-warn-tertiary: rgba(245, 158, 11, 0.2);
  --dsw-alias-state-success-primary: #4ade80;
  --dsw-alias-state-success-tertiary: rgba(34, 197, 94, 0.16);
  --dsw-alias-state-error-primary: #f87171;
  --dsw-static-neutral-00: #ffffff;
  --dsw-static-neutral-1000: #0a0b0e;
}
`

function loadKitCss() {
  const kitJs = readFileSync(join(here, '../../../../../packages/dsh-ui-kit/lib/social-card.js'), 'utf8')
  const injectCssMatches = [...kitJs.matchAll(/injectCss\([^,]+,\s*("(?:[^"\\]|\\.)*")\)/g)]
  const rules = injectCssMatches.map((m) => JSON.parse(m[1]))
  assert.ok(rules.length >= 2, 'expected compiled social-card & toolview CSS rules in lib/social-card.js')
  return rules.join('\n')
}

const MULTI_PLATFORM_BLOCK = {
  kind: 'tool-result',
  callId: 'e2e-multi',
  call: { name: 'omnimux_x_search', argsRaw: '{"query":"gemini"}' },
  content: [{
    type: 'text',
    text: JSON.stringify({
      data: {
        items: [
          {
            id: 'art-1',
            platform: 'x',
            content_shape: 'article',
            title: 'The deep work routine',
            excerpt: 'One hour every morning changes everything.',
            cover_url: '/omnimux/inspiration/media/article.jpg',
            author: { name: 'DAN KOE', handle: 'thedankoe' },
            stats: { likes: 5700, shares: 750 },
            source_url: 'https://x.com/thedankoe/status/1',
          },
          {
            id: 'tt-1',
            platform: 'tiktok',
            type: 'video',
            desc: 'Short vertical AI demo',
            cover_url: '/omnimux/inspiration/media/tt.jpg',
            duration: 28,
            author: { nickname: 'Creator' },
            statistics: { digg_count: 150000, share_count: 4200 },
            url: 'https://www.tiktok.com/@creator/video/7412345678901234567',
          },
          {
            id: 'ig-1',
            platform: 'instagram',
            type: 'image',
            caption: { text: 'Lighting tip for AI portrait' },
            cover_url: '/omnimux/inspiration/media/ig.jpg',
            user: { username: 'creator_swift', full_name: 'Rudra' },
            like_count: 30000,
            video_view_count: 1400000,
            code: 'DB_xyz123',
          },
          {
            id: 'yt-1',
            platform: 'youtube',
            type: 'video',
            videoId: 'dQw4w9WgXcQ',
            title: 'Gemini Live Benchmark',
            thumbnail_url: '/omnimux/inspiration/media/yt.jpg',
            channel_name: 'MKBHD',
            duration: 862,
            views: 412000,
          },
          {
            id: 'post-1',
            platform: 'x',
            text: 'Text-only quick observation in stream.',
            user: { name: 'Elena', screen_name: 'elena_ai' },
            engagement: { likes: 320, retweets: 41 },
          },
        ],
      },
    }),
  }],
}

test('SocialSearchToolView renders 2-column chat layout cleanly with zero overlaps or horizontal overflow', () => {
  const htmlBody = renderToStaticMarkup(
    createElement(SocialSearchToolView, {
      toolName: 'omnimux_x_search',
      block: MULTI_PLATFORM_BLOCK,
      locale: 'zh',
      canSaveToInspiration: true,
    }),
  )

  const styles = `${HOST_TOKEN_CSS}\n${loadKitCss()}`
  const desktop = runStyleDomProbe({
    name: 'chat-social-toolview-620',
    styles,
    html: `<div id="chat-wrap" style="width:620px;padding:8px;">${htmlBody}</div>`,
    viewportHeight: 960,
    measure: () => {
      const wrap = document.getElementById('chat-wrap')
      const cards = [...wrap.querySelectorAll('article[data-archetype]')]
      const boxes = cards.map((card) => {
        const r = card.getBoundingClientRect()
        return {
          archetype: card.getAttribute('data-archetype'),
          density: card.getAttribute('data-density'),
          x: Math.round(r.x),
          y: Math.round(r.y),
          right: Math.round(r.right),
          bottom: Math.round(r.bottom),
        }
      })
      let overlaps = 0
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i]
          const b = boxes[j]
          if (a.x < b.right - 1 && a.right - 1 > b.x && a.y < b.bottom - 1 && a.bottom - 1 > b.y) {
            overlaps += 1
          }
        }
      }
      return {
        archetypes: boxes.map((b) => b.archetype).sort(),
        allCompact: boxes.every((b) => b.density === 'compact'),
        overlaps,
        scrollWidth: wrap.scrollWidth,
        clientWidth: wrap.clientWidth,
      }
    },
  })

  assert.deepEqual(desktop.archetypes, ['article', 'landscape-video', 'photo-feed', 'short-video', 'social-post'])
  assert.equal(desktop.allCompact, true)
  assert.equal(desktop.overlaps, 0, 'cards must never overlap')
  assert.equal(desktop.scrollWidth <= desktop.clientWidth, true, '620px chat column must not overflow horizontally')
})
