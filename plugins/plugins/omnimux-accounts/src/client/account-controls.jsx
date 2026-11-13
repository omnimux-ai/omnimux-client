import { useEffect, useState } from 'react'
import { Button, IconButton } from 'dsh-ui-kit'
import { fmt } from './view.js'

/**
 * Shared interactive account controls (grid card + table row). Extracted so
 * both views render byte-identical switch / menu semantics and a11y.
 */

/**
 * "Agent usable" toggle. role=switch + aria-checked; the visible label rides
 * next to it, the state-qualified label goes to aria-label.
 * @param {{
 *   t: (key: string) => string,
 *   checked: boolean,
 *   disabled?: boolean,
 *   onToggle: (next: boolean) => void,
 * }} props
 */
export function AgentSwitch({ t, checked, disabled = false, onToggle }) {
  return (
    <IconButton
      variant="ghost"
      size="xs"
      role="switch"
      className="omnimux-accounts-switch"
      aria-checked={String(checked)}
      aria-label={checked ? t('card.agentUsableOn') : t('card.agentUsableOff')}
      title=""
      disabled={disabled}
      onClick={() => { onToggle(!checked) }}
    >
      <span className="omnimux-accounts-switch-knob" />
    </IconButton>
  )
}

/**
 * ⋯ overflow menu with a disconnect confirm popover (PluginsSection
 * confirmRemove pattern). The popover is absolutely positioned against the
 * nearest positioned ancestor — the card in grid view, a relative wrapper
 * span in table rows.
 * @param {{
 *   t: (key: string) => string,
 *   name: string,
 *   disabled?: boolean,
 *   onDisconnect: () => void,
 * }} props
 */
export function AccountMenu({ t, name, disabled = false, onDisconnect }) {
  const [popover, setPopover] = useState(null) // null | 'menu' | 'confirm'

  useEffect(() => {
    if (popover === null) return undefined
    const onPointerDown = (event) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-omnimux-accounts-popover]') !== null) return
      setPopover(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [popover])

  return (
    <>
      <IconButton
        variant="ghost"
        size="sm"
        className="omnimux-accounts-more"
        aria-label={t('card.menu')}
        aria-haspopup="menu"
        aria-expanded={popover !== null}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation()
          setPopover(popover === null ? 'menu' : null)
        }}
      >
        ⋯
      </IconButton>
      {popover === 'menu' ? (
        <div data-omnimux-accounts-popover="" role="menu" className="omnimux-accounts-popover">
          <Button
            variant="ghost"
            size="sm"
            role="menuitem"
            className="omnimux-accounts-menuitem omnimux-accounts-menuitem--danger"
            disabled={disabled}
            onClick={() => { setPopover('confirm') }}
          >
            {t('disconnect')}
          </Button>
        </div>
      ) : null}
      {popover === 'confirm' ? (
        <div data-omnimux-accounts-popover="" role="dialog" className="omnimux-accounts-popover">
          <p className="omnimux-accounts-popover-text">{fmt(t('card.confirmDisconnect'), { name })}</p>
          <div className="omnimux-accounts-popover-actions">
            <Button
              variant="danger"
              size="sm"
              disabled={disabled}
              onClick={() => {
                setPopover(null)
                onDisconnect()
              }}
            >
              {t('disconnect')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setPopover(null) }}>
              {t('action.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  )
}
