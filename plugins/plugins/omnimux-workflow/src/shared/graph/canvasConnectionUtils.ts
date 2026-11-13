/**
 * Ported verbatim from Gxgen
 * `apps/web/src/pages/CanvasEditor/utils/canvasConnectionUtils.ts`
 * (validated by the extraction spike).
 */

import type { Edge } from '@xyflow/react';

export const DEFAULT_CANVAS_EDGE_STYLE = {
  stroke: '#b1b1b7',
  strokeWidth: 2,
} as const;

export const DEFAULT_CANVAS_EDGE_OPTIONS = {
  type: 'animated',
  style: DEFAULT_CANVAS_EDGE_STYLE,
  animated: false,
} as const;

export interface CanvasConnectionLike extends Partial<Edge> {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

function normalizeHandleValue(handle: string | null | undefined): string | undefined {
  if (typeof handle !== 'string') {
    return undefined;
  }

  const trimmed = handle.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') {
    return undefined;
  }

  return trimmed;
}

function buildCanvasEdgeId(edge: CanvasConnectionLike): string {
  if (typeof edge.id === 'string' && edge.id.trim()) {
    return edge.id;
  }

  return `e-${edge.source}-${edge.target}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeCanvasEdge(edge: CanvasConnectionLike): Edge {
  const existingData = edge.data && typeof edge.data === 'object' && !Array.isArray(edge.data)
    ? edge.data as Record<string, unknown>
    : {};
  const createdAt = typeof existingData.createdAt === 'number' && Number.isFinite(existingData.createdAt)
    ? existingData.createdAt
    : Date.now();

  return {
    id: buildCanvasEdgeId(edge),
    ...DEFAULT_CANVAS_EDGE_OPTIONS,
    ...edge,
    data: {
      ...existingData,
      createdAt,
    },
    animated: edge.animated ?? DEFAULT_CANVAS_EDGE_OPTIONS.animated,
    style: {
      ...DEFAULT_CANVAS_EDGE_STYLE,
      ...(edge.style ?? {}),
    },
    sourceHandle: normalizeHandleValue(edge.sourceHandle),
    targetHandle: normalizeHandleValue(edge.targetHandle),
  };
}
