import { JSDOM } from 'jsdom'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { DEFAULT_CONFIG, DEFAULT_HERO_HEADLINE, DEFAULT_LOGO_SVG, FISH_VIEWBOX, NAME_WORDMARK_VIEWBOX, WORDMARK_VIEWBOX } from './defaults.js'
import {
  HERO_HEADLINE_ATTR,
  HERO_HEADLINE_FIT_STYLE_ID,
} from './hero-headline-fit.js'
import {
  applyOverlay,
  brandedTitle,
  resolveConfig,
  startOverlay,
  svgDataUri,
  welcomeReplacements,
} from './overlay.js'

const officialTitle = 'DeepSeek Harness'

/** @type {JSDOM | undefined} */
let dom

afterEach(() => {
  dom?.window.close()
  dom = undefined
})

/**
 * Build a fixture document with official chrome.
 * @param {string} html Body inner HTML.
 * @param {string} [title]
 * @returns {Document}
 */
function load(html, title = officialTitle) {
  dom = new JSDOM(`<!doctype html><html><head>
    <title>${title}</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  </head><body>${html}</body></html>`, { url: 'http://127.0.0.1/' })
  return dom.window.document
}

/**
 * @param {string} viewBox
 * @param {string} width
 * @returns {string}
 */
function officialSvg(viewBox, width) {
  return `<svg viewBox="${viewBox}" width="${width}" height="18" class="mark" aria-hidden="true"><path d="M0 0" /></svg>`
}

/**
 * jsdom's CSS matcher does not see the camelCase `viewBox` attribute.
 * @param {Document} document
 * @param {string} viewBox
 * @returns {SVGElement[]}
 */
function svgsWithViewBox(document, viewBox) {
  return [...document.querySelectorAll('svg')].filter(svg => svg.getAttribute('viewBox') === viewBox)
}

test('brandedTitle rewrites the official suffix and leaves other titles', () => {
  assert.equal(brandedTitle(officialTitle, 'OmniMux'), 'OmniMux')
  assert.equal(brandedTitle('First — DeepSeek Harness', 'OmniMux'), 'First — OmniMux')
  assert.equal(brandedTitle('Settings', 'OmniMux'), 'Settings')
})

test('welcomeReplacements do not rewrite a standalone DeepSeek provider name', () => {
  const pairs = welcomeReplacements('OmniMux')
  let text = 'Configure the official DeepSeek provider. DeepSeek Harness 0.1. DSH plugin ecosystem.'
  for (const [from, to] of pairs) text = text.split(from).join(to)
  assert.match(text, /official DeepSeek provider/)
  assert.doesNotMatch(text, /DeepSeek Harness/)
  assert.match(text, /OmniMux 0\.1/)
  assert.match(text, /OmniMux plugin ecosystem/)
})

test('expanded sidebar mark and name slots are covered without emptying the identity', () => {
  const document = load(`
    <div class="logoRow">
      <button class="brand">
        <span class="brandIdentity">
          <span class="brandMark">${officialSvg(FISH_VIEWBOX, '24')}</span>
          <span class="brandName">${officialSvg(NAME_WORDMARK_VIEWBOX, '156')}</span>
        </span>
      </button>
    </div>
    <div data-pane="sidebar"><span class="railMark">${officialSvg(FISH_VIEWBOX, '24')}</span></div>
  `)
  applyOverlay(document, DEFAULT_CONFIG, [])
  const identity = document.querySelector('.brandIdentity')
  assert.equal(identity?.querySelector('.brandMark [data-omnimux-brand="fish"]') != null, true)
  assert.equal(identity?.querySelector('.brandName [data-omnimux-brand="wordmark"]')?.textContent, 'OmniMux')
  assert.ok(svgsWithViewBox(document, FISH_VIEWBOX).find(svg => svg.closest('.brandMark'))?.hasAttribute('data-omnimux-covered'))
  assert.ok(svgsWithViewBox(document, NAME_WORDMARK_VIEWBOX)[0]?.hasAttribute('data-omnimux-covered'))
  assert.ok(svgsWithViewBox(document, FISH_VIEWBOX).find(svg => svg.closest('.railMark'))?.hasAttribute('data-omnimux-covered'))
})

