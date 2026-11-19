import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createWorkflowNodeUpdateTool } from './agentWriteTools.ts';
import { createWorkspaceStore } from '../workspace/WorkspaceStore.ts';

const slot = 'reference_images';
const catalog = { models: [{
  id: 'muse-video',
  operations: [{
    id: 'video_multi_ref',
    listed: true,
    output: { type: 'video' },
    inputs: [{
      slot, type: 'image', role: 'reference', firstItemRole: 'first_frame', source: 'upstream_edge', min: 2, max: 2,
    }],
  }],
}] };

test('workflow_node_update swaps an ordered pair once, including when a concurrent save wins', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'node-update-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = createWorkspaceStore({ workspacesDir: join(dir, 'workspaces') });
  const ws = store.create();
  const position = { x: 0, y: 0 };
  const imageIds = ['image-one', 'image-two'];
  const images = imageIds.map(id => ({
    id, type: 'material', position,
    data: { materialType: 'image', nodeKind: 'import', mediaUrl: `https://example.test/${id}.png` },
  }));
  const edges = imageIds.map(source => ({
    id: `edge-${source}`, source, target: 'video',
    data: { feedType: 'image', slotBinding: { slot, role: 'reference', type: 'image', mirror: true } },
  }));
  const video = {
    id: 'video', type: 'material', position,
    data: {
      materialType: 'video',
      nodeKind: 'generate',
      selectedTool: 'video-generation',
      prompt: 'Move forward',
      params: { model: 'muse-video', operation: 'video_multi_ref' },
      inputBindingVersion: 1,
      slotBindings: {
        [slot]: edges.map(({ id, source }, ordinal) => ({
          edgeId: id, sourceNodeId: source, role: 'reference', ordinal, pinned: true,
        })),
      },
    },
  };
  const original = store.save(ws.id, { expectedVersion: ws.version, nodes: [...images, video], edges }).snapshot;
  const tool = createWorkflowNodeUpdateTool({
    store, executionManager: {}, mediaDir: join(dir, 'media'), getCatalog: () => catalog,
  });
  const args = { workspace_id: ws.id, node_id: video.id };
  const swap = (first, second) => ({ slot, first_edge_id: edges[first].id, second_edge_id: edges[second].id });
  const orderOf = node => node.data.slotBindings[slot].map(binding => binding.sourceNodeId);
  const savedVideo = () => store.get(ws.id).nodes.find(node => node.id === video.id);

  const mixed = await tool.execute({ ...args, patch: { swap_reference_images: swap(0, 1), prompt: 'Different prompt' } });
  assert.equal(mixed.error, 'invalid-args');
  assert.equal(store.get(ws.id).version, original.version);

  const changed = await tool.execute({ ...args, patch: { swap_reference_images: swap(0, 1) } });
  assert.equal(changed.error, undefined);
  assert.deepEqual(orderOf(changed.node), [...imageIds].reverse());
  assert.deepEqual(orderOf(savedVideo()), [...imageIds].reverse());
  assert.deepEqual(store.get(ws.id).edges, original.edges);

  const repeated = await tool.execute({ ...args, patch: { swap_reference_images: swap(0, 1) } });
  assert.equal(repeated.reasonCode, 'input_changed');
  assert.equal(store.get(ws.id).version, changed.workspace.version);

  const save = store.save.bind(store);
  const concurrentSave = t.mock.method(store, 'save', (id, patch) => {
    save(id, patch); // Simulate the canvas saving the same reorder first.
    return save(id, patch); // The Agent write sees a version conflict.
  });
  const raced = await tool.execute({ ...args, patch: { swap_reference_images: swap(1, 0) } });
  assert.equal(raced.reasonCode, 'input_changed');
  assert.equal(concurrentSave.mock.callCount(), 1);
  assert.deepEqual(orderOf(savedVideo()), imageIds);
  assert.deepEqual(store.get(ws.id).edges, original.edges);
});
