/**
 * Canvas-side node factory — thin wrapper over the shared React-free
 * factory (`src/shared/graph/nodeFactory.ts`, PR1). The host agent tools
 * use the shared factory directly; this module keeps the historical
 * `WorkflowCreationResult` shape and `appendWithSelectionReset` helper the
 * editor consumes.
 */

import type { MaterialNodeData, MaterialType } from '../../types/materialNode';
import {
  createMaterialNode as createSharedMaterialNode,
  createImportNode as createSharedImportNode,
} from '../../../shared/graph/nodeFactory.ts';
import type { CanvasNode } from './canvasInputMutationGateway';

export interface WorkflowCreationResult {
  nodes: CanvasNode[];
  edges: [];
}

/** Create a material node of the given materialType. */
export function createMaterialNode(
  materialType: MaterialType,
  position: { x: number; y: number },
  overrides?: Partial<MaterialNodeData>,
): WorkflowCreationResult {
  return { nodes: [createSharedMaterialNode(materialType, position, overrides)], edges: [] };
}

/** Create an explicit asset import node. */
export function createImportNode(
  materialType: MaterialType = 'image',
  position: { x: number; y: number } = { x: 0, y: 0 },
  overrides?: Partial<MaterialNodeData>,
): WorkflowCreationResult {
  return { nodes: [createSharedImportNode(materialType, position, overrides)], edges: [] };
}

/** 将新节点追加到现有节点列表，同时取消现有节点的选中状态（原样保留） */
export function appendWithSelectionReset(currentNodes: CanvasNode[], newNodes: CanvasNode[]): CanvasNode[] {
  const cleared = currentNodes.map((node) => ({ ...node, selected: false } as CanvasNode));
  return [...cleared, ...newNodes];
}
