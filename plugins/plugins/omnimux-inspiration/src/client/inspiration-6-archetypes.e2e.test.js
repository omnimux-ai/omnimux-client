import './../../tests/fixtures/dom-bootstrap.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MasonryGrid, SocialPostCard } from 'dsh-ui-kit/social-card'
import { runStyleDomProbe } from '../../../../scripts/test-fixtures/style-dom-probe.mjs'
import { toSocialPostCardItem } from './inspiration-card.js'
import { zh } from './locales.js'
import { INSPIRATION_CSS } from './styles.js'
import { COLLECTION_CSS } from './collection-styles.js'

const here = dirname(fileURLToPath(import.meta.url))
const zhMap = new Map(Object.entries(zh))
const t = (key) => zhMap.get(key) || key

/**
 * Extract compiled `.module.css` rules injected onto the bootstrap document by
 * `dsh-ui-kit/social-card`, ensuring headless Chrome tests the exact same class
 * names & styles built by `tsdown`.
 */
function readSocialCardKitCss() {
  const injected = [...globalThis.document.head.querySelectorAll('style[data-dsh-ui-kit], style')]
    .map((node) => node.textContent || '')
    .filter((css) => css.includes('dshUk-SocialPostCard-') || css.includes('dshUk-MasonryGrid-'))
    .join('\n')
  assert.ok(injected.includes('dshUk-SocialPostCard-'), 'dsh-ui-kit/social-card CSS must be injected')
  assert.ok(injected.includes('dshUk-MasonryGrid-'), 'MasonryGrid CSS must be injected')
  return injected
}

const TOKEN_CSS = readFileSync(
  join(here, '../../../omnimux-inspiration/node_modules/dsh-ui-kit/src/token-contract.test.js'),
  'utf8',
) ? `
:root, body {
  --dsw-alias-bg-base: #111215;
  --dsw-alias-bg-layer-1: #1a1b1f;
  --dsw-alias-bg-layer-2: #222328;
  --dsw-alias-bg-mask-1: rgba(0, 0, 0, 0.55);
  --dsw-alias-bg-mask-2: rgba(0, 0, 0, 0.45);
  --dsw-alias-card-fill: #212123;
  --dsw-alias-border-l1: rgba(255, 255, 255, 0.06);
  --dsw-alias-border-l2: rgba(255, 255, 255, 0.12);
  --dsw-alias-border-l3: rgba(255, 255, 255, 0.16);
  --dsw-alias-brand-primary: #4c8dff;
  --dsw-alias-label-primary: #f3f4f6;
  --dsw-alias-label-secondary: #a1a1aa;
  --dsw-alias-label-tertiary: #71717a;
  --dsw-alias-state-error-primary: #ef4444;
  --dsw-alias-state-warn-primary: #f59e0b;
  --dsw-static-amber-400: #f7ad31;
  --dsw-static-blue-50: #eff6ff;
  --dsw-static-blue-400: #60a5fa;
  --dsw-static-blue-600: #2563eb;
  --dsw-static-violet-50: #f5f3ff;
  --dsw-static-violet-400: #a78bfa;
  --dsw-static-violet-600: #7c3aed;
  --dsw-static-amber-50: #fffbeb;
  --dsw-static-amber-600: #d97706;
  --dsw-static-green-50: #ecfdf5;
  --dsw-static-green-400: #34d399;
  --dsw-static-green-600: #059669;
  --dsw-static-neutral-00: #ffffff;
  --dsw-static-neutral-800: #27272a;
  --dsw-static-neutral-900: #18181b;
  --dsw-static-neutral-1000: #000000;
}
` : ''

