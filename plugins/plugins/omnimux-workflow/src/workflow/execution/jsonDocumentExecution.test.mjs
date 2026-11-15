/**
 * Issue #27 execution-chain regressions: document imports must keep their
 * document identity, dispatch readiness must see the JSON text, and a standby
 * (removed) document must never leak prompt or duration into generation.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createImportExecutor } from './importExecutor.ts';
import { createDispatchingNodeExecutor } from './nodeExecutors.ts';
import { createMaterialGatewayExecutor } from './materialGatewayExecutor.ts';
import { registerExecutor } from '../executors/registry.ts';
import { collectMaterialSlotInputs } from './materialSlotInputs.ts';
import { assembleEffectiveInputsFromSlots } from '../../shared/graph/feedSlot/index.ts';

const rawDocument = JSON.stringify({ prompt: '镜头从窗外推入。', duration: 8, shots: ['s1'] });

const videoCatalog = {
  source: 'omnimux',
  schemaVersion: '1.1',
  defaults: { video: 'video-model' },
  text: [],
  image: [],
  video: [{ id: 'video-model', label: 'video-model' }],
  audio: [],
  models: [{
    id: 'video-model',
    label: 'video-model',
    listed: true,
    parameters: { duration: { range: { min: 1, max: 60 } } },
    operations: [{
      id: 'text_to_video', listed: true, output: { type: 'video' },
      inputs: [{ slot: 'prompt', role: 'prompt', type: 'text', source: 'node_field', min: 1, max: 1 }],
    }],
  }],
};

const importContext = () => ({
  upstreamOutputs: new Map(),
  signal: new AbortController().signal,
  mediaDir: '/tmp',
  workspaceId: 'ws_doc',
});

const documentOutput = () => ({
  text: '镜头从窗外推入。',
  documentText: rawDocument,
  mediaAssets: [{
    type: 'document',
    url: '/omnimux-workflow/api/local-file?path=%2Ftmp%2Fstoryboard.json',
    mimeType: 'application/json',
  }],
});

const fixtureRoot = mkdtempSync(join(tmpdir(), 'workflow-json-doc-'));
after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

test('B1: createImportExecutor keeps document type, documentText and parsed prompt', async () => {
  const output = await createImportExecutor().execute({
    id: 'doc-rel', type: 'material',
    data: {
      materialType: 'document', nodeKind: 'import', selectedTool: 'import',
      relativePath: 'assets/imported/storyboard.json', assetId: 'ast_doc',
      mimeType: 'application/json', documentText: rawDocument,
    },
  }, importContext());
  assert.equal(output.mediaAssets[0].type, 'document');
  assert.equal(output.mediaAssets[0].mimeType, 'application/json');
  assert.match(output.mediaAssets[0].url, /\/api\/workspaces\/ws_doc\/file\?rel=/);
  assert.equal(output.documentText, rawDocument);
  assert.equal(output.text, '镜头从窗外推入。');
});

test('B1: createImportExecutor reads documentText from a real .json file and reports invalid JSON', async () => {
  const realPath = join(fixtureRoot, 'storyboard.json');
  writeFileSync(realPath, rawDocument);
  const valid = await createImportExecutor().execute({
    id: 'doc-real', type: 'material',
    data: { materialType: 'document', nodeKind: 'import', selectedTool: 'import', realPath },
  }, importContext());
  assert.equal(valid.mediaAssets[0].type, 'document');
  assert.equal(valid.documentText, rawDocument);
  assert.equal(valid.text, '镜头从窗外推入。');

  const invalid = await createImportExecutor().execute({
    id: 'doc-bad', type: 'material',
    data: { materialType: 'document', nodeKind: 'import', selectedTool: 'import', mediaUrl: 'https://example.test/bad.json', documentText: '{"prompt":' },
  }, importContext());
  assert.equal(invalid.mediaAssets[0].type, 'document');
  assert.equal(invalid.documentText, '{"prompt":');
  assert.equal(invalid.text, undefined);
  assert.match(invalid.documentError ?? '', /解析失败/);
});

test('B2: document-only upstream passes dispatch readiness and carries prompt/duration', async () => {
  const requests = [];
  const gateway = {
    capabilities: async () => videoCatalog,
    submit: async (request) => { requests.push(request); return { taskId: 'captured', mode: 'mock' }; },
    awaitTask: async () => ({ type: 'video', url: 'https://example.test/out.mp4' }),
  };
  registerExecutor(createMaterialGatewayExecutor({ gateway }));
  const target = {
    id: 'target', type: 'material',
    data: {
      materialType: 'video', nodeKind: 'generate', inputBindingVersion: 1, prompt: '',
      params: { model: 'video-model', operation: 'text_to_video' }, slotBindings: {},
    },
  };
  const edges = [{ id: 'e-doc', source: 'doc-1', target: 'target', data: { feedType: 'document' } }];
  await createDispatchingNodeExecutor({
    gateway, mediaRoot: '/tmp', executionId: 'doc-readiness', edges,
    abortController: new AbortController(),
  }).executor(target, {
    getNodeOutput: (id) => (id === 'doc-1' ? documentOutput() : undefined),
    reportProgress() {},
    addMediaAsset() {},
  });
  assert.equal(requests.length, 1);
  assert.match(requests[0].prompt, /镜头从窗外推入/);
  assert.equal(requests[0].duration, 8);
});

test('B3: standby document contributes no prompt and no duration override', () => {
  const targetData = {
    materialType: 'video', nodeKind: 'generate', inputBindingVersion: 1,
    params: { model: 'video-model', operation: 'text_to_video' }, slotBindings: {},
  };
  const ctx = {
    mediaDir: '/tmp', signal: new AbortController().signal,
    upstreamOutputs: new Map(),
    upstreamBindings: [{ edgeId: 'e-doc', sourceNodeId: 'doc-1', output: documentOutput() }],
  };
  const active = collectMaterialSlotInputs({ ...targetData, slotStandbyEdgeIds: [] }, ctx, videoCatalog);
  assert.match(active.prompt, /镜头从窗外推入/);
  assert.equal(active.documentDuration, 8);

  const removed = collectMaterialSlotInputs({ ...targetData, slotStandbyEdgeIds: ['e-doc'] }, ctx, videoCatalog);
  assert.equal(removed.prompt, '');
  assert.equal(removed.documentDuration, undefined);
});

test('B3: effective inputs free-text assembly excludes standby document', () => {
  const layout = {
    acceptsText: true, operationId: 'text_to_video', preset: 'none',
    slots: [], swap: false, addButton: false, implementationGaps: [],
  };
  const feedAssets = [{
    edgeId: 'e-doc', sourceNodeId: 'doc-1', type: 'document', availability: 'ready',
    textContent: '镜头从窗外推入。', documentText: rawDocument, ordinal: 0,
  }];
  const active = assembleEffectiveInputsFromSlots({
    layout, bindings: {}, conflicts: [], nodeData: { inputBindingVersion: 1 }, feedAssets, incomingText: [],
  });
  assert.match(active.prompt, /镜头从窗外推入/);

  const removed = assembleEffectiveInputsFromSlots({
    layout, bindings: {}, conflicts: [], nodeData: { inputBindingVersion: 1 }, feedAssets, incomingText: [],
    standbyEdgeIds: ['e-doc'],
  });
  assert.equal(removed.prompt, '');
});
