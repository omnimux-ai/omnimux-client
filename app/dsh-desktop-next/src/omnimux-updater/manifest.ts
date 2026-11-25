/** Manifest v2 fetching, Ed25519 verification, rollout evaluation, and safe v1 migration fallback. */

import { createHash } from 'node:crypto'
import {
  OMNIMUX_ALLOWED_UPDATE_HOSTS,
  OMNIMUX_DOWNLOAD_URL,
  OMNIMUX_RELEASES_URL,
  OMNIMUX_UPDATE_MANIFEST_BASE,
  OMNIMUX_UPDATE_VERIFICATION_KEYS,
} from '../product-identity.ts'
import type { UpdateArch } from '../update-arch.ts'
import { compareDottedOsVersion, compareSemVer, isChannelCompatibleVersion, parseCanonicalSemVer } from './semver.ts'
import { verifyManifestSignature } from './signature.ts'
import type {
  OmniMuxArtifactEntry,
  OmniMuxArtifactTarget,
  OmniMuxManifestV2,
  OmniMuxReleaseNotes,
  OmniMuxUpdateChannel,
  OmniMuxUpdateErrorCode,
  ResolvedUpdateCheck,
  UpdateHttpRequest,
} from './types.ts'

export const MAX_MANIFEST_BYTES = 64 * 1024
export const MAX_SIGNATURE_BYTES = 4 * 1024
export const LEGACY_V1_ENDPOINT_BASE = 'https://dl.omnimux.ai/api/desktop'

export class OmniMuxUpdateError extends Error {
  readonly code: OmniMuxUpdateErrorCode
  readonly detail: string | undefined

  constructor(
    code: OmniMuxUpdateErrorCode,
    message: string,
    options: { readonly detail?: string; readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'OmniMuxUpdateError'
    this.code = code
    this.detail = options.detail
  }
}

export function selectArtifactTarget(platform: string, arch?: UpdateArch): OmniMuxArtifactTarget | undefined {
  if (platform === 'darwin') {
    if (arch === 'x64') return 'darwin-x64'
    return 'darwin-arm64'
  }
  if (platform === 'win32') return 'win32-x64'
  return undefined
}

/** Validate an HTTPS URL (default port 443, no credentials), optionally enforcing an exact hostname allowlist. */
export function assertSecureHttpsUrl(rawUrl: string, allowedHosts?: readonly string[]): URL {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new OmniMuxUpdateError('MANIFEST_INVALID', 'Invalid HTTPS update URL')
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== ''
    || (parsed.port !== '' && parsed.port !== '443')) {
    throw new OmniMuxUpdateError('MANIFEST_INVALID', 'Update URL must use standard HTTPS without credentials')
  }
  if (allowedHosts !== undefined && !allowedHosts.includes(parsed.hostname)) {
    throw new OmniMuxUpdateError('MANIFEST_INVALID', `Update URL host ${parsed.hostname} is not in allowlist`)
  }
  return parsed
}

/** Deterministic 0..99 rollout bucket derived from pseudonymous installation ID and release salt. */
export function rolloutBucket(installationId: string, salt: string): number {
  const digest = createHash('sha256').update(`${installationId}:${salt}`).digest()
  return digest.readUInt32BE(0) % 100
}

async function readLimitedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = response.headers.get('content-length')
  if (declared !== null && /^[0-9]+$/u.test(declared) && BigInt(declared) > BigInt(maxBytes)) {
    throw new OmniMuxUpdateError('MANIFEST_INVALID', 'Update response exceeds maximum allowed size')
  }
  if (response.body === null) return new Uint8Array(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const step = await reader.read()
      if (step.done) break
      total += step.value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new OmniMuxUpdateError('MANIFEST_INVALID', 'Update response exceeds maximum allowed size')
      }
      chunks.push(step.value)
    }
  } finally {
    reader.releaseLock()
  }
  const combined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return combined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseNotes(value: unknown): OmniMuxReleaseNotes {
  if (!isRecord(value)) return { zh: [], en: [] }
  const clean = (list: unknown): string[] =>
    Array.isArray(list)
      ? list.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map(item => item.trim().slice(0, 280)).slice(0, 12)
      : []
  return { zh: clean(value.zh), en: clean(value.en) }
}

