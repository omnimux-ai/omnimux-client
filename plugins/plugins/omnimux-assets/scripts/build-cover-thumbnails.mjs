#!/usr/bin/env node
/**
 * Build the cover thumbnails the cloud asset shelf renders in its cards.
 *
 * ## Why this exists
 *
 * The catalog's `cover_url` points at the *original* upload. For most rows that
 * is fine — 场景 / 道具 / 素材 covers are 7–180 KB JPEGs — but the 111 rows that
 * ship a PNG portrait are **2.4–5.6 MB each** at 1152×2048. The catalog pages are
 * ordered by id, and those 111 ids all sort ahead of the rest, so the very first
 * 角色 page is 100% PNG and costs **79.1 MB** for 24 cards. That is the whole
 * reason the shelf paints in from the top like a curtain.
 *
 * The CDN cannot help: it serves no image-resizing service (`/cdn-cgi/image/...`
 * answers 404, and `?w=520` still returns the full 2.9 MB object). So the only
 * way to shrink what a card downloads is to produce a smaller object and ship its
 * key — which is exactly what this script does.
 *
 * ## Output contract
 *
 *   <out>/<object key>              one WebP per row, 640px wide
 *   <out>/thumb-manifest.json       { schema, width, quality, generatedAt, rows[] }
 *
 * `thumb-manifest.json` is the input the catalog builder consumes
 * (`--thumb-manifest=<path>`): it maps a catalog row id to the R2 object key the
 * thumbnail must be uploaded under. The builder turns that key into
 * `thumb_url` on the row, and the client prefers it over `cover_url`.
 *
 * Uploading the produced objects to the bucket is an operator step and is NOT
 * performed here — see docs/contracts/cloud-asset-cdn-keys.md for the key rules.
 *
 * ## Determinism
 *
 * Identical inputs produce byte-identical thumbnails and a manifest that differs
 * only in `generatedAt` (overridable via `--generated-at=<iso>`). Rows are sorted
 * by id, and an existing thumbnail whose bytes already match is left untouched, so
 * a re-run is a no-op and a partial run resumes.
 *
 * ## Usage (from the plugin directory)
 *
 *   node scripts/build-cover-thumbnails.mjs --out=/tmp/thumbs
 *   node scripts/build-cover-thumbnails.mjs --out=/tmp/thumbs --recommended
 *   node scripts/build-cover-thumbnails.mjs --out=/tmp/thumbs --include-categories=character --max-bytes=120000 --video-posters
 *   node scripts/build-cover-thumbnails.mjs --out=/tmp/thumbs --all
 *   node scripts/build-cover-thumbnails.mjs --out=/tmp/thumbs --limit=5 --dry-run
 *   node scripts/build-cover-thumbnails.mjs --out=/tmp/thumbs --ids=ids.txt
 *
 * `--recommended` selects the high-ROI full-catalog set in one pass:
 *   1. All `.png` covers (existing default);
 *   2. All `character` covers (closes the 329 unthumbnailed 200-480 KB pippit JPGs);
 *   3. Any image row whose `meta.bytes` exceeds 120 KB (closes oversized scene/prop JPGs);
 *   4. All poster-less video rows via ffmpeg first-frame extraction (closes 694 material/hook MP4s).
 *
 * `--ids=<file>` names rows explicitly (one id per line, `#` comments allowed) and
 * outranks the format/size filters, so a few oversized covers can be fixed without
 * re-encoding the rest of the catalog.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_CATALOG_DIR = join(PLUGIN_ROOT, 'cloud-catalog')

/** Card face width in CSS px is ≤320; at 2× DPR that is 640 physical px. */
export const THUMB_WIDTH = 640
/** Measured on the real 1152×2048 portrait: 69 KB at this setting. */
export const THUMB_QUALITY = 78
/** Recommended byte threshold for re-encoding oversized JPEG image covers. */
export const RECOMMENDED_MAX_COVER_BYTES = 120 * 1024
/** Recommended categories whose covers should always ship WebP thumbnails. */
export const RECOMMENDED_CATEGORIES = new Set(['character'])
/** Timeout per ffmpeg remote first-frame probe (ms). */
export const VIDEO_POSTER_TIMEOUT_MS = 30_000
/** The manifest's own schema version, so a future field can be added safely. */
export const THUMB_MANIFEST_SCHEMA = 1
export const THUMB_MANIFEST_NAME = 'thumb-manifest.json'

