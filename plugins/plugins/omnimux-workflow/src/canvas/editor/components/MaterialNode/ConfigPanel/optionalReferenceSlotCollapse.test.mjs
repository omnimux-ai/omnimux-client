/**
 * Issue #373 — 必填空槽独立展示与非必填多格式参考收拢为单通用 `+` 按钮回归测试。
 *
 * 覆盖范围：
 * - 全可选多格式参考（wan-3.0 / seedance-2-0 / minimax-h3-video 全能参考、gemini-3.8-flash / gemini-4-argon / seed-evolving 多模态 chat）：
 *   仅渲染 1 个无底标通用 `+`（data-testid="wf-add-reference"，无独立 data-slot），点击发出包含所有余量参考槽的 referenceSlots；
 * - 混合必填与可选多格式参考（seedance-2-5 全能参考：reference_images min=1，视频/音频 min=0）：
 *   0 图时渲染必填 `[+ 参考图]`（wf-slot-well--required）+ 1 个通用 `+`；填满 1 张图后必填空槽消失，收敛为 1 个通用 `+`；
 * - 必填具名/配对/单参考槽（first_frame / first_last_frame / digital_human / muse-video / image_to_image）：
 *   必填空槽全部独立保留，单槽维持原有单槽 SlotIntent；
 * - 容量耗尽与线路级 inputMaxByType：
 *   全部耗尽时不渲染 `+`；resourcePickerReferenceGroup 遵守 inputMaxByType 并在真实 wan-3.0 目录上一次路由混合图+视频+音频。
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readBundledSnapshot } from '../../../../../../../omnimux/src/catalog/cloud/bundled.js';
import { buildModelCatalog } from '../../../../../../../omnimux/src/catalog/list.js';
import { deriveSlotLayout } from '../../../../../shared/graph/feedSlot/deriveSlotLayout.ts';
import { planCanvasInputMutation } from '../../../../../shared/graph/canvasInputMutationGateway.ts';
import {
  listCanvasResources,
  planPickerSelectionMutation,
  resourcePickerReferenceGroup,
} from '../../../utils/resourcePickerPolicy.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../../..');
const bundledCatalog = buildModelCatalog({ snapshot: structuredClone(readBundledSnapshot().snapshot), env: {} });

const tmp = await mkdtemp(resolve(tmpdir(), 'omnimux-opt-ref-slots-'));
const output = resolve(tmp, 'slotWells.cjs');
await build({
  absWorkingDir: root,
  stdin: {
    contents: `import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SlotWells from ${JSON.stringify(resolve(here, 'SlotWells/SlotWells.tsx'))};
export { React, SlotWells };
export function renderSlotWells(props) {
  return renderToStaticMarkup(React.createElement(SlotWells, props));
}`,
    resolveDir: root,
  },
  bundle: true,
  jsx: 'automatic',
  platform: 'node',
  format: 'cjs',
  outfile: output,
  logLevel: 'silent',
  plugins: [{
    name: 'opt-ref-i18n',
    setup(b) {
      b.onResolve({ filter: /\/i18n$/ }, () => ({ path: 'i18n', namespace: 'opt-ref' }));
      b.onLoad({ filter: /.*/, namespace: 'opt-ref' }, () => ({
        contents: `import zh from ${JSON.stringify(resolve(root, 'src/canvas/i18n/dict.zh.ts'))}; export const useT = () => key => zh[key] ?? key;`,
        loader: 'ts',
        resolveDir: root,
      }));
    },
  }],
});
const { renderSlotWells } = createRequire(import.meta.url)(output);
await rm(tmp, { recursive: true, force: true });

function parseAddButtons(html) {
  return [...html.matchAll(/<button([^>]*data-testid="wf-add-reference"[^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs, inner]) => ({
    attrs,
    inner,
    slot: attrs.match(/data-slot="([^"]+)"/)?.[1] ?? null,
    role: attrs.match(/data-slot-role="([^"]+)"/)?.[1] ?? null,
    ariaLabel: attrs.match(/aria-label="([^"]+)"/)?.[1] ?? null,
    required: attrs.includes('wf-slot-well--required'),
    positionLabel: inner.match(/class="wf-slot-well__position">([^<]+)<\/span>/)?.[1] ?? null,
  }));
}

const noopHandlers = {
  onPickSlot: () => {},
  onClearOccupant: () => {},
  onInsertToken: () => {},
};

