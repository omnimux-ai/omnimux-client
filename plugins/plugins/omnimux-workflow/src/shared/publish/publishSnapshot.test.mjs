import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compactManifestForExecution,
  compactPublishSnapshotEdges,
  compactPublishSnapshotNodes,
} from './publishSnapshot.ts';

test('compactPublishSnapshotNodes strips runtime caches but keeps execution seed', () => {
  const nodes = compactPublishSnapshotNodes([
    {
      id: 'node-a',
      type: 'material',
      position: { x: 1, y: 2 },
      parentId: 'group-1',
      extent: 'parent',
      data: {
        materialType: 'text',
        selectedTool: 'text-editor',
        nodeKind: 'import',
        content: 'https://www.tiktok.com/@creator/video/1',
        __catalog: { huge: 'x'.repeat(200_000) },
        compat: { huge: 'x'.repeat(200_000) },
        __workspaceId: 'ws-1',
      },
    },
  ]);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].id, 'node-a');
  assert.equal(nodes[0].parentId, 'group-1');
  assert.equal(nodes[0].data.content, 'https://www.tiktok.com/@creator/video/1');
  assert.equal(nodes[0].data.__catalog, undefined);
  assert.equal(nodes[0].data.compat, undefined);
  assert.equal(nodes[0].data.__workspaceId, undefined);
});

test('compactManifestForExecution keeps manifest contract and shrinks the snapshot', () => {
  const manifest = {
    appId: 'app-1',
    schemaVersion: '1.1',
    publishPlan: { inputs: [], outputs: [] },
    workflowBinding: {
      workspaceId: 'ws-1',
      snapshot: {
        nodes: [
          {
            id: 'node-a',
            type: 'material',
            data: {
              materialType: 'text',
              content: 'link',
              __catalog: { huge: 'x'.repeat(200_000) },
            },
          },
          {
            id: 'node-b',
            type: 'material',
            data: {
              materialType: 'video',
              outputCapabilityId: 'video-extraction',
              mediaUrl: '/video.mp4',
              __catalog: { huge: 'x'.repeat(200_000) },
            },
          },
        ],
        edges: [{ id: 'e1', source: 'node-a', target: 'node-b' }],
      },
    },
  };
  const compact = compactManifestForExecution(manifest);
  assert.equal(compact.appId, 'app-1');
  assert.deepEqual(compact.publishPlan, manifest.publishPlan);
  assert.equal(compact.workflowBinding.snapshot.nodes.length, 2);
  assert.equal(compact.workflowBinding.snapshot.nodes[1].data.outputCapabilityId, 'video-extraction');
  assert.ok(JSON.stringify(compact).length < 10_000);
});

test('compactPublishSnapshotEdges keeps graph endpoints only', () => {
  const edges = compactPublishSnapshotEdges([
    { id: 'e1', source: 'a', target: 'b', sourceHandle: 'out', data: { slotBinding: { role: 'prompt' } } },
    { source: 'bad' },
  ]);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].source, 'a');
  assert.equal(edges[0].target, 'b');
  assert.equal(edges[0].sourceHandle, 'out');
  assert.deepEqual(edges[0].data, { slotBinding: { role: 'prompt' } });
});
