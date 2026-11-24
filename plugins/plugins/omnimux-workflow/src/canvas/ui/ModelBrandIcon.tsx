/**
 * Universal Model Brand Icon Component for OmniMux Workflow.
 *
 * Delegates canonical brand resolution, SVG assets, and fail-closed gateway
 * fallback path sanitization to the single shared source `dsh-ui-kit/model-brands`.
 * Renders pure React SVG elements without raw HTML injection.
 */

import React, { useMemo } from 'react';
import {
  BRAND_SVGS,
  getBrandMonogram,
  resolveBrandVisual,
  resolveModelBrand,
  type BrandIconVariant,
  type BrandVectorElement,
  type GatewayBrandMeta,
} from 'dsh-ui-kit/model-brands';

export { BRAND_SVGS, resolveModelBrand };

function renderVectorElement(el: BrandVectorElement, idx: number): React.ReactNode {
  if (el.tag === 'path') {
    return <path key={idx} {...(el.attrs as React.SVGProps<SVGPathElement>)} />;
  }
  if (el.tag === 'rect') {
    return <rect key={idx} {...(el.attrs as React.SVGProps<SVGRectElement>)} />;
  }
  if (el.tag === 'circle') {
    return <circle key={idx} {...(el.attrs as React.SVGProps<SVGCircleElement>)} />;
  }
  if (el.tag === 'text') {
    return <text key={idx} {...(el.attrs as React.SVGProps<SVGTextElement>)}>{el.text}</text>;
  }
  return null;
}

export interface ModelBrandIconProps {
  modelId?: string;
  brand?: string;
  brandId?: string;
  brandName?: string;
  brandIconPath?: string;
  family?: string;
  label?: string;
  brands?: Readonly<Record<string, GatewayBrandMeta>> | null;
  variant?: BrandIconVariant;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  fallback?: React.ReactNode;
}

/**
 * Universal Brand Icon Component (4-tier deterministic resolver).
 */
export const ModelBrandIcon: React.FC<ModelBrandIconProps> = ({
  modelId,
  brand,
  brandId,
  brandName,
  brandIconPath,
  family,
  label,
  brands,
  variant = 'color',
  size = 16,
  className = '',
  style,
  fallback = null,
}) => {
  const visual = useMemo(
    () =>
      resolveBrandVisual({
        brandId: brandId ?? brand,
        brandName,
        brandIconPath,
        modelId,
        family,
        label,
        brands,
        variant,
      }),
    [brandId, brand, brandName, brandIconPath, modelId, family, label, brands, variant],
  );

  if (visual.kind === 'svg') {
    return (
      <span
        className={`wf-brand-icon wf-brand-icon--${visual.brandId} ${className}`.trim()}
        data-brand-id={visual.brandId}
        data-brand-source={visual.source}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          flexShrink: 0,
          ...style,
        }}
      >
        <svg
          width={size}
          height={size}
          viewBox={visual.vector.viewBox}
          fill={visual.vector.fill}
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {visual.vector.elements.map(renderVectorElement)}
        </svg>
      </span>
    );
  }

  if (visual.kind === 'path') {
    return (
      <span
        className={`wf-brand-icon wf-brand-icon--gateway-path ${className}`.trim()}
        data-brand-id={visual.brandId || ''}
        data-brand-source={visual.source}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          flexShrink: 0,
          ...style,
        }}
      >
        <svg
          width={size}
          height={size}
          viewBox={visual.viewBox}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path d={visual.path} fill="currentColor" />
        </svg>
      </span>
    );
  }

  if (fallback) return <>{fallback}</>;

  const letter = visual.letter || getBrandMonogram({
    brandName,
    label,
    brandId: brandId ?? brand,
    family,
    modelId,
  });

  return (
    <span
      className={`wf-brand-icon wf-brand-icon--fallback ${className}`.trim()}
      data-brand-id={visual.brandId || ''}
      data-brand-source={visual.source}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: Math.max(3, Math.floor(size / 4)),
        background: 'var(--dsw-alias-bg-layer-3)',
        color: 'var(--dsw-alias-label-secondary)',
        border: '1px solid var(--dsw-alias-border-l2)',
        fontSize: Math.max(9, Math.floor(size * 0.6)),
        fontWeight: 700,
        lineHeight: 1,
        userSelect: 'none',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {letter}
    </span>
  );
};