test('all-optional multi-type video_multi_ref models render exactly one generic add button (no per-type empty wells)', () => {
  for (const modelId of ['wan-3.0', 'seedance-2-0', 'minimax-h3-video']) {
    const layout = deriveSlotLayout(bundledCatalog, modelId, 'video_multi_ref');
    const html = renderSlotWells({ layout, bindings: {}, records: [], upstreams: [], ...noopHandlers });
    const buttons = parseAddButtons(html);
    assert.equal(buttons.length, 1, `${modelId} must collapse optional reference slots into 1 add button`);
    assert.equal(buttons[0].slot, null, `${modelId} unified add button must not bind a single data-slot`);
    assert.equal(buttons[0].role, 'reference');
    assert.equal(buttons[0].ariaLabel, '添加素材');
    assert.equal(buttons[0].required, false);
    assert.equal(buttons[0].positionLabel, null, `${modelId} unified add button must not show a type bottom label`);
  }
});

test('all-optional multimodal chat models collapse 2-4 optional slots into a single generic add button', () => {
  for (const modelId of ['gemini-3.8-flash', 'gemini-4-argon', 'seed-evolving']) {
    const layout = deriveSlotLayout(bundledCatalog, modelId, 'chat');
    const html = renderSlotWells({ layout, bindings: {}, records: [], upstreams: [], ...noopHandlers });
    const buttons = parseAddButtons(html);
    assert.equal(buttons.length, 1, `${modelId} chat must render 1 generic add button instead of per-type empty wells`);
    assert.equal(buttons[0].slot, null);
    assert.equal(buttons[0].ariaLabel, '添加素材');
    assert.equal(buttons[0].positionLabel, null);
  }
});

test('seedance-2-5 video_multi_ref keeps required reference_images well until satisfied, then collapses to single +', () => {
  const layout = deriveSlotLayout(bundledCatalog, 'seedance-2-5', 'video_multi_ref');
  const imgSpec = layout.slots.find((s) => s.slot === 'reference_images');
  assert.ok(imgSpec && imgSpec.min === 1);

  const emptyHtml = renderSlotWells({ layout, bindings: {}, records: [], upstreams: [], ...noopHandlers });
  const emptyButtons = parseAddButtons(emptyHtml);
  assert.equal(emptyButtons.length, 2, '0 images: 1 required reference_images well + 1 unified optional +');
  assert.equal(emptyButtons[0].slot, 'reference_images');
  assert.equal(emptyButtons[0].required, true);
  assert.equal(emptyButtons[0].positionLabel, '参考图');
  assert.equal(emptyButtons[1].slot, null);
  assert.equal(emptyButtons[1].required, false);
  assert.equal(emptyButtons[1].ariaLabel, '添加素材');
  assert.equal(emptyButtons[1].positionLabel, null);
  assert.doesNotMatch(emptyHtml, /data-slot="reference_videos"|data-slot="reference_audios"/);

  const satisfiedHtml = renderSlotWells({
    layout,
    bindings: { reference_images: [{ edgeId: 'e-img', sourceNodeId: 'img-1', pinned: true }] },
    records: [{ slot: imgSpec, occupant: { edgeId: 'e-img', sourceNodeId: 'img-1', pinned: true }, state: 'ready' }],
    upstreams: [{
      edgeId: 'e-img', nodeId: 'img-1', label: '主图.png', materialType: 'image',
      availability: 'ready', hasMedia: true, url: 'https://example.test/1.png',
    }],
    ...noopHandlers,
  });
  const satisfiedButtons = parseAddButtons(satisfiedHtml);
  assert.equal(satisfiedButtons.length, 1, 'once required image is satisfied, collapse to 1 unified +');
  assert.equal(satisfiedButtons[0].slot, null);
  assert.equal(satisfiedButtons[0].required, false);
  assert.equal(satisfiedButtons[0].positionLabel, null);
});

