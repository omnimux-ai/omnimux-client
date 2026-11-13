import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateGroupBounds,
  toRelativeCoordinates,
  toAbsoluteCoordinates,
  clampGroupResize,
  planGroupNodes,
  planUngroupNode,
  planToggleGroupCollapse,
  screenDeltaToFlowDelta,
  childIdsOfGroup,
  COLLAPSED_GROUP_WIDTH,
  COLLAPSED_GROUP_HEIGHT,
  DEFAULT_GROUP_COLOR,
} from './nodeVisualMath.ts';

test('calculateGroupBounds: 两个节点包围盒计算含 24px Padding', () => {
  const nodes = [
    { position: { x: 100, y: 100 }, width: 300, height: 200 },
    { position: { x: 500, y: 300 }, width: 200, height: 150 },
  ];
  const bounds = calculateGroupBounds(nodes, 24);
  assert.equal(bounds.x, 76);
  assert.equal(bounds.y, 76);
  assert.equal(bounds.width, 648);
  assert.equal(bounds.height, 398);
  assert.equal(bounds.minWidth, 648);
  assert.equal(bounds.minHeight, 398);
});

test('calculateGroupBounds: 空数组返回安全默认尺寸', () => {
  const bounds = calculateGroupBounds([]);
  assert.equal(bounds.x, 0);
  assert.equal(bounds.y, 0);
  assert.equal(bounds.width, 400);
  assert.equal(bounds.height, 300);
});

test('坐标转换: 绝对坐标与相对坐标正反双向转换无损', () => {
  const groupPos = { x: 200, y: 150 };
  const absNodePos = { x: 350, y: 400 };

  const rel = toRelativeCoordinates(absNodePos, groupPos);
  assert.deepEqual(rel, { x: 150, y: 250 });

  const restoredAbs = toAbsoluteCoordinates(rel, groupPos);
  assert.deepEqual(restoredAbs, absNodePos);
});

test('clampGroupResize: SE 右下角向外拉大不受阻碍', () => {
  const current = { x: 100, y: 100, width: 400, height: 300 };
  const minAllowed = { minWidth: 400, minHeight: 300 };
  const resized = clampGroupResize('se', current, { dx: 50, dy: 60 }, minAllowed);

  assert.equal(resized.width, 450);
  assert.equal(resized.height, 360);
  assert.equal(resized.x, 100);
  assert.equal(resized.y, 100);
});

test('clampGroupResize: SE 右下角向内缩小被 minWidth/minHeight 限制', () => {
  const current = { x: 100, y: 100, width: 450, height: 350 };
  const minAllowed = { minWidth: 400, minHeight: 300 };
  const resized = clampGroupResize('se', current, { dx: -100, dy: -100 }, minAllowed);

  assert.equal(resized.width, 400);
  assert.equal(resized.height, 300);
});

test('clampGroupResize: NW 左上角向外扩大更新 x, y, width, height', () => {
  const current = { x: 100, y: 100, width: 400, height: 300 };
  const minAllowed = { minWidth: 400, minHeight: 300 };
  const resized = clampGroupResize('nw', current, { dx: -50, dy: -40 }, minAllowed);

  assert.equal(resized.x, 50);
  assert.equal(resized.y, 60);
  assert.equal(resized.width, 450);
  assert.equal(resized.height, 340);
});

