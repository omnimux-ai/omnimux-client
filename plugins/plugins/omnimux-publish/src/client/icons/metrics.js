/**
 * 8 维指标 14px 标准内联 SVG 图标集合
 * 依据 spec-ui-client-v2.4.md 与 architecture-ui-table-v2.4.md 规范定义。
 * 采用 React.createElement 编写，确保 Node.js ESM 单元测试与 esbuild 浏览器构建双向兼容。
 */
import React from 'react'

export function IconLikesSvg(props) {
  return React.createElement(
    'svg',
    { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', ...props },
    React.createElement('path', { d: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z' })
  )
}

export function IconCommentsSvg(props) {
  return React.createElement(
    'svg',
    { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', ...props },
    React.createElement('path', { d: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z' })
  )
}

export function IconSharesSvg(props) {
  return React.createElement(
    'svg',
    { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', ...props },
    React.createElement('circle', { cx: 18, cy: 5, r: 3 }),
    React.createElement('circle', { cx: 6, cy: 12, r: 3 }),
    React.createElement('circle', { cx: 18, cy: 19, r: 3 }),
    React.createElement('line', { x1: 8.59, y1: 13.51, x2: 15.42, y2: 17.49 }),
    React.createElement('line', { x1: 15.41, y1: 6.51, x2: 8.59, y2: 10.49 })
  )
}

export function IconSavesSvg(props) {
  return React.createElement(
    'svg',
    { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', ...props },
    React.createElement('path', { d: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' })
  )
}

export function IconClicksSvg(props) {
  return React.createElement(
    'svg',
    { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', ...props },
    React.createElement('path', { d: 'm3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z' }),
    React.createElement('path', { d: 'm13 13 6 6' })
  )
}

export function IconViewsSvg(props) {
  return React.createElement(
    'svg',
    { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', ...props },
    React.createElement('path', { d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' }),
    React.createElement('circle', { cx: 12, cy: 12, r: 3 })
  )
}

export function IconImpressionsSvg(props) {
  return React.createElement(
    'svg',
    { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', ...props },
    React.createElement('polyline', { points: '22 12 18 12 15 21 9 3 6 12 2 12' })
  )
}

export function IconReachSvg(props) {
  return React.createElement(
    'svg',
    { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', ...props },
    React.createElement('path', { d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' }),
    React.createElement('circle', { cx: 9, cy: 7, r: 4 }),
    React.createElement('path', { d: 'M23 21v-2a4 4 0 0 0-3-3.87' }),
    React.createElement('path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' })
  )
}
