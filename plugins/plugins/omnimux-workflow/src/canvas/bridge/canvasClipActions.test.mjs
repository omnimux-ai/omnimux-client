import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureCanvasMediaReturn, installCanvasClipEvents, openCanvasClipNode } from './canvasClipActions.ts';
import { OMNIMUX_CLIP_CLOSE, OMNIMUX_CLIP_OPEN, OMNIMUX_CLIP_PROGRESS, OMNIMUX_CLIP_SAVE } from './clipEvents.ts';
import { planCanvasInputMutation } from '../../shared/graph/canvasInputMutationGateway.ts';

const binding = { workspaceId: 'ws_a', nodeId: 'clip-a', projectId: 'clip_node_a' };
const node = (id, type, data) => ({ id, type, position: { x: 0, y: 0 }, data });

function graphFixture() {
  let graph = {
    nodes: [
      node(binding.nodeId, 'video_composition', { title: '剪辑 A', projectId: binding.projectId, draftRevision: 2, schema: { tracks: ['old'] } }),
      node('clip-b', 'video_composition', { projectId: 'clip_node_b' }),
      node('video', 'video_composition', { outputVideoUrl: '/video.mp4', outputRevision: 'content-v3', outputDurationMs: 1570 }),
      node('audio', 'material', { materialType: 'audio', mediaUrl: '/audio.mp3', taskId: 'generated-audio-2', duration: 4.5 }),
      node('image', 'material', { materialType: 'image', mediaUrl: '/image.png' }),
      node('caption', 'material', { materialType: 'text', content: '1\n00:00:00,500 --> 00:00:01,700\nCaption', contentFormat: 'srt' }),
    ],
    edges: ['video', 'audio', 'image', 'caption'].map(id => ({ id: `edge-${id}`, source: id, target: binding.nodeId })),
  };
  const target = new EventTarget();
  const readGraph = () => graph;
  const updateNode = (id, data) => {
    graph = { ...graph, nodes: graph.nodes.map(item => item.id === id ? { ...item, data: { ...item.data, ...data } } : item) };
  };
  let exportNotifications = 0;
  const args = {
    readGraph, updateNode, target, workspaceId: binding.workspaceId, defaultTitle: 'Clip',
    applyMutation(mutation) {
      const plan = planCanvasInputMutation(graph, mutation);
      assert.equal(plan.status, 'allowed');
      graph = { nodes: plan.nodes, edges: plan.edges };
    },
    onManualExport() { exportNotifications += 1; },
  };
  const data = id => graph.nodes.find(item => item.id === (id ?? binding.nodeId)).data;
  return { args, target, data, get exportNotifications() { return exportNotifications; } };
}

test('opening an exact canvas binding emits the original OPEN with legacy draft and versioned upstream inputs', async () => {
  const h = graphFixture();
  const requests = [];
  h.target.addEventListener(OMNIMUX_CLIP_OPEN, (event) => requests.push(event.detail));
  const opened = await openCanvasClipNode({ ...h.args, nodeId: binding.nodeId, expectedProjectId: binding.projectId,
    stillCurrent: () => true, ensurePersisted: async candidate => assert.deepEqual(candidate, binding) });
  assert.deepEqual(opened, binding);
  assert.equal(h.data().status, 'editing');
  assert.deepEqual(requests, [{
    ...binding, source: 'canvas', nodeTitle: '剪辑 A', draftSchema: { tracks: ['old'] }, draftRevision: 2,
    upstreamInputs: {
      videos: [{ path: '/video.mp4', url: '/video.mp4', name: 'video', durationMs: 1570, sourceId: 'video', sourceVersion: 'content-v3' }],
      audios: [{ path: '/audio.mp3', url: '/audio.mp3', name: 'audio', durationMs: 4500, sourceId: 'audio', sourceVersion: 'generated-audio-2' }],
      images: [{ path: '/image.png', url: '/image.png', name: 'image', displayDurationMs: 3000, sourceId: 'image' }],
      captions: [{ text: 'Caption', startTimeMs: 500, durationMs: 1200 }],
    },
  }]);
});