test('required named/pair modes and single-slot strips keep dedicated required wells and capacity bounds', () => {
  const pairLayout = deriveSlotLayout(bundledCatalog, 'wan-3.0', 'first_last_frame');
  const pairHtml = renderSlotWells({ layout: pairLayout, bindings: {}, records: [], upstreams: [], ...noopHandlers });
  assert.match(pairHtml, /data-slot="first_frame"[^>]*>[\s\S]*?<span class="wf-slot-well__position">首帧<\/span>/);
  assert.match(pairHtml, /data-slot="last_frame"[^>]*>[\s\S]*?<span class="wf-slot-well__position">尾帧<\/span>/);
  assert.match(pairHtml, /wf-slot-wells__swap/);

  const dhLayout = deriveSlotLayout(bundledCatalog, 'minimax-h3-video', 'digital_human');
  const dhHtml = renderSlotWells({ layout: dhLayout, bindings: {}, records: [], upstreams: [], ...noopHandlers });
  assert.match(dhHtml, /data-slot="reference_image"[^>]*>[\s\S]*?<span class="wf-slot-well__position">角色图<\/span>/);
  assert.match(dhHtml, /data-slot="reference_audio"[^>]*>[\s\S]*?<span class="wf-slot-well__position">驱动音频<\/span>/);

  const museLayout = deriveSlotLayout(bundledCatalog, 'muse-video', 'video_multi_ref');
  const museHtml = renderSlotWells({ layout: museLayout, bindings: {}, records: [], upstreams: [], ...noopHandlers });
  const museButtons = parseAddButtons(museHtml);
  assert.equal(museButtons.length, 1);
  assert.equal(museButtons[0].slot, 'reference_images');
  assert.equal(museButtons[0].required, true);
  assert.equal(museButtons[0].positionLabel, null);

  // When all reference slots are full, 0 add buttons render.
  const tightLayout = {
    operationId: 'video_multi_ref',
    preset: 'strip',
    outputType: 'video',
    addButton: true,
    swap: false,
    slots: [
      { slot: 'reference_images', role: 'reference', type: 'image', min: 0, max: 1, labelKey: 'panel.slot.reference_images' },
      { slot: 'reference_audios', role: 'reference', type: 'audio', min: 0, max: 1, labelKey: 'panel.slot.reference_audios' },
    ],
  };
  const fullHtml = renderSlotWells({
    layout: tightLayout,
    bindings: {
      reference_images: [{ edgeId: 'e-i', sourceNodeId: 'i1', pinned: true }],
      reference_audios: [{ edgeId: 'e-a', sourceNodeId: 'a1', pinned: true }],
    },
    records: [
      { slot: tightLayout.slots[0], occupant: { edgeId: 'e-i', sourceNodeId: 'i1', pinned: true }, state: 'ready' },
      { slot: tightLayout.slots[1], occupant: { edgeId: 'e-a', sourceNodeId: 'a1', pinned: true }, state: 'ready' },
    ],
    upstreams: [
      { edgeId: 'e-i', nodeId: 'i1', label: '图1', materialType: 'image', availability: 'ready', hasMedia: true, url: 'https://example.test/i.png' },
      { edgeId: 'e-a', nodeId: 'a1', label: '音1', materialType: 'audio', availability: 'ready', hasMedia: true, url: 'https://example.test/a.wav' },
    ],
    ...noopHandlers,
  });
  assert.equal(parseAddButtons(fullHtml).length, 0);
});

