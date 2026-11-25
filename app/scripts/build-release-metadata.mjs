#!/usr/bin/env node
/**
 * Generate the static release metadata the desktop updaters poll.
 *
 * Dual-writes both:
 *   1. Legacy v1 manifest: `api/desktop/version-<channel>.json`
 *      Kept for backward compatibility with older desktop shells (`<= 2.0.18`).
 *   2. OmniMux v2 manifest: `api/desktop/v2/<channel>.json` (+ optional `.sig`)
 *      Consumed by the OmniMux updater with immutable versioned artifact URLs,
 *      byte sizes, SHA-256 digests, OS floors, rollout percentage, mandatory
 *      version floor, in-app release notes, and Ed25519 signature envelope.
 *
 * Usage:
 *   node scripts/build-release-metadata.mjs --version 2.0.26 --dir ./release-assets
 *   node scripts/build-release-metadata.mjs --version 2.0.26 --dir ./release-assets \
 *     --require-platforms mac-arm64,mac-x64,windows --min-supported-version 2.0.20 --rollout-percentage 100
 *   node scripts/build-release-metadata.mjs --check --version 2.0.26 --dir ./release-assets
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { signManifestBytes } from './sign-release-manifest.mjs'
import { channelForVersion, compareVersions, parseVersion } from './verify-version-advance.mjs'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = resolve(ROOT_DIR, '..')
const DEFAULT_BASE_URL = 'https://dl.omnimux.ai'
const DEFAULT_RELEASES_BASE = 'https://github.com/omnimux-ai/omnimux-client/releases'
const DEFAULT_MAC_MIN_OS = '13.0'
const DEFAULT_WIN_MIN_OS = '10.0.19041'

/** Platform token accepted by --require-platforms and the metadata keys it must populate. */
const PLATFORM_KEYS = {
  'mac-arm64': { v1Key: 'macArm64', v2Key: 'darwin-arm64', minOsVersion: DEFAULT_MAC_MIN_OS },
  'mac-x64': { v1Key: 'macX64', v2Key: 'darwin-x64', minOsVersion: DEFAULT_MAC_MIN_OS },
  windows: { v1Key: 'windows', v2Key: 'win32-x64', minOsVersion: DEFAULT_WIN_MIN_OS },
}

/**
 * A normal publish always writes all three platform hashes. A partial preview
 * may omit platforms, but it must use `--partial` and can never write the live
 * channel manifests.
 */
const PUBLISH_PLATFORMS = ['mac-arm64', 'mac-x64', 'windows']

export function parseArgs(argv) {
  const value = flag => {
    const index = argv.indexOf(flag)
    return index === -1 ? undefined : argv[index + 1]
  }
  const values = flag => {
    const out = []
    for (let index = 0; index < argv.length; index += 1) {
      if (argv[index] === flag && argv[index + 1] !== undefined) out.push(argv[index + 1])
    }
    return out
  }
  return {
    version: value('--version'),
    dir: value('--dir'),
    requirePlatforms: value('--require-platforms'),
    baseUrl: value('--base-url') ?? process.env.OMNIMUX_DIST_BASE_URL ?? DEFAULT_BASE_URL,
    dshVersion: value('--dsh-version'),
    minSupportedVersion: value('--min-supported-version'),
    urgency: value('--urgency') ?? 'normal',
    rolloutPercentage: value('--rollout-percentage'),
    releaseNotesUrl: value('--release-notes-url'),
    notesFile: value('--notes-file'),
    notesZh: values('--notes-zh'),
    notesEn: values('--notes-en'),
    publishedAt: value('--published-at'),
    keyId: value('--key-id') ?? process.env.OMNIMUX_UPDATE_SIGNING_KEY_ID ?? 'k1',
    requireSignature: argv.includes('--require-signature'),
    partial: argv.includes('--partial'),
    check: argv.includes('--check'),
  }
}

function splitPlatforms(value) {
  return (value ?? '').split(',').map(token => token.trim()).filter(Boolean)
}

function assertChannelVersion(version, channel) {
  const resolved = channelForVersion(version)
  if (resolved !== channel) {
    throw new Error(`${version} belongs to channel ${resolved}, not ${channel}`)
  }
}

