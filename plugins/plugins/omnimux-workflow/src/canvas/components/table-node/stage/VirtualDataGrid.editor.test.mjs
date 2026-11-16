import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, after } from 'node:test';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../..');
const workflowRequire = createRequire(join(root, 'package.json'));

const built = await build({
  absWorkingDir: root,
  stdin: {
    contents: `
      export { VirtualDataGrid } from ${JSON.stringify(join(here, 'VirtualDataGrid.tsx'))};
      export { useTableStore } from ${JSON.stringify(join(root, 'src/canvas/store/tableStore.ts'))};
      export { tableDocumentCache } from ${JSON.stringify(join(root, 'src/canvas/store/tableDocumentCache.ts'))};
      export { createElement, act } from 'react';
      export { createRoot } from 'react-dom/client';
    `,
    resolveDir: root,
    loader: 'tsx',
  },
  bundle: true,
  jsx: 'automatic',
  platform: 'browser',
  format: 'iife',
  globalName: 'api',
  write: false,
  logLevel: 'silent',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [
    {
      name: 'virtual-data-grid-test-stubs',
      setup(builder) {
        builder.onResolve({ filter: /ResourcePickerModal\.tsx$/ }, () => ({ path: 'resource-picker-stub', namespace: 'vdg-test' }));
        builder.onResolve({ filter: /PopoverFieldConfig\.tsx$/ }, () => ({ path: 'field-icon-stub', namespace: 'vdg-test' }));
        builder.onResolve({ filter: /canvasStore\.ts$/ }, () => ({ path: 'canvas-store-stub', namespace: 'vdg-test' }));
        builder.onLoad({ filter: /.*/, namespace: 'vdg-test' }, (args) => {
          if (args.path === 'resource-picker-stub') {
            return { loader: 'tsx', resolveDir: root, contents: `import React from 'react'; export default function ResourcePickerModal(){ return null; }` };
          }
          if (args.path === 'field-icon-stub') {
            return { loader: 'tsx', resolveDir: root, contents: `export const renderFieldTypeIcon = () => null;` };
          }
          return { loader: 'ts', resolveDir: root, contents: `export const useCanvasStore = { getState: () => ({ nodes: [] }) };` };
        });
      },
    },
  ],
});

const dom = new (workflowRequire('jsdom').JSDOM)(
  '<!doctype html><html><body><main id="root"></main></body></html>',
  { url: 'https://example.test', runScripts: 'outside-only', pretendToBeVisual: true },
);
const win = dom.window;
win.IS_REACT_ACT_ENVIRONMENT = true;
win.MessageChannel = class {
  port1 = { onmessage: null };
  port2 = { postMessage: () => setImmediate(() => this.port1.onmessage?.()) };
};
win.HTMLElement.prototype.scrollIntoView = () => {};
win.HTMLTextAreaElement.prototype.setPointerCapture = () => {};
win.HTMLTextAreaElement.prototype.releasePointerCapture = () => {};
win.eval(built.outputFiles[0].text);
const api = win.api;
const { VirtualDataGrid, useTableStore, tableDocumentCache } = api;

let rootInstance = null;

async function mountGrid(documentOverride) {
  if (rootInstance) {
    await api.act(async () => rootInstance.unmount());
    rootInstance = null;
  }
  tableDocumentCache.resetAll();
  useTableStore.setState({
    activeTableId: null,
    document: documentOverride,
    isStageOpen: true,
    selectedRowIndices: [],
    undoStack: [],
    redoStack: [],
  });
  rootInstance = api.createRoot(win.document.getElementById('root'));
  await api.act(async () => {
    rootInstance.render(api.createElement(VirtualDataGrid));
    await Promise.resolve();
  });
}

async function dispatch(target, event) {
  await api.act(async () => {
    target.dispatchEvent(event);
    await Promise.resolve();
  });
}

function query(selector) {
  return win.document.querySelector(selector);
}

function baseDocument() {
  return {
    version: 1,
    title: '测试表格',
    rowHeight: 'low',
    columns: [
      { id: 'c_text', title: '描述', type: 'text', visible: true, width: 240 },
      { id: 'c_attach', title: '附件', type: 'attachment', visible: true, width: 200 },
    ],
    rows: [
      { id: 'r1', cells: { c_text: '第一行' } },
      { id: 'r2', cells: { c_text: '第二行' } },
    ],
  };
}

async function clickCell(rowIdx, colId) {
  const td = query(`td[data-grid-cell-key="${rowIdx}:${colId}"]`);
  assert.ok(td, `cell ${rowIdx}:${colId} should exist`);
  await dispatch(td, new win.MouseEvent('click', { bubbles: true, cancelable: true }));
}

