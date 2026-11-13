/**
 * SSOT specification contracts for workflow canvas nodes, tools, slots, and ports.
 *
 * Defines the foundational schema interfaces used by NodeSpecRegistry
 * for connection validation, model parameter adapter bindings, and multimodal routing.
 */

import type { MaterialType } from '../canvasTypes.ts';

export type { MaterialType };

export type MediaInputRole =
  | 'prompt'
  | 'reference'
  | 'first_frame'
  | 'last_frame'
  | 'controlnet'
  | 'mask'
  | 'audio_track'
  | 'motion_source';

/**
 * Port specification defining connection boundary contracts on canvas nodes.
 */
export interface PortSpec {
  side: 'in' | 'out';
  acceptedTypes: MaterialType[];
  multi?: boolean;
}

/**
 * Input slot specification describing individual input parameters / media feeds.
 */
export interface ToolInputSlotSpec {
  slotId: string;
  materialType: MaterialType;
  role: MediaInputRole;
  required: boolean;
  dynamicMaxByModel?: boolean;
  staticMax?: number;
}

/**
 * Tool specification declaring tool identity, model category, and input slots.
 */
export interface ToolSpec {
  id: string;
  labelKey: string;
  materialType: MaterialType;
  outputType: MaterialType;
  acceptedInputTypes: MaterialType[];
  modelCategory?: 'text' | 'image' | 'video' | 'audio';
  slots: ToolInputSlotSpec[];
}

/**
 * Node specification declaring ports, tools registry, default tool, and execution dispatch key.
 */
export interface NodeSpec {
  type: string;
  ports: PortSpec[];
  tools: Record<string, ToolSpec>;
  defaultTool: string;
  executorKey: string;
}
