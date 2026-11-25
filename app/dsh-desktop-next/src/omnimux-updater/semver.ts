/** Strict overflow-safe SemVer and dotted OS version comparison. */

export interface ParsedSemVer {
  readonly version: string
  readonly major: string
  readonly minor: string
  readonly patch: string
  readonly prerelease: readonly string[]
  readonly build: readonly string[]
}

const SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u

function isNumeric(identifier: string): boolean {
  return /^[0-9]+$/u.test(identifier)
}

function hasLeadingZero(identifier: string): boolean {
  return identifier.length > 1 && identifier.startsWith('0')
}

function compareNumeric(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

export function parseSemVer(input: string): ParsedSemVer | null {
  const version = input.startsWith('v') ? input.slice(1) : input
  const match = SEMVER_PATTERN.exec(version)
  if (match === null) return null
  const prerelease = match[4]?.split('.') ?? []
  if (prerelease.some(identifier => isNumeric(identifier) && hasLeadingZero(identifier))) return null
  return {
    version,
    major: match[1]!,
    minor: match[2]!,
    patch: match[3]!,
    prerelease,
    build: match[5]?.split('.') ?? [],
  }
}

export function parseCanonicalSemVer(input: string): ParsedSemVer | null {
  const parsed = parseSemVer(input)
  return parsed !== null && parsed.version === input ? parsed : null
}

export function compareParsedSemVer(left: ParsedSemVer, right: ParsedSemVer): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    const cmp = compareNumeric(left[key], right[key])
    if (cmp !== 0) return cmp
  }
  if (left.prerelease.length === 0) return right.prerelease.length === 0 ? 0 : 1
  if (right.prerelease.length === 0) return -1
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const a = left.prerelease[index]
    const b = right.prerelease[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (a === b) continue
    const aNum = isNumeric(a)
    const bNum = isNumeric(b)
    if (aNum && bNum) return compareNumeric(a, b)
    if (aNum) return -1
    if (bNum) return 1
    return a < b ? -1 : 1
  }
  return 0
}

export function compareSemVer(left: string, right: string): number | null {
  const a = parseSemVer(left)
  const b = parseSemVer(right)
  if (a === null || b === null) return null
  return compareParsedSemVer(a, b)
}

/**
 * Validate that a version string matches the allowed release shape for one channel.
 * - `stable`: plain `x.y.z` (no prerelease)
 * - `beta`: `x.y.z-beta` or `x.y.z-beta.<n>`, or a plain `x.y.z` promoted to beta
 */
export function isChannelCompatibleVersion(input: string, channel: 'stable' | 'beta'): boolean {
  const parsed = parseCanonicalSemVer(input)
  if (parsed === null) return false
  if (channel === 'stable') return parsed.prerelease.length === 0
  if (parsed.prerelease.length === 0) return true
  return parsed.prerelease[0] === 'beta'
    && (parsed.prerelease.length === 1 || (parsed.prerelease.length === 2 && isNumeric(parsed.prerelease[1]!)))
}

/**
 * Compare dotted numeric OS versions (e.g. macOS "14.5" vs "13.0", Windows "10.0.22621" vs "10.0.19041").
 * Returns null if either version cannot be parsed as dotted integers.
 */
export function compareDottedOsVersion(current: string, minimum: string): number | null {
  const parse = (value: string): string[] | null => {
    const trimmed = value.trim()
    if (!/^[0-9]+(?:\.[0-9]+)*$/u.test(trimmed)) return null
    return trimmed.split('.').map(part => part.replace(/^0+(?=[0-9])/u, ''))
  }
  const left = parse(current)
  const right = parse(minimum)
  if (left === null || right === null) return null
  const len = Math.max(left.length, right.length)
  for (let index = 0; index < len; index += 1) {
    const cmp = compareNumeric(left[index] ?? '0', right[index] ?? '0')
    if (cmp !== 0) return cmp
  }
  return 0
}
