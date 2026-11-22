import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyNodesToClipboard, pasteFromClipboard } from './clipboardUtils.ts';
import { planClipExportDownstream } from '../../nodes/definitions/videoCompositionDownstream.ts';
import { recomputeCanvasSlots } from '../../../shared/graph/canvasSlotRecompute.ts';

function catalog() {
  return {
    source: 'omnimux',
    models: [{
      id: 'gpt-image-2.5', label: 'GPT Image 2.5',
      operations: [{
        id: 'multi_reference', label: '垫图参考', listed: true, output: { type: 'image' },
        inputs: [
          { slot: 'prompt', type: 'text', role: 'prompt', source: 'node_field', min: 1, max: 1 },
          { slot: 'reference_image', type: 'image', role: 'reference', source: 'upstream_edge', min: 0, max: 1 },
        ],
      }],
    }],
    text: [], image: [], audio: [], video: [],
    defaults: { image: 'gpt-image-2.5' },
    defaultsByOperation: {},
    defaultOperations: { image: { modelId: 'gpt-image-2.5', operationId: 'multi_reference', rule: 'auto' } },
  };
}

function sourceNode(id = 'src1') {
  return { id, type: 'material', position: { x: 0, y: 0 }, selected: true, data: { label: 'src', materialType: 'image', nodeKind: 'import' } };
}

function genNode(id = 'gen1', { pinned = true } = {}) {
  return {
    id, type: 'material', position: { x: 200, y: 0 }, selected: true,
    data: {
      label: 'gen', materialType: 'image', nodeKind: 'generate', inputBindingVersion: 1,
      params: { model: 'gpt-image-2.5', operation: 'multi_reference' },
      slotBindings: { reference_image: [{ sourceNodeId: 'src1', edgeId: 'e1', outputId: 'o1', pinned }] },
      slotStandbyEdgeIds: ['e1'],
    },
  };
}

const edge = { id: 'e1', source: 'src1', target: 'gen1', selected: false };

test('two pastes give a video composition new projects and preserve the original edit and output', () => {
  const output = {
    schema: { id: 'native-original', timeline: { tracks: [] }, mediaLibrary: { items: [] } },
    outputVideoUrl: '/exports/original.mp4', outputRevision: '12:42',
    draftRevision: 9, clipExportReceipts: [{ exportJobId: 4, workspaceVersion: 12, fingerprint: 'original' }],
    thumbnailUrl: '/exports/thumb.png', outputThumbnailUrl: '/exports/thumb.png',
    outputDurationMs: 1000, outputWidth: 1280, outputHeight: 720, durationText: '0:01',
    renderProgress: 100, errorMessage: 'old error',
  };
  const composition = {
    id: 'original', type: 'video_composition', position: { x: 320, y: 0 }, selected: true,
    data: { projectId: 'clip_node_original', title: 'Original', schemaVersion: '1.0', status: 'completed', ...output },
  };
  const original = structuredClone(composition);
  const input = { id: 'input', source: 'src1', target: 'original' };
  const clipboard = copyNodesToClipboard([sourceNode(), composition], [input]);
  const copies = [pasteFromClipboard(clipboard), pasteFromClipboard(clipboard)];
  const ids = new Set();
  for (const pasted of copies) {
    const copy = pasted.nodes.find(({ type }) => type === 'video_composition');
    assert.notEqual(copy.id, original.id);
    assert.match(copy.data.projectId, /^clip_node_/);
    assert.notEqual(copy.data.projectId, original.data.projectId);
    assert.equal(copy.data.title, original.data.title);
    assert.equal(copy.data.schemaVersion, original.data.schemaVersion);
    assert.equal(copy.data.status, 'idle');
    for (const key of Object.keys(output)) assert.equal(Object.hasOwn(copy.data, key), false, key);
    assert.equal(pasted.edges[0].target, copy.id);
    ids.add(copy.data.projectId);
  }
  assert.equal(ids.size, 2);
  assert.deepEqual(composition, original);
});

test('re-export updates the owned material or adds its replacement while a pasted output retains its original revision', () => {
  const videoPath = '/exports/original.mp4';
  const mediaUrl = '/omnimux-workflow/api/local-file?path=%2Fexports%2Foriginal.mp4&rev=old';
  const original = {
    id: 'original-output', type: 'material', selected: true, position: { x: 430, y: 0 },
    data: { materialType: 'video', origin: 'clip_export', sourceCompositionNodeId: 'clip-source', mediaUrl, outputRevision: 'old' },
  };
  const [copy] = pasteFromClipboard(copyNodesToClipboard([original], [])).nodes;
  const originalLink = { id: 'clip-link', source: 'clip-source', target: original.id, sourceHandle: 'out', targetHandle: 'in' };
  const nextExport = {
    sourceNodeId: 'clip-source', sourcePosition: { x: 0, y: 0 }, sourceLabel: 'Clip', nodeWidth: 350,
    output: { videoPath, revision: 'new' }, createNodeId: () => 'new-output',
  };
  const withOriginal = planClipExportDownstream({ ...nextExport, currentNodes: [copy, original], currentEdges: [originalLink] });
  assert.deepEqual(withOriginal.nodePatches.map(patch => patch.nodeId), [original.id]);
  assert.equal(withOriginal.nodePatches[0].data.outputRevision, 'new');
  const withoutOriginal = planClipExportDownstream({ ...nextExport, currentNodes: [copy], currentEdges: [] });
  assert.equal(withoutOriginal.addNodes[0].id, 'new-output');
  assert.equal(withoutOriginal.addEdges[0].target, 'new-output');
  assert.equal(copy.data.mediaUrl, mediaUrl);
  assert.equal(copy.data.outputRevision, 'old');
  assert.equal(copy.data.sourceCompositionNodeId, undefined);
});

