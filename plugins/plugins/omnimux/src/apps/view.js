/** Build the browser-safe Apps shelf view from a catalog document. */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readProfilePlugins } from '../plugins/manage.js'
import { FORBIDDEN_APP_NAMES } from './parse.js'

/**
 * @param {string} name
 */
export function packageDirSegments(name) {
  return name.split('/')
}

/**
 * @param {string} home
 * @param {string} profile
 * @param {string} name
 */
export function installedPackageJsonPath(home, profile, name) {
  return join(home, 'profiles', profile, 'node_modules', ...packageDirSegments(name), 'package.json')
}

/**
 * @param {string} home
 * @param {string} profile
 * @param {string} name
 * @param {(path: string, encoding: 'utf8') => string} [readFile]
 */
export function readInstalledVersion(home, profile, name, readFile = readFileSync) {
  try {
    const raw = readFile(installedPackageJsonPath(home, profile, name), 'utf8')
    const manifest = JSON.parse(raw)
    return typeof manifest?.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

/**
 * @param {{
 *   source: 'npm' | 'bundled',
 *   version?: string,
 * }} spec
 * @param {boolean} present
 * @param {string | undefined} installed
 */
export function resolveAppState(spec, present, installed) {
  if (!present) return 'available'
  if (spec.source === 'bundled') {
    if (installed === undefined && spec.version != null) return 'available'
    if (installed !== undefined && spec.version != null && installed !== spec.version) return 'update'
    return 'installed'
  }
  return installed === spec.version ? 'installed' : 'update'
}

/**
 * Pinned install argument for `/omnimux/plugins`. Never a range or URL.
 * @param {{ source: 'npm' | 'bundled', name: string, version?: string }} spec
 */
export function installSpec(spec) {
  if (spec.source === 'npm') return `${spec.name}@${spec.version}`
  return spec.name
}

/**
 * @param {{
 *   catalog: {
 *     schema: 1,
 *     generated_at: string,
 *     min_hub: string,
 *     apps: Array<{
 *       id: string,
 *       title: string,
 *       summary: string,
 *       kind: 'official',
 *       listed: boolean,
 *       capabilities: string[],
 *       client: boolean,
 *       spec: { source: 'npm' | 'bundled', name: string, version?: string },
 *     }>,
 *   },
 *   source?: 'bundled' | 'cache' | 'remote',
 *   stale?: boolean,
 *   fetched_at?: string | null,
 *   refresh?: 'idle' | 'running' | 'failed',
 *   error?: string | null,
 *   bundles?: string[],
 *   versions?: Record<string, string | undefined>,
 * }} input
 */
export function buildAppsView(input) {
  const bundles = new Set(input.bundles ?? [])
  const versions = input.versions ?? {}
  const apps = []
  for (const app of input.catalog.apps) {
    if (!app.listed || !app.client) continue
    if (FORBIDDEN_APP_NAMES.includes(app.id) || FORBIDDEN_APP_NAMES.includes(app.spec.name)) continue
    apps.push({
      id: app.id,
      title: app.title,
      summary: app.summary,
      kind: app.kind,
      capabilities: [...app.capabilities],
      client: app.client,
      spec: { ...app.spec },
      state: resolveAppState(app.spec, bundles.has(app.spec.name), versions[app.spec.name]),
      install_spec: installSpec(app.spec),
    })
  }
  return {
    schema: 1,
    source: input.source ?? 'bundled',
    stale: input.stale === true,
    fetched_at: input.fetched_at ?? null,
    refresh: input.refresh ?? 'idle',
    error: input.error ?? null,
    apps,
  }
}

/**
 * @param {{
 *   catalog: Parameters<typeof buildAppsView>[0]['catalog'],
 *   home: string,
 *   profile: string,
 *   env?: NodeJS.ProcessEnv,
 *   source?: 'bundled' | 'cache' | 'remote',
 *   stale?: boolean,
 *   fetched_at?: string | null,
 *   refresh?: 'idle' | 'running' | 'failed',
 *   error?: string | null,
 *   readBundles?: (profile: string, env?: NodeJS.ProcessEnv) => Array<{ name: string }>,
 *   readVersion?: (home: string, profile: string, name: string) => string | undefined,
 * }} opts
 */
export function buildInstalledAppsView(opts) {
  const home = opts.home || process.env.DSH_HOME || join(homedir(), '.dsh')
  const readBundles = opts.readBundles ?? readProfilePlugins
  const readVersion = opts.readVersion ?? readInstalledVersion
  let bundles = []
  try {
    bundles = readBundles(opts.profile, opts.env).map((row) => row.name)
  } catch {
    bundles = []
  }
  /** @type {Record<string, string | undefined>} */
  const versions = {}
  for (const name of bundles) {
    versions[name] = readVersion(home, opts.profile, name)
  }
  return buildAppsView({
    catalog: opts.catalog,
    source: opts.source,
    stale: opts.stale,
    fetched_at: opts.fetched_at,
    refresh: opts.refresh,
    error: opts.error,
    bundles,
    versions,
  })
}