test('first open persists one generated ID and blocks an OPEN after a scope switch or rebind', async () => {
  const h = graphFixture();
  const requests = [];
  h.target.addEventListener(OMNIMUX_CLIP_OPEN, (event) => requests.push(event.detail));
  h.args.updateNode(binding.nodeId, { projectId: undefined });
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  let current = true;
  const args = { ...h.args, nodeId: binding.nodeId, stillCurrent: () => current };
  const pending = openCanvasClipNode({ ...args, ensurePersisted: async latest => {
    assert.match(latest.projectId, /^clip_node_/);
    assert.equal(h.data().projectId, latest.projectId);
    assert.equal(requests.length, 0);
    await waiting;
  } });
  const projectId = h.data().projectId;
  current = false;
  release();
  assert.equal(await pending, undefined);
  assert.deepEqual(requests, []);
  current = true;
  assert.equal(await openCanvasClipNode({ ...args, expectedProjectId: binding.projectId }), undefined);
  assert.equal((await openCanvasClipNode(args)).projectId, projectId);
  assert.equal(requests.length, 1);
});

test('a Canvas return preserves the usual OPEN inputs and appends only a changed connected file', async () => {
  const h = graphFixture();
  const path = (digest) => `/omnimux-workflow/api/workspaces/${binding.workspaceId}/file?rel=artifacts%2Fvoice.wav&rev=sha256%3A${digest}`;
  const first = 'a'.repeat(64);
  const second = 'b'.repeat(64);
  h.args.updateNode('audio', { mediaUrl: path(first) });
  const baseline = captureCanvasMediaReturn(h.args.readGraph(), binding);
  assert.equal(baseline.size, 1);
  h.args.updateNode('audio', { mediaUrl: path(second) });
  const requests = [];
  h.target.addEventListener(OMNIMUX_CLIP_OPEN, event => requests.push(event.detail));
  let persisted = false;
  const result = await openCanvasClipNode({ ...h.args, nodeId: binding.nodeId, expectedProjectId: binding.projectId,
    stillCurrent: () => true, ensurePersisted: async () => { persisted = true; },
    mediaReturn: { requestId: 'return-audio', baseline, canOpen: () => true, confirmOpened: async confirmed => {
      assert.equal(persisted, true);
      assert.equal(requests.length, 1);
      assert.deepEqual(confirmed, binding);
      return true;
    } },
  });
  assert.deepEqual(result, binding);
  const [reopened] = requests;
  assert.deepEqual(reopened.draftSchema, { tracks: ['old'] });
  assert.equal(reopened.upstreamInputs.videos.length, 1);
  assert.equal(reopened.upstreamInputs.captions.length, 1);
  assert.deepEqual(reopened.mediaReturn, { requestId: 'return-audio', upstreamInputs: { videos: [], images: [], audios: [
    { path: path(second), url: path(second), name: 'audio', sourceId: 'audio', sourceVersion: `sha256:${second}`, durationMs: 4500 },
  ] } });
  assert.equal(h.data().status, 'editing');
});

test('manual SAVE/PROGRESS/CLOSE remain scoped to the mounted graph even without a node component', () => {
  const h = graphFixture();
  const stop = installCanvasClipEvents(h.args);
  const emit = (event, detail = binding) => h.target.dispatchEvent(new CustomEvent(event, { detail }));
  emit(OMNIMUX_CLIP_PROGRESS, { ...binding, renderProgress: 20 });
  assert.equal(h.data().status, 'rendering');
  emit(OMNIMUX_CLIP_CLOSE, { ...binding, workspaceId: 'ws_other' });
  assert.equal(h.data().status, 'rendering');
  emit(OMNIMUX_CLIP_CLOSE);
  assert.equal(h.data().status, 'idle');
  const output = { videoPath: '/exports/manual.mp4', revision: '10:20', durationMs: 1200 };
  emit(OMNIMUX_CLIP_SAVE, { ...binding, output, createDownstreamNode: true });
  const exported = h.args.readGraph().nodes.at(-1);
  assert.equal(h.data().status, 'completed');
  assert.equal(h.data().outputRevision, output.revision);
  assert.equal(h.data().outputVideoUrl, exported.data.mediaUrl);
  assert.equal(h.args.readGraph().edges.at(-1).target, exported.id);
  assert.equal(h.exportNotifications, 1);
  emit(OMNIMUX_CLIP_SAVE, { ...binding, schema: { tracks: ['manual draft save'] } });
  assert.equal(h.data().outputRevision, output.revision);
  assert.equal(h.data().draftRevision, 2);
  assert.deepEqual(h.data().schema, { tracks: ['manual draft save'] });
  stop();
  emit(OMNIMUX_CLIP_PROGRESS);
  assert.equal(h.data().status, 'completed');
  assert.equal(h.data('clip-b').status, undefined);
});
