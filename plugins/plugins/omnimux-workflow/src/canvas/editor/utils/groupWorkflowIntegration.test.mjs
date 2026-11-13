import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateGroupBounds,
  toRelativeCoordinates,
  toAbsoluteCoordinates,
  clampGroupResize,
  planGroupNodes,
  planUngroupNode,
} from './nodeVisualMath.ts';
import { resolveExecutionSubgraph } from '../../../workflow/execution/subgraph.ts';

test('全链路集成测试：多选 -> 打组 -> 8轴缩放 -> 局部执行 -> 解组', () => {
  // 1. 初始节点
  const initialNodes = [
    {
      id: 'node_video_src',
      type: 'material',
      position: { x: 100, y: 100 },
      width: 320,
      height: 240,
      data: { title: 'Untitled Project.mp4', materialType: 'video' },
    },
    {
      id: 'node_img_ref',
      type: 'material',
      position: { x: 480, y: 100 },
      width: 320,
      height: 240,
      data: { title: '夜景人像', materialType: 'image' },
    },
    {
      id: 'node_video_out',
      type: 'material',
      position: { x: 100, y: 400 },
      width: 320,
      height: 240,
      data: { title: '换脸高清成片', materialType: 'video' },
    },
  ];

  const initialEdges = [
    { id: 'e1', source: 'node_video_src', target: 'node_video_out' },
    { id: 'e2', source: 'node_img_ref', target: 'node_video_out' },
  ];

  // 2. 多选框选打组
  const groupPlan = planGroupNodes(initialNodes, ['node_video_src', 'node_img_ref', 'node_video_out'], '夜景模特精修组');
  assert.ok(groupPlan, '打组计划应成功生成');
  assert.equal(groupPlan.nodes.length, 4, '应包含1个组容器+3个子节点');

  const groupNode = groupPlan.nodes.find((n) => n.id === groupPlan.groupId);
  assert.ok(groupNode);
  assert.equal(groupNode.type, 'group');
  assert.equal(groupNode.data.title, '夜景模特精修组');
  assert.equal(groupNode.data.color, '');

  // 子节点相对坐标验证
  const child1 = groupPlan.nodes.find((n) => n.id === 'node_video_src');
  const child2 = groupPlan.nodes.find((n) => n.id === 'node_img_ref');
  const child3 = groupPlan.nodes.find((n) => n.id === 'node_video_out');

  assert.equal(child1.parentId, groupPlan.groupId);
  assert.equal(child2.parentId, groupPlan.groupId);
  assert.equal(child3.parentId, groupPlan.groupId);

  // 3. 8轴手柄缩放防裁切
  const currentBounds = {
    x: groupNode.position.x,
    y: groupNode.position.y,
    width: groupNode.width,
    height: groupNode.height,
  };
  const minAllowed = { minWidth: groupNode.data.minWidth, minHeight: groupNode.data.minHeight };

  // 尝试向内缩小超过限制 -> 被 clamp
  const shrinkAttempt = clampGroupResize('se', currentBounds, { dx: -300, dy: -300 }, minAllowed);
  assert.equal(shrinkAttempt.width, minAllowed.minWidth);
  assert.equal(shrinkAttempt.height, minAllowed.minHeight);

  // 向外拉伸扩大 -> 正常扩大
  const expandAttempt = clampGroupResize('se', currentBounds, { dx: 120, dy: 80 }, minAllowed);
  assert.equal(expandAttempt.width, currentBounds.width + 120);
  assert.equal(expandAttempt.height, currentBounds.height + 80);

  // 4. 整组局部执行拓扑解析
  const groupExecutionSubgraph = resolveExecutionSubgraph({
    nodes: groupPlan.nodes,
    edges: initialEdges,
    executionMode: 'subset',
    nodeIds: ['node_video_out'],
  });

  // groupNode 容器应被过滤，仅保留可执行业务节点
  assert.equal(groupExecutionSubgraph.nodes.some((n) => n.type === 'group'), false);
  assert.equal(groupExecutionSubgraph.nodes.length, 3);
  assert.equal(groupExecutionSubgraph.edges.length, 2);

  // 5. 解除分组 (Ungroup)
  const ungroupedNodes = planUngroupNode(groupPlan.nodes, groupPlan.groupId);
  assert.ok(ungroupedNodes);
  assert.equal(ungroupedNodes.length, 3, '解组后组容器销毁');

  const restored1 = ungroupedNodes.find((n) => n.id === 'node_video_src');
  const restored2 = ungroupedNodes.find((n) => n.id === 'node_img_ref');
  const restored3 = ungroupedNodes.find((n) => n.id === 'node_video_out');

  assert.equal(restored1.parentId, undefined);
  assert.equal(restored2.parentId, undefined);
  assert.equal(restored3.parentId, undefined);

  // 绝对物理坐标 100% 还原
  assert.deepEqual(restored1.position, { x: 100, y: 100 });
  assert.deepEqual(restored2.position, { x: 480, y: 100 });
  assert.deepEqual(restored3.position, { x: 100, y: 400 });
});
