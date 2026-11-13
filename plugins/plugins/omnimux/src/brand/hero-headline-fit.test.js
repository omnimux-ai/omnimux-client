import { JSDOM } from 'jsdom'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { DEFAULT_CONFIG, DEFAULT_HERO_HEADLINE } from './defaults.js'
import {
  computeHeadlineSize,
  HERO_HEADLINE_ATTR,
  HERO_HEADLINE_FIT_STYLE_ID,
  HERO_HEADLINE_LEADING_VAR,
  HERO_HEADLINE_SIZE_VAR,
  headlineLeadingPx,
  heuristicMeasure,
  startHeadlineFit,
} from './hero-headline-fit.js'

/** @type {JSDOM | undefined} */
let dom

afterEach(() => {
  dom?.window.close()
  dom = undefined
})

/**
 * @param {string} html
 * @returns {Document}
 */
function load(html) {
  dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, {
    url: 'http://127.0.0.1/',
  })
  return dom.window.document
}

/**
 * @param {Element} el
 * @param {number} width
 */
function stubClientWidth(el, width) {
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => width })
}

/** Proportional measure: each character is 1em. */
function emMeasure(text, px) {
  return text.length * px
}

test('computeHeadlineSize keeps maxPx on a wide column', () => {
  const size = computeHeadlineSize(400, DEFAULT_HERO_HEADLINE, {
    maxPx: 26,
    minPx: 16,
    measure: emMeasure,
  })
  assert.equal(size, 26)
})

test('computeHeadlineSize floors at minPx when even the floor overflows', () => {
  const size = computeHeadlineSize(100, DEFAULT_HERO_HEADLINE, {
    maxPx: 26,
    minPx: 16,
    measure: emMeasure,
  })
  assert.equal(size, 16)
})

test('computeHeadlineSize binary-searches a mid value that exactly fits', () => {
  // 10 glyphs × px. available 200 → 26 overflows, 16 fits, 20 is exact.
  const size = computeHeadlineSize(200, '一二三四五六七八九十', {
    maxPx: 26,
    minPx: 16,
    measure: emMeasure,
  })
  assert.equal(size, 20)
})

test('computeHeadlineSize returns maxPx for empty text or non-positive width', () => {
  assert.equal(computeHeadlineSize(200, '', { maxPx: 26, minPx: 16 }), 26)
  assert.equal(computeHeadlineSize(0, DEFAULT_HERO_HEADLINE, { maxPx: 26, minPx: 16 }), 26)
  assert.equal(computeHeadlineSize(-8, DEFAULT_HERO_HEADLINE, { maxPx: 26, minPx: 16 }), 26)
})

test('headlineLeadingPx keeps 32px at 26px and scales the rest', () => {
  assert.equal(headlineLeadingPx(26), 32)
  assert.equal(headlineLeadingPx(13), 16)
})

test('heuristicMeasure treats CJK as 1em and ASCII as 0.55em', () => {
  assert.equal(heuristicMeasure('中', 10), 10)
  assert.equal(heuristicMeasure('A', 10), 5.5)
  assert.equal(heuristicMeasure('中A', 10), 15.5)
})

test('startHeadlineFit writes 26px on a wide headline grid', () => {
  const document = load(`
    <div class="headline">
      <span class="fishHitbox"></span>
      <span class="headlineText">${DEFAULT_HERO_HEADLINE}</span>
    </div>
  `)
  stubClientWidth(document.querySelector('.headline'), 800)
  const restores = []
  startHeadlineFit(document, DEFAULT_CONFIG, restores)
  assert.equal(document.documentElement.style.getPropertyValue(HERO_HEADLINE_SIZE_VAR), '26px')
  assert.equal(document.documentElement.style.getPropertyValue(HERO_HEADLINE_LEADING_VAR), '32px')
  assert.ok(document.querySelector('.headlineText')?.hasAttribute(HERO_HEADLINE_ATTR))
})

test('startHeadlineFit converges to minPx on a narrow headline grid', () => {
  const document = load(`
    <div class="headline">
      <span class="fishHitbox"></span>
      <span class="headlineText">${DEFAULT_HERO_HEADLINE}</span>
    </div>
  `)
  // Fish 34 + gap 10 → available 40. Floor overflows; still minPx.
  stubClientWidth(document.querySelector('.headline'), 84)
  startHeadlineFit(document, DEFAULT_CONFIG, [])
  assert.equal(document.documentElement.style.getPropertyValue(HERO_HEADLINE_SIZE_VAR), '16px')
})