test('name-only wordmark outside brandIdentity is still covered', () => {
  const document = load(officialSvg(NAME_WORDMARK_VIEWBOX, '156'))
  applyOverlay(document, DEFAULT_CONFIG, [])
  assert.ok(document.querySelector('[data-omnimux-brand="wordmark"]'))
  assert.ok(svgsWithViewBox(document, NAME_WORDMARK_VIEWBOX)[0]?.hasAttribute('data-omnimux-covered'))
})

test('applyOverlay covers the collapsed rail whale and leaves the panel icon in the tree', () => {
  const document = load(`
    <button>${officialSvg(WORDMARK_VIEWBOX, '182')}</button>
    <div data-pane="sidebar"><button class="railMark">${officialSvg(FISH_VIEWBOX, '24')}<svg viewBox="0 0 16 16" width="16" class="panel"></svg></button></div>
  `)
  const restores = []
  applyOverlay(document, DEFAULT_CONFIG, restores)
  applyOverlay(document, DEFAULT_CONFIG, restores)
  assert.equal(document.title, 'OmniMux')
  assert.equal(document.querySelector('link[rel="icon"]')?.getAttribute('href'), svgDataUri(DEFAULT_LOGO_SVG))
  const rail = svgsWithViewBox(document, FISH_VIEWBOX)[0]
  assert.ok(rail?.hasAttribute('data-omnimux-covered'))
  assert.ok(document.querySelector('[data-omnimux-brand="fish"]'))
  assert.ok(document.querySelector('svg.panel'))
  assert.equal(document.querySelector('svg.panel')?.hasAttribute('data-omnimux-covered'), false)
})

test('collapsed rail and hero fish are both covered', () => {
  const document = load(`
    <div class="headline"><span class="fishHitbox">${officialSvg(FISH_VIEWBOX, '34')}</span></div>
    <div data-pane="sidebar"><span class="railMark">${officialSvg(FISH_VIEWBOX, '24')}</span></div>
  `)
  applyOverlay(document, DEFAULT_CONFIG, [])
  const fishes = svgsWithViewBox(document, FISH_VIEWBOX)
  assert.equal(fishes.length, 2)
  assert.ok(fishes.every(svg => svg.hasAttribute('data-omnimux-covered')))
})

test('brand mark cover stays in brandMark, not on a session row', () => {
  const document = load(`
    <div class="logoRow">
      <span class="brandIdentity">
        <span class="brandMark">${officialSvg(FISH_VIEWBOX, '24')}</span>
        <span class="brandName">${officialSvg(NAME_WORDMARK_VIEWBOX, '156')}</span>
      </span>
    </div>
    <div class="sidebarCol">
      <div role="treeitem" class="sessionRow selected">session title</div>
    </div>
  `)
  applyOverlay(document, DEFAULT_CONFIG, [])
  const mark = document.querySelector('[data-omnimux-brand="fish"]')
  assert.ok(mark?.closest('.brandMark'))
  assert.equal(mark?.style.position, '')
  assert.equal(document.querySelector('[role="treeitem"] [data-omnimux-brand]'), null)
})

test('does not paint a brand mark on the composer card', () => {
  const document = load(`
    <div class="composerHero" style="position:relative">
      <div class="headline"><span class="fishHitbox">${officialSvg(FISH_VIEWBOX, '34')}</span></div>
      <div data-composer-seat>${officialSvg(FISH_VIEWBOX, '34')}</div>
    </div>
  `)
  applyOverlay(document, DEFAULT_CONFIG, [])
  const cover = document.querySelector('[data-omnimux-brand="fish"]')
  assert.ok(cover?.closest('.fishHitbox'))
  assert.equal(document.querySelector('[data-composer-seat] [data-omnimux-brand="fish"]'), null)
  const inComposer = svgsWithViewBox(document, FISH_VIEWBOX).find(svg => svg.closest('[data-composer-seat]'))
  assert.equal(inComposer?.hasAttribute('data-omnimux-covered'), false)
})

