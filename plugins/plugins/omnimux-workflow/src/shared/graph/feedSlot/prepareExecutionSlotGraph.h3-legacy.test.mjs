import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildModelCatalog } from '../../../../../omnimux/src/catalog/list.js';
import { findExecutionReadinessFailure } from '../../validation/executionReadiness.ts';
import { prepareExecutionSlotGraph } from './prepareExecutionSlotGraph.ts';
import { deriveSlotLayout } from './deriveSlotLayout.ts';
import { createOmnimuxSeamClient } from '../../../workflow/seam/omnimuxGateway.ts';
import { prepareExecutionAdmission } from '../../../workflow/execution/prepareExecutionAdmission.ts';
import { buildInitialOutputs } from '../../../workflow/execution/executionInputs.ts';
import { createMaterialGatewayExecutor } from '../../../workflow/execution/materialGatewayExecutor.ts';
import { readNodeInputSource } from '../nodeInputSource.ts';
import { reconcileCanvasForCatalog } from '../catalogReconcile.ts';
import { planCanvasInputMutation } from '../canvasInputMutationGateway.ts';

const snapshot = JSON.parse(readFileSync(new URL('../../../../../omnimux/src/catalog/cloud/bundled/pricing.json', import.meta.url), 'utf8'));
const historical = buildModelCatalog({ snapshot, gatewayContracts: false, env: {} });
const current = buildModelCatalog({ snapshot, env: {} });
const modelId = 'minimax-h3-video';
const operationId = 'digital_human';
const h3Inputs = (catalog) => catalog.models.find(model => model.id === modelId)
  .operations.find(operation => operation.id === operationId).inputs;

function savedGraph(versioned) {
  const importNode = (id, materialType, extension) => ({
    id, type: 'material', data: {
      nodeKind: 'import', materialType, mediaUrl: `https://fixture.example/${id}.${extension}`,
      mimeType: `${materialType}/${extension}`, sizeBytes: 64,
    },
  });
  const sources = [
    importNode('unused-image', 'image', 'png'), importNode('unused-audio', 'audio', 'wav'),
    importNode('portrait', 'image', 'png'), importNode('voice', 'audio', 'wav'),
  ];
  const historicalInputs = h3Inputs(historical);
  assert.deepEqual(historicalInputs.map(input => [input.slot, input.role]),
    [['character', 'first_frame'], ['driving_audio', 'audio_track']]);
  const bindings = Object.fromEntries(historicalInputs.map(input => {
    const source = sources.find(node => !node.id.startsWith('unused-') && node.data.materialType === input.type);
    return [input.slot, [{ edgeId: `edge-${source.id}`, sourceNodeId: source.id, outputId: `saved-${source.id}`,
      role: input.role, pinned: true, use: 'active', ordinal: 0 }]];
  }));
  const target = {
    id: 'h3', type: 'material',
    data: {
      nodeKind: 'generate', materialType: 'video', prompt: '',
      params: { model: modelId, operation: operationId },
      ...(versioned ? { inputBindingVersion: 1, slotBindings: bindings } : {}),
    },
  };
  const edges = sources.map(source => {
    const media = historicalInputs.find(input => input.type === source.data.materialType);
    return {
      id: `edge-${source.id}`, source: source.id, target: 'h3', targetHandle: 'in',
      data: source.id.startsWith('unused-') ? {} : versioned
        ? { slotBinding: { slot: media.slot, role: media.role, mirror: true } }
        : { targetSlot: media.slot, role: media.role },
    };
  });
  // The pre-overlay catalog and saved graph use their actual historical shapes.
  return JSON.parse(JSON.stringify({ nodes: [...sources, target], edges }));
}

