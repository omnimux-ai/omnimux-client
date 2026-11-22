import { withFixturePricingDefaults } from '../validation/compatTestCatalog.ts';
/**
 * Issue #62 AC-3 — 视频节点从 `first_last_frame` 自动切到 `video_multi_ref` 时，
 * 槽位必须跟着新 operation 的 layout 归一：图片进 `reference_images`，视频进
 * `reference_videos`，节点保持可生成；删除视频后回到首尾帧。
 *
 * 真实内置 catalog + 真实 `recomputeCanvasSlots`（canvas store 在每次 onConnect
 * 之后调用的同一函数）——回归 #64 合并后 Dev 上「operation 切了但 slotBindings
 * 仍是 first_frame/last_frame、compat role_conflict ×2、6 个 operation 全 disabled」。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildModelCatalog } from '../../../../omnimux/src/catalog/list.js';
import { projectCanvasCatalog } from '../generationPolicy.ts';
import { recomputeCanvasSlots } from './canvasSlotRecompute.ts';
import { prepareExecutionSlotGraph } from './feedSlot/prepareExecutionSlotGraph.ts';
import { deriveSlotLayout } from './feedSlot/deriveSlotLayout.ts';
import { effectiveInputDisplay } from './feedSlot/effectiveInputDisplay.ts';
import { assembleEffectiveInputsFromSlots } from './feedSlot/assembleEffectiveInputs.ts';
import { feedFromFingerprint } from './feedSlot/effectiveFingerprint.ts';
import { buildCanvasUpstreamFingerprint } from './canvasInputSources.ts';
import { planCanvasInputMutation } from './canvasInputMutationGateway.ts';
import { reconcileCanvasForCatalog } from './catalogReconcile.ts';
import { findExecutionReadinessFailure } from '../validation/executionReadiness.ts';
import { resolveEffectiveVideoParams } from '../../canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamAdapter.ts';

const bundled = JSON.parse(readFileSync(new URL('../../../../omnimux/src/catalog/cloud/bundled/pricing.json', import.meta.url), 'utf8'));
const catalog = projectCanvasCatalog(buildModelCatalog({ env: {}, snapshot: withFixturePricingDefaults(bundled, { 'seedance-2-5': 'seedance-2-5-720p' }) }));
const defaultExtensions = new Map([['image', 'png'], ['video', 'mp4'], ['audio', 'wav']]);

const importNode = (id, type, extension) => {
  const ext = extension ?? defaultExtensions.get(type);
  const mimeType = `${type}/${ext === 'mp3' ? 'mpeg' : ext}`;
  const url = `https://example.test/${id}.${ext}`;
  return {
    id,
    type: 'material',
    data: {
      materialType: type,
      nodeKind: 'import',
      status: 'ready',
      mediaUrl: url,
      mediaAssets: [{ type, url, mimeType, sizeBytes: 1024 }],
      mimeType,
      sizeBytes: 1024,
    },
  };
};

const targetNode = () => ({
  id: 'target',
  type: 'material',
  data: {
    materialType: 'video',
    nodeKind: 'generate',
    selectedTool: 'video-generation',
    status: 'empty',
    prompt: '傍晚的草地，两只小猫向镜头跑来',
    params: { model: 'seedance-2-5' },
    inputBindingVersion: 1,
    slotBindings: {},
    slotConflicts: [],
  },
});

const edge = (id, source, feedType) => ({
  id, source, target: 'target', targetHandle: 'in', data: { feedType },
});

/** Mirror the canvas store: every connect mutates the graph, then recomputes. */
function connect(node, sources, edges, newEdgeId) {
  return recomputeCanvasSlots(
    node,
    { nodes: [...sources, node], edges },
    { catalog },
    node.data.params.operation ? node : undefined,
    new Set([newEdgeId]),
  );
}

const boundKeys = (node) => Object.entries(node.data.slotBindings ?? {})
  .filter(([, occupants]) => occupants.length > 0)
  .map(([slot]) => slot)
  .sort();