test('粘贴把 slotBindings 的 source/edge id 重映射到克隆出的新节点/新边（Issue #4039）', () => {
  const nodes = [sourceNode(), genNode()];
  const clipboard = copyNodesToClipboard(nodes, [edge]);
  assert.equal(clipboard.nodes.length, 2);
  assert.equal(clipboard.edges.length, 1);

  const result = pasteFromClipboard(clipboard);
  assert.ok(result);
  const newSrc = result.nodes.find((n) => n.data.label === 'src');
  const newGen = result.nodes.find((n) => n.data.label === 'gen');
  const newEdge = result.edges[0];

  assert.notEqual(newGen.id, 'gen1');
  assert.notEqual(newSrc.id, 'src1');
  assert.notEqual(newEdge.id, 'e1');

  const occ = newGen.data.slotBindings.reference_image;
  assert.equal(occ.length, 1, '绑定在克隆子图内应被保留');
  assert.equal(occ[0].sourceNodeId, newSrc.id, 'sourceNodeId 应指向新节点');
  assert.equal(occ[0].edgeId, newEdge.id, 'edgeId 应指向新边');
  assert.deepEqual(newGen.data.slotStandbyEdgeIds, [newEdge.id], '待命边应重映射到新边');

  // 深拷贝：克隆节点的 data 不得与原节点共享引用，原数据也不得被篡改
  assert.notEqual(newGen.data, nodes[1].data, '克隆节点 data 必须是新对象');
  assert.equal(nodes[1].data.slotBindings.reference_image[0].sourceNodeId, 'src1');
  assert.equal(nodes[1].data.slotBindings.reference_image[0].edgeId, 'e1');
});

test('只粘贴生成节点时，源/边不在范围内的绑定被丢弃为空数组（不留悬空引用）', () => {
  const nodes = [genNode()];
  const clipboard = copyNodesToClipboard(nodes, []);
  const result = pasteFromClipboard(clipboard);
  assert.ok(result);
  const newGen = result.nodes[0];
  assert.deepEqual(newGen.data.slotBindings.reference_image, [], '源/边未被复制，绑定应丢弃');
  assert.deepEqual(newGen.data.slotStandbyEdgeIds, [], '无法映射的待命边应过滤');
});

test('paste remaps retained video mode drafts without retaining unselected upstream references', () => {
  const target = genNode();
  target.data.videoSlotDrafts = {
    image_reference: { reference_images: [
      { sourceNodeId: 'src1', edgeId: 'e1', role: 'reference', ordinal: 3, pinned: true },
      { sourceNodeId: 'src-away', edgeId: 'away', role: 'reference', ordinal: 4, pinned: true },
    ] },
  };
  const result = pasteFromClipboard(copyNodesToClipboard([sourceNode(), target], [edge]));
  assert.ok(result);
  const cloned = result.nodes.find(node => node.data.label === 'gen');
  assert.deepEqual(cloned.data.videoSlotDrafts.image_reference.reference_images, [{
    sourceNodeId: result.edges[0].source, edgeId: result.edges[0].id, role: 'reference', ordinal: 3, pinned: true,
  }]);
  assert.equal(target.data.videoSlotDrafts.image_reference.reference_images.length, 2);
});

test('重映射后的绑定在克隆图上重算仍存活（不会被 #4032 的存活校验清除）', () => {
  // 未固定(pinned=false)占位者：base 下会被 #4032 清除；重映射到新 id 后应存活。
  const nodes = [sourceNode(), genNode('gen1', { pinned: false })];
  const result = pasteFromClipboard(copyNodesToClipboard(nodes, [edge]));
  assert.ok(result);
  const newGen = result.nodes.find((n) => n.data.label === 'gen');
  const rebuilt = recomputeCanvasSlots(newGen, { nodes: result.nodes, edges: result.edges }, { catalog: catalog() });
  const refs = rebuilt.data.slotBindings?.reference_image ?? [];
  assert.equal(refs.length, 1, '重映射后占位者在新子图里应存活');
  assert.equal(refs[0].edgeId, result.edges[0].id, '存活占位者指向新边');
});