test('unified + button onClick payload emits all available referenceSlots and acceptedTypes in real DOM', async () => {
  const { JSDOM } = createRequire(resolve(root, '../omnimux/package.json'))('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><main></main></body></html>');
  const prev = new Map();
  const globals = ['window', 'document', 'Node', 'HTMLElement', 'Element', 'IS_REACT_ACT_ENVIRONMENT'];
  for (const name of globals) prev.set(name, globalThis[name]);
  for (const name of ['window', 'document', 'Node', 'HTMLElement', 'Element']) globalThis[name] = dom.window[name];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const domTmp = await mkdtemp(resolve(tmpdir(), 'omnimux-opt-ref-dom-'));
  const domOut = resolve(domTmp, 'wells.cjs');
  const req = createRequire(import.meta.url);
  try {
    await build({
      absWorkingDir: root,
      entryPoints: [resolve(here, 'SlotWells/SlotWells.tsx')],
      bundle: true,
      jsx: 'automatic',
      platform: 'node',
      format: 'cjs',
      outfile: domOut,
      logLevel: 'silent',
      plugins: [{
        name: 'opt-ref-dom-externals',
        setup(b) {
          b.onResolve({ filter: /^(?:react|react-dom)(?:\/.*)?$/ }, (args) => ({ path: req.resolve(args.path), external: true }));
          b.onResolve({ filter: /\/i18n$/ }, () => ({ path: 'i18n', namespace: 'opt-ref-dom' }));
          b.onLoad({ filter: /.*/, namespace: 'opt-ref-dom' }, () => ({
            contents: `import zh from ${JSON.stringify(resolve(root, 'src/canvas/i18n/dict.zh.ts'))}; export const useT = () => key => zh[key] ?? key;`,
            loader: 'ts',
            resolveDir: root,
          }));
        },
      }],
    });
    const React = req('react');
    const { createRoot } = req('react-dom/client');
    const SlotWells = req(domOut).default;
    const picked = [];
    const mountRoot = createRoot(document.querySelector('main'));
    try {
      const wanLayout = deriveSlotLayout(bundledCatalog, 'wan-3.0', 'video_multi_ref');
      await React.act(async () => {
        mountRoot.render(React.createElement(SlotWells, {
          layout: wanLayout, bindings: {}, records: [], upstreams: [],
          onPickSlot: (r) => picked.push(r), onClearOccupant: () => {}, onInsertToken: () => {},
        }));
      });
      const wanBtn = document.querySelector('[data-testid="wf-add-reference"]');
      assert.ok(wanBtn);
      await React.act(async () => { wanBtn.click(); });
      assert.equal(picked.length, 1);
      assert.equal(picked[0].targetSlot, undefined);
      assert.deepEqual(picked[0].referenceSlots, ['reference_images', 'reference_videos', 'reference_audios']);
      assert.deepEqual(picked[0].acceptedTypes, ['image', 'video', 'audio']);
      assert.equal(picked[0].max, 20);
      assert.equal(picked[0].openerAnchor, wanBtn);

      // seedance-2-5 with 0 images: clicking required image well picks targetSlot=reference_images, clicking + picks all referenceSlots
      picked.length = 0;
      const sdLayout = deriveSlotLayout(bundledCatalog, 'seedance-2-5', 'video_multi_ref');
      await React.act(async () => {
        mountRoot.render(React.createElement(SlotWells, {
          layout: sdLayout, bindings: {}, records: [], upstreams: [],
          onPickSlot: (r) => picked.push(r), onClearOccupant: () => {}, onInsertToken: () => {},
        }));
      });
      const sdBtns = [...document.querySelectorAll('[data-testid="wf-add-reference"]')];
      assert.equal(sdBtns.length, 2);
      await React.act(async () => { sdBtns[0].click(); sdBtns[1].click(); });
      assert.equal(picked[0].targetSlot, 'reference_images');
      assert.deepEqual(picked[0].acceptedTypes, ['image']);
      assert.equal(picked[1].targetSlot, undefined);
      assert.deepEqual(picked[1].referenceSlots, ['reference_images', 'reference_videos', 'reference_audios']);
      assert.deepEqual(picked[1].acceptedTypes, ['image', 'video', 'audio']);
    } finally {
      await React.act(async () => { mountRoot.unmount(); });
    }
  } finally {
    await rm(domTmp, { recursive: true, force: true });
    dom.window.close();
    for (const [name, value] of prev) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});

test('resourcePickerReferenceGroup routes mixed image+video+audio on wan-3.0 and enforces line inputMaxByType', () => {
  const wanRefSlots = ['reference_images', 'reference_videos', 'reference_audios'];
  const target = {
    id: 'target', type: 'material', position: { x: 400, y: 100 },
    data: {
      label: 'Wan 3.0', materialType: 'video', nodeKind: 'generate', selectedTool: 'video-generation',
      inputBindingVersion: 1, prompt: '', slotBindings: {},
      params: { model: 'wan-3.0', operation: 'video_multi_ref', routing: { allowedGroups: ['wan-3.0-720p'] } },
    },
  };
  const img = {
    id: 'img-1', type: 'material', position: { x: 0, y: 0 },
    data: {
      label: '主图.png', materialType: 'image', nodeKind: 'import', status: 'ready',
      mediaUrl: 'https://fixtures.invalid/dog.png', mimeType: 'image/png', sizeBytes: 1024,
      mediaAssets: [{ type: 'image', url: 'https://fixtures.invalid/dog.png', mimeType: 'image/png', sizeBytes: 1024 }],
    },
  };
  const vid = {
    id: 'vid-1', type: 'material', position: { x: 0, y: 160 },
    data: {
      label: '参考视频.mp4', materialType: 'video', nodeKind: 'import', status: 'ready',
      mediaUrl: 'https://fixtures.invalid/ref.mp4', mimeType: 'video/mp4', sizeBytes: 4096, durationSec: 3,
      mediaAssets: [{ type: 'video', url: 'https://fixtures.invalid/ref.mp4', mimeType: 'video/mp4', sizeBytes: 4096, durationSec: 3 }],
    },
  };
  const aud = {
    id: 'aud-1', type: 'material', position: { x: 0, y: 320 },
    data: {
      label: '口播.wav', materialType: 'audio', nodeKind: 'import', status: 'ready',
      mediaUrl: 'https://fixtures.invalid/voice.wav', mimeType: 'audio/wav', sizeBytes: 2048, durationSec: 2,
      mediaAssets: [{ type: 'audio', url: 'https://fixtures.invalid/voice.wav', mimeType: 'audio/wav', sizeBytes: 2048, durationSec: 2 }],
    },
  };
  const graph = { nodes: [target, img, vid, aud], edges: [] };
  const context = { catalog: bundledCatalog };

  const listed = listCanvasResources(graph.nodes, graph.edges, 'target', context, { referenceSlots: wanRefSlots });
  assert.deepEqual(listed.map((i) => [i.nodeId, i.materialType, i.selectable]), [
    ['img-1', 'image', true],
    ['vid-1', 'video', true],
    ['aud-1', 'audio', true],
  ]);

  const planned = planPickerSelectionMutation(graph, {
    targetNodeId: 'target',
    chosenOperationId: 'video_multi_ref',
    selections: [
      { sourceNodeId: 'img-1', outputId: img.data.mediaUrl },
      { sourceNodeId: 'vid-1', outputId: vid.data.mediaUrl },
      { sourceNodeId: 'aud-1', outputId: aud.data.mediaUrl },
    ],
  }, context, { referenceSlots: wanRefSlots, files: [] });
  assert.equal(planned.status, 'allowed', planned.reasonCode);
  const applied = planCanvasInputMutation(graph, planned.mutation, context);
  assert.equal(applied.status, 'allowed', applied.reasonCode);
  const updated = applied.nodes.find((n) => n.id === 'target');
  assert.equal(updated.data.slotBindings.reference_images[0].sourceNodeId, 'img-1');
  assert.equal(updated.data.slotBindings.reference_videos[0].sourceNodeId, 'vid-1');
  assert.equal(updated.data.slotBindings.reference_audios[0].sourceNodeId, 'aud-1');

  // Verify line-level aggregate inputMaxByType is enforced across sibling slots of the same type
  const lineConstrainedCatalog = {
    models: [{
      id: 'narrow-model',
      channelGroups: [{
        id: 'narrow',
        enabled: true,
        constraints: { inputs: { image: { max: 1 } } },
      }],
      operations: [{
        id: 'video_multi_ref',
        listed: true,
        output: { type: 'video' },
        inputs: [
          { slot: 'reference_images', type: 'image', role: 'reference', source: 'upstream_edge', min: 0, max: 10 },
          { slot: 'style_images', type: 'image', role: 'reference', source: 'upstream_edge', min: 0, max: 5 },
          { slot: 'reference_audios', type: 'audio', role: 'reference', source: 'upstream_edge', min: 0, max: 5 },
        ],
      }],
    }],
  };
  const img2 = { ...img, id: 'img-2', data: { ...img.data, mediaUrl: 'https://fixtures.invalid/dog2.png', mediaAssets: [{ type: 'image', url: 'https://fixtures.invalid/dog2.png', mimeType: 'image/png', sizeBytes: 1024 }] } };
  const narrowTarget = {
    ...target,
    data: {
      ...target.data,
      params: { model: 'narrow-model', operation: 'video_multi_ref', routing: { allowedGroups: ['narrow'] } },
      slotBindings: { reference_images: [{ edgeId: 'e-1', sourceNodeId: 'img-1', outputId: img.data.mediaUrl, role: 'reference', pinned: true }] },
    },
  };
  const narrowGroup = resourcePickerReferenceGroup(
    { nodes: [narrowTarget, img, img2, aud], edges: [{ id: 'e-1', source: 'img-1', target: 'target' }] },
    'target',
    { catalog: lineConstrainedCatalog },
    ['reference_images', 'style_images', 'reference_audios'],
  );
  assert.equal(narrowGroup.slots.find((s) => s.spec.slot === 'reference_images').remaining, 0);
  assert.equal(narrowGroup.slots.find((s) => s.spec.slot === 'style_images').remaining, 0, 'sibling image slot must respect aggregate line inputMaxByType');
  assert.equal(narrowGroup.slots.find((s) => s.spec.slot === 'reference_audios').remaining, 5);
});
