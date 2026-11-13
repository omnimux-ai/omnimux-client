/**
 * metrics-display.js: 8 维数据指标与 14 列 Table 结构定义。
 * 依据 spec-ui-client-v2.4.md 规范定义。
 */
import {
  IconLikesSvg,
  IconCommentsSvg,
  IconSharesSvg,
  IconSavesSvg,
  IconClicksSvg,
  IconViewsSvg,
  IconImpressionsSvg,
  IconReachSvg,
} from './icons/metrics.js'

export const METRIC_KEYS = [
  'likes',
  'comments',
  'shares',
  'saves',
  'clicks',
  'views',
  'impressions',
  'reach',
]

/**
 * 格式化指标数据
 * 规则：在社媒分析真源接入前，一律诚实返回 '-'，禁止注入任何假数据。
 * 当传入有效有限数字时转为字符串（预留未来接入真源）。
 * @param {unknown} val
 * @returns {string}
 */
export function formatMetric(val) {
  if (val === null || val === undefined || val === '' || typeof val !== 'number' || !Number.isFinite(val)) {
    return '-'
  }
  return String(val)
}

/**
 * Table 14 列完整列定义
 */
export const TABLE_COLUMNS = [
  { key: 'select', label: '', width: 32, align: 'center' },
  { key: 'content', label: 'Content', minWidth: 240, align: 'left', sticky: true },
  { key: 'platforms', label: 'Platforms', minWidth: 100, align: 'left' },
  { key: 'date', label: 'Date', width: 140, align: 'left', sortable: true },
  { key: 'status', label: 'Status', width: 100, align: 'left', sortable: true },
  // 8 维数据指标列：key 保持标准全称，表头 label 使用标准短名并包含内联 SVG 图标，宽度锁定 56px
  { key: 'likes', label: 'Likes', icon: IconLikesSvg, width: 56, align: 'center' },
  { key: 'comments', label: 'Cmts', icon: IconCommentsSvg, width: 56, align: 'center' },
  { key: 'shares', label: 'Shrs', icon: IconSharesSvg, width: 56, align: 'center' },
  { key: 'saves', label: 'Saves', icon: IconSavesSvg, width: 56, align: 'center' },
  { key: 'clicks', label: 'Clicks', icon: IconClicksSvg, width: 56, align: 'center' },
  { key: 'views', label: 'Views', icon: IconViewsSvg, width: 56, align: 'center' },
  { key: 'impressions', label: 'Impr.', icon: IconImpressionsSvg, width: 56, align: 'center' },
  { key: 'reach', label: 'Reach', icon: IconReachSvg, width: 56, align: 'center' },
  // 行末操作菜单
  { key: 'actions', label: '', width: 40, align: 'center', stickyRight: true },
]
