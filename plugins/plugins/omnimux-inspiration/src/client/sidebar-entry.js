/**
 * 灵感社区 row under 新会话, placed by the single sidebar coordinator.
 * Consumes standardized createWorkbenchSidebarEntry from dsh-ui-kit with idempotent activation.
 */
import { createWorkbenchSidebarEntry } from 'dsh-ui-kit'

export const ENTRY_SELECTOR = '[data-omnimux-inspiration-entry]'
export const INSPIRATION_TAB_ID = 'omnimux-inspiration:library'

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" width="14" height="14" fill="none" role="presentation" aria-hidden="true" preserveAspectRatio="xMidYMid meet"><g><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M1.833 4.813a2.52 2.52 0 0 1 2.521-2.521h6.875a2.52 2.52 0 0 1 2.521 2.52v12.375a2.52 2.52 0 0 1-2.52 2.521H4.353a2.52 2.52 0 0 1-2.52-2.52V4.813Zm2.521-.688h6.875c.38 0 .688.308.688.688v12.375c0 .38-.308.687-.688.687H4.354a.687.687 0 0 1-.687-.688V4.813c0-.38.307-.688.687-.688Z"/><path fill="currentColor" d="m20.9 7.428-1.65-.953v9.05l1.65-.953V7.428Zm-3.483-2.011-1.834-1.059v13.284l1.834-1.059V5.417Z"/></g></svg>'

function resolveWorkbenchTitle(t) {
  const val = typeof t === 'function' ? t('nav') : undefined
  return val && val !== 'nav' ? val : '灵感社区'
}

export function mountSidebarEntry(_stage, t, locale) {
  return createWorkbenchSidebarEntry({
    id: 'omnimux-inspiration',
    rank: 7,
    tabId: INSPIRATION_TAB_ID,
    label: () => t('nav'),
    title: () => resolveWorkbenchTitle(t),
    iconSvg: ICON,
    locale,
    access: 'cloud',
    customClassName: 'omnimux-inspiration-entry',
    datasetKey: 'data-omnimux-inspiration-entry',
  })
}
