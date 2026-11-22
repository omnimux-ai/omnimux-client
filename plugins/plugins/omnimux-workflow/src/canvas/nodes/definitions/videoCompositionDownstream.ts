/**
 * Canvas-mode clip export: create (or reuse) a downstream video material
 * node and wire it to the composition node.
 *
 * Handle ids MUST match `CanvasNodeHandle` (`in` / `out`). Using
 * `input` / `output` stores an edge that React Flow cannot draw.
 *
 * The exported file lives outside the workspace
 * (under `<DSH_HOME>/omnimux/clip/exports/`), so the node carries:
 * - `mediaUrl`: the sanctioned `/omnimux-workflow/api/local-file?path=…` URL
 *   the material node streams from — a bare absolute host path 404s in the
 *   browser because it is resolved against the app origin;
 * - `origin` + `sourceCompositionNodeId`: the stable reuse identity. It
 *   survives `persistSanitize` (which strips `realPath` on save) and reloads,
 *   so re-exporting refreshes the same node instead of adding a duplicate.
 */

import { looksAbsolutePath, localFileMediaUrl, localFilePathFromUrl } from '../../../shared/localMedia.ts';
import { CANVAS_ZOOM_CONFIG } from '../../../shared/graph/nodeSizeConfig.ts';
import type { VideoCompositionStatus } from '../../bridge/clipEvents.ts';
import { resolveComfyCardSize } from '../../editor/utils/comfyPageCard.ts';
import {
  GROUP_CHROME_INSET,
  GROUP_HEADER_HEIGHT,
  projectGroupDimensions,
  resolveNodeDimensions,
  toAbsoluteCoordinates,
} from '../../editor/utils/nodeVisualMath.ts';
import { mapVideoCompositionToBadge } from './videoCompositionStatus.ts';

export const VIDEO_COMPOSITION_NODE_WIDTH = 350;
export const CLIP_EXPORT_SOURCE_HANDLE = 'out';
export const CLIP_EXPORT_TARGET_HANDLE = 'in';
export const CLIP_EXPORT_DOWNSTREAM_GAP = 80;
export const CLIP_EXPORT_ORIGIN = 'clip_export';
export const CLIP_EXPORT_COPY_ORIGIN = 'clip_export_copy';
const DOWNSTREAM_CLEARANCE = 40;
// The director card has a 372px minimum body plus the shell's 1px borders.
const DIRECTOR_CARD_MIN_HEIGHT = 374;
const { minZoom, maxZoom } = CANVAS_ZOOM_CONFIG;
// NodeHeader and its stylesheet define these screen-space sizes.
const NODE_TITLE_GAP = 4;
const NODE_TITLE_MAX_LABEL_WIDTH = 180;
const NODE_TITLE_CHROME_WIDTH = 28; // icon, gap and side padding
const NODE_TITLE_BADGE_WIDTH = 14; // status dot and gap
const NODE_TITLE_SIMULATED_BADGE_WIDTH = 16 * 11 + 12 + 6; // longest locale label, padding and gap
// Snapshot states rendered by MaterialNode's StatusBadge.
const MATERIAL_EXECUTION_BADGE_STATES = new Set<unknown>(['pending', 'running', 'completed', 'error', 'skipped']);
const MATERIAL_LOCAL_BADGE_STATES = new Set<unknown>(['generating', 'completed', 'failed', 'offline']);
const TEXT_NODE_FALLBACK_LABEL_WIDTH = 4 * 14; // the localized text-node name
const GROUP_TITLE_INSET = 10;
const GROUP_TITLE_CHROME_WIDTH = 42; // toggle, gap, padding and borders
const GROUP_TITLE_MAX_LABEL_WIDTH = 200;

/** Re-point an already-resolved local-file URL at a new content revision. */
function withMediaRevision(url: string, token: string): string {
  const withoutRev = url.replace(/([?&])rev=[^&]*/g, '$1').replace(/[?&]$/, '');
  const sep = withoutRev.includes('?') ? '&' : '?';
  return `${withoutRev}${sep}rev=${encodeURIComponent(token)}`;
}

