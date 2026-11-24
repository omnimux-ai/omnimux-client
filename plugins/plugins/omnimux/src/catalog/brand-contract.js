/**
 * Self-contained Node.js brand-contract validators and canonical display names
 * for `plugins/omnimux/src/catalog/*`.
 *
 * Kept dependency-free (no `dsh-ui-kit` runtime import) so the host catalog
 * kernel remains hermetically importable when copied standalone (for example
 * in `generation-products.test.js` and `generation-mapping.test.js`).
 * Parity with `dsh-ui-kit/model-brands` is locked by `model-brand-hybrid.test.js`.
 */

/** Maximum UTF-8 byte length for a gateway-supplied fallback SVG `<path d>`. */
export const MAX_BRAND_ICON_PATH_BYTES = 4096

/** Canonical gateway `brand_id` slug pattern (lowercase kebab-case, <= 64 bytes). */
export const BRAND_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Strict ASCII SVG `<path d>` character whitelist (parity with gateway ValidateBrandIconPath). */
export const BRAND_ICON_PATH_PATTERN = /^[MmLlHhVvCcSsQqTtAaZz0-9., \t\r\n+-]+$/

/** Canonical brand display names (parity with omnimux-gateway/modelcontracts/brands.go). */
export const CANONICAL_BRAND_NAMES = Object.freeze({
  alibaba: 'Alibaba',
  anthropic: 'Anthropic',
  bilibili: 'Bilibili',
  bytedance: 'ByteDance',
  deepseek: 'DeepSeek',
  elevenlabs: 'ElevenLabs',
  google: 'Google',
  grok: 'xAI',
  indextts: 'Index TTS2',
  instagram: 'Instagram',
  kimi: 'Kimi',
  kling: 'Kling',
  midjourney: 'Midjourney',
  minimax: 'MiniMax',
  muse: 'Muse',
  openai: 'OpenAI',
  runway: 'Runway',
  stability: 'Stability AI',
  suno: 'Suno',
  tiktok: 'TikTok',
  'typesafe-ai': 'TypeSafe AI',
  veo: 'Veo',
  vidu: 'Vidu',
  x: 'X',
  youtube: 'YouTube',
  zhipu: 'Zhipu',
})

/**
 * Fail-closed validator for canonical gateway `brand_id` values.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidBrandId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false
  return BRAND_ID_PATTERN.test(value)
}

/**
 * Fail-closed validator for gateway-supplied 24x24 monochrome SVG `<path d>` data.
 * @param {unknown} value
 * @returns {string | null}
 */
export function sanitizeBrandIconPath(value) {
  if (typeof value !== 'string' || value.length === 0) return null
  if (value.length > MAX_BRAND_ICON_PATH_BYTES) return null
  if (value.trim() !== value) return null
  const first = value[0]
  if (first !== 'M' && first !== 'm') return null
  if (!BRAND_ICON_PATH_PATTERN.test(value)) return null
  return value
}

/**
 * Resolve canonical display name for a known brand ID.
 * @param {unknown} brandId
 * @returns {string | null}
 */
export function getCanonicalBrandName(brandId) {
  if (!isValidBrandId(brandId)) return null
  return Object.hasOwn(CANONICAL_BRAND_NAMES, /** @type {string} */ (brandId))
    ? CANONICAL_BRAND_NAMES[/** @type {keyof typeof CANONICAL_BRAND_NAMES} */ (brandId)]
    : null
}
