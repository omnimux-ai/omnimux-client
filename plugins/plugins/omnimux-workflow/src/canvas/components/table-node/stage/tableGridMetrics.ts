/**
 * tableGridMetrics — 表格舞台的纯计算函数集合。
 *
 * 放在组件外便于单测覆盖：
 * - 画布/浏览器缩放下的列宽拖拽换算
 * - 列宽 clamp / auto-fit
 * - 单元格编辑浮层高度（1 行 / 3–4 行 / 8+ 行三态）
 */
import {
  clampTableColumnWidth,
  MAX_TABLE_COLUMN_WIDTH,
  MIN_TABLE_COLUMN_WIDTH,
  type HTableFieldType,
} from '../../../../shared/types/htable.ts';

export const AUTO_FIT_MAX_COLUMN_WIDTH = 480;

export interface ResizeWidthInput {
  startWidth: number;
  startClientX: number;
  clientX: number;
  scale: number;
}

/**
 * 将指针的视觉位移换算为表格本地逻辑列宽。
 * 例：视觉拖动 100px，在 2x 下逻辑增量 50px，在 4x 下 25px。
 */
export function computeResizeWidth({
  startWidth,
  startClientX,
  clientX,
  scale,
}: ResizeWidthInput): number {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const safeStartWidth =
    Number.isFinite(startWidth) && startWidth > 0 ? startWidth : MIN_TABLE_COLUMN_WIDTH;
  const visualDelta =
    Number.isFinite(startClientX) && Number.isFinite(clientX) ? clientX - startClientX : 0;
  return clampTableColumnWidth(safeStartWidth + visualDelta / safeScale, 'text');
}

/**
 * 网格实际渲染比例 = 视觉宽度 / 布局宽度。
 * 同时覆盖 ReactFlow transform: scale、CSS zoom 与未来卡片内嵌场景。
 */
export function computeGridScale(rectWidth: number, offsetWidth: number): number {
  if (
    !Number.isFinite(rectWidth) ||
    !Number.isFinite(offsetWidth) ||
    rectWidth <= 0 ||
    offsetWidth <= 0
  ) {
    return 1;
  }
  return rectWidth / offsetWidth;
}

/**
 * 双击列边界 auto-fit：按最长可见文本宽度 + 单元格水平内边距，夹到 80–480px。
 * 无法测量（空数组/非法值）时回退该列类型的默认宽度。
 */
export function computeAutoFitWidth(measuredTextWidths: number[], fallbackWidth: number): number {
  const finiteWidths = measuredTextWidths.filter(
    (width) => Number.isFinite(width) && width >= 0,
  );
  if (finiteWidths.length === 0) {
    const safeFallback = Number.isFinite(fallbackWidth) ? fallbackWidth : 240;
    return Math.min(
      AUTO_FIT_MAX_COLUMN_WIDTH,
      Math.max(MIN_TABLE_COLUMN_WIDTH, Math.round(safeFallback)),
    );
  }
  let maxTextWidth = 0;
  for (const width of finiteWidths) {
    if (width > maxTextWidth) maxTextWidth = width;
  }
  const contentWidth = Math.ceil(maxTextWidth + 24);
  return Math.min(
    AUTO_FIT_MAX_COLUMN_WIDTH,
    Math.max(MIN_TABLE_COLUMN_WIDTH, contentWidth),
  );
}

export interface EditorHeightInput {
  contentHeight: number;
  lineHeight: number;
  paddingTop: number;
  paddingBottom: number;
  maxLines?: number;
}

export interface EditorHeightMetrics {
  height: number;
  overflowY: 'auto' | 'hidden';
  lineCount: number;
  capped: boolean;
}

/**
 * 编辑浮层高度：1 行只占 1 行高 + 内边距；最多 maxLines（默认 8）行；
 * 超过后封顶并让 textarea 内部滚动。
 */
export function computeEditorHeightMetrics({
  contentHeight,
  lineHeight,
  paddingTop,
  paddingBottom,
  maxLines = 8,
}: EditorHeightInput): EditorHeightMetrics {
  const safeLineHeight = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 20;
  const safePaddingTop = Number.isFinite(paddingTop) && paddingTop >= 0 ? paddingTop : 0;
  const safePaddingBottom =
    Number.isFinite(paddingBottom) && paddingBottom >= 0 ? paddingBottom : 0;
  const safeMaxLines = Number.isFinite(maxLines) && maxLines > 0 ? Math.floor(maxLines) : 8;
  const padding = safePaddingTop + safePaddingBottom;
  const minHeight = safeLineHeight + padding;
  const maxHeight = safeLineHeight * safeMaxLines + padding;
  const measuredHeight = Number.isFinite(contentHeight)
    ? Math.max(contentHeight, minHeight)
    : minHeight;
  const height = Math.min(measuredHeight, maxHeight);
  const lineCount = Math.max(
    1,
    Math.round((Math.max(measuredHeight, minHeight) - padding) / safeLineHeight),
  );
  return {
    height: Math.round(height),
    overflowY: measuredHeight > maxHeight + 1 ? 'auto' : 'hidden',
    lineCount,
    capped: measuredHeight > maxHeight + 1,
  };
}

/** 渲染列宽：缺失/非法/过小回落到默认或夹到 80，最大 2000。 */
export function columnWidthForDisplay(width: unknown, type: HTableFieldType): number {
  return clampTableColumnWidth(width, type);
}

export { MAX_TABLE_COLUMN_WIDTH, MIN_TABLE_COLUMN_WIDTH };
