import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertBrandConfig, Config, parseBrandConfig } from './config.js'
import { DEFAULT_CONFIG } from './defaults.js'

test('parseBrandConfig fills OmniMux defaults', () => {
  const parsed = parseBrandConfig({})
  assert.equal(parsed.productName, DEFAULT_CONFIG.productName)
  assert.equal(parsed.wordmarkText, DEFAULT_CONFIG.wordmarkText)
  assert.equal(parsed.replaceHeroMark, true)
  assert.equal(parsed.hidePreviewBadge, true)
  assert.equal(parsed.rewriteWelcome, true)
  assert.equal(parsed.heroHeadline, DEFAULT_CONFIG.heroHeadline)
  assert.equal(parsed.heroHeadlineFit, true)
  assert.equal(parsed.heroHeadlineMaxPx, 26)
  assert.equal(parsed.heroHeadlineMinPx, 16)
  assert.ok(parsed.logoSvg.includes('<svg'))
})

test('Config Standard Schema accepts empty input', () => {
  const result = Config['~standard'].validate({})
  assert.ok('value' in result)
  assert.equal(result.value.productName, 'OmniMux')
})

test('Config Standard Schema rejects a non-svg logo', () => {
  const result = Config['~standard'].validate({ logoSvg: 'not-a-mark' })
  assert.ok('issues' in result)
  assert.match(result.issues[0]?.message ?? '', /logoSvg must contain an <svg> document/)
})

test('assertBrandConfig rejects an empty product name', () => {
  assert.throws(
    () => assertBrandConfig({ ...DEFAULT_CONFIG, productName: '   ' }),
    /productName must be a non-empty string/,
  )
})

test('assertBrandConfig rejects an empty hero headline', () => {
  assert.throws(
    () => assertBrandConfig({ ...DEFAULT_CONFIG, heroHeadline: '   ' }),
    /heroHeadline must be a non-empty string/,
  )
})

test('parseBrandConfig keeps an explicit heroHeadline', () => {
  const parsed = parseBrandConfig({ heroHeadline: '自有主视觉文案' })
  assert.equal(parsed.heroHeadline, '自有主视觉文案')
})

test('parseBrandConfig keeps explicit headline-fit knobs', () => {
  const parsed = parseBrandConfig({
    heroHeadlineFit: false,
    heroHeadlineMaxPx: 24,
    heroHeadlineMinPx: 12,
  })
  assert.equal(parsed.heroHeadlineFit, false)
  assert.equal(parsed.heroHeadlineMaxPx, 24)
  assert.equal(parsed.heroHeadlineMinPx, 12)
})

test('assertBrandConfig rejects a non-boolean heroHeadlineFit', () => {
  assert.throws(
    () => assertBrandConfig({ ...DEFAULT_CONFIG, heroHeadlineFit: 'yes' }),
    /heroHeadlineFit must be a boolean/,
  )
})

test('assertBrandConfig rejects a non-positive headline px', () => {
  assert.throws(
    () => assertBrandConfig({ ...DEFAULT_CONFIG, heroHeadlineMaxPx: 0 }),
    /heroHeadlineMaxPx must be a positive integer/,
  )
  assert.throws(
    () => assertBrandConfig({ ...DEFAULT_CONFIG, heroHeadlineMinPx: 12.5 }),
    /heroHeadlineMinPx must be a positive integer/,
  )
})

test('assertBrandConfig rejects minPx above maxPx', () => {
  assert.throws(
    () => assertBrandConfig({ ...DEFAULT_CONFIG, heroHeadlineMinPx: 28, heroHeadlineMaxPx: 26 }),
    /heroHeadlineMinPx must be <= heroHeadlineMaxPx/,
  )
})
