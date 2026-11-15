import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readNodeInputSource } from './graph/nodeInputSource.ts';
import { buildCanvasUpstreamFingerprint } from './graph/canvasInputSources.ts';
import { evaluateCatalogCompat, buildUpstreamFingerprint } from './validation/compatKernel.ts';
import { findExecutionReadinessFailure } from './validation/executionReadiness.ts';
import { collectMaterialSlotInputs } from '../workflow/execution/materialSlotInputs.ts';

const videoCatalog = {
  source: 'omnimux',
  text: [], image: [], video: [], audio: [],
  models: [{
    id: 'video-model',
    label: 'Video model',
    parameters: { duration: { range: { min: 1, max: 60 } } },
    operations: [{
      id: 'text_to_video', listed: true, output: { type: 'video' },
      inputs: [{ slot: 'prompt', type: 'text', role: 'prompt', source: 'node_field', min: 1, max: 1 }],
    }],
  }],
};

function documentNode() {
  return {
    id: 'doc-1',
    type: 'material',
    data: {
      materialType: 'document',
      nodeKind: 'import',
      selectedTool: 'import',
      label: '分镜脚本.json',
      originalName: '分镜脚本.json',
      mediaUrl: '/omnimux-workflow/api/local-file?path=%2Ftmp%2Fstoryboard.json',
      mimeType: 'application/json',
      status: 'ready',
      documentText: JSON.stringify({ prompt: '镜头从窗外推入。', duration: 8, shots: ['s1'] }),
    },
  };
}

test('JSON 上游进入画布指纹并作为视频提示词；模型兼容与执行就绪均通过', () => {
  const target = {
    id: 'target', type: 'material',
    data: { materialType: 'video', nodeKind: 'generate', selectedTool: 'video-generation', prompt: '', params: { model: 'video-model', operation: 'text_to_video' } },
  };
  const edges = [{ id: 'e-doc', source: 'doc-1', target: 'target' }];
  const fingerprint = buildCanvasUpstreamFingerprint('target', [documentNode(), target], edges);
  assert.match(fingerprint.prompt, /镜头从窗外推入/);
  assert.equal(fingerprint.assets.some((asset) => asset.type === 'document'), true);

  const evaluation = evaluateCatalogCompat(videoCatalog, fingerprint, { outputType: 'video' });
  assert.equal(evaluation.zeroCandidates, false);
  assert.equal(evaluation.compatible[0].readyToSubmit, true);

  assert.equal(findExecutionReadinessFailure([documentNode(), target], videoCatalog, {
    nodes: [documentNode(), target], edges,
  }), null);
});

test('JSON document 的 duration 在模型声明 duration 时进入执行参数覆盖', () => {
  const targetData = {
    materialType: 'video', nodeKind: 'generate', inputBindingVersion: 1,
    params: { model: 'video-model', operation: 'text_to_video' },
  };
  const ctx = {
    mediaDir: '/tmp', signal: new AbortController().signal,
    upstreamOutputs: new Map(),
    upstreamBindings: [{
      sourceNodeId: 'doc-1', edgeId: 'e-doc',
      output: {
        text: '镜头从窗外推入。',
        documentText: JSON.stringify({ prompt: '镜头从窗外推入。', duration: 8 }),
        mediaAssets: [{ type: 'document', url: '/omnimux-workflow/api/local-file?path=%2Ftmp%2Fstoryboard.json', mimeType: 'application/json' }],
      },
    }],
  };
  const result = collectMaterialSlotInputs(targetData, ctx, videoCatalog);
  assert.equal(result.documentDuration, 8);
  assert.match(result.prompt, /镜头从窗外推入/);
});

test('JSON document 空/无效在执行准入阶段被明确阻断', () => {
  const target = {
    id: 'target', type: 'material',
    data: { materialType: 'video', nodeKind: 'generate', selectedTool: 'video-generation', prompt: '', params: { model: 'video-model', operation: 'text_to_video' } },
  };
  const bad = documentNode();
  bad.data.documentText = '{"prompt":';
  const fingerprint = buildUpstreamFingerprint({
    prompt: '本地提示词',
    assets: [{
      sourceNodeId: 'doc-1', edgeId: 'e-doc', type: 'document', mimeType: 'application/json',
      textContent: undefined, availability: 'unavailable', availabilityMessage: 'JSON 文件解析失败：Unexpected end',
    }],
  });
  const evaluation = evaluateCatalogCompat(videoCatalog, fingerprint, { outputType: 'video' });
  assert.equal(evaluation.zeroCandidates, false);
  const failure = findExecutionReadinessFailure([bad, target], videoCatalog, {
    nodes: [bad, target], edges: [{ id: 'e-doc', source: 'doc-1', target: 'target' }],
  });
  assert.equal(failure?.reasonCode, 'input_unavailable');
  assert.match(failure?.message ?? '', /解析失败|不可用/);
});
