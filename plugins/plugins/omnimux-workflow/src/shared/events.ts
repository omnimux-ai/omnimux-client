/**
 * omnimux-workflow SSE event protocol constants (M1 scaffold, M3 wires the wire).
 *
 * The 11-event protocol is ported as-is from Gxgen useExecutionSSE so the
 * M3 execution engine transplant keeps protocol compatibility.
 */

export const EXECUTION_SSE_EVENTS = [
  'execution_start',
  'node_start',
  'node_progress',
  'node_complete',
  'node_error',
  'node_skipped',
  'execution_paused',
  'execution_resumed',
  'execution_complete',
  'execution_error',
  'execution_cancelled',
] as const;

export type ExecutionSseEventName = (typeof EXECUTION_SSE_EVENTS)[number];

/** Media asset descriptor carried by node_complete payloads. */
export interface MediaAssetPayload {
  type: 'image' | 'video' | 'audio';
  url: string;
  thumbnail?: string;
}

export interface NodeCompletePayload {
  nodeId: string;
  output: {
    mediaAssets?: MediaAssetPayload[];
    text?: string;
  };
}

export type ExecutionSsePayload = Partial<NodeCompletePayload> & {
  executionId?: string;
  nodeId?: string;
  message?: string;
};
