import { zh } from './zh-CN.js'

/**
 * Pure (React-free) translation helpers for the vendored OpenReel GUI.
 * Dictionary keys are the English source literals; missing keys fall back to
 * the source text unchanged; `en` (and any non-zh locale) returns the source.
 */

function activeIsZh(active) {
  const a = String(active ?? 'zh').toLowerCase()
  return a === 'zh' || a.startsWith('zh') // zh / zh-cn / zh-hans …
}

export function formatMessage(text, values) {
  if (typeof text !== 'string' || !values?.length) return text
  return text.replace(/\{(\d+)\}/g, (token, index) =>
    Object.hasOwn(values, index) ? String(values[index]) : token,
  )
}

export function translateZh(src, values) {
  const text = typeof src === 'string' && Object.hasOwn(zh, src) ? zh[src] : src
  return formatMessage(text, values)
}

/** Build a t() for a given locale snapshot ({ active }) or active string. */
export function makeClipT(localeLike) {
  const active = typeof localeLike === 'string' ? localeLike : localeLike?.active
  return activeIsZh(active) ? translateZh : formatMessage
}