/**
 * Cover formats worth re-encoding by default.
 *
 * Only PNG is on by default: it is the one format whose covers are megabytes.
 * JPEG covers are 7–430 KB and WebP already wins on nothing there, while a
 * blanket re-encode would churn 4 675 objects for a rounding-error saving.
 */
export const DEFAULT_REENCODE_EXTS = new Set(['.png'])

/**
 * Object key a row's thumbnail is published under.
 *
 * Derived from the row id, not from the cover's file name: the id is stable and
 * already URL-safe, while the original name carries spaces, parentheses and CJK
 * that every uploader would have to re-encode consistently. Keys live under a
 * dedicated `thumbs/` prefix so a bucket listing can be scoped and pruned.
 * @param {string} rowId
 * @returns {string}
 */
export function thumbObjectKey(rowId) {
  const id = String(rowId ?? '').trim()
  if (id === '') return ''
  // A key is a bucket path segment: refuse anything that could climb out of the
  // prefix rather than sanitizing it into something that silently collides.
  if (id.includes('/') || id.includes('\\') || id.includes('..')) return ''
  return `thumbs/${id}.webp`
}

/**
 * Parse a comma-separated `--include-categories` list into a trimmed Set.
 * @param {unknown} value
 * @returns {Set<string>}
 */
export function parseIncludeCategories(value) {
  if (value instanceof Set) return new Set([...value].map((s) => String(s).trim()).filter(Boolean))
  if (Array.isArray(value)) return new Set(value.map((s) => String(s).trim()).filter(Boolean))
  const raw = String(value ?? '').trim()
  if (raw === '') return new Set()
  return new Set(raw.split(',').map((part) => part.trim()).filter(Boolean))
}

/**
 * Whether a poster-less video row qualifies for first-frame WebP poster extraction.
 * @param {any} row
 * @param {{ videoPosters?: boolean, ids?: Set<string> }} [options]
 */
