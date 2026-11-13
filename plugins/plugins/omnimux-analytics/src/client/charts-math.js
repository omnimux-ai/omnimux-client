import { niceMax } from './format.js'

export const CHART_PAD = Object.freeze({ top: 12, right: 18, bottom: 28, left: 38 })
export const DUAL_PAD = Object.freeze({ top: 16, right: 44, bottom: 28, left: 38 })

/**
 * @param {Array<number | null | undefined>} values
 */
export function numericMax(values) {
  let max = 0
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > max) max = value
  }
  return max
}

/**
 * @param {number} width
 * @param {number} height
 * @param {{ top: number, right: number, bottom: number, left: number }} pad
 */
export function plotBox(width, height, pad) {
  const innerWidth = Math.max(1, width - pad.left - pad.right)
  const innerHeight = Math.max(1, height - pad.top - pad.bottom)
  return {
    x: pad.left,
    y: pad.top,
    width: innerWidth,
    height: innerHeight,
    right: pad.left + innerWidth,
    bottom: pad.top + innerHeight,
  }
}

/**
 * @param {Array<number | null | undefined>} values
 * @param {number} width
 * @param {number} height
 * @param {{ pad?: typeof CHART_PAD, gap?: number }} [opts]
 */
export function barLayout(values, width, height, opts = {}) {
  const pad = opts.pad ?? CHART_PAD
  const box = plotBox(width, height, pad)
  const max = niceMax(numericMax(values))
  const count = Math.max(1, values.length)
  const gap = opts.gap ?? 8
  const slot = box.width / count
  const barWidth = Math.max(4, Math.min(28, slot - gap))
  const bars = values.map((value, index) => {
    const n = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
    const h = max === 0 ? 0 : (n / max) * box.height
    const x = box.x + slot * index + (slot - barWidth) / 2
    const y = box.bottom - h
    return { x, y, width: barWidth, height: h, value: value ?? null, cx: x + barWidth / 2 }
  })
  return { box, max, bars }
}

/**
 * @param {Array<number | null | undefined>} values
 * @param {number} width
 * @param {number} height
 * @param {{ pad?: typeof CHART_PAD, max?: number }} [opts]
 */
export function lineLayout(values, width, height, opts = {}) {
  const pad = opts.pad ?? CHART_PAD
  const box = plotBox(width, height, pad)
  const max = opts.max ?? niceMax(numericMax(values))
  const count = Math.max(1, values.length)
  const step = count === 1 ? 0 : box.width / (count - 1)
  const points = values.map((value, index) => {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : null
    const x = box.x + step * index
    const y = n == null ? null : box.bottom - (max === 0 ? 0 : (Math.max(0, n) / max) * box.height)
    return { x, y, value: n }
  })
  return { box, max, points, step }
}

/**
 * @param {Array<{ x: number, y: number | null }>} points
 */
export function polylinePath(points) {
  let d = ''
  let drawing = false
  for (const point of points) {
    if (point.y == null) {
      drawing = false
      continue
    }
    d += drawing ? ` L ${point.x.toFixed(2)} ${point.y.toFixed(2)}` : `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
    drawing = true
  }
  return d.trim()
}

/**
 * Closed area under a polyline, for cadence fill.
 * @param {Array<{ x: number, y: number | null }>} points
 * @param {number} baselineY
 */
export function areaPath(points, baselineY) {
  const line = polylinePath(points)
  if (!line) return ''
  const first = points.find((p) => p.y != null)
  const last = [...points].reverse().find((p) => p.y != null)
  if (!first || !last) return ''
  return `${line} L ${last.x.toFixed(2)} ${baselineY.toFixed(2)} L ${first.x.toFixed(2)} ${baselineY.toFixed(2)} Z`
}

/**
 * Generates clean, nicely spaced ticks from 0 → max inclusive.
 * Default count is 5 (4 equal intervals, e.g. 0%, 25%, 50%, 75%, 100%).
 * @param {number} max
 * @param {number} [count=5]
 */
export function ticks(max, count = 5) {
  if (!Number.isFinite(max) || max <= 0) return [0]
  if (max === 5 && count === 5) return [0, 1, 2, 3, 4, 5]
  const steps = Math.max(1, count - 1)
  return Array.from({ length: count }, (_, i) => {
    const raw = (max * i) / steps
    return Math.round(raw * 1e6) / 1e6
  })
}

/**
 * ER series is stored as a 0–1 ratio; the composite chart plots it as percent
 * so it can share the left axis with likes/comments (prototype behaviour).
 * @param {string} key
 * @param {Array<number | null>} points
 */
export function chartPointsForMetric(key, points) {
  if (key !== 'er') return points
  return points.map((value) => (value == null ? null : value * 100))
}
