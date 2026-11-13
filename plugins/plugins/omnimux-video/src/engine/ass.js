/**
 * v1 simplified ASS subtitle generation, generated in-plugin and burned with
 * ffmpeg's `ass=` filter. White text, black outline, bottom-center (Align 2),
 * WrapStyle 2, single-line preferred.
 */

/**
 * `seconds` → ASS timecode `H:MM:SS.cc` (centiseconds).
 * @param {number} seconds
 * @returns {string}
 */
export function assTimestamp(seconds) {
  const s = Math.max(0, Number(seconds) || 0)
  let hours = Math.floor(s / 3600)
  let minutes = Math.floor((s % 3600) / 60)
  let whole = Math.floor(s % 60)
  let centis = Math.round((s - Math.floor(s)) * 100)
  if (centis >= 100) { whole += 1; centis -= 100 }
  if (whole >= 60) { minutes += 1; whole -= 60 }
  if (minutes >= 60) { hours += 1; minutes -= 60 }
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(centis).padStart(2, '0')}`
}

/**
 * Escape ASS text. Line breaks → `\N`.
 * @param {string} text
 * @returns {string}
 */
export function escapeAssText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '\\N')
}

/**
 * Default style fragments used when `style` is omitted.
 */
export function defaultStyle() {
  return {
    fontName: 'Arial',
    fontSize: 28,
    primary: '&H00FFFFFF',      // white
    outline: 3,                 // black outline width
    shadow: 1,
    alignment: 2,               // bottom-center
    marginV: 24,
  }
}

/**
 * `ASS` colour in that order: RRGGBB (ASS stores BGR). We accept `#RRGGBB`.
 * @param {string} hex
 * @returns {string}
 */
function asAssColor(hex) {
  const h = String(hex || '').replace(/^#/, '').toUpperCase()
  if (!/^[0-9A-F]{6}$/.test(h)) return '&H00FFFFFF'
  const r = h.slice(0, 2)
  const g = h.slice(2, 4)
  const b = h.slice(4, 6)
  return `&H00${b}${g}${r}` // alpha + BGRA layout (A + BBGGRR)
}

/**
 * Build a complete ASS document for the given segments.
 *
 * @param {{
 *   width: number,
 *   height: number,
 *   style?: Record<string, unknown>,
 *   segments: Array<{ start: number, duration: number, text: string }>,
 * }} opts
 * @returns {string}
 */
export function buildAss({ width, height, style = {}, segments = [] }) {
  const s = { ...defaultStyle(), ...(style || {}) }
  const primary = asAssColor(String(s.primary ?? '#FFFFFF'))
  const outline = asAssColor(String(s.outlineColor ?? '#000000'))
  const back = asAssColor(String(s.backColor ?? '#000000'))

  const lines = []
  lines.push('[Script Info]')
  lines.push('ScriptType: v4.00+')
  lines.push('PlayResX: ' + Math.max(2, Math.round(Number(width) || 2)))
  lines.push('PlayResY: ' + Math.max(2, Math.round(Number(height) || 2)))
  lines.push('WrapStyle: 2')
  lines.push('')
  lines.push('[V4+ Styles]')
  lines.push(
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  )
  lines.push(
    `Style: Default,${String(s.fontName ?? 'Arial')},${Math.round(Number(s.fontSize) || 28)},${primary},&H00FFFFFF,${outline},${back},0,0,0,0,100,100,0,0,1,${Number(s.outline) || 3},${Number(s.shadow) || 1},2,20,20,${Math.round(Number(s.marginV) || 24)},1`,
  )
  lines.push('')
  lines.push('[Events]')
  lines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text')
  for (const seg of segments || []) {
    const start = Math.max(0, Number(seg.start) || 0)
    const duration = Math.max(0, Number(seg.duration) || 0)
    const text = escapeAssText(String(seg.text ?? ''))
    if (!text) continue
    lines.push(
      `Dialogue: 0,${assTimestamp(start)},${assTimestamp(start + duration)},Default,,0,0,0,,${text}`,
    )
  }
  return lines.join('\n') + '\n'
}