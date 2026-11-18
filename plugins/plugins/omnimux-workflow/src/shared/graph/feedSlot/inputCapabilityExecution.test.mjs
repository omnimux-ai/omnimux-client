/**
 * Epic #63 / Issue #62 — execution-side inputCapability wiring.
 *
 * `prepareExecutionSlotGraph` must pick the same operation as the panel and
 * hand the #55 normalizer only that operation's schema; the dispatched request
 * must never carry media the selected operation does not consume.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildModelCatalog } from '../../../../../omnimux/src/catalog/list.js';
import { projectCanvasCatalog } from '../../generationPolicy.ts';
import { prepareExecutionSlotGraph } from './prepareExecutionSlotGraph.ts';
import { recomputeCanvasSlots } from '../canvasSlotRecompute.ts';
import { planCanvasInputMutation } from '../canvasInputMutationGateway.ts';
import { createMaterialGatewayExecutor } from '../../../workflow/execution/materialGatewayExecutor.ts';
import { registerExecutor } from '../../../workflow/executors/registry.ts';

const bundled = JSON.parse(readFileSync(new URL('../../../../../omnimux/src/catalog/cloud/bundled/pricing.json', import.meta.url), 'utf8'));
const catalog = projectCanvasCatalog(buildModelCatalog({ env: {}, snapshot: bundled }));

const importNode = (id, type, extra = {}) => ({
  id,
  type: 'material',
  data: {
    materialType: type,
    nodeKind: 'import',
    mediaUrl: `https://example.test/${id}.${type === 'image' ? 'png' : type === 'audio' ? 'mp3' : 'mp4'}`,
    ...extra,
  },
});

const targetNode = (params) => ({
  id: 'target',
  type: 'material',
  data: {
    materialType: 'video',
    nodeKind: 'generate',
    selectedTool: 'video-generation',
    prompt: 'go',
    params,
  },
});

const edge = (source, extra = {}) => ({ id: `edge-${source}`, source, target: 'target', data: { feedType: 'image', ...extra } });

function gateway() {
  const requests = [];
  return {
    requests,
    capabilities: async () => catalog,
    submit: async (request) => { requests.push(request); return { taskId: 'captured' }; },
    awaitTask: async () => ({ type: 'video', url: 'https://example.test/out.mp4' }),
  };
}

async function dispatch(prepared, gw) {
  registerExecutor(createMaterialGatewayExecutor({ gateway: gw }));
  const { createDispatchingNodeExecutor } = await import('../../../workflow/execution/nodeExecutors.ts');
  const executor = createDispatchingNodeExecutor({
    gateway: gw,
    edges: prepared.edges,
    mediaRoot: '/tmp',
    executionId: 'input-capability',
    abortController: new AbortController(),
  });
  await executor.executor(prepared.nodes.find((node) => node.id === 'target'), {
    getNodeOutput: (id) => ({ mediaAssets: [{
      type: id === 'audio-1' ? 'audio' : 'image',
      url: `https://example.test/${id}.${id === 'audio-1' ? 'mp3' : 'png'}`,
      mimeType: id === 'audio-1' ? 'audio/mpeg' : 'image/png',
      sizeBytes: 1024,
    }] }),
    reportProgress() {},
    addMediaAsset() {},
  });
}

test('prepareExecutionSlotGraph derives first_frame from one image and normalizes adaptive', async () => {
  const nodes = [importNode('img-1', 'image'), targetNode({ model: 'muse-video', operation: 'text_to_video', aspectRatio: '9:16', duration: 5 })];
  const prepared = prepareExecutionSlotGraph(nodes, [edge('img-1')], catalog);
  const preparedTarget = prepared.nodes.find((node) => node.id === 'target');
  assert.equal(preparedTarget.data.params.operation, 'first_frame');
  assert.equal(preparedTarget.data.params.aspectRatio, 'adaptive');
  assert.equal(preparedTarget.data.params.duration, 5);
  assert.equal(preparedTarget.data.slotBindings.first_frame?.[0]?.sourceNodeId, 'img-1');

  const gw = gateway();
  await dispatch(prepared, gw);
  assert.equal(gw.requests.length, 1);
  assert.equal(gw.requests[0].operation, 'first_frame');
  assert.equal(gw.requests[0].aspectRatio, 'adaptive');
  assert.deepEqual(gw.requests[0].references?.map((reference) => reference.sourceNodeId), ['img-1']);
});

test('prepareExecutionSlotGraph derives first_last_frame from two images', async () => {
  const nodes = [importNode('img-1', 'image'), importNode('img-2', 'image'), targetNode({ model: 'seedance-2-5', operation: 'text_to_video' })];
  const prepared = prepareExecutionSlotGraph(nodes, [edge('img-1'), edge('img-2')], catalog);
  const preparedTarget = prepared.nodes.find((node) => node.id === 'target');
  assert.equal(preparedTarget.data.params.operation, 'first_last_frame');
  const gw = gateway();
  await dispatch(prepared, gw);
  assert.equal(gw.requests[0].operation, 'first_last_frame');
  assert.deepEqual(gw.requests[0].references?.map((reference) => reference.sourceNodeId), ['img-1', 'img-2']);
});

test('prepareExecutionSlotGraph falls back to text_to_video after every media edge is removed', async () => {
  const nodes = [targetNode({ model: 'muse-video', operation: 'first_frame', aspectRatio: 'adaptive', duration: 5 })];
  const prepared = prepareExecutionSlotGraph(nodes, [], catalog);
  const preparedTarget = prepared.nodes.find((node) => node.id === 'target');
  assert.equal(preparedTarget.data.params.operation, 'text_to_video');
  assert.equal(preparedTarget.data.params.aspectRatio, '16:9');
  assert.equal(preparedTarget.data.params.duration, 5);
  const gw = gateway();
  await dispatch(prepared, gw);
  assert.equal(gw.requests[0].operation, 'text_to_video');
  assert.equal(gw.requests[0].references, undefined);
});

test('standby media never enters the dispatched request', async () => {
  const node = targetNode({ model: 'muse-video', operation: 'text_to_video', aspectRatio: '9:16' });
  node.data.slotStandbyEdgeIds = ['edge-audio-1'];
  const nodes = [importNode('img-1', 'image'), importNode('audio-1', 'audio'), node];
  const prepared = prepareExecutionSlotGraph(nodes, [edge('img-1'), edge('audio-1', { feedType: 'audio' })], catalog);
  const preparedTarget = prepared.nodes.find((node) => node.id === 'target');
  assert.equal(preparedTarget.data.params.operation, 'first_frame');
  const gw = gateway();
  await dispatch(prepared, gw);
  assert.equal(gw.requests[0].operation, 'first_frame');
  assert.deepEqual(gw.requests[0].references?.map((reference) => reference.sourceNodeId), ['img-1']);
  assert.equal(gw.requests[0].audioTrack, undefined);
});

test('a second image connected after first_frame is bound to last_frame and switches to first_last_frame', () => {
  const target = targetNode({ model: 'seedance-2-5', operation: 'text_to_video' });
  target.data.inputBindingVersion = 1;
  target.data.slotBindings = {};
  const first = planCanvasInputMutation(
    { nodes: [importNode('img-1', 'image'), target], edges: [] },
    { addEdges: [{ source: 'img-1', target: 'target', sourceHandle: 'out', targetHandle: 'in' }] },
    { catalog },
  );
  assert.equal(first.status, 'allowed');
  const firstTarget = first.nodes.find((node) => node.id === 'target');
  assert.equal(firstTarget.data.params.operation, 'first_frame');
  assert.equal(firstTarget.data.slotBindings.first_frame?.[0]?.sourceNodeId, 'img-1');

  const second = planCanvasInputMutation(
    { nodes: [...first.nodes, importNode('img-2', 'image')], edges: first.edges },
    { addEdges: [{ source: 'img-2', target: 'target', sourceHandle: 'out', targetHandle: 'in' }] },
    { catalog },
  );
  assert.equal(second.status, 'allowed');
  const secondTarget = second.nodes.find((node) => node.id === 'target');
  assert.equal(secondTarget.data.params.operation, 'first_last_frame');
  assert.equal(secondTarget.data.slotBindings.first_frame?.[0]?.sourceNodeId, 'img-1');
  assert.equal(secondTarget.data.slotBindings.last_frame?.[0]?.sourceNodeId, 'img-2');
});


test('seedance-2-5: two images -> first_last_frame; add video -> video_multi_ref; remove video -> first_last_frame', () => {
  const target = targetNode({ model: 'seedance-2-5', operation: 'text_to_video' });
  target.data.inputBindingVersion = 1;
  target.data.slotBindings = {};
  const img1 = importNode('img-1', 'image');
  const img2 = importNode('img-2', 'image');
  const first = planCanvasInputMutation(
    { nodes: [img1, img2, target], edges: [] },
    { addEdges: [{ source: 'img-1', target: 'target' }, { source: 'img-2', target: 'target' }] },
    { catalog },
  );
  assert.equal(first.status, 'allowed');
  assert.equal(first.nodes.find((node) => node.id === 'target').data.params.operation, 'first_last_frame');
  assert.equal(first.nodes.find((node) => node.id === 'target').data.autoOperationId, 'first_last_frame');

  const video = importNode('video-1', 'video');
  const withVideo = planCanvasInputMutation(
    { nodes: [...first.nodes, video], edges: first.edges },
    { addEdges: [{ source: 'video-1', target: 'target' }] },
    { catalog },
  );
  assert.equal(withVideo.status, 'allowed');
  assert.equal(withVideo.nodes.find((node) => node.id === 'target').data.params.operation, 'video_multi_ref');
  assert.equal(withVideo.nodes.find((node) => node.id === 'target').data.autoOperationId, 'video_multi_ref');

  const withoutVideo = planCanvasInputMutation(
    { nodes: withVideo.nodes, edges: withVideo.edges },
    { removeEdgeIds: withVideo.edges.filter((edge) => edge.source === 'video-1').map((edge) => edge.id) },
    { catalog },
  );
  assert.equal(withoutVideo.status, 'allowed');
  assert.equal(withoutVideo.nodes.find((node) => node.id === 'target').data.params.operation, 'first_last_frame');
  assert.equal(withoutVideo.nodes.find((node) => node.id === 'target').data.autoOperationId, 'first_last_frame');
});

test('explicit video_multi_ref choice with two images survives video removal', () => {
  const target = targetNode({ model: 'seedance-2-5', operation: 'video_multi_ref' });
  target.data.inputBindingVersion = 1;
  target.data.autoOperationId = null;
  target.data.slotBindings = {};
  const nodes = [importNode('img-1', 'image'), importNode('img-2', 'image'), target];
  const edges = [edge('img-1'), edge('img-2')];
  const result = recomputeCanvasSlots(target, { nodes, edges }, { catalog });
  assert.equal(result.data.params.operation, 'video_multi_ref');
  assert.equal(result.data.autoOperationId, null);
});
