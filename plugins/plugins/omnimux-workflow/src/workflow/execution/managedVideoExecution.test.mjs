import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMaterialGatewayExecutor } from './materialGatewayExecutor.ts';
import { prepareExecutionAdmission } from './prepareExecutionAdmission.ts';
import { resolveExecutionSubgraph } from './subgraph.ts';
import { executionInputSignatures } from './executionIdentity.ts';
import { resolveCanvasSubmission } from '../seam/submitGuard.ts';
import { mockCatalog } from '../seam/mockCatalog.ts';
import { operation, slot } from '../seam/submissionFixtures.mjs';
import { managedVideoLinePricingFingerprint } from '../../shared/validation/managedVideoExecution.ts';

const modelId = 'atlas-fixture-71';
const referenceMode = (max, duration) => ({
  ...operation('video_multi_ref', 'video', [slot('image', 'reference', 1, max, 'reference_images')]),
  modeKind: 'image_reference',
  parameters: { duration: { options: [{ value: duration }], defaultValue: duration, required: true } },
});
const plainMode = operation('text_to_video', 'video', []);
const sourceImage = id => ({
  id, type: 'material', data: {
    materialType: 'image', nodeKind: 'generate', prompt: 'Upstream image.',
    params: { model: 'mock-image-1', operation: 'text_to_image' },
  },
});
const media = id => ({ mediaAssets: [{ type: 'image', url: `https://fixture.invalid/${id}.png` }] });

function fixture() {
  const narrow = referenceMode(2, 4);
  const wide = referenceMode(6, 10);
  const channelGroups = [
    { id: 'cheap', wireGroup: 'line-a', label: 'Economy', effectiveOperations: [narrow, plainMode] },
    { id: 'wide', wireGroup: 'line-b', label: 'Standard', effectiveOperations: [wide] },
  ];
  const catalog = mockCatalog();
  catalog.source = 'omnimux';
  catalog.models.push({
    id: modelId, label: 'Fixture', effectiveVideoVersion: 'fixture-v1', channelGroups,
    listed: true, gateway: { schemaVersion: '2.0' }, operations: [wide, plainMode],
  });
  catalog.video.push({ id: modelId, label: 'Fixture', executionStatus: 'ready', selectable: true, channelGroups });
  const ids = ['input-c', 'input-a', 'input-b'];
  const edges = ids.map(id => ({ id: `edge-${id}`, source: id, target: 'target' }));
  const target = { id: 'target', type: 'material', data: {
    materialType: 'video', nodeKind: 'generate', inputBindingVersion: 1,
    prompt: 'Use @ref[input-a:0:active-a.png] and ignore @ref[input-c:0:hidden-c.png].',
    params: { model: modelId, operation: 'video_multi_ref', routing: { channelGroupId: 'cheap' }, duration: 4 },
    slotBindings: { reference_images: ['input-b', 'input-a', 'input-c'].map((id, ordinal) => ({
      edgeId: `edge-${id}`, sourceNodeId: id, role: 'reference', ordinal, pinned: true,
    })) },
  } };
  const graph = { nodes: [...ids.map(sourceImage), target], edges };
  return { graph, catalog, target };
}

async function admit({ graph, catalog }, nodeIds, manager = {}) {
  const mode = 'subset';
  const scope = resolveExecutionSubgraph({ ...graph, executionMode: mode, nodeIds });
  return prepareExecutionAdmission('fixture-workspace', graph, scope, mode, manager, () => catalog);
}

