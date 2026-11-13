/**
 * Hub "应用" row under 新会话, placed by the single sidebar coordinator
 * (sidebar-coordinator.js). The coordinator owns all observers and ordering so
 * multiple plugins cannot re-place rows into each other (the dead-loop root
 * cause). This module only describes the row and its label/click behavior.
 */

export const ENTRY_SELECTOR = '[data-omnimux-apps-entry]'

const ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="1.5" y="1.5" width="5" height="5" rx="1"/><rect x="9.5" y="1.5" width="5" height="5" rx="1"/><rect x="1.5" y="9.5" width="5" height="5" rx="1"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/></svg>'

// Match official workspace session rows: 32px row / 14px label + 14px icon.
// Product rule: docs/contracts/sidebar-extra-entries.md
const STYLES = `
.omnimux-apps-entry {
  box-sizing: border-box; display: flex; align-items: center; gap: 6px; position: relative;
  width: calc(100% - 8px); height: 32px; margin: 0 4px; padding: 0 8px;
  border: none; border-radius: 8px; background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-s-14, inherit); font-size: 14px; line-height: 20px;
  cursor: pointer; text-align: left;
}
.omnimux-apps-entry:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); }
.omnimux-apps-entry[data-active="true"] { background: var(--dsw-alias-interactive-bg-active, rgba(128,128,128,.18)); font-weight: 500; }
.omnimux-apps-entry-icon { flex: none; display: inline-flex; width: 14px; height: 14px; align-items: center; justify-content: center; }
.omnimux-apps-entry svg { display: block; width: 14px; height: 14px; }
.omnimux-apps-entry-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 20px; }
`

function paintLabel(entry, label) {
  entry.setAttribute('aria-label', label)
  const node = entry.querySelector('.omnimux-apps-entry-label')
  if (node) node.textContent = label
}

/**
 * @param {{ getSnapshot: () => boolean, subscribe: (fn: () => void) => () => void, toggle: () => void }} apps
 * @param {(key: string) => string} t
 * @param {{ subscribe?: (fn: () => void) => () => void }} [locale]
 * @param {(row: { id: string, rank: number, create: () => HTMLButtonElement }) => () => void} register
 * @returns {() => void} disposer
 */
export function mountSidebarEntry(apps, t, locale, register) {
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.dataset.dshOmnimuxAppsEntry = ''
  entry.className = 'omnimux-apps-entry'
  entry.innerHTML = `<span class="omnimux-apps-entry-icon">${ICON}</span><span class="omnimux-apps-entry-label"></span>`
  paintLabel(entry, t('plugins.nav'))
  entry.addEventListener('click', () => { apps.toggle() })

  const paint = () => { paintLabel(entry, t('plugins.nav')) }
  const unsubscribeLocale = typeof locale?.subscribe === 'function' ? locale.subscribe(paint) : () => {}
  const syncActive = () => {
    if (apps.getSnapshot()) entry.dataset.active = 'true'
    else delete entry.dataset.active
  }
  const unsubscribeApps = apps.subscribe(syncActive)
  syncActive()

  const unregister = register({
    id: 'omnimux-apps-entry',
    rank: 1,
    styles: STYLES,
    styleId: 'omnimux-apps-entry-styles',
    create: () => entry,
  })

  return () => {
    unregister()
    unsubscribeApps()
    unsubscribeLocale()
  }
}
