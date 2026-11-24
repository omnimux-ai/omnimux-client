import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  BRAND_CATALOG,
  BRAND_SVGS,
  BRAND_SVGS_MONO,
  MAX_BRAND_ICON_PATH_BYTES,
  getAllBrands,
  getBrandInfo,
  getBrandMonogram,
  getCanonicalBrandName,
  isValidBrandId,
  resolveBrandVisual,
  resolveModelBrand,
  sanitizeBrandIconPath,
} from './model-brands.js'

describe('dsh-ui-kit/model-brands validators', () => {
  it('isValidBrandId enforces fail-closed lowercase kebab-case without silent trimming', () => {
    assert.equal(isValidBrandId('openai'), true)
    assert.equal(isValidBrandId('acme-labs'), true)
    assert.equal(isValidBrandId('typesafe-ai-2'), true)
    assert.equal(isValidBrandId('a'.repeat(64)), true)

    assert.equal(isValidBrandId(''), false)
    assert.equal(isValidBrandId(' openai'), false)
    assert.equal(isValidBrandId('openai '), false)
    assert.equal(isValidBrandId('OpenAI'), false)
    assert.equal(isValidBrandId('acme_labs'), false)
    assert.equal(isValidBrandId('-acme'), false)
    assert.equal(isValidBrandId('acme-'), false)
    assert.equal(isValidBrandId('acme--labs'), false)
    assert.equal(isValidBrandId('a'.repeat(65)), false)
    assert.equal(isValidBrandId(null), false)
    assert.equal(isValidBrandId(123), false)
  })

  it('sanitizeBrandIconPath validates 24x24 SVG path data fail-closed', () => {
    const diamond = 'M12 2L22 12L12 22L2 12Z'
    assert.equal(sanitizeBrandIconPath(diamond), diamond)
    assert.equal(sanitizeBrandIconPath('m0 0l10 10z'), 'm0 0l10 10z')

    const exactLimit = 'M' + '1'.repeat(MAX_BRAND_ICON_PATH_BYTES - 1)
    assert.equal(sanitizeBrandIconPath(exactLimit), exactLimit)
    assert.equal(sanitizeBrandIconPath('M' + '1'.repeat(MAX_BRAND_ICON_PATH_BYTES)), null)

    // Reject whitespace padding, non-M start, markup, URLs, quotes, scripts.
    for (const bad of [
      '',
      ' M12 2L22 12Z',
      'M12 2L22 12Z ',
      '\nM12 2Z',
      'L12 2L22 12Z',
      '<svg onload=alert(1)><path d="M0 0"/></svg>',
      'M0 0" onload="alert(1)',
      'javascript:alert(1)',
      'https://example.com/icon.svg',
      'M0 0; alert(1)',
      null,
      undefined,
      42,
    ]) {
      assert.equal(sanitizeBrandIconPath(bad), null, `must reject: ${String(bad)}`)
    }
  })
})