function parseArtifactEntry(value: unknown, allowedHosts: readonly string[]): OmniMuxArtifactEntry | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.url !== 'string' || typeof value.sha256 !== 'string') return undefined
  assertSecureHttpsUrl(value.url, allowedHosts)
  const sha256 = value.sha256.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/u.test(sha256)) return undefined
  if (typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size <= 0) return undefined
  const minOsVersion = typeof value.minOsVersion === 'string' && value.minOsVersion.trim().length > 0
    ? value.minOsVersion.trim()
    : undefined
  return { url: value.url, sha256, size: value.size, ...(minOsVersion === undefined ? {} : { minOsVersion }) }
}

export function parseManifestV2(
  rawText: string,
  expectedChannel: OmniMuxUpdateChannel,
  allowedHosts: readonly string[] = OMNIMUX_ALLOWED_UPDATE_HOSTS,
): OmniMuxManifestV2 {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch (cause) {
    throw new OmniMuxUpdateError('MANIFEST_INVALID', 'Manifest JSON is malformed', { cause })
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 2 || parsed.product !== 'omnimux') {
    throw new OmniMuxUpdateError('MANIFEST_INVALID', 'Manifest does not match OmniMux schemaVersion 2')
  }
  if (parsed.channel !== expectedChannel) {
    throw new OmniMuxUpdateError('CHANNEL_MISMATCH', `Manifest channel ${String(parsed.channel)} does not match ${expectedChannel}`)
  }
  if (typeof parsed.version !== 'string' || !isChannelCompatibleVersion(parsed.version, expectedChannel)) {
    throw new OmniMuxUpdateError('MANIFEST_INVALID', `Manifest version ${String(parsed.version)} is invalid for ${expectedChannel}`)
  }
  if (typeof parsed.publishedAt !== 'string' || Number.isNaN(Date.parse(parsed.publishedAt))) {
    throw new OmniMuxUpdateError('MANIFEST_INVALID', 'Manifest publishedAt is invalid')
  }
  const urgency = parsed.urgency === 'critical' ? 'critical' : parsed.urgency === 'normal' ? 'normal' : undefined
  if (urgency === undefined) {
    throw new OmniMuxUpdateError('MANIFEST_INVALID', `Unsupported manifest urgency ${String(parsed.urgency)}`)
  }
  let minSupportedVersion: string | undefined
  if (parsed.minSupportedVersion !== undefined) {
    if (typeof parsed.minSupportedVersion !== 'string' || parseCanonicalSemVer(parsed.minSupportedVersion) === null) {
      throw new OmniMuxUpdateError('MANIFEST_INVALID', 'Manifest minSupportedVersion is not valid SemVer')
    }
    minSupportedVersion = parsed.minSupportedVersion
  }
  let percentage = 100
  let salt = `${parsed.version}-${expectedChannel}`
  if (isRecord(parsed.rollout)) {
    if (typeof parsed.rollout.percentage !== 'number' || !Number.isInteger(parsed.rollout.percentage)
      || parsed.rollout.percentage < 0 || parsed.rollout.percentage > 100) {
      throw new OmniMuxUpdateError('MANIFEST_INVALID', 'Manifest rollout.percentage must be 0..100')
    }
    percentage = parsed.rollout.percentage
    if (typeof parsed.rollout.salt === 'string' && parsed.rollout.salt.trim().length > 0) {
      salt = parsed.rollout.salt.trim()
    }
  }
  let releaseNotesUrl = `${OMNIMUX_RELEASES_URL}/tag/v${encodeURIComponent(parsed.version)}`
  if (typeof parsed.releaseNotesUrl === 'string' && parsed.releaseNotesUrl.trim().length > 0) {
    releaseNotesUrl = assertSecureHttpsUrl(parsed.releaseNotesUrl.trim()).href
  }
  if (!isRecord(parsed.artifacts)) {
    throw new OmniMuxUpdateError('MANIFEST_INVALID', 'Manifest artifacts object is missing')
  }
  const artifacts: Partial<Record<OmniMuxArtifactTarget, OmniMuxArtifactEntry>> = {}
  for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64'] as const) {
    if (parsed.artifacts[target] === undefined) continue
    const entry = parseArtifactEntry(parsed.artifacts[target], allowedHosts)
    if (entry === undefined) {
      throw new OmniMuxUpdateError('MANIFEST_INVALID', `Manifest artifact ${target} is malformed`)
    }
    artifacts[target] = entry
  }
  return {
    schemaVersion: 2,
    product: 'omnimux',
    channel: expectedChannel,
    version: parsed.version,
    publishedAt: parsed.publishedAt,
    ...(typeof parsed.dshVersion === 'string' ? { dshVersion: parsed.dshVersion } : {}),
    ...(minSupportedVersion === undefined ? {} : { minSupportedVersion }),
    urgency,
    rollout: { percentage, salt },
    releaseNotesUrl,
    notes: parseNotes(parsed.notes),
    artifacts,
  }
}

