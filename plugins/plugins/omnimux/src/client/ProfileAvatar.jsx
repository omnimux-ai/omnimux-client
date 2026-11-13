import { useRef } from 'react'
import { Button, IconButton, ModalDialog } from 'dsh-ui-kit'

/** Hue presets, kept in sync with src/avatar/avatar.js. */
export const HUES = [12, 90, 150, 210, 280, 320]

export function AvatarFace({ uri, initial, size = 44 }) {
  const vars = { '--avatar-size': `${size}px` }
  if (uri) {
    return (
      <img
        src={uri}
        width={size}
        height={size}
        alt=""
        className="omnimux-profile-avatar-img"
        style={vars}
      />
    )
  }
  return (
    <div
      className="omnimux-profile-avatar-face"
      data-large={size > 60 ? 'true' : 'false'}
      style={vars}
    >
      {initial}
    </div>
  )
}

export function EditableAvatar({ t, uri, initial, onOpen }) {
  return (
    <div className="omnimux-avatar" onClick={onOpen} title={t('avatar.edit')}>
      <AvatarFace uri={uri} initial={initial} />
      <div className="omnimux-avatar-edit">{t('avatar.edit')}</div>
    </div>
  )
}

export function AvatarModal({ t, avatar, initial, busy, error, onApply, onClose }) {
  const fileRef = useRef(null)
  const activeHue = typeof avatar?.opts?.hue === 'number' ? avatar.opts.hue : null

  function pickFile(event) {
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (dataUrl) void onApply({ upload: dataUrl })
    }
    reader.readAsDataURL(file)
  }

  return (
    <ModalDialog
      open
      size="sm"
      onClose={onClose}
      title={t('avatar.title')}
      closeLabel={t('avatar.close')}
      footer={(
        <Button variant="ghost" onClick={onClose}>
          {t('avatar.close')}
        </Button>
      )}
    >
      <div className="omnimux-profile-avatar-preview">
        <AvatarFace uri={avatar?.uri} initial={initial} size={96} />
      </div>

      <div className="omnimux-profile-hues">
        <span className="omnimux-profile-hues-label">{t('avatar.hue')}</span>
        {HUES.map((hue) => (
          <IconButton
            key={hue}
            size="xs"
            variant="ghost"
            aria-label={`${t('avatar.hue')} ${hue}`}
            data-active={activeHue === hue ? 'true' : 'false'}
            className="omnimux-profile-hue"
            disabled={busy}
            onClick={() => { void onApply({ hue }) }}
          >
            <span
              className="omnimux-profile-hue-swatch"
              style={{ '--hue': String(hue) }}
            />
          </IconButton>
        ))}
      </div>

      <div className="omnimux-profile-avatar-actions">
        <Button variant="primary" disabled={busy} onClick={() => { void onApply({ reroll: true }) }}>
          {t('avatar.reroll')}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
          {t('avatar.upload')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          style={{ display: 'none' }}
          onChange={pickFile}
        />
        <Button
          variant="ghost"
          disabled={busy || avatar?.using_default !== false}
          onClick={() => { void onApply({ reset: true }) }}
        >
          {t('avatar.reset')}
        </Button>
      </div>
      <p className="omnimux-profile-hint">{t('avatar.uploadHint')}</p>
      {error ? <p className="omnimux-profile-error">{error}</p> : null}
    </ModalDialog>
  )
}