test('managed video uses selected references and runs only active pending upstream images', async () => {
  const testCase = fixture();
  const hiddenDocument = { documentText: '{"duration":10}', text: 'Hidden configuration.' };
  testCase.graph.nodes.unshift({ id: 'old-document', type: 'document', data: hiddenDocument });
  testCase.graph.edges.push({ id: 'edge-old-document', source: 'old-document', target: 'target' });
  const result = await admit(testCase, ['target']);
  assert.equal(result.readiness, null);
  assert.deepEqual([...result.subgraph.nodeIdSet], ['input-a', 'input-b', 'target']);
  assert.deepEqual(result.sourceGraph.edges.map(edge => edge.source), ['input-a', 'input-b']);
  assert.equal(testCase.graph.edges.length, 4);
  assert.equal(testCase.target.data.slotBindings.reference_images.length, 3);
  const explicit = await admit(testCase, ['target', 'input-c']);
  assert.ok(explicit.subgraph.nodeIdSet.has('input-c'));
  assert.equal(explicit.subgraph.edges.some(edge => edge.source === 'input-c'), false);

  const model = result.subgraph.nodes.find(({ id }) => id === 'target');
  const capture = [];
  const gateway = {
    capabilities: async () => testCase.catalog,
    submit: async request => { capture.push(request); return { taskId: 'fixture-task', mode: 'submitted' }; },
    awaitTask: async () => ({ type: 'video', url: 'https://fixture.invalid/result.mp4' }),
  };
  const execute = createMaterialGatewayExecutor({ gateway }).execute;
  const context = {
    signal: new AbortController().signal, upstreamOutputs: new Map(), mediaDir: '/tmp',
    upstreamBindings: testCase.graph.edges.map(edge => ({
      edgeId: edge.id, sourceNodeId: edge.source,
      output: edge.source === 'old-document' ? hiddenDocument : media(edge.source),
    })),
  };
  await execute(model, context);
  assert.equal(capture.length, 1);
  assert.deepEqual(capture[0].allowedGroups, ['line-a']);
  assert.equal(capture[0].effectiveVideoVersion, 'fixture-v1');
  assert.deepEqual(capture[0].references.map(ref => ref.sourceNodeId), ['input-b', 'input-a']);
  assert.equal(capture[0].image, undefined);
  assert.equal(capture[0].duration, 4);
  assert.match(capture[0].prompt, /active-a/);
  assert.doesNotMatch(capture[0].prompt, /hidden-c|Hidden configuration/);
  assert.doesNotMatch(capture[0].localText, /hidden-c/);

  const { channelGroups } = testCase.catalog.models.find(({ id }) => id === modelId);
  channelGroups[0].pricing = { groupRatio: 0.7 };
  await assert.rejects(execute(model, context), { code: 'line_capability_changed' });
  channelGroups.shift();
  await assert.rejects(execute(model, context), { code: 'line_selection_required' });
  assert.equal(capture.length, 1);
});

test('managed submission rejects an unpinned group or a parameter valid only in a different group', () => {
  const { catalog } = fixture();
  const req = { model: modelId, capability: 'video', operation: 'video_multi_ref', duration: 4, prompt: 'Fixture', dest: '/tmp/out.mp4' };
  assert.throws(() => resolveCanvasSubmission(req, catalog), { code: 'line_selection_required' });
  assert.throws(() => resolveCanvasSubmission({ ...req, duration: 10, allowedGroups: ['line-a'] }, catalog), { code: 'operation-not-allowed' });
  assert.throws(() => resolveCanvasSubmission({ ...req, duration: undefined, allowedGroups: ['line-a'] }, catalog), { code: 'parameter_required' });
});

