import { Button, IconButton } from 'dsh-ui-kit'
import { useClipT } from '../i18n/index.js'
import { setClipUiMode } from './uiModeStore.js'

function CloseGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4l8 8" />
      <path d="M12 4L4 12" />
    </svg>
  )
}

export function SimpleInspectorCloseButton({ onClose }) {
  const t = useClipT()
  if (typeof onClose !== 'function') return null
  return (
    <IconButton
      type="button"
      size="sm"
      variant="ghost"
      staticScale
      className="clip-simple-inspector-close"
      data-clip-simple-only="true"
      data-testid="clip-simple-inspector-close"
      aria-label={t('Close inspector')}
      title={t('Close inspector')}
      onClick={onClose}
    >
      <CloseGlyph />
    </IconButton>
  )
}

export function SimpleInspectorFooter() {
  const t = useClipT()
  return (
    <div
      className="clip-simple-inspector-footer"
      data-clip-simple-only="true"
      data-testid="clip-simple-inspector-footer"
    >
      <Button
        type="button"
        size="sm"
        variant="ghost"
        staticScale
        className="clip-simple-inspector-pro-btn"
        data-testid="clip-simple-expand-pro"
        onClick={() => setClipUiMode('pro')}
      >
        {t('Expand pro controls')}
      </Button>
    </div>
  )
}
