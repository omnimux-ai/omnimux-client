import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeGroupPublishPlan, buildPublishPlan } from './publishPlanAnalyzer.ts';

const textInput = {
  id: 'node-a',
  type: 'material',
  data: {
    label: '文本',
    materialType: 'text',
    selectedTool: 'text-editor',
    nodeKind: 'import',
    content: 'https://www.tiktok.com/@creator/video/123',
  },
};

const videoOutput = {
  id: 'node-b',
  type: 'material',
  data: {
    label: '视频保存',
    materialType: 'video',
    selectedTool: 'video-extraction',
    outputCapabilityId: 'video-extraction',
    nodeKind: 'generate',
  },
};

test('analyzeGroupPublishPlan derives one workflow, one input and one video output', () => {
  const analysis = analyzeGroupPublishPlan(
    [textInput, videoOutput],
    [{ id: 'edge-a-b', source: 'node-a', target: 'node-b' }],
    'group-1',
  );

  assert.equal(analysis.errors.length, 0);
  assert.equal(analysis.workflows.length, 1);
  assert.deepEqual(analysis.workflows[0].nodeIds, ['node-a', 'node-b']);
  assert.deepEqual(analysis.workflows[0].entryNodeIds, ['node-a']);
  assert.deepEqual(analysis.workflows[0].outputNodeIds, ['node-b']);

  assert.equal(analysis.inputs.length, 1);
  assert.equal(analysis.inputs[0].nodeId, 'node-a');
  assert.equal(analysis.inputs[0].widget, 'media-extractor');
  assert.equal(analysis.inputs[0].slotId, 'content');
  assert.equal(analysis.inputs[0].required, true);

  assert.equal(analysis.outputs.length, 1);
  assert.equal(analysis.outputs[0].nodeId, 'node-b');
  assert.equal(analysis.outputs[0].outputType, 'video');
  assert.equal(analysis.outputs[0].capabilityId, 'video-extraction');

  const plan = buildPublishPlan('group-1', analysis);
  assert.equal(plan.groupId, 'group-1');
  assert.equal(plan.graphHash.length, 64);
});

test('graph hash ignores input content but changes when capability/edges change', () => {
  const base = analyzeGroupPublishPlan(
    [textInput, videoOutput],
    [{ id: 'edge-a-b', source: 'node-a', target: 'node-b' }],
  );
  const changedText = {
    ...textInput,
    data: { ...textInput.data, content: 'https://www.tiktok.com/@creator/video/456' },
  };
  const changedInput = analyzeGroupPublishPlan(
    [changedText, videoOutput],
    [{ id: 'edge-a-b', source: 'node-a', target: 'node-b' }],
  );
  assert.equal(base.graphHash, changedInput.graphHash);

  const changedCapability = {
    ...videoOutput,
    data: { ...videoOutput.data, outputCapabilityId: 'video-generation' },
  };
  const changed = analyzeGroupPublishPlan(
    [textInput, changedCapability],
    [{ id: 'edge-a-b', source: 'node-a', target: 'node-b' }],
  );
  assert.notEqual(base.graphHash, changed.graphHash);
});

test('reports multiple disconnected workflows', () => {
  const secondInput = { ...textInput, id: 'node-c', data: { ...textInput.data, label: '文本2' } };
  const secondOutput = { ...videoOutput, id: 'node-d', data: { ...videoOutput.data, label: '视频2' } };
  const analysis = analyzeGroupPublishPlan(
    [textInput, videoOutput, secondInput, secondOutput],
    [
      { id: 'edge-a-b', source: 'node-a', target: 'node-b' },
      { id: 'edge-c-d', source: 'node-c', target: 'node-d' },
    ],
  );
  assert.equal(analysis.errors[0].code, 'multiple_workflows');
  assert.equal(analysis.workflows.length, 2);
});
