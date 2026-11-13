/**
 * Host Config schema for the OmniMux brand overlay.
 * Deployment-varying brand strings and the logo document live here.
 * Standard Schema only — no schemastery import, so the local plugin resolves
 * without a workspace install.
 */

import { DEFAULT_CONFIG, DEFAULT_LOGO_SVG } from './defaults.js'

/**
 * @typedef {import('./defaults.js').BrandConfig} BrandConfig
 */

/**
 * Reject empty brand strings after defaults.
 * @param {BrandConfig} config Schema output.
 * @returns {BrandConfig} the same object when valid.
 */
export function assertBrandConfig(config) {
  if (config.productName.trim() === '') {
    throw new Error('omnimux: productName must be a non-empty string')
  }
  if (config.wordmarkText.trim() === '') {
    throw new Error('omnimux: wordmarkText must be a non-empty string')
  }
  if (config.heroHeadline.trim() === '') {
    throw new Error('omnimux: heroHeadline must be a non-empty string')
  }
  if (typeof config.heroHeadlineFit !== 'boolean') {
    throw new Error('omnimux: heroHeadlineFit must be a boolean')
  }
  assertPositiveInt('heroHeadlineMaxPx', config.heroHeadlineMaxPx)
  assertPositiveInt('heroHeadlineMinPx', config.heroHeadlineMinPx)
  if (config.heroHeadlineMinPx > config.heroHeadlineMaxPx) {
    throw new Error('omnimux: heroHeadlineMinPx must be <= heroHeadlineMaxPx')
  }
  if (!config.logoSvg.includes('<svg')) {
    throw new Error('omnimux: logoSvg must contain an <svg> document')
  }
  return config
}

/**
 * Reject non-integer / non-positive pixel knobs.
 * @param {string} name Field name.
 * @param {unknown} value Candidate.
 */
function assertPositiveInt(name, value) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`omnimux: ${name} must be a positive integer`)
  }
}

/**
 * Fill defaults then validate.
 * @param {unknown} value Raw cordis.yml config.
 * @returns {BrandConfig} resolved config.
 */
export function parseBrandConfig(value) {
  if (value == null) return assertBrandConfig({ ...DEFAULT_CONFIG })
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('omnimux: brand config must be an object')
  }
  const input = /** @type {Partial<BrandConfig>} */ (value)
  return assertBrandConfig({
    productName: input.productName ?? DEFAULT_CONFIG.productName,
    logoSvg: input.logoSvg ?? DEFAULT_LOGO_SVG,
    wordmarkText: input.wordmarkText ?? DEFAULT_CONFIG.wordmarkText,
    replaceHeroMark: input.replaceHeroMark ?? DEFAULT_CONFIG.replaceHeroMark,
    hidePreviewBadge: input.hidePreviewBadge ?? DEFAULT_CONFIG.hidePreviewBadge,
    rewriteWelcome: input.rewriteWelcome ?? DEFAULT_CONFIG.rewriteWelcome,
    heroHeadline: input.heroHeadline ?? DEFAULT_CONFIG.heroHeadline,
    heroHeadlineFit: input.heroHeadlineFit ?? DEFAULT_CONFIG.heroHeadlineFit,
    heroHeadlineMaxPx: input.heroHeadlineMaxPx ?? DEFAULT_CONFIG.heroHeadlineMaxPx,
    heroHeadlineMinPx: input.heroHeadlineMinPx ?? DEFAULT_CONFIG.heroHeadlineMinPx,
  })
}

/**
 * Cordis Standard Schema. Loader calls `Config['~standard'].validate`.
 * @type {{ '~standard': { version: 1, vendor: string, validate: (value: unknown) => { value: BrandConfig } | { issues: Array<{ message: string }> } } }}
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'omnimux',
    validate(value) {
      try {
        return { value: parseBrandConfig(value) }
      } catch (error) {
        return { issues: [{ message: error instanceof Error ? error.message : String(error) }] }
      }
    },
  },
}