test('managed executor submits only the URL declared as an input of the chosen mode', async () => {
  const testCase = fixture();
  const [group] = testCase.catalog.models.find(({ id }) => id === modelId).channelGroups;
  const capture = [];
  const gateway = {
    capabilities: async () => testCase.catalog,
    submit: async request => { capture.push(request); return { taskId: 'fixture-url-task', mode: 'submitted' }; },
    awaitTask: async () => ({ type: 'video', url: 'https://fixture.invalid/result.mp4' }),
  };
  const execute = createMaterialGatewayExecutor({ gateway }).execute;
  const context = {
    signal: new AbortController().signal, upstreamOutputs: new Map(), upstreamBindings: [], mediaDir: '/tmp',
  };
  const modes = [
    ['document_to_video', 'file_url', 'fileUrl', 'document', 'https://fixture.invalid/script.pdf', 'linkUrl'],
    ['webpage_to_video', 'link_url', 'linkUrl', 'webpage', 'https://fixture.invalid/story', 'fileUrl'],
  ];
  for (const [id, input, field, role, url, hiddenField] of modes) {
    group.effectiveOperations.push(operation(id, 'video', [
      { slot: input, role, type: 'document', source: 'node_field', min: 1, max: 1 },
    ]));
    const { data } = testCase.target;
    data.params = { model: modelId, operation: id, routing: { channelGroupId: 'cheap' }, [field]: url };
    data.videoAssetFieldDrafts = { dormant: { [hiddenField]: 'https://fixture.invalid/dormant' } };
    const prepared = await admit(testCase, ['target']);
    assert.equal(prepared.readiness, null);
    await execute(prepared.subgraph.nodes[0], context);
    assert.equal(capture.at(-1)[field], url);
    assert.equal(Object.hasOwn(capture.at(-1), hiddenField), false);
  }
  assert.equal(capture.length, 2);
});

test('admission reads the mode draft when the saved visible slot list came from a smaller group', async () => {
  const testCase = fixture();
  const { data } = testCase.target;
  data.videoSlotDrafts = { image_reference: structuredClone(data.slotBindings) };
  data.slotBindings.reference_images.pop();
  data.params = { ...data.params, routing: { channelGroupId: 'wide' }, duration: 10 };
  const result = await admit(testCase, ['target']);
  assert.equal(result.readiness, null);
  assert.deepEqual([...result.subgraph.nodeIdSet], ['input-c', 'input-a', 'input-b', 'target']);
  const prepared = result.subgraph.nodes.find(({ id }) => id === 'target');
  assert.equal(prepared.data.slotBindings.reference_images.length, 3);
  assert.equal(data.slotBindings.reference_images.length, 2);
});

test('a changed quote needs confirmation without changing the identity of accepted work', async () => {
  const testCase = fixture();
  const [group] = testCase.catalog.models.find(({ id }) => id === modelId).channelGroups;
  group.pricing = { groupRatio: 0.5 };
  const before = executionInputSignatures(testCase.graph);
  testCase.target.data.params.routing.videoLineQuote = managedVideoLinePricingFingerprint(group);
  assert.deepEqual(executionInputSignatures(testCase.graph), before);
  assert.equal((await admit(testCase, ['target'])).readiness, null);
  group.pricing = { groupRatio: 0.75 };
  const pending = await admit(testCase, ['target']);
  assert.equal(pending.readiness.reasonCode, 'line_capability_changed');
  testCase.target.data.params.routing.videoLineQuote = managedVideoLinePricingFingerprint(group);
  assert.equal((await admit(testCase, ['target'])).readiness, null);
});

test('a dormant dependency does not prevent collecting an accepted task from the original run', async () => {
  const testCase = fixture();
  testCase.target.data.params = { ...testCase.target.data.params, operation: 'text_to_video', duration: undefined };
  testCase.graph.nodes.push({ ...testCase.target, id: 'already-proven' });
  const accepted = { taskId: 'accepted-task', owner: 'omnimux', capability: 'video' };
  const alreadyProven = { ...accepted, taskId: 'other-accepted-task' };
  const lookups = [];
  const result = await admit(testCase, ['target', 'already-proven'], {
    findRecoverableTasks({ edges, rawGraph, recoveryTasks }) {
      lookups.push(edges.length);
      assert.equal(rawGraph, testCase.graph);
      if (edges.length) return { 'already-proven': alreadyProven };
      assert.deepEqual(recoveryTasks, { 'already-proven': alreadyProven });
      return { ...recoveryTasks, target: accepted };
    },
  });
  assert.deepEqual(lookups, [3, 0]);
  assert.equal(result.readiness, null);
  assert.equal(result.recovery.recoveryTasks.target, accepted);
  assert.deepEqual([...result.subgraph.nodeIdSet], ['target', 'already-proven']);
  assert.equal(result.subgraph.nodes[0], testCase.target);
});
