/**
 * Fail-closed release-channel resolution for OmniMux Desktop Next.
 *
 * A Dev bundle (`OmniMux Dev.app`) must resolve to `.omnimux-dev` / `OmniMux-Dev`
 * even when launched with a scrubbed environment (`env -u ... open -a "OmniMux Dev"`).
 * Channel metadata is bound inside the packaged bundle (`Resources/build-info.json`
 * and macOS `Contents/Info.plist`), and any missing, corrupt, or conflicting Dev
 * metadata fails closed instead of silently falling back to production `~/.omnimux`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  DESKTOP_APP_ID,
  DESKTOP_DEV_APP_ID,
  desktopIdentity,
  type DesktopProductIdentity,
  type DesktopReleaseChannel,
} from './product-identity.ts'

export interface DesktopBuildInfo {
  readonly channel?: unknown
  readonly releaseChannel?: unknown
  readonly product?: unknown
  readonly shell?: unknown
}

export interface MacInfoPlistIdentity {
  readonly bundleIdentifier?: string
  readonly displayName?: string
  readonly omnimuxChannel?: string
}

export interface DesktopIdentityResolutionInput {
  readonly packaged: boolean
  readonly platform: NodeJS.Platform
  readonly execPath: string
  readonly resourcesPath?: string
  readonly env?: Readonly<Record<string, string | undefined>>
}

const DEV_APP_BUNDLE_PATTERN = /(?:^|[/\\])OmniMux[- ]Dev\.app(?:[/\\]|$)/iu

/** Normalize an explicit `OMNIMUX_CHANNEL` value; fail closed on unknown non-empty values. */
export function parseChannelEnvValue(raw: string | undefined, sourceLabel: string): DesktopReleaseChannel | undefined {
  if (raw === undefined) return undefined
  const normalized = raw.trim().toLowerCase()
  if (normalized === '') return undefined
  if (normalized === 'dev' || normalized === 'development') return 'development'
  if (normalized === 'stable' || normalized === 'prod' || normalized === 'production') return 'stable'
  throw new Error(`Invalid ${sourceLabel} value ${JSON.stringify(raw)}; refusing to fall back to production ~/.omnimux`)
}

/** Locate the enclosing macOS `.app` bundle directory from `execPath`, if any. */
export function macAppBundleRoot(execPath: string): string | undefined {
  const normalized = execPath.replaceAll('\\', '/')
  const marker = '/Contents/MacOS/'
  const idx = normalized.indexOf(marker)
  if (idx <= 0) return undefined
  const bundleDir = execPath.slice(0, idx)
  return bundleDir.endsWith('.app') ? bundleDir : undefined
}

function decodeXmlEntities(text: string): string {
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
}

function readPlistStringKey(xml: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = new RegExp(`<key>\\s*${escaped}\\s*</key>\\s*<string>([\\s\\S]*?)</string>`, 'u').exec(xml)
  return match?.[1] === undefined ? undefined : decodeXmlEntities(match[1].trim())
}

/** Extract channel-relevant string keys from an XML macOS `Info.plist`. */
export function parseMacInfoPlistStrings(plistXml: string): MacInfoPlistIdentity {
  if (!plistXml.includes('<plist') || !plistXml.includes('<dict>')) {
    throw new Error('Malformed macOS Info.plist XML')
  }
  const bundleIdentifier = readPlistStringKey(plistXml, 'CFBundleIdentifier')
  const displayName = readPlistStringKey(plistXml, 'CFBundleDisplayName')
  let omnimuxChannel: string | undefined
  const lsEnvMatch = /<key>\s*LSEnvironment\s*<\/key>\s*<dict>([\s\S]*?)<\/dict>/u.exec(plistXml)
  if (lsEnvMatch?.[1] !== undefined) {
    omnimuxChannel = readPlistStringKey(lsEnvMatch[1], 'OMNIMUX_CHANNEL')
  }
  return {
    ...(bundleIdentifier === undefined ? {} : { bundleIdentifier }),
    ...(displayName === undefined ? {} : { displayName }),
    ...(omnimuxChannel === undefined ? {} : { omnimuxChannel }),
  }
}

function readMacInfoPlist(plistPath: string): MacInfoPlistIdentity {
  const raw = readFileSync(plistPath)
  // Binary plists start with "bplist"; convert via macOS plutil when present.
  if (raw.subarray(0, 6).toString('ascii') === 'bplist') {
    const converted = spawnSync('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', plistPath], { encoding: 'utf8' })
    if (converted.status !== 0 || !converted.stdout) {
      throw new Error(`Could not decode binary Info.plist at ${plistPath}`)
    }
    return parseMacInfoPlistStrings(converted.stdout)
  }
  return parseMacInfoPlistStrings(raw.toString('utf8'))
}

function parseBuildInfoChannel(buildInfoPath: string): DesktopReleaseChannel {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(buildInfoPath, 'utf8')) as unknown
  } catch (cause) {
    throw new Error(`Unreadable build-info.json at ${buildInfoPath}: ${String(cause)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid build-info.json at ${buildInfoPath}: expected JSON object`)
  }
  const info = parsed as DesktopBuildInfo
  let explicitReleaseChannel: DesktopReleaseChannel | undefined
  if (info.releaseChannel !== undefined) {
    if (info.releaseChannel !== 'development' && info.releaseChannel !== 'stable') {
      throw new Error(`Invalid releaseChannel ${JSON.stringify(info.releaseChannel)} in ${buildInfoPath}`)
    }
    explicitReleaseChannel = info.releaseChannel
  }
  let buildChannel: DesktopReleaseChannel | undefined
  if (info.channel !== undefined) {
    if (typeof info.channel !== 'string' || info.channel.trim() === '') {
      throw new Error(`Invalid channel ${JSON.stringify(info.channel)} in ${buildInfoPath}`)
    }
    buildChannel = info.channel === 'package-dev' ? 'development' : 'stable'
  }
  if (explicitReleaseChannel !== undefined && buildChannel !== undefined && explicitReleaseChannel !== buildChannel) {
    throw new Error(
      `Conflicting build-info.json metadata at ${buildInfoPath}: channel=${JSON.stringify(info.channel)} vs releaseChannel=${JSON.stringify(info.releaseChannel)}`,
    )
  }
  const resolved = explicitReleaseChannel ?? buildChannel
  if (resolved === undefined) {
    throw new Error(`Missing channel declaration in ${buildInfoPath}`)
  }
  return resolved
}