async function dblClickCell(rowIdx, colId) {
  const td = query(`td[data-grid-cell-key="${rowIdx}:${colId}"]`);
  assert.ok(td, `cell ${rowIdx}:${colId} should exist`);
  await dispatch(td, new win.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
}

async function setTextareaValue(value) {
  const ta = query('.wf-grid-cell-editor');
  assert.ok(ta, 'editor textarea should exist');
  const setter = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, value);
  await dispatch(ta, new win.Event('input', { bubbles: true }));
}

async function blurTextarea() {
  const ta = query('.wf-grid-cell-editor');
  assert.ok(ta, 'editor textarea should exist');
  await dispatch(ta, new win.FocusEvent('focusout', { bubbles: true }));
}

async function keyTextarea(key, extra = {}) {
  const ta = query('.wf-grid-cell-editor');
  assert.ok(ta, 'editor textarea should exist');
  await dispatch(ta, new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));
}

after(async () => {
  if (rootInstance) await api.act(async () => rootInstance.unmount());
  dom.window.close();
});

test('单元格单击 selected，双击进入 editing，浮层不进入表格布局且行高不变', async () => {
  await mountGrid(baseDocument());
  const td = query('td[data-grid-cell-key="0:c_text"]');
  const row = td.closest('tr');
  const rowClassBefore = row.className;
  await clickCell(0, 'c_text');
  assert.ok(td.classList.contains('wf-grid-td--cell-selected'), '单击后应有选中描边态');
  assert.equal(row.className, rowClassBefore, '选中不应改变行高 class');
  assert.equal(query('.wf-grid-cell-editor'), null, '单击不应直接进入编辑');

  await dblClickCell(0, 'c_text');
  assert.ok(query('.wf-grid-cell-editor-overlay'), '双击后应出现编辑浮层');
  assert.ok(query('.wf-grid-cell-editor'), '应有 textarea');
  assert.equal(query('.wf-grid-cell-editor-overlay').parentElement.className, 'wf-grid-scroll-pane', '浮层必须是表格的兄弟节点');
  assert.equal(query('.wf-grid-cell-editor-overlay').closest('td'), null, '浮层不得进入单元格布局');
  assert.equal(row.getAttribute('style'), null, '编辑态不得给行加内联高度');
  assert.equal(td.getAttribute('style'), null, '编辑态不得给单元格加内联高度');
  assert.equal(row.className, rowClassBefore, '编辑态不得改变行高 class');
});

test('失焦保存、Esc 取消、Cmd+Enter 保存、Enter 换行、IME 不误触发', async () => {
  await mountGrid(baseDocument());

  // 失焦保存
  await dblClickCell(0, 'c_text');
  await setTextareaValue('失焦保存后的值');
  await blurTextarea();
  assert.equal(query('.wf-grid-cell-editor'), null, '失焦后浮层消失');
  assert.equal(useTableStore.getState().document.rows[0].cells.c_text, '失焦保存后的值');

  // Esc 取消
  await dblClickCell(1, 'c_text');
  await setTextareaValue('不应保存');
  await keyTextarea('Escape');
  assert.equal(query('.wf-grid-cell-editor'), null, 'Esc 后浮层消失');
  assert.equal(useTableStore.getState().document.rows[1].cells.c_text, '第二行', 'Esc 必须还原原值');

  // Enter 只换行，不退出编辑、不保存
  await dblClickCell(0, 'c_text');
  await setTextareaValue('第一行\n第二行');
  await keyTextarea('Enter');
  assert.ok(query('.wf-grid-cell-editor'), 'Enter 后仍应保持编辑态');
  assert.equal(useTableStore.getState().document.rows[0].cells.c_text, '失焦保存后的值', 'Enter 不应提交');

  // IME composition 期间 Enter/Esc 不触发
  const ta = query('.wf-grid-cell-editor');
  await dispatch(ta, new win.CompositionEvent('compositionstart', { bubbles: true }));
  await keyTextarea('Enter', { isComposing: true });
  await keyTextarea('Escape', { isComposing: true });
  assert.ok(query('.wf-grid-cell-editor'), 'IME 期间 Esc/Enter 不应退出编辑');
  await dispatch(ta, new win.CompositionEvent('compositionend', { bubbles: true }));

  // Cmd+Enter 保存
  await setTextareaValue('Cmd 保存的值');
  await keyTextarea('Enter', { metaKey: true });
  assert.equal(query('.wf-grid-cell-editor'), null, 'Cmd+Enter 后浮层消失');
  assert.equal(useTableStore.getState().document.rows[0].cells.c_text, 'Cmd 保存的值');
});

