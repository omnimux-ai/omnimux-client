/**
 * Defensive A–Z sort for capability catalog rows.
 * Mirrors hub `catalog/sort.js` Collator options; workflow must not import hub.
 */

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export type CatalogSortRow = { id?: string; label?: string }

/**
 * Sort catalog rows by display name. Does not mutate `rows`.
 */
export function sortCatalogRows<T extends CatalogSortRow>(rows: readonly T[] | null | undefined): T[] {
  if (!Array.isArray(rows) || rows.length === 0) return []
  return [...rows].sort((a, b) => {
    const left = typeof a.label === 'string' && a.label.trim() ? a.label : String(a.id ?? '')
    const right = typeof b.label === 'string' && b.label.trim() ? b.label : String(b.id ?? '')
    return collator.compare(left, right)
  })
}
