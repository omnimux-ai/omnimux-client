/**
 * 发布 row under 新会话, placed by the single sidebar coordinator.
 * Consumes standardized createWorkbenchSidebarEntry from dsh-ui-kit with idempotent activation.
 */
import { createWorkbenchSidebarEntry } from 'dsh-ui-kit'

export const ENTRY_SELECTOR = '[data-omnimux-publish-entry]'
export const PUBLISH_TAB_ID = 'omnimux-publish:library'

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="14" height="14" fill="none" role="presentation" aria-hidden="true" preserveAspectRatio="xMidYMid meet"><g><path d="M5.833.833H7.5V2.5h5V.833h1.667V2.5H15A2.5 2.5 0 0 1 17.5 5v10a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 15V5A2.5 2.5 0 0 1 5 2.5h.833V.833ZM5 4.167A.833.833 0 0 0 4.167 5v1.667h11.666V5A.833.833 0 0 0 15 4.167H5Zm-.833 4.166V15c0 .46.373.833.833.833h10c.46 0 .833-.373.833-.833V8.333H4.167Z" clip-rule="evenodd" fill-rule="evenodd" fill="currentColor"/></g></svg>'

function resolveWorkbenchTitle(t) {
  const val = typeof t === 'function' ? t('nav') : undefined
  return val && val !== 'nav' ? val : '发布'
}

export function mountSidebarEntry(_stage, t, locale) {
  return createWorkbenchSidebarEntry({
    id: 'omnimux-publish',
    rank: 4.2,
    tabId: PUBLISH_TAB_ID,
    label: () => t('nav'),
    title: () => resolveWorkbenchTitle(t),
    iconSvg: ICON,
    locale,
    access: 'cloud',
    customClassName: 'omnimux-publish-entry',
    datasetKey: 'data-omnimux-publish-entry',
  })
}