async function checkSavedGraph(t, versioned) {
    const saved = savedGraph(versioned);
    const before = structuredClone(saved);
    const oldGraph = prepareExecutionSlotGraph(saved.nodes, saved.edges, historical);
    assert.equal(findExecutionReadinessFailure([oldGraph.nodes.at(-1)], historical, oldGraph), null);

    const graph = prepareExecutionSlotGraph(saved.nodes, saved.edges, current);
    const target = graph.nodes.at(-1);
    assert.equal(findExecutionReadinessFailure([target], current, graph), null);
    assert.equal(target.data.params.operation, operationId);
    if (versioned) {
      assert.deepEqual(target.data.slotBindings.reference_image, [{ ...saved.nodes.at(-1).data.slotBindings.character[0], role: 'reference' }]);
      assert.deepEqual(target.data.slotBindings.reference_audio, [{ ...saved.nodes.at(-1).data.slotBindings.driving_audio[0], role: 'reference' }]);
    }
    const requests = [];
    const unexpectedFetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected HTTP in the saved graph fixture'); });
    const executor = createMaterialGatewayExecutor({ gateway: {
      capabilities: async () => current,
      submit: async (request) => { requests.push(request); return { taskId: 'fixture-h3' }; },
      awaitTask: async () => ({ type: 'video', url: 'https://fixture.example/result.mp4' }),
    } });
    await executor.execute(target, {
      upstreamBindings: graph.edges.map(edge => ({
        edgeId: edge.id, sourceNodeId: edge.source,
        output: readNodeInputSource(graph.nodes.find(node => node.id === edge.source)).output,
      })),
      upstreamOutputs: new Map(), mediaDir: '/tmp', signal: new AbortController().signal,
    });
    assert.deepEqual(requests[0].references.map(({ edgeId, sourceNodeId, targetSlot }) => [edgeId, sourceNodeId, targetSlot]),
      [['edge-portrait', 'portrait', 'reference_image'], ['edge-voice', 'voice', 'reference_audio']]);
    assert.equal(unexpectedFetch.mock.callCount(), 0);
    assert.deepEqual(graph.edges.map(({ id, source, target }) => [id, source, target]),
      saved.edges.map(({ id, source, target }) => [id, source, target]));
    assert.deepEqual(saved, before);
}
test('saved H3 versioned bindings run against the current catalog without editing the graph', t => checkSavedGraph(t, true));
test('saved H3 legacy edge hints run against the current catalog without editing the graph', t => checkSavedGraph(t, false));

function checkCanvasLoad(versioned) {
  const saved = savedGraph(versioned);
  const before = structuredClone(saved);
  const loaded = reconcileCanvasForCatalog({ ...saved, catalog: current });
  const data = loaded.nodes.at(-1).data;
  assert.deepEqual(data.slotConflicts, []);
  assert.deepEqual(data.slotBindings.reference_image.map(item => item.sourceNodeId), ['portrait']);
  assert.deepEqual(data.slotBindings.reference_audio.map(item => item.sourceNodeId), ['voice']);
  assert.equal(data.compat.readyToSubmit, true);
  const prepared = prepareExecutionSlotGraph(loaded.nodes, loaded.edges, current);
  assert.equal(findExecutionReadinessFailure([prepared.nodes.at(-1)], current, prepared), null);
  assert.deepEqual(saved, before);
}

test('opening an H3 canvas with only old edge hints displays the chosen portrait and voice', () => checkCanvasLoad(false));
test('opening an H3 canvas with old pinned bindings keeps its chosen sources over earlier alternatives', () => checkCanvasLoad(true));

function roundTripLegacyMode(saved, whileText) {
  let graph = reconcileCanvasForCatalog({ ...saved, catalog: current });
  function mutate(mutation) {
    const plan = planCanvasInputMutation(graph, mutation, { catalog: current });
    assert.equal(plan.status, 'allowed');
    graph = { nodes: plan.nodes, edges: plan.edges };
    return graph.nodes.at(-1);
  }
  function patch(data) { return mutate({ nodePatches: [{ nodeId: 'h3', data }] }); }
  const text = patch({ params: { model: modelId, operation: 'text_to_video' }, autoOperationId: null });
  assert.equal(text.data.params.operation, 'text_to_video');
  patch({ prompt: 'edited text draft' });
  if (whileText) mutate(whileText);
  const target = patch({ params: { model: modelId, operation: operationId }, autoOperationId: null });
  assert.equal(target.data.prompt, 'edited text draft');
  assert.equal(target.data.params.operation, operationId);
  return prepareExecutionSlotGraph(graph.nodes, graph.edges, current);
}

test('returning an edge-only H3 canvas to lip sync sends the previously chosen portrait and voice', () => {
  const prepared = roundTripLegacyMode(savedGraph(false));
  const data = prepared.nodes.at(-1).data;
  assert.deepEqual(data.slotBindings.reference_image.map(item => item.sourceNodeId), ['portrait']);
  assert.deepEqual(data.slotBindings.reference_audio.map(item => item.sourceNodeId), ['voice']);
  assert.equal(findExecutionReadinessFailure([prepared.nodes.at(-1)], current, prepared), null);
});

