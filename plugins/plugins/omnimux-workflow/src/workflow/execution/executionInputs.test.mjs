import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInitialOutputs } from './executionInputs.ts';
import { prepareExecutionAdmission } from './prepareExecutionAdmission.ts';
import { collectMaterialSlotInputs } from './materialSlotInputs.ts';
import { resolveExecutionSubgraph } from './subgraph.ts';
import { catalogFor, operation, slot } from '../seam/submissionFixtures.mjs';

test('waiting and unavailable sources do not become synthetic text outputs', () => {
  const nodes = [
    { id: 'missing', type: 'material', data: { materialType: 'image', mediaUrl: 'https://example.test/a.png', isMissing: true } },
    { id: 'waiting', type: 'material', data: { materialType: 'video', status: 'loading' } },
    { id: 'text', type: 'material', data: { materialType: 'text', content: 'current', prompt: 'old instruction' } },
    { id: 'scheduled', type: 'material', data: { materialType: 'text', content: 'old output' } },
  ];
  const workspace = { id: 'ws_input', nodes, edges: nodes.map((node) => ({ source: node.id, target: 'target' })) };
  assert.deepEqual(buildInitialOutputs(workspace, new Set(['target', 'scheduled'])), { text: { text: 'current' } });
});

test('project media is resolved before execution and relative paths never become gateway URLs', () => {
  const workspace = { id: 'ws_input', nodes: [{ id: 'image', type: 'material', data: { nodeKind: 'import', materialType: 'image', relativePath: 'assets/image.png' } }], edges: [{ source: 'image', target: 'target' }] };
  const options = { mediaDir: '/tmp', resolveProjectFile: (id, relativePath) => { assert.equal(id, 'ws_input'); assert.equal(relativePath, 'assets/image.png'); return '/tmp/project/image.png'; } };
  const output = buildInitialOutputs(workspace, new Set(['target']), options);
  assert.equal(output.image.mediaAssets[0].url, '/tmp/project/image.png');
  assert.equal(output.image.mediaAssets[0].path, '/tmp/project/image.png');
  assert.throws(() => buildInitialOutputs(workspace, new Set(['target', 'image']), { mediaDir: '/tmp', resolveProjectFile: () => { throw new Error('deleted file'); } }), /deleted file/);
});

test('execution copies seed only admitted visual sources, while another consumer still needs its file', async () => {
  const input = { ...slot('image', 'reference', 0, 2, 'reference_images'), allowedMimes: ['image/png'] };
  const imageOp = operation('image_to_image', 'image', [input], false);
  const catalog = catalogFor('image', 'fixture', [imageOp]);
  const showing = { id: 'shown', type: 'material', data: {
    materialType: 'image', nodeKind: 'import', mediaUrl: 'https://example.test/shown.png', mimeType: 'image/png',
  } };
  const unresolved = { id: 'hidden', type: 'material', data: {
    materialType: 'image', nodeKind: 'import', relativePath: 'assets/deleted.jpg', mimeType: 'image/jpeg',
  } };
  const target = { id: 'target', type: 'material', data: {
    materialType: 'image', nodeKind: 'generate', inputBindingVersion: 1, params: { model: 'fixture', operation: imageOp.id },
    slotBindings: { reference_images: [
      { sourceNodeId: showing.id, edgeId: 'shown-edge', pinned: true },
      { sourceNodeId: unresolved.id, edgeId: 'hidden-edge', pinned: true },
    ] },
  } };
  const tool = { id: 'tool', type: 'fixture-tool', data: {} };
  const graph = { nodes: [showing, unresolved, target, tool], edges: [
    { id: 'shown-edge', source: showing.id, target: target.id },
    { id: 'hidden-edge', source: unresolved.id, target: target.id },
    { id: 'tool-edge', source: unresolved.id, target: tool.id },
  ] };
  const snapshot = structuredClone(graph);
  const selected = resolveExecutionSubgraph({ ...graph, executionMode: 'single', nodeIds: [target.id] });
  const admission = await prepareExecutionAdmission('ws_input', graph, selected, 'single', {}, () => catalog);
  assert.equal(admission.readiness, null);
  const opts = { mediaDir: '/tmp', resolveProjectFile: () => { throw new Error('deleted project file'); } };
  const seeded = buildInitialOutputs(admission.sourceGraph, admission.subgraph.nodeIdSet, opts);
  assert.deepEqual(Object.keys(seeded), [showing.id]);
  const admitted = admission.subgraph.nodes[0];
  const upstreamOutputs = new Map(Object.entries(seeded));
  const result = collectMaterialSlotInputs(admitted.data, { upstreamOutputs,
    upstreamBindings: admission.sourceGraph.edges.filter(edge => edge.target === target.id).map(edge => ({
      sourceNodeId: edge.source, edgeId: edge.id, output: upstreamOutputs.get(edge.source) ?? {},
    })), mediaDir: '/tmp' }, catalog);
  assert.deepEqual(result.references.map(ref => ref.sourceNodeId), [showing.id]);
  assert.deepEqual(graph, snapshot);

  // The same source is valid for a target which does not filter it out.
  assert.throws(() => buildInitialOutputs(admission.sourceGraph, new Set(['target', 'tool']), opts), /deleted project file/);
  const valid = structuredClone(catalog);
  valid.models[0].operations[0].inputs.find(item => item.slot === 'reference_images').allowedMimes.push('image/jpeg');
  const visible = await prepareExecutionAdmission('ws_input', graph, selected, 'single', {}, () => valid);
  assert.equal(visible.readiness, null);
  assert.throws(() => buildInitialOutputs(visible.sourceGraph, visible.subgraph.nodeIdSet, opts), /deleted project file/);
});

