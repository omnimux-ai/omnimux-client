import type { Node, Edge, Connection } from '@xyflow/react';
import { validateCanvasConnectionStructure } from './canvasConnectionStructure.ts';

export type ConnectionRejectReasonCode = 'self_connection' | 'duplicate_edge' | 'missing_node' | 'cycle' | 'type_contract';
export interface DetailedConnectionValidation {
  valid: boolean;
  blockedBy?: 'structure' | 'type-contract';
  reasonCode?: ConnectionRejectReasonCode;
}

/** Only structural reasons can be surfaced as edge rejection messages. */
export function rejectReasonKey(reasonCode: string | undefined | null): string {
  switch (reasonCode) {
    case 'self_connection': return 'edge.reject.selfConnection';
    case 'duplicate_edge': return 'edge.reject.duplicateEdge';
    case 'missing_node': return 'edge.reject.missingNode';
    case 'cycle': return 'edge.reject.cycle';
    case 'type_contract': return 'edge.reject.typeContract';
    default: return 'edge.reject.invalid';
  }
}

export function validateConnection(connection: Edge | Connection, nodes: Node[], edges: Edge[]): boolean {
  return validateConnectionDetailed(connection, nodes, edges).valid;
}

export function validateConnectionDetailed(connection: Edge | Connection, nodes: Node[], edges: Edge[]): DetailedConnectionValidation {
  const structure = validateCanvasConnectionStructure(connection, nodes, edges);
  if (structure.valid) return { valid: true };
  return { valid: false, blockedBy: structure.reasonCode === 'type_contract' ? 'type-contract' : 'structure', reasonCode: structure.reasonCode };
}