export interface CheckOmniMuxManifestOptions {
  readonly currentVersion: string
  readonly channel: OmniMuxUpdateChannel
  readonly platform: string
  readonly arch?: UpdateArch
  readonly osVersion?: string
  readonly installationId?: string
  readonly manual: boolean
  readonly request: UpdateHttpRequest
  readonly signal?: AbortSignal
  readonly manifestBaseUrl?: string
  readonly legacyBaseUrl?: string
  readonly downloadBaseUrl?: string
  readonly allowedHosts?: readonly string[]
  readonly publicKeys?: Readonly<Record<string, string>>
  readonly requireSignature?: boolean
}

function requestHeaders(currentVersion: string, channel: OmniMuxUpdateChannel, installationId?: string): Record<string, string> {
  return {
    Accept: 'application/json',
    'X-OmniMux-Version': currentVersion,
    'X-OmniMux-Channel': channel,
    ...(installationId === undefined ? {} : { 'X-OmniMux-Installation-Id': installationId }),
  }
}

async function safeFetch(request: UpdateHttpRequest, url: string, init: RequestInit): Promise<Response> {
  try {
    return await request(url, init)
  } catch (cause) {
    if (init.signal?.aborted === true) {
      throw new OmniMuxUpdateError('DOWNLOAD_ABORTED', 'Update check was cancelled', { cause })
    }
    throw new OmniMuxUpdateError('OFFLINE', 'Unable to reach OmniMux update service', { cause })
  }
}

function buildLegacyFallbackArtifact(
  version: string,
  target: OmniMuxArtifactTarget | undefined,
  sha256Map: Record<string, unknown>,
  downloadBaseUrl: string,
): OmniMuxArtifactEntry | undefined {
  if (target === undefined) return undefined
  const origin = downloadBaseUrl.replace(/\/$/u, '')
  const map: Record<OmniMuxArtifactTarget, { key: string; file: string }> = {
    'darwin-arm64': { key: 'macArm64', file: `OmniMux-${version}-arm64.dmg` },
    'darwin-x64': { key: 'macX64', file: `OmniMux-${version}-x64.dmg` },
    'win32-x64': { key: 'windows', file: `OmniMux-${version}-x64-Setup.exe` },
  }
  const spec = map[target]
  const raw = sha256Map[spec.key]
  const sha = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/u.test(sha)) return undefined
  return {
    url: `${origin}/releases/v${version}/${spec.file}`,
    sha256: sha,
    // Legacy v1 omits file size; size check is skipped when size === 0.
    size: 0,
  }
}

/**
 * Fetch, verify, and evaluate the OmniMux desktop update manifest.
 *
 * Security invariant: once `publicKeys` is non-empty (or `requireSignature` is true),
 * Ed25519 signature verification is strictly required and legacy unsigned v1 fallback
 * is disabled to prevent downgrade attacks.
 */
