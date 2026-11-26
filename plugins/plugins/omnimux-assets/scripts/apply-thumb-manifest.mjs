#!/usr/bin/env node
/**
 * Apply a verified `thumb-manifest.json` onto an existing `cloud-catalog/` tree
 * (`index.json` and every `page-*.json` shard) without re-scanning source media
 * directories or disturbing existing rows, ordering, or already-attached `thumb_url`s.
 *
 * Usage (from plugins/plugins/omnimux-assets):
 *   node scripts/apply-thumb-manifest.mjs --manifest=/path/to/thumb-manifest.json
 *   node scripts/apply-thumb-manifest.mjs --manifest=/path/to/thumb-manifest.json --catalog=cloud-catalog --public-base=https://assets.omnimux.ai
 */
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_PUBLIC_BASE = 'https://assets.omnimux.ai'
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_CATALOG_DIR = join(PLUGIN_ROOT, 'cloud-catalog')

const STRICT_THUMB_KEY_RE = /^thumbs\/[a-zA-Z0-9._-]+\.webp$/

/**
 * Validate a manifest key under `thumbs/` and turn it into a public HTTPS URL.
 * Rejects leading slashes, traversal segments (raw or percent-encoded), nested
 * subdirectories, non-`.webp` extensions, query/fragment smuggling, and non-HTTPS bases.
 * @param {string} key
 * @param {string} [publicBase]
 * @returns {string}
 */
export function resolveThumbPublicUrl(key, publicBase = DEFAULT_PUBLIC_BASE) {
  const cleaned = String(key ?? '').trim()
  if (!STRICT_THUMB_KEY_RE.test(cleaned) || cleaned.includes('..')) {
    throw new Error(`invalid thumb manifest key: ${String(key)}`)
  }
  const rawBase = String(publicBase ?? '').trim()
  if (!rawBase) {
    throw new Error('publicBase must not be empty')
  }
  const parsedBase = new URL(rawBase)
  if (parsedBase.protocol !== 'https:' || parsedBase.search !== '' || parsedBase.hash !== '') {
    throw new Error(`invalid publicBase URL: ${rawBase}`)
  }
  const base = rawBase.replace(/\/+$/, '')
  const parsed = new URL(`${base}/${cleaned}`)
  if (
    parsed.protocol !== 'https:'
    || parsed.search !== ''
    || parsed.hash !== ''
    || !parsed.pathname.endsWith(`/${cleaned}`)
  ) {
    throw new Error(`resolved thumb URL failed validation: ${parsed.href}`)
  }
  return parsed.href
}

/**
 * Collect every `page-*.json` shard under `catalogDir` recursively.
 * @param {string} dir
 * @param {string[]} [out]
 * @returns {string[]}
 */
function collectPageFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) collectPageFiles(abs, out)
    else if (entry.isFile() && /^page-\d+\.json$/.test(entry.name)) out.push(abs)
  }
  return out.sort()
}

function writeCompactAtomic(filePath, data, preserveNewline) {
  const payload = JSON.stringify(data) + (preserveNewline ? '\n' : '')
  const tmp = `${filePath}.${process.pid}.tmp`
  writeFileSync(tmp, payload, 'utf8')
  renameSync(tmp, filePath)
}

/**
 * Apply `thumb-manifest.json` rows onto `catalogDir/index.json` and every page shard.
 * Existing `thumb_url` values not listed in the manifest are preserved untouched.
 *
 * @param {{
 *   manifestPath: string,
 *   catalogDir?: string,
 *   publicBase?: string,
 *   dryRun?: boolean,
 * }} options
 */
