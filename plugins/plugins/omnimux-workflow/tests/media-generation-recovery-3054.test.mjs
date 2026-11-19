import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModelCatalog } from '../../omnimux/src/catalog/list.js';

const bundle = await build({ stdin: { contents: `
  export { createExecutionManager } from '../src/workflow/execution/ExecutionManager.ts';
  export { createExecutionRoutes } from '../src/workflow/routes/executionRoutes.ts';
  export { createWorkflowRunTool } from '../src/workflow/agent/agentReadTools.ts';
  export { createHeadlessExecutionSeam } from '../src/workflow/execution/HeadlessExecutionSeam.ts';
  export { buildInitialOutputs } from '../src/workflow/execution/executionInputs.ts';
  export { prepareExecutionSlotGraph } from '../src/shared/graph/feedSlot/prepareExecutionSlotGraph.ts';
  export { executionInputSignatures } from '../src/workflow/execution/executionTypes.ts';
  export { createMaterialGatewayExecutor } from '../src/workflow/execution/materialGatewayExecutor.ts';
  export { mockCatalog } from '../src/workflow/seam/mockCatalog.ts';
  export { SeamGatewayError } from '../src/workflow/seam/SeamGatewayError.ts';
`, resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { createExecutionManager, createExecutionRoutes, executionInputSignatures, createMaterialGatewayExecutor,
  createWorkflowRunTool, createHeadlessExecutionSeam, buildInitialOutputs, prepareExecutionSlotGraph,
  mockCatalog, SeamGatewayError } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function harness(t, { kind = 'image', source = false, error = new Error('temporary 401'), persistGenerated } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'workflow-recovery-3054-'));
  let manager;
  const calls = { submit: 0, collect: [], catalog: 0, source: 0 };
  let catalogAvailable = true;
  let sourceAvailable = true;
  const snapshot = { id: 'ws_recovery', name: 'recovery', version: 1, settings: {}, nodes: [
    ...(source ? [{ id: 'source', type: 'material', data: { nodeKind: 'import', materialType: 'text', content: 'source body' } }] : []),
    { id: 'target', type: 'material', data: { materialType: kind, prompt: 'original request', inputBindingVersion: 1,
      params: { model: kind === 'image' ? 'mock-image-1' : 'mock-video-1', operation: kind === 'image' ? 'text_to_image' : 'text_to_video' } } },
  ], edges: source ? [{ id: 'edge', source: 'source', target: 'target' }] : [] };
  const gateway = {
    capabilities: async () => { calls.catalog++; if (!catalogAvailable) throw new Error('catalog unavailable'); return mockCatalog(); },
    submit: async () => { calls.submit++; return { mode: 'submitted', taskId: `upstream-${calls.submit}`, taskRef: `mtask_original_${calls.submit}`, owner: 'omnimux' }; },
    awaitTask: async () => { throw error; },
    reconcileTask: async (ref, dest) => { calls.collect.push(ref); return { url: dest,
      type: kind, mimeType: kind === 'image' ? 'image/png' : 'video/mp4', sizeBytes: 100 }; },
  };
  const resolveProjectFile = (_workspaceId, rel) => { calls.source++; if (!sourceAvailable) throw new Error('source gone'); return join(root, rel); };
  const newManager = () => createExecutionManager({ executionsDir: join(root, 'executions'), mediaDir: join(root, 'media'), gateway, persistGenerated, resolveProjectFile });
  manager = newManager();
  const request = async (body = {}) => createExecutionRoutes({
    store: { get: () => snapshot, resolveProjectRoot: () => root }, executionManager: manager,
    getCatalog: gateway.capabilities, resolveProjectFile,
  }).tryHandle('POST', '/omnimux-workflow/api/workspaces/ws_recovery/executions', { body: { mode: 'single', nodeIds: ['target'], expectedVersion: 1, ...body } });
  const ended = async id => {
    const entry = manager.getEntry(id);
    if (!['completed', 'error', 'cancelled'].includes(entry.context.status)) await new Promise(resolve => {
      entry.context.events.on('execution_complete', resolve);
      entry.context.events.on('execution_error', resolve);
      entry.context.events.on('execution_cancelled', resolve);
    });
    return entry;
  };
  t.after(() => { manager.disposeAll(); rmSync(root, { recursive: true, force: true }); });
  return { root, snapshot, calls, request, ended, gateway, get manager() { return manager; },
    catalogOff: () => { catalogAvailable = false; }, sourceOff: () => { sourceAvailable = false; },
    restart: () => { manager.disposeAll(); manager = newManager(); } };
}

async function acceptedH3(t, gatewayContracts = true, configureSources) {
  const artifacts = [];
  const h = harness(t, { kind: 'video', persistGenerated: async input => {
    artifacts.push(input);
    return { url: 'https://fixture.example/result.mp4', relativePath: 'result.mp4', assetId: 'result' };
  } });
  const snapshot = JSON.parse(readFileSync(new URL('../../omnimux/src/catalog/cloud/bundled/pricing.json', import.meta.url), 'utf8'));
  const catalog = buildModelCatalog({ snapshot, gatewayContracts, env: {} });
  const readCatalog = h.gateway.capabilities;
  h.gateway.capabilities = async () => { await readCatalog(); return catalog; };
  const model = 'minimax-h3-video';
  const operation = 'digital_human';
  const target = h.snapshot.nodes[0];
  target.data.params = { model, operation };
  const slots = catalog.models.find(row => row.id === model).operations.find(op => op.id === operation).inputs;
  target.data.slotBindings = Object.fromEntries(slots.map(input => {
    const id = input.type;
    const ext = id === 'image' ? 'png' : 'wav';
    h.snapshot.nodes.unshift({ id, type: 'material', data: { materialType: id, nodeKind: 'import',
      mediaUrl: `https://fixture.example/${id}.${ext}`, mimeType: `${id}/${ext}`, sizeBytes: 64 } });
    h.snapshot.edges.push({ id, source: id, target: target.id });
    return [input.slot, [{ edgeId: id, sourceNodeId: id, role: input.role, use: 'active', pinned: true }]];
  }));
  configureSources?.(h);
  const first = await h.request();
  assert.equal(first.status, 200);
  const entry = await h.ended(first.body.execution.id);
  assert.equal(entry.context.status, 'error');
  const ref = entry.context.readNodeUpstreamTask(target.id);
  assert.equal(ref.taskRef, 'mtask_original_1');
  return { h, target, ref, id: entry.context.id, artifacts };
}

function projectAudio(h, urlOnly = false) {
  const wav = Buffer.alloc(80044);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  writeFileSync(join(h.root, 'voice.wav'), wav);
  Object.assign(h.snapshot.nodes.find(node => node.id === 'audio').data, {
    mediaUrl: '/omnimux-workflow/api/workspaces/ws_recovery/file?rel=voice.wav',
    ...(!urlOnly && { relativePath: 'voice.wav' }), sizeBytes: wav.length, durationSec: 5,
  });
}

test('changing project audio bytes at the same path cannot collect an earlier H3 task', async t => {
  for (const urlOnly of [false, true]) {
    const { h, target } = await acceptedH3(t, true, h => projectAudio(h, urlOnly));
    h.restart();
    const file = join(h.root, 'voice.wav');
    const bytes = readFileSync(file);
    bytes[50] = 1;
    writeFileSync(file, bytes);
    target.data.prompt = 'edited only in graph';
    const second = await h.request();
    assert.equal(second.status, 200);
    const entry = await h.ended(second.body.execution.id);
    assert.equal(entry.context.get('executionInputsChanged').target, true);
    assert.equal(h.calls.submit, 2);
    assert.deepEqual(h.calls.collect, []);
  }
});

test('unchanged or subsequently missing project audio still collects the accepted H3 task', async t => {
  for (const removed of [false, true]) {
    const { h, target, ref } = await acceptedH3(t, true, projectAudio);
    h.restart();
    h.catalogOff();
    if (removed) rmSync(join(h.root, 'voice.wav'));
    target.data.prompt = 'edited only in graph';
    const second = await h.request();
    assert.equal(second.status, 200);
    const entry = await h.ended(second.body.execution.id);
    assert.equal(entry.context.status, 'completed');
    assert.equal(h.calls.submit, 1);
    assert.deepEqual(h.calls.collect, [ref]);
  }
});

test('an older H3 record without a project audio fingerprint reports its paid handle after a draft edit', async t => {
  const { h, target, id, ref } = await acceptedH3(t, true, projectAudio);
  h.restart();
  const file = join(h.root, 'executions', id, 'execution.json');
  const old = JSON.parse(readFileSync(file, 'utf8'));
  old.variables.executionSourceIdentities.target = {};
  writeFileSync(file, JSON.stringify(old));
  target.data.prompt = 'edited only in graph';
  const second = await h.request();
  assert.equal(second.status, 400);
  assert.equal(second.body.reasonCode, 'previous_task_input_unverified');
  assert.ok(second.body.message.includes(ref.taskId));
  assert.equal(h.calls.submit, 1);
  assert.deepEqual(h.calls.collect, []);
});

test('editing only an unsent H3 lip-sync draft recovers the paid task after restart without a catalog', async t => {
  const { h, target, ref, artifacts } = await acceptedH3(t);
  h.restart();
  h.catalogOff();
  target.data.prompt = 'save this for another mode';
  const reads = h.calls.catalog;
  const retry = await h.request();
  assert.equal(retry.status, 200);
  const entry = await h.ended(retry.body.execution.id);
  assert.equal(entry.context.status, 'completed');
  assert.equal(entry.context.get('executionInputsChanged').target, false);
  assert.equal(h.calls.catalog, reads);
  assert.equal(h.calls.submit, 1);
  assert.deepEqual(h.calls.collect, [ref]);
  assert.equal(artifacts[0].prompt, '');
});

test('edited H3 media, parameters and other workspace fields still require a new submission', async t => {
  for (const change of [
    (h) => { h.snapshot.nodes.find(node => node.id === 'image').data.mediaUrl = 'https://fixture.example/other.png'; },
    (h) => { h.snapshot.nodes.find(node => node.id === 'audio').data.mediaUrl = 'https://fixture.example/other.wav'; },
    (_h, target) => { target.data.params.duration = 3; },
    (_h, target) => { target.data.otherInput = 'future input'; },
    (h, target) => {
      h.snapshot.nodes.unshift({ id: 'note', type: 'material', data: { nodeKind: 'import', materialType: 'text', content: 'unused upstream' } });
      h.snapshot.edges.push({ id: 'note-edge', source: 'note', target: target.id });
    },
  ]) {
    const { h, target } = await acceptedH3(t);
    h.restart();
    target.data.prompt = 'new draft';
    change(h, target);
    const retry = await h.request();
    assert.equal(retry.status, 200);
    const entry = await h.ended(retry.body.execution.id);
    assert.equal(entry.context.get('executionInputsChanged').target, true);
    assert.equal(h.calls.submit, 2);
    assert.deepEqual(h.calls.collect, []);
  }
});

test('H3 records without verified prompt omission keep the original draft comparison', async t => {
  for (const gatewayContracts of [true, false]) {
    const { h, target, id, ref } = await acceptedH3(t, gatewayContracts);
    h.restart();
    if (gatewayContracts) {
      const file = join(h.root, 'executions', id, 'execution.json');
      const record = JSON.parse(readFileSync(file, 'utf8'));
      delete record.nodeStates.target.upstreamTask.omittedNodePrompt;
      writeFileSync(file, JSON.stringify(record));
    } else assert.equal(ref.omittedNodePrompt, undefined);
    target.data.prompt = 'edited';
    h.catalogOff();
    const retry = await h.request();
    assert.equal(retry.status, 400);
    assert.equal(h.calls.submit, 1);
    assert.deepEqual(h.calls.collect, []);
  }
});

for (const kind of ['image', 'video']) test(`${kind}: error retry creates fresh execution but collects original persisted task before catalog`, async t => {
  const h = harness(t, { kind });
  const first = await h.request(); assert.equal(first.status, 200);
  const failed = await h.ended(first.body.execution.id);
  assert.equal(failed.context.status, 'error');
  const original = failed.context.readNodeUpstreamTask('target'); assert.equal(original.taskRef, 'mtask_original_1');
  h.restart(); h.catalogOff();
  h.snapshot.nodes[0].data.executionStatus = 'error'; h.snapshot.nodes[0].data.executionError = 'temporary 401';
  const catalogCalls = h.calls.catalog;
  const second = await h.request(); assert.equal(second.status, 200);
  assert.notEqual(second.body.execution.id, first.body.execution.id);
  const recovered = await h.ended(second.body.execution.id);
  assert.equal(recovered.context.status, 'completed');
  assert.deepEqual(h.calls.collect, [original]); assert.equal(h.calls.submit, 1);
  assert.equal(h.calls.catalog, catalogCalls);
  assert.equal(recovered.context.get('executionInputsChanged').target, false);
  assert.equal(recovered.context.readNodeUpstreamTask('target'), undefined);
});

test('source becomes unavailable after submit: retry collects without catalog/readiness/source admission', async t => {
  const h = harness(t, { source: true });
  const first = await h.request(); assert.equal(first.status, 200); await h.ended(first.body.execution.id);
  h.snapshot.nodes[0].data.isMissing = true; h.catalogOff(); h.sourceOff();
  const second = await h.request(); assert.equal(second.status, 200);
  assert.equal((await h.ended(second.body.execution.id)).context.status, 'completed');
  assert.equal(h.calls.submit, 1); assert.equal(h.calls.collect.length, 1); assert.equal(h.calls.source, 0);
});

for (const [label, mutate] of [
  ['prompt', h => { h.snapshot.nodes.at(-1).data.prompt = 'edited'; }],
  ['model', h => { h.snapshot.nodes.at(-1).data.params.model = 'other-model'; }],
  ['operation', h => { h.snapshot.nodes.at(-1).data.params.operation = 'image_to_image'; }],
  ['routing', h => { h.snapshot.nodes.at(-1).data.params.routing = { allowedGroups: ['new-group'] }; }],
  ['slot binding', h => { h.snapshot.nodes.at(-1).data.slotBindings = { reference_images: [{ edgeId: 'edge', sourceNodeId: 'source', use: 'active' }] }; }],
  ['connection', h => { h.snapshot.edges[0].targetHandle = 'different'; }],
  ['source text', h => { h.snapshot.nodes[0].data.content = 'edited upstream'; }],
]) test(`changed ${label} never automatically inherits old task and new submit admission stays strict`, async t => {
  const h = harness(t, { source: true }); const first = await h.request(); assert.equal(first.status, 200); await h.ended(first.body.execution.id);
  mutate(h); h.catalogOff();
  const second = await h.request(); assert.equal(second.status, 400); assert.equal(h.calls.collect.length, 0); assert.equal(h.calls.submit, 1);
  const options = { workspaceId: h.snapshot.id, nodes: [h.snapshot.nodes.at(-1)], edges: h.snapshot.edges,
    inputSignatures: executionInputSignatures(h.snapshot) };
  assert.deepEqual(h.manager.findRecoverableTasks(options), {});
});

// Pre-unification Agent/Headless passed the prepared subset and external
// nodeOutputs to createExecution, without the raw workspace identity.
async function recordOldSingleNodeExecution(h) {
  const prepared = prepareExecutionSlotGraph(h.snapshot.nodes, h.snapshot.edges, mockCatalog());
  const initialOutputs = buildInitialOutputs({ ...prepared, id: h.snapshot.id }, new Set(['target']), { mediaDir: join(h.root, 'media') });
  const entry = h.manager.createExecution({ workspaceId: h.snapshot.id, nodes: [prepared.nodes.at(-1)],
    edges: prepared.edges, initialOutputs });
  await h.ended(entry.context.id);
  assert.equal(entry.context.status, 'error');
  const ref = entry.context.readNodeUpstreamTask('target');
  assert.ok(ref);
  h.restart();
  return { ref, id: entry.context.id };
}

async function checkOldEntry(t, entry) {
  const h = harness(t, { source: true });
  const { ref } = await recordOldSingleNodeExecution(h);
  h.catalogOff();
  const catalogCalls = h.calls.catalog;
  const deps = { store: { get: () => h.snapshot, resolveProjectRoot: () => h.root }, mediaDir: join(h.root, 'media'),
    getCatalog: h.gateway.capabilities, executionManager: h.manager };
  const result = entry === 'Agent'
    ? await createWorkflowRunTool(deps).execute({ workspace_id: h.snapshot.id, mode: 'single', node_ids: ['target'] })
    : await createHeadlessExecutionSeam({ ...deps, workspaceStore: deps.store }).executeHeadless({ workspaceId: h.snapshot.id, mode: 'single', nodeIds: ['target'] });
  assert.equal((await h.ended(result.executionId)).context.status, 'completed');
  assert.equal(h.calls.catalog, catalogCalls);
  assert.equal(h.calls.submit, 1);
  assert.deepEqual(h.calls.collect, [ref]);
}
test('old prepared Agent ledger collects unselected text after restart without a catalog', t => checkOldEntry(t, 'Agent'));
test('old prepared Headless ledger collects unselected text after restart without a catalog', t => checkOldEntry(t, 'Headless'));

async function checkOldEditedInput(t, edit) {
  const h = harness(t, { source: true });
  await recordOldSingleNodeExecution(h);
  edit(h);
  const result = await h.request();
  assert.equal(result.status, 200);
  const entry = await h.ended(result.body.execution.id);
  assert.equal(entry.context.get('executionInputsChanged').target, true);
  assert.equal(h.calls.submit, 2);
  assert.deepEqual(h.calls.collect, []);
}
test('changed source text cannot collect from an old prepared ledger', t => checkOldEditedInput(t, h => { h.snapshot.nodes[0].data.content = 'another source'; }));
test('changed explicit occupancy cannot collect from an old prepared ledger', t => checkOldEditedInput(t, h => { h.snapshot.nodes[1].data.slotBindings = {}; }));
test('changed explicit parameters start new work after an old prepared run', t => checkOldEditedInput(t, h => { h.snapshot.nodes[1].data.params.seed = 123; }));
test('changed explicit model starts new work after an old prepared run', t => checkOldEditedInput(t, h => {
  h.snapshot.nodes[1].data.params.model = 'image-2';
  h.gateway.capabilities = () => {
    const catalog = mockCatalog();
    catalog.models.push({ ...catalog.models.find(model => model.id === 'mock-image-1'), id: 'image-2' });
    catalog.image.push({ ...catalog.image[0], id: 'image-2' });
    return catalog;
  };
}));
test('changed explicit operation goes through normal admission after an old prepared run', async t => {
  const h = harness(t, { source: true });
  await recordOldSingleNodeExecution(h);
  h.snapshot.nodes[1].data.params.operation = 'image_to_image';
  const result = await h.request();
  assert.equal(result.status, 400);
  assert.notEqual(result.body.reasonCode, 'previous_task_input_unverified');
  assert.equal(h.calls.submit, 1);
  assert.deepEqual(h.calls.collect, []);
});

test('unprovable old catalog defaults expose the accepted task without submitting again', async t => {
  const h = harness(t, { source: true });
  delete h.snapshot.nodes[1].data.params.model;
  const { ref, id } = await recordOldSingleNodeExecution(h);
  h.catalogOff();
  const result = await h.request();
  assert.equal(result.status, 400);
  assert.equal(result.body.reasonCode, 'previous_task_input_unverified');
  assert.ok(result.body.message.includes(id));
  assert.ok(result.body.message.includes(ref.taskId));
  assert.equal(h.calls.submit, 1);
  assert.deepEqual(h.calls.collect, []);
});

test('unchanged old catalog defaults collect when the current projection matches', async t => {
  const h = harness(t, { source: true });
  delete h.snapshot.nodes[1].data.params.model;
  const { ref } = await recordOldSingleNodeExecution(h);
  const reads = h.calls.catalog;
  const result = await h.request();
  assert.equal(result.status, 200);
  assert.equal((await h.ended(result.body.execution.id)).context.status, 'completed');
  assert.equal(h.calls.catalog - reads, 1);
  assert.deepEqual(h.calls.collect, [ref]);
  assert.equal(h.calls.submit, 1);
});

test('old prepared ledger cannot prove local media bytes after the external file disappears', async t => {
  const h = harness(t, { source: true });
  const path = join(h.root, 'old-reference.png');
  writeFileSync(path, Buffer.from([1, 2, 3]));
  h.snapshot.nodes[0].data = { nodeKind: 'import', materialType: 'image', path, mimeType: 'image/png', sizeBytes: 3 };
  h.snapshot.nodes[1].data.params.operation = 'image_to_image';
  const { ref } = await recordOldSingleNodeExecution(h);
  rmSync(path);
  h.catalogOff();
  const result = await h.request();
  assert.equal(result.body.reasonCode, 'previous_task_input_unverified');
  assert.ok(result.body.message.includes(ref.taskId));
  assert.equal(h.calls.submit, 1);
  assert.deepEqual(h.calls.collect, []);
});

async function checkOldHttpLedger(t, edited) {
  const h = harness(t, { source: true });
  const original = await h.request();
  const id = original.body.execution.id;
  const ref = (await h.ended(id)).context.readNodeUpstreamTask('target');
  h.restart();
  const file = join(h.root, 'executions', id, 'execution.json');
  const record = JSON.parse(readFileSync(file, 'utf8'));
  delete record.variables.executionInputSignatureScope;
  writeFileSync(file, JSON.stringify(record));
  if (edited) h.snapshot.nodes[0].data.content = 'changed source';
  h.catalogOff();
  const result = await h.request();
  assert.equal(result.status, edited ? 400 : 200);
  if (!edited) assert.equal((await h.ended(result.body.execution.id)).context.status, 'completed');
  assert.deepEqual(h.calls.collect, edited ? [] : [ref]);
  assert.equal(h.calls.submit, 1);
}
test('old HTTP ledger accepts unchanged upstream text', t => checkOldHttpLedger(t, false));
test('old HTTP ledger rejects changed upstream text', t => checkOldHttpLedger(t, true));

test('unchanged signature is key-order independent but all unknown input fields matter', () => {
  const graph = { nodes: [{ id: 'n', type: 'material', data: { prompt: 'p', params: { seed: 1, model: 'm' } } }], edges: [] };
  const reordered = structuredClone(graph); reordered.nodes[0].data.params = { model: 'm', seed: 1 };
  assert.deepEqual(executionInputSignatures(graph), executionInputSignatures(reordered));
  reordered.nodes[0].data.futureInput = 'new'; assert.notDeepEqual(executionInputSignatures(graph), executionInputSignatures(reordered));
});

test('confirmed upstream terminal failure clears ref; stale local taskId and other workspace cannot recover', async t => {
  const h = harness(t, { error: new SeamGatewayError('omnimux-failed', 'terminal upstream failure') });
  const first = await h.request(); const entry = await h.ended(first.body.execution.id);
  assert.equal(entry.context.readNodeUpstreamTask('target'), undefined);
  h.snapshot.nodes[0].data.taskId = `exec-${first.body.execution.id}`;
  const options = { workspaceId: 'other-workspace', nodes: h.snapshot.nodes, edges: [], inputSignatures: executionInputSignatures(h.snapshot) };
  assert.deepEqual(h.manager.findRecoverableTasks(options), {});
  h.catalogOff(); assert.equal((await h.request()).status, 400); assert.equal(h.calls.collect.length, 0);
});

test('a newer completed execution prevents reviving an older error task', async t => {
  const h = harness(t); const first = await h.request(); await h.ended(first.body.execution.id);
  const second = await h.request(); assert.equal((await h.ended(second.body.execution.id)).context.status, 'completed');
  h.catalogOff(); const third = await h.request(); assert.equal(third.status, 400);
  assert.equal(h.calls.collect.length, 1); assert.equal(h.calls.submit, 1);
});

test('existing legitimate ref collects even with unreadable bound source and no catalog; no-ref still rejects', async t => {
  const h = harness(t); const executor = createMaterialGatewayExecutor({ gateway: h.gateway, resolveProjectFile: () => { throw new Error('must not read source'); } });
  h.catalogOff();
  const node = { id: 'target', type: 'material', data: { materialType: 'image', inputBindingVersion: 1,
    params: { model: 'gone-model' }, slotBindings: { reference_images: [{ edgeId: 'edge', sourceNodeId: 'missing-source', use: 'active' }] } } };
  let ref = { taskId: 'original-task', taskRef: 'mtask_original', capability: 'image', owner: 'omnimux', submittedAt: Date.now() };
  const ctx = { upstreamOutputs: new Map(), upstreamBindings: [], signal: new AbortController().signal, mediaDir: tmpdir(),
    readUpstreamTask: () => ref, clearUpstreamTask: () => { ref = undefined; } };
  const result = await executor.execute(node, ctx); assert.equal(result.mediaAssets[0].type, 'image'); assert.equal(h.calls.collect.length, 1);
  await assert.rejects(executor.execute(node, ctx), /catalog unavailable/); assert.equal(h.calls.submit, 0);
});

test('edited intent creates a genuinely new task when normal admission succeeds and records inputsChanged', async t => {
  const h = harness(t); const first = await h.request(); await h.ended(first.body.execution.id);
  h.snapshot.nodes[0].data.prompt = 'a different request';
  const second = await h.request(); assert.equal(second.status, 200);
  const entry = await h.ended(second.body.execution.id);
  assert.equal(h.calls.submit, 2); assert.equal(h.calls.collect.length, 0);
  assert.equal(entry.context.get('executionInputsChanged').target, true);
  assert.equal(entry.context.readNodeUpstreamTask('target').taskId, 'upstream-2');
});

test('legacy records without signatures and scheduled dependencies cannot be guessed into recovery', async t => {
  const h = harness(t, { source: true }); const first = await h.request(); const entry = await h.ended(first.body.execution.id);
  const options = { workspaceId: h.snapshot.id, nodes: h.snapshot.nodes, edges: h.snapshot.edges,
    inputSignatures: executionInputSignatures(h.snapshot) };
  assert.deepEqual(h.manager.findRecoverableTasks(options), {});
  entry.context.variables.delete('executionInputSignatures');
  options.nodes = [h.snapshot.nodes.at(-1)];
  assert.deepEqual(h.manager.findRecoverableTasks(options), {});
});

test('local artifact persistence interruption retains the collected task for another retry', async t => {
  const h = harness(t); const executor = createMaterialGatewayExecutor({ gateway: h.gateway }); h.catalogOff();
  const ref = { taskId: 'original-task', taskRef: 'mtask_original', capability: 'image', owner: 'omnimux', submittedAt: Date.now() };
  let cleared = false;
  await assert.rejects(executor.execute({ id: 'n', type: 'material', data: { materialType: 'image' } }, {
    upstreamOutputs: new Map(), signal: new AbortController().signal, mediaDir: tmpdir(), readUpstreamTask: () => ref,
    clearUpstreamTask: () => { cleared = true; }, persistGenerated: async () => { throw new Error('disk temporarily unavailable'); },
  }), /disk temporarily unavailable/);
  assert.equal(cleared, false); assert.equal(h.calls.submit, 0); assert.equal(h.calls.collect.length, 1);
});

// Each counterexample was walked through offline against the production route before solidification.
test('same absolute path with replaced bytes persists identity across restart and never inherits the old task', async t => {
  const h = harness(t, { source: true });
  const path = join(h.root, 'reference.png');
  writeFileSync(path, Buffer.from([1, 2, 3, 4]));
  h.snapshot.nodes[0].data = { nodeKind: 'import', materialType: 'image', path, mimeType: 'image/png', sizeBytes: 4 };
  h.snapshot.nodes[1].data.params.operation = 'image_to_image';
  const first = await h.request(); assert.equal(first.status, 200);
  const failed = await h.ended(first.body.execution.id);
  const original = failed.context.readNodeUpstreamTask('target'); assert.ok(original);
  const signatures = executionInputSignatures(h.snapshot);
  const savedBytes = failed.context.get('executionSourceIdentities');
  assert.equal(savedBytes.target[path], '9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a');
  h.restart();
  writeFileSync(path, Buffer.from([5, 6, 7, 8]));
  assert.deepEqual(executionInputSignatures(h.snapshot), signatures, 'graph identity alone is unchanged');
  const second = await h.request(); assert.equal(second.status, 200);
  const changed = await h.ended(second.body.execution.id);
  assert.equal(h.calls.submit, 2); assert.deepEqual(h.calls.collect, []);
  assert.equal(changed.context.get('executionInputsChanged').target, true);
  assert.equal(changed.context.readNodeUpstreamTask('target').taskId, 'upstream-2');
  assert.notEqual(changed.context.get('executionSourceIdentities').target[path], savedBytes.target[path]);
});

test('route catalog pause with another recovery completed first keeps its fixed accepted handle and zero duplicate submits', async t => {
  const h = harness(t);
  h.snapshot.nodes.push({ id: 'other', type: 'material', data: { materialType: 'image', prompt: 'other request',
    inputBindingVersion: 1, params: { model: 'mock-image-1', operation: 'text_to_image' } } });
  const submittedPrompts = [];
  const submit = h.gateway.submit;
  h.gateway.submit = async req => { submittedPrompts.push(req.prompt); return submit(req); };
  const first = await h.request(); const failed = await h.ended(first.body.execution.id);
  const original = failed.context.readNodeUpstreamTask('target'); assert.ok(original);
  let releaseCatalog;
  let catalogEntered;
  const paused = new Promise(resolve => { releaseCatalog = resolve; });
  const entered = new Promise(resolve => { catalogEntered = resolve; });
  h.gateway.capabilities = async () => { h.calls.catalog++; catalogEntered(); await paused; return mockCatalog(); };
  const pending = h.request({ nodeIds: ['target', 'other'] });
  await entered;
  try {
    const concurrent = await h.request(); assert.equal(concurrent.status, 200);
    assert.equal((await h.ended(concurrent.body.execution.id)).context.status, 'completed');
  } finally { releaseCatalog(); }
  const admitted = await pending; assert.equal(admitted.status, 200);
  const resumed = await h.ended(admitted.body.execution.id);
  assert.deepEqual(submittedPrompts, ['original request', 'other request']);
  assert.deepEqual(h.calls.collect, [original, original]);
  assert.equal(resumed.context.nodeStates.get('target').status, 'completed');
  assert.equal(resumed.context.get('executionInputsChanged').target, false);
  assert.equal(h.calls.submit, 2, 'one target and one genuinely new other task only');
});

async function checkAcceptedDuringLookup(t, alreadyAccepted) {
  const h = harness(t);
  const selected = ['target'];
  if (alreadyAccepted) {
    const other = structuredClone(h.snapshot.nodes[0]);
    other.id = 'other';
    other.data.prompt = 'other request';
    h.snapshot.nodes.push(other);
    selected.push(other.id);
    const first = await h.request({ nodeIds: [other.id] });
    assert.equal(first.status, 200);
    assert.equal((await h.ended(first.body.execution.id)).context.status, 'error');
  }

  const catalog = h.gateway.capabilities;
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  h.gateway.capabilities = async () => {
    h.gateway.capabilities = catalog;
    entered.resolve();
    await release.promise;
    return catalog();
  };
  const pending = h.request({ nodeIds: selected });
  await entered.promise;
  let accepted;
  try {
    const concurrent = await h.request();
    assert.equal(concurrent.status, 200);
    accepted = (await h.ended(concurrent.body.execution.id)).context.readNodeUpstreamTask('target');
    assert.ok(accepted);
  } finally { release.resolve(); }

  const admitted = await pending;
  assert.equal(admitted.status, 200);
  const recovered = await h.ended(admitted.body.execution.id);
  assert.equal(h.calls.submit, selected.length, 'each node submits exactly once');
  assert.equal(recovered.context.status, 'completed');
  assert.ok(h.calls.collect.some(ref => ref.taskRef === accepted.taskRef));
  assert.equal(h.calls.collect.length, selected.length);
  assert.equal(recovered.context.get('executionInputsChanged').target, false);
}
test('task accepted during catalog lookup is collected with an empty initial recovery plan', t => checkAcceptedDuringLookup(t, false));
test('task accepted during catalog lookup is collected alongside an earlier accepted node', t => checkAcceptedDuringLookup(t, true));

test('not-reconcilable recovery preserves upstream input and refuses fallback with zero new submits until complete admission', async t => {
  const h = harness(t, { source: true });
  const submittedPrompts = [];
  const submit = h.gateway.submit;
  h.gateway.submit = async req => { submittedPrompts.push(req.prompt); return submit(req); };
  const first = await h.request(); const failed = await h.ended(first.body.execution.id);
  const original = failed.context.readNodeUpstreamTask('target'); assert.ok(original);
  assert.deepEqual(submittedPrompts, ['来源 1：\nsource body\n\n补充要求：\noriginal request']);
  h.gateway.reconcileTask = async ref => { h.calls.collect.push(ref); throw new SeamGatewayError('omnimux-invalid-request', 'old task unknown'); };
  const retry = await h.request(); assert.equal(retry.status, 200);
  const rejected = await h.ended(retry.body.execution.id);
  assert.equal(rejected.context.status, 'error');
  assert.match(rejected.context.error, /重新确认完整输入/);
  assert.deepEqual(h.calls.collect, [original]); assert.equal(h.calls.submit, 1);
  assert.equal(rejected.context.get('executionInputsChanged').target, false);
  assert.equal(h.snapshot.nodes[0].data.content, 'source body');
  assert.equal(h.snapshot.edges.length, 1);
  // A later explicit normal attempt must re-admit every input, not reuse recovery's stripped outputs.
  h.catalogOff(); assert.equal((await h.request()).status, 400); assert.equal(h.calls.submit, 1);
  h.gateway.capabilities = async () => mockCatalog();
  h.snapshot.nodes[1].data.prompt = 'confirmed new request';
  const confirmed = await h.request(); assert.equal(confirmed.status, 200); await h.ended(confirmed.body.execution.id);
  assert.equal(h.calls.submit, 2);
  assert.match(submittedPrompts[1], /source body/);
  assert.match(submittedPrompts[1], /confirmed new request/);
});
