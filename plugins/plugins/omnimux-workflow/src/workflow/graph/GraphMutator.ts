/**
 * GraphMutator (PR1) — the single host-side entry for structural canvas
 * mutations. Every agent write tool (PR2) and any future HTTP write route
 * funnels through here:
 *
 *   get → planCanvasInputMutation (shared validation core, same code the
 *   canvas island runs) → store.save with the optimistic-lock version.
 *
 * Concurrency: a version_conflict (the open canvas autosaved in between)
 * triggers ONE re-read + re-plan + retry against the fresh snapshot; a
 * second conflict is returned as an error envelope instead of looping.
 *
 * Errors are RETURNED as { error, message } envelopes (never thrown), so
 * tool authors cannot accidentally leak exceptions onto the wire.
 */

import {
  planCanvasInputMutation,
  type CanvasInputMutation,
  type CanvasMutationRuntimeContext,
  type CanvasNode,
} from '../../shared/graph/canvasInputMutationGateway.ts';
import type { SerializedCanvasEdge } from '../../shared/canvasTypes.ts';
import type { CanvasWorkspaceSnapshot } from '../../shared/canvasTypes.ts';
import { WorkflowStoreError, type WorkspaceStore } from '../workspace/WorkspaceStore.ts';

export type { CanvasMutationRuntimeContext } from '../../shared/graph/canvasInputMutationGateway.ts';

export interface GraphMutationSuccess {
  ok: true;
  snapshot: CanvasWorkspaceSnapshot;
  /** Post-mutation graph (== snapshot.nodes/edges after save cleaning). */
  nodes: CanvasWorkspaceSnapshot['nodes'];
  edges: SerializedCanvasEdge[];
}

export interface GraphMutationError {
  ok: false;
  error: string;
  message: string;
  /** Validation reasonCode from the shared gateway, when rejected. */
  reasonCode?: string;
}

export type GraphMutationResult = GraphMutationSuccess | GraphMutationError;

function envelope(error: string, message: string, reasonCode?: string): GraphMutationError {
  return { ok: false, error, message, ...(reasonCode ? { reasonCode } : {}) };
}

/** Run get → plan → save once. Throws WorkflowStoreError on store failures. */
function planAndSave(
  store: WorkspaceStore,
  workspaceId: string,
  mutation: CanvasInputMutation,
  context?: CanvasMutationRuntimeContext,
): GraphMutationSuccess | GraphMutationError {
  const snapshot = store.get(workspaceId);
  const plan = planCanvasInputMutation(
    { nodes: snapshot.nodes as CanvasNode[], edges: snapshot.edges },
    mutation,
    context,
  );
  if (plan.status !== 'allowed') {
    return envelope(
      'mutation-rejected',
      `mutation rejected by canvas validation: ${plan.reasonCode ?? 'unknown'}`,
      plan.reasonCode,
    );
  }
  const saved = store.save(workspaceId, {
    expectedVersion: snapshot.version,
    nodes: plan.nodes,
    edges: plan.edges,
  });
  return { ok: true, snapshot: saved.snapshot, nodes: saved.snapshot.nodes, edges: saved.snapshot.edges };
}

export function mutateWorkspaceGraph(
  store: WorkspaceStore,
  workspaceId: string,
  mutation: CanvasInputMutation,
  context?: CanvasMutationRuntimeContext,
): GraphMutationResult {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return planAndSave(store, workspaceId, mutation, context);
    } catch (error) {
      if (error instanceof WorkflowStoreError) {
        // version_conflict: the canvas (or another tool call) moved the doc
        // — re-read and re-plan the mutation against the fresh snapshot once.
        if (error.code === 'version_conflict' && attempt === 0) continue;
        return envelope(error.code, error.message);
      }
      return envelope(
        'mutation-failed',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  // Unreachable (loop returns), but keeps TS happy.
  return envelope('mutation-failed', 'mutation retry loop exhausted');
}