test('Muse V1 refills a vacated automatic first-frame slot in supply order', () => {
  const target = targetNode();
  target.data.params = { model: 'muse-video', operation: 'first_frame' };
  target.data.autoOperationId = null;
  const sources = ['a', 'b', 'c'].map(id => importNode(id, 'image'));
  let graph = { nodes: [...sources, target], edges: [] };
  for (const source of sources) {
    graph = planCanvasInputMutation(graph, { addEdges: [edge(`e-${source.id}`, source.id, 'image')] }, { catalog });
    assert.equal(graph.status, 'allowed');
  }
  const used = graph => graph.nodes.find(node => node.id === target.id).data.slotBindings.first_frame?.map(binding => binding.sourceNodeId) ?? [];
  assert.deepEqual(used(graph), ['a']);
  const withoutA = planCanvasInputMutation(graph, { removeEdgeIds: ['e-a'] }, { catalog });
  assert.deepEqual(used(withoutA), ['b']);
  assert.deepEqual(withoutA.edges.map(edge => edge.id), ['e-b', 'e-c']);
  assert.deepEqual(used(planCanvasInputMutation(withoutA, { removeEdgeIds: ['e-b'] }, { catalog })), ['c']);

  const cleared = planCanvasInputMutation(graph, { nodePatches: [{ nodeId: target.id, data: { slotBindings: {} } }] }, { catalog });
  assert.deepEqual(used(planCanvasInputMutation(cleared, { removeEdgeIds: ['e-a'] }, { catalog })), []);
});

test('A28: reopening an explicit clear and adding a new edge only wakes the new supply', () => {
  const target = targetNode();
  target.data.params = { model: 'seedance-2-5', operation: 'video_multi_ref' };
  target.data.autoOperationId = null;
  const olderImage = edge('old-image', 'a', 'image');
  Object.assign(olderImage.data, { targetSlot: 'reference_images', role: 'reference' });
  const olderAudio = edge('old-audio', 'voice', 'audio');
  const graph = { nodes: [target, importNode('a', 'image'), importNode('b', 'image'), importNode('voice', 'audio')],
    edges: [olderImage, olderAudio] };
  const generated = graph => graph.nodes.find(node => node.id === target.id).data;
  const open = graph => reconcileCanvasForCatalog({ ...JSON.parse(JSON.stringify(graph)), catalog });
  const cleared = open(graph);
  assert.deepEqual(generated(cleared).slotBindings, {});
  assert.deepEqual(cleared.edges[0].data, olderImage.data);

  const connected = planCanvasInputMutation(cleared, { addEdges: [edge('new-image', 'b', 'image')] }, { catalog });
  assert.equal(connected.status, 'allowed');
  const reloaded = open(connected);
  assert.deepEqual(reloaded.edges.map(item => item.id), ['old-image', 'old-audio', 'new-image']);
  assert.deepEqual(generated(reloaded).slotStandbyEdgeIds, ['old-image', 'old-audio']);
  assert.deepEqual(generated(reloaded).slotBindings.reference_images.map(item => item.edgeId), ['new-image']);
  assert.deepEqual(generated(reloaded).slotBindings.reference_audios, []);
  const snapshot = prepareExecutionSlotGraph(reloaded.nodes, reloaded.edges, catalog).runSnapshots.get(target.id);
  assert.deepEqual(snapshot.assigned.map(item => item.edgeId), ['new-image']);

  const unplugged = planCanvasInputMutation(reloaded, { removeEdgeIds: ['new-image', 'old-image'] }, { catalog });
  assert.deepEqual(generated(unplugged).slotBindings.reference_images ?? [], []);
  assert.deepEqual(generated(unplugged).slotStandbyEdgeIds, ['old-audio']);
  const replugged = planCanvasInputMutation(unplugged, { addEdges: [olderImage] }, { catalog });
  assert.deepEqual(generated(replugged).slotBindings.reference_images.map(item => item.edgeId), ['old-image']);
  assert.equal(replugged.edges.at(-1).data.targetSlot, 'reference_images');
  assert.equal(replugged.edges.at(-1).data.role, 'reference');
});

