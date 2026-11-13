/**
 * Model Compatibility Evaluator — fail-closed facade over the contract-driven
 * compatibility kernel (Issue #466 / W1).
 *
 * The hardcoded BUILTIN_MODEL_CAPABILITIES table is strangled: model input
 * capability is resolved ONLY from the Catalog v1.1 DTO (authoritative
 * `models[]` operations, or legacy bucket rows carrying inputCapability).
 * Unknown / delisted models and a missing catalog resolve to `undefined` and
 * evaluate as `disabled` with a typed reason — no permissive fallback.
 */

import type { MaterialType } from '../canvasTypes.ts';
import type { CapabilityCatalog } from '../api.ts';
import {
  buildContractView,
  deriveMergedInputCapability,
  resolveModelView,
  type CompatReasonCode,
} from './compatKernel.ts';

export type ModelCompatibilityLevel = 'available' | 'degraded' | 'disabled' | 'hidden';

export interface ModelInputCapability {
  modalities: MaterialType[];
  referenceImages?: { min: number; max: number | null; allowedMimeTypes?: string[]; supportedRoles?: string[] };
  referenceVideos?: { min: number; max: number | null; allowedMimeTypes?: string[]; supportedRoles?: string[] };
  referenceAudios?: { min: number; max: number | null; allowedMimeTypes?: string[]; supportedRoles?: string[] };
}

export interface ModelCompatibilityResult {
  level: ModelCompatibilityLevel;
  reasons: string[];
  /** Typed, telemetry-safe reason codes (PRD §6.9). */
  reasonCodes: CompatReasonCode[];
  adaptationAdvice?: string;
}

/** Rows searched when the catalog has no authoritative models[] (legacy DTO). */
type LegacyCatalogBucket = Array<{ id: string; inputCapability?: ModelInputCapability }>;

function findLegacyRowCapability(
  modelId: string,
  catalog: CapabilityCatalog | null | undefined,
): ModelInputCapability | undefined {
  if (!catalog || Array.isArray(catalog.models)) return undefined;
  const buckets: LegacyCatalogBucket[] = [
    (catalog.text ?? []) as LegacyCatalogBucket,
    (catalog.image ?? []) as LegacyCatalogBucket,
    (catalog.video ?? []) as LegacyCatalogBucket,
    (catalog.audio ?? []) as LegacyCatalogBucket,
  ];
  for (const bucket of buckets) {
    const found = bucket.find((item) => item.id === modelId);
    if (found?.inputCapability) return found.inputCapability;
  }
  return undefined;
}

/**
 * Resolve input capability for a model ID from the catalog ONLY.
 *
 * Order: Catalog v1.1 `models[]` (id or wire alias) → merged operation slots;
 * legacy bucket row inputCapability for pre-v1.1 DTOs. No catalog / unknown
 * model → undefined (fail closed).
 */
export function resolveModelInputCapability(
  modelId: string,
  catalog?: CapabilityCatalog | null,
): ModelInputCapability | undefined {
  if (!modelId) return undefined;
  const trimmed = modelId.trim();
  if (!catalog) return undefined;

  const view = buildContractView(catalog);
  const model = resolveModelView(view, trimmed);
  if (model) {
    const merged = deriveMergedInputCapability(model);
    if (merged) {
      return {
        modalities: merged.modalities as MaterialType[],
        ...(merged.referenceImages ? { referenceImages: merged.referenceImages } : {}),
        ...(merged.referenceVideos ? { referenceVideos: merged.referenceVideos } : {}),
        ...(merged.referenceAudios ? { referenceAudios: merged.referenceAudios } : {}),
      };
    }
  }
  return findLegacyRowCapability(trimmed, catalog);
}

/**
 * Evaluate model compatibility based on input capability and upstream items.
 *
 * Fail-closed: an unknown capability (unknown/delisted model or missing
 * catalog) evaluates to `disabled` with `contract_missing` — the old
 * permissive `available` fallback is removed.
 *
 * Rules (unchanged for known capabilities):
 * 1. 统计 upstreams 中 image/video/audio 数量。
 * 2. 数量 > max -> level: 'disabled'，给出超限 reason 与 adaptationAdvice。
 * 3. max === 0 且存在对应模态上游 -> disabled。
 * 4. 数量在 (min, max] 且 min > 0 -> level: 'degraded'，提示超出推荐配额。
 */