/**
 * Resolve the active OmniMux product identity before setting `userData` or reading
 * the data directory. Throws (fail-closed) whenever Dev metadata is missing, corrupt,
 * or conflicts across `build-info.json`, `Info.plist`, bundle path, and environment.
 */
export function resolveDesktopIdentity(input: DesktopIdentityResolutionInput): DesktopProductIdentity {
  const env = input.env ?? {}
  const envChannel = parseChannelEnvValue(env.OMNIMUX_CHANNEL, 'OMNIMUX_CHANNEL')
  const envBundleId = env.__CFBundleIdentifier?.trim() || undefined

  if (!input.packaged) {
    if (envChannel === 'development' || envBundleId === DESKTOP_DEV_APP_ID) {
      if (envChannel === 'stable') {
        throw new Error(`Conflicting Dev channel signals: OMNIMUX_CHANNEL=${JSON.stringify(env.OMNIMUX_CHANNEL)} vs __CFBundleIdentifier=${JSON.stringify(envBundleId)}`)
      }
      return desktopIdentity('development')
    }
    return desktopIdentity('stable')
  }

  const signals: Array<{ source: string; channel: DesktopReleaseChannel }> = []
  if (envChannel !== undefined) signals.push({ source: 'OMNIMUX_CHANNEL', channel: envChannel })
  if (envBundleId === DESKTOP_DEV_APP_ID) signals.push({ source: '__CFBundleIdentifier', channel: 'development' })
  else if (envBundleId === DESKTOP_APP_ID) signals.push({ source: '__CFBundleIdentifier', channel: 'stable' })

  const bundleRoot = input.platform === 'darwin' ? macAppBundleRoot(input.execPath) : undefined
  const bundleLooksDev = DEV_APP_BUNDLE_PATTERN.test(input.execPath)
    || (bundleRoot !== undefined && /^OmniMux[- ]Dev\.app$/iu.test(basename(bundleRoot)))
  if (bundleLooksDev) signals.push({ source: 'bundle path', channel: 'development' })

  let plistBundleChannel: DesktopReleaseChannel | undefined
  if (bundleRoot !== undefined) {
    const plistPath = join(bundleRoot, 'Contents', 'Info.plist')
    if (existsSync(plistPath)) {
      const plist = readMacInfoPlist(plistPath)
      if (plist.bundleIdentifier === DESKTOP_DEV_APP_ID) {
        plistBundleChannel = 'development'
        signals.push({ source: 'Info.plist CFBundleIdentifier', channel: 'development' })
      } else if (plist.bundleIdentifier === DESKTOP_APP_ID) {
        plistBundleChannel = 'stable'
        signals.push({ source: 'Info.plist CFBundleIdentifier', channel: 'stable' })
      }
      const plistEnvChannel = parseChannelEnvValue(plist.omnimuxChannel, 'Info.plist LSEnvironment.OMNIMUX_CHANNEL')
      if (plistEnvChannel !== undefined) {
        signals.push({ source: 'Info.plist LSEnvironment.OMNIMUX_CHANNEL', channel: plistEnvChannel })
      }
      if (plist.displayName !== undefined && /^OmniMux[- ]Dev$/iu.test(plist.displayName)) {
        signals.push({ source: 'Info.plist CFBundleDisplayName', channel: 'development' })
      }
    }
  }

  const resourcesPath = input.resourcesPath
    ?? (bundleRoot !== undefined ? join(bundleRoot, 'Contents', 'Resources') : dirname(input.execPath))
  const buildInfoPath = join(resourcesPath, 'build-info.json')
  let buildInfoChannel: DesktopReleaseChannel | undefined
  if (existsSync(buildInfoPath)) {
    buildInfoChannel = parseBuildInfoChannel(buildInfoPath)
    signals.push({ source: 'Resources/build-info.json', channel: buildInfoChannel })
  }

  const devSignals = signals.filter(signal => signal.channel === 'development')
  const stableSignals = signals.filter(signal => signal.channel === 'stable')

  if (devSignals.length > 0 && stableSignals.length > 0) {
    const describe = (items: typeof signals) => items.map(item => `${item.source}=${item.channel}`).join(', ')
    throw new Error(
      `Conflicting OmniMux release-channel metadata (${describe(devSignals)} vs ${describe(stableSignals)}); refusing to start to protect production ~/.omnimux`,
    )
  }

  if (devSignals.length > 0) {
    if (buildInfoChannel !== 'development') {
      throw new Error(
        `Dev bundle metadata incomplete: missing verified development channel in ${buildInfoPath} (detected via ${devSignals.map(s => s.source).join(', ')}); refusing to fall back to production ~/.omnimux`,
      )
    }
    if (bundleRoot !== undefined && plistBundleChannel !== 'development') {
      throw new Error(
        `Dev macOS bundle must declare CFBundleIdentifier=${DESKTOP_DEV_APP_ID} in Contents/Info.plist; refusing to start`,
      )
    }
    return desktopIdentity('development')
  }

  return desktopIdentity('stable')
}
