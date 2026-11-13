/** Official Apps catalog document. Invalid input is rejected as a whole. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { assertNpmSpec } from '../plugins/manage.js'

export const MAX_CATALOG_BYTES = 65536
export const MAX_CATALOG_APPS = 64
export const CATALOG_SCHEMA = 1

export const FORBIDDEN_APP_NAMES = Object.freeze([
  'omnimux',
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  'dsh-better-sidebar',
])

const CAPABILITIES = new Set(['identity', 'videoGenerate', 'imageGenerate', 'official'])
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/
const PINNED = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/
const GENERATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

/**
 * @param {unknown} input
 * @param {{ maxBytes?: number }} [opts]
 * @returns {{
 *   schema: 1,
 *   generated_at: string,
 *   min_hub: string,
 *   apps: Array<{
 *     id: string,
 *     title: string,
 *     summary: string,
 *     kind: 'official',
 *     listed: boolean,
 *     capabilities: string[],
 *     client: boolean,
 *     spec: { source: 'npm' | 'bundled', name: string, version?: string },
 *   }>,
 * }}
 */
export function parseCatalog(input, opts = {}) {
  const maxBytes = opts.maxBytes ?? MAX_CATALOG_BYTES
  const raw = typeof input === 'string' ? input : JSON.stringify(input)
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    throw new Error('apps catalog exceeds size limit')
  }
  let body
  if (typeof input === 'string') {
    try {
      body = JSON.parse(input)
    } catch {
      throw new Error('apps catalog is not JSON')
    }
  } else {
    body = input
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('apps catalog must be an object')
  }
  const row = /** @type {Record<string, unknown>} */ (body)
  if (row.schema !== CATALOG_SCHEMA) throw new Error('apps catalog schema must be 1')
  if (typeof row.generated_at !== 'string' || !GENERATED_AT.test(row.generated_at) || Number.isNaN(Date.parse(row.generated_at))) {
    throw new Error('apps catalog generated_at is invalid')
  }
  if (typeof row.min_hub !== 'string' || !PINNED.test(row.min_hub)) {
    throw new Error('apps catalog min_hub is invalid')
  }
  if (!Array.isArray(row.apps)) throw new Error('apps catalog apps must be an array')
  if (row.apps.length > MAX_CATALOG_APPS) throw new Error('apps catalog has too many rows')
  const extra = Object.keys(row).filter((key) => !['schema', 'generated_at', 'min_hub', 'apps'].includes(key))
  if (extra.length > 0) throw new Error('apps catalog has unknown fields')
  const seen = new Set()
  const apps = row.apps.map((item, index) => parseApp(item, index, seen))
  return {
    schema: CATALOG_SCHEMA,
    generated_at: row.generated_at,
    min_hub: row.min_hub,
    apps,
  }
}

/**
 * Bundled catalog URL next to this package's `apps/` directory.
 * @returns {URL}
 */
export function bundledCatalogUrl() {
  return new URL('../../apps/catalog.json', import.meta.url)
}

/**
 * @param {(path: string | URL, encoding: 'utf8') => string} [readFile]
 */
export function loadBundledCatalog(readFile = readFileSync) {
  const path = fileURLToPath(bundledCatalogUrl())
  let raw
  try {
    raw = readFile(path, 'utf8')
  } catch {
    throw new Error('bundled apps catalog is missing')
  }
  return parseCatalog(raw)
}

/**
 * @param {unknown} item
 * @param {number} index
 * @param {Set<string>} seen
 */
function parseApp(item, index, seen) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(`apps catalog row ${String(index)} must be an object`)
  }
  const row = /** @type {Record<string, unknown>} */ (item)
  if (typeof row.id !== 'string' || row.id.length < 2 || row.id.length > 64 || !ID.test(row.id)) {
    throw new Error(`apps catalog row ${String(index)} id is invalid`)
  }
  if (seen.has(row.id)) throw new Error(`apps catalog duplicate id ${row.id}`)
  seen.add(row.id)
  if (FORBIDDEN_APP_NAMES.includes(row.id)) {
    throw new Error(`apps catalog id ${row.id} is reserved`)
  }
  if (typeof row.title !== 'string' || row.title.trim() === '' || row.title.length > 40) {
    throw new Error(`apps catalog ${row.id} title is invalid`)
  }
  if (typeof row.summary !== 'string' || row.summary.trim() === '' || row.summary.length > 160) {
    throw new Error(`apps catalog ${row.id} summary is invalid`)
  }
  if (row.kind !== 'official') throw new Error(`apps catalog ${row.id} kind must be official`)
  if (typeof row.listed !== 'boolean') throw new Error(`apps catalog ${row.id} listed must be boolean`)
  if (typeof row.client !== 'boolean') throw new Error(`apps catalog ${row.id} client must be boolean`)
  if (!Array.isArray(row.capabilities) || row.capabilities.some((cap) => !CAPABILITIES.has(cap))) {
    throw new Error(`apps catalog ${row.id} capabilities are invalid`)
  }
  if (new Set(row.capabilities).size !== row.capabilities.length) {
    throw new Error(`apps catalog ${row.id} capabilities are invalid`)
  }
  const extra = Object.keys(row).filter((key) => !['id', 'title', 'summary', 'kind', 'listed', 'capabilities', 'client', 'spec'].includes(key))
  if (extra.length > 0) throw new Error(`apps catalog ${row.id} has unknown fields`)
  const spec = parseSpec(row.spec, row.id)
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    kind: /** @type {'official'} */ ('official'),
    listed: row.listed,
    capabilities: [...row.capabilities],
    client: row.client,
    spec,
  }
}

/**
 * @param {unknown} value
 * @param {string} id
 */
function parseSpec(value, id) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`apps catalog ${id} spec must be an object`)
  }
  const spec = /** @type {Record<string, unknown>} */ (value)
  if (spec.source !== 'npm' && spec.source !== 'bundled') {
    throw new Error(`apps catalog ${id} spec.source is invalid`)
  }
  if (typeof spec.name !== 'string' || !PACKAGE_NAME.test(spec.name)) {
    throw new Error(`apps catalog ${id} spec.name is invalid`)
  }
  try {
    assertNpmSpec(spec.name)
  } catch {
    throw new Error(`apps catalog ${id} spec.name is invalid`)
  }
  if (FORBIDDEN_APP_NAMES.includes(spec.name)) {
    throw new Error(`apps catalog ${id} spec.name is reserved`)
  }
  const extra = Object.keys(spec).filter((key) => !['source', 'name', 'version'].includes(key))
  if (extra.length > 0) throw new Error(`apps catalog ${id} spec has unknown fields`)
  /** @type {{ source: 'npm' | 'bundled', name: string, version?: string }} */
  const out = { source: spec.source, name: spec.name }
  if (spec.source === 'npm') {
    if (typeof spec.version !== 'string' || !PINNED.test(spec.version)) {
      throw new Error(`apps catalog ${id} spec.version must be pinned`)
    }
    out.version = spec.version
  } else if (spec.version != null) {
    throw new Error(`apps catalog ${id} bundled spec cannot pin a version`)
  }
  return out
}
