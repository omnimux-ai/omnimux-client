#!/usr/bin/env node
/**
 * Prune dead rows and/or clear dead `cover_url` values in an existing
 * `cloud-catalog/` tree (`manifest.json`, `index.json`, and affected
 * `page-NNNN.json` shards) without requiring the original raw asset tree.
 *
 * Usage (from plugins/plugins/omnimux-assets):
 *   node scripts/prune-catalog-rows.mjs --drop-ids=id1,id2 --clear-cover-ids=id3,id4
 *   node scripts/prune-catalog-rows.mjs --drop-ids-file=/path/drop.json --clear-cover-ids-file=/path/clear.json
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_CATALOG_DIR = join(PLUGIN_ROOT, 'cloud-catalog')
const ALL_SCOPE = 'all'
const CHARACTER_FILTER_SCOPE = 'character_filtered'

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function writeCompactAtomic(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(data)}\n`, 'utf8')
  renameSync(tmp, filePath)
}

function shelfListOf(row) {
  const shelves = Array.isArray(row?.sub_categories) ? row.sub_categories : []
  if (shelves.length > 0) return shelves
  return row?.sub_category ? [row.sub_category] : []
}

function sortById(rows) {
  return rows.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function isDir(dirPath) {
  if (!existsSync(dirPath)) return false
  try {
    return readdirSync(dirPath, { withFileTypes: true }) !== null
  } catch {
    return false
  }
}

/**
 * Canonical compact `index.json` shape matching `build-cloud-assets-catalog.mjs`
 * (`indexEntryOf`): strips `meta.bytes` and non-portable internal keys while
 * keeping `thumb_url` when present and `meta` whitelist fields.
 */
function indexEntryOf(row) {
  /** @type {Record<string, unknown>} */
  const meta = {}
  if (row.meta?.source_media_url) meta.source_media_url = row.meta.source_media_url
  if (row.meta?.source_cover_url) meta.source_cover_url = row.meta.source_cover_url
  if (row.meta?.dims) meta.dims = row.meta.dims
  if (row.meta?.voice_type) {
    meta.voice_type = row.meta.voice_type
    if (typeof row.meta.resource_id === 'string' && row.meta.resource_id !== '') {
      meta.resource_id = row.meta.resource_id
    }
    if (typeof row.meta.source === 'string' && row.meta.source !== '') {
      meta.source = row.meta.source
    }
    meta.playable = row.meta.playable === true
    if (row.meta.preview) meta.preview = row.meta.preview
  }
  const entry = {
    id: row.id,
    category: row.category,
    sub_category: row.sub_category,
    sub_categories: shelfListOf(row),
    name: row.name,
    description: row.description,
    media_type: row.media_type,
    media_url: row.media_url,
    cover_url: row.cover_url,
    tags: row.tags,
  }
  if (typeof row.thumb_url === 'string' && row.thumb_url !== '') {
    entry.thumb_url = row.thumb_url
  }
  if (Object.keys(meta).length > 0) entry.meta = meta
  return entry
}

function buildPageSpecs(items, scope, pageSize) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const out = []
  for (let page = 0; page < totalPages; page += 1) {
    out.push({
      relPath: `${scope}/page-${String(page).padStart(4, '0')}.json`,
      body: {
        scope,
        page,
        pageSize,
        total: items.length,
        totalPages,
        items: items.slice(page * pageSize, (page + 1) * pageSize),
      },
    })
  }
  return out
}

function loadCanonicalRows(catalogDir, indexRows) {
  const allDir = join(catalogDir, ALL_SCOPE)
  const indexById = new Map(indexRows.map((r) => [r.id, r]))
  const pageRowById = new Map()

  if (existsSync(allDir)) {
    const pageFiles = readdirSync(allDir).filter((f) => /^page-\d{4}\.json$/.test(f)).sort()
    for (const file of pageFiles) {
      const page = readJson(join(allDir, file))
      for (const item of Array.isArray(page?.items) ? page.items : []) {
        if (item && typeof item.id === 'string') {
          const idxRow = indexById.get(item.id)
          if (idxRow?.thumb_url && !item.thumb_url) {
            item.thumb_url = idxRow.thumb_url
          }
          pageRowById.set(item.id, item)
        }
      }
    }
  }

  return indexRows.map((idxRow) => pageRowById.get(idxRow.id) ?? idxRow)
}

