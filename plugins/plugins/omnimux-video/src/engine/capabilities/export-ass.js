import { buildAss, assTimestamp, escapeAssText } from '../ass.js'

export { buildAss, assTimestamp, escapeAssText }

/**
 * Normalize a subtitles input into `{ start, duration, text }` segments.
 *
 * Two accepted shapes:
 * - `{ segments: [{ start, duration, text }], style? }` — explicit timeline
 * - `{ text, mode: 'auto-split', style? }` — coarse split by sentence /
 *   newline, each unit ~3s across the given total duration.
 *
 * @param {object} subtitles
 * @param {{ duration?: number }} [opts]
 * @returns {Array<{ start: number, duration: number, text: string }>}
 */
export function normalizeSubtitleSegments(subtitles, { duration = 0 } = {}) {
  if (!subtitles || typeof subtitles !== 'object') return []
  const mode = subtitles.mode === 'auto-split' ? 'auto-split' : 'timeline'
  if (mode === 'auto-split') {
    const text = String(subtitles.text ?? '').trim()
    if (!text) return []
    return autoSplit(text, Number(duration) || 0)
  }
  const segs = Array.isArray(subtitles.segments) ? subtitles.segments : []
  const out = []
  for (const raw of segs) {
    if (!raw || typeof raw !== 'object') continue
    const text = String(raw.text ?? '').trim()
    const start = Number(raw.start ?? 0)
    const len = Number(raw.duration ?? 0)
    if (!text || !Number.isFinite(start) || start < 0 || !Number.isFinite(len) || len <= 0) continue
    out.push({ start, duration: len, text })
  }
  return out
}

/**
 * Split free text into ~3s subtitle units: sentence/newline breaks preferred,
 * hard fallback every ~30 chars.
 * @param {string} text @param {number} total
 */
export function autoSplit(text, total) {
  const units = String(text)
    .split(/(?<=[。！？!?；;.\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (units.length === 0) return []
  const per = Math.max(1.5, total / units.length)
  const out = []
  let cursor = 0
  for (const unit of units) {
    out.push({ start: cursor, duration: per, text: unit })
    cursor += per
  }
  return out
}