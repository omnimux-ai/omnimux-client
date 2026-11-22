import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import React from 'react';
import { createRoot, dom, MaterialNode, ReactFlow, useCanvasStore } from './fixtures/clickablePanel.mjs';

const { document, MouseEvent } = dom.window;
const { act, createElement, useMemo } = React;
const nodeTypes = { material: MaterialNode };
const menu = '[role="menu"][aria-label="选择模型与渠道策略"]';

after(() => dom.window.close());

function Canvas({ catalog }) {
  const nodes = useCanvasStore(state => state.nodes);
  const edges = useCanvasStore(state => state.edges);
  const onNodesChange = useCanvasStore(state => state.onNodesChange);
  const flowNodes = useMemo(() => nodes.map(node => ({ ...node, data: { ...node.data, __catalog: catalog } })), [nodes, catalog]);
  return createElement(ReactFlow, { nodes: flowNodes, edges, nodeTypes, onNodesChange, width: 1024, height: 720 });
}

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

function control(selector) {
  const element = document.querySelector(selector);
  assert.ok(element, `Missing control ${selector}`);
  return element;
}

function channelRow(label) {
  const rows = document.querySelectorAll(`${menu} .wf-cascade-channel-row[role="menuitemradio"]`);
  const row = Array.from(rows).find(item => item.querySelector('.wf-cascade-channel-row__title')?.textContent === label);
  assert.ok(row, `Missing channel ${label}`);
  return row;
}

const click = element => act(async () => element.click());
const hover = element => act(async () => element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));

async function mountPanel(t, models, params, slotBindings) {
  const catalog = { source: 'omnimux', models, image: models };
  const media = slotBindings ? [{ source: 'source-a', id: 'primary' }, { source: 'source-b', id: 'secondary' }] : [];
  const nodes = media.map(({ source }, index) => ({
    id: source, type: 'default', position: { x: 0, y: index * 100 }, width: 160, height: 80,
    data: { nodeKind: 'import', materialType: 'image', mediaUrl: `https://example.test/${source}.png`, status: 'ready' },
  }));
  nodes.push({ id: 'image-node', type: 'material', selected: true, position: { x: 260, y: 100 }, width: 240, height: 160,
    data: { materialType: 'image', nodeKind: 'generate', selectedTool: 'text-to-image', status: 'ready',
      label: 'Draft', prompt: 'Saved image draft', params, ...(slotBindings ? { slotBindings } : {}) } });
  const edges = media.map(edge => ({ ...edge, target: 'image-node' }));
  useCanvasStore.setState({ nodes, edges, catalogRuntime: catalog, selectedElement: { type: 'node', id: 'image-node' } });

  const writes = [];
  const readDraft = state => {
    const node = state.nodes.find(item => item.id === 'image-node');
    return JSON.stringify({ params: node.data.params, slotBindings: node.data.slotBindings });
  };
  let prior = readDraft(useCanvasStore.getState());
  const unsubscribe = useCanvasStore.subscribe(state => {
    const current = readDraft(state);
    if (current !== prior) writes.push(JSON.parse(current));
    prior = current;
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  t.after(async () => {
    unsubscribe();
    await act(async () => root.unmount());
    container.remove();
  });
  await act(async () => root.render(createElement(Canvas, { catalog })));
  await click(control('[data-testid="wf-model-cascade-trigger"]'));
  assert.ok(document.querySelector(menu), 'Model picker must open');
  assert.deepEqual(writes, [], 'Opening the model picker must leave the node untouched');
  return writes;
}

test('clicking a model with multiple lines writes its advertised middle default once', async t => {
  const current = imageModel('current-image', [wide]);
  const target = imageModel('target-image', [wide, middle, single]);
  const manual = imageModel('manual-image', [wide, single]);
  const writes = await mountPanel(t, [current, target, manual], {
    model: current.id, operation: 'text_to_image', routing: { allowedGroups: [wide.id] },
  });
  const defaultModel = control(`${menu} [data-testid="wf-cascade-model-target-image"]`);
  await hover(defaultModel);
  assert.equal(channelRow(middle.label).getAttribute('aria-disabled'), 'true');
  assert.deepEqual(writes, [], 'Hover must only preview the lines');
  await click(defaultModel);
  assert.equal(writes.length, 1, 'Clicking the model must commit one node edit');
  assert.equal(writes[0].params.model, target.id);
  assert.deepEqual(writes[0].params.routing, { strategy: 'auto', allowedGroups: [middle.id] });

  const noDefault = control(`${menu} [data-testid="wf-cascade-model-manual-image"]`);
  await hover(noDefault);
  assert.equal(writes.length, 1, 'Previewing a model with no default must not write');
  await click(noDefault);
  assert.equal(writes.length, 1, 'Clicking a model with no default must wait for a line');
  await click(channelRow(single.label));
  assert.equal(writes.length, 2, 'Manually selecting a line must commit one node edit');
  assert.equal(writes[1].params.model, manual.id);
  assert.deepEqual(writes[1].params.routing, { strategy: 'auto', allowedGroups: [single.id] });
});

test('clicking a single-image line includes trimmed reference bindings in the first node write', async t => {
  const model = imageModel('current-image', [wide, single]);
  const primary = { edgeId: 'primary', sourceNodeId: 'source-a', role: 'reference' };
  const extra = { edgeId: 'secondary', sourceNodeId: 'source-b', role: 'reference' };
  const writes = await mountPanel(t, [model], {
    model: model.id, operation: 'image_to_image', routing: { allowedGroups: [wide.id] },
  }, { reference: [primary], extra: [extra] });
  const row = channelRow(single.label);
  assert.equal(row.getAttribute('aria-checked'), 'false');
  await click(row);
  assert.ok(writes.length > 0, 'Selecting the line must update the store');
  assert.deepEqual(writes[0].params.routing, { strategy: 'auto', allowedGroups: [single.id] });
  assert.deepEqual(writes[0].slotBindings, { reference: [primary] }, 'The first routing write must already have one reference');
  assert.equal(writes.length, 1, 'Selecting the line must commit one node edit');
});
