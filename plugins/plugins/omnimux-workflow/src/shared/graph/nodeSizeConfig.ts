/**
 * Ported verbatim (subset) from Gxgen
 * `apps/web/src/pages/CanvasEditor/utils/nodeSizeConfig.ts`
 * (validated by the extraction spike).
 */

import type { MaterialType } from './materialNode.ts';

/**
 * 精准对齐竞品卡片几何体系与比例定义：
 * 1. 统一卡片基准宽度：350px
 * 2. 文本节点 (text)：竖版 350x500（7:10 比例，aspectRatio: 0.7，高宽比 1.43），为四项快捷预设/大篇幅脚本提供纵向空间
 * 3. 图片节点 (image)：正方 350x350（1:1 比例，aspectRatio: 1.0）
 * 4. 视频节点 (video)：横版 350x280（5:4 / 1.25:1 比例，aspectRatio: 1.25，高宽比 0.80），上部视频预览 + 下部 H3 快捷操作栏
 * 5. 音频节点 (audio)：扁横版 350x150（7:3 比例，aspectRatio: 2.333）
 */

export type NodeSizeCategory = 'portrait' | 'square' | 'video_landscape' | 'audio_compact';

export interface NodeSizeConfig {
  min: { width: number; height: number };
  default: { width: number; height: number };
  max: { width: number; height: number };
  aspectRatio: number;
}

export const CANVAS_ZOOM_CONFIG = {
  minZoom: 0.23,
  maxZoom: 1.29,
  defaultZoom: 1,
} as const;

/** 文本节点：350x500 竖版（7:10） */
const TEXT_PORTRAIT_SIZE_CONFIG: NodeSizeConfig = {
  min: { width: 200, height: 286 },
  default: { width: 350, height: 500 },
  max: { width: 450, height: 643 },
  aspectRatio: 350 / 500, // 0.7
};

/** 图片节点：350x350 正方版（1:1） */
const IMAGE_SQUARE_SIZE_CONFIG: NodeSizeConfig = {
  min: { width: 100, height: 100 },
  default: { width: 350, height: 350 },
  max: { width: 450, height: 450 },
  aspectRatio: 1,
};

/** 视频节点：350x280 饱满横版（5:4 / 1.25:1） */
const VIDEO_LANDSCAPE_SIZE_CONFIG: NodeSizeConfig = {
  min: { width: 150, height: 120 },
  default: { width: 350, height: 280 },
  max: { width: 500, height: 400 },
  aspectRatio: 350 / 280, // 1.25
};

/** 音频节点：350x150 扁横版（7:3） */
const AUDIO_COMPACT_SIZE_CONFIG: NodeSizeConfig = {
  min: { width: 200, height: 86 },
  default: { width: 350, height: 150 },
  max: { width: 450, height: 193 },
  aspectRatio: 350 / 150, // 2.3333333333333335
};

const NODE_SIZE_CONFIGS: Record<NodeSizeCategory, NodeSizeConfig> = {
  portrait: TEXT_PORTRAIT_SIZE_CONFIG,
  square: IMAGE_SQUARE_SIZE_CONFIG,
  video_landscape: VIDEO_LANDSCAPE_SIZE_CONFIG,
  audio_compact: AUDIO_COMPACT_SIZE_CONFIG,
};

export function getNodeSizeCategory(nodeType: MaterialType): NodeSizeCategory {
  switch (nodeType) {
    case 'text':
      return 'portrait';
    case 'image':
      return 'square';
    case 'video':
      return 'video_landscape';
    case 'audio':
      return 'audio_compact';
    default:
      return 'square';
  }
}

export function getNodeSizeConfig(nodeType: MaterialType): NodeSizeConfig {
  return NODE_SIZE_CONFIGS[getNodeSizeCategory(nodeType)];
}

export function calculateNodeHeight(width: number, category: NodeSizeCategory): number {
  const config = NODE_SIZE_CONFIGS[category] || IMAGE_SQUARE_SIZE_CONFIG;
  return Math.round(width / config.aspectRatio);
}

export function getMinimumNodeHeight(nodeType: MaterialType): number {
  return getNodeSizeConfig(nodeType).min.height;
}

export function getDefaultNodeWidth(nodeType: MaterialType): number {
  return getNodeSizeConfig(nodeType).default.width;
}

export function getDefaultNodeHeight(nodeType: MaterialType): number {
  return getNodeSizeConfig(nodeType).default.height;
}