export function evaluateModelCompatibility(
  modelId: string,
  modelCap: ModelInputCapability | undefined,
  upstreams: { type: MaterialType; mimeType?: string }[],
): ModelCompatibilityResult {
  // Unknown model / no contract — fail closed.
  if (!modelCap) {
    return {
      level: 'disabled',
      reasons: ['模型缺少能力契约（未知、已下架或目录不可用）'],
      reasonCodes: ['contract_missing'],
    };
  }

  const reasons: string[] = [];
  const reasonCodes: CompatReasonCode[] = [];
  let level: ModelCompatibilityLevel = 'available';
  let adaptationAdvice: string | undefined;

  const images = upstreams.filter((u) => u.type === 'image');
  const videos = upstreams.filter((u) => u.type === 'video');
  const audios = upstreams.filter((u) => u.type === 'audio');
  const nonTextUpstreams = [...images, ...videos, ...audios];

  const mark = (code: CompatReasonCode) => {
    if (!reasonCodes.includes(code)) reasonCodes.push(code);
  };

  // 1. Check reference images
  if (images.length > 0) {
    const cap = modelCap.referenceImages;
    const isImageSupported = modelCap.modalities?.includes('image');
    if (!isImageSupported || cap?.max === 0) {
      level = 'disabled';
      reasons.push('该模型不支持参考素材');
      mark('model_incompatible');
      if (!adaptationAdvice) adaptationAdvice = '建议移除参考素材或更换支持图片输入的模型';
    } else if (cap && cap.max !== null && images.length > cap.max) {
      level = 'disabled';
      reasons.push(`超出模型最大参考图数量（最多 ${cap.max} 张）`);
      mark('slot_capacity');
      if (!adaptationAdvice) adaptationAdvice = `建议截取前 ${cap.max} 张或更换模型`;
    } else if (cap && cap.max !== null && cap.min > 0 && images.length > cap.min && images.length <= cap.max) {
      level = 'degraded';
      reasons.push(`输入已超出推荐配额（推荐 ${cap.min} 张，最多 ${cap.max} 张）`);
      if (!adaptationAdvice) adaptationAdvice = `输入超出模型推荐配额，执行时按前 ${cap.max} 张处理`;
    }

    if (cap?.allowedMimeTypes && cap.allowedMimeTypes.length > 0) {
      for (const img of images) {
        if (img.mimeType && !cap.allowedMimeTypes.includes(img.mimeType)) {
          level = 'disabled';
          reasons.push(`不支持的图片格式：${img.mimeType}`);
          mark('mime_unsupported');
        }
      }
    }
  }

  // 2. Check reference videos
  if (videos.length > 0) {
    const cap = modelCap.referenceVideos;
    const isVideoSupported = modelCap.modalities?.includes('video');
    if (!isVideoSupported || cap?.max === 0) {
      level = 'disabled';
      reasons.push('该模型不支持视频参考素材');
      mark('model_incompatible');
      if (!adaptationAdvice) adaptationAdvice = '建议移除视频参考素材或更换支持视频输入的模型';
    } else if (cap && cap.max !== null && videos.length > cap.max) {
      level = 'disabled';
      reasons.push(`超出模型最大参考视频数量（最多 ${cap.max} 个）`);
      mark('slot_capacity');
      if (!adaptationAdvice) adaptationAdvice = `建议截取前 ${cap.max} 个或更换模型`;
    } else if (cap && cap.max !== null && cap.min > 0 && videos.length > cap.min && videos.length <= cap.max) {
      if (level !== 'disabled') level = 'degraded';
      reasons.push(`输入已超出推荐配额（推荐 ${cap.min} 个，最多 ${cap.max} 个）`);
      if (!adaptationAdvice) adaptationAdvice = `输入超出模型推荐配额，执行时按前 ${cap.max} 个处理`;
    }

    if (cap?.allowedMimeTypes && cap.allowedMimeTypes.length > 0) {
      for (const vid of videos) {
        if (vid.mimeType && !cap.allowedMimeTypes.includes(vid.mimeType)) {
          level = 'disabled';
          reasons.push(`不支持的视频格式：${vid.mimeType}`);
          mark('mime_unsupported');
        }
      }
    }
  }

  // 3. Check reference audios
  if (audios.length > 0) {
    const cap = modelCap.referenceAudios;
    const isAudioSupported = modelCap.modalities?.includes('audio');
    if (!isAudioSupported || cap?.max === 0) {
      level = 'disabled';
      reasons.push('该模型不支持音频参考素材');
      mark('model_incompatible');
      if (!adaptationAdvice) adaptationAdvice = '建议移除音频参考素材或更换支持音频输入的模型';
    } else if (cap && cap.max !== null && audios.length > cap.max) {
      level = 'disabled';
      reasons.push(`超出模型最大参考音频数量（最多 ${cap.max} 个）`);
      mark('slot_capacity');
      if (!adaptationAdvice) adaptationAdvice = `建议截取前 ${cap.max} 个或更换模型`;
    } else if (cap && cap.max !== null && cap.min > 0 && audios.length > cap.min && audios.length <= cap.max) {
      if (level !== 'disabled') level = 'degraded';
      reasons.push(`输入已超出推荐配额（推荐 ${cap.min} 个，最多 ${cap.max} 个）`);
      if (!adaptationAdvice) adaptationAdvice = `输入超出模型推荐配额，执行时按前 ${cap.max} 个处理`;
    }

    if (cap?.allowedMimeTypes && cap.allowedMimeTypes.length > 0) {
      for (const aud of audios) {
        if (aud.mimeType && !cap.allowedMimeTypes.includes(aud.mimeType)) {
          level = 'disabled';
          reasons.push(`不支持的音频格式：${aud.mimeType}`);
          mark('mime_unsupported');
        }
      }
    }
  }

  // 4. Modality check if model has 0 support for non-text reference inputs
  if (nonTextUpstreams.length > 0) {
    const hasAnyNonTextModality = modelCap.modalities?.some((m) => m !== 'text');
    if (!hasAnyNonTextModality && reasons.length === 0) {
      level = 'disabled';
      reasons.push('该模型不支持参考素材');
      mark('model_incompatible');
      if (!adaptationAdvice) adaptationAdvice = '建议移除参考素材或更换支持多模态输入的模型';
    }
  }

  if (level === 'available') {
    return {
      level: 'available',
      reasons: [],
      reasonCodes: [],
    };
  }

  return {
    level,
    reasons,
    reasonCodes,
    ...(adaptationAdvice ? { adaptationAdvice } : {}),
  };
}
