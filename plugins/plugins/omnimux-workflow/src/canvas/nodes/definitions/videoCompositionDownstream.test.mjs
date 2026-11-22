/**
 * Clip export 下游成片节点连线：生产 helper + mutation gateway。
 * 桩 id 必须是 CanvasNodeHandle 的 `out` / `in`，否则 React Flow 不画边。
 *
 * 另锁定两条修复契约：
 * 1. `mediaUrl` 必须是宿主媒体 URL（裸绝对路径在浏览器里按同源解析 → 404）；
 * 2. 复用判据含 `origin` + `sourceCompositionNodeId`，重载后（`persistSanitize`
 *    已剥掉 `realPath`）仍复用同一节点，并刷新其数据。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installCanvasClipEvents } from '../../bridge/canvasClipActions.ts';
import { OMNIMUX_CLIP_SAVE } from '../../bridge/clipEvents.ts';
import { sanitizeEdges, sanitizeNodes } from '../../bridge/persistSanitize.ts';
import { planCanvasInputMutation } from '../../../shared/graph/canvasInputMutationGateway.ts';
import {
  CLIP_EXPORT_ORIGIN,
  CLIP_EXPORT_SOURCE_HANDLE,
  CLIP_EXPORT_TARGET_HANDLE,
  clipExportMediaUrl,
  planClipExportDownstream,
} from './videoCompositionDownstream.ts';

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(here, 'videoComposition.tsx');
const handlePath = join(here, '../../editor/components/CanvasNodeHandle.tsx');

const compositionNode = {
  id: 'node_video_composition_1',
  type: 'video_composition',
  position: { x: 40, y: 80 },
  data: { title: '视频合成', status: 'completed', outputVideoUrl: '/exports/a.mp4' },
};

const output = {
  videoPath: '/exports/a.mp4',
  thumbnailPath: 'data:image/jpeg;base64,cover',
  durationMs: 5000,
  width: 1920,
  height: 1080,
};

const expectedMediaUrl = '/omnimux-workflow/api/local-file?path=%2Fexports%2Fa.mp4';

function drawableEdge(source, target) {
  return { source, target, sourceHandle: 'out', targetHandle: 'in' };
}

function planWith(nodes, edges, extra = {}) {
  return planClipExportDownstream({
    sourceNodeId: compositionNode.id,
    sourcePosition: compositionNode.position,
    sourceLabel: '视频合成',
    output,
    currentNodes: [compositionNode, ...nodes],
    currentEdges: edges,
    nodeWidth: 350,
    ...extra,
  });
}

test('CanvasNodeHandle 桩 id 是 in/out，不是 input/output', () => {
  const source = readFileSync(handlePath, 'utf8');
  assert.match(source, /id=\{isLeft \? 'in' : 'out'\}/);
  assert.equal(/id=\{isLeft \? 'input' : 'output'\}/.test(source), false);
});

test('videoComposition.tsx 走 planClipExportDownstream，不再手写 output/input 桩', () => {
  const source = readFileSync(sourcePath, 'utf8');
  assert.match(source, /planClipExportDownstream/);
  assert.match(source, /applyCanvasInputMutation/);
  assert.match(source, /nodePatches: plan\.nodePatches/);
  assert.equal(/sourceHandle:\s*'output'/.test(source), false);
  assert.equal(/targetHandle:\s*'input'/.test(source), false);
});

test('planClipExportDownstream：新建成片节点并用 out/in 连线', () => {
  const plan = planClipExportDownstream({
    sourceNodeId: compositionNode.id,
    sourcePosition: compositionNode.position,
    sourceLabel: '视频合成',
    output,
    currentNodes: [compositionNode],
    currentEdges: [],
    nodeWidth: 350,
    createNodeId: () => 'node_mat_vid_fixed',
  });

  assert.ok(plan);
  assert.equal(plan.addNodes.length, 1);
  assert.equal(plan.addEdges.length, 1);
  assert.deepEqual(plan.removeEdgeIds, []);
  assert.deepEqual(plan.nodePatches, []);
  assert.equal(plan.addNodes[0].id, 'node_mat_vid_fixed');
  assert.equal(plan.addNodes[0].data.label, '视频合成_成片');
  assert.equal(plan.addEdges[0].source, compositionNode.id);
  assert.equal(plan.addEdges[0].target, 'node_mat_vid_fixed');
  assert.equal(plan.addEdges[0].sourceHandle, CLIP_EXPORT_SOURCE_HANDLE);
  assert.equal(plan.addEdges[0].targetHandle, CLIP_EXPORT_TARGET_HANDLE);
  assert.equal(CLIP_EXPORT_SOURCE_HANDLE, 'out');
  assert.equal(CLIP_EXPORT_TARGET_HANDLE, 'in');
});

test('下游放置：目标列空闲时保留默认坐标', () => {
  const elsewhere = { id: 'elsewhere', position: { x: 900, y: 80 }, width: 350, height: 500 };
  const plan = planWith([elsewhere], []);
  assert.deepEqual(plan?.addNodes[0]?.position, { x: 470, y: 80 });
});

test('下游放置：按测量宽高避让占位卡片并为标题留距', () => {
  const obstacle = {
    id: 'obstacle', type: 'material', position: { x: 330, y: 80 },
    width: 100, height: 20, measured: { width: 180, height: 390 },
  };
  const plan = planWith([obstacle], []);
  assert.deepEqual(plan?.addNodes[0]?.position, { x: 470, y: 632 });
});

test('下游放置：同列连续避让并停在首个可容纳成片的空位', () => {
  const first = { id: 'first', type: 'material', position: { x: 470, y: 80 }, width: 350, height: 200 };
  const second = { id: 'second', type: 'material', position: { x: 470, y: 490 }, width: 350, height: 120 };
  const later = { id: 'later', type: 'material', position: { x: 470, y: 1260 }, width: 350, height: 200 };
  const plan = planWith([later, second, first], []);
  const reordered = planWith([first, later, second], []);
  assert.deepEqual(plan?.addNodes[0]?.position, { x: 470, y: 772 });
  assert.deepEqual(reordered?.addNodes[0]?.position, plan.addNodes[0].position);
});

test('下游放置：未测量卡片按素材类型默认宽高避让', () => {
  const unmeasured = {
    id: 'unmeasured', type: 'material', position: { x: 140, y: 110 },
    data: { materialType: 'text' },
  };
  const plan = planWith([unmeasured], []);
  assert.deepEqual(plan?.addNodes[0]?.position, { x: 470, y: 772 });
});

test('下游放置：缩到最小倍率时成片标题仍有空间', () => {
  const above = { id: 'above', type: 'material', position: { x: 470, y: -230 }, width: 350, height: 200 };
  const plan = planWith([above], []);
  assert.deepEqual(plan?.addNodes[0]?.position, { x: 470, y: 132 });
});

test('下游放置：竖版成片为媒体加载后的卡片高度留空间', () => {
  const obstacle = { id: 'below', type: 'material', position: { x: 470, y: 550 }, width: 350, height: 150 };
  assert.deepEqual(planWith([obstacle], [])?.addNodes[0]?.position, { x: 470, y: 80 });
  const portrait = planWith([obstacle], [], { output: { ...output, width: 1080, height: 1920 } });
  assert.deepEqual(portrait?.addNodes[0]?.position, { x: 470, y: 862 });
});

test('下游放置：分组子节点按画布坐标判断', () => {
  const group = { id: 'group', type: 'group', position: { x: 930, y: 50 }, width: 500, height: 600 };
  const grouped = { id: 'grouped', type: 'material', parentId: group.id, position: { x: 32, y: 60 } };
  const plan = planWith([group, grouped], []);
  assert.deepEqual(plan?.addNodes[0]?.position, { x: 470, y: 80 });
});

test('下游放置：折叠组使用收起后的宽高，组内隐藏节点不占位', () => {
  const group = {
    id: 'group', type: 'group', position: { x: 180, y: 50 }, width: 220, height: 44,
    measured: { width: 640, height: 600 }, data: { isCollapsed: true },
  };
  const child = { id: 'child', type: 'material', parentId: group.id, position: { x: 290, y: 30 } };
  const plan = planWith([group, child], []);
  assert.deepEqual(plan?.addNodes[0]?.position, { x: 470, y: 80 });
});

test('下游放置：二次导出经 mutation gateway 保持用户移动后的成片位置', () => {
  const position = Object.freeze({ x: -230, y: 420 });
  const existing = {
    id: 'moved-export', type: 'material', position,
    data: { materialType: 'video', origin: CLIP_EXPORT_ORIGIN, sourceCompositionNodeId: compositionNode.id },
  };
  const obstacle = { id: 'obstacle', position: { x: 470, y: 80 } };
  const edges = [drawableEdge(compositionNode.id, existing.id)];
  const plan = planWith([existing, obstacle], edges, { output: { ...output, revision: '202:10' } });
  assert.ok(plan);
  assert.deepEqual(plan.addNodes, []);
  assert.deepEqual(plan.addEdges, []);
  const applied = planCanvasInputMutation({ nodes: [compositionNode, existing, obstacle], edges }, plan);
  assert.equal(applied.status, 'allowed');
  assert.deepEqual(applied.edges, edges);
  assert.deepEqual(applied.nodes.find(node => node.id === existing.id)?.position, position);
  assert.equal(applied.nodes.find(node => node.id === existing.id)?.data.outputRevision, '202:10');
});

test('新建节点：mediaUrl 是宿主媒体 URL，realPath 才是裸绝对路径', () => {
  const plan = planClipExportDownstream({
    sourceNodeId: compositionNode.id,
    sourcePosition: compositionNode.position,
    sourceLabel: '视频合成',
    output,
    currentNodes: [compositionNode],
    currentEdges: [],
    nodeWidth: 350,
    createNodeId: () => 'node_mat_vid_fixed',
  });

  assert.ok(plan);
  const data = plan.addNodes[0].data;
  assert.equal(data.realPath, output.videoPath);
  assert.equal(data.mediaUrl, expectedMediaUrl);
  assert.equal(data.mediaUrl.includes('?path='), true);
  assert.equal(data.origin, CLIP_EXPORT_ORIGIN);
  assert.equal(data.sourceCompositionNodeId, compositionNode.id);
  assert.equal(data.duration, 5);
  assert.deepEqual(data.size, { width: 1920, height: 1080 });
});

test('clipExportMediaUrl：绝对路径转宿主 URL，已解析的 URL 原样透传', () => {
  assert.equal(clipExportMediaUrl('/exports/a.mp4'), expectedMediaUrl);
  assert.equal(clipExportMediaUrl(expectedMediaUrl), expectedMediaUrl);
  assert.equal(clipExportMediaUrl('blob:http://127.0.0.1/x'), 'blob:http://127.0.0.1/x');
  assert.equal(clipExportMediaUrl('https://cdn.example.com/a.mp4'), 'https://cdn.example.com/a.mp4');
  assert.equal(clipExportMediaUrl(''), '');
});

test('planClipExportDownstream：已有成片节点但缺边时补边，不重复建节点', () => {
  const existing = {
    id: 'node_mat_vid_existing',
    type: 'material',
    position: { x: 470, y: 80 },
    data: { materialType: 'video', realPath: output.videoPath, mediaUrl: output.videoPath },
  };
  const plan = planWith([existing], []);

  assert.ok(plan);
  assert.equal(plan.addNodes.length, 0);
  assert.equal(plan.addEdges.length, 1);
  assert.deepEqual(plan.removeEdgeIds, []);
  assert.equal(plan.addEdges[0].source, compositionNode.id);
  assert.equal(plan.addEdges[0].target, existing.id);
  assert.equal(plan.addEdges[0].sourceHandle, 'out');
  assert.equal(plan.addEdges[0].targetHandle, 'in');
  assert.equal(plan.nodePatches.length, 1);
  assert.equal(plan.nodePatches[0].nodeId, existing.id);
  assert.equal(plan.nodePatches[0].data.mediaUrl, expectedMediaUrl);
});

test('planClipExportDownstream：已有 output/input 坏边时删掉并换成 out/in', () => {
  const existing = {
    id: 'node_mat_vid_existing',
    type: 'material',
    data: { materialType: 'video', realPath: output.videoPath },
  };
  const brokenId = `edge_${compositionNode.id}_${existing.id}`;
  const plan = planWith([existing], [{
    id: brokenId,
    source: compositionNode.id,
    target: existing.id,
    sourceHandle: 'output',
    targetHandle: 'input',
  }]);

  assert.ok(plan);
  assert.equal(plan.addNodes.length, 0);
  assert.deepEqual(plan.removeEdgeIds, [brokenId]);
  assert.equal(plan.addEdges[0].sourceHandle, 'out');
  assert.equal(plan.addEdges[0].targetHandle, 'in');
  assert.equal(plan.addEdges[0].id, brokenId);
});

test('planClipExportDownstream：out/in 边已在时只刷新节点数据，不再重复建节点', () => {
  const existing = {
    id: 'node_mat_vid_existing',
    type: 'material',
    data: { materialType: 'video', realPath: output.videoPath },
  };
  const plan = planWith([existing], [drawableEdge(compositionNode.id, existing.id)]);

  assert.ok(plan);
  assert.equal(plan.addNodes.length, 0);
  assert.deepEqual(plan.addEdges, []);
  assert.deepEqual(plan.removeEdgeIds, []);
  assert.equal(plan.nodePatches.length, 1);
  assert.equal(plan.nodePatches[0].nodeId, existing.id);
  assert.equal(plan.nodePatches[0].data.mediaUrl, expectedMediaUrl);
  assert.equal(plan.nodePatches[0].data.thumbnailUrl, output.thumbnailPath);
  assert.equal(plan.nodePatches[0].data.duration, 5);
  // realPath 不参与刷新：持久化会剥掉它，回写只会让文档反复变脏。
  assert.equal('realPath' in plan.nodePatches[0].data, false);
});

test('planClipExportDownstream：节点数据已是最新且边完好时返回 null（不脏文档）', () => {
  const created = planWith([], []);
  assert.ok(created);
  const fresh = {
    id: 'node_mat_vid_fixed',
    type: 'material',
    data: { ...created.addNodes[0].data },
  };
  const plan = planWith([fresh], [drawableEdge(compositionNode.id, fresh.id)]);
  assert.equal(plan, null);
});

test('planClipExportDownstream：realPath 被持久化剥离后仍按 origin 复用同一节点', () => {
  // persistSanitize 保存时删除 realPath，磁盘上的节点只剩 mediaUrl + origin。
  const sanitized = {
    id: 'node_mat_vid_sanitized',
    type: 'material',
    data: {
      materialType: 'video',
      label: '视频合成_成片',
      status: 'ready',
      selectedTool: 'import',
      origin: CLIP_EXPORT_ORIGIN,
      sourceCompositionNodeId: compositionNode.id,
      mediaUrl: '/omnimux-workflow/api/local-file?path=%2Fhome%2Fdev%2F.dsh%2Fomnimux%2Fclip%2Fexports%2Fclip_node_1.mp4',
      thumbnailUrl: output.thumbnailPath,
      duration: 5,
      size: { width: 1920, height: 1080 },
    },
  };
  const plan = planClipExportDownstream({
    sourceNodeId: compositionNode.id,
    sourcePosition: compositionNode.position,
    sourceLabel: '视频合成',
    output: {
      videoPath: '/home/dev/.dsh/omnimux/clip/exports/clip_node_1.mp4',
      thumbnailPath: 'data:image/jpeg;base64,newcover',
      durationMs: 9000,
      width: 1080,
      height: 1920,
    },
    currentNodes: [compositionNode, sanitized],
    currentEdges: [drawableEdge(compositionNode.id, sanitized.id)],
    nodeWidth: 350,
  });

  assert.ok(plan);
  assert.equal(plan.addNodes.length, 0);
  assert.deepEqual(plan.addEdges, []);
  assert.equal(plan.nodePatches.length, 1);
  assert.equal(plan.nodePatches[0].nodeId, sanitized.id);
  assert.equal(plan.nodePatches[0].data.duration, 9);
  assert.equal(plan.nodePatches[0].data.thumbnailUrl, 'data:image/jpeg;base64,newcover');
  // 只有变化过的字段进 patch；合并后节点仍指向本次导出的文件。
  const merged = { ...sanitized.data, ...plan.nodePatches[0].data };
  assert.equal(
    merged.mediaUrl,
    '/omnimux-workflow/api/local-file?path=%2Fhome%2Fdev%2F.dsh%2Fomnimux%2Fclip%2Fexports%2Fclip_node_1.mp4',
  );
  assert.deepEqual(merged.size, { width: 1080, height: 1920 });
});

test('planClipExportDownstream：createIfMissing=false 且没有成片节点时不新建', () => {
  const plan = planWith([], [], { createIfMissing: false });
  assert.equal(plan, null);
});

test('错误桩 id output/input 即使写入 store，也不是画布能画的边', () => {
  const broken = {
    id: 'edge_broken',
    source: compositionNode.id,
    target: 'node_mat_vid_fixed',
    sourceHandle: 'output',
    targetHandle: 'input',
  };
  assert.notEqual(broken.sourceHandle, CLIP_EXPORT_SOURCE_HANDLE);
  assert.notEqual(broken.targetHandle, CLIP_EXPORT_TARGET_HANDLE);
});

/* ── Issue #3146：重复导出必须让下游 <video> 重新取流 ───────────────────
 * 导出原地覆盖同一个 <projectId>.mp4，URL 不变 → React 复用旧元素、停在首次
 * 加载的失败态。把文件内容身份写进 URL 是让「状态本身」变化的做法。
 */

