import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOmnimuxSeamClient } from './omnimuxGateway.ts';
import { createMaterialGatewayExecutor } from '../execution/materialGatewayExecutor.ts';
import { registerExecutor } from '../executors/registry.ts';
import { createDispatchingNodeExecutor } from '../execution/nodeExecutors.ts';
import { createAutoSwitchGateway } from './gatewaySelection.ts';
import { createMockGateway } from './mockGateway.ts';
import { openWorkflowSubmission, resolveCanvasSubmission, resolveExecutorSubmission } from './submitGuard.ts';
import { buildContractView, buildUpstreamFingerprint, evaluateModelCompat } from '../../shared/validation/compatKernel.ts';
import { catalogFor, operation, slot } from './submissionFixtures.mjs';

const root = mkdtempSync(join(tmpdir(), 'submit-guard-469-'));
after(() => rmSync(root, { recursive: true, force: true }));
const first = slot('image', 'first_frame', 1, 1, 'start_frame');
const last = slot('image', 'last_frame', 1, 1, 'end_frame');
const frameOp = operation('first_last_frame', 'video', [first, last], false);
const catalog = catalogFor('video', 'seedance-2-5', [
  frameOp, operation('text_to_video', 'video'),
  { ...operation('draft', 'video'), listed: false }, operation('wrong-output', 'image'),
]);
const reference = (role = 'first_frame', targetSlot = 'start_frame') => ({
  type: 'image', role, targetSlot, pathOrUrl: 'https://example.test/frame.png',
  sourceNodeId: 'frame-node', edgeId: `edge-${targetSlot}`, mimeType: 'image/png', sizeBytes: 100,
});
const request = (overrides = {}) => ({ capability: 'video', model: 'seedance-2-5',
  operation: 'text_to_video', prompt: 'A real prompt', dest: join(root, 'out.mp4'), ...overrides });

for (const mode of ['live', 'mock']) {
  test(`${mode}: invalid model/operation, slots and assets are rejected before execution`, async () => {
    let seamCalls = 0;
    const gateway = mode === 'mock' ? createMockGateway({ minLatencyMs: 0, maxLatencyMs: 0, catalog: () => catalog })
      : createOmnimuxSeamClient({ getSeam: (name) => name === 'modelCatalog' ? { list: () => catalog }
        : { execute: async () => { seamCalls++; return { mode: 'submitted', taskId: 'forbidden' }; } } });
    const cases = [
      [{ model: 'unknown' }, 'model-not-allowed'],
      [{ operation: undefined }, 'operation-required'],
      [{ operation: '   ' }, 'operation-required'],
      [{ operation: 't2v' }, 'operation-not-allowed'],
      [{ operation: 'draft' }, 'operation-not-allowed'],
      [{ operation: 'wrong-output' }, 'operation-not-allowed'],
      [{ prompt: '  ' }, 'prompt_required'],
      [{ operation: 'first_last_frame', references: [reference()] }, 'min_unsatisfied'],
      [{ references: [reference()] }, 'role_conflict'],
      [{ operation: 'first_last_frame', references: [reference(), { ...reference('last_frame', 'end_frame'), pathOrUrl: 'blob:preview' }] }, 'input_unavailable'],
      [{ operation: 'first_last_frame', references: [reference(), { ...reference('last_frame', 'end_frame'), pathOrUrl: join(root, 'missing.png') }] }, 'input_unavailable'],
      [{ operation: 'first_last_frame', references: [reference(), { ...reference('last_frame', 'end_frame'), mimeType: 'audio/wav' }] }, 'mime_unsupported'],
      [{ operation: 'first_last_frame', references: [reference(), reference('first_frame', 'end_frame')] }, 'role_conflict'],
      [{ operation: 'first_last_frame', references: [reference(), reference(), reference('last_frame', 'end_frame')] }, 'slot_capacity'],
      [{ references: [{ type: 'document', pathOrUrl: 'https://example.test/a.pdf' }] }, 'operation_incompatible'],
    ];
    for (const [overrides, code] of cases) {
      await assert.rejects(gateway.submit(request(overrides)), { name: 'SeamGatewayError', code });
    }
    assert.equal(seamCalls, 0);
    assert.equal(existsSync(join(root, 'out.mp4')), false, 'rejected mock submits never create artifacts');
  });
}

test('partial frame input accepts connections but is not ready to submit', () => {
  const fingerprint = buildUpstreamFingerprint({ assets: [{ ...reference(), sourceNodeId: 'frame-node' }] });
  const verdict = evaluateModelCompat(buildContractView(catalog).models[0], fingerprint, { operationId: 'first_last_frame', outputType: 'video' });
  assert.equal(verdict.acceptsCurrentInputs, true);
  assert.equal(verdict.readyToSubmit, false);
  assert.throws(() => resolveCanvasSubmission(request({ operation: 'first_last_frame', references: [reference()] }), catalog), { code: 'min_unsatisfied' });
});