test('replaceHeroMark false still covers the collapsed rail whale', () => {
  const document = load(`
    <span class="fishHitbox">${officialSvg(FISH_VIEWBOX, '34')}</span>
    <div data-pane="sidebar"><span class="railMark">${officialSvg(FISH_VIEWBOX, '24')}</span></div>
  `)
  applyOverlay(document, resolveConfig({ replaceHeroMark: false }), [])
  const fishes = svgsWithViewBox(document, FISH_VIEWBOX)
  const hero = fishes.find(svg => svg.getAttribute('width') === '34')
  const rail = fishes.find(svg => svg.getAttribute('width') === '24')
  assert.equal(hero?.hasAttribute('data-omnimux-covered'), false)
  assert.ok(rail?.hasAttribute('data-omnimux-covered'))
})

test('orphan covers are removed after the official svg unmounts', () => {
  const document = load(`<div data-pane="sidebar"><button class="railMark">${officialSvg(FISH_VIEWBOX, '24')}</button></div>`)
  applyOverlay(document, DEFAULT_CONFIG, [])
  assert.ok(document.querySelector('[data-omnimux-brand="fish"]'))
  svgsWithViewBox(document, FISH_VIEWBOX)[0]?.remove()
  applyOverlay(document, DEFAULT_CONFIG, [])
  assert.equal(document.querySelector('[data-omnimux-brand="fish"]'), null)
})

test('hidePreviewBadge marks locale pills for the headline-fit hide rule', () => {
  const document = load(`
    <div>
      <span class="fishHitbox">${officialSvg(FISH_VIEWBOX, '34')}</span>
      <span>探索未至之境</span>
      <span>预览版</span>
    </div>
  `)
  applyOverlay(document, DEFAULT_CONFIG, [])
  const badge = [...document.querySelectorAll('span')].find(el => el.textContent === '预览版')
  assert.ok(badge?.hasAttribute('data-omnimux-hide'))
})

test('rewriteHeroHeadline replaces the official Chinese headline exactly', () => {
  const document = load(`
    <div class="headline">
      <span class="headlineText">探索未至之境</span>
      <span>预览版</span>
      <p>探索未至之境吧</p>
    </div>
  `)
  applyOverlay(document, DEFAULT_CONFIG, [])
  assert.equal(document.querySelector('.headlineText')?.textContent, '属于你的AI社媒运营团队')
  assert.equal([...document.querySelectorAll('span')].find(el => el.textContent === '预览版') != null, true)
  assert.equal(document.querySelector('p')?.textContent, '探索未至之境吧')
})

test('rewriteHeroHeadline replaces the official English headline exactly', () => {
  const document = load('<span class="headlineText">Into the Unknown</span>')
  applyOverlay(document, resolveConfig({ heroHeadline: 'Your AI social team' }), [])
  assert.equal(document.querySelector('.headlineText')?.textContent, 'Your AI social team')
})

test('rewriteHeroHeadline restore on dispose', () => {
  const document = load('<span class="headlineText">探索未至之境</span>')
  const stop = startOverlay(document, DEFAULT_CONFIG)
  assert.equal(document.querySelector('.headlineText')?.textContent, '属于你的AI社媒运营团队')
  stop()
  assert.equal(document.querySelector('.headlineText')?.textContent, '探索未至之境')
})

test('rewriteWelcome rewrites product phrases and dispose restores them', () => {
  const document = load('<p>DeepSeek Harness remains in testing. Join the DSH plugin ecosystem.</p>')
  const stop = startOverlay(document, DEFAULT_CONFIG)
  assert.match(document.body.textContent ?? '', /OmniMux remains in testing/)
  assert.match(document.body.textContent ?? '', /OmniMux plugin ecosystem/)
  stop()
  assert.match(document.body.textContent ?? '', /DeepSeek Harness remains in testing/)
  assert.match(document.body.textContent ?? '', /DSH plugin ecosystem/)
})

test('replaces the official sidebar fallback brand text and restores it', () => {
  const document = load('<div><span class="fallbackBrandName">DSH Local Build</span></div>')
  const stop = startOverlay(document, DEFAULT_CONFIG)
  assert.equal(document.querySelector('.fallbackBrandName')?.textContent, 'OmniMux')
  stop()
  assert.equal(document.querySelector('.fallbackBrandName')?.textContent, 'DSH Local Build')
})