export async function checkOmniMuxManifest(options: CheckOmniMuxManifestOptions): Promise<ResolvedUpdateCheck> {
  const current = parseCanonicalSemVer(options.currentVersion)
  if (current === null) {
    throw new OmniMuxUpdateError('MANIFEST_INVALID', `Installed version ${options.currentVersion} is not valid SemVer`)
  }
  const manifestBase = (options.manifestBaseUrl ?? OMNIMUX_UPDATE_MANIFEST_BASE).replace(/\/$/u, '')
  const legacyBase = (options.legacyBaseUrl ?? LEGACY_V1_ENDPOINT_BASE).replace(/\/$/u, '')
  const downloadBase = (options.downloadBaseUrl ?? OMNIMUX_DOWNLOAD_URL).replace(/\/$/u, '')
  const allowedHosts = options.allowedHosts ?? OMNIMUX_ALLOWED_UPDATE_HOSTS
  const publicKeys = options.publicKeys ?? OMNIMUX_UPDATE_VERIFICATION_KEYS
  const hasTrustKeys = Object.keys(publicKeys).length > 0
  const enforceSignature = options.requireSignature === true || hasTrustKeys

  const headers = requestHeaders(current.version, options.channel, options.installationId)
  const init: RequestInit = {
    method: 'GET',
    headers,
    cache: 'no-store',
    redirect: 'error',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }

  const v2Url = `${manifestBase}/${options.channel}.json`
  const v2Res = await safeFetch(options.request, v2Url, init)

  // Transitional 404 fallback to legacy v1 ONLY before Ed25519 keys are provisioned.
  if (v2Res.status === 404 && !enforceSignature) {
    await v2Res.body?.cancel().catch(() => undefined)
    const v1Url = `${legacyBase}/version-${options.channel}.json`
    const v1Res = await safeFetch(options.request, v1Url, init)
    if (v1Res.status !== 200) {
      await v1Res.body?.cancel().catch(() => undefined)
      throw new OmniMuxUpdateError('HTTP_ERROR', `Legacy update endpoint returned HTTP ${String(v1Res.status)}`, { detail: `HTTP ${String(v1Res.status)}` })
    }
    const rawV1 = await readLimitedBytes(v1Res, MAX_MANIFEST_BYTES)
    let parsedV1: unknown
    try {
      parsedV1 = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawV1))
    } catch (cause) {
      throw new OmniMuxUpdateError('MANIFEST_INVALID', 'Legacy manifest JSON is malformed', { cause })
    }
    if (!isRecord(parsedV1) || typeof parsedV1.version !== 'string' || !isChannelCompatibleVersion(parsedV1.version, options.channel)) {
      throw new OmniMuxUpdateError('MANIFEST_INVALID', 'Legacy manifest version is invalid')
    }
    if (parsedV1.channel !== undefined && parsedV1.channel !== options.channel) {
      throw new OmniMuxUpdateError('CHANNEL_MISMATCH', 'Legacy manifest channel mismatch')
    }
    const cmp = compareSemVer(parsedV1.version, current.version)
    if (cmp === null) throw new OmniMuxUpdateError('MANIFEST_INVALID', 'Cannot compare SemVer')
    const target = selectArtifactTarget(options.platform, options.arch)
    const artifact = isRecord(parsedV1.sha256)
      ? buildLegacyFallbackArtifact(parsedV1.version, target, parsedV1.sha256, downloadBase)
      : undefined
    return {
      status: cmp > 0 ? 'update-available' : 'up-to-date',
      source: 'v1-legacy',
      currentVersion: current.version,
      latestVersion: parsedV1.version,
      channel: options.channel,
      mandatory: false,
      releaseNotesUrl: `${OMNIMUX_RELEASES_URL}/tag/v${encodeURIComponent(parsedV1.version)}`,
      notes: { zh: [], en: [] },
      ...(artifact === undefined ? {} : { artifact }),
      ...(target === undefined ? {} : { target }),
    }
  }

  if (v2Res.status !== 200) {
    await v2Res.body?.cancel().catch(() => undefined)
    throw new OmniMuxUpdateError('HTTP_ERROR', `Update manifest returned HTTP ${String(v2Res.status)}`, { detail: `HTTP ${String(v2Res.status)}` })
  }

  const rawManifest = await readLimitedBytes(v2Res, MAX_MANIFEST_BYTES)

  if (enforceSignature) {
    if (!hasTrustKeys) {
      throw new OmniMuxUpdateError('SIGNATURE_INVALID', 'No Ed25519 verification keys are configured', { detail: 'missing-public-keys' })
    }
    const sigUrl = `${v2Url}.sig`
    const sigRes = await safeFetch(options.request, sigUrl, init)
    if (sigRes.status !== 200) {
      await sigRes.body?.cancel().catch(() => undefined)
      throw new OmniMuxUpdateError('SIGNATURE_INVALID', `Manifest signature returned HTTP ${String(sigRes.status)}`, { detail: `sig HTTP ${String(sigRes.status)}` })
    }
    const rawSig = await readLimitedBytes(sigRes, MAX_SIGNATURE_BYTES)
    let envelope: unknown
    try {
      envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawSig))
    } catch (cause) {
      throw new OmniMuxUpdateError('SIGNATURE_INVALID', 'Manifest signature envelope is malformed JSON', { cause })
    }
    const verdict = verifyManifestSignature(rawManifest, envelope, publicKeys)
    if (!verdict.ok) {
      throw new OmniMuxUpdateError('SIGNATURE_INVALID', `Manifest signature rejected: ${verdict.reason}`, { detail: verdict.reason })
    }
  }

  let manifestText: string
  try {
    manifestText = new TextDecoder('utf-8', { fatal: true }).decode(rawManifest)
  } catch (cause) {
    throw new OmniMuxUpdateError('MANIFEST_INVALID', 'Manifest body is not valid UTF-8', { cause })
  }
  const manifest = parseManifestV2(manifestText, options.channel, allowedHosts)
  const comparison = compareSemVer(manifest.version, current.version)
  if (comparison === null) {
    throw new OmniMuxUpdateError('MANIFEST_INVALID', 'Failed to compare SemVer versions')
  }

  const target = selectArtifactTarget(options.platform, options.arch)
  const artifact = target === undefined ? undefined : manifest.artifacts[target]
  const isNewer = comparison > 0

  if (isNewer && target !== undefined && artifact === undefined) {
    throw new OmniMuxUpdateError('MANIFEST_INVALID', `Manifest omits artifact for ${target}`, { detail: target })
  }

  if (isNewer && artifact?.minOsVersion !== undefined && options.osVersion !== undefined) {
    const osCmp = compareDottedOsVersion(options.osVersion, artifact.minOsVersion)
    if (osCmp !== null && osCmp < 0) {
      throw new OmniMuxUpdateError(
        'UNSUPPORTED_OS',
        `Update ${manifest.version} requires OS ${artifact.minOsVersion} or newer`,
        { detail: artifact.minOsVersion },
      )
    }
  }

  const belowFloor = manifest.minSupportedVersion !== undefined
    && (compareSemVer(current.version, manifest.minSupportedVersion) ?? 0) < 0
  const mandatory = isNewer && (belowFloor || manifest.urgency === 'critical')

  // Background non-mandatory checks obey deterministic percentage rollout.
  if (isNewer && !options.manual && !mandatory && manifest.rollout.percentage < 100) {
    const enrolled = options.installationId !== undefined
      && rolloutBucket(options.installationId, manifest.rollout.salt) < manifest.rollout.percentage
    if (!enrolled) {
      return {
        status: 'up-to-date',
        source: 'v2',
        currentVersion: current.version,
        latestVersion: manifest.version,
        channel: manifest.channel,
        mandatory: false,
        ...(manifest.minSupportedVersion === undefined ? {} : { minSupportedVersion: manifest.minSupportedVersion }),
        releaseNotesUrl: manifest.releaseNotesUrl,
        notes: manifest.notes,
        ...(artifact === undefined ? {} : { artifact }),
        ...(target === undefined ? {} : { target }),
        deferredByRollout: true,
      }
    }
  }

  return {
    status: isNewer ? 'update-available' : 'up-to-date',
    source: 'v2',
    currentVersion: current.version,
    latestVersion: manifest.version,
    channel: manifest.channel,
    mandatory,
    ...(manifest.minSupportedVersion === undefined ? {} : { minSupportedVersion: manifest.minSupportedVersion }),
    releaseNotesUrl: manifest.releaseNotesUrl,
    notes: manifest.notes,
    ...(artifact === undefined ? {} : { artifact }),
    ...(target === undefined ? {} : { target }),
  }
}