test('explicit valid frames need no prompt and resume ignores changed catalog or removed source', async () => {
  const local = join(root, 'input.png');
  writeFileSync(local, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const references = [reference(), reference('last_frame', 'end_frame')].map((ref) => ({ ...ref, pathOrUrl: local }));
  const captured = [];
  let catalogReads = 0;
  const gateway = createOmnimuxSeamClient({ getSeam: (name) => name === 'modelCatalog'
    ? { list() { assert.equal(catalogReads++, 0); return catalog; } }
    : name === 'videoGenerate' ? { execute: async (req) => {
      captured.push(req);
      return req.taskId ? { mode: 'live', type: 'video', url: 'https://example.test/done.mp4', mimeType: 'video/mp4', durationSec: 3 }
        : { mode: 'submitted', taskId: 'resume' };
    } } : undefined });
  const submitted = await gateway.submit(request({ operation: 'first_last_frame', prompt: '', references }));
  rmSync(local);
  const settled = await gateway.awaitTask(submitted.taskId, join(root, 'resume.mp4'));
  assert.equal(captured.length, 2);
  assert.deepEqual(captured[0].references, references.map((ref) => ({ ...ref, sizeBytes: 4 })));
  assert.deepEqual(captured[1], { taskId: 'resume', dest: join(root, 'resume.mp4') });
  assert.equal(settled.durationSec, 3);
  assert.equal(settled.type, 'video');
});

test('executor resolves unique/automatic operations but never silently replaces an explicit choice', () => {
  const textCatalog = catalogFor('text', 'gemini-3.8-flash', [operation('chat', 'text'), operation('vision_chat', 'text', [slot('image', 'reference', 1)])]);
  const text = { capability: 'text', prompt: 'one word', dest: '/unused' };
  assert.equal(resolveExecutorSubmission(text, textCatalog).operation, 'chat');
  assert.equal(resolveExecutorSubmission({ ...text, references: [{ ...reference('reference'), targetSlot: undefined }] }, textCatalog).operation, 'vision_chat');
  assert.throws(() => resolveExecutorSubmission({ ...text, operation: 'chat', references: [reference()] }, textCatalog), { code: 'role_conflict' });
  const only = catalogFor('video', 'single', [operation('single_video', 'video')]);
  assert.equal(resolveExecutorSubmission({ capability: 'video', prompt: 'go', dest: '/unused' }, only).operation, 'single_video');
  assert.throws(() => resolveExecutorSubmission(request({ operation: undefined }), catalog), /请选择生成方式/);
});

test('metadata constraints reject missing, oversized and overlong references in both gateways', async () => {
  const limited = catalogFor('video', 'seedance-2-5', [operation('reference_video', 'video', [{
    ...slot('video', 'reference', 1), maxSizeMb: 1, minDurationSec: 1, maxDurationSec: 5, allowedMimes: ['video/mp4'],
  }])]);
  for (const mode of ['live', 'mock']) {
    let calls = 0;
    const gateway = mode === 'mock' ? createMockGateway({ catalog: () => limited })
      : createOmnimuxSeamClient({ getSeam: (name) => name === 'modelCatalog' ? { list: () => limited }
        : { execute: async () => { calls++; } } });
    const ref = { type: 'video', role: 'reference', pathOrUrl: 'https://example.test/in.mp4', mimeType: 'video/mp4', sizeBytes: 10, durationSec: 2 };
    for (const [patch, code] of [[{ sizeBytes: undefined }, 'metadata_required'], [{ durationSec: undefined }, 'metadata_required'],
      [{ sizeBytes: 2 * 1024 * 1024 }, 'size_exceeded'], [{ durationSec: 6 }, 'duration_exceeded']]) {
      await assert.rejects(gateway.submit(request({ operation: 'reference_video', references: [{ ...ref, ...patch }] })), { code });
    }
    assert.equal(calls, 0);
  }
});

test('invalid text output is rejected before creating a text file', async () => {
  const textCatalog = catalogFor('text', 'gemini-3.8-flash', [operation('chat', 'text')]);
  const gateway = createOmnimuxSeamClient({ getSeam: (name) => name === 'modelCatalog' ? { list: () => textCatalog }
    : name === 'textComplete' ? { execute: async () => ({ type: 'image', url: 'https://example.test/wrong.png' }) } : undefined });
  const submitted = await gateway.submit({ capability: 'text', operation: 'chat', prompt: 'go', dest: join(root, 'text.txt') });
  await assert.rejects(gateway.awaitTask(submitted.taskId, join(root, 'text.txt')), { code: 'omnimux-invalid-response' });
  assert.equal(existsSync(join(root, 'text.txt')), false);
});

test('local-file video URL automatically self-heals duration and size via ffprobe when omitted', async () => {
  const samplePath = '/home/dev/Downloads/whirly-park-adventure.mp4';
  if (existsSync(samplePath)) {
    const localUrl = `/omnimux-workflow/api/local-file?path=${encodeURIComponent(samplePath)}`;
    const limited = catalogFor('video', 'minimax-h3', [operation('video_multi_ref', 'video', [{
      ...slot('video', 'reference', 0, 3, 'reference_videos'), maxSizeMb: 100, totalMinDurationSec: 1.8, totalMaxDurationSec: 15.2, allowedMimes: ['video/mp4'],
    }])]);
    const req = request({
      model: 'minimax-h3',
      operation: 'video_multi_ref',
      references: [{
        type: 'video',
        role: 'reference',
        targetSlot: 'reference_videos',
        pathOrUrl: localUrl,
        sourceNodeId: 'vid-19e3aa82',
        // durationSec and sizeBytes omitted!
      }],
    });
    const resolved = resolveCanvasSubmission(req, limited);
    assert.equal(resolved.references[0].durationSec, 8);
    assert.ok(resolved.references[0].sizeBytes > 1000000);
  }
});

async function assertFreshDispatchCatalog(backend) {
  let reads = 0;
  const current = catalogFor('text', 'fixture', [operation('chat', 'text')]);
  const read = () => { reads++; return current; };
  const getSeam = name => name === 'modelCatalog' ? { list: read }
    : name === 'textComplete' ? { execute: async () => ({ type: 'text', text: 'done' }) } : undefined;
  const gateway = backend === 'mock' ? createMockGateway({ catalog: read, minLatencyMs: 0, maxLatencyMs: 0 })
    : backend === 'auto' ? createAutoSwitchGateway({ getSeam }) : createOmnimuxSeamClient({ getSeam });
  registerExecutor(createMaterialGatewayExecutor({ gateway }));
  const dispatch = createDispatchingNodeExecutor({
    gateway, edges: [], mediaRoot: root, executionId: backend, abortController: new AbortController(),
  });
  await dispatch.executor({ id: 'target', type: 'material', data: {
    materialType: 'text', prompt: 'go', params: { model: 'fixture', operation: 'chat' },
  } }, { getNodeOutput() {}, addMediaAsset() {}, reportProgress() {} });
  assert.equal(reads, 1);

  current.models[0].operations[0].listed = false;
  const raw = { capability: 'text', model: 'fixture', operation: 'chat', prompt: 'go', dest: join(root, 'unused') };
  await assert.rejects(gateway.submit(raw), { code: 'model-not-allowed' });
  assert.equal(reads, 2);
}

test('mock dispatch uses one catalog and refreshes it on the next submission', async () => {
  await assertFreshDispatchCatalog('mock');
});

test('official dispatch uses one catalog and refreshes it on the next submission', async () => {
  await assertFreshDispatchCatalog('omnimux');
});

test('automatic dispatch uses one catalog and refreshes it on the next submission', async () => {
  await assertFreshDispatchCatalog('auto');
});

test('editing the dispatch working catalog cannot add an operation to the submission contract', async () => {
  const gateway = createMockGateway({ catalog: () => catalog });
  const submission = await openWorkflowSubmission(gateway);
  submission.catalog.models[0].operations.push(operation('invented', 'video'));
  await assert.rejects(submission.submit(request({ operation: 'invented' })), { code: 'operation-not-allowed' });
});

test('auto upgrade during preparation validates against the new backend before submitting', async () => {
  const local = catalogFor('text', 'local', [operation('chat', 'text')]);
  const official = catalogFor('text', 'official', [operation('chat', 'text')]);
  let mounted = false;
  let liveReads = 0;
  const gateway = createAutoSwitchGateway({
    mockGateway: createMockGateway({ catalog: () => local }),
    getSeam: name => !mounted ? undefined : name === 'modelCatalog'
      ? { list: () => { liveReads++; return official; } }
      : name === 'textComplete' ? { execute: async () => ({ text: 'done' }) } : undefined,
  });
  const submission = await openWorkflowSubmission(gateway);
  mounted = true;
  const req = { capability: 'text', operation: 'chat', model: 'local', prompt: 'ok', dest: join(root, 'upgrade') };
  await assert.rejects(submission.submit(req), { code: 'model-not-allowed' });
  assert.equal(liveReads, 1);
});

test('dispatch awaits the gateway that accepted its task across executor registry replacements', async () => {
  const makeGateway = () => createMockGateway({ catalog: () => catalog, minLatencyMs: 0, maxLatencyMs: 0 });
  const dispatch = createDispatchingNodeExecutor({ gateway: makeGateway(), edges: [], mediaRoot: root,
    executionId: 'first-manager', abortController: new AbortController() });
  registerExecutor(createMaterialGatewayExecutor({ gateway: makeGateway() }));
  const result = await dispatch.executor({ id: 'target', type: 'material', data: {
    materialType: 'video', prompt: 'go', params: { model: 'seedance-2-5', operation: 'text_to_video' },
  } }, { getNodeOutput() {}, addMediaAsset() {}, reportProgress() {} });
  assert.equal(result.mediaAssets[0].type, 'video');
  assert.equal(result.simulated, true);
});
