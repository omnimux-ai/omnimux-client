import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planInstantiateTemplate } from './planInstantiateTemplate.ts';

test('planInstantiateTemplate: 重映射节点/边 id，剥 parent，平移到 origin', () => {
  const result = planInstantiateTemplate({
    nodes: [
      { id: 'a', type: 'material', position: { x: 100, y: 40 }, width: 120, height: 80, parentId: 'g', extent: 'parent' },
      { id: 'b', type: 'material', position: { x: 260, y: 40 }, width: 120, height: 80 },
    ],
    edges: [{ id: 'e1', source: 'a', target: 'b' }],
  }, { x: 10, y: 20 });

  assert.equal(result.nodes.length, 2);
  assert.equal(result.edges.length, 1);
  assert.notEqual(result.nodes[0].id, 'a');
  assert.notEqual(result.nodes[1].id, 'b');
  assert.equal(result.nodes[0].parentId, undefined);
  assert.equal(result.nodes[0].extent, undefined);
  assert.equal(result.nodes[0].position.x, 10);
  assert.equal(result.nodes[0].position.y, 20);
  assert.equal(result.edges[0].source, result.nodes[0].id);
  assert.equal(result.edges[0].target, result.nodes[1].id);
});
