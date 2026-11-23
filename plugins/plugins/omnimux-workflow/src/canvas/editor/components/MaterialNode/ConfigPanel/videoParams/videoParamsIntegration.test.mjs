/**
 * 集成契约测试 — ConfigPanel 全模态接线（2026-09-07 全模态收敛 / T06 更新；Issue #763 更新）
 *
 * 通过源码接线、共享分配和组件渲染覆盖 ConfigPanel 与三材质的集成边界：
 *  - ConfigPanel 消费 VideoTriggerBar / VideoParamPopover / 参数解析与回退适配器；
 *  - 图像分支废除 wf-param-pill--video-summary 幽灵 Select，改挂
 *    ImageTriggerBar / ImageParamPopover；
 *  - 音频（非 ASR）分支在 Issue #763 中彻底移除 AudioTriggerBar / AudioParamPopover
 *    （时长由文本长度决定），底栏只保留模型下拉 + wf-voice-trigger + 生成按钮；
 *  - handleModelChange 委托 buildVideoParameterSelection（仅视频）；
 *  - videoPopoverOpen / imagePopoverOpen 状态接线存在（音频浮层状态已随 #763 移除）；
 *  - components.css 已下线 .wf-param-pill--video-summary；
 *
 * i18n 决策记录：cfg/imageParams/audioParams 组件群沿用硬编码中文（生成方式/
 * 比例/清晰度/时长/音色/纯音乐等），与仓库同模块既有硬编码中文先例保持一致，
 * 不引入 panel.*Param* key，避免半中半典。
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import React from 'react';
import { createRoot, dom, MaterialNode, ReactFlow, useCanvasStore } from '../fixtures/clickablePanel.mjs';
import { resolveInputAssignment } from '../../../../../../shared/validation/inputAssignment.ts';
import { buildUiUpstreamFingerprint, buildEffectiveOpsUiState, readPreferredOperationId, shouldRenderModeUi } from '../../../../../../shared/validation/operationUi.ts';
import { resolveEffectiveVideoParams, validateVideoParamsForUi } from './videoParamAdapter.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPanelPath = join(__dirname, '..', 'index.tsx');
const componentsCssPath = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'theme',
  'components.css',
);
const source = readFileSync(configPanelPath, 'utf8');
const css = readFileSync(componentsCssPath, 'utf8');

test('load migration is revision guarded and does not replay after undo', () => {
  assert.match(source, /migrationCatalogRef/);
  assert.match(source, /liveState\.future\.length > 0/);
  assert.match(source, /liveNode\.data\.params !== params/);
});

test('actual migration effect preserves redo after panel remount and rejects stale params', () => {
  const body = source.match(/useEffect\(\(\) => \{\n    if \(!videoSelection\?\.parameterSelections[\s\S]*?\n  \}, \[videoSelection/)[0].replace(/^useEffect\(\(\) => \{/, '').replace(/\n  \}, \[videoSelection$/, '');
  const run = new Function('videoSelection','activeCatalog','migrationCatalogRef','migrationKey','useCanvasStore','nodeId','params','parameterSelections','commitVideoSelection',body);
  const params = {model:'a',resolution:'480p'}; const selection={params:{model:'a',resolution:'720p'},parameterSelections:{version:1,byModel:{}}};
  let writes=0; const invoke=(state,ref={current:new Map()})=>run(selection,{},ref,'w:a',{getState:()=>state},'a',params,undefined,()=>writes++);
  invoke({future:[{}],nodes:[{id:'a',data:{params}}]});
  invoke({future:[{}],nodes:[{id:'a',data:{params}}]}); // new ref simulates remount
  assert.equal(writes,0);
  invoke({future:[],nodes:[{id:'a',data:{params:{...params,resolution:'1080p'}}}]});
  assert.equal(writes,0);
  invoke({future:[],nodes:[{id:'a',data:{params}}]});
  assert.equal(writes,1);
});

test('model cascade delegates one atomic model/routing/history update without stale params write', () => {
  const selectKey = 'onSelect={({ modelId, strategy, allowedGroups';
  const callback = source.slice(source.indexOf(selectKey), source.indexOf(selectKey) + 700).split('/>')[0];
  assert.doesNotMatch(callback, /onUpdateNodeData|\.\.\.params/);
  assert.match(callback, /handleModelChange\(modelId,/);
  assert.match(source, /parameterSelections: transition.parameterSelections/);
});

const imageSlot = (slot, role = slot) => ({ slot, type: 'image', role, source: 'upstream_edge', min: 1, max: 1 });
const videoModel = { id: 'video-test', label: 'Video test', selectable: true, operations: [
  { id: 'text_to_video', listed: true, output: { type: 'video' }, inputs: [] },
  { id: 'first_frame', listed: true, output: { type: 'video' }, inputs: [imageSlot('first_frame')] },
  { id: 'first_last_frame', listed: true, output: { type: 'video' }, inputs: [imageSlot('first_frame'), imageSlot('last_frame')] },
  { id: 'video_multi_ref', listed: true, output: { type: 'video' }, inputs: [{ ...imageSlot('reference_images', 'reference'), max: 3 }] },
] };
const catalogFor = model => ({ source: 'omnimux', models: [model], video: [model] });
const imageUpstream = index => ({
  nodeId: `image-${index}`, edgeId: `edge-${index}`, materialType: 'image',
  availability: 'ready', url: `https://example.test/${index}.png`, mimeType: 'image/png',
});

function resolveVideoPanel(catalog, params, upstreams, autoOperationId) {
  const modelId = params.model;
  const outputType = 'video';
  const fingerprint = buildUiUpstreamFingerprint({ materialType: outputType, prompt: '1dog', nodeFields: params, upstreams });
  const assignment = resolveInputAssignment({
    catalog, modelId, outputType, params, fingerprint, autoOperationId,
    preferredOperationId: readPreferredOperationId(params, autoOperationId),
  });
  const consumed = assignment.effectiveFingerprint;
  const opsState = buildEffectiveOpsUiState({ catalog, modelId, outputType, fingerprint: consumed, assignment });
  const effective = resolveEffectiveVideoParams({
    params, schema: {}, modelItem: catalog.models.find(model => model.id === modelId),
    catalog, opsState, assignment, prompt: consumed.prompt,
  });
  return { assignment, opsState, effective };
}

test('video supply keeps alternative modes discoverable while explicit first frame consumes one image', () => {
  const catalog = catalogFor(videoModel);
  const params = { model: videoModel.id, operation: 'first_frame' };
  const { assignment, opsState, effective } = resolveVideoPanel(catalog, params, [imageUpstream(0), imageUpstream(1)], null);
  assert.deepEqual(assignment.layout.slots.map(slot => slot.slot), ['first_frame']);
  assert.deepEqual(assignment.assigned.map(asset => asset.edgeId), ['edge-0']);
  assert.deepEqual(assignment.unused.map(asset => [asset.edgeId, asset.unusedReason]), [['edge-1', 'capacity']]);
  assert.equal(shouldRenderModeUi(opsState), true);
  assert.deepEqual(effective.effectiveOperations.map(op => op.id), ['text_to_video', 'first_frame', 'first_last_frame', 'video_multi_ref']);
  const pair = effective.effectiveOperations.find(op => op.id === 'first_last_frame');
  assert.equal(pair.ready, true);
  assert.equal(pair.disabled, false);
  assert.deepEqual(pair.bindings.map(binding => [binding.slot, binding.edgeId]), [['first_frame', 'edge-0'], ['last_frame', 'edge-1']]);
  assert.equal(opsState.selectedOperationId, 'first_frame');
  assert.equal(opsState.blockGenerate, false);

  const manual = resolveVideoPanel(catalog, params, [], null);
  assert.equal(manual.opsState.selectedOperationId, 'first_frame');
  assert.equal(manual.opsState.blockGenerate, true);
  assert.ok(manual.assignment.blocked.some(issue => issue.code === 'min_unsatisfied' && issue.slot === 'first_frame'));
  const automatic = resolveVideoPanel(catalog, params, [], 'first_frame');
  assert.equal(automatic.opsState.selectedOperationId, 'text_to_video');
  assert.equal(automatic.opsState.blockGenerate, false);
});

test('R4: overflow keeps a single-operation duration schema and its validation intact', () => {
  const duration = { options: [{ value: 5 }], defaultValue: 5, required: true };
  const firstFrame = {
    ...videoModel.operations[1],
    parameters: { duration, prompt: { maxLength: 40 } },
  };
  const catalog = catalogFor({ ...videoModel, operations: [firstFrame] });
  const upstreams = [imageUpstream(0), imageUpstream(1), {
    nodeId: 'table', edgeId: 'table-edge', materialType: 'table', textContent: 'table-body-unique', availability: 'ready',
  }];
  const rawParams = { model: videoModel.id, operation: 'first_frame', duration: 10 };
  const { assignment, opsState, effective } = resolveVideoPanel(catalog, rawParams, upstreams, null);
  assert.deepEqual(assignment.effectiveFingerprint.assets.map(asset => asset.edgeId), ['edge-0', 'table-edge']);
  const prompt = assignment.effectiveFingerprint.prompt;
  assert.match(prompt, /1dog/);
  assert.equal(prompt.split('table-body-unique').length - 1, 1);
  assert.equal(opsState.blockGenerate, false);
  assert.deepEqual(effective.schema.duration, duration);
  assert.equal(effective.duration, 5, 'Normalize the stale saved value against the selected operation');
  assert.deepEqual(validateVideoParamsForUi({ prompt, rawParams, params: effective }), []);

  const validRaw = { ...rawParams, duration: 5 };
  const valid = resolveVideoPanel(catalog, validRaw, upstreams, null);
  assert.equal(valid.effective.duration, 5);
  assert.deepEqual(validateVideoParamsForUi({ prompt, rawParams: validRaw, params: valid.effective }), []);

  const strictDuration = { options: [{ value: 5 }, { value: 6 }], required: true };
  const strictCatalog = catalogFor({ ...videoModel, operations: [{ ...firstFrame, parameters: { duration: strictDuration } }] });
  const invalid = resolveVideoPanel(strictCatalog, rawParams, upstreams, null);
  assert.deepEqual(invalid.effective.schema.duration, strictDuration);
  assert.equal(invalid.opsState.blockGenerate, true);
  assert.ok(invalid.assignment.blocked.some(issue => issue.code === 'parameter_unsupported' && issue.meta?.field === 'duration'));
  assert.equal(invalid.effective.duration, '');
  assert.deepEqual(invalid.effective.blocked.map(issue => issue.field), ['duration']);
});

test('ConfigPanel 导入并消费 VideoTriggerBar / VideoParamPopover', () => {
  assert.ok(
    source.includes("import { VideoTriggerBar } from './videoParams/VideoTriggerBar';"),
    '应导入 VideoTriggerBar',
  );
  assert.ok(
    source.includes("import { VideoParamPopover } from './videoParams/VideoParamPopover';"),
    '应导入 VideoParamPopover',
  );
  assert.ok(source.includes('<VideoTriggerBar'), '视频分支应渲染 <VideoTriggerBar>');
  assert.ok(source.includes('<VideoParamPopover'), '面板根部应渲染 <VideoParamPopover>');
});

test('图像 / 音频分支幽灵入口已移除（wf-param-pill--video-summary 全源码 0 处）', () => {
  const occurrences = (source.match(/wf-param-pill--video-summary/g) || []).length;
  assert.equal(
    occurrences,
    0,
    'wf-param-pill--video-summary 幽灵 Select 已随图像分支废除，源码不得再出现',
  );
  // 视频分支使用 TriggerBar 包裹层
  const videoBlock = source.slice(
    source.indexOf("{materialType === 'video'"),
    source.indexOf('{materialType === \'video\'', source.indexOf("{materialType === 'video'") + 1) + 4000,
  );
  assert.ok(videoBlock.includes('wf-video-trigger-bar__wrap'), '视频分支应含 TriggerBar 包裹层');
});

test('handleModelChange 仅视频模型消费 buildVideoParameterSelection', () => {
  assert.ok(
    source.includes('buildVideoParameterSelection('),
    'handleModelChange 应委托 buildVideoParameterSelection',
  );
  assert.ok(
    source.includes("if (materialType === 'video' && newModelItem) {"),
    '只有目录中的视频模型使用视频参数转换，其他类型由共享兼容状态决定方式',
  );
  // W2: catalog/upstreams 传入 fallback，便于 operation 收敛
  assert.ok(source.includes('catalog: activeCatalog') || source.includes('catalog,'));
});

test('videoPopoverOpen 状态与 setVideoPopoverOpen 接线存在', () => {
  assert.ok(source.includes('const [videoPopoverOpen, setVideoPopoverOpen] = useState(false);'));
  assert.ok(source.includes('setVideoPopoverOpen(false)'));
  assert.ok(source.includes('setVideoPopoverOpen((p) => !p)'));
  assert.ok(source.includes('videoTriggerRef'));
});

test('视频参数适配器接收共享分配和已合成的提示词', () => {
  const args = source.match(/\? resolveEffectiveVideoParams\(\{([\s\S]*?)\}\)/)?.[1] ?? '';
  assert.match(args, /\bcatalog:/);
  assert.match(args, /^\s*assignment,\s*$/m);
  assert.match(args, /prompt: consumedFingerprint\.prompt/);
  assert.doesNotMatch(args, /\bupstreams:/, '不重复读取上游并拼接正文');
});

test('图像分支废除幽灵 CustomSelect，改挂 ImageTriggerBar / ImageParamPopover', () => {
  assert.ok(
    source.includes("import { ImageTriggerBar } from './imageParams/ImageTriggerBar';"),
    '应导入 ImageTriggerBar',
  );
  assert.ok(
    source.includes("import { ImageParamPopover } from './imageParams/ImageParamPopover';"),
    '应导入 ImageParamPopover',
  );
  assert.ok(source.includes('resolveEffectiveImageParams({'), '应经 resolveEffectiveImageParams 解析');
  const imageBlock = source.slice(source.indexOf("{materialType === 'image'"));
  assert.ok(imageBlock.includes('<ImageTriggerBar'), '图像分支应渲染 <ImageTriggerBar>');
  assert.ok(imageBlock.includes('<ImageParamPopover'), '面板根部应渲染 <ImageParamPopover>');
  assert.ok(imageBlock.includes('imagePopoverOpen'), '图像浮层状态接线存在');
  assert.ok(!imageBlock.includes('wf-param-bar__select--ghost'), '图像分支不得再含幽灵 Select');
});

test('音频（非 ASR）分支：Issue #763 移除时长摘要条与参数浮层，仅保留音色胶囊', () => {
  assert.ok(!source.includes('AudioTriggerBar'), '音频分支不得再渲染/导入 AudioTriggerBar');
  assert.ok(!source.includes('AudioParamPopover'), '面板根部不得再渲染/导入 AudioParamPopover');
  assert.ok(!source.includes('audioPopoverOpen'), '音频浮层状态已移除');
  assert.ok(!source.includes('audioTriggerRef'), '音频触发条 ref 已移除');
  assert.ok(source.includes('resolveEffectiveAudioParams({'), '音色读侧仍经 resolveEffectiveAudioParams 解析');
  assert.ok(source.includes('wf-voice-trigger'), '底栏保留 wf-voice-trigger 音色胶囊');
  assert.ok(source.includes("materialType === 'audio' && !isAsrTool"), 'ASR 分支守卫保留');
  assert.ok(!source.includes('SlidersHorizontal'), '音频底栏不得再有孤立齿轮');
  assert.ok(!source.includes('advanced-drawer'), '内联抽屉整段已废除');
  assert.ok(!source.includes('showAdvanced'), 'showAdvanced 状态已废除');
});

test('components.css 已下线 .wf-param-pill--video-summary，wf-cfg-* 双选择器在位', () => {
  assert.ok(
    !css.includes('.wf-param-pill--video-summary'),
    '图像不再消费该胶囊类，CSS 规则必须下线',
  );
  // cfg 底座与视频别名：单规则双选择器，数值只出现一次
  assert.ok(css.includes('.wf-cfg-summary-bar,'), 'wf-cfg-summary-bar 双选择器规则应存在');
  assert.ok(css.includes('.wf-video-trigger-bar'), 'wf-video-trigger-bar 别名应保留');
  assert.ok(css.includes('.wf-cfg-popover,'), 'wf-cfg-popover 双选择器规则应存在');
  assert.ok(css.includes('.wf-video-param-popover'), 'wf-video-param-popover 别名应保留');
});

test('i18n 决策锁定：videoParams 组件群保持硬编码中文，不引入 panel.videoParam*', () => {
  const zhDictPath = join(__dirname, '..', '..', '..', '..', '..', 'i18n', 'dict.zh.ts');
  const enDictPath = join(__dirname, '..', '..', '..', '..', '..', 'i18n', 'dict.en.ts');
  const zh = readFileSync(zhDictPath, 'utf8');
  const en = readFileSync(enDictPath, 'utf8');
  assert.ok(
    !zh.includes('videoParam') && !en.includes('videoParam'),
    '不应新增 panel.videoParam* i18n key（与仓库硬编码中文先例保持一致）',
  );
});

test('不应存在待确认视频参数调整提示与确认/保留原值动作（已移除）', () => {
  assert.ok(!source.includes('wf-video-param-notice'));
  assert.ok(!source.includes('确认调整'));
  assert.ok(!source.includes('保留原值'));
  assert.ok(!source.includes('Boolean(pendingVideoParamAdjustment)'));
});

const { act, createElement, useMemo } = React;
const { document } = dom.window;
const nodeTypes = { material: MaterialNode };
const draftId = 'video-draft';
after(() => dom.window.close());

async function mountManagedVideo(t) {
  const version = 'video-line-fixture';
  const line = { id: 'frames', label: 'Frames', enabled: true, effectiveVersion: version,
    effectiveOperations: videoModel.operations.slice(0, 3).map(op => ({ ...op, modeKind: op.id, gatewayProtocol: 'video_generations' })) };
  const catalog = catalogFor({ ...videoModel, effectiveVideoVersion: version, channelGroups: [line] });
  const sources = [0, 1].map(index => {
    const upstream = imageUpstream(index);
    return { id: upstream.nodeId, type: 'material', position: { x: 0, y: index * 100 }, width: 160, height: 80,
      data: { materialType: 'image', nodeKind: 'import', selectedTool: 'import', status: 'ready', mediaUrl: upstream.url, mimeType: upstream.mimeType } };
  });
  const draft = { id: draftId, type: 'material', selected: true, position: { x: 260, y: 100 }, width: 240, height: 160,
    data: { materialType: 'video', nodeKind: 'generate', selectedTool: 'video-generation', status: 'ready',
      prompt: 'Animate the subject', autoOperationId: null,
      params: { model: videoModel.id, operation: 'first_frame', routing: { allowedGroups: [line.id] } } } };
  useCanvasStore.setState({ nodes: [...sources, draft], edges: [], catalogRuntime: catalog, past: [], future: [],
    selectedElement: { type: 'node', id: draftId } });
  const addEdges = sources.map(({ id }, index) => ({
    id: `edge-${index}`, source: id, sourceHandle: 'out', target: draftId, targetHandle: 'in',
  }));
  assert.equal(useCanvasStore.getState().applyCanvasInputMutation({ addEdges }).status, 'allowed');

  function Canvas() {
    const nodes = useCanvasStore(state => state.nodes);
    const edges = useCanvasStore(state => state.edges);
    const onNodesChange = useCanvasStore(state => state.onNodesChange);
    const flowNodes = useMemo(() => nodes.map(node => ({ ...node, data: { ...node.data, __catalog: catalog } })), [nodes]);
    return createElement(ReactFlow, { nodes: flowNodes, edges, nodeTypes, onNodesChange, width: 1024, height: 720 });
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  t.after(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  await act(async () => root.render(createElement(Canvas)));
}

const wells = () => Array.from(document.querySelectorAll('[data-testid="wf-slot-wells"] .wf-slot-well[data-slot]'),
  well => [well.dataset.slot, well.dataset.slotEdge, well.dataset.slotState]);
const savedOperation = () => useCanvasStore.getState().nodes.find(node => node.id === draftId).data.params.operation;
const generationDisabled = () => document.querySelector('.wf-generate-btn__send')?.getAttribute('aria-disabled');

test('Issue #986: managed video keeps the selected mode and only renders its active wells as supply changes', async t => {
  await mountManagedVideo(t);
  assert.equal(savedOperation(), 'first_frame');
  assert.deepEqual(wells(), [['first_frame', 'edge-0', 'ready']]);
  assert.equal(generationDisabled(), 'false');

  for (const removeEdgeIds of [['edge-0'], ['edge-1']]) {
    await act(async () => {
      assert.equal(useCanvasStore.getState().applyCanvasInputMutation({ removeEdgeIds }).status, 'allowed');
    });
    assert.equal(savedOperation(), 'first_frame');
    const remaining = removeEdgeIds.includes('edge-0');
    assert.deepEqual(wells(), [remaining ? ['first_frame', 'edge-1', 'ready'] : ['first_frame', undefined, 'empty']]);
    assert.equal(generationDisabled(), remaining ? 'false' : 'true');
  }
});

test('Issue #1007: connected images keep the bottom mode label and line-specific choices usable', async t => {
  await mountManagedVideo(t);
  const trigger = document.querySelector('button.wf-video-trigger-bar');
  assert.equal(trigger?.getAttribute('data-show-mode'), 'true');
  assert.equal(trigger.querySelector('.wf-video-trigger-bar__mode')?.textContent, '首帧');
  await act(async () => trigger.click());
  const choices = Array.from(document.querySelectorAll('[data-testid="wf-operation-mode-section"] [role="radio"]'));
  assert.deepEqual(choices.map(choice => [choice.dataset.operationId, choice.getAttribute('aria-checked'), choice.disabled]), [
    ['text_to_video', 'false', false], ['first_frame', 'true', false], ['first_last_frame', 'false', false],
  ]);
  await act(async () => choices[2].click());
  assert.equal(savedOperation(), 'first_last_frame');
  assert.deepEqual(wells(), [['first_frame', 'edge-0', 'ready'], ['last_frame', 'edge-1', 'ready']]);
  assert.equal(generationDisabled(), 'false');
  assert.equal(document.querySelector('.wf-video-trigger-bar__mode')?.textContent, '首尾帧');
});