export function needsVideoPoster(row, options = {}) {
  if (options.videoPosters !== true) return false
  const cover = String(row?.cover_url ?? '').trim()
  if (cover !== '') return false
  const media = String(row?.media_url ?? '').trim()
  if (!/^https?:\/\//i.test(media)) return false
  if (row?.media_type !== 'video') return false
  const ids = options.ids
  if (ids instanceof Set && ids.size > 0) return ids.has(String(row?.id ?? ''))
  return true
}

/**
 * Whether a catalog row should get a thumbnail from its cover image.
 *
 * A row with no cover has nothing to shrink here (see `needsVideoPoster` for
 * poster-less videos). A row whose cover is a legacy `file:` locator has no
 * remote object at all, so there is nothing to pair a thumbnail with.
 *
 * `ids` names rows explicitly, so it outranks the format/size/category filters.
 * @param {any} row
 * @param {{
 *   exts?: Set<string>,
 *   all?: boolean,
 *   ids?: Set<string>,
 *   maxBytes?: number,
 *   includeCategories?: Set<string> | string[] | string,
 * }} [options]
 */
export function needsThumbnail(row, options = {}) {
  const exts = options.exts ?? DEFAULT_REENCODE_EXTS
  const cover = String(row?.cover_url ?? '')
  if (cover === '' || cover.startsWith('file:')) return false
  const ids = options.ids
  if (ids instanceof Set && ids.size > 0) return ids.has(String(row?.id ?? ''))
  if (options.all === true) return true
  const coverExt = extname(cover.split('?')[0]).toLowerCase()
  if (exts.has(coverExt)) return true
  const includeCategories = parseIncludeCategories(options.includeCategories)
  if (includeCategories.size > 0 && includeCategories.has(String(row?.category ?? ''))) {
    return coverExt !== '.webp'
  }
  const maxBytes = Number(options.maxBytes)
  if (Number.isFinite(maxBytes) && maxBytes > 0) {
    // Only trust `meta.bytes` as cover byte size when the cover IS the row's media image.
    const isImageCover = String(row?.media_url ?? '') === cover
    const bytes = Number(row?.meta?.bytes) || 0
    if (isImageCover && bytes > maxBytes && coverExt !== '.webp') return true
  }
  return false
}

/**
 * The rows this run will encode, in id order.
 *
 * Pure: it reads the catalog rows it is given and nothing else, so the selection
 * rule can be asserted without a filesystem or a network.
 * @param {any[]} rows
 * @param {{
 *   exts?: Set<string>,
 *   all?: boolean,
 *   ids?: Set<string>,
 *   limit?: number,
 *   maxBytes?: number,
 *   includeCategories?: Set<string> | string[] | string,
 *   videoPosters?: boolean,
 * }} [options]
 * @returns {{ id: string, coverUrl: string, mediaUrl?: string, sourceKind: 'cover' | 'video-poster', key: string }[]}
 */
export function planThumbs(rows, options = {}) {
  const list = Array.isArray(rows) ? rows : []
  const plan = []
  const seen = new Set()
  for (const row of list) {
    const id = String(row?.id ?? '')
    const key = thumbObjectKey(id)
    if (key === '' || seen.has(id)) continue
    if (needsThumbnail(row, options)) {
      seen.add(id)
      plan.push({ id, coverUrl: String(row.cover_url), sourceKind: 'cover', key })
      continue
    }
    if (needsVideoPoster(row, options)) {
      seen.add(id)
      plan.push({ id, coverUrl: '', mediaUrl: String(row.media_url), sourceKind: 'video-poster', key })
    }
  }
  plan.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const limit = Number(options.limit)
  if (Number.isFinite(limit) && limit > 0) return plan.slice(0, limit)
  return plan
}

/**
 * The manifest a catalog build consumes.
 *
 * `rows` carries only what the builder needs — the id it keys on and the key it
 * prefixes with the CDN base — plus the measured size so a reviewer can see the
 * payload budget without re-downloading anything.
 * @param {{ rows: { id: string, key: string, bytes: number, width: number }[],
 *   generatedAt: string, all?: boolean, scope?: string }} spec
 */
export function buildManifest(spec) {
  const rows = Array.isArray(spec.rows) ? spec.rows.slice() : []
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return {
    schema: THUMB_MANIFEST_SCHEMA,
    width: THUMB_WIDTH,
    quality: THUMB_QUALITY,
    format: 'webp',
    scope: spec.scope ?? (spec.all === true ? 'all' : 'png'),
    generatedAt: spec.generatedAt,
    total: rows.length,
    totalBytes: rows.reduce((sum, row) => sum + (Number(row.bytes) || 0), 0),
    rows,
  }
}

/**
 * Resolve `sharp` from wherever this checkout actually has it.
 *
 * The assets plugin deliberately does not declare `sharp`: it is a build-time
 * concern, and the repo already installs it for the hub. Resolution is attempted
 * from a few known roots and then reported as one clear error — a build that
 * cannot encode must fail loudly, never emit an empty manifest that reads like
 * "no row needed a thumbnail".
 * @param {string} [pluginRoot]
 */
export function loadSharp(pluginRoot = PLUGIN_ROOT) {
  const requireFrom = createRequire(join(pluginRoot, 'package.json'))
  const candidates = [
    pluginRoot,
    join(pluginRoot, '..', 'omnimux'),
    join(pluginRoot, '..', '..'),
  ]
  for (const root of candidates) {
    try {
      return requireFrom(requireFrom.resolve('sharp', { paths: [root] }))
    } catch {
      // try the next root
    }
  }
  throw new Error(
    'sharp is required to build cover thumbnails but could not be resolved.\n'
    + `Tried: ${candidates.join(', ')}\n`
    + 'Install workspace dependencies first (pnpm install), then re-run.',
  )
}

/**
 * Encode one cover into a WebP buffer at the card's own pixel width.
 * @param {any} sharp
 * @param {Buffer} input
 */
export async function encodeThumb(sharp, input) {
  return sharp(input)
    // `withoutEnlargement` keeps a narrow source at its own width: upscaling a
    // 400px cover to 640 would add bytes and no detail.
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer()
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const out = {}
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg)
    if (!match) continue
    out[match[1]] = match[2] === undefined ? true : match[2]
  }
  return out
}