/** Read default bundled DSH runtime version from repo root dsh-version.json. */
function defaultDshVersion() {
  const path = join(REPO_ROOT, 'dsh-version.json')
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const value = parsed?.dsh?.runtimePackageVersion
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
  } catch {
    return undefined
  }
}

/** Walk a directory recursively so artifacts nested inside subdirectories are found. */
function walkFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(full))
    else if (entry.isFile()) out.push({ name: entry.name, path: full })
  }
  return out
}

/** Pick the installer for one platform and hash it. */
function digestFor(dir, patterns) {
  const files = walkFiles(dir)
  for (const pattern of patterns) {
    const hit = files.find(file => pattern.test(file.name))
    if (hit) {
      return {
        name: hit.name,
        sha256: createHash('sha256').update(readFileSync(hit.path)).digest('hex'),
        bytes: statSync(hit.path).size,
      }
    }
  }
  return undefined
}

function assertArtifactVersion(label, artifact, version) {
  if (artifact !== undefined && !artifact.name.includes(`-${version}-`)) {
    throw new Error(`${label} artifact ${artifact.name} does not match release version ${version}`)
  }
}

function normalizeNotesList(items) {
  if (!Array.isArray(items)) return []
  return items
    .flatMap(item => (typeof item === 'string' ? item.split(/\r?\n/u) : []))
    .map(line => line.replace(/^\s*[-*•]\s+/u, '').trim())
    .filter(Boolean)
    .slice(0, 12)
}

/**
 * Parse a JSON `{ zh, en }` file or Markdown release body into `{ zh, en }` arrays.
 */
export function parseReleaseNotesInput({ notesFile, notesZh = [], notesEn = [] } = {}) {
  const zh = normalizeNotesList(notesZh)
  const en = normalizeNotesList(notesEn)
  if (notesFile === undefined) return { zh, en }
  const text = readFileSync(resolve(notesFile), 'utf8').trim()
  if (text.length === 0) return { zh, en }
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text)
      return {
        zh: zh.length > 0 ? zh : normalizeNotesList(parsed?.zh),
        en: en.length > 0 ? en : normalizeNotesList(parsed?.en),
      }
    } catch (error) {
      if (notesFile.toLowerCase().endsWith('.json')) throw error
    }
  }
  // Markdown fallback: extract bullet lines; if bilingual headings exist, split them.
  let section = 'both'
  const mdZh = []
  const mdEn = []
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (/^#{1,3}\s+.*(?:中文|更新内容|更新亮点)/iu.test(line)) { section = 'zh'; continue }
    if (/^#{1,3}\s+.*(?:english|highlights|what'?s new|changes)/iu.test(line)) { section = 'en'; continue }
    if (!/^[-*]\s+/u.test(line)) continue
    const bullet = line.replace(/^[-*]\s+/u, '').trim()
    if (!bullet) continue
    if (section === 'zh') mdZh.push(bullet)
    else if (section === 'en') mdEn.push(bullet)
    else {
      if (/[\u4e00-\u9fff]/u.test(bullet)) mdZh.push(bullet)
      else mdEn.push(bullet)
    }
  }
  return {
    zh: zh.length > 0 ? zh : normalizeNotesList(mdZh),
    en: en.length > 0 ? en : normalizeNotesList(mdEn),
  }
}

export function buildMetadata(dir, version, channel, requiredPlatforms = PUBLISH_PLATFORMS) {
  assertChannelVersion(version, channel)
  const macArm64 = digestFor(dir, [/-arm64\.dmg$/u])
  const macX64 = digestFor(dir, [/-x64\.dmg$/u])
  const windows = digestFor(dir, [/-Setup\.exe$/u, /\.exe$/u])
  assertArtifactVersion('mac-arm64', macArm64, version)
  assertArtifactVersion('mac-x64', macX64, version)
  assertArtifactVersion('windows', windows, version)
  const sha256 = {}
  if (macArm64) sha256.macArm64 = macArm64.sha256
  if (macX64) sha256.macX64 = macX64.sha256
  if (windows) sha256.windows = windows.sha256
  const metadata = { version, channel }
  if (Object.keys(sha256).length > 0) metadata.sha256 = sha256

  for (const token of requiredPlatforms) {
    const entry = PLATFORM_KEYS[token]
    if (entry === undefined) throw new Error(`unknown required platform ${JSON.stringify(token)}; use mac-arm64, mac-x64, or windows`)
    if (metadata.sha256?.[entry.v1Key] === undefined) {
      throw new Error(`missing required release artifact: ${token}`)
    }
  }
  return { metadata, macArm64, macX64, windows }
}

