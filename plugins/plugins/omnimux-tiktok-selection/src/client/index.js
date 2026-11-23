import { createElement } from 'react'
import { NS, en, zh } from './locales.js'
import { mountSidebarEntry, SELECTION_TAB_ID } from './sidebar-entry.js'
import { TiktokSelectionStage } from './TiktokSelectionStage.jsx'

export const name = 'omnimux-tiktok-selection'
export const inject = ['slots', 'locale']

export { SELECTION_TAB_ID }

function renderSelectionIcon(size = 16) {
  return createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: '1.9',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      xmlns: 'http://www.w3.org/2000/svg',
    },
    [
      createElement('path', { key: 'p1', d: 'M4 19h16' }),
      createElement('path', { key: 'p2', d: 'M7 15l3.5-4.5 3 2.5L18 7' }),
      createElement('path', { key: 'p3', d: 'M14.5 7H18v3.5' }),
    ]
  )
}

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'omnimux-tiktok-selection: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.effect(() => mountSidebarEntry(null, t, ctx.locale), 'omnimux-tiktok-selection: sidebar entry')

  const registerSelectionTab = (sidebar) => {
    if (!sidebar || typeof sidebar.registerTab !== 'function') return () => {}
    return sidebar.registerTab({
      id: SELECTION_TAB_ID,
      title: () => {
        const value = t('nav')
        return value && value !== 'nav' ? value : '跟爆选品'
      },
      icon: renderSelectionIcon,
      order: 19,
      hidden: false,
      single: true,
      component: (props) => createElement(TiktokSelectionStage, { ...props, t }),
    })
  }

  const bindWorkbench = (patch) => {
    if (typeof window !== 'undefined' && typeof window.__omnimuxWorkbench?.bind === 'function') {
      window.__omnimuxWorkbench.bind(patch)
    }
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['betterSidebar'], (inner) => {
      const sidebar = inner.betterSidebar ?? inner.get?.('betterSidebar')
      bindWorkbench({ betterSidebar: sidebar })
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => registerSelectionTab(sidebar), 'omnimux-tiktok-selection: workbench tab')
      } else {
        registerSelectionTab(sidebar)
      }
    })
    ctx.inject(['layout', 'sessions'], (inner) => {
      bindWorkbench({ layout: inner.layout, sessions: inner.sessions })
    })
  }
}
