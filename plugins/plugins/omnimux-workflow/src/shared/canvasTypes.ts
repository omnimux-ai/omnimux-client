/**
 * omnimux-workflow shared canvas data model.
 *
 * Single source of truth for the canvas document contract, referenced
 * type-only from both the host (src/workflow) and the canvas island
 * (src/canvas). Narrowed from Gxgen `apps/web/src/types/canvas.ts` +
 * `@gxg/shared` inline (see research/canvas-spike/SPIKE-REPORT.md).
 *
 * V1 narrowing: tracks / textOverlays / previewSettings are cut (timeline
 * domain); nodes/edges/version/metadata/settings survive.
 */

import type { Node, Edge } from '@xyflow/react';

export type SerializedCanvasNode = Node<Record<string, unknown>>;
export type SerializedCanvasEdge = Edge<Record<string, unknown>>;

export type MaterialType = 'text' | 'image' | 'video' | 'audio';

/** Group node custom data contract for visual grouping and subgraphs. */
export interface GroupNodeData extends Record<string, unknown> {
  title: string;
  color: string;
  isCollapsed?: boolean;
  expandedBounds?: {
    width: number;
    height: number;
  };
  minWidth?: number;
  minHeight?: number;
  padding?: number;
  nodeIds?: string[];
}

export type SerializedGroupNode = Node<GroupNodeData>;

/** Canvas execution settings persisted with the workspace. */
export interface CanvasSettings {
  /** Max parallel node executions (serial = 1). */
  maxParallel: number;
  /** Whole-run failure strategy. */
  failStrategy: 'fail-fast' | 'continue';
}

/** Canvas workspace snapshot persisted at workspaces/<id>/canvas.json. */
export interface CanvasWorkspaceSnapshot {
  /** Snapshot schema discriminator (migration hook: v2 legacy, v3 with explicit nodeKind). */
  schemaVersion: 2 | 3;
  id: string;
  name: string;
  /** Optimistic-lock counter, incremented on every PUT. */
  version: number;
  nodes: SerializedCanvasNode[];
  edges: SerializedCanvasEdge[];
  settings: CanvasSettings;
  metadata: {
    createdAt: string;
    updatedAt: string;
    nodeCount: number;
  };
}

/** Client save payload. `version` carries the optimistic-lock check. */
export interface SaveCanvasWorkspacePayload {
  name?: string;
  nodes?: SerializedCanvasNode[];
  edges?: SerializedCanvasEdge[];
  settings?: Partial<CanvasSettings>;
  metadata?: Record<string, unknown>;
  /** Client's last-seen version; mismatch -> 409 version_conflict. */
  expectedVersion: number;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  version: number;
  nodeCount: number;
  updatedAt: string;
}

/** REST response envelope used by every /omnimux-workflow/api/* route. */
export interface ApiError {
  error: string;
  message: string;
}

export interface VersionConflictError extends ApiError {
  error: 'version_conflict';
  /** Server-side current version, so the client can pull + merge. */
  current: number;
}

export const DEFAULT_CANVAS_SETTINGS: CanvasSettings = {
  maxParallel: 3,
  failStrategy: 'fail-fast',
};

export const SNAPSHOT_SCHEMA_VERSION = 3 as const;
