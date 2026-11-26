/**
 * Issue #339 — 上游文本与音频输入卡槽统一至顶部素材区（图标 + 单行省略节点名）回归测试。
 *
 * 覆盖范围：
 * - named（首帧 + 文本）：文本与首帧图同处顶部 wf-slot-wells，不渲染底部 wf-prompt-references；
 * - pair（首尾帧 + 文本）：保留首尾帧互换按钮，文本并排在顶部卡槽行；
 * - strip（全能参考：图 + 文 + 音 + 添加位）：图、文、音全部排在 + 添加位之前，文/音展示节点名而非正文；
 * - named（数字人：角色图 + 驱动音频）：已填驱动音频展示音频图标 + 节点名且不叠加 positionLabel；空槽保留角色底标；
 * - none（纯文本/文生视频）：未连上游文本时不渲染空文本槽且保持 --empty-slots；连入后展示在顶部卡槽；
 * - CSS 契约：44×44 盒模型与单行省略裁切规则完整。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../../..');
const themeCss = readFileSync(join(here, '../../../../theme/components.css'), 'utf8');

const tmp = await mkdtemp(resolve(tmpdir(), 'omnimux-unified-slot-wells-'));
const output = resolve(tmp, 'render.cjs');
const stubs = {
  useModelParameterSchema: `export const getCachedCatalog = () => null; export const useModelParameterSchema = (kind, id, catalog) => ({ schema: {}, modelItem: catalog?.[kind]?.find(m => m.id === id), aspectRatioOptions: [], defaultAspectRatio: '16:9', isAspectRatioValid: () => true, defaultDuration: 5, isDurationValid: () => true });`,
  canvasStore: `const state = () => ({ nodes: globalThis.__uswNodes ?? [], edges: globalThis.__uswEdges ?? [], catalogRuntime: globalThis.__uswCatalog, future: [] }); export const useCanvasStore = Object.assign(selector => selector(state()), { getState: state, subscribe: () => () => {} });`,
  generationPreferencesStore: `export const rememberGenerationModel = async () => {};`,
  i18n: `import zh from ${JSON.stringify(resolve(root, 'src/canvas/i18n/dict.zh.ts'))}; export const useT = () => key => zh[key] ?? key;`,
  ui: `import React from 'react'; export const CustomSelect = () => null; export const CustomSlider = () => null; export const toast = { error: () => {} };`,
};
await build({
  absWorkingDir: root,
  stdin: {
    contents: `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import { ReactFlowProvider } from '@xyflow/react'; import ConfigPanel from ${JSON.stringify(resolve(here, 'index.tsx'))};
export function render(nodeData, catalog, sources = [], edges = []) {
  const nodes = [{ id: 'target', type: 'material', position: { x: 0, y: 0 }, data: nodeData }, ...sources];
  globalThis.__uswCatalog = catalog;
  globalThis.__uswEdges = edges;
  globalThis.__uswNodes = nodes;
  const panel = React.createElement(ConfigPanel, { nodeId: 'target', nodeData, catalog, onUpdateNodeData: () => {}, onGenerate: () => {}, execBusy: false });
  return renderToStaticMarkup(React.createElement(ReactFlowProvider, { initialNodes: nodes, initialEdges: edges }, panel));
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
    name: 'usw-boundaries',
    setup(b) {
      b.onResolve({ filter: /(?:useModelParameterSchema|\/canvasStore|generationPreferencesStore|\/i18n|\/ui)$/ }, (args) => {
        const name = args.path.split('/').pop();
        return name in stubs ? { path: name, namespace: 'usw' } : undefined;
      });
      b.onLoad({ filter: /.*/, namespace: 'usw' }, (args) => ({ contents: stubs[args.path], loader: 'tsx', resolveDir: root }));
    },
  }],
});
const { render } = createRequire(import.meta.url)(output);
await rm(tmp, { recursive: true, force: true });

const promptSlot = {
  slot: 'prompt',
  type: 'text',
  role: 'prompt',
  source: 'node_field',
  valueSources: ['local_field', 'upstream_output'],
  composition: { kind: 'content_with_instruction', localRole: 'instruction' },
  min: 0,
  max: 1,
};

function videoCatalog(operations) {
  const model = {
    id: 'wan-3.0',
    label: 'Wan 3.0',
    listed: true,
    gateway: { schemaVersion: '2.0' },
    operations: operations.map((op) => ({ ...op, listed: true, output: { type: 'video' }, execution: { status: 'live' } })),
  };
  return { source: 'omnimux', text: [], image: [], video: [model], audio: [], models: [model] };
}

