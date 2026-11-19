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
import { findExecutionReadinessFailure } from '../../validation/executionReadiness.ts';
import { deriveSlotLayout } from './deriveSlotLayout.ts';
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

function gateway(capabilities = catalog) {
  const requests = [];
  return {
    requests,
    capabilities: async () => capabilities,
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

// The bundled floor predates gateway #54, so overlay its ordered pair input.
const museOrderedCatalog = { ...catalog, models: catalog.models.map(model => model.id === 'muse-video' ? {
  ...model,
  operations: [...model.operations, {
    ...model.operations.find(operation => operation.id === 'text_to_video'),
    id: 'video_multi_ref',
    inputs: [
      ...model.operations.find(operation => operation.id === 'text_to_video').inputs,
      { slot: 'reference_images', type: 'image', role: 'reference', firstItemRole: 'first_frame', source: 'upstream_edge', min: 2, max: 2 },
    ],
  }],
} : model) };

test('Muse keeps an explicit ordered pair mode through missing inputs, swap, and execution reload', async () => {
  const contract = museOrderedCatalog;
  const context = { catalog: contract };
  const target = targetNode({ model: 'muse-video', operation: 'first_frame', aspectRatio: 'adaptive', duration: 5 });
  target.data.autoOperationId = null;
  target.data.slotBindings = { first_frame: [{ sourceNodeId: 'img-1', edgeId: 'edge-img-1', pinned: false }] };
  const findTarget = (snapshot) => snapshot.nodes.find(node => node.id === 'target');
  const original = { nodes: [importNode('img-1', 'image'), importNode('img-2', 'image'), target], edges: [edge('img-1'), edge('img-2')] };
  const legacy = findTarget(prepareExecutionSlotGraph(original.nodes, original.edges, contract));
  assert.equal(legacy.data.params.operation, 'first_frame');
  assert.deepEqual(legacy.data.slotBindings.first_frame.map(({ edgeId }) => edgeId), ['edge-img-1']);
  target.data.inputBindingVersion = 1;

  const plan = planCanvasInputMutation(original, { nodePatches: [{ nodeId: 'target', data: {
    params: { ...target.data.params, operation: 'video_multi_ref', aspectRatio: '16:9' }, autoOperationId: null,
  } }] }, context);
  assert.equal(plan.status, 'allowed');
  assert.equal(findTarget(plan).data.params.operation, 'video_multi_ref');
  assert.equal(deriveSlotLayout(contract, 'muse-video', 'video_multi_ref').slots.find(slot => slot.slot === 'reference_images').firstItemRole, 'first_frame');

  const missingSecond = planCanvasInputMutation(plan, { removeEdgeIds: ['edge-img-2'] }, context);
  assert.equal(missingSecond.status, 'allowed');
  const incomplete = prepareExecutionSlotGraph(missingSecond.nodes, missingSecond.edges, contract);
  assert.equal(findTarget(incomplete).data.params.operation, 'video_multi_ref');
  assert.equal(findExecutionReadinessFailure([findTarget(incomplete)], contract, incomplete)?.reasonCode, 'min_unsatisfied');

  const restored = planCanvasInputMutation(missingSecond, { addEdges: [edge('img-2')] }, context);
  assert.equal(restored.status, 'allowed');
  assert.equal(findExecutionReadinessFailure([findTarget(restored)], contract, restored), null);
  const mutation = { orderedSlotSwap: {
    targetNodeId: 'target', slot: 'reference_images', firstEdgeId: 'edge-img-1', secondEdgeId: 'edge-img-2',
  } };
  const swapped = planCanvasInputMutation(restored, mutation, context);
  assert.equal(swapped.status, 'allowed');
  assert.equal(planCanvasInputMutation(swapped, mutation, context).reasonCode, 'input_changed');
  const reopened = JSON.parse(JSON.stringify(swapped));
  const prepared = prepareExecutionSlotGraph(reopened.nodes, reopened.edges, contract);
  const gw = gateway(contract);
  await dispatch(prepared, gw);
  assert.equal(gw.requests[0].operation, 'video_multi_ref');
  assert.deepEqual(gw.requests[0].references?.map(({ sourceNodeId, role }) => [sourceNodeId, role]), [
    ['img-2', 'reference'], ['img-1', 'reference'],
  ]);
});

test('Muse legacy mode changes carry the chosen start image between single and ordered pair slots', () => {
  const context = { catalog: museOrderedCatalog };
  const target = targetNode({ model: 'muse-video', operation: 'first_frame', aspectRatio: 'adaptive', duration: 5 });
  target.data.autoOperationId = null;
  target.data.slotBindings = { first_frame: [{ sourceNodeId: 'img-1', edgeId: 'edge-img-1', role: 'first_frame', pinned: true }] };
  const graph = { nodes: [importNode('img-1', 'image'), importNode('img-2', 'image'), target], edges: [edge('img-2'), edge('img-1')] };
  const data = state => state.nodes.find(node => node.id === 'target').data;
  const changeMode = (state, operation, aspectRatio) => planCanvasInputMutation(state, { nodePatches: [{
    nodeId: 'target', data: { params: { ...data(state).params, operation, aspectRatio }, autoOperationId: null },
  }] }, context);

  const dual = changeMode(graph, 'video_multi_ref', '16:9');
  assert.equal(dual.status, 'allowed');
  assert.equal(data(dual).inputBindingVersion, undefined);
  assert.deepEqual(data(dual).slotBindings.reference_images.map(item => item.sourceNodeId), ['img-1', 'img-2']);
  assert.deepEqual(data(dual).slotConflicts, []);
  const swapped = planCanvasInputMutation(dual, { orderedSlotSwap: {
    targetNodeId: 'target', slot: 'reference_images', firstEdgeId: 'edge-img-1', secondEdgeId: 'edge-img-2',
  } }, context);
  assert.equal(swapped.status, 'allowed');

  const single = changeMode(swapped, 'first_frame', 'adaptive');
  assert.equal(single.status, 'allowed');
  assert.equal(data(single).params.operation, 'first_frame');
  assert.equal(data(single).inputBindingVersion, undefined);
  assert.deepEqual(data(single).slotBindings.first_frame.map(item => item.sourceNodeId), ['img-2']);
  assert.deepEqual(data(single).slotConflicts, []);
});