describe('dsh-ui-kit/model-brands resolution', () => {
  it('resolveModelBrand maps canonical brands accurately and returns null for unknown models', () => {
    assert.equal(resolveModelBrand('gpt-image-2.5'), 'openai')
    assert.equal(resolveModelBrand('claude-opus-4-6'), 'anthropic')
    assert.equal(resolveModelBrand('nano-banana-2-lite'), 'google')
    assert.equal(resolveModelBrand('nanobanana-2'), 'google')
    assert.equal(resolveModelBrand('veo-3.1-fast'), 'veo')
    assert.equal(resolveModelBrand('seedream-5-5'), 'bytedance')
    assert.equal(resolveModelBrand('seedance-2-5'), 'bytedance')
    assert.equal(resolveModelBrand('muse-image'), 'muse')
    assert.equal(resolveModelBrand('muse-video'), 'muse')
    assert.equal(resolveModelBrand('minimax-h3-video'), 'minimax')
    assert.equal(resolveModelBrand('grok-4.6'), 'grok')
    assert.equal(resolveModelBrand('indextts-2'), 'indextts')
    assert.equal(resolveModelBrand('gxgenai'), 'indextts')
    assert.equal(resolveModelBrand('wan-3.0'), 'alibaba')
    assert.equal(resolveModelBrand('kimi-k2.5'), 'kimi')
    assert.equal(resolveModelBrand('glm-4.5'), 'zhipu')

    // Never silently fall back to bytedance.
    assert.equal(resolveModelBrand('opaque-unknown-99'), null)
    assert.equal(resolveModelBrand(''), null)
    assert.equal(resolveModelBrand(undefined), null)
  })

  it('resolveBrandVisual implements 4-tier fallback without hijacking explicit gateway brands', () => {
    // Tier 1: Local high-craft SVG by canonical brandId (color vs mono).
    const googleColor = resolveBrandVisual({ brandId: 'google', modelId: 'nano-banana-2-1', variant: 'color' })
    assert.equal(googleColor.kind, 'svg')
    assert.equal(googleColor.source, 'local')
    assert.equal(googleColor.brandId, 'google')
    assert.equal(googleColor.vector.elements[0].attrs.fill, '#4285F4')

    const googleMono = resolveBrandVisual({ brandId: 'google', modelId: 'nano-banana-2-1', variant: 'mono' })
    assert.equal(googleMono.kind, 'svg')
    assert.equal(googleMono.source, 'local')
    assert.equal(googleMono.vector.elements[0].attrs.fill, 'currentColor')

    // Tier 2: Unknown gateway brandId with valid icon_path -> safe path fallback.
    const acme = resolveBrandVisual({
      brandId: 'acme-labs',
      brandName: 'Acme Labs',
      brandIconPath: 'M12 2L22 12L12 22L2 12Z',
      modelId: 'acme-gpt-vision',
      variant: 'mono',
    })
    assert.equal(acme.kind, 'path')
    assert.equal(acme.source, 'gateway-path')
    assert.equal(acme.brandId, 'acme-labs')
    assert.equal(acme.brandName, 'Acme Labs')
    assert.equal(acme.path, 'M12 2L22 12L12 22L2 12Z')

    // Tier 2 via brands dictionary.
    const acmeDict = resolveBrandVisual({
      brandId: 'acme-labs',
      modelId: 'acme-gpt-vision',
      brands: {
        'acme-labs': { id: 'acme-labs', name: 'Acme Labs', icon_path: 'M2 2H22V22H2Z' },
      },
    })
    assert.equal(acmeDict.kind, 'path')
    assert.equal(acmeDict.source, 'gateway-path')
    assert.equal(acmeDict.brandName, 'Acme Labs')
    assert.equal(acmeDict.path, 'M2 2H22V22H2Z')

    // Explicit unknown brandId WITHOUT safe iconPath skips Tier 3 regex (never hijacked as OpenAI!).
    const acmeNoIcon = resolveBrandVisual({
      brandId: 'acme-labs',
      brandName: 'Acme Labs',
      brandIconPath: '<svg onload=alert(1)>',
      modelId: 'gpt-acme-99',
    })
    assert.equal(acmeNoIcon.kind, 'monogram')
    assert.equal(acmeNoIcon.source, 'monogram')
    assert.equal(acmeNoIcon.brandId, 'acme-labs')
    assert.equal(acmeNoIcon.letter, 'A')

    // Tier 3: Omitted brandId (legacy snapshot / BYOK) falls back to regex.
    const legacy = resolveBrandVisual({ modelId: 'seedream-5-5', variant: 'mono' })
    assert.equal(legacy.kind, 'svg')
    assert.equal(legacy.source, 'legacy-regex')
    assert.equal(legacy.brandId, 'bytedance')

    // Tier 4: Omitted brandId + unknown model -> neutral monogram, never bytedance.
    const unknown = resolveBrandVisual({ modelId: 'opaque-unknown-99', label: 'Opaque 99' })
    assert.equal(unknown.kind, 'monogram')
    assert.equal(unknown.source, 'monogram')
    assert.equal(unknown.brandId, null)
    assert.equal(unknown.letter, 'O')

    // Prototype property keys (e.g. `constructor`) must never hit Object.prototype.
    assert.equal(getCanonicalBrandName('constructor'), null)
    assert.equal(getCanonicalBrandName('toString'), null)
    const protoBrand = resolveBrandVisual({
      brandId: 'constructor',
      brands: {},
      modelId: 'constructor-1',
    })
    assert.equal(protoBrand.kind, 'monogram')
    assert.equal(protoBrand.brandId, 'constructor')
    assert.equal(protoBrand.brandName, 'constructor')
    assert.notEqual(protoBrand.brandName, 'Object')
    assert.equal(protoBrand.letter, 'C')

    // Empty row brandIconPath falls through to brands dictionary, while whitespace-only fails closed.
    const emptyFallthrough = resolveBrandVisual({
      brandId: 'acme-labs',
      brandIconPath: '',
      brands: {
        'acme-labs': { id: 'acme-labs', name: 'Acme Labs', iconPath: 'M3 3H21V21H3Z' },
      },
      modelId: 'acme-1',
    })
    assert.equal(emptyFallthrough.kind, 'path')
    assert.equal(emptyFallthrough.path, 'M3 3H21V21H3Z')

    const whitespaceFailClosed = resolveBrandVisual({
      brandId: 'acme-labs',
      brandIconPath: ' ',
      brands: {
        'acme-labs': { id: 'acme-labs', name: 'Acme Labs', iconPath: 'M3 3H21V21H3Z' },
      },
      modelId: 'acme-1',
    })
    assert.equal(whitespaceFailClosed.kind, 'monogram')
  })

  it('exposes complete BRAND_SVGS / BRAND_SVGS_MONO / getBrandInfo / getAllBrands parity', () => {
    const all = getAllBrands()
    assert.equal(all.length, Object.keys(BRAND_CATALOG).length)
    assert.ok(all.length >= 18)
    for (const info of all) {
      assert.ok(isValidBrandId(info.id), `catalog id must be valid: ${info.id}`)
      assert.ok(BRAND_SVGS[info.id].startsWith('<svg'))
      assert.ok(BRAND_SVGS_MONO[info.id].startsWith('<svg'))
      assert.equal(info.svg, BRAND_SVGS[info.id])
      assert.equal(info.svgMono, BRAND_SVGS_MONO[info.id])
    }
    const muse = getBrandInfo('muse-video')
    assert.equal(muse.id, 'muse')
    assert.equal(muse.primaryColor, '#8B5CF6')
    assert.match(muse.svg, /#8B5CF6/)
    assert.match(muse.svg, />M</)
    assert.equal(getBrandMonogram({ brandName: '通义万相' }), '通')
    assert.equal(getBrandMonogram({}), 'M')
  })
})