/** @param {string} file */
function readJsonFile(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Read a row-id list: one id per line, blank lines and `#` comments ignored.
 *
 * The file is how a caller names a handful of rows without `--all`, which would
 * re-encode every cover in the catalog. A missing file throws rather than
 * silently selecting nothing: an empty selection would look like a successful
 * no-op run and hide the typo.
 * @param {string} file
 * @returns {Set<string>}
 */
export function readIdList(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    throw new Error(`--ids file is unreadable: ${file}`)
  }
  const ids = new Set()
  for (const line of text.split('\n')) {
    const value = line.trim()
    if (value === '' || value.startsWith('#')) continue
    ids.add(value)
  }
  return ids
}

/** @param {string} file @param {Buffer} data */
function writeFileAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, data)
  // rename keeps a concurrent reader from seeing a half-written object.
  renameSync(tmp, file)
}

/** @param {string} file */
function sha256Of(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/**
 * Fetch one cover's bytes. The catalog is cloud-only, so this is always HTTPS.
 * @param {string} url
 * @param {typeof fetch} [fetchImpl]
 */
async function fetchCover(url, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/**
 * Extract the first video frame (at 0.001s) as a PNG buffer via ffmpeg (`shell: false`).
 * Used for poster-less `material/hook` videos so clients render lightweight WebP cards
 * instead of fetching multi-megabyte MP4 streams on first load.
 * @param {string} url
 * @param {{ ffmpegBin?: string, timeoutMs?: number }} [opts]
 * @returns {Promise<Buffer>}
 */
export function extractVideoFirstFrame(url, opts = {}) {
  const ffmpegBin = opts.ffmpegBin || 'ffmpeg'
  const timeout = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : VIDEO_POSTER_TIMEOUT_MS
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      ffmpegBin,
      [
        '-hide_banner',
        '-loglevel', 'error',
        '-ss', '0.001',
        '-i', url,
        '-frames:v', '1',
        '-f', 'image2pipe',
        '-vcodec', 'png',
        'pipe:1',
      ],
      { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, timeout },
      (error, stdout) => {
        if (error) {
          rejectPromise(error)
          return
        }
        if (!Buffer.isBuffer(stdout) || stdout.length === 0) {
          rejectPromise(new Error('ffmpeg produced empty frame output'))
          return
        }
        resolvePromise(stdout)
      },
    )
  })
}

/**
 * @param {{
 *   catalogDir?: string,
 *   outDir: string,
 *   all?: boolean,
 *   recommended?: boolean,
 *   maxBytes?: number,
 *   includeCategories?: Set<string> | string[] | string,
 *   videoPosters?: boolean,
 *   ids?: Set<string>,
 *   limit?: number,
 *   dryRun?: boolean,
 *   generatedAt?: string,
 *   fetchImpl?: typeof fetch,
 *   extractFrameImpl?: (url: string) => Promise<Buffer>,
 *   sharp?: any,
 *   log?: (line: string) => void,
 * }} options
 */
