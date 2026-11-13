/**
 * Shared a11y helpers: focus ring + hover rules for keyboard-reachable rows,
 * and the Enter/Space activation handler. Kept separate from AssetsStage so
 * row components avoid a circular import.
 */

/** Focus ring + row hover rules (injected once by AssetsStage). */
export const FOCUS_CSS = [
  '.omnimux-assets-focusable:focus-visible{outline:2px solid var(--dsw-alias-label-primary, inherit);outline-offset:2px;border-radius:8px;}',
  '.omnimux-assets-focusable:hover{border-color:var(--dsw-alias-border-l4, var(--dsw-alias-border-l3, currentColor));}',
  '.omnimux-assets-check{opacity:0;transition:opacity 0.15s ease;}',
  '.omnimux-assets-focusable:hover .omnimux-assets-check,.omnimux-assets-focusable:focus-within .omnimux-assets-check,.omnimux-assets-check[data-selected="true"]{opacity:1;}',
].join('\n')

/** Enter/Space activates a keyboard-reachable row. */
export function activateRowKeydown(trigger) {
  return (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      trigger()
    }
  }
}