test('A29/A30: newly connected pending supply is assigned when ready and a pinned choice stays reserved', () => {
  const target = targetNode();
  target.data.params = { model: 'muse-video', operation: 'first_frame' };
  target.data.autoOperationId = null;
  const ready = importNode('new', 'image');
  const pending = { ...ready, data: { materialType: 'image', nodeKind: 'generate', status: 'loading' } };
  const graph = { nodes: [target, importNode('old', 'image'), pending], edges: [edge('old', 'old', 'image')] };
  const generated = graph => graph.nodes.find(node => node.id === target.id).data;
  const connected = planCanvasInputMutation(graph, { addEdges: [edge('new', 'new', 'image')] }, { catalog });
  assert.equal(connected.status, 'allowed');
  assert.deepEqual(generated(connected).slotBindings.first_frame, []);
  assert.deepEqual(generated(connected).slotStandbyEdgeIds, ['old']);
  assert.deepEqual(generated(connected).compat.reasonCodes, ['min_unsatisfied']);
  const available = planCanvasInputMutation(connected, { nodePatches: [{ nodeId: 'new', data: ready.data }] }, { catalog });
  assert.equal(available.status, 'allowed');
  assert.deepEqual(generated(available).slotBindings.first_frame.map(item => item.edgeId), ['new']);
  assert.equal(generated(available).compat.readyToSubmit, true);

  const pinned = { ...target, data: { ...target.data,
    slotBindings: { first_frame: [{ sourceNodeId: 'new', edgeId: 'new', pinned: true }] } } };
  const pinnedGraph = { nodes: [pinned, importNode('old', 'image'), pending], edges: connected.edges };
  const plan = reconcileCanvasForCatalog({ ...pinnedGraph, catalog });
  assert.deepEqual(generated(plan).slotBindings.first_frame.map(item => [item.edgeId, item.pinned]), [['new', true]]);
  assert.equal(generated(plan).compat.readyToSubmit, false);
  assert.ok(generated(plan).compat.reasonCodes.includes('input_waiting'));
});

test('A52: changing model reevaluates unused supply from a saved layout without media slots', () => {
  const target = targetNode();
  delete target.data.slotBindings;
  target.data.params = { model: 'muse-video', operation: 'text_to_video' };
  target.data.autoOperationId = null;
  const sources = [importNode('a', 'image'), importNode('voice', 'audio'), importNode('flac', 'audio', 'flac')];
  const edges = sources.map(source => edge(`e-${source.id}`, source.id, source.data.materialType));
  edges[1].data.slotBinding = { slot: 'reference_audios', role: 'reference', type: 'audio' };
  const initial = reconcileCanvasForCatalog({ nodes: [...sources, target], edges, catalog });
  assert.deepEqual(Object.values(initial.nodes.at(-1).data.slotBindings ?? {}).flat(), []);
  const choose = (graph, model, operation) => planCanvasInputMutation(graph, {
    nodePatches: [{ nodeId: target.id, data: { params: { model, operation }, autoOperationId: null } }],
  }, { catalog });
  const seedance = choose(initial, 'seedance-2-5', 'video_multi_ref');
  assert.equal(seedance.status, 'allowed');
  assert.deepEqual(seedance.nodes.at(-1).data.slotBindings.reference_images.map(item => item.edgeId), ['e-a']);
  assert.deepEqual(seedance.nodes.at(-1).data.slotBindings.reference_audios.map(item => item.edgeId), ['e-voice']);
  assert.deepEqual(seedance.edges[1].data.slotBinding, edges[1].data.slotBinding);
  assert.deepEqual(seedance.nodes.at(-1).data.slotConflicts, []);
  const muse = choose(seedance, 'muse-video', 'first_frame');
  assert.equal(muse.status, 'allowed');
  assert.deepEqual(muse.nodes.at(-1).data.slotBindings.first_frame.map(item => item.edgeId), ['e-a']);
  assert.deepEqual(muse.edges.map(item => item.id), edges.map(item => item.id));
  assert.deepEqual(muse.edges[1].data.slotBinding, edges[1].data.slotBinding);
});

test('a qualified slot edit preserves the selected operation and its automatic provenance', () => {
  const target = targetNode();
  target.data.params = { model: 'seedance-2-5', operation: 'first_frame' };
  target.data.autoOperationId = 'first_frame';
  target.data.slotBindings = { first_frame: [{ edgeId: 'e-a', sourceNodeId: 'a', pinned: true }] };
  const graph = { nodes: [target, importNode('a', 'image'), importNode('b', 'image')],
    edges: [edge('e-a', 'a', 'image'), edge('e-b', 'b', 'image')] };
  const write = recomputeCanvasSlots(target, graph, { catalog }, target, new Set(), new Set(), 'first_frame');
  assert.equal(write.data.params.operation, 'first_frame');
  assert.equal(write.data.autoOperationId, 'first_frame');
  assert.deepEqual(boundKeys(write), ['first_frame']);
  const automatic = recomputeCanvasSlots(target, graph, { catalog }, target);
  assert.equal(automatic.data.params.operation, 'first_last_frame');
});

