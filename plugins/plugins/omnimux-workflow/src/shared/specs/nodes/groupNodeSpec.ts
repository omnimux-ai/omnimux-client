/**
 * Group Node Specification (SSOT).
 *
 * Declares port contracts and metadata for the visual grouping Group node.
 */

import type { NodeSpec } from '../contracts.ts';

export const groupNodeSpec: NodeSpec = {
  type: 'group',
  ports: [],
  tools: {},
  defaultTool: 'group',
  executorKey: 'group',
};
