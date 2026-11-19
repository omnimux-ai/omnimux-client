/**
 * Data-layer regression across the production store, save schema and render
 * projection. The separate browser journey covers controls and visual behavior.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { projectGroupVisibility } from '../src/canvas/editor/utils/nodeVisualMath.ts';
import { sanitizeEdges, sanitizeNodes } from '../src/canvas/bridge/persistSanitize.ts';
import { workspaceSnapshotSchema } from '../src/workflow/workspace/snapshotSchema.ts';
import { SNAPSHOT_SCHEMA_VERSION } from '../src/shared/canvasTypes.ts';

const temp = mkdtempSync(join(tmpdir(), 'omnimux-canvas-grouping-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const bundle = join(temp, 'store.mjs');
buildSync({
  stdin: {
    contents: "export { useCanvasStore } from './src/canvas/store/canvasStore.ts';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    sourcefile: 'store.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
});
const { useCanvasStore } = await import(pathToFileURL(bundle).href);
const state = () => useCanvasStore.getState();
afterEach(() => state().resetStore());

function material(id, x, y) {
  return { id, type: 'material', position: { x, y }, data: { materialType: 'text', content: `素材 ${id}` } };
}

function link(source, target, targetHandle) {
  return { id: `${source}-${target}`, source, target, sourceHandle: 'out', targetHandle };
}

function reopenSavedCanvas() {
  const timestamp = '2026-01-01T00:00:00.000Z';
  const saved = JSON.stringify({
    id: 'canvas',
    name: '分组试跑',
    version: 1,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    nodes: sanitizeNodes(state().nodes),
    edges: sanitizeEdges(state().edges),
    metadata: { createdAt: timestamp, updatedAt: timestamp, nodeCount: state().nodes.length },
  });
  const snapshot = workspaceSnapshotSchema.parse(JSON.parse(saved));
  state().resetStore();
  state().hydrateGraph(snapshot.nodes, snapshot.edges);
}

function assertProjection(hiddenIds, visibleEdges) {
  const current = state();
  const originalEdges = structuredClone(current.edges);
  const { hiddenNodeIds, flowEdges } = projectGroupVisibility(current.nodes, current.edges);
  assert.deepEqual(hiddenNodeIds, new Set(hiddenIds));
  assert.deepEqual(flowEdges.filter(({ hidden }) => !hidden), visibleEdges);
  assert.equal(flowEdges.length, originalEdges.length);
  const visibleEdgeIds = new Set(visibleEdges.map(({ id }) => id));
  for (const [index, edge] of flowEdges.entries()) {
    const original = originalEdges[index];
    if (visibleEdgeIds.has(original.id)) {
      assert.strictEqual(edge, current.edges[index]);
    } else {
      assert.deepEqual(edge, { ...original, hidden: true, selected: false });
    }
  }
  assert.deepEqual(current.edges, originalEdges);
}

test('moved group stays collapsed after save and reopen, then releases both nodes and original edges', () => {
  const outside = material('outside', 60, 100);
  const a = material('a', 450, 100);
  const b = material('b', 860, 100);
  const edges = [link('outside', 'a', 'in'), link('a', 'b', 'text')];
  state().hydrateGraph([outside, a, b], edges);

  const groupId = state().groupNodes(['a', 'b']);
  assert.ok(groupId);
  const group = state().nodes.find(({ id }) => id === groupId);
  const movement = { x: -80, y: 60 };
  state().onNodesChange([{
    id: groupId,
    type: 'position',
    position: { x: group.position.x + movement.x, y: group.position.y + movement.y },
    dragging: false,
  }]);
  state().toggleGroupCollapse(groupId);
  assert.equal(state().nodes.some(({ hidden }) => hidden === true), false, '收起不把显示状态写入组内节点');
  assertProjection(['a', 'b'], []);
  assert.deepEqual(state().edges, edges);

  reopenSavedCanvas();
  assert.equal(state().nodes.find(({ id }) => id === groupId).data.isCollapsed, true);
  assertProjection(['a', 'b'], []);
  assert.deepEqual(state().edges, edges);
  state().toggleGroupCollapse(groupId);
  assertProjection([], edges);

  state().toggleGroupCollapse(groupId);
  state().ungroup(groupId);
  const positionsAfterUngroup = [
    outside.position,
    { x: a.position.x + movement.x, y: a.position.y + movement.y },
    { x: b.position.x + movement.x, y: b.position.y + movement.y },
  ];
  const assertUngrouped = () => {
    const nodes = state().nodes;
    assert.deepEqual(nodes.map(({ id }) => id), [outside.id, a.id, b.id]);
    assert.deepEqual(nodes.map(({ position }) => position), positionsAfterUngroup);
    assert.deepEqual(nodes.map(({ data }) => data), [outside.data, a.data, b.data]);
    assert.ok(nodes.every(({ parentId, extent }) => parentId === undefined && extent === undefined));
    assertProjection([], edges);
  };
  assertUngrouped();
  reopenSavedCanvas();
  assertUngrouped();
});

test('a hidden endpoint affects only rendering and selection, preserving references for downstream nodes', () => {
  const unrelated = link('outside-a', 'outside-b', 'in');
  const withinOpenGroup = link('c', 'd', 'text');
  const acrossGroups = link('b', 'c', 'reference');
  const downstreamReference = { ...link('b', 'outside-b', 'reference'), selected: true };
  const edges = [unrelated, withinOpenGroup, acrossGroups, downstreamReference];
  state().hydrateGraph(
    ['a', 'b', 'c', 'd', 'outside-a', 'outside-b'].map((id, index) => material(id, index * 400, 100)),
    edges,
  );
  const groupAB = state().groupNodes(['a', 'b']);
  const groupCD = state().groupNodes(['c', 'd']);
  state().toggleGroupCollapse(groupAB);
  assertProjection(['a', 'b'], [unrelated, withinOpenGroup]);
  state().toggleGroupCollapse(groupCD);
  assertProjection(['a', 'b', 'c', 'd'], [unrelated]);
  state().toggleGroupCollapse(groupAB);
  assertProjection(['c', 'd'], [unrelated, downstreamReference]);
  state().toggleGroupCollapse(groupCD);
  assertProjection([], edges);
  assert.deepEqual(state().edges, edges);
});
