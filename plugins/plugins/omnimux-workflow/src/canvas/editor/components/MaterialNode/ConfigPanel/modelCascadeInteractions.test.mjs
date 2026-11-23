import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import React from 'react';
import { createRoot, dom, MaterialNode, ReactFlow, useCanvasStore } from './fixtures/clickablePanel.mjs';
import { prepareExecutionSlotGraph } from '../../../../../shared/graph/feedSlot/prepareExecutionSlotGraph.ts';

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
const single = { id: 'single', label: '单图线', enabled: true, constraints: { inputs: { image: { max: 1 } } } };
const prompt = { slot: 'prompt', type: 'text', role: 'prompt', source: 'node_field', min: 1, max: 1 };
const reference = { slot: 'reference', type: 'image', role: 'reference', source: 'upstream_edge', min: 0, max: 4 };
function imageModel(id, channelGroups) {
  return {
    id, label: id, family: 'openai', channelGroups, selectable: true, operations: [
      { id: 'text_to_image', listed: true, output: { type: 'image' }, inputs: [prompt] },
      { id: 'image_to_image', listed: true, output: { type: 'image' }, inputs: [prompt, { ...reference, max: 1 }, { ...reference, slot: 'extra' }] },
    ],
  };
}

function control(selector) {
  const element = document.querySelector(selector);
  assert.ok(element, `Missing control ${selector}`);
  return element;
}

function channelRows() {
  return Array.from(document.querySelectorAll(`${menu} .wf-loomi-col--channel[role="group"] [role="menuitemradio"]`));
}

const channelLabel = row => row.querySelector('.wf-cascade-channel-row__title')?.textContent;

function channelRow(label) {
  const row = channelRows().find(item => channelLabel(item) === label);
  assert.ok(row, `Missing channel ${label}`);
  return row;
}

