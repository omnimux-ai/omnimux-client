import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_FIT_MAX_COLUMN_WIDTH,
  columnWidthForDisplay,
  computeAutoFitWidth,
  computeEditorHeightMetrics,
  computeGridScale,
  computeResizeWidth,
  MAX_TABLE_COLUMN_WIDTH,
  MIN_TABLE_COLUMN_WIDTH,
} from './tableGridMetrics.ts';

test('computeResizeWidth：100% / 200% / 400% 下 +100 视觉位移分别换算 +100/+50/+25', () => {
  const base = { startWidth: 200, startClientX: 100, clientX: 200 };
  assert.equal(computeResizeWidth({ ...base, scale: 1 }), 300);
  assert.equal(computeResizeWidth({ ...base, scale: 2 }), 250);
  assert.equal(computeResizeWidth({ ...base, scale: 4 }), 225);
});

test('computeResizeWidth：最小 80 / 最大 2000，非法 scale 回退 1', () => {
  assert.equal(
    computeResizeWidth({ startWidth: 100, startClientX: 0, clientX: -500, scale: 1 }),
    MIN_TABLE_COLUMN_WIDTH,
  );
  assert.equal(
    computeResizeWidth({ startWidth: 1990, startClientX: 0, clientX: 100, scale: 1 }),
    MAX_TABLE_COLUMN_WIDTH,
  );
  assert.equal(
    computeResizeWidth({ startWidth: 200, startClientX: 100, clientX: 300, scale: 0 }),
    400,
  );
  assert.equal(
    computeResizeWidth({ startWidth: 200, startClientX: 100, clientX: 300, scale: Number.NaN }),
    400,
  );
});

test('computeGridScale：用实际渲染矩形 / offsetWidth 计算，非法值回退 1', () => {
  assert.equal(computeGridScale(400, 100), 4);
  assert.equal(computeGridScale(200, 100), 2);
  assert.equal(computeGridScale(100, 100), 1);
  assert.equal(computeGridScale(0, 0), 1);
  assert.equal(computeGridScale(Number.NaN, 100), 1);
  assert.equal(computeGridScale(100, 0), 1);
});

test('computeAutoFitWidth：按最长文本 + 内边距，夹到 80–480；无法测量回退默认宽度', () => {
  assert.equal(computeAutoFitWidth([120, 300, 80], 240), 324);
  assert.equal(computeAutoFitWidth([10], 240), 80);
  assert.equal(computeAutoFitWidth([10000], 240), AUTO_FIT_MAX_COLUMN_WIDTH);
  assert.equal(computeAutoFitWidth([], 240), 240);
  assert.equal(computeAutoFitWidth([Number.NaN, -1], 120), 120);
});

test('computeEditorHeightMetrics：1 行 / 3–4 行 / 8+ 行三态与封顶滚动', () => {
  const base = { lineHeight: 20, paddingTop: 5, paddingBottom: 5 };
  // contentHeight 传 textarea.scrollHeight（含 padding）
  const oneLine = computeEditorHeightMetrics({ ...base, contentHeight: 30 });
  assert.equal(oneLine.height, 30);
  assert.equal(oneLine.overflowY, 'hidden');
  assert.equal(oneLine.lineCount, 1);
  assert.equal(oneLine.capped, false);

  const fourLines = computeEditorHeightMetrics({ ...base, contentHeight: 90 });
  assert.equal(fourLines.height, 90);
  assert.equal(fourLines.overflowY, 'hidden');
  assert.equal(fourLines.lineCount, 4);
  assert.equal(fourLines.capped, false);

  const tenLines = computeEditorHeightMetrics({ ...base, contentHeight: 210 });
  assert.equal(tenLines.height, 20 * 8 + 10);
  assert.equal(tenLines.overflowY, 'auto');
  assert.equal(tenLines.lineCount, 10);
  assert.equal(tenLines.capped, true);

  const exactlyEight = computeEditorHeightMetrics({ ...base, contentHeight: 170 });
  assert.equal(exactlyEight.height, 20 * 8 + 10);
  assert.equal(exactlyEight.overflowY, 'hidden');
  assert.equal(exactlyEight.capped, false);
});

test('columnWidthForDisplay：旧数据缺失/非法回落默认，过小夹到 80，过大夹到 2000', () => {
  assert.equal(columnWidthForDisplay(undefined, 'text'), 240);
  assert.equal(columnWidthForDisplay(undefined, 'number'), 120);
  assert.equal(columnWidthForDisplay(undefined, 'attachment'), 200);
  assert.equal(columnWidthForDisplay(40, 'text'), 80);
  assert.equal(columnWidthForDisplay(99.6, 'number'), 100);
  assert.equal(columnWidthForDisplay(5000, 'attachment'), 2000);
  assert.equal(columnWidthForDisplay('bad', 'text'), 240);
});
