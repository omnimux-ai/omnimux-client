import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GRID_GAP,
  GRID_MAX_COLUMNS,
  GRID_MIN_COLUMNS,
  GRID_MIN_COLUMN_WIDTH,
  gridColumnsFor,
} from './grid-columns.js'

test('gridColumnsFor: 16:10 托盘密度断点逐个成立（常规桌面 4–5 列）', () => {
  assert.equal(gridColumnsFor(1560), 5)
  assert.equal(gridColumnsFor(1280), 5)
  assert.equal(gridColumnsFor(1024), 4)
  assert.equal(gridColumnsFor(768), 3)
  assert.equal(gridColumnsFor(520), 2)
})

test('gridColumnsFor: 任意宽度都落在 [2, 5] 内 (AC-2)', () => {
  for (let width = 1; width <= 4000; width += 7) {
    const columns = gridColumnsFor(width)
    assert.ok(Number.isInteger(columns), `${width} -> ${columns} 不是整数`)
    assert.ok(
      columns >= GRID_MIN_COLUMNS && columns <= GRID_MAX_COLUMNS,
      `${width} -> ${columns} 越界`,
    )
  }
})

test('gridColumnsFor: 不可用宽度回落到下限而不是抛错', () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined, null, '']) {
    assert.equal(gridColumnsFor(bad), GRID_MIN_COLUMNS, `${String(bad)} 未回落`)
  }
})

test('gridColumnsFor: 极窄容器仍是两列，不会塌成一列', () => {
  assert.equal(gridColumnsFor(320), 2)
  assert.equal(gridColumnsFor(GRID_MIN_COLUMN_WIDTH), 2)
})

test('gridColumnsFor: 超过断点后继续变宽只增加列数直到封顶', () => {
  assert.equal(gridColumnsFor(1900), 5)
  assert.equal(gridColumnsFor(3000), 5)
  assert.equal(gridColumnsFor(540), 2)
  assert.equal(gridColumnsFor(544), 2)
})

test('gridColumnsFor: 列宽与间距的常量契约', () => {
  assert.equal(GRID_MIN_COLUMN_WIDTH, 220)
  assert.equal(GRID_GAP, 16)
  assert.equal(GRID_MAX_COLUMNS, 5)
})
