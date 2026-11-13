import { useSyncExternalStore } from 'react'
import { Button, IconButton } from 'dsh-ui-kit'

function AppsIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  )
}

/**
 * @param {{
 *   wide: boolean,
 *   t: (key: string) => string,
 *   apps: { getSnapshot: () => boolean, subscribe: Function, toggle: Function },
 * }} props
 */
export function AppsEntry({ wide, t, apps }) {
  const open = useSyncExternalStore(
    apps ? (cb) => apps.subscribe(cb) : () => () => {},
    apps ? () => apps.getSnapshot() : () => false,
  )

  if (!wide) {
    return (
      <IconButton
        variant="ghost"
        className={`omnimux-apps-entry-rail ${open ? 'active' : ''}`}
        aria-label={t('plugins.nav')}
        aria-pressed={open}
        onClick={() => { apps?.toggle() }}
      >
        <AppsIcon size={18} />
      </IconButton>
    )
  }

  return (
    <Button
      variant="ghost"
      className={`omnimux-apps-entry-wide ${open ? 'active' : ''}`}
      aria-label={t('plugins.nav')}
      aria-pressed={open}
      leadingIcon={<AppsIcon size={16} />}
      onClick={() => { apps?.toggle() }}
    >
      <span>{t('plugins.nav')}</span>
    </Button>
  )
}