test('returning to lip sync keeps a cleared voice empty with an unselected alternative connected', () => {
  const saved = savedGraph(false);
  saved.nodes.at(-1).data.slotBindings = {};
  const prepared = roundTripLegacyMode(saved);
  const target = prepared.nodes.at(-1);
  assert.deepEqual(target.data.slotBindings.reference_audio ?? [], []);
  assert.notEqual(findExecutionReadinessFailure([target], current, prepared), null);
});

test('returning to lip sync after disconnecting the chosen voice leaves the missing slot visible', () => {
  const saved = savedGraph(false);
  saved.nodes.at(-1).data.slotStandbyEdgeIds = ['edge-unused-audio'];
  const prepared = roundTripLegacyMode(saved, { removeEdgeIds: ['edge-voice'] });
  const target = prepared.nodes.at(-1);
  assert.deepEqual(target.data.slotBindings.reference_audio ?? [], []);
  assert.deepEqual(target.data.slotStandbyEdgeIds, ['edge-unused-audio']);
  assert.equal(findExecutionReadinessFailure([target], current, prepared)?.slot, 'reference_audio');
});

test('opening or submitting old H3 edges keeps a voice put on standby out of the two slots', () => {
  const saved = savedGraph(false);
  saved.edges = saved.edges.filter(edge => !edge.source.startsWith('unused-'));
  saved.nodes.at(-1).data.slotStandbyEdgeIds = ['edge-voice'];
  const loaded = reconcileCanvasForCatalog({ ...saved, catalog: current });
  assert.deepEqual(loaded.nodes.at(-1).data.slotBindings.reference_audio, []);
  assert.equal(loaded.nodes.at(-1).data.compat.readyToSubmit, false);
  const prepared = prepareExecutionSlotGraph(saved.nodes, saved.edges, current);
  assert.deepEqual(prepared.nodes.at(-1).data.slotBindings.reference_audio, []);
  assert.equal(findExecutionReadinessFailure([prepared.nodes.at(-1)], current, prepared)?.reasonCode, 'min_unsatisfied');
});

test('a deliberately cleared current audio slot on an old H3 canvas stays empty on open', () => {
  const saved = savedGraph(true);
  saved.nodes.at(-1).data.slotBindings.reference_audio = [];
  const loaded = reconcileCanvasForCatalog({ ...saved, catalog: current });
  const data = loaded.nodes.at(-1).data;
  assert.equal(data.slotBindings.reference_audio?.length ?? 0, 0);
  const prepared = prepareExecutionSlotGraph(loaded.nodes, loaded.edges, current);
  assert.notEqual(findExecutionReadinessFailure([prepared.nodes.at(-1)], current, prepared), null);
});

test('H3 compatibility does not rebind inactive, intentionally empty, or unrelated saved intent', () => {
  const saved = savedGraph(true);
  const data = saved.nodes.at(-1).data;
  data.slotBindings.character[0].use = 'inactive';
  data.slotBindings.reference_audio = [];
  data.slotBindings.custom_portrait = [{ edgeId: 'edge-unused-image', sourceNodeId: 'unused-image', use: 'inactive', pinned: true }];
  const before = structuredClone(saved);
  const graph = prepareExecutionSlotGraph(saved.nodes, saved.edges, current);
  const target = graph.nodes.at(-1);
  assert.deepEqual(target.data.slotBindings.reference_image, [{ ...data.slotBindings.character[0], role: 'reference' }]);
  assert.deepEqual(target.data.slotBindings.reference_audio, data.slotBindings.reference_audio);
  assert.deepEqual(target.data.slotBindings.driving_audio, data.slotBindings.driving_audio);
  assert.deepEqual(target.data.slotBindings.custom_portrait, data.slotBindings.custom_portrait);
  assert.notEqual(findExecutionReadinessFailure([target], current, graph), null);
  assert.deepEqual(saved, before);
});

test('legacy H3 binding with a mismatched edge and source stays blocked', () => {
  const saved = savedGraph(true);
  saved.edges.find(edge => edge.id === 'edge-portrait').source = 'unused-image';
  const before = structuredClone(saved);
  const graph = prepareExecutionSlotGraph(saved.nodes, saved.edges, current);
  const target = graph.nodes.at(-1);
  assert.equal(target.data.slotBindings.reference_image[0].sourceNodeId, 'portrait');
  assert.equal(findExecutionReadinessFailure([target], current, graph)?.reasonCode, 'input_unavailable');
  assert.deepEqual(saved, before);
});