const revisionOne = '1760000000000:1048576';
const revisionTwo = '1760000123456:2097152';
const revisionedMediaUrl = `${expectedMediaUrl}&rev=${encodeURIComponent(revisionOne)}`;

test('clipExportMediaUrl：无版本时与修复前逐字符一致，有版本时追加 rev', () => {
  assert.equal(clipExportMediaUrl('/exports/a.mp4'), expectedMediaUrl);
  assert.equal(clipExportMediaUrl('/exports/a.mp4', ''), expectedMediaUrl);
  assert.equal(clipExportMediaUrl('/exports/a.mp4', '   '), expectedMediaUrl);
  assert.equal(clipExportMediaUrl('/exports/a.mp4', revisionOne), revisionedMediaUrl);
  // 已解析的 URL 也要能被重新指向新版本，且不重复叠加 rev。
  assert.equal(clipExportMediaUrl(expectedMediaUrl, revisionOne), revisionedMediaUrl);
  assert.equal(
    clipExportMediaUrl(revisionedMediaUrl, revisionTwo),
    `${expectedMediaUrl}&rev=${encodeURIComponent(revisionTwo)}`,
  );
  // 非本机文件地址（blob / http）仍原样透传。
  assert.equal(clipExportMediaUrl('blob:http://127.0.0.1/x', revisionOne), 'blob:http://127.0.0.1/x');
  assert.equal(clipExportMediaUrl('https://cdn.example.com/a.mp4', revisionOne), 'https://cdn.example.com/a.mp4');
  // 版本串必须留在 ?path= 之外，路径还原不受影响。
  const parsed = new URL(revisionedMediaUrl, 'http://127.0.0.1');
  assert.equal(parsed.searchParams.get('path'), '/exports/a.mp4');
  assert.equal(parsed.searchParams.get('rev'), revisionOne);
});

