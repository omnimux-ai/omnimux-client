/**
 * React-free material node factory shared by the canvas island and the
 * host agent tools (PR1).
 *
 * The canvas-side `editor/utils/nodeFactory.ts` historically built nodes
 * through the React node registry (`createNode`), which the host cannot
 * import (registry entries carry React components). For the single
 * 'material' node type the registry path is equivalent to assembling
 * `{ id, type, position, data: createDefaultMaterialNodeData(...) }`
 * directly — this module is that equivalent, with `crypto.randomUUID`
 * instead of the `uuid` package so the host bundle needs no extra dep.
 */

import {
  createDefaultMaterialNodeData,
  type MaterialNodeData,
  type MaterialType,
} from './materialNode.ts';
import { getDefaultNodeWidth } from './nodeSizeConfig.ts';
import type { CanvasNode } from './canvasInputMutationGateway.ts';

/** Create a material node of the given materialType (registry-equivalent). */
export function createMaterialNode(
  materialType: MaterialType,
  position: { x: number; y: number },
  overrides?: Partial<MaterialNodeData>,
): CanvasNode {
  // label 留空：NodeHeader 回退 i18n 类型名（随宿主语言切换）。
  const data = createDefaultMaterialNodeData(materialType, {
    nodeKind: 'generate',
    status: 'empty',
    nodeWidth: getDefaultNodeWidth(materialType),
    ...overrides,
  });
  return {
    // globalThis.crypto.randomUUID: isomorphic (Node 19+ and all browsers),
    // no `uuid` / `node:crypto` dep so the canvas bundle can import this too.
    id: globalThis.crypto.randomUUID(),
    type: 'material',
    position,
    data: data as unknown as Record<string, unknown>,
  };
}

/** Create an explicit asset import node (registry-equivalent). */
export function createImportNode(
  materialType: MaterialType = 'image',
  position: { x: number; y: number } = { x: 0, y: 0 },
  overrides?: Partial<MaterialNodeData>,
): CanvasNode {
  const data = createDefaultMaterialNodeData(materialType, {
    nodeKind: 'import',
    selectedTool: 'import',
    status: 'empty',
    nodeWidth: getDefaultNodeWidth(materialType),
    ...overrides,
  });
  return {
    id: globalThis.crypto.randomUUID(),
    type: 'material',
    position,
    data: data as unknown as Record<string, unknown>,
  };
}