/**
 * Absolute host path → the host media URL the canvas can stream.
 * Already-resolved URLs (`/api/local-file`, `blob:`, `data:`, `http:`) and
 * relative paths pass through untouched.
 *
 * `revision` identifies the exported file contents (`mtimeMs:size`). Older
 * callers overwrite `<projectId>.mp4`, so their URLs also need a revision to
 * reload the video after re-exporting. The Host's job ID orders versioned files.
 */
export function clipExportMediaUrl(videoPath: string, revision?: string): string {
  if (!videoPath) return videoPath;
  const token = typeof revision === 'string' ? revision.trim() : '';
  if (localFilePathFromUrl(videoPath)) {
    return token ? withMediaRevision(videoPath, token) : videoPath;
  }
  if (!looksAbsolutePath(videoPath)) return videoPath;
  const base = localFileMediaUrl(videoPath);
  return token ? `${base}&rev=${encodeURIComponent(token)}` : base;
}

export interface ClipExportOutput {
  videoPath: string;
  thumbnailPath?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  /** Content identity of the written file; see `clipExportMediaUrl`. */
  revision?: string;
}

export interface ClipExportGraphNode {
  id: string;
  type?: string;
  data?: Record<string, unknown>;
  position?: { x: number; y: number };
  width?: number;
  height?: number;
  measured?: { width?: number; height?: number };
  parentId?: string;
  hidden?: boolean;
  selected?: boolean;
}

export interface ClipExportGraphEdge {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface ClipExportDownstreamInput {
  sourceNodeId: string;
  sourcePosition: { x: number; y: number };
  sourceLabel: string;
  output: ClipExportOutput;
  currentNodes: ClipExportGraphNode[];
  currentEdges: ClipExportGraphEdge[];
  nodeWidth: number;
  createNodeId?: () => string;
  /** false: only repair/connect an existing 成片 node, never create a new one. */
  createIfMissing?: boolean;
}

export interface ClipExportDownstreamNode {
  id: string;
  type: 'material';
  position: { x: number; y: number };
  selected: boolean;
  data: Record<string, unknown>;
}

export interface ClipExportDownstreamEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: typeof CLIP_EXPORT_SOURCE_HANDLE;
  targetHandle: typeof CLIP_EXPORT_TARGET_HANDLE;
}

/** Refresh payload for an existing 成片 node (structurally a CanvasInputNodePatch). */
export interface ClipExportDownstreamPatch {
  nodeId: string;
  data: Record<string, unknown>;
}

export interface ClipExportDownstreamPlan {
  addNodes: ClipExportDownstreamNode[];
  addEdges: ClipExportDownstreamEdge[];
  removeEdgeIds: string[];
  nodePatches: ClipExportDownstreamPatch[];
}

function nodeDataOf(node: ClipExportGraphNode): Record<string, unknown> {
  return (node.data as Record<string, unknown> | undefined) ?? {};
}

/**
 * Reuse identity: the origin marker + source composition node id (stable across
 * sanitization), the raw host path, or the resolved media URL.
 */
function existingDownstreamNode(
  nodes: ClipExportGraphNode[],
  videoPath: string,
  sourceNodeId: string,
): ClipExportGraphNode | undefined {
  const owned = nodes.find(node => node.type === 'material' && node.data?.origin === CLIP_EXPORT_ORIGIN
    && node.data.sourceCompositionNodeId === sourceNodeId);
  if (owned) return owned;
  const mediaUrl = clipExportMediaUrl(videoPath);
  const path = localFilePathFromUrl(videoPath) ?? videoPath;
  return nodes.find((node) => {
    if (node.type !== 'material') return false;
    const data = nodeDataOf(node);
    if (data.origin === CLIP_EXPORT_ORIGIN || data.origin === CLIP_EXPORT_COPY_ORIGIN) return false;
    return data.realPath === path || data.mediaUrl === videoPath || data.mediaUrl === mediaUrl
      || localFilePathFromUrl(data.mediaUrl) === path;
  });
}

