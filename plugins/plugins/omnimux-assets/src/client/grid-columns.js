/**
 * 资产中心网格的列数推导。
 *
 * 收敛最小列宽 220px 与间距 16px，与本地/产品库/AI 生成的 `minmax(220px, 1fr)`
 * 横版托盘网格保持同密度：在常规桌面内容区（1024px–1280px）稳定呈现 4–5 列，
 * 上限 5 列、下限 2 列，防止宽屏过度压缩或窄屏塌成单列。
 *
 * 目标断点：容器 1280 / 1024 / 768 / 520 分别得到 5 / 4 / 3 / 2 列。
 *
 * 纯函数：不读 DOM、不读 window，宽度由调用方传入，因此边界可以逐条断言。
 */

/** 一行最多几列。 */
export const GRID_MAX_COLUMNS = 5

/** 一行最少几列：再窄也要保住两列，一列在宽屏上会把卡片拉成整屏宽。 */
export const GRID_MIN_COLUMNS = 2

/** 每列的最小宽度，与 `minmax(220px, 1fr)` 横版托盘网格密度对齐。 */
export const GRID_MIN_COLUMN_WIDTH = 220

/** 列间距，与样式表里的 `gap` 必须一致，否则列数算出来会和实际排版对不上。 */
export const GRID_GAP = 16

/**
 * 给定容器宽度，返回该宽度下一行放几列。
 *
 * 宽度不可用（未挂载、容器塌陷、传入 NaN）时返回下限而不是抛错：网格在首帧还没
 * 测量到宽度，抛错会把整个货架打空，两列至少是能看的。
 * @param {number} containerWidth 内容区宽度（CSS px）
 * @returns {number} `[GRID_MIN_COLUMNS, GRID_MAX_COLUMNS]` 之间的整数
 */
export function gridColumnsFor(containerWidth) {
  const width = Number(containerWidth)
  if (!Number.isFinite(width) || width <= 0) return GRID_MIN_COLUMNS
  const fit = Math.floor((width + GRID_GAP) / (GRID_MIN_COLUMN_WIDTH + GRID_GAP))
  return Math.max(GRID_MIN_COLUMNS, Math.min(GRID_MAX_COLUMNS, fit))
}