export async function buildThumbnails(options) {
  const catalogDir = options.catalogDir ?? DEFAULT_CATALOG_DIR
  const outDir = resolve(options.outDir)
  const log = options.log ?? ((line) => { process.stdout.write(`${line}\n`) })
  const index = readJsonFile(join(catalogDir, 'index.json'))
  if (!Array.isArray(index)) {
    throw new Error(`catalog index is missing or unreadable: ${join(catalogDir, 'index.json')}`)
  }

  const effectiveIncludeCategories = options.recommended === true
    ? new Set([...RECOMMENDED_CATEGORIES, ...parseIncludeCategories(options.includeCategories)])
    : parseIncludeCategories(options.includeCategories)
  const effectiveMaxBytes = options.recommended === true && !(Number(options.maxBytes) > 0)
    ? RECOMMENDED_MAX_COVER_BYTES
    : options.maxBytes
  const effectiveVideoPosters = options.recommended === true || options.videoPosters === true

  const plan = planThumbs(index, {
    all: options.all === true,
    ids: options.ids,
    limit: options.limit,
    maxBytes: effectiveMaxBytes,
    includeCategories: effectiveIncludeCategories,
    videoPosters: effectiveVideoPosters,
  })
  const scope = options.ids instanceof Set && options.ids.size > 0
    ? `${options.ids.size} named row(s)`
    : options.all === true
      ? 'all covers'
      : options.recommended === true
        ? 'recommended covers + video posters'
        : 'png covers'
  log(`[thumbs] ${plan.length} row(s) selected (${scope})`)

  if (options.dryRun === true) {
    for (const row of plan) {
      const source = row.sourceKind === 'video-poster' ? row.mediaUrl : row.coverUrl
      log(`[thumbs] would encode (${row.sourceKind}) ${row.id} <- ${source}`)
    }
    return { plan, rows: [], manifest: null, written: 0, skipped: 0 }
  }

  const sharp = options.sharp ?? loadSharp()
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const extractFrameImpl = options.extractFrameImpl ?? extractVideoFirstFrame
  /** @type {{ id: string, key: string, bytes: number, width: number }[]} */
  const rows = []
  let written = 0
  let skipped = 0

  for (const item of plan) {
    const target = join(outDir, item.key)
    let input
    try {
      input = item.sourceKind === 'video-poster'
        ? await extractFrameImpl(String(item.mediaUrl ?? ''))
        : await fetchCover(item.coverUrl, fetchImpl)
    } catch (error) {
      // One unreachable cover/video must not abort the run: the row simply ships
      // without a thumbnail and the client falls back to its original.
      log(`[thumbs] SKIP ${item.id}: ${item.sourceKind} fetch failed (${error instanceof Error ? error.message : String(error)})`)
      continue
    }
    let encoded
    try {
      encoded = await encodeThumb(sharp, input)
    } catch (error) {
      log(`[thumbs] SKIP ${item.id}: encode failed (${error instanceof Error ? error.message : String(error)})`)
      continue
    }

    if (existsSync(target) && statSync(target).size === encoded.length) {
      // Same byte length is not proof, but a re-run over an unchanged catalog
      // produces identical output; compare content before trusting it.
      const existing = sha256Of(target)
      const incoming = createHash('sha256').update(encoded).digest('hex')
      if (existing === incoming) {
        skipped += 1
        rows.push({ id: item.id, key: item.key, bytes: encoded.length, width: THUMB_WIDTH })
        continue
      }
    }

    writeFileAtomic(target, encoded)
    written += 1
    rows.push({ id: item.id, key: item.key, bytes: encoded.length, width: THUMB_WIDTH })
  }

  const manifestScope = options.all === true
    ? 'all'
    : options.recommended === true
      ? 'recommended'
      : effectiveVideoPosters || effectiveIncludeCategories.size > 0 || Number(effectiveMaxBytes) > 0
        ? 'filtered'
        : 'png'
  const manifest = buildManifest({
    rows,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    all: options.all === true,
    scope: manifestScope,
  })
  writeFileAtomic(join(outDir, THUMB_MANIFEST_NAME), Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`))

  log(`[thumbs] wrote ${written}, skipped ${skipped}, total ${(manifest.totalBytes / 1024 / 1024).toFixed(2)} MB`)
  log(`[thumbs] manifest: ${join(outDir, THUMB_MANIFEST_NAME)}`)
  return { plan, rows, manifest, written, skipped }
}

/** @param {string[]} argv */
async function main(argv) {
  const args = parseArgs(argv)
  if (typeof args.out !== 'string' || args.out === '') {
    throw new Error('--out=<dir> is required: the thumbnails are published from there')
  }
  await buildThumbnails({
    catalogDir: typeof args.catalog === 'string' ? resolve(args.catalog) : DEFAULT_CATALOG_DIR,
    outDir: args.out,
    all: args.all === true,
    recommended: args.recommended === true,
    maxBytes: typeof args['max-bytes'] === 'string' ? Number(args['max-bytes']) : undefined,
    includeCategories: typeof args['include-categories'] === 'string' ? args['include-categories'] : undefined,
    videoPosters: args['video-posters'] === true,
    ids: typeof args.ids === 'string' ? readIdList(resolve(args.ids)) : undefined,
    limit: typeof args.limit === 'string' ? Number(args.limit) : undefined,
    dryRun: args['dry-run'] === true,
    generatedAt: typeof args['generated-at'] === 'string' ? args['generated-at'] : undefined,
  })
}

// Only run when invoked as a script; importing the module for tests must not
// touch the network or the filesystem.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