const SAMPLE_ROWS = [
  {
    id: 'e2e_art',
    source_platform: 'x',
    type: 'link',
    content_shape: 'article',
    title: 'The deep work routine',
    excerpt: 'Build for 1 hour every morning.',
    cover_url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="420"/>',
    author: { name: 'DAN KOE', handle: 'thedankoe' },
    stats: { likes: 5700, shares: 750 },
    velocity: { multiplier: 1.46, top_percent: 4 },
    source_url: 'https://x.com/thedankoe/status/1',
  },
  {
    id: 'e2e_sv',
    source_platform: 'tiktok',
    type: 'video',
    duration: 28,
    ratio: 9 / 16,
    cover_url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="540" height="960"/>',
    author: { name: 'Creator', handle: 'creator' },
    stats: { likes: 150000 },
    source_url: 'https://www.tiktok.com/@creator/video/1',
  },
  {
    id: 'e2e_pf',
    source_platform: 'instagram',
    type: 'image',
    content_shape: 'gallery',
    media_urls: [
      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750"/>',
      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750"/>',
    ],
    author: { name: 'Studio', handle: 'studio' },
    stats: { likes: 24000, views: 120000 },
    source_url: 'https://www.instagram.com/p/abc/',
  },
  {
    id: 'e2e_lv',
    source_platform: 'youtube',
    type: 'video',
    duration: 600,
    cover_url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"/>',
    author: { name: 'Channel', handle: 'channel' },
    stats: { views: 88000 },
    source_url: 'https://www.youtube.com/watch?v=123',
  },
  {
    id: 'e2e_sp',
    source_platform: 'x',
    type: 'link',
    content: 'Short X post without cover image',
    author: { name: 'Builder', handle: 'builder' },
    stats: { likes: 430 },
    source_url: 'https://x.com/builder/status/2',
  },
  {
    id: 'e2e_wl',
    source_platform: 'web',
    type: 'link',
    title: 'Anthropic Engineering Note',
    cover_url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="420"/>',
    source_url: 'https://www.anthropic.com/research/building-effective-agents',
  },
]

function renderStageHtml(width) {
  const items = SAMPLE_ROWS.map((row) => toSocialPostCardItem(row, t))
  const gridHtml = renderToStaticMarkup(
    React.createElement(MasonryGrid, {
      className: 'omnimux-inspiration-grid',
      items,
      getKey: (item) => item.id,
      minColumnWidth: 236,
      minColumns: 1,
      maxColumns: 5,
      gap: 12,
      defaultColumns: width >= 1200 ? 5 : 2,
      renderItem: (item) => React.createElement(SocialPostCard, {
        key: item.id,
        item,
        className: 'omx-inspiration-card',
        dataAttributes: { 'data-inspiration-id': item.id },
      }),
    }),
  )
  return `
    <div id="stage-wrap" style="width:${width}px;padding:12px;">
      <div class="omnimux-inspiration-stage">${gridHtml}</div>
      <div class="omx-card-context-menu" role="menu">
        <button role="menuitem">复制链接地址</button>
      </div>
    </div>
  `
}

function measureProbe() {
  const wrap = document.getElementById('stage-wrap')
  const cards = [...wrap.querySelectorAll('[data-archetype]')]
  const boxes = cards.map((card) => {
    const r = card.getBoundingClientRect()
    return {
      id: card.getAttribute('data-inspiration-id'),
      archetype: card.getAttribute('data-archetype'),
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
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
  const menu = document.querySelector('.omx-card-context-menu')
  const menuStyle = getComputedStyle(menu)
  return {
    archetypes: boxes.map((b) => b.archetype).sort(),
    widths: boxes.map((b) => b.w),
    overlaps,
    scrollWidth: wrap.scrollWidth,
    clientWidth: wrap.clientWidth,
    menuBg: menuStyle.backgroundColor,
    menuBackdropFilter: menuStyle.backdropFilter,
  }
}

test('6-archetype MasonryGrid & context menu geometry gate in Chrome (1440px & 640px)', () => {
  const styles = `${TOKEN_CSS}\n${readSocialCardKitCss()}\n${INSPIRATION_CSS}\n${COLLECTION_CSS}`

  const desktop = runStyleDomProbe({
    name: 'inspiration-6-archetypes-desktop',
    styles,
    html: renderStageHtml(1440),
    measure: measureProbe,
    viewportHeight: 960,
  })
  assert.deepEqual(desktop.archetypes, [
    'article',
    'landscape-video',
    'photo-feed',
    'short-video',
    'social-post',
    'web-link',
  ])
  assert.equal(desktop.overlaps, 0, 'cards in MasonryGrid must never overlap')
  assert.equal(desktop.scrollWidth <= desktop.clientWidth, true, '1440px desktop must have zero horizontal overflow')
  assert.notEqual(desktop.menuBg, 'rgba(0, 0, 0, 0)', 'context menu surface must stay opaque')
  assert.equal(desktop.menuBackdropFilter, 'none', 'context menu must not rely on backdrop-filter')

  const narrow = runStyleDomProbe({
    name: 'inspiration-6-archetypes-narrow',
    styles,
    html: renderStageHtml(640),
    measure: measureProbe,
    viewportHeight: 960,
  })
  assert.equal(narrow.overlaps, 0, 'narrow MasonryGrid must never overlap')
  assert.equal(narrow.scrollWidth <= narrow.clientWidth, true, '640px viewport must have zero horizontal overflow')
  assert.ok(narrow.widths.every((w) => w >= 240 && w <= 340), '2-column layout fills 640px cleanly')
})
