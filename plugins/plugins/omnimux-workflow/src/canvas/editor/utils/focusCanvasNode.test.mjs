/**
 * 资产抽屉 onFocusNode：必须从 useReactFlow 解构 setCenter，
 * 点击素材列表项时把视口中心移到节点附近并单选该节点。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  FOCUS_NODE_DURATION,
  FOCUS_NODE_OFFSET,
  FOCUS_NODE_ZOOM,
  applyFocusCanvasNode,
  planFocusCanvasNode,
} from './focusCanvasNode.ts';

const here = dirname(fileURLToPath(import.meta.url));
const editorSrc = readFileSync(join(here, '..', 'CanvasEditor.tsx'), 'utf8');

test('CanvasEditor 从 useReactFlow 解构 setCenter（QA blocker 回归）', () => {
  assert.match(
    editorSrc,
    /const \{ screenToFlowPosition, fitView, zoomTo, setCenter \} = useReactFlow\(\);/,
  );
  assert.match(editorSrc, /applyFocusCanvasNode\(/);
  assert.match(editorSrc, /setCenter,/);
  assert.equal(
    /const \{ screenToFlowPosition, fitView, zoomTo \} = useReactFlow\(\);/.test(editorSrc),
    false,
    '不得再遗漏 setCenter 解构',
  );
});

test('planFocusCanvasNode：命中节点时偏移 100px，zoom=1，duration=800', () => {
  const plan = planFocusCanvasNode(
    [{ id: 'img-hero', position: { x: 240, y: 80 } }],
    'img-hero',
  );
  assert.deepEqual(plan, {
    focused: true,
    nodeId: 'img-hero',
    x: 240 + FOCUS_NODE_OFFSET,
    y: 80 + FOCUS_NODE_OFFSET,
    zoom: FOCUS_NODE_ZOOM,
    duration: FOCUS_NODE_DURATION,
  });
});

test('planFocusCanvasNode：缺节点 / 空 id / 非数组不聚焦', () => {
  assert.deepEqual(planFocusCanvasNode([], 'missing'), { focused: false });
  assert.deepEqual(
    planFocusCanvasNode([{ id: 'a', position: { x: 0, y: 0 } }], ''),
    { focused: false },
  );
  assert.deepEqual(planFocusCanvasNode(undefined, 'a'), { focused: false });
});

test('applyFocusCanvasNode：调用 setCenter 并单选目标节点', () => {
  const calls = [];
  let selected = [];
  const nodes = [
    { id: 'keep', position: { x: 0, y: 0 }, selected: true },
    { id: 'focus-me', position: { x: 40, y: 60 }, selected: false },
  ];

  const focused = applyFocusCanvasNode({
    nodes,
    nodeId: 'focus-me',
    setCenter(x, y, options) {
      calls.push({ x, y, options });
    },
    setNodes(updater) {
      selected = updater(nodes).map((node) => ({ id: node.id, selected: node.selected }));
    },
  });

  assert.equal(focused, true);
  assert.deepEqual(calls, [
    {
      x: 40 + FOCUS_NODE_OFFSET,
      y: 60 + FOCUS_NODE_OFFSET,
      options: { zoom: FOCUS_NODE_ZOOM, duration: FOCUS_NODE_DURATION },
    },
  ]);
  assert.deepEqual(selected, [
    { id: 'keep', selected: false },
    { id: 'focus-me', selected: true },
  ]);
});

test('applyFocusCanvasNode：未知节点不调用 setCenter / setNodes', () => {
  let centerCalls = 0;
  let nodeCalls = 0;
  const focused = applyFocusCanvasNode({
    nodes: [{ id: 'keep', position: { x: 1, y: 1 } }],
    nodeId: 'ghost',
    setCenter() {
      centerCalls += 1;
    },
    setNodes() {
      nodeCalls += 1;
    },
  });
  assert.equal(focused, false);
  assert.equal(centerCalls, 0);
  assert.equal(nodeCalls, 0);
});
