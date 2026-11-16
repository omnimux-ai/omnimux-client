/**
 * #48 immediate single-node submit.
 *
 * The click site owns a synchronous guard: one pending submit per MaterialNode.
 * Quota is checked in parallel and never blocks the create request; the hub's
 * quota seam remains responsible for showing its login / quota notice, while
 * an unexpected quota transport failure is surfaced through `onQuotaFailure`.
 */
import type { NodeSubmissionResult } from '../../../store/executionStore';

export interface NodeQuotaCheckResult {
  ok?: boolean;
  reason?: string;
}

export interface SubmitNodeOptions {
  nodeId: string;
  /** Synchronous click guard shared by every render of the node. */
  isPendingRef: { current: boolean };
  start: (nodeId: string) => NodeSubmissionResult | Promise<NodeSubmissionResult> | void;
  ensureQuota?: (context: { capability?: string; correlationId?: string }) => Promise<NodeQuotaCheckResult | undefined> | NodeQuotaCheckResult | undefined;
  /** Called once when the create request settles, regardless of outcome. */
  onSettled?: () => void;
  /** Transport failure from the quota seam (not the normal quota-denied notice). */
  onQuotaFailure?: () => void;
}

export function submitNodeImmediate(options: SubmitNodeOptions): Promise<NodeSubmissionResult> {
  const { nodeId, isPendingRef, start, ensureQuota, onSettled, onQuotaFailure } = options;
  if (isPendingRef.current) return Promise.resolve({ ok: false, error: '' });
  isPendingRef.current = true;

  if (ensureQuota) {
    // Parallel, deliberately not awaited: create must go out immediately.
    void Promise.resolve()
      .then(() => ensureQuota({ capability: 'canvas', correlationId: nodeId }))
      .then((result) => {
        if (result && result.ok === false) onQuotaFailure?.();
      })
      .catch(() => onQuotaFailure?.());
  }

  return Promise.resolve()
    .then(() => start(nodeId))
    .then((result) => (result && typeof result === 'object' ? result : { ok: true }))
    .catch((error: unknown): NodeSubmissionResult => ({
      ok: false,
      error: error instanceof Error ? error.message : '',
    }))
    .finally(() => {
      isPendingRef.current = false;
      onSettled?.();
    });
}
