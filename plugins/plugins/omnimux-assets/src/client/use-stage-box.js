import { useLayoutEffect, useState } from 'react'

const DEFAULT_BOX = { top: 0, left: 0, width: 0, height: 0 }

function getInitialBox(stage) {
  if (stage && typeof stage.readBox === 'function') {
    return stage.readBox()
  }
  return DEFAULT_BOX
}

function findScrollTarget() {
  const scroll = document.querySelector('[data-conversation-scroll]')
  if (scroll instanceof HTMLElement) return scroll
  const conv = document.querySelector('[data-slot="conversation"]')
  return conv ? conv.parentElement : null
}

/**
 * Hook to calculate and observe the bounding box for stage overlay.
 * @param {boolean} open
 * @param {{ readBox?: () => { top: number, left: number, width: number, height: number } } | null} stage
 */
export function useStageBox(open, stage) {
  const [box, setBox] = useState(() => getInitialBox(stage))

  useLayoutEffect(() => {
    if (!open || !stage || typeof stage.readBox !== 'function') return undefined
    const update = () => { setBox(stage.readBox()) }
    update()
    const target = findScrollTarget()
    const observer = typeof ResizeObserver === 'function' && target ? new ResizeObserver(update) : null
    if (target && observer) observer.observe(target)
    window.addEventListener('resize', update)
    return () => {
      if (observer) observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [open, stage])

  return box
}