const importNode = (id, data) => ({
  id,
  type: 'material',
  position: { x: -240, y: 0 },
  data: { nodeKind: 'import', status: 'ready', ...data },
});
const edge = (id, source) => ({ id, source, sourceHandle: 'out', target: 'target', targetHandle: 'in' });

function videoNode(operation, slotBindings = {}) {
  return {
    materialType: 'video',
    kind: 'generate',
    nodeKind: 'generate',
    selectedTool: 'text-to-video',
    inputBindingVersion: 1,
    prompt: '',
    slotBindings,
    params: { model: 'wan-3.0', operation },
  };
}

test('named (first_frame): text upstream renders inside top wf-slot-wells with icon + node name and no bottom prompt row', () => {
  const catalog = videoCatalog([{
    id: 'first_frame',
    label: '首帧',
    inputs: [
      promptSlot,
      { slot: 'first_frame', type: 'image', role: 'first_frame', source: 'upstream_edge', min: 1, max: 1 },
    ],
  }]);
  const html = render(
    videoNode('first_frame', {
      first_frame: [{ edgeId: 'e-img', sourceNodeId: 'img-1', pinned: true }],
      prompt: [{ edgeId: 'e-txt', sourceNodeId: 'txt-1', pinned: true }],
    }),
    catalog,
    [
      importNode('img-1', { label: '首帧小狗.png', materialType: 'image', mediaUrl: 'https://example.test/dog.png', mimeType: 'image/png' }),
      importNode('txt-1', { label: '核心文案槽位 (Copywriting)', materialType: 'text', content: '这里是很长的正文内容，不应直接塞进 44px 卡槽' }),
    ],
    [edge('e-img', 'img-1'), edge('e-txt', 'txt-1')],
  );

  assert.doesNotMatch(html, /wf-prompt-references|wf-prompt-reference/);
  assert.match(html, /data-testid="wf-slot-wells" data-preset="named"/);
  assert.match(html, /data-slot="first_frame"[^>]*data-slot-edge="e-img"/);
  assert.match(html, /data-slot="prompt"[^>]*data-slot-edge="e-txt"[^>]*><span class="wf-slot-well__tile wf-slot-well__tile--text"><svg[^>]*>[\s\S]*?<\/svg><span class="wf-slot-well__tile-name">核心文案槽位 \(Copywriting\)<\/span><\/span>/);
  assert.doesNotMatch(html, /这里是很长的正文内容/);
});

test('pair (first_last_frame): preserves frame swap control and appends bound text tile in top slot row', () => {
  const catalog = videoCatalog([{
    id: 'first_last_frame',
    label: '首尾帧',
    inputs: [
      promptSlot,
      { slot: 'first_frame', type: 'image', role: 'first_frame', source: 'upstream_edge', min: 1, max: 1 },
      { slot: 'last_frame', type: 'image', role: 'last_frame', source: 'upstream_edge', min: 1, max: 1 },
    ],
  }]);
  const html = render(
    videoNode('first_last_frame', {
      first_frame: [{ edgeId: 'e-first', sourceNodeId: 'img-1', pinned: true }],
      last_frame: [{ edgeId: 'e-last', sourceNodeId: 'img-2', pinned: true }],
      prompt: [{ edgeId: 'e-txt', sourceNodeId: 'txt-1', pinned: true }],
    }),
    catalog,
    [
      importNode('img-1', { label: '首帧.png', materialType: 'image', mediaUrl: 'https://example.test/1.png', mimeType: 'image/png' }),
      importNode('img-2', { label: '尾帧.png', materialType: 'image', mediaUrl: 'https://example.test/2.png', mimeType: 'image/png' }),
      importNode('txt-1', { label: '分镜文案_v3', materialType: 'text', content: '过渡正文' }),
    ],
    [edge('e-first', 'img-1'), edge('e-last', 'img-2'), edge('e-txt', 'txt-1')],
  );

  assert.match(html, /data-preset="pair"/);
  assert.match(html, /class="wf-slot-wells__swap nodrag"/);
  assert.ok(html.indexOf('data-slot-edge="e-first"') < html.indexOf('wf-slot-wells__swap'));
  assert.ok(html.indexOf('wf-slot-wells__swap') < html.indexOf('data-slot-edge="e-last"'));
  assert.ok(html.indexOf('data-slot-edge="e-last"') < html.indexOf('data-slot-edge="e-txt"'));
  assert.match(html, /class="wf-slot-well__tile-name">分镜文案_v3<\/span>/);
});

