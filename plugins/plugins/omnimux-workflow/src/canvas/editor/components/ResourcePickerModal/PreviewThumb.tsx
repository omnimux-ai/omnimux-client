/**
 * ResourcePicker 共享预览缩略图：比例分档 + contain 媒体 + 模糊/实色衬底。
 * 禁止 createObjectURL / blob 持久化；尺寸缺失时 onLoad 仅首次升档。
 */

import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Music2 } from 'lucide-react';
import type { MaterialType } from '../../../types/materialNode';
import { resolvePreviewThumbModel } from '../../utils/resourcePickerPreviewTier.ts';

export type PreviewThumbLayout = 'grid' | 'list';

export interface PreviewThumbProps {
  layout: PreviewThumbLayout;
  materialType: MaterialType;
  previewUrl?: string;
  width?: number;
  height?: number;
  mimeOrName?: string;
  badge?: 'none' | 'selected' | 'added';
  addedLabel?: string;
  fallbackLabel: string;
  className?: string;
  onNaturalSize?: (size: { width: number; height: number }) => void;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** previewUrl 含引号或反斜杠时跳过 CSS 变量衬底，避免 style 注入风险。 */
function safeBackdropUrl(url: string | undefined): string | null {
  if (!url) return null;
  if (url.includes('"') || url.includes('\\')) return null;
  return url;
}

const PreviewThumb: React.FC<PreviewThumbProps> = ({
  layout,
  materialType,
  previewUrl,
  width,
  height,
  mimeOrName,
  badge = 'none',
  addedLabel = '',
  fallbackLabel,
  className = '',
  onNaturalSize,
}) => {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const didMeasureRef = useRef(false);
  const prevSrcRef = useRef<string | undefined>(undefined);
  const [noUpscale, setNoUpscale] = useState(false);

  const hasVisualPreview =
    Boolean(previewUrl) && (materialType === 'image' || materialType === 'video');

  const model = useMemo(
    () =>
      resolvePreviewThumbModel({
        width,
        height,
        materialType,
        hasVisualPreview: hasVisualPreview ? true : undefined,
        mimeOrName: mimeOrName ?? previewUrl,
        prefersReducedMotion: prefersReducedMotion(),
        layout,
      }),
    [width, height, materialType, hasVisualPreview, mimeOrName, previewUrl, layout],
  );

  const showMedia =
    Boolean(previewUrl) &&
    (materialType === 'image' || materialType === 'video') &&
    model.tier !== 'non-visual';

  const backdropUrl =
    model.backdropMode === 'blur' && showMedia ? safeBackdropUrl(previewUrl) : null;

  const backdropClass =
    model.backdropMode === 'blur' && backdropUrl
      ? 'wf-picker-card__thumb--backdrop-blur'
      : 'wf-picker-card__thumb--solid-only';

  const thumbClassName = [
    'wf-picker-card__thumb',
    model.thumbClassName,
    layout === 'list' ? 'wf-picker-card__thumb--list' : '',
    backdropClass,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const thumbStyle =
    backdropUrl != null
      ? ({ ['--wf-picker-backdrop' as string]: `url("${backdropUrl}")` } as React.CSSProperties)
      : undefined;

  const reportNaturalSize = useCallback(
    (naturalW: number, naturalH: number) => {
      if (!onNaturalSize) return;
      if (!(naturalW > 0 && naturalH > 0)) return;
      if (didMeasureRef.current) return;
      // 仅在外部宽高缺失时升档
      if (width != null && width > 0 && height != null && height > 0) return;
      didMeasureRef.current = true;
      onNaturalSize({ width: naturalW, height: naturalH });
    },
    [onNaturalSize, width, height],
  );

  const applyNoUpscale = useCallback((naturalW: number) => {
    const el = thumbRef.current;
    if (!el || !(naturalW > 0)) {
      setNoUpscale(false);
      return;
    }
    const displayW = el.clientWidth || 0;
    // 小图不放大：naturalW*2 < 容器显示宽
    setNoUpscale(displayW > 0 && naturalW * 2 < displayW);
  }, []);

  const handleImgLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      reportNaturalSize(img.naturalWidth, img.naturalHeight);
      applyNoUpscale(img.naturalWidth);
    },
    [reportNaturalSize, applyNoUpscale],
  );

  const handleVideoMeta = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget;
      reportNaturalSize(v.videoWidth, v.videoHeight);
      applyNoUpscale(v.videoWidth);
    },
    [reportNaturalSize, applyNoUpscale],
  );

  // src 变化时重置一次性测量标记
  if (previewUrl !== prevSrcRef.current) {
    prevSrcRef.current = previewUrl;
    didMeasureRef.current = false;
  }

  // 缓存命中：img.complete 时补读 natural size
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (!img || materialType !== 'image') return;
    if (img.complete && img.naturalWidth > 0) {
      reportNaturalSize(img.naturalWidth, img.naturalHeight);
      applyNoUpscale(img.naturalWidth);
    }
  }, [previewUrl, materialType, reportNaturalSize, applyNoUpscale]);

  const mediaClass = [
    'wf-picker-card__media',
    noUpscale ? 'wf-picker-card__media--no-upscale' : '',
  ]
    .filter(Boolean)
    .join(' ');

  let media: React.ReactNode = null;
  if (showMedia && previewUrl && materialType === 'image') {
    media = (
      <img
        ref={imgRef}
        src={previewUrl}
        alt=""
        className={mediaClass}
        onLoad={handleImgLoad}
      />
    );
  } else if (showMedia && previewUrl && materialType === 'video') {
    media = (
      <video
        src={previewUrl}
        className={mediaClass}
        muted
        preload="metadata"
        onLoadedMetadata={handleVideoMeta}
      />
    );
  } else {
    media = (
      <span className={`wf-picker-card__fallback wf-picker-card__fallback--${materialType}`}>
        {materialType === 'audio' ? <Music2 size={14} aria-hidden /> : null}
        {fallbackLabel}
      </span>
    );
  }

  let badgeNode: React.ReactNode = null;
  if (badge === 'added') {
    badgeNode = (
      <span className="wf-picker-added-badge">
        <Check size={11} />
        {addedLabel}
      </span>
    );
  } else if (badge === 'selected') {
    badgeNode = (
      <span className="wf-picker-check wf-picker-check--on">
        <Check size={11} />
      </span>
    );
  }

  return (
    <div ref={thumbRef} className={thumbClassName} style={thumbStyle}>
      {media}
      {badgeNode}
    </div>
  );
};

export default PreviewThumb;
