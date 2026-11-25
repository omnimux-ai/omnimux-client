import { createElement } from 'react'
import { NS, en, zh } from './locales.js'
import { mountSidebarEntry, PIBROWSE_TAB_ID } from './sidebar-entry.js'
import { PibrowseStage } from './PibrowseStage.jsx'

export const name = 'omnimux-pibrowse'
export const inject = ['slots', 'locale']

export { PIBROWSE_TAB_ID }

function renderPibrowseIcon(size = 16) {
  return createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: '1.8',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      xmlns: 'http://www.w3.org/2000/svg',
    },
    [
      createElement('path', { key: 'p1', d: 'M12 2a10 10 0 1 0 10 10' }),
      createElement('path', { key: 'p2', d: 'M12 6a6 6 0 1 0 6 6' }),
      createElement('path', { key: 'p3', d: 'M12 10a2 2 0 1 0 2 2' }),
      createElement('path', { key: 'p4', d: 'M17 3l4 4' }),
      createElement('path', { key: 'p5', d: 'M21 3l-4 4' }),
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
