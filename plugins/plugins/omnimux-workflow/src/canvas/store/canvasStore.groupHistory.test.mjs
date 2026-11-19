import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';

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
