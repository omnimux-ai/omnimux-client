/**
 * Video Composition Node Specification (SSOT).
 *
 * Declares port contracts and metadata for the Video Composition node.
 */

import type { NodeSpec } from '../contracts.ts';

export const videoCompositionNodeSpec: NodeSpec = {
  type: 'video_composition',
  ports: [
    { side: 'in', acceptedTypes: ['text', 'image', 'video', 'audio'], multi: true },
    { side: 'out', acceptedTypes: ['video'], multi: true },
  ],
  tools: {},
  defaultTool: 'video_composition',
  executorKey: 'video_composition',
};
