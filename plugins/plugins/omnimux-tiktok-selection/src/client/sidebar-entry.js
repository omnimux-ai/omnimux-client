import { createWorkbenchSidebarEntry } from 'dsh-ui-kit'

export const ENTRY_SELECTOR = '[data-omnimux-tiktok-selection-entry]'
export const SELECTION_TAB_ID = 'omnimux-tiktok-selection:workbench'

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" role="presentation" aria-hidden="true"><path d="M4 19h16"/><path d="M7 15l3.5-4.5 3 2.5L18 7"/><path d="M14.5 7H18v3.5"/></svg>'

function resolveWorkbenchTitle(t) {
  if (typeof t === 'function') {
    const val = t('nav')
    if (val && val !== 'nav') return val
  }
  return '跟爆选品'
}

export function mountSidebarEntry(_stage, t, locale) {
  return createWorkbenchSidebarEntry({
    id: 'omnimux-tiktok-selection',
    rank: 6,
    tabId: SELECTION_TAB_ID,
    label: () => resolveWorkbenchTitle(t),
    iconSvg: ICON,
    locale,
    access: 'local',
    customClassName: 'omnimux-tiktok-selection-entry',
    datasetKey: 'data-omnimux-tiktok-selection-entry',
  })
}
