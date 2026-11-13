/**
 * Table Node Specification (SSOT).
 *
 * Declares port contracts and metadata for the batch processing Table node.
 */

import type { NodeSpec } from '../contracts.ts';

export const tableNodeSpec: NodeSpec = {
  type: 'table',
  ports: [
    { side: 'in', acceptedTypes: ['text', 'image', 'video', 'audio'], multi: true },
    { side: 'out', acceptedTypes: ['text', 'image', 'video', 'audio'], multi: true },
  ],
  tools: {},
  defaultTool: 'table',
  executorKey: 'table',
};
