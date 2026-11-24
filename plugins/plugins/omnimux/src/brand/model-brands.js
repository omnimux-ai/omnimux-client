/**
 * OmniMux Model Brand Registry & Icon System.
 *
 * Thin compatibility proxy over `dsh-ui-kit/model-brands` — the single shared
 * source of truth for canonical model brand metadata, validators, and vector
 * assets across Hub, Workflow, and Browser Extension.
 */

export {
  BRAND_CATALOG,
  BRAND_ID_ALIASES,
  BRAND_ID_PATTERN,
  BRAND_ICON_PATH_PATTERN,
  BRAND_MATCH_RULES,
  BRAND_SVGS,
  BRAND_SVGS_MONO,
  CANONICAL_BRAND_NAMES,
  MAX_BRAND_ICON_PATH_BYTES,
  canonicalizeLocalBrandId,
  getAllBrands,
  getBrandInfo,
  getBrandMonogram,
  getCanonicalBrandName,
  isValidBrandId,
  resolveBrandVisual,
  resolveModelBrand,
  sanitizeBrandIconPath,
  serializeBrandVector,
} from 'dsh-ui-kit/model-brands';
