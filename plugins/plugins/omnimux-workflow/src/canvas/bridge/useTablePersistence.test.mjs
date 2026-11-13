import test from 'node:test';
import assert from 'node:assert/strict';
import { tableDocumentCache } from '../store/tableDocumentCache.ts';

test('useTablePersistence: tableDocumentCache capture and markSaved lifecycle', () => {
  tableDocumentCache.resetAll();

  const tableId = 'tbl_persist_test';
  // Ensure session
  tableDocumentCache.ensure('', tableId, { initialDoc: { title: '测试落盘' } });

  // Mutate -> becomes dirty
  tableDocumentCache.mutate(tableId, (doc) => ({
    ...doc,
    rows: [{ id: 'r1', cells: { col_text: 'Row 1' } }],
  }));

  const captures = tableDocumentCache.captureDirty();
  assert.equal(captures.length, 1);
  assert.equal(captures[0].tableId, tableId);
  assert.equal(captures[0].expectedRev, 0);

  // Mark saved
  tableDocumentCache.markSaved(tableId, 1, captures[0].document);
  assert.equal(tableDocumentCache.captureDirty().length, 0);
  assert.equal(tableDocumentCache.getSession(tableId).contentRev, 1);

  tableDocumentCache.resetAll();
});
