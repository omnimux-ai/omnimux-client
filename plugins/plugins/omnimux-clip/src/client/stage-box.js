/**
 * Standalone clip stage geometry.
 *
 * Host product-stage chrome zeroes `--dsh-sidebar-width`, so `readBox()` can
 * report left≈0 even while the primary DSH sidebar is still painted on top.
 * Measure the real sidebar column and keep the editor to its right.
 */

export const MIN_SIDEBAR_INSET = 56

/**
 * @param {Document | null | undefined} doc
 * @returns {number}
 */
export function readHostSidebarInset(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || typeof doc.querySelector !== 'function') return MIN_SIDEBAR_INSET
  const column = doc.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (!column || typeof column.getBoundingClientRect !== 'function') return MIN_SIDEBAR_INSET
  const rect = column.getBoundingClientRect()
  if (!(rect.width >= 8) || rect.left > 80) return MIN_SIDEBAR_INSET
  return Math.max(MIN_SIDEBAR_INSET, Math.round(rect.right))
}

/**
 * @param {{ top?: number, left?: number, width?: number, height?: number } | null | undefined} read
 * @param {{ width?: number, height?: number }} [windowSize]
 * @param {number} [sidebarInset]
 * @returns {{ top: number, left: number, width: number, height: number }}
 */
export function computeStandaloneBox(read, windowSize = {}, sidebarInset = MIN_SIDEBAR_INSET) {
  const winW = typeof windowSize.width === 'number' ? windowSize.width : 1024
  const winH = typeof windowSize.height === 'number' ? windowSize.height : 768
  const minLeft = Math.max(MIN_SIDEBAR_INSET, sidebarInset || MIN_SIDEBAR_INSET)
  const top = read && typeof read.top === 'number' ? Math.max(0, read.top) : 0
  const measuredLeft = read && typeof read.left === 'number' ? read.left : 0
  const left = Math.max(minLeft, measuredLeft)
  return {
    top,
    left,
    width: Math.max(320, winW - left),
    height: Math.max(240, winH - top),
  }
}

/**
 * @param {{ isCanvasMode?: boolean, boxLeft?: number, isMac?: boolean }} opts
 * @returns {number}
 */
export function computeHeaderPadLeft({ isCanvasMode = false, boxLeft = 0, isMac = false } = {}) {
  if (isCanvasMode) return 20
  if (isMac && boxLeft < 50) return 80
  return 20
}
