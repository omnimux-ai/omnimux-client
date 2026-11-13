/**
 * Phase-1 contract formatters. Null / NaN / undefined → '-'.
 * Meaningful zeros stay '0'. ER is stored as a ratio and shown as percent.
 */

export function formatCount(n) {
  if (n == null || Number.isNaN(n)) return '-'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`
  return `${n}`
}

export function formatEr(ratio) {
  if (ratio == null || Number.isNaN(ratio)) return '-'
  return `${(ratio * 100).toFixed(2)}%`
}

/**
 * Cadence ER is already a percent number (2.2 → '2.2%'). Do not multiply by 100.
 * @param {number | null | undefined} percent
 */
export function formatPercentPoints(percent) {
  if (percent == null || Number.isNaN(percent)) return '-'
  return `${percent}%`
}

/**
 * Clean tick label for chart axes. Handles integers, K/M compression, and float precision.
 * @param {number | null | undefined} n
 */
export function formatAxisTick(n) {
  if (n == null || Number.isNaN(n)) return '-'
  if (Math.abs(n - Math.round(n)) < 1e-4) return formatCount(Math.round(n))
  if (Math.abs(n) >= 1000) return formatCount(n)
  const fixed = Number(n.toFixed(1))
  if (Math.abs(fixed - Math.round(fixed)) < 1e-4) return formatCount(Math.round(fixed))
  return fixed.toString()
}

/**
 * Clean percentage tick label for chart axes (e.g. 0%, 25%, 50%, 75%, 100%).
 * @param {number | null | undefined} n
 */
export function formatPercentTick(n) {
  if (n == null || Number.isNaN(n)) return '-'
  return `${formatAxisTick(n)}%`
}

/**
 * Integer delta for KPI / pills. Null hides the badge entirely (caller checks).
 * @param {number | null | undefined} n
 */
export function formatSignedCount(n) {
  if (n == null || Number.isNaN(n)) return ''
  if (n > 0) return `+${formatCount(n)}`
  return formatCount(n)
}

/**
 * @param {number | null | undefined} from
 * @param {number} now
 * @returns {{ kind: 'justNow' | 'minutes', minutes: number }}
 */
export function minutesBetween(from, now) {
  if (from == null || Number.isNaN(from)) return { kind: 'justNow', minutes: 0 }
  const minutes = Math.round(Math.abs(now - from) / 60_000)
  if (minutes < 1) return { kind: 'justNow', minutes: 0 }
  return { kind: 'minutes', minutes }
}

/**
 * Heatmap 5-level mapping. Matches Tech Spec / Phase-1 contract §6.2.
 * @param {number} score
 * @param {number} maxScore
 */
export function getHeatmapLevel(score, maxScore) {
  if (!score || score <= 0) return 0
  const ratio = score / (maxScore || 1)
  if (ratio < 0.25) return 1
  if (ratio < 0.50) return 2
  if (ratio < 0.75) return 3
  return 4
}

/**
 * Nice axis ceiling so ticks land on 1/2/5 × 10^n.
 * @param {number} n
 */
export function niceMax(n) {
  if (!Number.isFinite(n) || n <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(n))
  const scaled = n / pow
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10
  return nice * pow
}
