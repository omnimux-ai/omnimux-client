import { withFixturePricingDefaults } from '../../validation/compatTestCatalog.ts';
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
import { planCanvasInputMutation, planCanvasInputSelection } from '../canvasInputMutationGateway.ts';
import { findExecutionReadinessFailure } from '../../validation/executionReadiness.ts';
import { deriveSlotLayout } from './deriveSlotLayout.ts';
import { createMaterialGatewayExecutor } from '../../../workflow/execution/materialGatewayExecutor.ts';
import { registerExecutor } from '../../../workflow/executors/registry.ts';

const bundled = JSON.parse(readFileSync(new URL('../../../../../omnimux/src/catalog/cloud/bundled/pricing.json', import.meta.url), 'utf8'));
const catalog = projectCanvasCatalog(buildModelCatalog({ env: {}, snapshot: withFixturePricingDefaults(bundled, { 'muse-video': 'pool', 'seedance-2-5': 'seedance-2-5-720p' }) }));

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

function museCatalogWithReferenceCap(max) {
  return { ...catalog, models: catalog.models.map(model => model.id === 'muse-video' ? {
    ...model,
    operations: model.operations.map(operation => operation.id === 'video_multi_ref' ? {
      ...operation,
      inputs: operation.inputs.map(slot => slot.slot === 'reference_images' ? { ...slot, max } : slot),
    } : operation),
  } : model) };
}

