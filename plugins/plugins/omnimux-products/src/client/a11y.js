export const FOCUS_CSS = [
  '.omnimux-products-focusable:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px;border-radius:8px;}',
  '.omnimux-products-focusable:hover{border-color:var(--dsw-alias-border-l4);}',
  '.omnimux-products-check{opacity:0;transition:opacity 0.15s ease;}',
  '.omnimux-products-focusable:hover .omnimux-products-check,.omnimux-products-focusable:focus-within .omnimux-products-check,.omnimux-products-check[data-selected="true"]{opacity:1;}',
].join('\n')

export function activateRowKeydown(trigger) {
  return (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      trigger()
    }
  }
}