const click = element => act(async () => element.click());
const hover = element => act(async () => element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
const draftId = 'saved-draft';

async function mountPanel(t, { materialType, models, params, media = [], parameterSelections, selected = true }) {
  const catalog = { source: 'omnimux', models,
    image: materialType === 'image' ? models : [], video: materialType === 'video' ? models : [] };
  const nodes = media.map(({ source }, index) => ({
    id: source, type: 'material', position: { x: 0, y: index * 100 }, width: 160, height: 80,
    data: { nodeKind: 'import', selectedTool: 'import', materialType: 'image',
      mediaUrl: `https://example.test/${source}.png`, mimeType: 'image/png', status: 'ready' },
  }));
  nodes.push({ id: draftId, type: 'material', selected, position: { x: 260, y: 100 }, width: 240, height: 160,
    data: { materialType, nodeKind: 'generate', selectedTool: materialType === 'video' ? 'video-generation' : 'text-to-image',
      status: 'ready', label: 'Draft', prompt: 'Keep the saved draft.', params,
      ...(parameterSelections ? { parameterSelections } : {}) } });
  useCanvasStore.setState({ nodes, edges: [], catalogRuntime: catalog, past: [], future: [],
    selectedElement: selected ? { type: 'node', id: draftId } : { type: 'none', id: null } });
  if (media.length) {
    const addEdges = media.map(edge => ({ ...edge, sourceHandle: 'out', target: draftId, targetHandle: 'in' }));
    assert.equal(useCanvasStore.getState().applyCanvasInputMutation({ addEdges }).status, 'allowed');
  }

  const writes = [];
  const readDraft = (state = useCanvasStore.getState()) => state.nodes.find(node => node.id === draftId).data;
  let prior = readDraft();
  // Count data writes even if the final values are equal. Flow selection and
  // history changes can update the store without editing the saved draft.
  const unsubscribe = useCanvasStore.subscribe(state => {
    const current = readDraft(state);
    if (current !== prior) writes.push(structuredClone(current));
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
  return { writes, readDraft };
}

async function openModelPicker(writes) {
  await click(control('[data-testid="wf-model-cascade-trigger"]'));
  control(menu);
  assert.deepEqual(writes, [], 'Opening the model picker must leave the node untouched');
}

const videoMode = {
  id: 'text_to_video', modeKind: 'text_to_video', gatewayProtocol: 'video_generations',
  listed: true, executable: true, inputs: [prompt], output: { type: 'video' },
};
const videoVersion = 'video-line-fixture';

function videoLine(id, label, resolution, duration, pointsEstimate) {
  return {
    id, label, enabled: true, effectiveVersion: videoVersion,
    pricing: { billingMode: 'per_task', pointsEstimate },
    effectiveOperations: [{ ...videoMode, parameters: {
      resolution: { options: [{ value: resolution }], defaultValue: resolution },
      duration: { range: { min: duration, max: duration }, required: true },
    } }],
  };
}

function managedVideoModel(id, channelGroups) {
  return { id, label: id, family: 'video', selectable: true, effectiveVideoVersion: videoVersion,
    operations: [videoMode], channelGroups };
}

function assertVideoWrite(write, model, line, resolution, duration) {
  assert.equal(write.params.model, model.id);
  assert.equal(write.params.operation, 'text_to_video');
  assert.equal(write.params.resolution, resolution);
  assert.equal(write.params.duration, duration);
  const { videoLineQuote, ...routing } = write.params.routing;
  assert.deepEqual(routing, { strategy: 'auto', allowedGroups: [line.id], channelGroupId: line.id, sourceType: 'official' });
  assert.deepEqual(JSON.parse(videoLineQuote), { group: line.id, pricing: line.pricing });
}

test('managed video hover previews lines and model clicks select default B or wait for explicit A', async t => {
  const lineA = videoLine('line-a', 'A', '480p', 4, 3);
  const lineB = { ...videoLine('line-b', 'B', '720p', 6, 5), default: true };
  const current = managedVideoModel('current-video', [lineA]);
  const target = managedVideoModel('default-video', [lineA, lineB]);
  const manual = managedVideoModel('manual-video', [lineA]);
  const params = { model: current.id, operation: 'text_to_video', resolution: '480p', duration: 4,
    routing: { strategy: 'auto', allowedGroups: [lineA.id], channelGroupId: lineA.id, sourceType: 'official' } };
  const { writes, readDraft } = await mountPanel(t, { materialType: 'video', models: [current, target, manual], params });
  await openModelPicker(writes);

  const defaultModel = control(`${menu} [data-testid="wf-cascade-model-default-video"]`);
  await hover(defaultModel);
  assert.deepEqual(channelRows().map(channelLabel), ['A', 'B']);
  assert.deepEqual(channelRows().map(row => row.getAttribute('aria-checked')), ['false', 'false']);
  assert.deepEqual(writes, [], 'Hover must only preview the lines');
  assert.deepEqual(readDraft().params, params);
  await click(defaultModel);
  assert.equal(writes.length, 1, 'Clicking the model must commit one node edit');
  assertVideoWrite(writes[0], target, lineB, '720p', 6);

  const noDefault = control(`${menu} [data-testid="wf-cascade-model-manual-video"]`);
  await hover(noDefault);
  assert.deepEqual(channelRows().map(channelLabel), ['A']);
  assert.equal(writes.length, 1, 'Previewing a model with no default must not write');
  await click(noDefault);
  assert.equal(writes.length, 1, 'Clicking a model with no default must wait for a line');
  assert.deepEqual(readDraft().params, writes[0].params);
  assert.deepEqual(channelRows().map(channelLabel), ['A']);
  const onlyLine = channelRow('A');
  assert.equal(onlyLine.getAttribute('aria-checked'), 'false');
  assert.equal(onlyLine.getAttribute('aria-disabled'), 'false');
  await click(onlyLine);
  assert.equal(writes.length, 2, 'Manually selecting a line must commit one node edit');
  assertVideoWrite(writes[1], manual, lineA, '480p', 4);
});

test('opening a retired-line legacy video panel preserves parameters and history with zero draft writes', async t => {
  const legacy = {
    id: 'legacy-video', label: 'Legacy video', family: 'video', selectable: true,
    channelGroups: [{ id: 'survivor', label: 'Available line', enabled: true }],
    operations: [{ ...videoMode, parameters: {
      resolution: { options: [{ value: '480p' }], defaultValue: '480p' },
      duration: { range: { min: 4, max: 4 }, defaultValue: 4 },
      aspectRatio: { options: [{ value: '9:16' }], defaultValue: '9:16' },
    } }],
  };
  const savedValues = { resolution: '1080p', duration: 10, aspectRatio: '16:9', sound: true };
  const params = { model: legacy.id, operation: 'image_to_video', routing: { group: 'retired' }, ...savedValues };
  const parameterSelections = {
    version: 1, byModel: { 'legacy-video': { lastOperationId: 'image_to_video', byOperation: { image_to_video: savedValues } } },
  };
  const original = structuredClone({ params, parameterSelections });
  const { writes, readDraft } = await mountPanel(t, {
    materialType: 'video', models: [legacy], params, parameterSelections, selected: false,
  });
  assert.equal(document.querySelector('.wf-config-panel'), null);
  assert.deepEqual(writes, []);
  await click(control(`.react-flow__node[data-id="${draftId}"]`));
  assert.match(control('[data-testid="wf-channel-fallback-banner"]').textContent, /原线路已下线，请重选/);
  assert.deepEqual(writes, [], 'Opening the retired-line panel must not write the draft');
  await click(control('[data-testid="wf-channel-fallback-action"]'));
  control(menu);
  assert.deepEqual(writes, [], 'Opening the line picker must not write the draft');
  assert.deepEqual(readDraft().params, original.params);
  assert.deepEqual(readDraft().parameterSelections, original.parameterSelections);
});

test('routing to a single-image line projects one reference and preserves both supply edges', async t => {
  const model = imageModel('current-image', [wide, single]);
  const media = [{ id: 'primary', source: 'source-a' }, { id: 'secondary', source: 'source-b' }];
  const { writes, readDraft } = await mountPanel(t, {
    materialType: 'image', models: [model], media,
    params: { model: model.id, operation: 'image_to_image', routing: { allowedGroups: [wide.id] } },
  });
  const renderedReferences = () => Array.from(document.querySelectorAll('[data-testid="wf-slot-wells"] [data-slot-edge]'),
    card => [card.dataset.slot, card.dataset.slotEdge, card.dataset.slotState]);
  const supply = () => useCanvasStore.getState().edges.map(({ id, source, target }) => ({ id, source, target }));
  const bothEdges = media.map(edge => ({ ...edge, target: draftId }));
  const bothReferences = [['reference', 'primary', 'ready'], ['extra', 'secondary', 'ready']];
  assert.deepEqual(renderedReferences(), bothReferences);
  assert.deepEqual(supply(), bothEdges);
  assert.deepEqual(writes, [], 'Opening the panel leaves the graph untouched');

  async function routeTo(groupId, writeCount) {
    const routing = { strategy: 'auto', allowedGroups: [groupId] };
    await act(async () => {
      const plan = useCanvasStore.getState().applyCanvasInputMutation({
        nodePatches: [{ nodeId: draftId, data: { params: { ...readDraft().params, routing } } }],
      });
      assert.equal(plan.status, 'allowed');
    });
    assert.equal(writes.length, writeCount, 'A routing change is one node edit');
    assert.deepEqual(writes.at(-1).params.routing, routing);
    assert.deepEqual(supply(), bothEdges, 'Routing leaves both supply edges connected and in order');
    assert.equal(control('.wf-generate-btn__send').getAttribute('aria-disabled'), 'false');
  }

  await routeTo(single.id, 1);
  const { nodes, edges, catalogRuntime } = useCanvasStore.getState();
  const snapshot = prepareExecutionSlotGraph(nodes, edges, catalogRuntime).runSnapshots.get(draftId);
  const narrowed = {
    wells: renderedReferences(),
    addActions: document.querySelectorAll('[data-testid="wf-add-reference"]').length,
    runReferences: snapshot.assigned.map(asset => [asset.targetSlot, asset.edgeId]),
    unusedEdges: snapshot.unusedEdgeIds,
  };
  await routeTo(wide.id, 2);
  assert.deepEqual(renderedReferences(), bothReferences, 'Switching back restores both references in order without reconnecting');
  assert.deepEqual(narrowed, {
    wells: [['reference', 'primary', 'ready']],
    addActions: 0,
    runReferences: [['reference', 'primary']],
    unusedEdges: ['secondary'],
  }, 'The line limit applies across its image slots in the editor and run snapshot');
});