function desiredData(input: ClipExportDownstreamInput): Record<string, unknown> {
  const videoPath = input.output.videoPath;
  return {
    materialType: 'video',
    label: `${input.sourceLabel}_成片`,
    status: 'ready',
    selectedTool: 'import',
    origin: CLIP_EXPORT_ORIGIN,
    sourceCompositionNodeId: input.sourceNodeId,
    realPath: videoPath,
    mediaUrl: clipExportMediaUrl(videoPath, input.output.revision),
    outputRevision: input.output.revision,
    thumbnailUrl: input.output.thumbnailPath,
    duration: input.output.durationMs ? Math.round(input.output.durationMs / 1000) : undefined,
    size: {
      width: input.output.width || 1920,
      height: input.output.height || 1080,
    },
  };
}

/**
 * Fields worth refreshing on a reused node. `realPath` is deliberately absent:
 * the sanitizer strips it on every save, and re-adding it would dirty the
 * document on each canvas load. Identity already holds through `origin`.
 */
function reuseRefresh(desired: Record<string, unknown>): Record<string, unknown> {
  const refresh: Record<string, unknown> = {};
  for (const key of ['materialType', 'label', 'status', 'selectedTool', 'origin', 'sourceCompositionNodeId', 'mediaUrl', 'outputRevision', 'thumbnailUrl', 'duration', 'size']) {
    if (desired[key] !== undefined) refresh[key] = desired[key];
  }
  return refresh;
}

function changedFields(
  current: Record<string, unknown>,
  desired: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(desired)) {
    if (JSON.stringify(current[key]) === JSON.stringify(value)) continue;
    patch[key] = value;
  }
  return patch;
}

export function isDrawableClipExportEdge(edge: ClipExportGraphEdge): boolean {
  return edge.sourceHandle === CLIP_EXPORT_SOURCE_HANDLE
    && edge.targetHandle === CLIP_EXPORT_TARGET_HANDLE;
}

function edgesBetween(
  edges: ClipExportGraphEdge[],
  source: string,
  target: string,
): ClipExportGraphEdge[] {
  return edges.filter((edge) => edge.source === source && edge.target === target);
}

function edgeBetween(
  source: string,
  target: string,
): ClipExportDownstreamEdge {
  return {
    id: `edge_${source}_${target}`,
    source,
    target,
    sourceHandle: CLIP_EXPORT_SOURCE_HANDLE,
    targetHandle: CLIP_EXPORT_TARGET_HANDLE,
  };
}

type PlacementBox = { left: number; right: number; top: number; bottom: number };

type PlacementNode = Pick<ClipExportGraphNode, 'type' | 'data' | 'width' | 'height' | 'measured' | 'selected'>;

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function aspectFromSize(size: unknown): number | undefined {
  if (!size || typeof size !== 'object') return undefined;
  const { width, height } = size as { width?: unknown; height?: unknown };
  if (!positiveFinite(width) || !positiveFinite(height)) return undefined;
  const aspect = width / height;
  return positiveFinite(aspect) ? aspect : undefined;
}

function previewHeight(node: PlacementNode, width: number, fallback: number): number {
  const data = node.data;
  if (node.type !== 'material' || (data?.materialType !== 'image' && data?.materialType !== 'video')) return fallback;
  if ([node.measured?.height, node.height, data.nodeHeight].some(positiveFinite)) return fallback;
  const aspect = aspectFromSize(data.size) ?? aspectFromSize(data.dimensions) ?? data.aspectRatio;
  // MaterialNode sets the loaded preview to the rounded aspect height, clamped to 80–800.
  return positiveFinite(aspect) ? Math.max(fallback, 80, Math.min(800, Math.round(width / aspect))) : fallback;
}