test('planClipExportDownstream：同一节点二次导出产出新 mediaUrl 的 patch，不新建节点', () => {
  const first = planClipExportDownstream({
    sourceNodeId: compositionNode.id,
    sourcePosition: compositionNode.position,
    sourceLabel: '视频合成',
    output: { ...output, revision: revisionOne },
    currentNodes: [compositionNode],
    currentEdges: [],
    nodeWidth: 350,
  });
  assert.ok(first);
  assert.equal(first.addNodes.length, 1);
  assert.equal(first.addNodes[0].data.mediaUrl, revisionedMediaUrl);

  const created = first.addNodes[0];
  const second = planClipExportDownstream({
    sourceNodeId: compositionNode.id,
    sourcePosition: compositionNode.position,
    sourceLabel: '视频合成',
    output: { ...output, revision: revisionTwo },
    currentNodes: [compositionNode, { id: created.id, type: 'material', data: created.data }],
    currentEdges: [drawableEdge(compositionNode.id, created.id)],
    nodeWidth: 350,
  });

  assert.ok(second, '二次导出必须产出 patch，否则 <video> 的 src 不会变');
  assert.deepEqual(second.addNodes, []);
  assert.deepEqual(second.addEdges, []);
  assert.equal(second.nodePatches.length, 1);
  assert.equal(second.nodePatches[0].nodeId, created.id);
  assert.equal(
    second.nodePatches[0].data.mediaUrl,
    `${expectedMediaUrl}&rev=${encodeURIComponent(revisionTwo)}`,
  );
});

