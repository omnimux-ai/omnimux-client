/**
 * 画布资产抽屉【画布】Tab 的纯提纯函数。
 * 只输出已导入本地文件或已生成产物的有效素材；空白 / 未运行 / 仅占位节点不入列。
 * 无 React 依赖，供 node:test 直接断言。严禁 JSON.stringify live node。
 */

import { resolveMediaPreviewUrl, type MediaAssetLike } from '../../utils/mediaUrl.ts';
import { resolveNodeKind } from '../../../../shared/graph/materialNode.ts';
import type { CanvasNodeItem } from './types.ts';

export interface FlowNodeLike {
  id?: unknown;
  type?: unknown;
  data?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isBlobUrl(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('blob:');
}

/** 有效预览：非空且不是瞬时 blob: URL。 */
function asValidPreviewUrl(value: unknown): string | undefined {
  const text = asTrimmed(value);
  if (!text || isBlobUrl(text)) return undefined;
  return text;
}

function nodeData(node: FlowNodeLike): Record<string, unknown> {
  return isRecord(node.data) ? node.data : {};
}

function pickRealPath(data: Record<string, unknown>): string {
  return asTrimmed(data.realPath) || asTrimmed(data.real_path);
}

function mediaAssetList(data: Record<string, unknown>): MediaAssetLike[] | undefined {
  return Array.isArray(data.mediaAssets) ? (data.mediaAssets as MediaAssetLike[]) : undefined;
}

function firstMediaAssetUrl(assets: MediaAssetLike[] | undefined): string | undefined {
  if (!assets) return undefined;
  for (const asset of assets) {
    const url = asValidPreviewUrl(asset?.url);
    if (url) return url;
  }
  return undefined;
}

function resolveKind(node: FlowNodeLike, data: Record<string, unknown>): string {
  const materialType = asTrimmed(data.materialType || data.mediaType).toLowerCase();
  if (
    materialType === 'image' ||
    materialType === 'video' ||
    materialType === 'audio' ||
    materialType === 'text'
  ) {
    return materialType;
  }

  const t = asTrimmed(node.type).toLowerCase();
  if (t === 'table') return 'table';
  if (t === 'video_composition') return 'video_composition';
  if (t === 'group') return 'group';
  if (t.includes('video') || t.includes('clip')) return 'video';
  if (t.includes('image') || t === 'media') return 'image';
  if (t.includes('audio') || t.includes('sound') || t.includes('voice')) return 'audio';
  if (
    t.includes('prompt') ||
    t.includes('text') ||
    t.includes('script') ||
    t === 'note'
  ) {
    return 'text';
  }
  return t || 'doc';
}

function collectPreviewUrl(
  kind: string,
  data: Record<string, unknown>,
): string | undefined {
  const materialType =
    kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'text'
      ? kind
      : kind === 'video_composition'
        ? 'video'
        : undefined;
  const mediaUrl = asTrimmed(data.mediaUrl) || undefined;
  const resolved = materialType
    ? resolveMediaPreviewUrl(materialType, mediaAssetList(data), mediaUrl)
    : undefined;
  return (
    asValidPreviewUrl(resolved) ||
    asValidPreviewUrl(data.previewUrl) ||
    asValidPreviewUrl(data.imageUrl) ||
    asValidPreviewUrl(data.outputUrl) ||
    asValidPreviewUrl(data.coverUrl) ||
    asValidPreviewUrl(data.mediaUrl) ||
    asValidPreviewUrl(data.outputVideoUrl) ||
    asValidPreviewUrl(data.thumbnailUrl) ||
    firstMediaAssetUrl(mediaAssetList(data))
  );
}

function tableHasRows(data: Record<string, unknown>): boolean {
  const rowCount = asFiniteNumber(data.rowCount);
  if (rowCount !== undefined && rowCount > 0) return true;
  if (Array.isArray(data.rows) && data.rows.length > 0) return true;
  const document = isRecord(data.document) ? data.document : null;
  if (document && Array.isArray(document.rows) && document.rows.length > 0) return true;
  return false;
}

function isAdmitted(kind: string, data: Record<string, unknown>, previewUrl?: string): boolean {
  const realPath = pickRealPath(data);

  if (kind === 'image' || kind === 'video' || kind === 'audio') {
    // 有真实路径（含 offline）或有效非 blob 预览即可；generating 且无 url/路径剔除。
    return Boolean(realPath || previewUrl);
  }

  if (kind === 'text') {
    return Boolean(asTrimmed(data.content) || asTrimmed(data.generatedContent));
  }

  if (kind === 'table') {
    return tableHasRows(data);
  }

  if (kind === 'video_composition') {
    return Boolean(
      asValidPreviewUrl(data.outputVideoUrl) || asValidPreviewUrl(data.thumbnailUrl),
    );
  }

  return false;
}

function itemName(kind: string, id: string, data: Record<string, unknown>): string {
  return (
    asTrimmed(data.originalName) ||
    asTrimmed(data.label) ||
    asTrimmed(data.title) ||
    asTrimmed(data.name) ||
    `${kind} #${id.slice(-4)}`
  );
}

function itemStatus(data: Record<string, unknown>): CanvasNodeItem['status'] {
  const status = asTrimmed(data.status).toLowerCase();
  if (status === 'generating') return 'generating';
  if (status === 'completed' || status === 'success') return 'success';
  if (status === 'failed' || status === 'error') return 'error';
  return 'idle';
}

function itemTags(data: Record<string, unknown>): string[] | undefined {
  if (!Array.isArray(data.tags)) return undefined;
  const tags = data.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0);
  return tags.length > 0 ? tags : undefined;
}

function toCanvasNodeItem(node: FlowNodeLike): CanvasNodeItem | null {
  const id = asTrimmed(node.id);
  if (!id) return null;

  const data = nodeData(node);
  const kind = resolveKind(node, data);
  const previewUrl = collectPreviewUrl(kind, data);
  if (!isAdmitted(kind, data, previewUrl)) return null;

  const realPath = pickRealPath(data);
  const updatedAt = asFiniteNumber(data.updatedAt) ?? 0;
  const nodeKind = resolveNodeKind(data);
  const prompt = nodeKind === 'import' ? '' : asTrimmed(data.prompt);

  const item: CanvasNodeItem = {
    id,
    name: itemName(kind, id, data),
    type: kind,
    status: itemStatus(data),
    nodeKind,
    updatedAt,
  };
  if (previewUrl) item.previewUrl = previewUrl;
  if (realPath) item.real_path = realPath;
  if (prompt) item.prompt = prompt;
  const tags = itemTags(data);
  if (tags) item.tags = tags;
  return item;
}

/**
 * 从 React Flow 节点列表提取画布 Tab 可展示的真实素材。
 * `id` 永远等于源 `node.id`；时间缺省 0；路径同时认 camelCase / snake_case。
 */
export function extractCanvasAssets(nodes: FlowNodeLike[] | null | undefined): CanvasNodeItem[] {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];
  const items: CanvasNodeItem[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const item = toCanvasNodeItem(node);
    if (item) items.push(item);
  }
  return items;
}
