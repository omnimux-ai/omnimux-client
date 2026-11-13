import { z } from 'zod';
import { canvasNodeSchema, canvasEdgeSchema } from '../workspace/snapshotSchema.ts';

export const TEMPLATE_SCHEMA_VERSION = 1 as const;

export const workflowTemplateSchema = z.object({
  schemaVersion: z.literal(TEMPLATE_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),
  coverUrl: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  nodeCount: z.number().int().min(0),
  nodes: z.array(canvasNodeSchema),
  edges: z.array(canvasEdgeSchema),
});

export type WorkflowTemplate = z.infer<typeof workflowTemplateSchema>;

export const createTemplatePayloadSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  coverUrl: z.string().optional(),
  nodes: z.array(canvasNodeSchema),
  edges: z.array(canvasEdgeSchema),
});

export type CreateTemplatePayload = z.infer<typeof createTemplatePayloadSchema>;