test('Muse keeps an explicit ordered pair mode through missing inputs, swap, and execution reload', async () => {
  const contract = museCatalogWithReferenceCap(2);
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
  const context = { catalog: museCatalogWithReferenceCap(2) };
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

test('Muse keeps the start image through a ten-image selection, promotion and restart', async () => {
  const contract = museCatalogWithReferenceCap(10);
  const context = { catalog: contract };
  const images = Array.from({ length: 11 }, (_, index) => `img-${index + 1}`);
  const connected = images.slice(0, 10);
  const data = state => state.nodes.find(node => node.id === 'target').data;
  for (const inputBindingVersion of [undefined, 1]) {
    const target = targetNode({ model: 'muse-video', operation: 'first_frame', aspectRatio: 'adaptive', duration: 5 });
    target.data.inputBindingVersion = inputBindingVersion;
    target.data.autoOperationId = null;
    target.data.slotBindings = { first_frame: [{ sourceNodeId: 'img-10', edgeId: 'edge-img-10', role: 'first_frame', pinned: true }] };
    const graph = { nodes: [...images.map(id => importNode(id, 'image')), target], edges: connected.map(id => edge(id)) };
    const reopened = prepareExecutionSlotGraph(graph.nodes, graph.edges, contract);
    assert.equal(data(reopened).params.operation, 'first_frame');
    assert.deepEqual(data(reopened).slotBindings.first_frame.map(item => item.sourceNodeId), ['img-10']);
    const changeMode = (state, operation, aspectRatio) => planCanvasInputMutation(state, { nodePatches: [{
      nodeId: 'target', data: { params: { ...data(state).params, operation, aspectRatio }, autoOperationId: null },
    }] }, context);
    const multi = changeMode(reopened, 'video_multi_ref', '16:9');
    assert.equal(multi.status, 'allowed');
    assert.equal(findExecutionReadinessFailure([multi.nodes.at(-1)], contract, multi), null);
    const original = ['img-10', ...connected.slice(0, -1)];
    // Historical slots may contain colliding ordinals. A promotion must keep
    // the other images in place even when the legacy loader groups pinned ones.
    const slots = data(multi).slotBindings;
    const tied = planCanvasInputMutation(multi, { nodePatches: [{ nodeId: 'target', data: {
      slotBindings: { ...slots, reference_images: slots.reference_images.map(binding => ({ ...binding, ordinal: 0 })) },
    } }] }, context);
    assert.equal(tied.status, 'allowed');
    const swap = { orderedSlotSwap: {
      targetNodeId: 'target', slot: 'reference_images', firstEdgeId: 'edge-img-10', secondEdgeId: 'edge-img-8',
    } };
    const swapped = planCanvasInputMutation(tied, swap, context);
    assert.equal(swapped.status, 'allowed');
    assert.equal(planCanvasInputMutation(swapped, swap, context).reasonCode, 'input_changed');
    assert.deepEqual(swapped.edges.map(item => item.id), multi.edges.map(item => item.id));
    const saved = JSON.parse(JSON.stringify({ nodes: swapped.nodes, edges: swapped.edges }));
    const gw = gateway(contract);
    await dispatch(prepareExecutionSlotGraph(saved.nodes, saved.edges, contract), gw);
    const expected = original.map(item => item === 'img-10' ? 'img-8' : item === 'img-8' ? 'img-10' : item);
    assert.deepEqual(gw.requests[0].references.map(item => item.sourceNodeId), expected);

    if (inputBindingVersion === 1) {
      const overflow = planCanvasInputSelection(swapped, {
        targetNodeId: 'target', chosenOperationId: 'video_multi_ref',
        selections: [{ sourceNodeId: 'img-11', outputId: 'https://example.test/img-11.png', targetSlot: 'reference_images' }],
      }, context);
      assert.equal(overflow.status, 'rejected');
      assert.equal(overflow.reasonCode, 'slot_capacity');
      assert.equal(overflow.nodes, swapped.nodes);
    }
    const single = changeMode(swapped, 'first_frame', 'adaptive');
    assert.equal(single.status, 'allowed');
    assert.deepEqual(data(single).slotBindings.first_frame.map(item => item.sourceNodeId), ['img-8']);
  }
});

test('Muse V1 preserves disabled image choices across mode changes and permits explicit reactivation', async () => {
  const contract = museCatalogWithReferenceCap(10);
  const context = { catalog: contract };
  const slot = 'reference_images';
  const images = ['a', 'b', 'c', 'd'];
  const target = targetNode({ model: 'muse-video', operation: 'video_multi_ref', aspectRatio: '16:9', duration: 5 });
  Object.assign(target.data, { inputBindingVersion: 1, autoOperationId: null, slotStandbyEdgeIds: ['edge-d'],
    slotBindings: { reference_images: images.slice(0, 3).map((sourceNodeId, ordinal) => ({
      edgeId: `edge-${sourceNodeId}`, sourceNodeId, ordinal, pinned: true, role: 'reference',
    })) } });
  const graph = { nodes: [...images.map(id => importNode(id, 'image')), target], edges: images.map(id => edge(id)) };
  const data = state => state.nodes.find(node => node.id === 'target').data;
  const changeMode = (state, operation, aspectRatio) => planCanvasInputMutation(state, { nodePatches: [{
    nodeId: 'target', data: { params: { ...data(state).params, operation, aspectRatio }, autoOperationId: null },
  }] }, context);
  const intent = { targetNodeId: 'target', chosenOperationId: 'video_multi_ref' };
  const setUse = (state, edgeId, use) => planCanvasInputSelection(state, { ...intent, setUse: { slot, edgeId, use } }, context);
  const dispatchedReferences = async state => {
    const saved = JSON.parse(JSON.stringify({ nodes: state.nodes, edges: state.edges }));
    const gw = gateway(contract);
    await dispatch(prepareExecutionSlotGraph(saved.nodes, saved.edges, contract), gw);
    return gw.requests[0].references.map(item => item.sourceNodeId);
  };
  const paused = setUse(graph, 'edge-a', 'inactive');
  assert.equal(paused.status, 'allowed');
  const single = changeMode(paused, 'first_frame', 'adaptive');
  assert.equal(single.status, 'allowed');
  assert.deepEqual(await dispatchedReferences(single), ['b']);
  const multi = changeMode(single, 'video_multi_ref', '16:9');
  assert.equal(multi.status, 'allowed');
  assert.equal(data(multi).slotBindings.reference_images.find(item => item.edgeId === 'edge-a').use, 'inactive');
  assert.deepEqual(await dispatchedReferences(multi), ['b', 'c']);
  const reactivated = setUse(multi, 'edge-a', 'active');
  assert.equal(reactivated.status, 'allowed');
  const added = planCanvasInputSelection(reactivated, { ...intent,
    selections: [{ sourceNodeId: 'd', outputId: 'https://example.test/d.png', targetSlot: slot }],
  }, context);
  assert.equal(added.status, 'allowed');
  assert.deepEqual(await dispatchedReferences(added), ['b', 'c', 'a', 'd']);

  const allPaused = images.reduce((state, id) => setUse(state, `edge-${id}`, 'inactive'), added);
  const emptySingle = changeMode(allPaused, 'first_frame', 'adaptive');
  assert.equal(emptySingle.status, 'allowed');
  assert.ok(data(emptySingle).slotBindings.first_frame.every(item => item.use === 'inactive'));
  assert.equal(findExecutionReadinessFailure([emptySingle.nodes.at(-1)], contract, emptySingle)?.reasonCode, 'min_unsatisfied');
});
