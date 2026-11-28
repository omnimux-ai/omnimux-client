import { Button } from 'dsh-ui-kit'
import { useClipT } from '../i18n/index.js'
import { setClipUiMode, useClipUiMode } from './uiModeStore.js'

export function ClipModeToggle() {
  const t = useClipT()
  const { mode } = useClipUiMode()

  return (
    <div
      className="clip-ui-mode-toggle"
      role="group"
      aria-label={t('Editor mode')}
      data-testid="clip-ui-mode-toggle"
    >
      <Button
        type="button"
        size="xs"
        variant="ghost"
        staticScale
        data-clip-mode-option="simple"
        aria-pressed={mode === 'simple'}
        onClick={() => setClipUiMode('simple')}
      >
        {t('Simple')}
      </Button>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        staticScale
        data-clip-mode-option="pro"
        aria-pressed={mode === 'pro'}
        onClick={() => setClipUiMode('pro')}
      >
        {t('Pro')}
      </Button>
    </div>
  )
}