test('strip (video_multi_ref): places image, text, and audio tiles before append controls with icon + node name', () => {
  const catalog = videoCatalog([{
    id: 'video_multi_ref',
    label: '全能参考',
    inputs: [
      promptSlot,
      { slot: 'reference_images', type: 'image', role: 'reference', source: 'upstream_edge', min: 0, max: 10 },
      { slot: 'reference_audios', type: 'audio', role: 'reference', source: 'upstream_edge', min: 0, max: 5, allowedMimes: ['audio/wav', 'audio/mpeg'] },
    ],
  }]);
  const html = render(
    videoNode('video_multi_ref', {
      reference_images: [{ edgeId: 'e-img', sourceNodeId: 'img-1', pinned: true }],
      reference_audios: [{ edgeId: 'e-aud', sourceNodeId: 'aud-1', pinned: true }],
      prompt: [{ edgeId: 'e-txt', sourceNodeId: 'txt-1', pinned: true }],
    }),
    catalog,
    [
      importNode('img-1', { label: '参考图.png', materialType: 'image', mediaUrl: 'https://example.test/ref.png', mimeType: 'image/png' }),
      importNode('aud-1', { label: '11月23日_产品口播配音_最终版.mp3', materialType: 'audio', mediaUrl: 'https://example.test/voice.mp3', mimeType: 'audio/mpeg' }),
      importNode('txt-1', { label: 'Untitled Script Draft', materialType: 'text', content: 'Script body' }),
    ],
    [edge('e-img', 'img-1'), edge('e-aud', 'aud-1'), edge('e-txt', 'txt-1')],
  );

  assert.match(html, /data-preset="strip"/);
  assert.match(html, /class="wf-slot-well__tile wf-slot-well__tile--audio"[\s\S]*class="wf-slot-well__tile-name">11月23日_产品口播配音_最终版\.mp3<\/span>/);
  assert.match(html, /class="wf-slot-well__tile wf-slot-well__tile--text"[\s\S]*class="wf-slot-well__tile-name">Untitled Script Draft<\/span>/);
  const addIndex = html.indexOf('data-testid="wf-add-reference"');
  assert.ok(addIndex > 0, 'append button should stay visible while capacity remains');
  assert.ok(html.indexOf('data-slot-edge="e-img"') < addIndex);
  assert.ok(html.indexOf('data-slot-edge="e-aud"') < addIndex);
  assert.ok(html.indexOf('data-slot-edge="e-txt"') < addIndex);
});

