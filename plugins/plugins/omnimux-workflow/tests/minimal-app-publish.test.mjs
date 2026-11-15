/**
 * Minimal app-publish scenario against the built host:
 * text link → video-extraction capability, group execution produces a real
 * video artifact that the published app can surface.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createExecutionManager, createHeadlessExecutionSeam, createWorkspaceStore } from '../dist/index.js';

test('minimal app publish: text link group run produces a video output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omnimux-minimal-app-'));
  let manager = null;
  try {
    const store = createWorkspaceStore({ workspacesDir: join(dir, 'workspaces') });
    const workspace = store.create('minimal');
    const textNode = {
      id: 'node-a',
      type: 'material',
      position: { x: 0, y: 0 },
      data: {
        label: '链接',
        materialType: 'text',
        nodeKind: 'import',
        selectedTool: 'text-editor',
        status: 'completed',
        content: 'https://www.tiktok.com/@creator/video/123',
        params: {},
      },
    };
    const videoNode = {
      id: 'node-b',
      type: 'material',
      position: { x: 400, y: 0 },
      data: {
        label: '视频保存',
        materialType: 'video',
        nodeKind: 'generate',
        selectedTool: 'video-extraction',
        outputCapabilityId: 'video-extraction',
        status: 'empty',
        params: {},
      },
    };
    manager = createExecutionManager({
      executionsDir: join(dir, 'executions'),
      gateway: { capabilities: async () => ({ text: [], image: [], video: [], audio: [], fingerprint: 'test' }) },
      mediaDir: join(dir, 'media'),
      workspaceStore: store,
      getTool: (name) => name === 'omnimux_social_data'
        ? { execute: async () => ({ data: { video_url: 'https://cdn.example.com/video.mp4', title: '提取视频' } }) }
        : undefined,
      fetcher: async () => new Response(Buffer.from('fake-mp4'), { status: 200 }),
    });
    const seam = createHeadlessExecutionSeam({
      executionManager: manager,
      workspaceStore: store,
      getCatalog: async () => ({ text: [], image: [], video: [], audio: [], fingerprint: 'test' }),
      mediaDir: join(dir, 'media'),
    });
    const job = await seam.executeHeadless({
      workspaceId: workspace.id,
      snapshot: {
        nodes: [textNode, videoNode],
        edges: [{ id: 'edge-a-b', source: 'node-a', target: 'node-b' }],
      },
      inputs: { 'node-a_content': 'https://www.tiktok.com/@new/video/1' },
      publishPlan: {
        groupId: 'group-1',
        workflows: [{ workflowId: 'wf_1', nodeIds: ['node-a', 'node-b'], entryNodeIds: ['node-a'], outputNodeIds: ['node-b'] }],
        inputs: [{ key: 'node-a_content', workflowId: 'wf_1', nodeId: 'node-a', capabilityId: 'text-editor', slotId: 'content', widget: 'textarea', required: true, label: '视频链接' }],
        outputs: [{ workflowId: 'wf_1', nodeId: 'node-b', capabilityId: 'video-extraction', outputType: 'video' }],
        graphHash: 'hash',
      },
    });
    let snapshot = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      snapshot = await manager.getSnapshot(job.executionId);
      if (['completed', 'error', 'cancelled'].includes(snapshot?.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(snapshot?.status, 'completed');
    assert.equal(snapshot?.nodeStates?.['node-a']?.status, 'completed');
    assert.equal(snapshot?.nodeStates?.['node-b']?.status, 'completed');
    assert.equal(snapshot?.nodeOutputs?.['node-a']?.text, 'https://www.tiktok.com/@new/video/1');
    const output = snapshot?.nodeOutputs?.['node-b'];
    assert.equal(output?.mediaAssets?.[0]?.type, 'video');
    assert.match(String(output?.mediaAssets?.[0]?.url ?? ''), /\.mp4$/);
  } finally {
    manager?.disposeAll?.();
    rmSync(dir, { recursive: true, force: true });
  }
});