test('点击其他单元格先保存当前再选中目标；点击表格外清除选中；附件单元格不进入编辑', async () => {
  await mountGrid(baseDocument());

  await dblClickCell(0, 'c_text');
  await setTextareaValue('保存后转移');
  const otherTd = query('td[data-grid-cell-key="1:c_text"]');
  await dispatch(otherTd, new win.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
  await blurTextarea();
  await clickCell(1, 'c_text');
  assert.equal(useTableStore.getState().document.rows[0].cells.c_text, '保存后转移');
  assert.ok(query('td[data-grid-cell-key="1:c_text"]').classList.contains('wf-grid-td--cell-selected'));
  assert.equal(query('.wf-grid-cell-editor'), null, '点击其他单元格后应退出编辑');

  // 点击表格外清除选中
  await dispatch(win.document.body, new win.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
  assert.equal(query('.wf-grid-td--cell-selected'), null, '点击表格外应清除选中态');

  // 附件单元格：单击仅选中，双击不进入文本编辑
  await clickCell(0, 'c_attach');
  assert.ok(query('td[data-grid-cell-key="0:c_attach"]').classList.contains('wf-grid-td--cell-selected'));
  await dblClickCell(0, 'c_attach');
  assert.equal(query('.wf-grid-cell-editor'), null, '附件单元格不应进入文本编辑');
});

test('列宽拖拽：2x 缩放下视觉位移按 1/2 换算，拖拽中只改本地预览，pointerup 一次写 store', async () => {
  await mountGrid(baseDocument());
  const pane = query('.wf-grid-scroll-pane');
  Object.defineProperty(pane, 'offsetWidth', { configurable: true, value: 100 });
  pane.getBoundingClientRect = () => ({ width: 200, height: 400, left: 0, top: 0, right: 200, bottom: 400 });
  const resizer = query('.wf-grid-col-resizer');
  assert.ok(resizer, '应有列宽拖拽手柄');

  await dispatch(resizer, new win.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 100 }));
  await dispatch(win.document, new win.MouseEvent('pointermove', { bubbles: true, cancelable: true, clientX: 300 }));
  const textCol = query('colgroup col:nth-child(2)');
  assert.equal(textCol.style.width, '340px', '2x 下视觉 +200px 应换算逻辑 +100px（240→340）');
  assert.equal(useTableStore.getState().document.columns[0].width, 240, '拖拽中不得写 store');
  assert.equal(useTableStore.getState().undoStack.length, 0, '拖拽中不得产生 undo');

  await dispatch(win.document, new win.MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: 300 }));
  assert.equal(useTableStore.getState().document.columns[0].width, 340, 'pointerup 应一次写入列宽');
  assert.equal(useTableStore.getState().undoStack.length, 1, '一次拖拽只产生一次 undo');
});

test('选中态再次单击或 Enter 进入 editing', async () => {
  await mountGrid(baseDocument());

  await clickCell(0, 'c_text');
  assert.equal(query('.wf-grid-cell-editor'), null, '首次单击只进入 selected');
  await clickCell(0, 'c_text');
  assert.ok(query('.wf-grid-cell-editor'), '已选中单元格再次单击应进入 editing');
  assert.equal(query('.wf-grid-cell-editor').value, '第一行');
  await keyTextarea('Escape');
  assert.equal(query('.wf-grid-cell-editor'), null);

  await clickCell(1, 'c_text');
  await dispatch(win.document.body, new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.ok(query('.wf-grid-cell-editor'), '选中态按 Enter 应进入 editing');
  assert.equal(query('.wf-grid-cell-editor').value, '第二行');
  await keyTextarea('Escape');
});

test('pointercancel 回滚列宽本地预览，不写 store、不产生 undo', async () => {
  await mountGrid(baseDocument());
  const pane = query('.wf-grid-scroll-pane');
  Object.defineProperty(pane, 'offsetWidth', { configurable: true, value: 100 });
  pane.getBoundingClientRect = () => ({ width: 200, height: 400, left: 0, top: 0, right: 200, bottom: 400 });
  const resizer = query('.wf-grid-col-resizer');
  await dispatch(resizer, new win.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 100 }));
  await dispatch(win.document, new win.MouseEvent('pointermove', { bubbles: true, cancelable: true, clientX: 300 }));
  assert.equal(query('colgroup col:nth-child(2)').style.width, '340px');
  await dispatch(win.document, new win.MouseEvent('pointercancel', { bubbles: true, cancelable: true, clientX: 300 }));
  assert.equal(query('colgroup col:nth-child(2)').style.width, '240px', 'pointercancel 应恢复拖拽前预览宽度');
  assert.equal(useTableStore.getState().document.columns[0].width, 240, 'pointercancel 不得写 store');
  assert.equal(useTableStore.getState().undoStack.length, 0, 'pointercancel 不得产生 undo');
});