test('planGroupNodes: 生成 GroupNode 并将子节点转为相对坐标', () => {
  const initialNodes = [
    {
      id: 'node_1',
      type: 'material',
      position: { x: 100, y: 100 },
      width: 300,
      height: 200,
      data: { title: 'Node 1' },
    },
    {
      id: 'node_2',
      type: 'material',
      position: { x: 500, y: 300 },
      width: 200,
      height: 150,
      data: { title: 'Node 2' },
    },
  ];

  const plan = planGroupNodes(initialNodes, ['node_1', 'node_2'], '我的精修组', '#10b981');
  assert.ok(plan);
  assert.equal(plan.nodes.length, 3);

  const groupNode = plan.nodes.find((n) => n.id === plan.groupId);
  assert.ok(groupNode);
  assert.equal(groupNode.type, 'group');
  assert.equal(groupNode.data.title, '我的精修组');
  assert.equal(groupNode.data.color, '#10b981');

  const child1 = plan.nodes.find((n) => n.id === 'node_1');
  const child2 = plan.nodes.find((n) => n.id === 'node_2');
  assert.equal(child1.parentId, plan.groupId);
  assert.equal(child2.parentId, plan.groupId);
  assert.equal(child1.position.x, 32);
  // 考虑 material 节点 28px headerOffset 后，卡片 y 为 60（标题栏位于 60-28=32px 留白处）
  assert.equal(child1.position.y, 60);
});

test('calculateGroupBounds: 自动适配 text 节点 (350x500) 与外挂标题栏', () => {
  const textNodes = [
    {
      id: 't1',
      type: 'material',
      position: { x: 100, y: 100 },
      data: { materialType: 'text', label: '爆款短剧' },
    },
    {
      id: 't2',
      type: 'material',
      position: { x: 500, y: 100 },
      data: { materialType: 'text', label: '文本' },
    },
  ];
  const bounds = calculateGroupBounds(textNodes, 32);
  // X: minX(100) - 32 = 68, maxX(500 + 350 = 850), width = 750 + 64 = 814
  assert.equal(bounds.x, 68);
  assert.equal(bounds.width, 814);
  // Y: minY(100 - 28 = 72) - 32 = 40, maxY(100 + 500 = 600), height = (600 - 72) + 64 = 592
  assert.equal(bounds.y, 40);
  assert.equal(bounds.height, 592);
  assert.equal(bounds.minHeight, 592);
});

test('planUngroupNode: 销毁 GroupNode 并恢复子节点绝对坐标', () => {
  const initialNodes = [
    {
      id: 'node_1',
      type: 'material',
      position: { x: 100, y: 100 },
      width: 300,
      height: 200,
      data: { title: 'Node 1' },
    },
    {
      id: 'node_2',
      type: 'material',
      position: { x: 500, y: 300 },
      width: 200,
      height: 150,
      data: { title: 'Node 2' },
    },
  ];

  const plan = planGroupNodes(initialNodes, ['node_1', 'node_2']);
  assert.ok(plan);

  const restoredNodes = planUngroupNode(plan.nodes, plan.groupId);
  assert.ok(restoredNodes);
  assert.equal(restoredNodes.length, 2);

  const child1 = restoredNodes.find((n) => n.id === 'node_1');
  const child2 = restoredNodes.find((n) => n.id === 'node_2');

  assert.equal(child1.parentId, undefined);
  assert.equal(child2.parentId, undefined);
  assert.equal(child1.position.x, 100);
  assert.equal(child1.position.y, 100);
  assert.equal(child2.position.x, 500);
  assert.equal(child2.position.y, 300);
});

test('planGroupNodes: 已有 parentId 的节点不会被二次打组', () => {
  const nodes = [
    { id: 'a', type: 'material', position: { x: 0, y: 0 }, width: 100, height: 80, parentId: 'old' },
    { id: 'b', type: 'material', position: { x: 140, y: 0 }, width: 100, height: 80 },
    { id: 'c', type: 'group', position: { x: 0, y: 0 }, width: 200, height: 120 },
  ];
  assert.equal(planGroupNodes(nodes, ['a', 'b']), null);
});

test('screenDeltaToFlowDelta: zoom=0.5 时屏幕 10px → flow 20；zoom=2 → 5', () => {
  assert.deepEqual(screenDeltaToFlowDelta(10, 10, 0.5), { dx: 20, dy: 20 });
  assert.deepEqual(screenDeltaToFlowDelta(10, 10, 2), { dx: 5, dy: 5 });
  assert.deepEqual(screenDeltaToFlowDelta(10, 10, 0), { dx: 10, dy: 10 });
});

