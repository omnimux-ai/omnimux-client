import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatAxisTick,
  formatCount,
  formatEr,
  formatPercentPoints,
  formatPercentTick,
  formatSignedCount,
  getHeatmapLevel,
  minutesBetween,
  niceMax,
} from './format.js'

describe('formatCount', () => {
  it('renders missing as dash and keeps a meaningful zero', () => {
    assert.equal(formatCount(null), '-')
    assert.equal(formatCount(undefined), '-')
    assert.equal(formatCount(Number.NaN), '-')
    assert.equal(formatCount(0), '0')
    assert.equal(formatCount(635), '635')
  })

  it('compresses thousands and millions to one decimal', () => {
    assert.equal(formatCount(1900), '1.9K')
    assert.equal(formatCount(2100), '2.1K')
    assert.equal(formatCount(12_500_000), '12.5M')
    assert.equal(formatCount(-1900), '-1.9K')
  })
})

describe('formatEr', () => {
  it('prints two-decimal percents from a ratio and never fabricates 0%', () => {
    assert.equal(formatEr(0.0226), '2.26%')
    assert.equal(formatEr(0.0183), '1.83%')
    assert.equal(formatEr(0), '0.00%')
    assert.equal(formatEr(null), '-')
    assert.equal(formatEr(undefined), '-')
  })
})

describe('formatPercentPoints', () => {
  it('does not multiply cadence points by 100', () => {
    assert.equal(formatPercentPoints(2.2), '2.2%')
    assert.equal(formatPercentPoints(0.6), '0.6%')
    assert.equal(formatPercentPoints(null), '-')
  })
})

describe('formatAxisTick / formatPercentTick', () => {
  it('formats whole numbers cleanly without trailing zeros', () => {
    assert.equal(formatAxisTick(0), '0')
    assert.equal(formatAxisTick(25), '25')
    assert.equal(formatAxisTick(100), '100')
    assert.equal(formatAxisTick(1900), '1.9K')
  })

  it('formats non-integer ticks with at most one decimal and percent suffix', () => {
    assert.equal(formatAxisTick(1.25), '1.3')
    assert.equal(formatAxisTick(33.333333333333336), '33.3')
    assert.equal(formatPercentTick(0), '0%')
    assert.equal(formatPercentTick(25), '25%')
    assert.equal(formatPercentTick(100), '100%')
    assert.equal(formatPercentTick(33.333333333333336), '33.3%')
    assert.equal(formatPercentTick(null), '-')
  })
})

describe('formatSignedCount', () => {
  it('prefixes a plus on gains and hides missing', () => {
    assert.equal(formatSignedCount(17), '+17')
    assert.equal(formatSignedCount(0), '0')
    assert.equal(formatSignedCount(-3), '-3')
    assert.equal(formatSignedCount(null), '')
  })
})

describe('getHeatmapLevel', () => {
  it('maps scores onto the five contracted green bands', () => {
    assert.equal(getHeatmapLevel(0, 24), 0)
    assert.equal(getHeatmapLevel(null, 24), 0)
    assert.equal(getHeatmapLevel(5, 24), 1)
    assert.equal(getHeatmapLevel(8, 24), 2)
    assert.equal(getHeatmapLevel(13, 24), 3)
    assert.equal(getHeatmapLevel(17, 24), 3)
    assert.equal(getHeatmapLevel(18, 24), 4)
    assert.equal(getHeatmapLevel(24, 24), 4)
  })
})

describe('minutesBetween / niceMax', () => {
  it('rounds a 14-minute gap the way the prototype copy does', () => {
    const now = 1_000_000
    assert.deepEqual(minutesBetween(now - 14 * 60_000, now), { kind: 'minutes', minutes: 14 })
    assert.deepEqual(minutesBetween(now, now), { kind: 'justNow', minutes: 0 })
    assert.deepEqual(minutesBetween(null, now), { kind: 'justNow', minutes: 0 })
  })

  it('lifts a raw max onto a 1/2/5 axis', () => {
    assert.equal(niceMax(12), 20)
    assert.equal(niceMax(34), 50)
    assert.equal(niceMax(0), 1)
  })
})
