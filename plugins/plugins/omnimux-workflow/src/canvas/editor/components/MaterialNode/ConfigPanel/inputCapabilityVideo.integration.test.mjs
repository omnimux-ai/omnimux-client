/**
 * Epic #63 / Issue #62 — video-node integration surface.
 *
 * Exercises the real ConfigPanel video adapter against the shipped 16-model
 * catalog plus the mode segment DOM contract (disabled = grey, no title copy).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModelCatalog } from '../../../../../../../omnimux/src/catalog/list.js';
import { projectCanvasCatalog } from '../../../../../shared/generationPolicy.ts';
import { resolveEffectiveVideoParams } from './videoParams/videoParamAdapter.ts';
import { buildVideoParameterSelection } from './videoParams/videoParameterSelection.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolvePath(here, '../../../../../..');
const tmp = await mkdtemp(resolvePath(tmpdir(), 'omnimux-input-capability-render-'));
const output = resolvePath(tmp, 'render.cjs');
await build({
  absWorkingDir: root,
  stdin: {
    contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {OperationSegment} from ${JSON.stringify(resolvePath(here, 'videoParams/SegmentControls.tsx'))}; export function renderOperation(props) { return renderToStaticMarkup(React.createElement(OperationSegment, props)); }`,
    resolveDir: root,
  },
  bundle: true, jsx: 'automatic', platform: 'node', format: 'cjs', outfile: output, logLevel: 'silent',
  plugins: [{
    name: 'operation-segment-i18n-stub',
    setup(buildApi) {
      buildApi.onResolve({ filter: /\/i18n$/ }, () => ({ path: 'i18n-stub', namespace: 'operation-segment' }));
      buildApi.onLoad({ filter: /.*/, namespace: 'operation-segment' }, () => ({
        contents: `export const getLocale = () => 'zh';`,
        loader: 'ts',
      }));
    },
  }],
});
const { renderOperation } = createRequire(import.meta.url)(output);
await rm(tmp, { recursive: true, force: true });

const bundled = JSON.parse(readFileSync(new URL('../../../../../../../omnimux/src/catalog/cloud/bundled/pricing.json', import.meta.url), 'utf8'));
const catalog = projectCanvasCatalog(buildModelCatalog({ env: {}, snapshot: bundled }));
const modelItem = (id) => catalog.video.find((row) => row.id === id);

const imageUpstream = (id, extra = {}) => ({
  nodeId: id,
  edgeId: `edge-${id}`,
  materialType: 'image',
  hasMedia: true,
  availability: 'ready',
  url: `https://example.test/${id}.png`,
  ...extra,
});

function effective(modelId, params, upstreams = [], autoOperationId) {
  return resolveEffectiveVideoParams({
    params: { model: modelId, ...params },
    schema: modelItem(modelId)?.parameters,
    modelItem: modelItem(modelId),
    catalog,
    upstreams,
    prompt: 'make a clip',
    autoOperationId,
  });
}

test('connected image auto-selects first_frame, greys text_to_video and projects adaptive', () => {
  const result = effective('muse-video', { operation: 'text_to_video', aspectRatio: '9:16', duration: 8 }, [imageUpstream('img')]);
  assert.equal(result.operation, 'first_frame');
  assert.equal(result.aspectRatio, 'adaptive');
  assert.equal(result.duration, 8);
  assert.equal(result.showModeUi, true);
  const state = (id) => result.effectiveOperations.find((operation) => operation.id === id);
  assert.equal(state('text_to_video')?.disabled, true);
  assert.equal(state('first_frame')?.disabled, false);
});

test('disconnecting every image without history returns to the real text_to_video defaults', () => {
  const result = effective('muse-video', { operation: 'first_frame', aspectRatio: 'adaptive', duration: 5, firstFrameUrl: 'https://example.test/frame.png' }, []);
  assert.equal(result.operation, 'text_to_video');
  assert.equal(result.aspectRatio, '16:9');
  assert.equal(result.duration, 5);
  assert.equal(result.firstFrameUrl, undefined, 'R7 projection drops firstFrameUrl on text_to_video');
  const state = (id) => result.effectiveOperations.find((operation) => operation.id === id);
  assert.equal(state('first_frame')?.disabled, true);
  assert.equal(state('text_to_video')?.disabled, false);

  const seedance = effective('seedance-2-5', { operation: 'first_frame', aspectRatio: 'adaptive', duration: 5 }, []);
  assert.equal(seedance.operation, 'text_to_video');
  assert.equal(seedance.aspectRatio, 'adaptive');
  assert.equal(seedance.duration, 5);
});

