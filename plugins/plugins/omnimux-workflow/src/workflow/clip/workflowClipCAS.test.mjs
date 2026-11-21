import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createWorkspaceStore } from '../workspace/WorkspaceStore.ts';
import { createWorkflowClipService } from './workflowClip.ts';

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'workflow-clip-cas-')));
  t.after(() => { assert.equal(realpathSync(root), root); rmSync(root, { recursive: true, force: true }); });
  const store = createWorkspaceStore({ workspacesDir: root });
  const workspaceId = store.create('Canvas').id;
  const binding = { workspaceId, nodeId: 'composition', projectId: 'clip_node_a' };
  const node = { id: binding.nodeId, type: 'video_composition', position: { x: 0, y: 0 },
    data: { projectId: binding.projectId, status: 'idle' } };
  store.save(workspaceId, { expectedVersion: 0, nodes: [node] });
  const exportArgs = (jobId, projectRevision = 3) => ({ ...binding, exportJobId: jobId, projectRevision,
    output: { videoPath: join(root, `${jobId}.mp4`), revision: `out-${jobId}`, durationMs: 1000, width: 1280, height: 720 } });
  const read = () => store.get(workspaceId);
  const withRace = (race) => {
    const expected = [];
    const seam = createWorkflowClipService({ store: { ...store, save(id, payload) {
      expected.push(payload.expectedVersion);
      if (expected.length === 1) race();
      return store.save(id, payload);
    } } });
    return { seam, expected };
  };
  return { store, binding, node, read, withRace, exportArgs };
}

test('draft CAS reloads the newer graph and preserves user changes to the same node and edges', t => {
  const { store, binding, node, read, withRace } = fixture(t);
  const input = { id: 'uploaded-video', type: 'material', position: { x: 0, y: 50 },
    data: { materialType: 'video', mediaUrl: '/uploaded.mp4' } };
  const edge = { id: 'upstream-edge', source: input.id, target: node.id, sourceHandle: 'out', targetHandle: 'in' };
  const changed = { ...node, position: { x: 110, y: 90 }, data: { ...node.data, title: 'Edited while Clip saves' } };
  const { seam, expected } = withRace(() => store.save(binding.workspaceId, {
    name: 'My changes', expectedVersion: 1, nodes: [input, changed], edges: [edge],
  }));
  assert.deepEqual(seam.saveDraft({ ...binding, revision: 8 }), { revision: 8, workspaceVersion: 3 });
  assert.deepEqual(expected, [1, 2]);
  const saved = read();
  assert.equal(saved.name, 'My changes');
  assert.deepEqual(saved.nodes, [input, { ...changed, data: { ...changed.data, draftRevision: 8 } }]);
  assert.deepEqual(saved.edges, [edge]);
});

test('export retry reevaluates both the latest job and the exact node binding', t => {
  const { store, binding, node, read, withRace, exportArgs } = fixture(t);
  const other = createWorkflowClipService({ store });
  const { seam, expected } = withRace(() => other.commitExport(exportArgs(5, 8)));
  assert.deepEqual(seam.commitExport(exportArgs(4, 7)), { status: 'superseded', canvasCommitted: false });
  assert.deepEqual(expected, [1]);
  assert.equal(read().nodes[0].data.outputRevision, 'out-5');
  assert.equal(read().edges.length, 1);
  assert.deepEqual(other.commitExport(exportArgs(6, 7)), { status: 'superseded', canvasCommitted: false });
  const originalVersion = read().version;
  const copy = { ...node, data: { ...node.data, projectId: 'clip_node_copy' } };
  const rebound = withRace(() => store.save(binding.workspaceId, { expectedVersion: originalVersion, nodes: [copy], edges: [] }));
  assert.throws(() => rebound.seam.commitExport(exportArgs(6, 8)), { code: 'clip-binding-mismatch' });
  assert.deepEqual(read().nodes, [copy]);
  assert.deepEqual(read().edges, []);
});

test('export CAS compares generations before revisions and rechecks the same receipt on retry', t => {
  const { store, read, withRace, exportArgs } = fixture(t);
  const other = createWorkflowClipService({ store });
  const original = other.commitExport(exportArgs(9, 5));
  assert.equal(original.status, 'committed');
  const { seam, expected } = withRace(() => other.commitExport(exportArgs(10, 6)));
  const adopted = { ...exportArgs(11, 2), revisionEpoch: 1, exportGeneration: 1 };
  const result = seam.commitExport(adopted);
  assert.equal(result.status, 'committed');
  assert.deepEqual(expected, [2, 3]);
  const saved = read();
  assert.equal(saved.nodes[0].data.outputRevision, 'out-11');
  assert.equal(saved.edges.length, 1);
  assert.deepEqual(saved.nodes[0].data.clipExportReceipts.map(({ projectRevision, exportGeneration }) =>
    [projectRevision, exportGeneration]), [[5, undefined], [6, undefined], [2, 1]]);
  assert.deepEqual(other.commitExport(exportArgs(14, 99)), { status: 'superseded', canvasCommitted: false });
  assert.deepEqual(other.commitExport({ ...exportArgs(9, 5), revisionEpoch: 0, exportGeneration: 0 }), original);
  assert.deepEqual(other.commitExport(adopted), result);
  assert.throws(() => other.commitExport({ ...adopted, revisionEpoch: 2 }), { code: 'clip-export-job-mismatch' });
  assert.deepEqual(read(), saved);
});