/**
 * Drop unreachable rows and/or clear broken `cover_url` strings in-place,
 * keeping `manifest.json`, `index.json`, and all page shards consistent.
 * Untouched category shards are not rewritten when their rows did not change.
 *
 * @param {{
 *   catalogDir?: string,
 *   dropIds?: Iterable<string>,
 *   clearCoverIds?: Iterable<string>,
 *   dryRun?: boolean,
 * }} [options]
 */
export function pruneCatalogRows(options = {}) {
  const catalogDir = resolve(options.catalogDir ?? DEFAULT_CATALOG_DIR)
  const dropSet = new Set([...(options.dropIds ?? [])].map((s) => String(s).trim()).filter(Boolean))
  const clearCoverSet = new Set([...(options.clearCoverIds ?? [])].map((s) => String(s).trim()).filter(Boolean))
  const dryRun = options.dryRun === true

  const manifestPath = join(catalogDir, 'manifest.json')
  const indexPath = join(catalogDir, 'index.json')
  if (!existsSync(manifestPath) || !existsSync(indexPath)) {
    throw new Error(`Catalog manifest.json or index.json missing under: ${catalogDir}`)
  }

  const manifest = readJson(manifestPath)
  const indexRows = readJson(indexPath)
  if (!manifest || !Array.isArray(manifest.categories) || !Array.isArray(indexRows)) {
    throw new Error(`Invalid manifest.json or index.json under: ${catalogDir}`)
  }

  const pageSize = Number(manifest.pageSize) > 0 ? Number(manifest.pageSize) : 24
  const fullRows = loadCanonicalRows(catalogDir, indexRows)

  let dropped = 0
  let coversCleared = 0
  const touchedCategories = new Set()
  const keptRows = []

  for (const row of fullRows) {
    if (!row || typeof row.id !== 'string') continue
    if (dropSet.has(row.id)) {
      dropped += 1
      touchedCategories.add(String(row.category || ''))
      continue
    }
    if (clearCoverSet.has(row.id)) {
      const hasCover = typeof row.cover_url === 'string' && row.cover_url !== ''
      const hasSourceCover = typeof row.meta?.source_cover_url === 'string' && row.meta.source_cover_url !== ''
      if (hasCover || hasSourceCover) {
        const nextRow = { ...row, cover_url: '' }
        if (hasSourceCover) {
          nextRow.meta = { ...row.meta }
          delete nextRow.meta.source_cover_url
        }
        keptRows.push(nextRow)
        coversCleared += 1
        touchedCategories.add(String(row.category || ''))
        continue
      }
    }
    keptRows.push(row)
  }

  if (dropped === 0 && coversCleared === 0) {
    return {
      catalogDir,
      dryRun,
      totalBefore: fullRows.length,
      totalAfter: keptRows.length,
      dropped: 0,
      coversCleared: 0,
      touchedCategories: [],
      pageFilesWritten: 0,
      orphanPageFilesRemoved: 0,
    }
  }

  const rowsByCategory = new Map()
  for (const category of manifest.categories) {
    rowsByCategory.set(
      category.id,
      sortById(keptRows.filter((row) => row.category === category.id)),
    )
  }

  const nextCategories = manifest.categories.map((category) => {
    const rows = rowsByCategory.get(category.id) ?? []
    const next = {
      ...category,
      total: rows.length,
      pages: Math.max(1, Math.ceil(rows.length / pageSize)),
    }
    if (Array.isArray(category.sub_categories)) {
      next.sub_categories = category.sub_categories.map((sub) => {
        const total = sub.id === CHARACTER_FILTER_SCOPE
          ? rows.length
          : rows.filter((row) => shelfListOf(row).includes(sub.id)).length
        return { ...sub, total, pages: Math.max(1, Math.ceil(total / pageSize)) }
      })
    }
    return next
  })

  const nextManifest = {
    ...manifest,
    totalAssets: keptRows.length,
    categories: nextCategories,
  }

  const allOrdered = []
  for (const category of nextCategories) {
    allOrdered.push(...(rowsByCategory.get(category.id) ?? []))
  }
  const nextIndex = allOrdered.map(indexEntryOf)

  // Always rewrite `all/` when any row changed; rewrite category & sub-category
  // scopes only for categories that actually had drops or cover clears so
  // unrelated categories stay byte-identical on disk.
  const scopeItems = new Map([[ALL_SCOPE, allOrdered]])
  for (const category of nextCategories) {
    if (!touchedCategories.has(category.id)) continue
    const rows = rowsByCategory.get(category.id) ?? []
    scopeItems.set(category.id, rows)
    for (const sub of Array.isArray(category.sub_categories) ? category.sub_categories : []) {
      if (sub.id === CHARACTER_FILTER_SCOPE) continue
      if (!isDir(join(catalogDir, category.id, sub.id))) continue
      scopeItems.set(`${category.id}/${sub.id}`, rows.filter((row) => shelfListOf(row).includes(sub.id)))
    }
  }

  let pageFilesWritten = 0
  let orphanPageFilesRemoved = 0

  if (!dryRun) {
    writeCompactAtomic(manifestPath, nextManifest)
    writeCompactAtomic(indexPath, nextIndex)
  }

  for (const [scope, scopeRows] of scopeItems) {
    const dir = join(catalogDir, scope)
    const sorted = scope === ALL_SCOPE ? scopeRows : sortById(scopeRows)
    const specs = buildPageSpecs(sorted, scope, pageSize)
    const desiredNames = new Set(specs.map((s) => s.relPath.slice(scope.length + 1)))

    if (existsSync(dir)) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && /^page-\d{4}\.json$/.test(entry.name) && !desiredNames.has(entry.name)) {
          orphanPageFilesRemoved += 1
          if (!dryRun) rmSync(join(dir, entry.name))
        }
      }
    }

    for (const page of specs) {
      pageFilesWritten += 1
      if (!dryRun) {
        writeCompactAtomic(join(catalogDir, page.relPath), page.body)
      }
    }
  }

  return {
    catalogDir,
    dryRun,
    totalBefore: fullRows.length,
    totalAfter: keptRows.length,
    dropped,
    coversCleared,
    touchedCategories: [...touchedCategories].sort(),
    pageFilesWritten,
    orphanPageFilesRemoved,
  }
}

