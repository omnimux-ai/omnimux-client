/**
 * 工作流 row under 新会话, placed by the single sidebar coordinator.
 * Consumes standardized createWorkbenchSidebarEntry from dsh-ui-kit with idempotent activation.
 */
import { createWorkbenchSidebarEntry } from 'dsh-ui-kit'

export const ENTRY_SELECTOR = '[data-omnimux-workflow-entry]'
export const WORKFLOW_LIBRARY_TAB_ID = 'omnimux-workflow:library'

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="14" height="14" fill="none" aria-hidden="true" preserveAspectRatio="xMidYMid meet"><path fill="currentColor" d="M2 5.5a1.5 1.5 0 0 1 3 0V6h10v-.5a1.5 1.5 0 0 1 3 0v4.757a5.5 5.5 0 0 0-1-.657V5.5a.5.5 0 0 0-1 0v3.707a5.5 5.5 0 0 0-1-.185V7H5v6h4.207a5.5 5.5 0 0 0-.185 1H5v.5a1.5 1.5 0 0 1-3 0zm2 0a.5.5 0 0 0-1 0v9a.5.5 0 0 0 1 0zm15 9a4.5 4.5 0 1 1-9 0a4.5 4.5 0 0 1 9 0m-2.287-.437l-2.97-1.65a.5.5 0 0 0-.743.437v3.3a.5.5 0 0 0 .743.437l2.97-1.65a.5.5 0 0 0 0-.874"/></svg>'

function resolveWorkbenchTitle(t) {
  const val = typeof t === 'function' ? t('nav') : undefined
  return val && val !== 'nav' ? val : '项目'
}

export function mountSidebarEntry(_stage, t, locale) {
  return createWorkbenchSidebarEntry({
    id: 'omnimux-workflow',
    rank: 4,
    tabId: WORKFLOW_LIBRARY_TAB_ID,
    label: () => t('nav'),
    title: () => resolveWorkbenchTitle(t),
    iconSvg: ICON,
    locale,
    access: 'offline',
    customClassName: 'omnimux-workflow-entry',
    datasetKey: 'data-dsh-omnimux-workflow-entry',
  })
}
