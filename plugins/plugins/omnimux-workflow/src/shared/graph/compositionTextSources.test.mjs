/**
 * Issue #28: composed text slots consume multiple ordered text sources even
 * when the contract's physical max is 1, and a new text edge appends instead
 * of replacing the earlier source.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoFillSlots } from './feedSlot/autoFillSlots.ts';
import { recomputeCanvasSlots } from './canvasSlotRecompute.ts';

const promptSlot = {
  slot: 'prompt', type: 'text', role: 'prompt', source: 'node_field', min: 1, max: 1,
  valueSources: ['local_field', 'upstream_output'],
  composition: { kind: 'content_with_instruction', localRole: 'instruction' },
};
const layout = {
  acceptsText: true, operationId: 'text_to_image', preset: 'strip',
  slots: [{ ...promptSlot, labelKey: 'panel.slot.prompt' }],
  swap: false, addButton: true, implementationGaps: [],
};
const textAsset = (id, content, ordinal) => ({
  edgeId: `e-${id}`, sourceNodeId: id, type: 'text', availability: 'ready',
  textContent: content, ordinal,
});

test('autoFillSlots appends multiple ordered sources into a composed text slot', () => {
  const fill = autoFillSlots([
    textAsset('text-1', '11111', 0),
    textAsset('text-2', '22222', 1),
  ], layout);
  assert.deepEqual(fill.bindings.prompt.map((occupant) => occupant.sourceNodeId), ['text-1', 'text-2']);
  assert.equal(fill.unusedFeed.length, 0);
});

const catalog = {
  source: 'omnimux',
  text: [], image: [], video: [], audio: [],
  defaults: { image: 'image-model' },
  defaultOperations: { image: { modelId: 'image-model', operationId: 'text_to_image', rule: 'auto' } },
  models: [{
    id: 'image-model', label: 'Image model', listed: true,
    operations: [{ id: 'text_to_image', label: '文生图', listed: true, output: { type: 'image' }, inputs: [promptSlot] }],
  }],
};
const textNode = (id, content) => ({
  id, type: 'material', position: { x: 0, y: 0 },
  data: { materialType: 'text', nodeKind: 'import', selectedTool: 'import', content },
});
const targetNode = (slotBindings) => ({
  id: 'target', type: 'material', position: { x: 0, y: 0 },
  data: {
    materialType: 'image', nodeKind: 'generate', selectedTool: 'text-to-image', inputBindingVersion: 1,
    prompt: '', params: { model: 'image-model', operation: 'text_to_image' }, slotBindings,
  },
});
const edge = (id) => ({ id: `e-${id}`, source: id, target: 'target', targetHandle: 'in' });

test('recomputeCanvasSlots self-heals a new image node with all text sources in order', () => {
  const nodes = [textNode('text-1', '11111'), textNode('text-2', '22222'), targetNode(undefined)];
  const result = recomputeCanvasSlots(targetNode(undefined), { nodes, edges: [edge('text-1'), edge('text-2')] }, { catalog });
  assert.deepEqual(result.data.slotBindings.prompt.map((occupant) => occupant.sourceNodeId), ['text-1', 'text-2']);
});

test('recomputeCanvasSlots appends a newly connected text edge instead of replacing the first', () => {
  const saved = targetNode({ prompt: [{ sourceNodeId: 'text-1', edgeId: 'e-text-1', outputId: 'text-1:current', ordinal: 0, pinned: true }] });
  const nodes = [textNode('text-1', '11111'), textNode('text-2', '22222'), saved];
  const result = recomputeCanvasSlots(saved, { nodes, edges: [edge('text-1'), edge('text-2')] }, { catalog },
    saved, new Set(['e-text-2']));
  assert.deepEqual(result.data.slotBindings.prompt.map((occupant) => occupant.sourceNodeId), ['text-1', 'text-2']);
});