test('planClipExportDownstream：同一版本重复应用返回 null（不脏文档、不抖动 URL）', () => {
  const node = {
    id: 'node_mat_vid_rev',
    type: 'material',
    data: {
      materialType: 'video',
      label: '视频合成_成片',
      status: 'ready',
      selectedTool: 'import',
      origin: CLIP_EXPORT_ORIGIN,
      sourceCompositionNodeId: compositionNode.id,
      mediaUrl: revisionedMediaUrl,
      outputRevision: revisionOne,
      thumbnailUrl: output.thumbnailPath,
      duration: 5,
      size: { width: 1920, height: 1080 },
    },
  };
  const plan = planClipExportDownstream({
    sourceNodeId: compositionNode.id,
    sourcePosition: compositionNode.position,
    sourceLabel: '视频合成',
    output: { ...output, revision: revisionOne },
    currentNodes: [compositionNode, node],
    currentEdges: [drawableEdge(compositionNode.id, node.id)],
    nodeWidth: 350,
  });
  assert.equal(plan, null);
});

test('planClipExportDownstream：携带旧 rev 的成片节点仍按 ?path= 复用，不产生重复节点', () => {
  // 没有 origin（早期版本写入的节点），只有带旧 rev 的 mediaUrl。
  const legacy = {
    id: 'node_mat_vid_legacy',
    type: 'material',
    data: { materialType: 'video', mediaUrl: revisionedMediaUrl },
  };
  const plan = planClipExportDownstream({
    sourceNodeId: compositionNode.id,
    sourcePosition: compositionNode.position,
    sourceLabel: '视频合成',
    output: { ...output, revision: revisionTwo },
    currentNodes: [compositionNode, legacy],
    currentEdges: [drawableEdge(compositionNode.id, legacy.id)],
    nodeWidth: 350,
  });
  assert.ok(plan);
  assert.deepEqual(plan.addNodes, [], '旧 rev 节点必须被复用，不得新增重复成片节点');
  assert.equal(plan.nodePatches.length, 1);
  assert.equal(plan.nodePatches[0].nodeId, legacy.id);
  assert.equal(
    plan.nodePatches[0].data.mediaUrl,
    `${expectedMediaUrl}&rev=${encodeURIComponent(revisionTwo)}`,
  );
});

