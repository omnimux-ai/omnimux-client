import React from 'react'

/**
 * 16px 文件夹大纲图标 (Folder Outline)
 * @param {{ size?: number, className?: string }} props
 */
export function IconFolderOutline16({ size = 16, className, ...props } = {}) {
  return React.createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      className,
      ...props,
    },
    React.createElement('path', {
      d: 'M1.75 4.25A1.25 1.25 0 0 1 3 3h3.086c.332 0 .65.132.884.366l.76.768a1.25 1.25 0 0 0 .884.366H13A1.25 1.25 0 0 1 14.25 5.75v6.5A1.25 1.25 0 0 1 13 13.5H3A1.25 1.25 0 0 1 1.75 12.25v-8Z',
    })
  )
}

/**
 * 16px 网格大纲图标 (Grid / Card View Outline)
 * @param {{ size?: number, className?: string }} props
 */
export function IconGridOutline16({ size = 16, className, ...props } = {}) {
  return React.createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      className,
      ...props,
    },
    React.createElement('rect', { x: 2, y: 2, width: 4.75, height: 4.75, rx: 1 }),
    React.createElement('rect', { x: 9.25, y: 2, width: 4.75, height: 4.75, rx: 1 }),
    React.createElement('rect', { x: 9.25, y: 9.25, width: 4.75, height: 4.75, rx: 1 }),
    React.createElement('rect', { x: 2, y: 9.25, width: 4.75, height: 4.75, rx: 1 })
  )
}

/**
 * 16px 列表大纲图标 (List / Table View Outline)
 * @param {{ size?: number, className?: string }} props
 */
export function IconListOutline16({ size = 16, className, ...props } = {}) {
  return React.createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      className,
      ...props,
    },
    React.createElement('line', { x1: 5.75, y1: 4, x2: 14, y2: 4 }),
    React.createElement('line', { x1: 5.75, y1: 8, x2: 14, y2: 8 }),
    React.createElement('line', { x1: 5.75, y1: 12, x2: 14, y2: 12 }),
    React.createElement('line', { x1: 2, y1: 4, x2: 3.25, y2: 4 }),
    React.createElement('line', { x1: 2, y1: 8, x2: 3.25, y2: 8 }),
    React.createElement('line', { x1: 2, y1: 12, x2: 3.25, y2: 12 })
  )
}

/**
 * 16px 日历大纲图标 (Calendar View Outline)
 * @param {{ size?: number, className?: string }} props
 */
export function IconCalendarOutline16({ size = 16, className, ...props } = {}) {
  return React.createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      className,
      ...props,
    },
    React.createElement('rect', { x: 2, y: 3.5, width: 12, height: 10.5, rx: 1.5 }),
    React.createElement('line', { x1: 2, y1: 7, x2: 14, y2: 7 }),
    React.createElement('line', { x1: 5, y1: 2, x2: 5, y2: 4.5 }),
    React.createElement('line', { x1: 11, y1: 2, x2: 11, y2: 4.5 }),
    React.createElement('circle', { cx: 5.25, cy: 10, r: 0.6, fill: 'currentColor', stroke: 'none' }),
    React.createElement('circle', { cx: 8, cy: 10, r: 0.6, fill: 'currentColor', stroke: 'none' }),
    React.createElement('circle', { cx: 10.75, cy: 10, r: 0.6, fill: 'currentColor', stroke: 'none' })
  )
}
