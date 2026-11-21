import { useLayoutEffect, useState } from 'react'

interface VisiblePane {
  element: HTMLElement
  left: number
  top: number
  rightInset: number
  width: number
  height: number
  clipped: boolean
}

const visibilityThresholds = Array.from({ length: 101 }, (_, step) => step / 100)

/** Return the usable part of an editor pane in local coordinates. */
export function useVisibleEditorPane(element: HTMLElement | null) {
  const [bounds, setBounds] = useState<VisiblePane | null>(null)
  useLayoutEffect(() => {
    if (!element) return
    const measure = () => {
      const pane = element.getBoundingClientRect()
      const viewport = element.ownerDocument.documentElement
      const left = Math.max(0, pane.left)
      const top = Math.max(0, pane.top)
      const right = Math.min(pane.right, viewport.clientWidth)
      const bottom = Math.min(pane.bottom, viewport.clientHeight)
      const width = Math.max(0, right - left)
      const height = Math.max(0, bottom - top)
      setBounds({
        element,
        left: left - pane.left,
        top: top - pane.top,
        rightInset: pane.right - right,
        width,
        height,
        clipped: width < pane.width || height < pane.height,
      })
    }
    const size = new ResizeObserver(measure)
    const visibility = new IntersectionObserver(measure, { threshold: visibilityThresholds })
    measure()
    size.observe(element)
    visibility.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      size.disconnect()
      visibility.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [element])
  return bounds?.element === element ? bounds : null
}
