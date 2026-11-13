import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planAlignLayout, resolveNodeDimensions } from './nodeVisualMath.ts';

test('planAlignLayout - vertical: 两个长文本节点（350x500）垂直排列，间距精确且零重叠', () => {
  const textNodes = [
    {
      id: 'node_text_1',
      type: 'material',
      position: { x: 120, y: 100 },
      data: { materialType: 'text', label: '爆款短剧题材与剧本策划' },
    },
    {
      id: 'node_text_2',
      type: 'material',
      position: { x: 200, y: 150 }, // 初始有交叠
      data: { materialType: 'text', label: '文本' },
    },
  ];

  const result = planAlignLayout(textNodes, 'vertical', { gap: 40 });
  assert.equal(result.length, 2);

  const n1 = result.find((n) => n.id === 'node_text_1');
  const n2 = result.find((n) => n.id === 'node_text_2');

  assert.ok(n1);
  assert.ok(n2);

  // X 轴统一对齐到 minX (120)
  assert.equal(n1.position.x, 120);
  assert.equal(n2.position.x, 120);

  // Y 轴起始为 100
  assert.equal(n1.position.y, 100);

  // node_text_1 卡片高度 500 (y 范围 100~600)。gap 为 40。
  // 下一个节点外挂标题栏起始于 600 + 40 = 640，卡片 y = 640 + 28(headerOffset) = 668
  assert.equal(n2.position.y, 668);

  // 两者绝对垂直无交叠：n2 标题栏顶端 (n2.y - 28) 距 n1 底端 (n1.y + 500) 距离恰好等于 gap 40
  const n1Bottom = n1.position.y + 500;
  const n2Top = n2.position.y - 28;
  assert.equal(n2Top - n1Bottom, 40);
});

test('planAlignLayout - vertical: 采用 node.measured 真实 DOM 测量高度（如 620px）', () => {
  const nodes = [
    {
      id: 'n1',
      type: 'material',
      position: { x: 100, y: 50 },
      measured: { width: 350, height: 620 },
      data: { materialType: 'text' },
    },
    {
      id: 'n2',
      type: 'material',
      position: { x: 100, y: 100 },
      measured: { width: 350, height: 350 },
      data: { materialType: 'image' },
    },
  ];

  const result = planAlignLayout(nodes, 'vertical', { gap: 30 });
  const n1 = result.find((n) => n.id === 'n1');
  const n2 = result.find((n) => n.id === 'n2');

  assert.equal(n1.position.y, 50);
  // n1 底部: 50 + 620 = 670; n2 外挂标题栏顶部: 670 + 30 = 700; n2 卡片: 700 + 28 = 728
  assert.equal(n2.position.y, 728);
  const n1Bottom = n1.position.y + 620;
  const n2Top = n2.position.y - 28;
  assert.equal(n2Top - n1Bottom, 30);
});

test('planAlignLayout - horizontal: 水平排列节点按 x 升序展开，顶部基准线平齐', () => {
  const nodes = [
    {
      id: 'img1',
      type: 'material',
      position: { x: 300, y: 100 },
      data: { materialType: 'image' }, // 350x350, headerOffset: 28
    },
    {
      id: 'vid1',
      type: 'material',
      position: { x: 50, y: 100 },
      data: { materialType: 'video' }, // 350x280, headerOffset: 28
    },
  ];

  const result = planAlignLayout(nodes, 'horizontal', { gap: 50 });
  const vid = result.find((n) => n.id === 'vid1');
  const img = result.find((n) => n.id === 'img1');

  // vid1 原先 x=50 靠左，排序后仍在左侧
  assert.equal(vid.position.x, 50);
  assert.equal(vid.position.y, 100);

  // img1 x = 50 + 350 + 50 = 450
  assert.equal(img.position.x, 450);
  assert.equal(img.position.y, 100);
});

test('planAlignLayout - grid: 异构尺寸节点网格紧凑排列，单元格自动撑开', () => {
  const nodes = [
    { id: 't1', type: 'material', position: { x: 0, y: 0 }, data: { materialType: 'text' } }, // 350x500
    { id: 'i1', type: 'material', position: { x: 300, y: 0 }, data: { materialType: 'image' } }, // 350x350
    { id: 'v1', type: 'material', position: { x: 0, y: 200 }, data: { materialType: 'video' } }, // 350x280
    { id: 'a1', type: 'material', position: { x: 300, y: 200 }, data: { materialType: 'audio' } }, // 350x150
  ];

  const result = planAlignLayout(nodes, 'grid', { gap: 40, columns: 2 });
  assert.equal(result.length, 4);

  const t1 = result.find((n) => n.id === 't1');
  const i1 = result.find((n) => n.id === 'i1');
  const v1 = result.find((n) => n.id === 'v1');
  const a1 = result.find((n) => n.id === 'a1');

  // 第一行: t1 (350x500), i1 (350x350) => 第一行最大高度 = 500 + 28 = 528 (包含外挂 header)
  // 第一列宽: 350, 第二列宽: 350
  assert.equal(t1.position.x, 0);
  assert.equal(t1.position.y, 0);

  assert.equal(i1.position.x, 350 + 40); // 390
  assert.equal(i1.position.y, 0);

  // 第二行起始 y = 0 + 528 + 40 = 568 (卡片 y = 568, 标题栏在 540)
  assert.equal(v1.position.x, 0);
  assert.equal(v1.position.y, 568);

  assert.equal(a1.position.x, 390);
  assert.equal(a1.position.y, 568);
});

test('planAlignLayout - edge cases: 0 或 1 个节点安全返回', () => {
  assert.deepEqual(planAlignLayout([], 'vertical'), []);
  const single = [{ id: 's1', position: { x: 10, y: 20 } }];
  assert.deepEqual(planAlignLayout(single, 'vertical'), single);
});
