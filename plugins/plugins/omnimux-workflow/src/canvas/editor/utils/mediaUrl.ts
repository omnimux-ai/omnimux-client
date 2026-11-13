/**
 * 媒体预览 URL 解析（纯函数，无 React 依赖，供 node:test 断言）。
 *
 * 数据源优先级：mediaAssets（SSE node_complete 写入，
 * useExecutionController.ts:147-152）内匹配素材类型的首条 → 任意首条 →
 * 回退 mediaUrl。
 */

import type { MaterialType } from '../../types/materialNode';

export interface MediaAssetLike {
  type?: string;
  url?: string;
}

export function resolveMediaPreviewUrl(
  materialType: MaterialType,
  mediaAssets?: MediaAssetLike[],
  mediaUrl?: string,
): string | undefined {
  const matched = mediaAssets?.find((asset) => asset?.type === materialType && asset.url);
  if (matched?.url) return matched.url;
  const first = mediaAssets?.find((asset) => asset?.url);
  if (first?.url) return first.url;
  return mediaUrl;
}
