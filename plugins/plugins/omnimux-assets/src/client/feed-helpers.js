/**
 * Pure helper utilities for assets stage feed, selection, sorting, and errors.
 */

/**
 * Extract error message from API result or locale fallback.
 * @param {{ ok: boolean, status?: number, body?: { error?: string, message?: string } }} result
 * @param {(key: string) => string} t
 */
export function messageOf(result, t) {
  const body = result?.body
  if (body?.error === 'name-conflict') return t('error.nameConflict')
  const msg = body?.message || body?.error
  if (msg) return String(msg)
  if (result?.status) return `HTTP ${String(result.status)}`
  return t('error.generic')
}

/**
 * Format caught rejection / error.
 * @param {unknown} caught
 */
export function errText(caught) {
  if (caught instanceof Error) return caught.message
  return String(caught)
}

/**
 * Surface picker-specific errors or fall back to messageOf.
 * @param {{ ok: boolean, status?: number, body?: { error?: string, message?: string } }} result
 * @param {(key: string) => string} t
 */
export function pickErrorText(result, t) {
  const code = String(result?.body?.error ?? '')
  if (code === 'picker-unsupported') return t('error.pickerUnsupported')
  if (code === 'picker-failed') return t('error.pickerFailed')
  return messageOf(result, t)
}

/**
 * Citation handle for an asset.
 * @param {{ cite?: string, type?: string, name?: string }} asset
 */
export function citeOf(asset) {
  if (!asset) return ''
  return asset.cite || `@${asset.type}/${asset.name}`
}

function matchAssetQuery(asset, query) {
  if (!query) return true
  const tags = Array.isArray(asset.tags) ? asset.tags.join('\n') : ''
  const hay = `${asset.name || ''}\n${asset.description || ''}\n${tags}`.toLowerCase()
  return hay.includes(query)
}

const MACHINE_META_LINE_RE = /^云端(?:分类|来源)[：:]/

/**
 * Strip machine provenance lines appended when saving cloud catalog items so the
 * list view shows clean human-written descriptions while tooltips keep full text.
 * @param {string | null | undefined} description
 * @returns {string}
 */
