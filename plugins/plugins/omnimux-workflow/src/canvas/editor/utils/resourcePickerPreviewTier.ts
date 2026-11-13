/**
 * ResourcePicker 预览卡比例分档：纯函数、无 React 依赖，供 node:test 直接断言。
 * 按素材宽高比落入 7 档，驱动 thumb aspect-ratio 与衬底模式。
 */

import type { MaterialType } from '../../types/materialNode.ts';

export type PreviewRatioTier =
  | 'ultra-wide'
  | 'wide'
  | 'square'
  | 'tall'
  | 'ultra-tall'
  | 'unknown'
  | 'non-visual';

export type PreviewBackdropMode = 'blur' | 'solid';

function isPositiveFinite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * 按宽高比分档（边界左闭右开，顶档闭合）：
 * r ≥ 2.2 ultra-wide；1.4 ≤ r < 2.2 wide；0.85 ≤ r < 1.4 square；
 * 0.5 ≤ r < 0.85 tall；r < 0.5 ultra-tall。
 */
export function getPreviewRatioTier(
  width?: number | null,
  height?: number | null,
  materialType?: MaterialType | null,
  options?: { hasVisualPreview?: boolean; mimeOrName?: string },
): PreviewRatioTier {
  if (materialType === 'audio' || materialType === 'text') {
    return 'non-visual';
  }
  if (options?.hasVisualPreview === false) {
    return 'non-visual';
  }
  if (!isPositiveFinite(width) || !isPositiveFinite(height)) {
    return 'unknown';
  }
  const r = width / height;
  if (r >= 2.2) return 'ultra-wide';
  if (r >= 1.4) return 'wide';
  if (r >= 0.85) return 'square';
  if (r >= 0.5) return 'tall';
  return 'ultra-tall';
}

export function previewTierToClassName(tier: PreviewRatioTier): string {
  return `wf-picker-card__thumb--${tier}`;
}

function looksLikeSvg(mimeOrName?: string): boolean {
  if (!mimeOrName) return false;
  return /svg/i.test(mimeOrName);
}

export function shouldUseSolidBackdrop(input: {
  tier: PreviewRatioTier;
  mimeOrName?: string;
  prefersReducedMotion?: boolean;
}): boolean {
  if (input.tier === 'non-visual' || input.tier === 'unknown') return true;
  if (input.prefersReducedMotion) return true;
  if (looksLikeSvg(input.mimeOrName)) return true;
  return false;
}

export function resolvePreviewThumbModel(input: {
  width?: number | null;
  height?: number | null;
  materialType?: MaterialType | null;
  hasVisualPreview?: boolean;
  mimeOrName?: string;
  prefersReducedMotion?: boolean;
  layout?: 'grid' | 'list';
}): {
  tier: PreviewRatioTier;
  thumbClassName: string;
  backdropMode: PreviewBackdropMode;
  ratio: number | null;
} {
  const tier = getPreviewRatioTier(input.width, input.height, input.materialType, {
    hasVisualPreview: input.hasVisualPreview,
    mimeOrName: input.mimeOrName,
  });

  const solid =
    input.layout === 'list' ||
    shouldUseSolidBackdrop({
      tier,
      mimeOrName: input.mimeOrName,
      prefersReducedMotion: input.prefersReducedMotion,
    });

  let ratio: number | null = null;
  if (isPositiveFinite(input.width) && isPositiveFinite(input.height)) {
    ratio = input.width / input.height;
  }

  return {
    tier,
    thumbClassName: previewTierToClassName(tier),
    backdropMode: solid ? 'solid' : 'blur',
    ratio,
  };
}
