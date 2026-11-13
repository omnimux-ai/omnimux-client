import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeNodes } from '../../canvas/bridge/persistSanitize.ts';
import { workspaceSnapshotSchema } from './snapshotSchema.ts';
import { planGroupNodes } from '../../canvas/editor/utils/nodeVisualMath.ts';

test('打组后 sanitize + schema 仍保留 parentId 与 extent', () => {
  const plan = planGroupNodes([
    { id: 'n1', type: 'material', position: { x: 100, y: 80 }, width: 200, height: 120, data: { title: 'a' } },
    { id: 'n2', type: 'material', position: { x: 360, y: 80 }, width: 200, height: 120, data: { title: 'b' } },
  ], ['n1', 'n2']);
  assert.ok(plan);
  const cleaned = sanitizeNodes(plan.nodes);
  const parsed = workspaceSnapshotSchema.parse({
    schemaVersion: 2,
    id: 'ws_test',
    name: '分组快照',
    version: 1,
    nodes: cleaned,
    edges: [],
    metadata: {
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: cleaned.length,
    },
  });
  const child = parsed.nodes.find((node) => node.id === 'n1');
  assert.equal(child.parentId, plan.groupId);
  assert.equal(child.extent, 'parent');
});
