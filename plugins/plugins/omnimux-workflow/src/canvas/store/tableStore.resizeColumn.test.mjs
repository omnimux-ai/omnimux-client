import test from 'node:test';
import assert from 'node:assert/strict';
import { useTableStore, registerTableCanvasSyncHandler } from './tableStore.ts';
import { tableDocumentCache } from './tableDocumentCache.ts';

function resetStoreWithDoc(columns = [{ id: 'c1', title: '文本', type: 'text', visible: true, width: 240 }]) {
  useTableStore.setState({
    activeTableId: null,
    document: {
      version: 1,
      title: '测试表格',
      rowHeight: 'low',
      columns,
      rows: [{ id: 'r1', cells: { c1: 'hello' } }],
    },
    selectedRowIndices: [],
    undoStack: [],
    redoStack: [],
  });
}

test('resizeColumn：写入 width、只产生一次 undo 快照，并同步 tableDocumentCache', () => {
  tableDocumentCache.resetAll();
  const initialDoc = {
    version: 1,
    title: '测试表格',
    rowHeight: 'low',
    columns: [{ id: 'c1', title: '文本', type: 'text', visible: true, width: 240 }],
    rows: [{ id: 'r1', cells: { c1: 'hello' } }],
  };
  tableDocumentCache.mutate('tbl_resize', () => JSON.parse(JSON.stringify(initialDoc)), { trackHistory: false });
  useTableStore.getState().openStage('tbl_resize', initialDoc);

  const syncCalls = [];
  const unregister = registerTableCanvasSyncHandler((tableId, doc) => {
    syncCalls.push({ tableId, width: doc.columns[0]?.width });
  });

  try {
    useTableStore.getState().resizeColumn('c1', 320);
    const doc = useTableStore.getState().document;
    assert.equal(doc.columns[0].width, 320);
    assert.equal(useTableStore.getState().undoStack.length, 1, '一次写入只应产生一次 undo 快照');
    assert.equal(syncCalls.at(-1)?.tableId, 'tbl_resize');
    assert.equal(syncCalls.at(-1)?.width, 320);
    assert.equal(tableDocumentCache.getSession('tbl_resize')?.document.columns[0]?.width, 320);
    assert.equal(tableDocumentCache.getSession('tbl_resize')?.dirty, true);

    useTableStore.getState().undo();
    assert.equal(useTableStore.getState().document.columns[0].width, 240, 'undo 应恢复列宽');
  } finally {
    unregister();
  }
});

test('resizeColumn：clamp 80–2000，非有限数/未知列/未变化不写', () => {
  tableDocumentCache.resetAll();
  resetStoreWithDoc();
  useTableStore.setState({ activeTableId: null });

  useTableStore.getState().resizeColumn('c1', 10);
  assert.equal(useTableStore.getState().document.columns[0].width, 80);
  const undoAfterMin = useTableStore.getState().undoStack.length;

  useTableStore.getState().resizeColumn('c1', 5000);
  assert.equal(useTableStore.getState().document.columns[0].width, 2000);
  const undoAfterMax = useTableStore.getState().undoStack.length;
  assert.equal(undoAfterMax, undoAfterMin + 1);

  useTableStore.getState().resizeColumn('c1', Number.NaN);
  assert.equal(useTableStore.getState().document.columns[0].width, 2000);
  assert.equal(useTableStore.getState().undoStack.length, undoAfterMax, 'NaN 不应产生写入');

  useTableStore.getState().resizeColumn('missing_col', 300);
  assert.equal(useTableStore.getState().undoStack.length, undoAfterMax, '未知列不应产生写入');

  useTableStore.getState().resizeColumn('c1', 2000);
  assert.equal(useTableStore.getState().undoStack.length, undoAfterMax, '宽度未变化不应产生写入');
});

test('resizeColumn：非有限数/缺失列不产生 undo，且保留其他列字段', () => {
  tableDocumentCache.resetAll();
  resetStoreWithDoc([
    { id: 'c1', title: '文本', type: 'text', visible: true, width: 240 },
    { id: 'c2', title: '数字', type: 'number', visible: false, width: 120 },
  ]);
  useTableStore.setState({ activeTableId: null });

  useTableStore.getState().resizeColumn('c2', 160.4);
  const doc = useTableStore.getState().document;
  assert.equal(doc.columns[1].width, 160);
  assert.equal(doc.columns[1].title, '数字');
  assert.equal(doc.columns[1].visible, false);
  assert.equal(doc.columns[1].type, 'number');
});
