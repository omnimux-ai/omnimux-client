import { withFixturePricingDefaults } from './compatTestCatalog.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildModelCatalog } from '../../../../omnimux/src/catalog/list.js';
import { prepareExecutionSlotGraph } from '../graph/feedSlot/prepareExecutionSlotGraph.ts';
import { buildInputCapability } from './inputCapability.ts';
import { buildUiUpstreamFingerprint } from './operationUi.ts';
import { findExecutionReadinessFailure } from './executionReadiness.ts';
import { resolveEffectiveVideoParams } from '../../canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamAdapter.ts';
import { buildVideoParameterSelection } from '../../canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParameterSelection.ts';
import { planCanvasInputMutation } from '../graph/canvasInputMutationGateway.ts';

const snapshot = JSON.parse(readFileSync(new URL('../../../../omnimux/src/catalog/cloud/bundled/pricing.json', import.meta.url)));
const catalog = buildModelCatalog({ snapshot: withFixturePricingDefaults(snapshot, { 'minimax-h3-video': 'default' }), env: {} });
const model = 'minimax-h3-video';
const modelItem = catalog.video.find(item => item.id === model);
const draft = 'Keep this text for my next scene';
const image = { id: 'image', type: 'material', data: { materialType: 'image', nodeKind: 'import', mediaUrl: 'https://example.test/img.png' } };
const audio = { id: 'audio', type: 'material', data: { materialType: 'audio', nodeKind: 'import', mediaUrl: 'https://example.test/voice.wav' } };
function checkLip(sources, standby = [], operation = 'digital_human') {
  const bindings = Object.fromEntries(sources.map(source => [`reference_${source.id}`,
    [{ edgeId: source.id, sourceNodeId: source.id, use: standby.includes(source.id) ? 'inactive' : 'active', role: 'reference', pinned: true }]]));
  const target = { id: 'target', type: 'material', data: { nodeKind: 'generate', materialType: 'video',
    prompt: draft, params: { model, operation }, autoOperationId: null,
    inputBindingVersion: 1, slotBindings: bindings, slotStandbyEdgeIds: standby } };
  const graph = prepareExecutionSlotGraph([...sources, target],
    sources.map(source => ({ id: source.id, source: source.id, target: target.id })), catalog);
  const selected = graph.nodes.at(-1);
  assert.equal(selected.data.params.operation, operation);
  return findExecutionReadinessFailure([selected], catalog, graph);
}

test('official lip sync remains selected while the image or driving audio is still missing', () => {
  assert.equal(checkLip([])?.slot, 'reference_image');
  assert.equal(checkLip([image])?.slot, 'reference_audio');
  assert.equal(checkLip([audio])?.slot, 'reference_image');
  assert.equal(checkLip([image, audio]), null);
  assert.equal(checkLip([image, audio], ['audio'])?.slot, 'reference_audio');
});

test('switching back to text uses the existing draft while the lip-sync sources remain on the canvas', () => {
  assert.equal(checkLip([image, audio], [], 'text_to_video'), null);
});

test('the same canvas node restores its chosen portrait after editing the draft and switching modes twice', () => {
  const other = { ...image, id: 'other' };
  const portrait = { edgeId: 'edge-image', sourceNodeId: image.id, role: 'reference', pinned: true, use: 'active', ordinal: 0 };
  const target = { id: 'target', type: 'material', data: { nodeKind: 'generate', materialType: 'video', inputBindingVersion: 1,
    slotBindings: { reference_image: [portrait] }, slotStandbyEdgeIds: ['edge-other'], autoOperationId: null,
    params: { model, operation: 'digital_human' }, prompt: '' } };
  let graph = { nodes: [other, image, target], edges: [other, image].map(n => ({ id: `edge-${n.id}`, source: n.id, target: target.id })) };
  function patch(data) {
    const plan = planCanvasInputMutation(graph, { nodePatches: [{ nodeId: target.id, data }] }, { catalog });
    assert.equal(plan.status, 'allowed');
    graph = { nodes: plan.nodes, edges: plan.edges };
    return graph.nodes.find(n => n.id === target.id);
  }
  patch({ prompt: draft });
  const text = patch({ params: { model, operation: 'text_to_video' }, autoOperationId: null });
  assert.equal(text.data.params.operation, 'text_to_video');
  assert.equal(text.data.slotBindings.reference_image, undefined);
  patch({ prompt: '草稿更新' });
  const lip = patch({ params: { model, operation: 'digital_human' }, autoOperationId: null });
  assert.equal(lip.data.prompt, '草稿更新');
  assert.equal(lip.data.params.operation, 'digital_human');
  assert.equal(lip.data.slotBindings.reference_image?.[0]?.sourceNodeId, image.id);
  assert.equal(lip.data.slotBindings.reference_image[0].pinned, true);
  assert.deepEqual(lip.data.slotStandbyEdgeIds, ['edge-other']);
  assert.equal(findExecutionReadinessFailure([lip], catalog, graph)?.slot, 'reference_audio');
});

test('the H3 mode menu can select lip sync before attaching media, then return to text with media connected', () => {
  const args = { params: { model, operation: 'text_to_video' }, modelItem, currentModelItem: modelItem,
    targetModelItem: modelItem, catalog, upstreams: [], prompt: draft, autoOperationId: 'text_to_video' };
  const controls = resolveEffectiveVideoParams(args);
  assert.equal(controls.effectiveOperations.find(op => op.id === 'digital_human')?.disabled, false);
  const switched = buildVideoParameterSelection({ ...args, nextOperationId: 'digital_human' });
  assert.equal(switched.params.operation, 'digital_human');
  const upstreams = [image, audio].map(node => ({ nodeId: node.id, materialType: node.id, availability: 'ready', url: node.data.mediaUrl }));
  const back = buildVideoParameterSelection({ ...args, upstreams, params: switched.params,
    parameterSelections: switched.parameterSelections, nextOperationId: 'text_to_video', autoOperationId: null });
  assert.equal(back.params.operation, 'text_to_video');
  assert.equal(buildInputCapability({ catalog, modelId: model, outputType: 'video', fingerprint: buildUiUpstreamFingerprint({ upstreams }),
    preferredOperationId: 'text_to_video', autoOperationId: null }).selectedOperationId, 'text_to_video');
});