test('resolveConfig fills headline-fit defaults', () => {
  const resolved = resolveConfig({})
  assert.equal(resolved.heroHeadlineFit, true)
  assert.equal(resolved.heroHeadlineMaxPx, 26)
  assert.equal(resolved.heroHeadlineMinPx, 16)
})

test('applyOverlay starts headline fit after rewriting the hero title', () => {
  const document = load(`
    <div class="headline">
      <span class="headlineText">探索未至之境</span>
      <span>预览版</span>
    </div>
  `)
  applyOverlay(document, DEFAULT_CONFIG, [])
  const title = document.querySelector('.headlineText')
  assert.equal(title?.textContent, DEFAULT_HERO_HEADLINE)
  assert.ok(title?.hasAttribute(HERO_HEADLINE_ATTR))
  const css = document.getElementById(HERO_HEADLINE_FIT_STYLE_ID)?.textContent ?? ''
  assert.match(css, /white-space:nowrap !important/)
  assert.match(css, /\[data-omnimux-hide\]\{display:none !important\}/)
  const badge = [...document.querySelectorAll('span')].find(el => el.textContent === '预览版')
  assert.ok(badge?.hasAttribute('data-omnimux-hide'))
})

test('applyOverlay retargets headline fit after the title remounts', () => {
  const document = load(`
    <div class="headline">
      <span class="headlineText">探索未至之境</span>
    </div>
  `)
  const restores = []
  applyOverlay(document, DEFAULT_CONFIG, restores)
  const first = document.querySelector('.headlineText')
  first.remove()
  const next = document.createElement('span')
  next.className = 'headlineText'
  next.textContent = '探索未至之境'
  document.querySelector('.headline').append(next)
  applyOverlay(document, DEFAULT_CONFIG, restores)
  assert.equal(next.textContent, DEFAULT_HERO_HEADLINE)
  assert.equal(next.hasAttribute(HERO_HEADLINE_ATTR), true)
  assert.equal(first.hasAttribute(HERO_HEADLINE_ATTR), false)
  assert.equal(document.querySelectorAll(`#${HERO_HEADLINE_FIT_STYLE_ID}`).length, 1)
})

test('heroHeadlineFit false skips the fitter after rewrite', () => {
  const document = load('<span class="headlineText">探索未至之境</span>')
  applyOverlay(document, resolveConfig({ heroHeadlineFit: false }), [])
  assert.equal(document.querySelector('.headlineText')?.textContent, DEFAULT_HERO_HEADLINE)
  assert.equal(document.getElementById(HERO_HEADLINE_FIT_STYLE_ID), null)
  assert.equal(document.querySelector(`[${HERO_HEADLINE_ATTR}]`), null)
})

test('startOverlay dispose removes the headline-fit stylesheet', () => {
  const document = load('<span class="headlineText">探索未至之境</span>')
  const stop = startOverlay(document, DEFAULT_CONFIG)
  assert.ok(document.getElementById(HERO_HEADLINE_FIT_STYLE_ID))
  stop()
  assert.equal(document.getElementById(HERO_HEADLINE_FIT_STYLE_ID), null)
  assert.equal(document.querySelector(`[${HERO_HEADLINE_ATTR}]`), null)
  assert.equal(document.querySelector('.headlineText')?.textContent, '探索未至之境')
})

test('dispose restores official chrome', () => {
  const document = load(`
    <button>${officialSvg(WORDMARK_VIEWBOX, '182')}</button>
    <div data-pane="sidebar"><span class="railMark">${officialSvg(FISH_VIEWBOX, '24')}</span></div>
  `)
  const stop = startOverlay(document, DEFAULT_CONFIG)
  assert.ok(document.querySelector('[data-omnimux-brand="wordmark"]'))
  stop()
  assert.equal(document.title, officialTitle)
  assert.equal(document.querySelector('link[rel="icon"]')?.getAttribute('href'), '/favicon.svg')
  assert.equal(svgsWithViewBox(document, WORDMARK_VIEWBOX).length, 1)
  assert.equal(svgsWithViewBox(document, FISH_VIEWBOX).length, 1)
  assert.equal(document.querySelector('[data-omnimux-brand]'), null)
})
