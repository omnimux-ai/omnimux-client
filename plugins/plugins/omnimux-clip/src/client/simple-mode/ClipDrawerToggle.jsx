import { IconButton } from 'dsh-ui-kit'
import { useClipT } from '../i18n/index.js'
import { toggleClipDrawer, useClipUiMode } from './uiModeStore.js'

function SidebarToggleGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M6.25 2.5v11" />
    </svg>
  )
}

export function ClipDrawerToggle() {
  const t = useClipT()
  const { drawerOpen } = useClipUiMode()

  return (
    <IconButton
      type="button"
      size="sm"
      variant="ghost"
      staticScale
      className="clip-drawer-toggle"
      data-clip-simple-only="true"
      data-testid="clip-drawer-toggle"
      aria-label={t('Toggle library sidebar')}
      title={t('Toggle library sidebar')}
      aria-pressed={drawerOpen}
      onClick={() => toggleClipDrawer()}
    >
      <SidebarToggleGlyph />
    </IconButton>
  )
}