/**
 * Build the OmniMux Update Manifest v2 with immutable versioned URLs, byte sizes,
 * OS minimums, rollout policy, mandatory version floor, and in-app release notes.
 */
export function buildManifestV2(dir, {
  version,
  channel,
  requiredPlatforms = PUBLISH_PLATFORMS,
  baseUrl = DEFAULT_BASE_URL,
  dshVersion = defaultDshVersion(),
  minSupportedVersion,
  urgency = 'normal',
  rolloutPercentage = 100,
  releaseNotesUrl,
  notes = { zh: [], en: [] },
  publishedAt = new Date().toISOString(),
}) {
  const built = buildMetadata(dir, version, channel, requiredPlatforms)
  const normalizedBase = baseUrl.replace(/\/$/u, '')
  if (!/^https?:\/\//u.test(normalizedBase)) {
    throw new Error(`invalid baseUrl: ${JSON.stringify(baseUrl)}`)
  }
  if (urgency !== 'normal' && urgency !== 'critical') {
    throw new Error(`invalid urgency ${JSON.stringify(urgency)}; use normal or critical`)
  }
  let percentage
  if (typeof rolloutPercentage === 'number') {
    percentage = rolloutPercentage
  } else if (typeof rolloutPercentage === 'string' && /^\d+$/u.test(rolloutPercentage.trim())) {
    percentage = Number(rolloutPercentage.trim())
  } else {
    percentage = Number.NaN
  }
  if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) {
    throw new Error(`rolloutPercentage must be an integer between 0 and 100 (received ${String(rolloutPercentage)})`)
  }
  if (minSupportedVersion !== undefined && minSupportedVersion !== '') {
    parseVersion(minSupportedVersion)
    if (compareVersions(minSupportedVersion, version) > 0) {
      throw new Error(`minSupportedVersion (${minSupportedVersion}) cannot be newer than release version (${version})`)
    }
  }
  if (Number.isNaN(Date.parse(publishedAt))) {
    throw new Error(`invalid publishedAt timestamp: ${JSON.stringify(publishedAt)}`)
  }

  const artifacts = {}
  const entries = [
    ['darwin-arm64', built.macArm64, `OmniMux-${version}-arm64.dmg`, DEFAULT_MAC_MIN_OS],
    ['darwin-x64', built.macX64, `OmniMux-${version}-x64.dmg`, DEFAULT_MAC_MIN_OS],
    ['win32-x64', built.windows, `OmniMux-${version}-x64-Setup.exe`, DEFAULT_WIN_MIN_OS],
  ]
  for (const [target, artifact, canonicalName, minOsVersion] of entries) {
    if (!artifact) continue
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0) {
      throw new Error(`release artifact ${artifact.name} must be non-empty`)
    }
    artifacts[target] = {
      url: `${normalizedBase}/releases/v${version}/${canonicalName}`,
      sha256: artifact.sha256,
      size: artifact.bytes,
      minOsVersion,
    }
  }

  const manifest = {
    schemaVersion: 2,
    product: 'omnimux',
    channel,
    version,
    publishedAt,
    ...(dshVersion ? { dshVersion } : {}),
    ...(minSupportedVersion ? { minSupportedVersion } : {}),
    urgency,
    rollout: {
      percentage,
      salt: `${version}-${channel}`,
    },
    releaseNotesUrl: releaseNotesUrl || `${DEFAULT_RELEASES_BASE}/tag/v${encodeURIComponent(version)}`,
    notes: {
      zh: normalizeNotesList(notes?.zh),
      en: normalizeNotesList(notes?.en),
    },
    artifacts,
  }

  return { ...built, manifestV2: manifest }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.version) throw new Error('--version is required')
  const dir = args.dir === undefined ? join(ROOT_DIR, 'dist', 'release-download') : resolve(args.dir)
  if (!existsSync(dir)) throw new Error(`release asset directory not found: ${dir}`)

  const channel = channelForVersion(args.version)
  const requestedPlatforms = splitPlatforms(args.requirePlatforms)
  let requiredPlatforms
  if (args.partial) {
    requiredPlatforms = requestedPlatforms
  } else {
    if (
      requestedPlatforms.length > 0
      && (requestedPlatforms.length !== PUBLISH_PLATFORMS.length
        || PUBLISH_PLATFORMS.some(token => !requestedPlatforms.includes(token)))
    ) {
      throw new Error(
        `--require-platforms must name exactly ${PUBLISH_PLATFORMS.join(',')} for a publish build; use --partial for an incomplete preview`,
      )
    }
    requiredPlatforms = PUBLISH_PLATFORMS
  }

  const notes = parseReleaseNotesInput({
    notesFile: args.notesFile,
    notesZh: args.notesZh,
    notesEn: args.notesEn,
  })
  const rolloutPercentage = args.rolloutPercentage === undefined || args.rolloutPercentage.trim() === ''
    ? 100
    : args.rolloutPercentage.trim()
  const outDirV1 = join(dir, 'api', 'desktop')
  const outDirV2 = join(outDirV1, 'v2')
  const suffix = args.partial ? '-partial' : ''
  const v1Path = join(outDirV1, `version-${channel}${suffix}.json`)
  const v2Path = join(outDirV2, `${channel}${suffix}.json`)
  const sigPath = `${v2Path}.sig`

  let existingPublishedAt = args.publishedAt
  if (args.check && existingPublishedAt === undefined && existsSync(v2Path)) {
    try {
      existingPublishedAt = JSON.parse(readFileSync(v2Path, 'utf8')).publishedAt
    } catch { /* fall through to validation error */ }
  }

  const built = buildManifestV2(dir, {
    version: args.version,
    channel,
    requiredPlatforms,
    baseUrl: args.baseUrl,
    dshVersion: args.dshVersion ?? defaultDshVersion(),
    minSupportedVersion: args.minSupportedVersion || undefined,
    urgency: args.urgency,
    rolloutPercentage,
    releaseNotesUrl: args.releaseNotesUrl,
    notes,
    publishedAt: existingPublishedAt ?? new Date().toISOString(),
  })

  const serializedV1 = `${JSON.stringify(built.metadata, null, 2)}\n`
  const serializedV2 = `${JSON.stringify(built.manifestV2, null, 2)}\n`

  if (args.check) {
    if (!existsSync(v1Path)) throw new Error(`missing release metadata: ${v1Path}`)
    if (readFileSync(v1Path, 'utf8') !== serializedV1) throw new Error(`${v1Path} is stale; regenerate it`)
    if (!existsSync(v2Path)) throw new Error(`missing v2 release manifest: ${v2Path}`)
    if (readFileSync(v2Path, 'utf8') !== serializedV2) throw new Error(`${v2Path} is stale; regenerate it`)
    console.log(`release metadata is current: ${channel} ${args.version}`)
    return
  }

  const signingPrivateKey = process.env.OMNIMUX_UPDATE_SIGNING_PRIVATE_KEY
  let signatureEnvelope = null
  if (signingPrivateKey && signingPrivateKey.trim().length > 0) {
    signatureEnvelope = signManifestBytes(Buffer.from(serializedV2, 'utf8'), {
      privateKey: signingPrivateKey,
      keyId: args.keyId,
    })
  } else if (args.requireSignature) {
    throw new Error('OMNIMUX_UPDATE_SIGNING_PRIVATE_KEY is required when --require-signature is set')
  }

  mkdirSync(outDirV2, { recursive: true })
  writeFileSync(v1Path, serializedV1)
  writeFileSync(v2Path, serializedV2)
  if (signatureEnvelope !== null) {
    writeFileSync(sigPath, `${JSON.stringify(signatureEnvelope, null, 2)}\n`)
    console.log(`wrote ${sigPath} (keyId=${signatureEnvelope.keyId})`)
  } else {
    rmSync(sigPath, { force: true })
  }

  const parts = [
    built.macArm64 && `mac-arm64 ${String(built.macArm64.bytes)}B sha256=${built.macArm64.sha256}`,
    built.macX64 && `mac-x64 ${String(built.macX64.bytes)}B sha256=${built.macX64.sha256}`,
    built.windows && `windows ${String(built.windows.bytes)}B sha256=${built.windows.sha256}`,
  ].filter(Boolean).join(', ')
  console.log(`wrote ${v1Path} & ${v2Path}${parts ? ` (${parts})` : ''}`)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) main()
