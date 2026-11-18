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
import { feedFromFingerprint } from './feedSlot/effectiveFingerprint.ts';
import { buildCanvasUpstreamFingerprint } from './canvasInputSources.ts';
import { resolveEffectiveVideoParams } from '../../canvas/editor/components/MaterialNode/ConfigPanel/videoParams/videoParamAdapter.ts';

const bundled = JSON.parse(readFileSync(new URL('../../../../omnimux/src/catalog/cloud/bundled/pricing.json', import.meta.url), 'utf8'));
const catalog = projectCanvasCatalog(buildModelCatalog({ env: {}, snapshot: bundled }));

const importNode = (id, type) => {
  const ext = type === 'image' ? 'png' : 'mp4';
  const url = `https://example.test/${id}.${ext}`;
  return {
    id,
    type: 'material',
    data: {
      materialType: type,
      nodeKind: 'import',
      status: 'ready',
      mediaUrl: url,
      mediaAssets: [{ type, url, mimeType: type === 'image' ? 'image/png' : 'video/mp4', sizeBytes: 1024 }],
      mimeType: type === 'image' ? 'image/png' : 'video/mp4',
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

test('#62: an unconsumed audio candidate never flips readiness or the request (A/B)', async () => {
  // A/B：同一节点、同一 prompt、同一 seedance text_to_video，唯一差异是 B 多一条历史 audio 边。
  // 两边 readyToSubmit 与执行请求必须一致：未消费候选既不阻断，也不进入 payload。
  const { findExecutionReadinessFailure } = await import('../validation/executionReadiness.ts');
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

test('#62: a naturally auto-created video node keeps text_to_video after an audio edge', async () => {
  // 桌面复验的最小真实路径：planCanvasInputMutation 新建只有 model 的视频节点，
  // 系统自动得到 operation=autoOperationId=text_to_video；随后普通拖入 ready 音频边。
  // 这条路径不能要求用户重选同一个模式。
  const { planCanvasInputMutation } = await import('./canvasInputMutationGateway.ts');
  const created = planCanvasInputMutation({ nodes: [], edges: [] }, {
    addNodes: [targetNode()],
  }, { catalog });
  assert.equal(created.status, 'allowed');
  const createdNode = created.nodes.find((node) => node.id === 'target');
  assert.equal(createdNode.data.params.operation, 'text_to_video');
  assert.equal(createdNode.data.autoOperationId, 'text_to_video');

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
  const audioEdge = { id: 'edge-audio', source: 'src-1', target: 'target', targetHandle: 'in', data: { feedType: 'audio' } };
  const connected = planCanvasInputMutation({
    nodes: [audio, createdNode],
    edges: [],
  }, { addEdges: [audioEdge] }, { catalog });
  assert.equal(connected.status, 'allowed');
  const node = connected.nodes.find((item) => item.id === 'target');
  assert.equal(node.data.params.operation, 'text_to_video');
  assert.equal(node.data.autoOperationId, 'text_to_video');
  assert.deepEqual(node.data.slotBindings, {});

  // 就绪与提交：与显式手选 text_to_video 的对照完全一致。
  const { findExecutionReadinessFailure } = await import('../validation/executionReadiness.ts');
  const readiness = findExecutionReadinessFailure([audio, node], catalog, { nodes: [audio, node], edges: connected.edges });
  assert.equal(readiness, null, 'auto-derived text_to_video must be ready with a legacy audio candidate');

  const prepared = prepareExecutionSlotGraph([audio, node], connected.edges, catalog);
  const preparedTarget = prepared.nodes.find((item) => item.id === 'target');
  assert.equal(preparedTarget.data.params.operation, 'text_to_video');
  assert.deepEqual(preparedTarget.data.slotBindings, {});

  const explicit = structuredClone(node);
  explicit.data.params = { model: 'seedance-2-5', operation: 'text_to_video' };
  explicit.data.autoOperationId = null;
  assert.equal(findExecutionReadinessFailure([audio, explicit], catalog, { nodes: [audio, explicit], edges: connected.edges }), null);
  const explicitPrepared = prepareExecutionSlotGraph([audio, explicit], connected.edges, catalog)
    .nodes.find((item) => item.id === 'target');
  assert.equal(explicitPrepared.data.params.operation, 'text_to_video');
  assert.deepEqual(explicitPrepared.data.slotBindings, preparedTarget.data.slotBindings);
});