test('startHeadlineFit binary-searches a mid size on a medium column', () => {
  const document = load(`
    <div class="headline">
      <span class="fishHitbox"></span>
      <span class="headlineText">一二三四五六七八九十</span>
    </div>
  `)
  // 10 glyphs × px via heuristic (all CJK). available 200 → 20px exact.
  // grid = 200 + 34 + 10 = 244.
  stubClientWidth(document.querySelector('.headline'), 244)
  startHeadlineFit(document, { ...DEFAULT_CONFIG, heroHeadline: '一二三四五六七八九十' }, [])
  assert.equal(document.documentElement.style.getPropertyValue(HERO_HEADLINE_SIZE_VAR), '20px')
})

test('startHeadlineFit injects nowrap and hide display:none rules', () => {
  const document = load(`<div class="headline"><span class="headlineText">${DEFAULT_HERO_HEADLINE}</span></div>`)
  stubClientWidth(document.querySelector('.headline'), 800)
  startHeadlineFit(document, DEFAULT_CONFIG, [])
  const css = document.getElementById(HERO_HEADLINE_FIT_STYLE_ID)?.textContent ?? ''
  assert.match(css, /white-space:nowrap !important/)
  assert.match(css, /font-size:var\(--omnimux-hero-headline-size, 26px\) !important/)
  assert.match(css, /line-height:var\(--omnimux-hero-headline-leading, 32px\) !important/)
  assert.match(css, /\[data-omnimux-hide\]\{display:none !important\}/)
})

test('startHeadlineFit dispose restores the document', () => {
  const document = load(`<div class="headline"><span class="headlineText">${DEFAULT_HERO_HEADLINE}</span></div>`)
  stubClientWidth(document.querySelector('.headline'), 800)
  const restores = []
  const fitter = startHeadlineFit(document, DEFAULT_CONFIG, restores)
  assert.equal(restores.length, 1)
  fitter.dispose()
  assert.equal(document.getElementById(HERO_HEADLINE_FIT_STYLE_ID), null)
  assert.equal(document.querySelector(`[${HERO_HEADLINE_ATTR}]`), null)
  assert.equal(document.documentElement.style.getPropertyValue(HERO_HEADLINE_SIZE_VAR), '')
  assert.equal(document.documentElement.style.getPropertyValue(HERO_HEADLINE_LEADING_VAR), '')
})

test('heroHeadlineFit false is a no-op', () => {
  const document = load(`<div class="headline"><span class="headlineText">${DEFAULT_HERO_HEADLINE}</span></div>`)
  const restores = []
  const fitter = startHeadlineFit(document, { ...DEFAULT_CONFIG, heroHeadlineFit: false }, restores)
  fitter.retarget()
  fitter.dispose()
  assert.equal(restores.length, 0)
  assert.equal(document.getElementById(HERO_HEADLINE_FIT_STYLE_ID), null)
  assert.equal(document.querySelector(`[${HERO_HEADLINE_ATTR}]`), null)
})

test('startHeadlineFit retargets after the headline node is replaced', () => {
  const document = load(`<div class="headline"><span class="headlineText">${DEFAULT_HERO_HEADLINE}</span></div>`)
  const grid = document.querySelector('.headline')
  stubClientWidth(grid, 800)
  const fitter = startHeadlineFit(document, DEFAULT_CONFIG, [])
  const first = document.querySelector('.headlineText')
  first.remove()
  const next = document.createElement('span')
  next.className = 'headlineText'
  next.textContent = DEFAULT_HERO_HEADLINE
  grid.append(next)
  fitter.retarget()
  assert.equal(next.hasAttribute(HERO_HEADLINE_ATTR), true)
  assert.equal(first.hasAttribute(HERO_HEADLINE_ATTR), false)
})

test('a second startHeadlineFit on the same document retargets instead of stacking', () => {
  const document = load(`<div class="headline"><span class="headlineText">${DEFAULT_HERO_HEADLINE}</span></div>`)
  stubClientWidth(document.querySelector('.headline'), 800)
  const restores = []
  const first = startHeadlineFit(document, DEFAULT_CONFIG, restores)
  const second = startHeadlineFit(document, DEFAULT_CONFIG, restores)
  assert.equal(first, second)
  assert.equal(restores.length, 1)
  assert.equal(document.querySelectorAll(`#${HERO_HEADLINE_FIT_STYLE_ID}`).length, 1)
})
