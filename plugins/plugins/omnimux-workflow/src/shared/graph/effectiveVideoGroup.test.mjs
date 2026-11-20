import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const bundle = await build({
  stdin: { contents: `
    export * from '../validation/lineConstraints.ts';
    export { planCanvasInputMutation } from './canvasInputMutationGateway.ts';
  `, resolveDir: root },
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const { resolveEffectiveVideoGroup, resolveEffectiveVideoOperation, narrowCatalogByRouting,
  transitionEffectiveVideoParams, planCanvasInputMutation } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const model = 'new-catalog-entry';
const input = (slot, role, max) => ({ slot, role, type: 'image', min: 1, max, allowedMimes: ['image/jpeg'] });
const enumOf = (value) => ({ options: [{ value, label: String(value) }], defaultValue: value });
const references = (max, resolution, duration) => ({
  id: 'video_multi_ref', modeKind: 'image_reference', listed: true, output: { type: 'video' },
  inputs: [input('reference_images', 'reference', max)],
  parameters: { resolution: enumOf(resolution), duration: enumOf(duration) },
});
const pair = {
  id: 'first_last_frame', modeKind: 'first_last_frame', listed: true, output: { type: 'video' },
  inputs: [input('first_frame', 'first_frame', 1), input('last_frame', 'last_frame', 1)],
};
const high = {
  id: 'high', wireGroup: 'high-wire', enabled: true, label: 'High', defaultOperationId: 'video_multi_ref',
  effectiveOperations: [references(6, '720p', 5), references(6, '1080p', 10), pair],
};
const low = { id: 'low', enabled: true, label: 'Low', effectiveOperations: [references(2, '720p', 5), pair] };
const catalog = {
  source: 'omnimux', models: [{ id: model, label: model, effectiveVideoVersion: 'one',
    selectable: true, operations: [references(6, '720p', 5), pair], channelGroups: [high, low] }],
  defaultOperations: { video: { modelId: model, operationId: 'video_multi_ref' } },
};
const routing = (id) => ({ channelGroupId: id, allowedGroups: [id], sourceType: 'official' });

test('a managed model has exactly one visible group and one complete variant per accepted parameter choice', () => {
  assert.equal(resolveEffectiveVideoGroup(catalog, model, { allowedGroups: ['high', 'low'] }).group, undefined);
  assert.equal(resolveEffectiveVideoGroup(catalog, model, { allowedGroups: ['high-wire'] }).group, high);
  assert.equal(resolveEffectiveVideoGroup(catalog, model, routing('revoked')).group, undefined);
  const legacy = { ...catalog, models: [{ ...catalog.models[0], effectiveVideoVersion: undefined }] };
  assert.equal(resolveEffectiveVideoGroup(legacy, model, routing('high')), null);
  assert.equal(resolveEffectiveVideoGroup(legacy, model, { ...routing('high'), videoLineQuote: 'reviewed' }).group, undefined);
  assert.equal(narrowCatalogByRouting(catalog, model, routing('revoked')).models[0].operations.length, 0);
  assert.equal(resolveEffectiveVideoOperation(high, 'video_multi_ref', { resolution: '720p', duration: 10 }), undefined);
  const old = { model, routing: routing('high'), operation: 'video_multi_ref', resolution: '720p', duration: 5 };
  const selection = resolveEffectiveVideoGroup(catalog, model, old.routing);
  const next = transitionEffectiveVideoParams(catalog, selection, old, old.routing, { parameter: { key: 'resolution', value: '1080p' } });
  assert.equal(next.duration, 10);
  assert.equal(resolveEffectiveVideoOperation(high, next.operation, next).inputs[0].max, 6);
  const wide = references(6, '720p', 5);
  const overlapping = { ...low, effectiveOperations: [references(2, '720p', 5), wide] };
  assert.equal(resolveEffectiveVideoOperation(overlapping, old.operation, old), wide);
  assert.equal(resolveEffectiveVideoOperation(overlapping, old.operation, { ...old, duration: 10 }), undefined);
});

test('changing between price groups and modes preserves the ordered draft and never reassigns it as first/last frames', () => {
  const sources = Array.from({ length: 6 }, (_, index) => ({ id: `image-${index}`, type: 'material', data: {
    materialType: 'image', nodeKind: 'import', selectedTool: 'import', mediaUrl: `https://fixture.test/${index}.jpg`, mimeType: 'image/jpeg',
  } }));
  const edges = sources.map(source => ({ id: `to-${source.id}`, source: source.id, target: 'target', targetHandle: 'in' }));
  const saved = [...edges].reverse().map((edge, ordinal) => ({ edgeId: edge.id, sourceNodeId: edge.source, pinned: true, ordinal, role: 'reference' }));
  const target = { id: 'target', type: 'material', data: {
    materialType: 'video', nodeKind: 'generate', selectedTool: 'video-generation', prompt: 'A test', inputBindingVersion: 1,
    params: { model, routing: routing('high'), operation: 'video_multi_ref', resolution: '1080p', duration: 10 },
    slotBindings: { reference_images: saved },
  } };
  let graph = { nodes: [...sources, target], edges };
  const set = (id, operationId) => {
    const route = routing(id);
    const current = graph.nodes.find(node => node.id === 'target');
    const next = transitionEffectiveVideoParams(catalog, resolveEffectiveVideoGroup(catalog, model, route), current.data.params, route, { operationId });
    const plan = planCanvasInputMutation(graph, { nodePatches: [{ nodeId: current.id, data: { params: next, autoOperationId: null } }] }, { catalog });
    assert.equal(plan.status, 'allowed');
    graph = plan;
    return graph.nodes.find(node => node.id === 'target').data;
  };
  let data = set('low');
  assert.equal(data.params.duration, 5);
  assert.deepEqual(data.slotBindings.reference_images.map(item => item.edgeId), saved.slice(0, 2).map(item => item.edgeId));
  data = set('low', 'first_last_frame');
  assert.deepEqual(data.slotBindings, { first_frame: [], last_frame: [] });
  data = set('high', 'video_multi_ref');
  assert.deepEqual(data.slotBindings.reference_images.map(item => item.edgeId), saved.map(item => item.edgeId));
  assert.equal(graph.edges.length, 6);
  const restored = JSON.parse(JSON.stringify(graph));
  assert.equal(restored.nodes.at(-1).data.videoSlotDrafts.image_reference.reference_images.length, 6);
});

test('a declared URL input remains in its mode draft and is absent from another mode', () => {
  const operation = {
    id: 'document_to_video', modeKind: 'document_reference', listed: true, output: { type: 'video' },
    inputs: [{ slot: 'file_url', role: 'document', type: 'document', source: 'node_field', min: 1, max: 1 }],
  };
  const qualified = { ...catalog, models: [{ ...catalog.models[0], operations: [operation, pair],
    channelGroups: [{ ...high, effectiveOperations: [operation, pair] }] }] };
  const route = routing('high');
  const selection = resolveEffectiveVideoGroup(qualified, model, route);
  const target = { id: 'target', type: 'material', data: {
    materialType: 'video', nodeKind: 'generate', selectedTool: 'video-generation', params: {
      model, routing: route, operation: 'document_to_video',
    },
  } };
  let state = { nodes: [target], edges: [] };
  const patch = (change) => {
    const next = transitionEffectiveVideoParams(qualified, selection, state.nodes[0].data.params, route, change);
    state = planCanvasInputMutation(state, { nodePatches: [{ nodeId: 'target', data: { params: next } }] }, { catalog: qualified });
    assert.equal(state.status, 'allowed');
    return state.nodes[0].data.params;
  };
  const fileUrl = 'https://fixture.test/notes.pdf';
  assert.equal(patch({ parameter: { key: 'fileUrl', value: fileUrl } }).fileUrl, fileUrl);
  assert.equal(patch({ operationId: 'first_last_frame' }).fileUrl, undefined);
  assert.equal(patch({ operationId: 'document_to_video' }).fileUrl, fileUrl);
  assert.equal(patch({ parameter: { key: 'fileUrl', value: '' } }).fileUrl, '');
  assert.equal(patch({ operationId: 'first_last_frame' }).fileUrl, undefined);
  assert.equal(patch({ operationId: 'document_to_video' }).fileUrl, '');
});