test('H3 uses the selected gateway operation for prompt consumption and keeps the two named wells', () => {
  const layout = deriveSlotLayout(current, modelId, operationId);
  assert.equal(layout.acceptsText, false);
  assert.deepEqual(layout.slots.map(slot => [slot.slot, slot.labelKey]),
    [['reference_image', 'panel.slot.character'], ['reference_audio', 'panel.slot.driving_audio']]);
  assert.deepEqual(layout.implementationGaps, []);
  assert.equal(deriveSlotLayout(current, modelId, 'text_to_video').acceptsText, true);
  assert.equal(deriveSlotLayout(current, modelId, 'video_multi_ref').acceptsText, true);
  assert.equal(deriveSlotLayout(historical, modelId, operationId).acceptsText, true);
});

test('H3 dispatch keeps the editable draft and upstream text out of a media-only request', async t => {
  const saved = savedGraph(true);
  saved.nodes.at(-1).data.prompt = 'local editable draft';
  saved.nodes.at(-1).data.params.duration = 4;
  const graph = prepareExecutionSlotGraph(saved.nodes, saved.edges, current);
  const target = graph.nodes.at(-1);
  const received = [];
  const gateway = createOmnimuxSeamClient({ getSeam: name => name === 'modelCatalog'
    ? { list: () => current } : name === 'videoGenerate'
      ? { execute: async req => {
          received.push(req);
          return { mode: 'live', type: 'video', url: 'https://fixture.example/result.mp4', mimeType: 'video/mp4', durationSec: 3 };
        } }
      : undefined });
  const executor = createMaterialGatewayExecutor({ gateway });
  t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected fetch'); });
  await executor.execute(target, { upstreamBindings: [
    ...graph.edges.map(edge => ({ edgeId: edge.id, sourceNodeId: edge.source,
      output: readNodeInputSource(graph.nodes.find(node => node.id === edge.source)).output })),
    { edgeId: 'text', sourceNodeId: 'text', output: { text: 'unconsumed upstream text' } },
    { edgeId: 'document', sourceNodeId: 'document', output: {
      text: 'unconsumed upstream text', documentText: JSON.stringify({ duration: 11 }),
      mediaAssets: [{ type: 'document', url: 'https://fixture.example/parameters.json' }],
    } },
  ], upstreamOutputs: new Map(), mediaDir: '/tmp', signal: new AbortController().signal });
  assert.equal(received.length, 1);
  assert.equal(received[0].operation, operationId);
  assert.deepEqual(received[0].references.map(ref => [ref.sourceNodeId, ref.targetSlot]),
    [['portrait', 'reference_image'], ['voice', 'reference_audio']]);
  assert.equal(Object.hasOwn(received[0], 'prompt'), false);
  assert.equal(received[0].duration, 4);
  assert.doesNotMatch(JSON.stringify(received[0]), /local editable draft|unconsumed upstream text/);
  assert.equal(target.data.prompt, saved.nodes.at(-1).data.prompt);
});

test('a missing unconsumed JSON file cannot block lip sync but remains required when used by text-to-video', async () => {
  const graph = savedGraph(true);
  const target = graph.nodes.at(-1);
  const document = { id: 'document', type: 'material', data: {
    nodeKind: 'import', materialType: 'document', relativePath: 'story.json',
    documentText: JSON.stringify({ prompt: 'cached text', duration: 11 }),
  } };
  graph.nodes.unshift(document);
  graph.edges.push({ id: 'document-edge', source: document.id, target: target.id });
  const snapshot = { id: 'ws_h3', version: 1, settings: {}, ...graph };
  let fileReads = 0;
  const readSources = async () => {
    const selected = { nodes: [target], edges: snapshot.edges, nodeIdSet: new Set([target.id]) };
    const admission = await prepareExecutionAdmission(snapshot.id, snapshot, selected, 'single', {}, () => current);
    assert.equal(admission.readiness, null);
    return buildInitialOutputs(admission.sourceGraph, selected.nodeIdSet, {
      mediaDir: '/tmp', resolveProjectFile() { fileReads++; throw new Error('JSON file unavailable'); },
    });
  };
  assert.deepEqual(Object.keys(await readSources()).sort(), ['portrait', 'voice']);
  assert.equal(fileReads, 0);

  target.data.params.operation = 'text_to_video';
  target.data.prompt = 'video scene';
  target.data.slotBindings = {};
  snapshot.edges = snapshot.edges.filter(edge => edge.source === document.id);
  await assert.rejects(readSources(), /JSON file unavailable/);
  assert.equal(fileReads, 1);
});
