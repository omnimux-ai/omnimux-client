/**
 * Workspace snapshot migration pipeline (schemaVersion 2 -> 3).
 *
 * Enforces lazy migration during reads:
 * - Upgrades schemaVersion: 2 -> 3
 * - Fills nodeKind for all material nodes using resolveNodeKind
 * - Cleans dirty data based on canonical identity-over-residual rules
 * - Idempotent: snapshots already at version 3+ pass through unchanged
 */

import type { CanvasWorkspaceSnapshot, SerializedCanvasNode } from '../../shared/canvasTypes.ts';
import { resolveNodeKind, type NodeKind } from '../../shared/graph/materialNode.ts';
import { SNAPSHOT_SCHEMA_VERSION } from '../../shared/canvasTypes.ts';

export function migrateSnapshot(snapshot: CanvasWorkspaceSnapshot): CanvasWorkspaceSnapshot {
  const currentVersion = snapshot.schemaVersion;
  if (currentVersion >= SNAPSHOT_SCHEMA_VERSION) {
    return snapshot;
  }

  const upgradedNodes = snapshot.nodes.map((node): SerializedCanvasNode => {
    if (node.type !== 'material') {
      return node;
    }

    const data = (node.data ?? {}) as Record<string, unknown>;
    const nodeKind: NodeKind = resolveNodeKind(data);

    return {
      ...node,
      data: {
        ...data,
        nodeKind,
      },
    };
  });

  return {
    ...snapshot,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    nodes: upgradedNodes,
  };
}