test('编辑浮层在缩放/滚动后保持与单元格对齐', async () => {
  await mountGrid(baseDocument());
  const pane = query('.wf-grid-scroll-pane');
  const td = query('td[data-grid-cell-key="0:c_text"]');
  Object.defineProperty(pane, 'offsetWidth', { configurable: true, value: 100 });
  let paneRect = { width: 200, height: 400, left: 0, top: 0, right: 200, bottom: 400 };
  let cellRect = { width: 80, height: 30, left: 10, top: 20, right: 90, bottom: 50 };
  pane.getBoundingClientRect = () => paneRect;
  td.getBoundingClientRect = () => cellRect;

  await dblClickCell(0, 'c_text');
  let overlay = query('.wf-grid-cell-editor-overlay');
  assert.equal(overlay.style.left, '5px');
  assert.equal(overlay.style.top, '10px');
  assert.equal(overlay.style.width, '80px');

  // 2x → 4x 缩放（模拟画布放大），浮层按新的渲染比例重新定位
  paneRect = { width: 400, height: 800, left: 0, top: 0, right: 400, bottom: 800 };
  cellRect = { width: 160, height: 60, left: 40, top: 80, right: 200, bottom: 140 };
  await dispatch(win, new win.Event('resize'));
  overlay = query('.wf-grid-cell-editor-overlay');
  assert.equal(overlay.style.left, '10px');
  assert.equal(overlay.style.top, '20px');
  assert.equal(overlay.style.width, '80px');

  // 滚动：内容坐标不变，浮层不应漂移
  pane.scrollLeft = 50;
  pane.scrollTop = 30;
  paneRect = { width: 400, height: 800, left: 0, top: 0, right: 400, bottom: 800 };
  cellRect = { width: 160, height: 60, left: 40 - 50 * 4, top: 80 - 30 * 4, right: 200, bottom: 140 };
  await dispatch(pane, new win.Event('scroll', { bubbles: true }));
  overlay = query('.wf-grid-cell-editor-overlay');
  assert.equal(overlay.style.left, '10px');
  assert.equal(overlay.style.top, '20px');
  await keyTextarea('Escape');
});

test('选中态背景高亮规则必须压过普通行与 hover 行', () => {
  const css = readFileSync(resolve(here, '../../../theme/table-node.css'), 'utf8');
  const selector = '.wf-grid-table tbody tr .wf-grid-td--cell-selected';
  const selectorIndex = css.indexOf(selector);
  assert.ok(selectorIndex >= 0, '选中态规则必须存在');
  const openBrace = css.indexOf('{', selectorIndex);
  const closeBrace = css.indexOf('}', openBrace);
  const block = css.slice(openBrace + 1, closeBrace);
  assert.match(block, /background:\s*color-mix\(in srgb, var\(--wb-accent[^;]*;/);
  assert.ok(
    css.includes('.wf-grid-table tbody tr:hover .wf-grid-td--cell-selected'),
    '必须同时覆盖 hover 行选中态',
  );
  assert.ok(selectorIndex > css.indexOf('.wf-grid-td {'), '选中态规则必须在 .wf-grid-td 之后声明');
  assert.ok(
    selectorIndex > css.indexOf('.wf-grid-table tr:hover .wf-grid-td {'),
    '选中态规则必须在行 hover 规则之后声明',
  );
});

test('行选择 checkbox 与单元格选中互相独立', async () => {
  await mountGrid(baseDocument());
  const checkbox = query('.wf-grid-td--select input[type="checkbox"]');
  assert.ok(checkbox);
  await dispatch(checkbox, new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(useTableStore.getState().selectedRowIndices.join(','), '0', '点击行 checkbox 只改变行选择');
  assert.equal(query('.wf-grid-td--cell-selected'), null, '行选择不应选中单元格');

  await clickCell(1, 'c_text');
  assert.equal(useTableStore.getState().selectedRowIndices.join(','), '0', '点击单元格不改变行选择');
  assert.ok(query('td[data-grid-cell-key="1:c_text"]').classList.contains('wf-grid-td--cell-selected'));
});