test('disconnecting an image restores the pre-connection history 9:16 · 5s', () => {
  const select = (params, parameterSelections, upstreams) => buildVideoParameterSelection({
    params, parameterSelections, currentModelItem: modelItem('muse-video'), targetModelItem: modelItem('muse-video'),
    catalog, upstreams, prompt: 'make a clip',
  });
  const initial = select({ model: 'muse-video', operation: 'text_to_video', aspectRatio: '9:16', duration: 5 }, undefined, []);
  assert.equal(initial.params.operation, 'text_to_video');
  assert.equal(initial.params.aspectRatio, '9:16');
  const connected = select(initial.params, initial.parameterSelections, [imageUpstream('history')]);
  assert.equal(connected.params.operation, 'first_frame');
  assert.equal(connected.params.aspectRatio, 'adaptive');
  const disconnected = select(connected.params, connected.parameterSelections, []);
  assert.equal(disconnected.params.operation, 'text_to_video');
  assert.equal(disconnected.params.aspectRatio, '9:16');
  assert.equal(disconnected.params.duration, 5);
});

test('system-derived video_multi_ref yields to first_last_frame after video removal; explicit choice survives', () => {
  const upstreams = [imageUpstream('a'), imageUpstream('b')];
  const auto = effective('seedance-2-5', { operation: 'video_multi_ref' }, upstreams, 'video_multi_ref');
  assert.equal(auto.operation, 'first_last_frame');
  const explicit = effective('seedance-2-5', { operation: 'video_multi_ref' }, upstreams, null);
  assert.equal(explicit.operation, 'video_multi_ref');
});

test('two connected images select first_last_frame; video edit follows a video input', () => {
  const two = effective('seedance-2-5', { operation: 'text_to_video' }, [imageUpstream('a'), imageUpstream('b')]);
  assert.equal(two.operation, 'first_last_frame');
  const state = (id) => two.effectiveOperations.find((operation) => operation.id === id);
  // #88 A17: first_frame is still an explicit valid choice; the second image
  // is unused:capacity rather than a reason to disable the mode.
  assert.equal(state('first_frame')?.disabled, false);
  assert.equal(state('video_multi_ref')?.disabled, false);

  const video = effective('seedance-2-5', { operation: 'text_to_video' }, [{
    nodeId: 'video-1', edgeId: 'edge-video-1', materialType: 'video', hasMedia: true,
    availability: 'ready', url: 'https://example.test/one.mp4',
  }]);
  assert.equal(video.operation, 'video_edit');
});

test('R8 required parameter without a legal default is exposed as blocked', () => {
  const prompt = { slot: 'prompt', type: 'text', role: 'prompt', source: 'node_field', min: 1, max: 1 };
  const image = { slot: 'first_frame', type: 'image', role: 'first_frame', source: 'upstream_edge', min: 1, max: 1 };
  const blockedModel = {
    id: 'blocked-video', label: 'Blocked video', parameters: {}, operations: [{
      id: 'first_frame', label: '首帧', listed: true, output: { type: 'video' }, inputs: [prompt, image],
      parameters: { aspectRatio: { required: true, options: [{ value: '4k' }] } },
    }],
  };
  const blockedCatalog = {
    source: 'omnimux', text: [], image: [], video: [{ id: 'blocked-video', label: 'Blocked video' }], audio: [],
    models: [blockedModel],
  };
  const result = resolveEffectiveVideoParams({
    params: { model: 'blocked-video', operation: 'first_frame' },
    schema: {}, modelItem: blockedModel, catalog: blockedCatalog,
    upstreams: [imageUpstream('blocked-img')], prompt: 'go',
  });
  assert.equal(result.operation, 'first_frame');
  assert.equal(result.aspectRatio, '');
  assert.equal(result.blocked.length, 1);
  assert.equal(result.blocked[0].field, 'aspectRatio');
  assert.equal(result.blocked[0].required, true);
});

test('R4 mode segment renders disabled operations grey with no title copy and keeps aria-label', () => {
  const html = renderOperation({
    value: 'first_frame',
    operations: [
      { id: 'text_to_video', label: '文生视频', slots: [], bindings: [], effective: false, ready: false, pending: [], disabled: true },
      { id: 'first_frame', label: '首帧驱动', slots: [], bindings: [], effective: true, ready: true, pending: [], disabled: false },
    ],
    onChange: () => {},
  });
  assert.match(html, /aria-label="生成方式"/);
  assert.match(html, /<button[^>]*disabled=""[^>]*data-operation-id="text_to_video"/);
  assert.match(html, /<button[^>]*aria-disabled="true"[^>]*data-operation-id="text_to_video"/);
  assert.doesNotMatch(html, /title="/, 'disabled modes must not carry explanatory copy');
});