export function applyThumbManifest(options) {
  const catalogDir = resolve(options.catalogDir ?? DEFAULT_CATALOG_DIR)
  const manifestPath = resolve(options.manifestPath)
  const publicBase = options.publicBase ?? DEFAULT_PUBLIC_BASE
  const dryRun = options.dryRun === true

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (!manifest || !Array.isArray(manifest.rows)) {
    throw new Error(`thumb-manifest is missing rows[]: ${manifestPath}`)
  }

  /** @type {Map<string, string>} */
  const urlById = new Map()
  for (const row of manifest.rows) {
    if (!row || typeof row.id !== 'string' || row.id.trim() === '') continue
    urlById.set(row.id.trim(), resolveThumbPublicUrl(row.key, publicBase))
  }

  const indexPath = join(catalogDir, 'index.json')
  if (!existsSync(indexPath)) {
    throw new Error(`catalog index.json not found: ${indexPath}`)
  }

  const rawIndex = readFileSync(indexPath, 'utf8')
  const indexHasTrailingNewline = rawIndex.endsWith('\n')
  const indexRows = JSON.parse(rawIndex)
  if (!Array.isArray(indexRows)) {
    throw new Error(`catalog index.json is not an array: ${indexPath}`)
  }

  let indexAdded = 0
  let indexUpdated = 0
  let indexPreserved = 0
  let indexTotalWithThumb = 0
  let indexChanged = false

  for (const row of indexRows) {
    if (!row || typeof row.id !== 'string') continue
    const nextUrl = urlById.get(row.id)
    if (nextUrl) {
      if (!row.thumb_url) {
        row.thumb_url = nextUrl
        indexAdded += 1
        indexChanged = true
      } else if (row.thumb_url !== nextUrl) {
        row.thumb_url = nextUrl
        indexUpdated += 1
        indexChanged = true
      } else {
        indexPreserved += 1
      }
    } else if (row.thumb_url) {
      indexPreserved += 1
    }
    if (row.thumb_url) indexTotalWithThumb += 1
  }

  if (indexChanged && !dryRun) {
    writeCompactAtomic(indexPath, indexRows, indexHasTrailingNewline)
  }

  const pageFiles = collectPageFiles(catalogDir)
  let pagesTouched = 0
  let pageItemsAttached = 0

  for (const pageFile of pageFiles) {
    const rawPage = readFileSync(pageFile, 'utf8')
    const hasTrailingNewline = rawPage.endsWith('\n')
    const pageDoc = JSON.parse(rawPage)
    const items = Array.isArray(pageDoc?.items) ? pageDoc.items : []
    let changed = false
    for (const item of items) {
      if (!item || typeof item.id !== 'string') continue
      const nextUrl = urlById.get(item.id)
      if (!nextUrl) continue
      if (item.thumb_url !== nextUrl) {
        item.thumb_url = nextUrl
        pageItemsAttached += 1
        changed = true
      }
    }
    if (changed) {
      pagesTouched += 1
      if (!dryRun) writeCompactAtomic(pageFile, pageDoc, hasTrailingNewline)
    }
  }

  return {
    catalogDir,
    manifestRows: urlById.size,
    indexRows: indexRows.length,
    indexAdded,
    indexUpdated,
    indexPreserved,
    indexTotalWithThumb,
    pageFilesScanned: pageFiles.length,
    pagesTouched,
    pageItemsAttached,
    dryRun,
  }
}

function parseArgs(argv) {
  const opts = { manifestPath: '', catalogDir: DEFAULT_CATALOG_DIR, publicBase: DEFAULT_PUBLIC_BASE, dryRun: false }
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true
    else if (arg.startsWith('--manifest=')) opts.manifestPath = arg.slice('--manifest='.length).trim()
    else if (arg.startsWith('--catalog=')) {
      const val = arg.slice('--catalog='.length).trim()
      if (!val) throw new Error('--catalog=<dir> must not be empty')
      opts.catalogDir = val
    } else if (arg.startsWith('--public-base=')) {
      const val = arg.slice('--public-base='.length).trim()
      if (!val) throw new Error('--public-base=<url> must not be empty')
      opts.publicBase = val
    } else throw new Error(`Unknown flag: ${arg}`)
  }
  if (!opts.manifestPath) throw new Error('--manifest=<path> is required')
  return opts
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const result = applyThumbManifest(parseArgs(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}