function labelWidth(label: unknown, limit: number): number {
  // The workbench title font is 14px. Use full-em advances for short ASCII/CJK
  // labels and the CSS ellipsis cap for text that needs other font shaping.
  return typeof label === 'string' && /^[\x20-\x7e\u3400-\u9fff]+$/u.test(label)
    ? Math.min(limit, label.length * 14) : limit;
}

function titleBadgeWidth(node: PlacementNode): number {
  const { status, executionStatus, simulated } = node.data ?? {};
  if (node.type === 'video_composition') {
    const badge = mapVideoCompositionToBadge((status ?? 'idle') as VideoCompositionStatus);
    return badge ? NODE_TITLE_BADGE_WIDTH : 0;
  }
  if (node.type !== 'material') return 0;
  if (simulated === true && executionStatus === 'completed') return NODE_TITLE_SIMULATED_BADGE_WIDTH;
  // Capacity warnings are derived from the live catalog and inputs in MaterialNode.
  return MATERIAL_EXECUTION_BADGE_STATES.has(executionStatus) || MATERIAL_LOCAL_BADGE_STATES.has(status)
    ? NODE_TITLE_BADGE_WIDTH : 0;
}

function placementBoxes(node: PlacementNode, position: { x: number; y: number }): [PlacementBox, ...PlacementBox[]] {
  const { x, y } = position;
  const comfySize = node.type === 'comfy-page' ? resolveComfyCardSize(node.width, node.height) : undefined;
  const { width, height, headerOffset } = resolveNodeDimensions({ ...projectGroupDimensions(node), ...comfySize, position });
  const isDirector = node.type === 'director';
  const cardHeight = isDirector ? Math.max(height, DIRECTOR_CARD_MIN_HEIGHT) : previewHeight(node, width, height);
  const body = { left: x, right: x + width, top: y, bottom: y + cardHeight };
  if (node.type === 'group') {
    const collapsed = Boolean(node.data?.isCollapsed);
    const left = x + GROUP_CHROME_INSET;
    const titleWidth = labelWidth(node.data?.title, GROUP_TITLE_MAX_LABEL_WIDTH) + GROUP_TITLE_CHROME_WIDTH
      + (node.selected ? 24 : 0); // ungroup button and gap
    return [body, {
      left, right: left + Math.ceil(titleWidth / minZoom),
      top: collapsed ? y + GROUP_TITLE_INSET + GROUP_HEADER_HEIGHT - Math.ceil(GROUP_HEADER_HEIGHT / minZoom)
        : y - Math.ceil((GROUP_HEADER_HEIGHT + GROUP_TITLE_INSET) / minZoom),
      bottom: collapsed ? y + GROUP_TITLE_INSET + GROUP_HEADER_HEIGHT : y - Math.floor(GROUP_TITLE_INSET / maxZoom),
    }];
  }
  const titleHeight = comfySize || isDirector ? 28 : headerOffset;
  if (titleHeight === 0) return [body];
  const data = node.data;
  const isMaterial = node.type === 'material';
  let label = data?.title;
  if (isMaterial) label = data?.label;
  if (node.type === 'table') label = data?.label || label;
  if (node.type === 'video_composition') label = label || data?.label;
  const labelLimit = isMaterial && data?.materialType === 'text' && !label
    ? TEXT_NODE_FALLBACK_LABEL_WIDTH : NODE_TITLE_MAX_LABEL_WIDTH;
  const textWidth = comfySize ? NODE_TITLE_MAX_LABEL_WIDTH : labelWidth(label, labelLimit);
  const titleWidth = Math.min(width + 8, textWidth + NODE_TITLE_CHROME_WIDTH + titleBadgeWidth(node));
  return [body, {
    left: x, right: x + Math.ceil(titleWidth / minZoom),
    top: y - Math.ceil(titleHeight / minZoom), bottom: y - Math.floor(NODE_TITLE_GAP / maxZoom),
  }];
}

