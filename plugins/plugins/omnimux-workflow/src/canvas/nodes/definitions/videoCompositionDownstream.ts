/**
 * Canvas-mode clip export: create (or reuse) a downstream video material
 * node and wire it to the composition node.
 *
 * Handle ids MUST match `CanvasNodeHandle` (`in` / `out`). Using
 * `input` / `output` stores an edge that React Flow cannot draw.
 *
 * The exported file lives outside the workspace
 * (`<DSH_HOME>/omnimux/clip/exports/<projectId>.mp4`), so the node carries:
 * - `mediaUrl`: the sanctioned `/omnimux-workflow/api/local-file?path=…` URL
 *   the material node streams from — a bare absolute host path 404s in the
 *   browser because it is resolved against the app origin;
 * - `origin` + `sourceCompositionNodeId`: the stable reuse identity. It
 *   survives `persistSanitize` (which strips `realPath` on save) and reloads,
 *   so re-exporting refreshes the same node instead of adding a duplicate.
 */

import { looksAbsolutePath, localFileMediaUrl, localFilePathFromUrl } from '../../../shared/localMedia.ts';

export const VIDEO_COMPOSITION_NODE_WIDTH = 350;
export const CLIP_EXPORT_SOURCE_HANDLE = 'out';
export const CLIP_EXPORT_TARGET_HANDLE = 'in';
export const CLIP_EXPORT_DOWNSTREAM_GAP = 80;
export const CLIP_EXPORT_ORIGIN = 'clip_export';
export const CLIP_EXPORT_COPY_ORIGIN = 'clip_export_copy';

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
 * `revision` is the exported file's content identity (`mtimeMs:size`). Canvas
 * export overwrites `<projectId>.mp4` in place, so without it the URL is
 * byte-identical across exports and React keeps the same `<video>` element —
 * which stays stuck in whatever state the first load left it. Carrying the
 * revision in the URL is what makes the browser fetch the new bytes.
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

export function planClipExportDownstream(
  input: ClipExportDownstreamInput,
): ClipExportDownstreamPlan | null {
  const videoPath = input.output.videoPath;
  if (!videoPath) return null;

  const desired = desiredData(input);
  const existing = existingDownstreamNode(input.currentNodes, videoPath, input.sourceNodeId);

  if (existing) {
    const patch = changedFields(nodeDataOf(existing), reuseRefresh(desired));
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
    position: {
      x: input.sourcePosition.x + input.nodeWidth + CLIP_EXPORT_DOWNSTREAM_GAP,
      y: input.sourcePosition.y,
    },
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
