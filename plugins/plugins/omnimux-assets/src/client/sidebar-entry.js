/**
 * 资产库 row under 新会话, placed by the single sidebar coordinator.
 * Consumes standardized createWorkbenchSidebarEntry from dsh-ui-kit with idempotent activation.
 */
import { createWorkbenchSidebarEntry } from 'dsh-ui-kit'

export const ENTRY_SELECTOR = '[data-omnimux-assets-entry]'
export const ASSETS_TAB_ID = 'omnimux-assets:library'

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" width="14" height="14" fill="none" role="presentation" aria-hidden="true" preserveAspectRatio="xMidYMid meet"><g><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="m7.249 11.552-1.691.323A2.335 2.335 0 0 0 6 16.5h10a2.333 2.333 0 0 0 .443-4.625l-1.691-.323.216-1.708a4 4 0 1 0-7.936 0l.217 1.708ZM5.167 9.333a5.833 5.833 0 1 1 11.62.741 4.168 4.168 0 0 1-.787 8.26H6a4.167 4.167 0 0 1-.787-8.26 5.89 5.89 0 0 1-.046-.74Z"/></g></svg>'

function resolveWorkbenchTitle(t) {
  const val = typeof t === 'function' ? t('nav') : undefined
  return val && val !== 'nav' ? val : '资产库'
}

export function mountSidebarEntry(_stage, t, locale) {
  return createWorkbenchSidebarEntry({
    id: 'omnimux-assets',
    rank: 6,
    tabId: ASSETS_TAB_ID,
    label: () => t('nav'),
    title: () => resolveWorkbenchTitle(t),
    iconSvg: ICON,
    locale,
    access: 'offline',
    customClassName: 'omnimux-assets-entry',
    datasetKey: 'data-omnimux-assets-entry',
  })
}
