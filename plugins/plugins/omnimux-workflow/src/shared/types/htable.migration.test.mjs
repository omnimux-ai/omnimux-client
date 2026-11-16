import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTableDocument,
  clampTableColumnWidth,
  defaultColumnWidth,
  migrateLegacyTableDocument,
} from './htable.ts';

test('migrateLegacyTableDocument：缺失 width 按类型回落默认宽度', () => {
  const doc = migrateLegacyTableDocument({
    version: 1,
    columns: [
      { id: 'c_text', title: '文本', type: 'text' },
      { id: 'c_num', title: '数字', type: 'number' },
      { id: 'c_att', title: '附件', type: 'attachment' },
    ],
    rows: [{ id: 'r1', cells: { c_text: 'x' } }],
  });
  assert.equal(doc.columns[0].width, defaultColumnWidth('text'));
  assert.equal(doc.columns[1].width, defaultColumnWidth('number'));
  assert.equal(doc.columns[2].width, defaultColumnWidth('attachment'));
});

test('migrateLegacyTableDocument：小于 80 的旧值夹到 80，非法值回落，超大值夹到 2000', () => {
  const doc = migrateLegacyTableDocument({
    version: 1,
    columns: [
      { id: 'c1', title: 'A', type: 'text', width: 40 },
      { id: 'c2', title: 'B', type: 'text', width: 'bad' },
      { id: 'c3', title: 'C', type: 'text', width: 9999 },
      { id: 'c4', title: 'D', type: 'text', width: Number.POSITIVE_INFINITY },
    ],
    rows: [],
  });
  assert.equal(doc.columns[0].width, 80);
  assert.equal(doc.columns[1].width, defaultColumnWidth('text'));
  assert.equal(doc.columns[2].width, 2000);
  assert.equal(doc.columns[3].width, defaultColumnWidth('text'));
});

test('buildTableDocument：写入列宽同样走 clamp，避免生成 80 以下或 2000 以上列宽', () => {
  const doc = buildTableDocument({
    columns: [
      { title: 'A', width: 40 },
      { title: 'B', width: 300 },
      { title: 'C', width: 3000 },
    ],
    rows: [],
  });
  assert.equal(doc.columns[0].width, 80);
  assert.equal(doc.columns[1].width, 300);
  assert.equal(doc.columns[2].width, 2000);
});

test('clampTableColumnWidth：非有限数回退默认，有限数四舍五入并夹到 80–2000', () => {
  assert.equal(clampTableColumnWidth(undefined, 'number'), 120);
  assert.equal(clampTableColumnWidth(79.4, 'text'), 80);
  assert.equal(clampTableColumnWidth(79.6, 'text'), 80);
  assert.equal(clampTableColumnWidth(80.4, 'text'), 80);
  assert.equal(clampTableColumnWidth(2000.4, 'text'), 2000);
});