function readIdsFile(filePath) {
  const parsed = JSON.parse(readFileSync(resolve(filePath), 'utf8'))
  if (Array.isArray(parsed)) return parsed
  if (Array.isArray(parsed?.ids)) return parsed.ids
  throw new Error(`Invalid IDs JSON file (expected string[] or { ids: string[] }): ${filePath}`)
}

function parseArgs(argv) {
  const opts = {
    catalogDir: DEFAULT_CATALOG_DIR,
    dropIds: [],
    clearCoverIds: [],
    dryRun: false,
  }
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true
    else if (arg.startsWith('--catalog=')) {
      const val = arg.slice('--catalog='.length).trim()
      if (!val) throw new Error('--catalog=<dir> must not be empty')
      opts.catalogDir = val
    } else if (arg.startsWith('--drop-ids=')) {
      opts.dropIds.push(...arg.slice('--drop-ids='.length).split(','))
    } else if (arg.startsWith('--drop-ids-file=')) {
      const val = arg.slice('--drop-ids-file='.length).trim()
      if (!val) throw new Error('--drop-ids-file=<path> must not be empty')
      opts.dropIds.push(...readIdsFile(val))
    } else if (arg.startsWith('--clear-cover-ids=')) {
      opts.clearCoverIds.push(...arg.slice('--clear-cover-ids='.length).split(','))
    } else if (arg.startsWith('--clear-cover-ids-file=')) {
      const val = arg.slice('--clear-cover-ids-file='.length).trim()
      if (!val) throw new Error('--clear-cover-ids-file=<path> must not be empty')
      opts.clearCoverIds.push(...readIdsFile(val))
    } else {
      throw new Error(`Unknown flag: ${arg}`)
    }
  }
  return opts
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const result = pruneCatalogRows(parseArgs(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}
