const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Sort catalog rows by display name. Does not mutate `rows`.
 * @template {{ label?: string, id?: string }} T
 * @param {readonly T[] | null | undefined} rows
 * @returns {T[]}
 */
export function sortCatalogRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return []
  return [...rows].sort((a, b) => {
    const left = typeof a.label === 'string' && a.label.trim() ? a.label : String(a.id ?? '')
    const right = typeof b.label === 'string' && b.label.trim() ? b.label : String(b.id ?? '')
    return collator.compare(left, right)
  })
}
