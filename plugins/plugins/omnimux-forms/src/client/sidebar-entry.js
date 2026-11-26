/**
 * 任务表单 row under 新会话, placed by the single sidebar coordinator.
 * Consumes standardized createWorkbenchSidebarEntry from dsh-ui-kit with idempotent activation.
 *
 * Currently unused: `client/index.js` does not call `mountSidebarEntry`
 * (temporarily hidden from left sidebar rail). Kept intact so re-enabling
 * the sidebar entry is a single line change in `index.js`.
 */
import { createWorkbenchSidebarEntry } from 'dsh-ui-kit'

export const ENTRY_SELECTOR = '[data-omnimux-forms-entry]'
export const FORMS_TAB_ID = 'omnimux-forms:tasks'

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>'

function resolveWorkbenchTitle(t) {
  const val = typeof t === 'function' ? t('nav') : undefined
  return val && val !== 'nav' ? val : '任务表单'
}

export function mountSidebarEntry(_stage, t, locale) {
  return createWorkbenchSidebarEntry({
    id: 'omnimux-forms',
    rank: 11,
    tabId: FORMS_TAB_ID,
    label: () => t('nav'),
    title: () => resolveWorkbenchTitle(t),
    iconSvg: ICON,
    locale,
    access: 'offline',
    customClassName: 'omnimux-forms-entry',
    datasetKey: 'data-omnimux-forms-entry',
  })
}