test('disconnecting a pinned first frame keeps the pinned last frame in its own role', () => {
  const target = targetNode();
  target.data.params = { model: 'seedance-2-5', operation: 'first_last_frame' };
  target.data.autoOperationId = null;
  target.data.slotBindings = {
    first_frame: [{ sourceNodeId: 'a', edgeId: 'e-a', pinned: true }],
    last_frame: [{ sourceNodeId: 'b', edgeId: 'e-b', pinned: true }],
  };
  const graph = { nodes: [importNode('a', 'image'), importNode('b', 'image'), target],
    edges: [edge('e-a', 'a', 'image'), edge('e-b', 'b', 'image')] };
  const result = planCanvasInputMutation(graph, { removeEdgeIds: ['e-a'] }, { catalog });
  const updated = result.nodes.find(node => node.id === target.id);
  assert.equal(updated.data.params.operation, 'first_last_frame');
  assert.deepEqual(updated.data.slotBindings.first_frame ?? [], []);
  assert.deepEqual(updated.data.slotBindings.last_frame.map(binding => binding.sourceNodeId), ['b']);
  assert.equal(updated.data.compat.readyToSubmit, false);
});

test('A32 keeps an explicit last-frame intent through an operation without that role', () => {
  const target = targetNode();
  target.data.params = { model: 'seedance-2-5', operation: 'first_last_frame' };
  target.data.autoOperationId = null;
  target.data.slotBindings = {
    first_frame: [{ sourceNodeId: 'a', edgeId: 'e-a', pinned: true, role: 'first_frame' }],
    last_frame: [{ sourceNodeId: 'b', edgeId: 'e-b', pinned: true, role: 'last_frame' }],
  };
  const graph = { nodes: [...['a', 'b', 'c'].map(id => importNode(id, 'image')), target],
    edges: ['a', 'b', 'c'].map(id => edge(`e-${id}`, id, 'image')) };
  const changeMode = (current, operation) => planCanvasInputMutation(current, {
    nodePatches: [{ nodeId: target.id, data: { params: { ...target.data.params, operation }, autoOperationId: null } }],
  }, { catalog });
  const firstOnly = changeMode(graph, 'first_frame');
  const changed = firstOnly.nodes.find(node => node.id === target.id);
  const layout = deriveSlotLayout(catalog, 'seedance-2-5', 'first_frame');
  const feed = feedFromFingerprint(buildCanvasUpstreamFingerprint(target.id, firstOnly.nodes, firstOnly.edges), 1);
  const displayed = effectiveInputDisplay(layout, feed, changed.data.slotBindings, changed.data.slotConflicts, firstOnly.edges, [], 1);
  assert.deepEqual(displayed.records.map(record => record.occupant.sourceNodeId), ['a']);
  assert.equal(displayed.unused.find(input => input.occupant.edgeId === 'e-b')?.reasonCode, 'role_not_supported');
  const requestInputs = assembleEffectiveInputsFromSlots({ layout, bindings: displayed.bindings, conflicts: displayed.conflicts,
    nodeData: changed.data, feedAssets: feed, incomingText: [] });
  assert.deepEqual(requestInputs.references.map(input => [input.sourceNodeId, input.targetSlot]), [['a', 'first_frame']]);
  assert.deepEqual(requestInputs.blockedInputs, []);
  assert.equal(changed.data.compat.readyToSubmit, true);
  assert.ok(!changed.data.compat.reasonCodes.includes('role_conflict'));
  assert.equal(firstOnly.edges.length, 3);
  const reopened = JSON.parse(JSON.stringify(firstOnly));
  const restored = changeMode(reopened, 'first_last_frame').nodes.find(node => node.id === target.id);
  assert.deepEqual(restored.data.slotBindings.last_frame.map(binding => [binding.sourceNodeId, binding.pinned]), [['b', true]]);
});

