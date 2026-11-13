/**
 * Workspace snapshot zod schema.
 *
 * - Read side is lenient: unknown fields are stripped, defaults applied.
 * - Write side is strict: the canonical shape is re-validated before flush.
 *
 * zod is a *build-time* dependency: esbuild bundles it into dist/index.js,
 * so the installed host runtime has zero third-party requires.
 */
import { z } from 'zod';
import {
  DEFAULT_CANVAS_SETTINGS,
  SNAPSHOT_SCHEMA_VERSION,
} from '../../shared/canvasTypes.ts';

export const canvasNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  data: z.record(z.string(), z.unknown()).default({}),
  selected: z.boolean().optional(),
  draggable: z.boolean().optional(),
  selectable: z.boolean().optional(),
  deletable: z.boolean().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  parentId: z.string().optional(),
  extent: z.union([
    z.literal('parent'),
    z.tuple([z.number(), z.number(), z.number(), z.number()]),
  ]).optional(),
  zIndex: z.number().optional(),
  style: z.record(z.string(), z.unknown()).optional(),
});

export const canvasEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().nullish(),
  targetHandle: z.string().nullish(),
  type: z.string().optional(),
  animated: z.boolean().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  style: z.record(z.string(), z.unknown()).optional(),
});

export const canvasSettingsSchema = z.object({
  maxParallel: z.number().int().min(1).max(16),
  failStrategy: z.enum(['fail-fast', 'continue']),
});

export const workspaceSnapshotSchema = z.object({
  schemaVersion: z.union([z.literal(2), z.literal(SNAPSHOT_SCHEMA_VERSION)]),
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  version: z.number().int().min(0),
  nodes: z.array(canvasNodeSchema),
  edges: z.array(canvasEdgeSchema),
  settings: canvasSettingsSchema.default({ ...DEFAULT_CANVAS_SETTINGS }),
  metadata: z.object({
    createdAt: z.string(),
    updatedAt: z.string(),
    nodeCount: z.number().int().min(0),
  }),
});

export type ParsedWorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;
