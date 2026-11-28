/** Isolate focus and capture-phase Escape handling while a lightweight modal dialog is mounted. */

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

function isFocusableVisible(element: HTMLElement): boolean {
  return !element.hasAttribute('disabled')
    && !element.hasAttribute('hidden')
    && element.getAttribute('aria-hidden') !== 'true'
}

export function installDialogKeyboardIsolation(
  dialog: HTMLElement | null,
  initialFocus: HTMLElement | null,
  onDismiss: () => void,
  onDisabledReturnTarget?: (target: HTMLElement) => void,
): () => void {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  initialFocus?.focus()
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
      onDismiss()
      return
    }
    if (event.key !== 'Tab' || dialog === null) return
    const focusables = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(isFocusableVisible)
    if (focusables.length === 0) {
      event.preventDefault()
      return
    }
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    const active = document.activeElement
    if (event.shiftKey) {
      if (active === first || !(active instanceof Node) || !dialog.contains(active)) {
        event.preventDefault()
        last.focus()
      }
      return
    }
    if (active === last || !(active instanceof Node) || !dialog.contains(active)) {
      event.preventDefault()
      first.focus()
    }
  }
  window.addEventListener('keydown', onKeyDown, true)
  return () => {
    window.removeEventListener('keydown', onKeyDown, true)
    if (previousFocus?.isConnected) {
      if (previousFocus.hasAttribute('disabled') && onDisabledReturnTarget) {
        onDisabledReturnTarget(previousFocus)
      } else {
        previousFocus.focus()
      }
    }
  }
}