test('named (digital_human): filled audio well hides positionLabel to avoid overlap while empty audio well keeps it', () => {
  const catalog = videoCatalog([{
    id: 'digital_human',
    label: '数字人',
    inputs: [
      { slot: 'character', type: 'image', role: 'reference', source: 'upstream_edge', min: 1, max: 1 },
      { slot: 'driving_audio', type: 'audio', role: 'audio_track', source: 'upstream_edge', min: 1, max: 1 },
    ],
  }]);

  const emptyHtml = render(videoNode('digital_human', {}), catalog, [], []);
  assert.match(emptyHtml, /data-slot="driving_audio"[^>]*>[\s\S]*?<span class="wf-slot-well__position">驱动音频<\/span>/);

  const filledHtml = render(
    videoNode('digital_human', {
      driving_audio: [{ edgeId: 'e-aud', sourceNodeId: 'aud-1', pinned: true }],
    }),
    catalog,
    [importNode('aud-1', { label: '11月23日口播', materialType: 'audio', mediaUrl: 'https://example.test/speech.wav', mimeType: 'audio/wav' })],
    [edge('e-aud', 'aud-1')],
  );
  const audioCard = filledHtml.match(/<div[^>]*data-slot="driving_audio"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? '';
  assert.match(audioCard, /class="wf-slot-well__tile wf-slot-well__tile--audio"/);
  assert.match(audioCard, /class="wf-slot-well__tile-name">11月23日口播<\/span>/);
  assert.doesNotMatch(audioCard, /wf-slot-well__position/, 'filled audio tile must not overlap with positionLabel');
});

test('none (text_to_video): unbound prompt stays empty-slots without add button; inactive visual prompt also collapses', () => {
  const catalog = videoCatalog([{
    id: 'text_to_video',
    label: '文生视频',
    inputs: [promptSlot],
  }]);

  const unbound = render(videoNode('text_to_video', {}), catalog, [], []);
  assert.match(unbound, /wf-config-panel__prompt-header--empty-slots/);
  assert.doesNotMatch(unbound, /data-testid="wf-slot-wells"/);
  assert.doesNotMatch(unbound, /wf-slot-well--empty|wf-slot-well--append/);

  const bound = render(
    videoNode('text_to_video', { prompt: [{ edgeId: 'e-txt', sourceNodeId: 'txt-1', pinned: true }] }),
    catalog,
    [importNode('txt-1', { label: '开场旁白', materialType: 'text', content: '旁白正文' })],
    [edge('e-txt', 'txt-1')],
  );
  assert.doesNotMatch(bound, /wf-config-panel__prompt-header--empty-slots/);
  assert.match(bound, /data-testid="wf-slot-wells"[\s\S]*class="wf-slot-well__tile-name">开场旁白<\/span>/);

  const disabled = render(
    videoNode('text_to_video', { prompt: [{ edgeId: 'e-txt', sourceNodeId: 'txt-1', pinned: true, use: 'inactive' }] }),
    catalog,
    [importNode('txt-1', { label: '开场旁白', materialType: 'text', content: '旁白正文' })],
    [edge('e-txt', 'txt-1')],
  );
  assert.match(disabled, /wf-config-panel__prompt-header--empty-slots/);
  assert.doesNotMatch(disabled, /data-testid="wf-slot-wells"/);
});

test('non-visual (text / audio): inactive prompt remains visible in top wf-slot-wells', () => {
  for (const outputType of ['text', 'audio']) {
    const model = {
      id: `${outputType}-gen`,
      label: `${outputType} gen`,
      listed: true,
      gateway: { schemaVersion: '2.0' },
      operations: [{
        id: `gen_${outputType}`,
        label: outputType,
        listed: true,
        output: { type: outputType },
        execution: { status: 'live' },
        inputs: [promptSlot],
      }],
    };
    const catalog = { source: 'omnimux', text: [], image: [], video: [], audio: [], [outputType]: [model], models: [model] };
    const html = render(
      {
        materialType: outputType,
        kind: 'generate',
        nodeKind: 'generate',
        selectedTool: outputType === 'text' ? 'text-to-text' : 'text-to-audio',
        inputBindingVersion: 1,
        prompt: '',
        slotBindings: { prompt: [{ edgeId: 'e-inactive', sourceNodeId: 'txt-1', pinned: true, use: 'inactive' }] },
        params: { model: model.id, operation: `gen_${outputType}` },
      },
      catalog,
      [importNode('txt-1', { label: '已停用文案源', materialType: 'text', content: '文案内容' })],
      [edge('e-inactive', 'txt-1')],
    );
    assert.doesNotMatch(html, /wf-config-panel__prompt-header--empty-slots/, `${outputType} keeps inactive prompt visible`);
    assert.match(html, /data-testid="wf-slot-wells"[\s\S]*data-slot="prompt"[^>]*data-slot-edge="e-inactive"[^>]*data-slot-state="inactive"/);
    assert.match(html, /class="wf-slot-well__tile-name">已停用文案源<\/span>/);
  }
});

test('table upstream and waiting/unavailable bound inputs render unified states in top wf-slot-wells', () => {
  const catalog = videoCatalog([{
    id: 'video_multi_ref',
    label: '全能参考',
    inputs: [
      promptSlot,
      { slot: 'reference_audios', type: 'audio', role: 'reference', source: 'upstream_edge', min: 0, max: 5, allowedMimes: ['audio/wav', 'audio/mpeg'] },
    ],
  }]);

  const tableHtml = render(
    videoNode('video_multi_ref', {
      prompt: [{ edgeId: 'e-tbl', sourceNodeId: 'tbl-1', pinned: true }],
    }),
    catalog,
    [importNode('tbl-1', { label: '分镜参数表_2026', materialType: 'table', content: '| 镜头 | 台词 |\n| 1 | 绝不泄漏进44px方块 |' })],
    [edge('e-tbl', 'tbl-1')],
  );
  assert.match(tableHtml, /data-slot="prompt"[^>]*data-slot-edge="e-tbl"[^>]*><span class="wf-slot-well__tile wf-slot-well__tile--text"><svg[^>]*>[\s\S]*?<\/svg><span class="wf-slot-well__tile-name">分镜参数表_2026<\/span><\/span>/);
  assert.doesNotMatch(tableHtml, /绝不泄漏进44px方块/);

  const waitingHtml = render(
    videoNode('video_multi_ref', {
      prompt: [{ edgeId: 'e-wait', sourceNodeId: 'txt-wait', pinned: true }],
      reference_audios: [{ edgeId: 'e-broken', sourceNodeId: 'aud-broken', pinned: true }],
    }),
    catalog,
    [
      importNode('txt-wait', { label: '生成中文案', materialType: 'text', status: 'generating', content: '' }),
      importNode('aud-broken', { label: '失败音频', materialType: 'audio', status: 'error', mediaUrl: '', mimeType: 'audio/wav' }),
    ],
    [edge('e-wait', 'txt-wait'), edge('e-broken', 'aud-broken')],
  );
  assert.match(waitingHtml, /data-slot="prompt"[^>]*data-slot-edge="e-wait"[^>]*><span class="wf-slot-well__placeholder wf-slot-well__placeholder--loading"/);
  assert.match(waitingHtml, /data-slot="reference_audios"[^>]*data-slot-edge="e-broken"[^>]*><span class="wf-slot-well__placeholder wf-slot-well__placeholder--broken"/);
});

test('SlotHoverPreview shows header title for text, table, and audio only (omits for image and video)', async () => {
  const { JSDOM } = createRequire(resolve(root, '../omnimux/package.json'))('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><main></main><button id="anchor">tile</button></body></html>');
  const prev = new Map();
  const globals = ['window', 'document', 'Node', 'HTMLElement', 'Element', 'IS_REACT_ACT_ENVIRONMENT', 'requestAnimationFrame', 'cancelAnimationFrame'];
  for (const name of globals) prev.set(name, globalThis[name]);
  for (const name of ['window', 'document', 'Node', 'HTMLElement', 'Element']) globalThis[name] = dom.window[name];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};

  const previewTmp = await mkdtemp(resolve(tmpdir(), 'omnimux-slot-preview-'));
  const previewOut = resolve(previewTmp, 'preview.cjs');
  const req = createRequire(import.meta.url);
  try {
    await build({
      absWorkingDir: root,
      entryPoints: [resolve(here, 'SlotWells/SlotHoverPreview.tsx')],
      bundle: true,
      jsx: 'automatic',
      platform: 'node',
      format: 'cjs',
      outfile: previewOut,
      logLevel: 'silent',
      plugins: [{
        name: 'preview-externals',
        setup(b) {
          b.onResolve({ filter: /^(?:react|react-dom)(?:\/.*)?$/ }, (args) => ({
            path: req.resolve(args.path),
            external: true,
          }));
          b.onResolve({ filter: /\/i18n$/ }, () => ({ path: 'i18n', namespace: 'usw-preview' }));
          b.onLoad({ filter: /.*/, namespace: 'usw-preview' }, () => ({ contents: stubs.i18n, loader: 'ts', resolveDir: root }));
        },
      }],
    });
    const React = req('react');
    const { createRoot } = req('react-dom/client');
    const SlotHoverPreview = req(previewOut).default;
    const anchor = document.querySelector('#anchor');
    anchor.getBoundingClientRect = () => ({ x: 100, y: 200, left: 100, top: 200, right: 144, bottom: 244, width: 44, height: 44 });
    const mountRoot = createRoot(document.querySelector('main'));
    try {
      const cases = [
        { type: 'text', label: '核心文案槽位', textContent: '正文内容', expectTitle: true },
        { type: 'table', label: '分镜参数表', textContent: '| a | b |', expectTitle: true },
        { type: 'audio', label: '11月23日口播.wav', url: 'https://example.test/a.wav', expectTitle: true },
        { type: 'image', label: '首帧小狗.png', url: 'https://example.test/a.png', expectTitle: false },
        { type: 'video', label: '样片.mp4', url: 'https://example.test/a.mp4', expectTitle: false },
      ];
      for (const item of cases) {
        await React.act(async () => {
          mountRoot.render(React.createElement(SlotHoverPreview, {
            anchor,
            upstream: {
              nodeId: 'u-1',
              edgeId: 'e-1',
              label: item.label,
              materialType: item.type,
              availability: 'ready',
              hasMedia: true,
              url: item.url,
              textContent: item.textContent,
            },
            onClose: () => {},
          }));
        });
        const title = document.querySelector('.wf-slot-hover-preview__title');
        if (item.expectTitle) {
          assert.equal(title?.textContent, item.label, `${item.type} preview must show upstream label`);
        } else {
          assert.equal(title, null, `${item.type} preview must omit header title`);
        }
      }
    } finally {
      await React.act(async () => { mountRoot.unmount(); });
    }
  } finally {
    await rm(previewTmp, { recursive: true, force: true });
    dom.window.close();
    for (const [name, value] of prev) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});

test('CSS contract enforces 44x44 tile containment, visible surface token, and single-line ellipsis truncation', () => {
  assert.match(themeCss, /\.wf-slot-well__tile\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?background:\s*var\(--dsw-alias-bg-layer-2\);/);
  assert.match(themeCss, /\.wf-slot-well__tile-name\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/);
  assert.doesNotMatch(themeCss, /\.wf-prompt-reference\s*\{/);
});