test('#62 AC-3: two images then a video re-binds slots for video_multi_ref and stays submittable', () => {
  const imgA = importNode('img-a', 'image');
  const imgB = importNode('img-b', 'image');
  const vid = importNode('vid-a', 'video');
  const e1 = edge('e1', 'img-a', 'image');
  const e2 = edge('e2', 'img-b', 'image');
  const e3 = edge('e3', 'vid-a', 'video');

  let node = targetNode();
  node = connect(node, [imgA], [e1], 'e1');
  assert.equal(node.data.params.operation, 'first_frame');

  node = connect(node, [imgA, imgB], [e1, e2], 'e2');
  assert.equal(node.data.params.operation, 'first_last_frame');
  assert.deepEqual(boundKeys(node), ['first_frame', 'last_frame']);

  node = connect(node, [imgA, imgB, vid], [e1, e2, e3], 'e3');
  assert.equal(node.data.params.operation, 'video_multi_ref');
  assert.equal(node.data.autoOperationId, 'video_multi_ref');
  // 图片从具名首尾帧重映射到 reference_images，视频进 reference_videos；
  // 旧 operation 的槽位不再残留，否则 compat 会报 role_conflict。
  assert.deepEqual(boundKeys(node), ['reference_images', 'reference_videos']);
  assert.deepEqual(
    node.data.slotBindings.reference_images.map((occupant) => occupant.sourceNodeId),
    ['img-a', 'img-b'],
  );
  assert.deepEqual(
    node.data.slotBindings.reference_videos.map((occupant) => occupant.sourceNodeId),
    ['vid-a'],
  );
  assert.equal(node.data.compat.acceptsCurrentInputs, true);
  assert.equal(node.data.compat.readyToSubmit, true);
  assert.deepEqual(node.data.compat.reasonCodes, []);

  // 展示/提交同源：执行准备沿用同一份归一结果，请求里是两张参考图 + 一段参考视频。
  const prepared = prepareExecutionSlotGraph([imgA, imgB, vid, node], [e1, e2, e3], catalog);
  const preparedTarget = prepared.nodes.find((item) => item.id === 'target');
  assert.equal(preparedTarget.data.params.operation, 'video_multi_ref');
  assert.deepEqual(
    preparedTarget.data.slotBindings.reference_images.map((occupant) => occupant.sourceNodeId),
    ['img-a', 'img-b'],
  );
  assert.deepEqual(
    preparedTarget.data.slotBindings.reference_videos.map((occupant) => occupant.sourceNodeId),
    ['vid-a'],
  );

  // 删除视频后回首尾帧，槽位同样按新 layout 归一。
  const back = recomputeCanvasSlots(
    node,
    { nodes: [imgA, imgB, node], edges: [e1, e2] },
    { catalog },
    node,
  );
  assert.equal(back.data.params.operation, 'first_last_frame');
  assert.deepEqual(boundKeys(back), ['first_frame', 'last_frame']);
  assert.equal(back.data.compat.acceptsCurrentInputs, true);
  assert.equal(back.data.compat.readyToSubmit, true);
});

test('#62: a legacy audio edge stays a silent candidate and keeps text_to_video usable', () => {
  // #62 目标 3 / #88：当前模型不消费的候选媒体不参与卡槽与模式灰态。历史 audio 边留在图上，
  // 但不进入 slotBindings；面板按已消费供给判定，text_to_video 保持可用、无 chip。
  const audio = {
    id: 'aud-a',
    type: 'material',
    data: {
      materialType: 'audio',
      nodeKind: 'import',
      status: 'ready',
      mediaUrl: 'https://example.test/aud-a.mp3',
      mediaAssets: [{ type: 'audio', url: 'https://example.test/aud-a.mp3', mimeType: 'audio/mpeg', sizeBytes: 1024 }],
      mimeType: 'audio/mpeg',
      sizeBytes: 1024,
    },
  };
  const audioEdge = edge('ea', 'aud-a', 'audio');
  const target = targetNode();
  target.data.params = { model: 'seedance-2-5', operation: 'text_to_video' };

  const layout = deriveSlotLayout(catalog, 'seedance-2-5', 'text_to_video');
  const feed = feedFromFingerprint(buildCanvasUpstreamFingerprint('target', [audio, target], [audioEdge]), 1);
  const display = effectiveInputDisplay(layout, feed, undefined, [], [audioEdge], [], 1);
  assert.equal(Object.values(display.bindings).flat().length, 0, 'audio candidate must not occupy a slot');

  const effective = resolveEffectiveVideoParams({
    params: { model: 'seedance-2-5', operation: 'text_to_video' },
    modelItem: catalog.video.find((row) => row.id === 'seedance-2-5'),
    catalog,
    upstreams: [],
    prompt: 'make a clip',
  });
  assert.equal(effective.operation, 'text_to_video');
  assert.equal(effective.effectiveOperations.find((operation) => operation.id === 'text_to_video')?.disabled, false);
});