function overlapsColumn(a: PlacementBox, b: PlacementBox, gap: number): boolean {
  return a.left < b.right + gap && b.left < a.right + gap;
}

function placeDownstreamNode(
  input: ClipExportDownstreamInput,
  data: Record<string, unknown>,
): ClipExportDownstreamNode['position'] {
  const x = input.sourcePosition.x + input.nodeWidth + CLIP_EXPORT_DOWNSTREAM_GAP;
  const output = placementBoxes({ type: 'material', data }, { x, y: 0 });
  const groups = new Map(input.currentNodes.filter(node => node.type === 'group').map(node => [node.id, node]));
  const blocked: { start: number; end: number }[] = [];
  for (const node of input.currentNodes) {
    if (node.hidden || !node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) continue;
    const parent = node.parentId ? groups.get(node.parentId) : undefined;
    if (parent?.hidden || parent?.data?.isCollapsed) continue;
    const position = parent?.position ? toAbsoluteCoordinates(node.position, parent.position) : node.position;
    const obstacle = placementBoxes(node, position);
    // Keep the existing gutter in the card column. Outside it, titles only
    // block positions where their own boxes can touch another visible part.
    const gap = overlapsColumn(output[0], obstacle[0], DOWNSTREAM_CLEARANCE) ? DOWNSTREAM_CLEARANCE : 0;
    for (const a of output) {
      for (const b of obstacle) {
        if (overlapsColumn(a, b, gap)) blocked.push({ start: b.top - a.bottom - gap, end: b.bottom - a.top + gap });
      }
    }
  }

  // Each pair defines an open interval of blocked top coordinates at this x.
  let y = input.sourcePosition.y;
  for (const { start, end } of blocked.sort((a, b) => a.start - b.start)) {
    if (y <= start) break;
    y = Math.max(y, end);
  }
  return { x, y };
}

export function planClipExportDownstream(
  input: ClipExportDownstreamInput,
): ClipExportDownstreamPlan | null {
  const videoPath = input.output.videoPath;
  if (!videoPath) return null;

  const desired = desiredData(input);
  const existing = existingDownstreamNode(input.currentNodes, videoPath, input.sourceNodeId);

  if (existing) {
    const current = nodeDataOf(existing);
    const refresh = reuseRefresh(desired);
    if (current.mediaUrl !== desired.mediaUrl) refresh.thumbnailUrl = desired.thumbnailUrl;
    const patch = changedFields(current, refresh);
    const nodePatches: ClipExportDownstreamPatch[] = Object.keys(patch).length > 0
      ? [{ nodeId: existing.id, data: patch }]
      : [];
    const between = edgesBetween(input.currentEdges, input.sourceNodeId, existing.id);
    const drawable = between.find(isDrawableClipExportEdge);

    if (drawable) {
      // Already wired: only refresh the node, and stay a no-op when nothing changed.
      return nodePatches.length > 0
        ? { addNodes: [], addEdges: [], nodePatches, removeEdgeIds: [] }
        : null;
    }

    const brokenIds = between
      .map((edge) => edge.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    return {
      addNodes: [],
      addEdges: [edgeBetween(input.sourceNodeId, existing.id)],
      nodePatches,
      removeEdgeIds: brokenIds,
    };
  }

  if (input.createIfMissing === false) return null;

  const newNodeId = input.createNodeId?.()
    ?? `node_mat_vid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const newNode: ClipExportDownstreamNode = {
    id: newNodeId,
    type: 'material',
    position: placeDownstreamNode(input, desired),
    selected: true,
    data: desired,
  };

  return {
    addNodes: [newNode],
    addEdges: [edgeBetween(input.sourceNodeId, newNodeId)],
    removeEdgeIds: [],
    nodePatches: [],
  };
}
