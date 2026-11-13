import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatMetric, METRIC_KEYS, TABLE_COLUMNS } from './metrics-display.js'

describe('metrics-display: 8 维指标格式化与 14 列 Table 结构', () => {
  it('formatMetric 诚实空槽返回 -，有效数字返回字符串', () => {
    assert.equal(formatMetric(null), '-')
    assert.equal(formatMetric(undefined), '-')
    assert.equal(formatMetric(''), '-')
    assert.equal(formatMetric(Number.NaN), '-')
    assert.equal(formatMetric('123'), '-') // 非数字类型统一诚实空槽
    assert.equal(formatMetric(0), '0')
    assert.equal(formatMetric(1234), '1234')
  })

  it('METRIC_KEYS 严格包含 8 个标准全称键', () => {
    assert.deepEqual(METRIC_KEYS, [
      'likes',
      'comments',
      'shares',
      'saves',
      'clicks',
      'views',
      'impressions',
      'reach',
    ])
  })

  it('TABLE_COLUMNS 严格闭合为 14 列，指标列宽 56px', () => {
    assert.equal(TABLE_COLUMNS.length, 14)
    assert.equal(TABLE_COLUMNS[0].key, 'select')
    assert.equal(TABLE_COLUMNS[1].key, 'content')
    assert.equal(TABLE_COLUMNS[2].key, 'platforms')
    assert.equal(TABLE_COLUMNS[3].key, 'date')
    assert.equal(TABLE_COLUMNS[4].key, 'status')
    assert.equal(TABLE_COLUMNS[13].key, 'actions')

    // 8 维指标列宽均为 56px
    for (let i = 5; i <= 12; i++) {
      assert.equal(TABLE_COLUMNS[i].width, 56)
      assert.equal(typeof TABLE_COLUMNS[i].icon, 'function')
    }
  })
})
