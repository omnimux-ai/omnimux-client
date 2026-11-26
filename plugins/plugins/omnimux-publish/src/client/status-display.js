/**
 * status-display.js: 发布中心展示态投影与七态（含 `sent_to_inbox`）中文单真源。
 * 状态算法唯一真源为 ../shared/record-status.js（与 Host 同一份纯函数，
 * 浏览器安全、不修改输入），客户端仅保留中文标签与 statusText 文案。
 * 依据 record-status-contract.md 与 spec-ui-client-v2.4.md 规范定义。
 */

export { aggregateStatus, displayStatus } from '../shared/record-status.js'

/** @typedef {import('../shared/record-status.js').AggregateStatus} AggregateStatus */
/** @typedef {import('../shared/record-status.js').DisplayStatus} DisplayStatus */

/** 聚合与展示态中文单真源对照字典 @type {Record<string, string>} */
export const STATUS_LABEL = {
  draft: '草稿',
  publishing: '发布中',
  reviewing: '审核中',
  sent_to_inbox: '已送达草稿箱',
  published: '已发布',
  partial_failed: '部分失败',
  failed: '失败',
}

/**
 * 返回状态的本地化文本；传入 `t` 时优先读取 `agg.<status>` 词典，缺省回退中文单真源。
 * @param {string} status
 * @param {(key: string, vars?: Record<string, unknown>) => string} [t]
 * @returns {string}
 */
export function statusText(status, t) {
  const normalized = status || 'draft'
  if (typeof t === 'function') {
    const key = `agg.${normalized}`
    const translated = t(key)
    if (typeof translated === 'string' && translated !== '' && translated !== key) {
      return translated
    }
  }
  return STATUS_LABEL[status] || status || '草稿'
}
