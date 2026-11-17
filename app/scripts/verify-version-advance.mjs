#!/usr/bin/env node
/**
 * Reject any CDN publish whose version is not strictly newer than the live one.
 *
 * The distribution bucket is the production update source: `version-stable.json`
 * (and its beta/next siblings) tells every installed client which build is
 * current. Writing a version that is equal to or lower than the live one turns a
 * release into a production downgrade, so the guard is enforced by scripts —
 * both inside `r2-dist-sync.mjs upload` and as an explicit workflow preflight —
 * rather than by an operator reading the manifest.
 *
 * Usage:
 *   node scripts/verify-version-advance.mjs --version 2.0.24
 *   node scripts/verify-version-advance.mjs --version 2.0.24 --channel stable
 *   node scripts/verify-version-advance.mjs --version 2.0.24 --base-url https://dl.omnimux.ai
 */

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

/** Channels the desktop clients can request. */
const CHANNELS = ['stable', 'beta', 'next']
const DEFAULT_BASE_URL = 'https://dl.omnimux.ai'

/**
 * Parse a canonical `x.y.z[-prerelease][+build]` version.
 * @param {string} version
 * @returns {{ major: number, minor: number, patch: number, prerelease: string[] }}
 */
export function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(String(version))
  if (match === null) throw new Error(`not a canonical SemVer version: ${JSON.stringify(version)}`)
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/** Compare one prerelease identifier pair using SemVer precedence rules. */
function compareIdentifier(left, right) {
  const leftNumeric = /^\d+$/u.test(left)
  const rightNumeric = /^\d+$/u.test(right)
  if (leftNumeric && rightNumeric) return Number(left) - Number(right)
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Compare two canonical versions. Returns <0, 0, or >0 like a sort comparator.
 * Build metadata is ignored, as SemVer requires.
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] - b[key]
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  // A version without a prerelease has higher precedence than any prerelease.
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const compared = compareIdentifier(leftPart, rightPart)
    if (compared !== 0) return compared
  }
  return 0
}

/**
 * Resolve the update channel from a version's prerelease tag.
 * @param {string} version
 * @returns {'stable' | 'beta' | 'next'}
 */
export function channelForVersion(version) {
  const { prerelease } = parseVersion(version)
  if (prerelease.length === 0) return 'stable'
  const tag = prerelease.join('.')
  if (tag === 'beta') return 'beta'
  if (tag === 'next') return 'next'
  throw new Error(`${version} does not belong to the stable, beta, or next channel`)
}

/**
 * Throw unless `candidate` is strictly newer than `live`.
 * @param {string} candidate Version about to be published.
 * @param {string} live Version currently served by the CDN.
 */
export function assertVersionAdvances(candidate, live) {
  const comparison = compareVersions(candidate, live)
  if (comparison <= 0) {
    throw new Error(
      `CDN version must advance: refusing to publish ${candidate} because the live version is ${live} (equal or older versions would be a production downgrade)`,
    )
  }
  return { candidate, live, comparison }
}

/**
 * Fetch the live channel manifest, tolerating only a genuine 404 (first publish).
 * Any other failure is closed: a network error must never be read as "no live version".
 * @param {{ channel: string, baseUrl?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 * @returns {Promise<string | null>}
 */
export async function fetchLiveVersion({ channel, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch, timeoutMs = 20_000 }) {
  if (!CHANNELS.includes(channel)) throw new Error(`unknown channel ${JSON.stringify(channel)}; use stable, beta, or next`)
  const url = `${baseUrl.replace(/\/$/u, '')}/api/desktop/version-${channel}.json?verify=${String(Date.now())}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetchImpl(url, {
      headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${String(response.status)} ${response.statusText}`)
  let manifest
  try {
    manifest = await response.json()
  } catch (cause) {
    throw new Error(`GET ${url} returned invalid JSON`, { cause })
  }
  if (typeof manifest?.version !== 'string' || manifest.version.length === 0) {
    throw new Error(`GET ${url} is missing a version field`)
  }
  if (manifest.channel !== undefined && manifest.channel !== channel) {
    throw new Error(`GET ${url} reports channel ${String(manifest.channel)}, expected ${channel}`)
  }
  // Validate the live value now so a malformed manifest fails closed instead of
  // making every future comparison look like "unknown".
  parseVersion(manifest.version)
  return manifest.version
}

/**
 * Enforce the advance rule against the live CDN manifest of the version's channel.
 * @param {{ version: string, channel?: string, baseUrl?: string, fetchImpl?: typeof fetch, log?: (message: string) => void }} options
 */
export async function assertRemoteVersionAdvances({ version, channel, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch, log = console.log }) {
  const resolvedChannel = channel ?? channelForVersion(version)
  const live = await fetchLiveVersion({ channel: resolvedChannel, baseUrl, fetchImpl })
  if (live === null) {
    log(`CDN version guard: no live ${resolvedChannel} manifest yet; allowing first publish ${version}`)
    return { candidate: version, live: null }
  }
  assertVersionAdvances(version, live)
  log(`CDN version guard passed: live ${resolvedChannel} ${live} < candidate ${version}`)
  return { candidate: version, live }
}

function parseArgs(argv) {
  const value = flag => {
    const index = argv.indexOf(flag)
    return index === -1 ? undefined : argv[index + 1]
  }
  return {
    version: value('--version'),
    channel: value('--channel'),
    baseUrl: value('--base-url') ?? process.env.OMNIMUX_DIST_BASE_URL ?? DEFAULT_BASE_URL,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.version) throw new Error('--version is required')
  const channel = args.channel ?? channelForVersion(args.version)
  await assertRemoteVersionAdvances({ version: args.version, channel, baseUrl: args.baseUrl })
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
