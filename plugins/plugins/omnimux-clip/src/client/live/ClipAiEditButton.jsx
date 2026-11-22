import { IconSparkleMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { Button } from 'dsh-ui-kit'
import { useClipT } from '../i18n/index.js'
import { useClipEditorActions } from './EditorSeat.jsx'

export function ClipAiEditButton() {
  const label = useClipT()('AI Edit')
  const { compose, canCompose } = useClipEditorActions()
  if (!compose) return null
  return (
    <Button
      variant="secondary"
      className="omnimux-clip-ai-edit"
      style={{ WebkitAppRegion: 'no-drag' }}
      aria-label={label}
      title={label}
      disabled={!canCompose}
      onClick={compose}
    >
      <span className="omnimux-clip-ai-edit-content">
        <IconSparkleMedium size={16} aria-hidden="true" />
        <span className="omnimux-clip-ai-edit-label">{label}</span>
      </span>
    </Button>
  )
}
