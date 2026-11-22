import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { ConfigPanel, createRoot, dom, ReactFlowProvider } from './fixtures/clickablePanel.mjs';

const { document } = dom.window;
const { act } = React;

const wide = { id: 'wide', label: '多图线', enabled: true };
const middle = { id: 'middle', label: '均衡线', enabled: true, default: true };
const single = { id: 'single', label: '单图线', enabled: true, constraints: { inputs: { image: { max: 1 } } } };
const prompt = { slot: 'prompt', type: 'text', role: 'prompt', source: 'node_field', min: 1, max: 1 };
const reference = { slot: 'reference', type: 'image', role: 'reference', source: 'upstream_edge', min: 0, max: 4 };
function imageModel(id, channelGroups) {
  return {
    id, label: id, family: 'openai', channelGroups, selectable: true, operations: [
      { id: 'text_to_image', listed: true, output: { type: 'image' }, inputs: [prompt] },
      { id: 'image_to_image', listed: true, output: { type: 'image' }, inputs: [prompt, reference, { ...reference, slot: 'extra' }] },
    ],
  };
}

async function mountPanel(t, models, params, data = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  t.after(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const writes = [];
  const panel = React.createElement(ConfigPanel, {
    nodeId: 'image-node', execBusy: false, onGenerate() { assert.fail('Selecting a line must only edit the node'); },
    catalog: { source: 'omnimux', models, image: models },
    nodeData: { materialType: 'image', nodeKind: 'generate', selectedTool: 'text-to-image', prompt: 'Saved image draft', params, ...data },
    onUpdateNodeData: patch => writes.push(structuredClone(patch)),
  });
  await act(async () => root.render(React.createElement(ReactFlowProvider, null, panel)));
  const click = async selector => {
    const element = document.querySelector(selector);
    assert.ok(element, `Missing click target ${selector}`);
    await act(async () => element.click());
  };
  await click('.wf-model-cascade-capsule');
  const menu = '[role="menu"][aria-label="选择模型与渠道策略"]';
  assert.ok(document.querySelector(menu), 'Model picker must open');
  assert.deepEqual(writes, [], 'Opening the model picker must leave the node untouched');
  return { click, menu, writes };
}

test('clicking a model with multiple lines writes its advertised middle default once', async t => {
  const current = imageModel('current-image', [wide]);
  const target = imageModel('target-image', [wide, middle, single]);
  const { click, menu, writes } = await mountPanel(t, [current, target], {
    model: current.id, operation: 'text_to_image', routing: { allowedGroups: [wide.id] },
  });
  await click(`${menu} [data-testid="wf-cascade-model-target-image"]`);
  assert.equal(writes.length, 1, 'Clicking the model must commit one node edit');
  assert.equal(writes[0].params.model, target.id);
  assert.deepEqual(writes[0].params.routing, { strategy: 'auto', allowedGroups: [middle.id] });
});

test('clicking a single-image line includes trimmed reference bindings in the first node write', async t => {
  const model = imageModel('current-image', [wide, single]);
  const primary = { edgeId: 'primary', sourceNodeId: 'source-a', role: 'reference' };
  const extra = { edgeId: 'secondary', sourceNodeId: 'source-b', role: 'reference' };
  const { click, menu, writes } = await mountPanel(t, [model], {
    model: model.id, operation: 'image_to_image', routing: { allowedGroups: [wide.id] },
  }, { slotBindings: { reference: [primary], extra: [extra] } });
  const rows = [...document.querySelectorAll(`${menu} [role="menuitemradio"].wf-cascade-channel-row`)];
  const row = rows.find(item => item.querySelector('.wf-cascade-channel-row__title')?.textContent === single.label);
  assert.ok(row);
  assert.equal(row.getAttribute('aria-checked'), 'false');
  await act(async () => row.click());
  assert.equal(writes.length, 1, 'Selecting the line must commit one node edit');
  assert.deepEqual(writes[0].params.routing, { strategy: 'auto', allowedGroups: [single.id] });
  assert.deepEqual(writes[0].slotBindings, { reference: [primary] }, 'The first routing write must already have one reference');
});
