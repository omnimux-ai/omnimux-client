/**
 * Locate the visible workflow canvas tab host so the clip editor can
 * mount inside it (absolute inset:0) instead of guessing overlay coords.
 *
 * @param {{ querySelectorAll?: Function }} [root]
 * @returns {HTMLElement | null}
 */
export function findCanvasHost(root = typeof document !== 'undefined' ? document : null) {
  if (!root || typeof root.querySelectorAll !== 'function') return null
  const nodes = root.querySelectorAll('[data-omnimux-canvas-tab], .omnimux-workflow-canvas-tab')
  for (const el of nodes) {
    if (isVisibleCanvasHost(el)) return el
  }
  return null
}

/**
 * @param {unknown} el
 * @returns {el is HTMLElement}
 */
export function isVisibleCanvasHost(el) {
  if (!el || typeof el !== 'object') return false
  if (typeof el.getAttribute === 'function' && el.getAttribute('data-visible') === 'false') return false
  try {
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      const style = window.getComputedStyle(el)
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false
    }
  } catch {
    // ignore computed-style failures in tests
  }
  if (typeof el.getBoundingClientRect === 'function') {
    const rect = el.getBoundingClientRect()
    if (rect && (rect.width < 50 || rect.height < 50)) return false
  }
  return true
}