export function formatListDescription(description) {
  const lines = String(description ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const human = lines.filter((line) => !MACHINE_META_LINE_RE.test(line))
  return human.join(' ')
}

function assetTimestampMs(asset) {
  const raw = asset?.updated_at || asset?.updatedAt || asset?.created_at || asset?.createdAt || ''
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  const parsed = Date.parse(String(raw))
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Default sort direction for a given column key.
 * @param {string} sortKey
 * @returns {'asc' | 'desc'}
 */
export function defaultSortDirection(sortKey) {
  return sortKey === 'name' || sortKey === 'type' ? 'asc' : 'desc'
}

/**
 * Sort assets by supported list columns with explicit direction.
 * @param {Array<any>} assets
 * @param {string} sortKey
 * @param {'asc' | 'desc'} [sortDirection]
 */
export function sortAssetsBy(assets, sortKey, sortDirection) {
  const list = Array.isArray(assets) ? [...assets] : []
  const dir = (sortDirection || defaultSortDirection(sortKey)) === 'asc' ? 1 : -1
  if (sortKey === 'name') {
    return list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')) * dir)
  }
  if (sortKey === 'type') {
    return list.sort((a, b) => {
      const cmp = String(a.type || '').localeCompare(String(b.type || '')) * dir
      return cmp !== 0 ? cmp : String(a.name || '').localeCompare(String(b.name || ''))
    })
  }
  if (sortKey === 'files') {
    return list.sort((a, b) => {
      const countA = Array.isArray(a.files) ? a.files.length : 0
      const countB = Array.isArray(b.files) ? b.files.length : 0
      if (countA !== countB) return (countA - countB) * dir
      return String(a.name || '').localeCompare(String(b.name || ''))
    })
  }
  return list.sort((a, b) => {
    const diff = assetTimestampMs(a) - assetTimestampMs(b)
    if (diff !== 0) return diff * dir
    return String(b.updated_at || '').localeCompare(String(a.updated_at || '')) * (dir === -1 ? 1 : -1)
  })
}

/**
 * Filter and sort assets array.
 * @param {Array<{ name: string, type: string, description?: string, tags?: string[], updated_at?: string }>} assets
 * @param {string} filterType
 * @param {string} query
 * @param {string} sortKey
 * @param {'asc' | 'desc'} [sortDirection]
 */
export function filterAndSortAssets(assets, filterType, query, sortKey, sortDirection) {
  const list = Array.isArray(assets) ? assets : []
  const q = String(query || '').trim().toLowerCase()
  const filtered = list.filter((asset) => {
    if (filterType && asset.type !== filterType) return false
    return matchAssetQuery(asset, q)
  })
  return sortAssetsBy(filtered, sortKey, sortDirection)
}

/**
 * Parse response from native pickPath API.
 * @param {{ ok: boolean, status?: number, body?: { error?: string, path?: string, paths?: string[] } }} result
 * @param {(key: string) => string} t
 */
export function parsePickedPathsResult(result, t) {
  if (!result || !result.ok) {
    return { ok: false, error: pickErrorText(result, t), paths: [] }
  }
  const bodyPaths = result.body?.paths
  if (Array.isArray(bodyPaths)) {
    const valid = bodyPaths.filter((p) => typeof p === 'string' && p !== '')
    if (valid.length > 0) return { ok: true, error: '', paths: valid }
  }
  const single = result.body?.path
  if (typeof single === 'string' && single !== '') {
    return { ok: true, error: '', paths: [single] }
  }
  return { ok: true, error: '', paths: [] }
}

/**
 * Toggle an asset ID in a Set.
 * @param {Set<string>} prevSet
 * @param {string} assetId
 * @returns {Set<string>}
 */
export function toggleAssetIdInSet(prevSet, assetId) {
  const next = new Set(prevSet)
  if (next.has(assetId)) next.delete(assetId)
  else next.add(assetId)
  return next
}

/**
 * Select a contiguous range of asset IDs (Shift+Click) in the current visible order.
 * @param {Set<string>} prevSet
 * @param {string[]} orderedIds
 * @param {string | null | undefined} anchorId
 * @param {string} targetId
 * @returns {Set<string>}
 */
export function selectRangeIds(prevSet, orderedIds, anchorId, targetId) {
  const next = new Set(prevSet)
  const list = Array.isArray(orderedIds) ? orderedIds : []
  const targetIdx = list.indexOf(targetId)
  const anchorIdx = anchorId ? list.indexOf(anchorId) : -1
  if (targetIdx === -1 || anchorIdx === -1) {
    return toggleAssetIdInSet(prevSet, targetId)
  }
  const start = Math.min(anchorIdx, targetIdx)
  const end = Math.max(anchorIdx, targetIdx)
  for (let i = start; i <= end; i += 1) {
    next.add(list[i])
  }
  return next
}

/**
 * Toggle select-all across currently visible asset IDs.
 * @param {Set<string>} prevSet
 * @param {string[]} visibleIds
 * @returns {Set<string>}
 */
export function toggleAllVisibleIds(prevSet, visibleIds) {
  const list = Array.isArray(visibleIds) ? visibleIds : []
  if (list.length === 0) return new Set(prevSet)
  const allSelected = list.every((id) => prevSet.has(id))
  const next = new Set(prevSet)
  if (allSelected) {
    for (const id of list) next.delete(id)
  } else {
    for (const id of list) next.add(id)
  }
  return next
}

/**
 * Prune deleted IDs from a selection Set against live assets.
 * @param {Set<string>} selectedIds
 * @param {Array<{ id: string }>} liveAssets
 * @returns {Set<string>}
 */
export function cleanRemovedSelection(selectedIds, liveAssets) {
  const live = new Set((liveAssets || []).map((row) => row.id))
  const kept = [...selectedIds].filter((id) => live.has(id))
  if (kept.length === selectedIds.size) return selectedIds
  return new Set(kept)
}

/**
 * How many assets each type holds.
 *
 * The count describes the whole library, never the rows a query leaves on
 * screen: a category chip's number has to hold still while the search box
 * narrows the grid. Rows without a readable type are skipped rather than
 * pooled into a bucket nothing can select — the Host normalizes every stored
 * row onto the known type set, so a typeless row is not reachable by a chip.
 * @param {Array<{ type?: string }>} assets
 * @returns {Record<string, number>}
 */
export function countAssetsByType(assets) {
  const counts = {}
  for (const asset of Array.isArray(assets) ? assets : []) {
    const type = typeof asset?.type === 'string' ? asset.type.trim() : ''
    if (type === '') continue
    counts[type] = (counts[type] ?? 0) + 1
  }
  return counts
}

/**
 * Compute empty state labels for AssetGrid.
 * @param {string} filterType
 * @param {string} query
 * @param {(key: string) => string} t
 */
export function computeEmptyState(filterType, query, t) {
  const searching = Boolean(String(query || '').trim())
  const emptyTypeLabel = filterType ? t(`type.${filterType}`) : ''
  let emptyLabel = t('empty.all')
  if (searching) {
    emptyLabel = t('empty.noMatch')
  } else if (filterType) {
    emptyLabel = t('empty.type').replace('{type}', emptyTypeLabel)
  }
  let emptyActionLabel = undefined
  if (!searching) {
    emptyActionLabel = filterType
      ? t('empty.addType').replace('{type}', emptyTypeLabel)
      : t('add.button')
  }
  return { searching, emptyLabel, emptyActionLabel }
}
