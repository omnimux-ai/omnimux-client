/**
 * 单选 + data 补丁纯函数（Issue #299）：
 * 文本空态预设点击后 exclusive select 当前节点，并只合并传入的 data 字段。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planSelectAndPatchNode } from './planSelectAndPatchNode.ts';

test('planSelectAndPatchNode：单选目标节点并合并 data，其它节点取消选中', () => {
  const nodes = [
    {
      id: 'other',
      selected: true,
      data: { prompt: 'keep-me', generatedContent: 'old-gen', content: 'old-content' },
    },
    {
      id: 'text-1',
      selected: false,
      data: { prompt: '', generatedContent: 'keep-gen', content: 'keep-content' },
    },
  ];
  const updates = { prompt: '请创作一个剧本', selectedTool: 'text-to-text' };
  const next = planSelectAndPatchNode(nodes, 'text-1', updates);

  assert.equal(next[0].id, 'other');
  assert.equal(next[0].selected, false);
  assert.equal(next[0].data, nodes[0].data);
  assert.equal(next[0].data.prompt, 'keep-me');

  assert.equal(next[1].id, 'text-1');
  assert.equal(next[1].selected, true);
  assert.equal(next[1].data.prompt, '请创作一个剧本');
  assert.equal(next[1].data.selectedTool, 'text-to-text');
  assert.equal(next[1].data.generatedContent, 'keep-gen');
  assert.equal(next[1].data.content, 'keep-content');
  assert.equal('content' in updates, false);
});

test('planSelectAndPatchNode：已选中时仍更新 prompt，不破坏 selected', () => {
  const nodes = [
    { id: 'text-1', selected: true, data: { prompt: 'old', selectedTool: 'text-editor' } },
    { id: 'other', selected: false, data: { prompt: 'x' } },
  ];
  const next = planSelectAndPatchNode(nodes, 'text-1', {
    prompt: 'new-prompt',
    selectedTool: 'text-to-text',
  });
  assert.equal(next[0].selected, true);
  assert.equal(next[0].data.prompt, 'new-prompt');
  assert.equal(next[0].data.selectedTool, 'text-to-text');
  assert.equal(next[1].selected, false);
});

test('planSelectAndPatchNode：不写入 content，不覆盖未传入的 generatedContent', () => {
  const nodes = [
    {
      id: 'text-1',
      selected: false,
      data: { content: 'user-draft', generatedContent: 'sse-result', prompt: '' },
    },
  ];
  const next = planSelectAndPatchNode(nodes, 'text-1', {
    prompt: 'injected',
    selectedTool: 'text-to-text',
  });
  assert.equal(next[0].data.content, 'user-draft');
  assert.equal(next[0].data.generatedContent, 'sse-result');
  assert.equal(next[0].data.prompt, 'injected');
  assert.equal(Object.hasOwn(next[0].data, 'content'), true);
});

test('planSelectAndPatchNode：不修改入参数组', () => {
  const nodes = [
    { id: 'a', selected: true, data: { prompt: 'a' } },
    { id: 'b', selected: false, data: { prompt: 'b' } },
  ];
  const snapshot = structuredClone(nodes);
  planSelectAndPatchNode(nodes, 'b', { prompt: 'patched' });
  assert.deepEqual(nodes, snapshot);
});

test('planSelectAndPatchNode：空 id / 非数组安全回退', () => {
  assert.deepEqual(planSelectAndPatchNode(undefined, 'a', { prompt: 'x' }), []);
  const nodes = [{ id: 'a', selected: false, data: { prompt: '' } }];
  const next = planSelectAndPatchNode(nodes, '', { prompt: 'x' });
  assert.equal(next[0].selected, false);
  assert.equal(next[0].data.prompt, '');
});
