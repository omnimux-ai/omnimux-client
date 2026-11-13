/**
 * Stage preview renderer — OpenReel engine integration.
 * Delegates frame rendering, video decoding, typography, and transitions to OpenReel engine.
 * 本文件是插件自有适配层（非 vendor 真源）：在委托前做 x.ai 主题 Token 归一，
 * 使 TEXT_PRESETS 的 var(--dsw-*, fallback) 链在 Canvas 与成片导出两端都落为具体色。
 */

import {
  renderCompositionFrame,
  getActiveClipsAt,
  disposeMediaPool,
} from './openreel/index.js'
import { normalizeSchemaTextColors } from '../theme/colors.js'

const mediaCache = new Map()

export function aspectCss(aspectRatio) {
  if (aspectRatio === '9:16') return '9 / 16'
  if (aspectRatio === '1:1') return '1 / 1'
  return '16 / 9'
}

export function clipsAt(schema, timeMs, type) {
  return getActiveClipsAt(schema, timeMs, type)
}

/**
 * Draw a single complete composition frame via OpenReel Engine.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} schema
 * @param {number} timeMs
 * @param {{ width?: number, height?: number }} [options]
 */
export async function drawFrame(ctx, schema, timeMs, { width, height } = {}) {
  // Token 适配：OpenReel 引擎直用颜色字符串（Canvas 无法解析 var()），
  // 由自有适配层把 var 链解为具体色后交给引擎；纯字面量原样透传零拷贝。
  return renderCompositionFrame(ctx, normalizeSchemaTextColors(schema), timeMs, { width, height })
}

export function captureThumbnail(canvas) {
  try {
    return canvas.toDataURL('image/jpeg', 0.82)
  } catch {
    return ''
  }
}

export function disposePreviewResources() {
  disposeMediaPool()
}
