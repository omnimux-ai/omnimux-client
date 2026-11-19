/**
 * Issue #109：素材抽屉只去掉「已呈现结果」的复读 Toast。
 * - 预览/视图切换：结果直接可见 → 0 Toast；
 * - 剪贴板复制：界面无直观变化 → 成功回执必须保留。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const toasts = [];
const result = await build({
  stdin: {
    contents: "export { dispatchCanvasUtilityAction } from './drawerMenuHandlers.ts'",
    resolveDir: new URL('.', import.meta.url).pathname,
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [{
    name: 'toast-stub',
    setup(buildApi) {
      buildApi.onResolve({ filter: /ui$/ }, () => ({ path: 'ui', namespace: 'stub' }));
      buildApi.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: "export const toast = { success: (...args) => globalThis.__issue109Toasts.push({ level: 'success', args }), warning: (...args) => globalThis.__issue109Toasts.push({ level: 'warning', args }), error: (...args) => globalThis.__issue109Toasts.push({ level: 'error', args }), info: (...args) => globalThis.__issue109Toasts.push({ level: 'info', args }) }",
      }));
    },
  }],
});
globalThis.__issue109Toasts = toasts;
const { dispatchCanvasUtilityAction } = await import(
  'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
);

const item = { id: 'asset-1', name: '湖面.mp4', previewUrl: 'https://example.invalid/preview.mp4', real_path: '/tmp/湖面.mp4' };
let opened = 0;
globalThis.window = { open: () => { opened += 1; } };

function reset() {
  toasts.length = 0;
  opened = 0;
}

test('Issue #109: 打开预览只执行打开动作，不再回执「已打开预览」', () => {
  reset();
  dispatchCanvasUtilityAction('open-preview', item, () => {}, 'tree');
  assert.equal(opened, 1);
  assert.deepEqual(toasts, []);
});

test('Issue #109: 网格/树形视图切换直接改状态，不再回执「已切换视图」', () => {
  reset();
  let mode = 'tree';
  dispatchCanvasUtilityAction('toggle-tree-view', item, (next) => {
    mode = typeof next === 'function' ? next(mode) : next;
  }, 'tree');
  assert.equal(mode, 'grid');
  assert.deepEqual(toasts, []);
});

test('Issue #109: 剪贴板复制仍保留成功回执', () => {
  reset();
  dispatchCanvasUtilityAction('copy-path', item, () => {}, 'tree');
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].level, 'success');
});
