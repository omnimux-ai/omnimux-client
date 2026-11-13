import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { areaPath, barLayout, chartPointsForMetric, lineLayout, polylinePath, ticks } from './charts-math.js'

describe('barLayout', () => {
  it('places fixture posts-over-time bars inside the plot box', () => {
    const { bars, max, box } = barLayout([6, 6, 0, 0, 0], 320, 180)
    assert.equal(bars.length, 5)
    assert.equal(max, 10)
    assert.ok(bars[0].height > 0)
    assert.equal(bars[2].height, 0)
    assert.ok(bars[0].x >= box.x)
    assert.ok(bars[4].x + bars[4].width <= box.x + box.width + 0.01)
  })
})

describe('lineLayout / polylinePath', () => {
  it('builds a dual-friendly path and skips nulls', () => {
    const { points } = lineLayout([17, 16, 1, 0, 0], 400, 200)
    const d = polylinePath(points)
    assert.match(d, /^M /)
    assert.equal((d.match(/ L /g) || []).length, 4)
    const broken = polylinePath([
      { x: 0, y: 10 },
      { x: 10, y: null },
      { x: 20, y: 5 },
    ])
    assert.equal(broken.startsWith('M '), true)
    assert.match(broken, /M 20/)
  })

  it('closes an area path against the baseline', () => {
    const { points, box } = lineLayout([0.6, 2.2], 200, 120)
    const d = areaPath(points, box.bottom)
    assert.match(d, /Z$/)
  })
})

describe('chartPointsForMetric', () => {
  it('lifts ER ratios onto percent points the way the prototype chart does', () => {
    assert.deepEqual(chartPointsForMetric('er', [0.0226, 0.021]), [2.26, 2.1])
    assert.deepEqual(chartPointsForMetric('likes', [17, 16]), [17, 16])
  })
})

describe('ticks', () => {
  it('emits 0..max inclusive', () => {
    assert.deepEqual(ticks(20, 5), [0, 5, 10, 15, 20])
    assert.deepEqual(ticks(100, 5), [0, 25, 50, 75, 100])
    assert.deepEqual(ticks(5, 5), [0, 1, 2, 3, 4, 5])
  })
})