test('两次手工导出更新同一成片与连线，重载后保留最新版本', () => {
  const workspaceId = 'ws_export';
  const projectId = 'clip_node_export';
  const nodeId = compositionNode.id;
  const target = new EventTarget();
  let graph = { nodes: [{ ...compositionNode, data: { ...compositionNode.data, projectId } }], edges: [] };
  const stop = installCanvasClipEvents({
    workspaceId, target, defaultTitle: '视频合成', readGraph: () => graph,
    updateNode(id, data) {
      graph = { ...graph, nodes: graph.nodes.map(node => node.id === id ? { ...node, data: { ...node.data, ...data } } : node) };
    },
    applyMutation(mutation) {
      const result = planCanvasInputMutation(graph, mutation);
      assert.equal(result.status, 'allowed');
      graph = { nodes: result.nodes, edges: result.edges };
    },
    onManualExport() {},
  });
  const save = (revision) => target.dispatchEvent(new CustomEvent(OMNIMUX_CLIP_SAVE, { detail: {
    workspaceId, nodeId, projectId, output: { ...output, revision }, createDownstreamNode: true,
  } }));
  try {
    save('100:10');
    const firstOutput = graph.nodes.find(({ type }) => type === 'material');
    assert.equal(firstOutput.data.mediaUrl, `${expectedMediaUrl}&rev=100%3A10`);
    save('200:20');
    const reopened = JSON.parse(JSON.stringify({
      nodes: sanitizeNodes(graph.nodes, { workspaceId }), edges: sanitizeEdges(graph.edges),
    }));
    const [source, currentOutput] = reopened.nodes;
    assert.equal(reopened.nodes.length, 2);
    assert.equal(currentOutput.data.realPath, undefined);
    assert.equal(source.data.outputRevision, '200:20');
    assert.equal(source.data.outputVideoUrl, `${expectedMediaUrl}&rev=200%3A20`);
    assert.equal(currentOutput.id, firstOutput.id);
    assert.equal(currentOutput.data.outputRevision, source.data.outputRevision);
    assert.equal(currentOutput.data.mediaUrl, source.data.outputVideoUrl);
    assert.deepEqual(reopened.edges.map(({ source, target, sourceHandle, targetHandle }) => ({ source, target, sourceHandle, targetHandle })), [
      drawableEdge(nodeId, currentOutput.id),
    ]);
    assert.equal(planWith([currentOutput], reopened.edges, {
      output: { ...output, videoPath: source.data.outputVideoUrl, revision: source.data.outputRevision },
      createIfMissing: false,
    }), null);
    const sourceCode = readFileSync(sourcePath, 'utf8');
    assert.match(sourceCode, /revision: nodeData\.outputRevision/);
    assert.match(sourceCode, /nodeData\.outputRevision,/);
  } finally {
    stop();
  }
});