test('childIdsOfGroup: 只返回 live parentId 子节点', () => {
  const nodes = [
    { id: 'g1', type: 'group' },
    { id: 'n1', type: 'material', parentId: 'g1' },
    { id: 'n2', type: 'material', parentId: 'g1' },
    { id: 'n3', type: 'material', parentId: 'other' },
    { id: 'g2', type: 'group', parentId: 'g1' },
  ];
  assert.deepEqual(childIdsOfGroup(nodes, 'g1'), ['n1', 'n2']);
});

test('planGroupNodes: 未传 title 时默认生成「编组 N 个节点」', () => {
  const initialNodes = [
    { id: 'n1', type: 'material', position: { x: 0, y: 0 }, width: 300, height: 200 },
    { id: 'n2', type: 'material', position: { x: 400, y: 0 }, width: 300, height: 200 },
  ];
  const plan = planGroupNodes(initialNodes, ['n1', 'n2']);
  assert.ok(plan);
  const groupNode = plan.nodes.find((n) => n.id === plan.groupId);
  assert.ok(groupNode);
  assert.equal(groupNode.data.title, '编组 2 个节点');
  assert.equal(groupNode.data.color, DEFAULT_GROUP_COLOR);
  assert.equal(groupNode.data.color, '');
  assert.equal(groupNode.data.isCollapsed, false);
  assert.deepEqual(groupNode.data.expandedBounds, { width: groupNode.width, height: groupNode.height });
});

test('planToggleGroupCollapse: 收起组并隐藏子节点，再次触发完整展开还原', () => {
  const initialNodes = [
    { id: 'n1', type: 'material', position: { x: 0, y: 0 }, width: 300, height: 200 },
    { id: 'n2', type: 'material', position: { x: 400, y: 0 }, width: 300, height: 200 },
  ];
  const plan = planGroupNodes(initialNodes, ['n1', 'n2'], '短剧精修组');
  assert.ok(plan);

  const originalWidth = plan.nodes.find((n) => n.id === plan.groupId).width;
  const originalHeight = plan.nodes.find((n) => n.id === plan.groupId).height;

  // 1. 收起
  const collapsedNodes = planToggleGroupCollapse(plan.nodes, plan.groupId);
  assert.ok(collapsedNodes);
  const collapsedGroup = collapsedNodes.find((n) => n.id === plan.groupId);
  assert.equal(collapsedGroup.data.isCollapsed, true);
  assert.equal(collapsedGroup.width, COLLAPSED_GROUP_WIDTH);
  assert.equal(collapsedGroup.height, COLLAPSED_GROUP_HEIGHT);
  assert.equal(collapsedGroup.style.width, COLLAPSED_GROUP_WIDTH);
  assert.equal(collapsedGroup.style.height, COLLAPSED_GROUP_HEIGHT);

  const collapsedChild1 = collapsedNodes.find((n) => n.id === 'n1');
  const collapsedChild2 = collapsedNodes.find((n) => n.id === 'n2');
  assert.equal(collapsedChild1.hidden, true);
  assert.equal(collapsedChild2.hidden, true);

  // 2. 展开
  const expandedNodes = planToggleGroupCollapse(collapsedNodes, plan.groupId);
  assert.ok(expandedNodes);
  const expandedGroup = expandedNodes.find((n) => n.id === plan.groupId);
  assert.equal(expandedGroup.data.isCollapsed, false);
  assert.equal(expandedGroup.width, originalWidth);
  assert.equal(expandedGroup.height, originalHeight);
  assert.equal(expandedGroup.style.width, originalWidth);
  assert.equal(expandedGroup.style.height, originalHeight);

  const expandedChild1 = expandedNodes.find((n) => n.id === 'n1');
  const expandedChild2 = expandedNodes.find((n) => n.id === 'n2');
  assert.equal(expandedChild1.hidden, false);
  assert.equal(expandedChild2.hidden, false);
});
