import { createElement } from 'react'
import { NS, en, zh } from './locales.js'
import { EXPLORE_ITEM_ID, mountSidebarEntry, registerMoreMenuEntry, SELECTION_TAB_ID } from './sidebar-entry.js'
import { TiktokSelectionStage } from './TiktokSelectionStage.jsx'

export const name = 'omnimux-tiktok-selection'
export const inject = ['slots', 'locale']

export { EXPLORE_ITEM_ID, registerMoreMenuEntry, SELECTION_TAB_ID }

function renderSelectionIcon(size = 16) {
  return createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: '1.3',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      xmlns: 'http://www.w3.org/2000/svg',
    },
    [
      createElement('path', { key: 'p1', d: 'M3 5.5h10l-.8 8a1.5 1.5 0 0 1-1.5 1.3H5.3a1.5 1.5 0 0 1-1.5-1.3L3 5.5Z' }),
      createElement('path', { key: 'p2', d: 'M5.5 5.5V4.2a2.5 2.5 0 0 1 5 0v1.3' }),
      createElement('path', { key: 'p3', d: 'M6 10.8 7.6 9.2l1.2 1.2L10.6 8.2' }),
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