test('#62: an unconsumed audio candidate never flips readiness or the request (A/B)', () => {
  // A/B：同一节点、同一 prompt、同一 seedance text_to_video，唯一差异是 B 多一条历史 audio 边。
  // 两边 readyToSubmit 与执行请求必须一致：未消费候选既不阻断，也不进入 payload。
  const prompt = 'issue-62 A/B contrast: 一艘船在湖面上缓慢航行';
  const audio = {
    id: 'src-1',
    type: 'material',
    data: {
      materialType: 'audio',
      nodeKind: 'import',
      status: 'ready',
      mediaUrl: 'https://example.test/src-1.mp3',
      mediaAssets: [{ type: 'audio', url: 'https://example.test/src-1.mp3', mimeType: 'audio/mpeg', sizeBytes: 1024 }],
      mimeType: 'audio/mpeg',
      sizeBytes: 1024,
    },
  };
  const target = () => ({
    id: 'target',
    type: 'material',
    data: {
      materialType: 'video',
      nodeKind: 'generate',
      selectedTool: 'video-generation',
      status: 'empty',
      prompt,
      params: { model: 'seedance-2-5', operation: 'text_to_video' },
      autoOperationId: null,
      inputBindingVersion: 1,
      slotBindings: {},
      slotConflicts: [],
    },
  });
  const audioEdge = {
    id: 'edge-audio', source: 'src-1', target: 'target', targetHandle: 'in', data: { feedType: 'audio' },
  };

  const withoutEdge = findExecutionReadinessFailure([target()], catalog, { nodes: [target()], edges: [] });
  assert.equal(withoutEdge, null, 'A (no audio edge) must be ready');

  const withEdge = findExecutionReadinessFailure([audio, target()], catalog, {
    nodes: [audio, target()], edges: [audioEdge],
  });
  assert.equal(withEdge, null, 'B (legacy audio candidate) must be ready');

  // 请求同源：两种画布都准备出同一个 text_to_video 请求，音频不进入 references。
  const prepare = (nodes, edges) => prepareExecutionSlotGraph(nodes, edges, catalog).nodes.find((node) => node.id === 'target');
  const a = prepare([target()], []);
  const b = prepare([audio, target()], [audioEdge]);
  assert.equal(a.data.params.operation, 'text_to_video');
  assert.equal(b.data.params.operation, 'text_to_video');
  assert.deepEqual(a.data.slotBindings, b.data.slotBindings);
  assert.deepEqual(b.data.slotBindings, {});

  // 画布 store 的 compat 镜像也不能被候选边打成 configuration_error。
  const recomputed = recomputeCanvasSlots(target(), {
    nodes: [audio, target()], edges: [audioEdge],
  }, { catalog }, undefined, new Set(['edge-audio']));
  assert.equal(recomputed.data.params.operation, 'text_to_video');
  assert.equal(recomputed.data.compat.acceptsCurrentInputs, true);
  assert.deepEqual(recomputed.data.compat.reasonCodes, []);
});

test('A53: automatic Seedance consumes audio before the required image is connected', () => {
  const created = planCanvasInputMutation({ nodes: [], edges: [] }, { addNodes: [targetNode()] }, { catalog });
  assert.equal(created.status, 'allowed');
  const createdNode = created.nodes.find(node => node.id === 'target');
  assert.equal(createdNode.data.params.operation, 'text_to_video');
  assert.equal(createdNode.data.autoOperationId, 'text_to_video');

  const audio = importNode('voice', 'audio', 'mp3');
  const connected = planCanvasInputMutation({ nodes: [audio, createdNode], edges: [] },
    { addEdges: [edge('edge-audio', audio.id, 'audio')] }, { catalog });
  assert.equal(connected.status, 'allowed');
  const node = connected.nodes.find(item => item.id === 'target');
  assert.equal(node.data.params.operation, 'video_multi_ref');
  assert.equal(node.data.autoOperationId, 'video_multi_ref');
  assert.deepEqual(node.data.slotBindings.reference_audios.map(item => item.edgeId), ['edge-audio']);
  assert.deepEqual(node.data.slotBindings.reference_images, []);
  assert.equal(node.data.compat.readyToSubmit, false);
  assert.deepEqual(node.data.compat.reasonCodes, ['min_unsatisfied']);
  assert.equal(findExecutionReadinessFailure([node], catalog, connected)?.slot, 'reference_images');

  const explicit = structuredClone(node);
  explicit.data.params = { model: 'seedance-2-5', operation: 'text_to_video' };
  explicit.data.autoOperationId = null;
  const explicitGraph = { nodes: [audio, explicit], edges: connected.edges };
  assert.equal(findExecutionReadinessFailure([explicit], catalog, explicitGraph), null);
  const snapshot = prepareExecutionSlotGraph(explicitGraph.nodes, explicitGraph.edges, catalog).runSnapshots.get(explicit.id);
  assert.equal(snapshot.operationId, 'text_to_video');
  assert.deepEqual(snapshot.assigned, []);
});