async function assertOverflowGenerationIsExcluded(outputType) {
  const input = slot('image', 'reference', 1, 1, 'reference_images');
  const edit = operation(outputType === 'image' ? 'image_to_image' : 'video_multi_ref', outputType, [input]);
  const sourceOp = operation('text_to_image', 'image');
  const catalog = catalogFor(outputType, 'fixture', [edit]);
  const sourceCatalog = catalogFor('image', 'source-fixture', [sourceOp]);
  catalog.models = [...catalog.models, ...sourceCatalog.models];
  catalog.image = [...catalog.image, ...sourceCatalog.image];
  const shown = { id: 'shown', type: 'material', data: {
    materialType: 'image', nodeKind: 'import', mediaUrl: 'https://example.test/shown.png',
  } };
  const generated = { id: 'generated', type: 'material', data: {
    materialType: 'image', nodeKind: 'generate', prompt: 'upstream prompt',
    params: { model: 'source-fixture', operation: sourceOp.id },
  } };
  const occupant = (source, target, ordinal) => ({
    sourceNodeId: source.id, edgeId: `${source.id}-${target}`, ordinal, pinned: true,
  });
  const target = (id, assets) => ({ id, type: 'material', data: {
    materialType: outputType, nodeKind: 'generate', inputBindingVersion: 1, prompt: 'target prompt',
    params: { model: 'fixture', operation: edit.id }, slotBindings: { reference_images: assets },
  } });
  const graph = {
    nodes: [shown, generated, target('target', [occupant(generated, 'target', 1), occupant(shown, 'target', 0)]),
      target('other', [occupant(generated, 'other', 0)])],
    edges: [
      { id: 'generated-target', source: generated.id, target: 'target' },
      { id: 'shown-target', source: shown.id, target: 'target' },
      { id: 'generated-other', source: generated.id, target: 'other' },
    ],
  };
  const saved = structuredClone(graph);
  async function admit(executionMode, nodeIds) {
    const selection = resolveExecutionSubgraph({ ...graph, executionMode, nodeIds });
    const result = await prepareExecutionAdmission('ws_billing', graph, selection, executionMode, {}, () => catalog);
    assert.equal(result.readiness, null);
    assert.equal(result.subgraph.edges.some(edge => edge.id === 'generated-target'), false);
    return [...result.subgraph.nodeIdSet];
  }
  assert.deepEqual(await admit('subset', ['target']), ['shown', 'target']);
  assert.deepEqual(await admit('subset', ['target', 'generated']), ['shown', 'generated', 'target']);
  assert.deepEqual(await admit('subset', ['target', 'other']), ['shown', 'generated', 'target', 'other']);
  assert.deepEqual(await admit('full', []), ['shown', 'generated', 'target', 'other']);
  assert.deepEqual(graph, saved);
}

test('overflow image and video dependencies cannot start an implicit generation', async () => {
  await assertOverflowGenerationIsExcluded('image');
  await assertOverflowGenerationIsExcluded('video');
});
