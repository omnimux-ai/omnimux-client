import { createElement } from 'react'
import { NS, en, zh } from './locales.js'
import { EXPLORE_ITEM_ID, mountSidebarEntry, PIBROWSE_TAB_ID, registerMoreMenuEntry } from './sidebar-entry.js'
import { PibrowseStage } from './PibrowseStage.jsx'

export const name = 'omnimux-pibrowse'
export const inject = ['slots', 'locale']

export { EXPLORE_ITEM_ID, PIBROWSE_TAB_ID, registerMoreMenuEntry }

function renderPibrowseIcon(size = 16) {
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
      createElement('circle', { key: 'c1', cx: '8', cy: '8', r: '6' }),
      createElement('path', { key: 'p1', d: 'M5.2 8a2.8 2.8 0 0 1 5.6 0' }),
      createElement('path', { key: 'p2', d: 'M6.8 8a1.2 1.2 0 1 1 2.4 0c0 1.4-.4 2.6-1.2 3.6' }),
      createElement('path', { key: 'p3', d: 'M4.2 10.6c.4-1 .6-1.8.6-2.6' }),
    ],
  )
}

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'omnimux-pibrowse: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.effect(() => mountSidebarEntry(null, t, ctx.locale), 'omnimux-pibrowse: sidebar entry')

  const registerPibrowseTab = (sidebar) => {
    if (!sidebar || typeof sidebar.registerTab !== 'function') return () => {}
    return sidebar.registerTab({
      id: PIBROWSE_TAB_ID,
      title: () => {
        const value = t('nav')
        return value && value !== 'nav' ? value : '指纹浏览器'
      },
      icon: renderPibrowseIcon,
      order: 20,
      hidden: false,
      single: true,
      component: (props) => createElement(PibrowseStage, { ...props, t }),
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
        ctx.effect(() => registerPibrowseTab(sidebar), 'omnimux-pibrowse: workbench tab')
      } else {
        registerPibrowseTab(sidebar)
      }
    })
    ctx.inject(['layout', 'sessions'], (inner) => {
      bindWorkbench({ layout: inner.layout, sessions: inner.sessions })
    })
  }
}
