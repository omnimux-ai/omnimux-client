import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';
import { namedPickerState, openNamedPicker, planNamedPickerMutation } from '../editor/utils/resourcePickerPolicy.ts';
import { prepareExecutionSlotGraph, readPreparedExecutionInputs } from '../../shared/graph/feedSlot/prepareExecutionSlotGraph.ts';
import { catalogFor, operation, slot } from '../../workflow/seam/submissionFixtures.mjs';

const compiled = await build({
  entryPoints: [new URL('./canvasStore.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
});
const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
  createRequire(import.meta.url), mod, mod.exports,
);
const store = mod.exports.useCanvasStore;

const node = (id, x) => ({
  id,
  type: 'material',
  position: { x, y: 100 },
  data: { label: id, materialType: 'text', content: `内容 ${id}` },
});
const edges = [
  { id: 'c-a', source: 'c', target: 'a', sourceHandle: 'out', targetHandle: 'in' },
  { id: 'a-b', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in' },
];

function seed() {
  store.getState().hydrateGraph([node('a', 100), node('b', 390), node('c', 700)], edges);
}

function findNode(id) {
  return store.getState().nodes.find((item) => item.id === id);
}

test('group, collapse and dissolve are individual history steps even with no render between them', () => {
  seed();
  const state = store.getState();
  const group = state.groupNodes(['a', 'b']);
  assert.ok(group);
  state.toggleGroupCollapse(group);
  state.ungroup(group);
  assert.equal(store.getState().past.length, 3);
  assert.equal(findNode(group), undefined);

  state.undo();
  assert.equal(findNode(group).data.isCollapsed, true);
  assert.equal(findNode('a').parentId, group);
  state.undo();
  assert.equal(findNode(group).data.isCollapsed, false);
  state.undo();
  assert.equal(findNode(group), undefined);
  assert.deepEqual(store.getState().nodes, [node('a', 100), node('b', 390), node('c', 700)]);

  state.redo();
  assert.equal(findNode(group).data.isCollapsed, false);
  state.redo();
  assert.equal(findNode(group).data.isCollapsed, true);
  state.redo();
  assert.equal(findNode(group), undefined);
  assert.equal(findNode('a').parentId, undefined);
  assert.equal(findNode('b').data.content, '内容 b');
  assert.deepEqual(store.getState().edges, edges);
});

test('undoing dissolve restores the moved group and selection or measurements preserve redo', () => {
  seed();
  const state = store.getState();
  const group = state.groupNodes(['a', 'b']);
  const start = findNode(group).position;
  const moved = { x: start.x + 68, y: start.y + 43 };
  state.onNodesChange([{ id: group, type: 'position', position: moved, dragging: false }]);
  state.ungroup(group);
  assert.deepEqual(findNode('a').position, { x: 168, y: 143 });
  assert.deepEqual(findNode('b').position, { x: 458, y: 143 });

  state.undo();
  assert.deepEqual(findNode(group).position, moved);
  state.onNodesChange([
    { id: group, type: 'select', selected: false },
    { id: 'a', type: 'dimensions', dimensions: { width: 300, height: 190 } },
  ]);
  state.onEdgesChange([{ id: 'c-a', type: 'select', selected: true }]);
  state.pushHistory(true);
  assert.equal(store.getState().future.length, 1);

  state.redo();
  assert.equal(findNode(group), undefined);
  assert.deepEqual(findNode('a').position, { x: 168, y: 143 });
  assert.deepEqual(findNode('c').position, { x: 700, y: 100 });
  assert.deepEqual(store.getState().edges, edges);
});

test('dragging immediately after grouping undoes back to the new group before its move', (t) => {
  t.mock.method(Date, 'now', () => 1000);
  seed();
  const state = store.getState();
  const group = state.groupNodes(['a', 'b']);
  const initial = findNode(group).position;
  const intermediate = { x: initial.x + 24, y: initial.y + 20 };
  const final = { x: initial.x + 68, y: initial.y + 43 };

  state.onNodesChange([{ id: group, type: 'position', position: intermediate, dragging: true }]);
  state.pushHistory();
  state.onNodesChange([{ id: group, type: 'position', position: final, dragging: false }]);
  state.pushHistory();

  assert.equal(store.getState().past.length, 2);
  state.undo();
  assert.deepEqual(findNode(group).position, initial);
  assert.equal(findNode('a').parentId, group);
  state.redo();
  assert.deepEqual(findNode(group).position, final);
  assert.deepEqual(store.getState().edges, edges);
});

test('invalid group actions leave history alone, and a real new edit clears redo', () => {
  seed();
  const state = store.getState();
  const group = state.groupNodes(['a', 'b']);
  state.toggleGroupCollapse(group);
  state.undo();
  assert.equal(state.groupNodes(['c']), null);
  state.toggleGroupCollapse('missing');
  state.ungroup('missing');
  assert.equal(store.getState().past.length, 1);
  assert.equal(store.getState().future.length, 1);

  state.setNodes((nodes) => nodes.map((item) => (
    item.id === 'c' ? { ...item, data: { ...item.data, label: '新标签' } } : item
  )));
  state.pushHistory();
  assert.equal(store.getState().future.length, 0);
  state.undo();
  assert.equal(findNode('c').data.label, 'c');
  assert.equal(findNode(group).data.isCollapsed, false);
});


test('discrete video selection restores each prior line without waiting between edits', () => {
  const state = store.getState();
  const model = 'grouped-example';
  const operation = 'video_multi_ref';
  const line = (channelGroupId, resolution, duration) => ({
    model, operation, routing: { channelGroupId, allowedGroups: [channelGroupId], sourceType: 'official' },
    resolution, duration,
  });
  const economy = line('economy', '720p', 5);
  const studio = line('studio', '1080p', 10);
  const channelGroups = [economy, studio].map(({ routing, resolution, duration }) => ({
    id: routing.channelGroupId, label: routing.channelGroupId, effectiveVersion: 'one', effectiveOperations: [{
      id: operation,
      modeKind: 'image_reference',
      listed: true,
      output: { type: 'video' },
      inputs: [],
      parameters: {
        resolution: { options: [{ value: resolution }], defaultValue: resolution },
        duration: { options: [{ value: duration }], defaultValue: duration },
      },
    }],
  }));
  const modelEntry = { id: model, label: model, effectiveVideoVersion: 'one', selectable: true, operations: channelGroups[0].effectiveOperations, channelGroups };
  const initial = node('video', 100);
  initial.data = { ...initial.data, materialType: 'video', nodeKind: 'generate', selectedTool: 'video-generation', params: economy };
  state.resetStore();
  state.setCatalogRuntime({ source: 'omnimux', fingerprint: 'undo-test', models: [modelEntry], video: [modelEntry] });
  state.hydrateGraph([initial], []);
  for (const params of [studio, economy]) {
    const result = state.applyCanvasInputMutation({ nodePatches: [{ nodeId: 'video', data: { params } }] }, { undoStep: true });
    assert.equal(result.status, 'allowed', JSON.stringify(result));
    state.pushHistory();
  }

  state.undo();
  assert.deepEqual(findNode('video').data.params, studio);
  state.undo();
  assert.deepEqual(findNode('video').data.params, economy);
  state.redo();
  assert.deepEqual(findNode('video').data.params, studio);
  state.redo();
  assert.deepEqual(findNode('video').data.params, economy);
});

test('named first frame replacement reuses the connected edge and undo restores the previous submission', () => {
  const firstFrame = 'first_frame';
  const catalog = catalogFor('video', 'fixture', [operation(firstFrame, 'video', [slot('image', firstFrame, 1, 1, firstFrame)])]);
  const [a, b] = ['a', 'b'].map((id, index) => ({ ...node(id, index * 250), data: {
    materialType: 'image', nodeKind: 'import', mediaUrl: `https://example.test/${id}.png`,
  } }));
  const supply = [a, b].map(source => ({ id: `e-${source.id}`, source: source.id, target: 'target' }));
  const runtime = { catalog };

  for (const inputBindingVersion of [undefined, 1]) {
    const target = { ...node('target', 600), data: { materialType: 'video', nodeKind: 'generate', selectedTool: 'video-generation',
      prompt: 'Describe the shot', autoOperationId: null, inputBindingVersion,
      params: { model: 'fixture', operation: firstFrame },
      slotBindings: { first_frame: [{ sourceNodeId: a.id, edgeId: 'e-a', pinned: true }] } } };
    const state = store.getState();
    state.resetStore();
    state.setCatalogRuntime(catalog);
    state.hydrateGraph([target, a, b], supply);
    const before = store.getState();
    const picker = namedPickerState(before, target.id, runtime);
    const intent = openNamedPicker(picker, { slot: firstFrame, role: firstFrame, operationId: firstFrame, replaceEdgeId: 'e-a' });
    assert.ok(intent);
    const detached = namedPickerState({ ...before, edges: [supply[1]] }, target.id, runtime);
    const selection = [{ sourceNodeId: b.id, outputId: b.data.mediaUrl, targetSlot: firstFrame, role: firstFrame }];
    const stale = planNamedPickerMutation(detached, intent, selection, [], runtime);
    assert.equal(stale.reasonCode, 'input_changed');
    assert.equal(stale.mutation, undefined);

    function assertInputs(expected, overflow) {
      const live = store.getState();
      const prepared = prepareExecutionSlotGraph(live.nodes, live.edges, catalog);
      const preparedTarget = prepared.nodes.find(node => node.id === target.id);
      const assignment = readPreparedExecutionInputs(preparedTarget.data).assignment;
      const snapshot = prepared.runSnapshots.get(target.id);
      assert.deepEqual(assignment.unused.map(asset => [asset.edgeId, asset.unusedReason]), [[overflow, 'capacity']]);
      assert.deepEqual(snapshot.assigned.map(input => [input.sourceNodeId, input.targetSlot]), [[expected, firstFrame]]);
      assert.equal(live.nodes[0].data.params.operation, firstFrame);
      assert.equal(live.nodes[0].data.autoOperationId, null);
      assert.deepEqual(live.edges.map(edge => edge.id), ['e-a', 'e-b']);
    }

    assertInputs('a', 'e-b');
    const planned = planNamedPickerMutation(picker, intent, selection, [], runtime);
    assert.ok(planned.mutation, planned.reasonCode);
    assert.deepEqual(planned.mutation.addEdges, []);
    assert.equal(before.applyCanvasInputMutation(planned.mutation, { undoStep: true }).status, 'allowed');
    assertInputs('b', 'e-a');
    assert.equal(store.getState().past.length, 1);
    state.undo();
    assertInputs('a', 'e-b');
    assert.equal(store.getState().past.length, 0);
  }
});
